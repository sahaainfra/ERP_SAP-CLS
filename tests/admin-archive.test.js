import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import '../src/server/modules/registry.js';
import { fill } from './qa-helpers.js';
import { setupCompany, startApi } from './helpers.js';

// Part 29.07: data retention and archival.
// T-01 archived records are read-only and retrievable; held records are skipped. FR-01 policies with legal basis; FR-02 archival jobs for
// old records and closed projects (SYSADM → AUD); FR-03 archived record view with trace and audit; FR-04 legal holds; FR-05 disposal with
// approval (AUD → DIR) and a certificate of destruction, and DPDP erasure requests with checks; BR-01 held records never archived or disposed.
const A = '/api/v1/admin/archive';
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `arc-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'ar-sys'); const aud = as('AUD', 'ar-aud'); const dir = as('DIR', 'ar-dir'); const cfo = as('CFO', 'ar-cfo'); const se = as('SE', 'ar-se');
const opened = []; after(async () => { for (const c of opened) await c(); });

async function setup() {
  const storage = mkdtempSync(join(tmpdir(), 'erp-arc-'));
  const api = await startApi({}, { storagePath: storage }); opened.push(async () => { await api.close(); rmSync(storage, { recursive: true, force: true }); }); await setupCompany(api); const db = api.db;
  for (const u of [sys, aud, dir, cfo, se]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u.user, u.user, JSON.stringify([u.roles]), `${u.user}@example.com`);
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.admin.p2907', 1, 'Archive fixture', 0, 1)").run();
  const live = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'AR-1', 'Live tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const closed = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'AR-2', 'Handed-over bridge', 'ROAD', 'CLOSED')").run().lastInsertRowid);
  db.exec('PRAGMA foreign_keys = OFF');
  const dpr = (no, date, project, status = 'APPROVED') => fill(db, 'site_dprs', { company_id: 1, doc_no: no, org_project_id: project, dpr_date: date, status });
  const ids = { d1: dpr('DPR-2024-001', '2024-01-10', live), d2: dpr('DPR-2024-002', '2024-01-11', live), d3: dpr('DPR-2024-003', '2024-01-12', live), recent: dpr('DPR-2026-900', '2026-11-01', live), draft: dpr('DPR-2024-004', '2024-01-13', live, 'DRAFT'),
    c1: dpr('DPR-BR-001', '2026-10-01', closed), c2: dpr('DPR-BR-002', '2026-10-02', closed) };
  const emp = (code, status, left) => fill(db, 'hr_employees', { company_id: 1, emp_code: code, first_name: 'Ravi', full_name: `Ravi ${code}`, gender: 'MALE', dob: '1980-01-01', mobile: '9876543210', email: `${code}@example.com`, permanent_address: '12 Main Road, Hyderabad', employment_type: 'PERMANENT', doj: '2010-01-01', record_status: 'APPROVED', employment_status: status, last_working_date: left });
  ids.oldEmp = emp('E-OLD', 'SEPARATED', '2015-03-31'); ids.newEmp = emp('E-NEW', 'SEPARATED', '2024-06-30'); ids.active = emp('E-ACT', 'ACTIVE', null);
  db.exec('PRAGMA foreign_keys = ON');
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  return { api, db, call, storage, ids, live, closed };
}

test('T-01 FR-01 FR-02 FR-03 FR-04 BR-01 an approved archival job archives old records read-only and retrievable, skipping held ones; closed projects', async () => {
  const t = await setup();
  assert.equal((await t.call(se, 'GET', `${A}/policies`)).status, 403);
  assert.equal((await t.call(aud, 'POST', `${A}/policies`, { recordClass: 'site.dpr', archiveAfterMonths: 12, retentionYears: 8, legalBasis: 'Contract records', actionAfter: 'DISPOSE' })).status, 403, 'only SYSADM sets policies');
  const pol = await t.call(sys, 'POST', `${A}/policies`, { recordClass: 'site.dpr', archiveAfterMonths: 12, retentionYears: 1, legalBasis: 'Contract clause 14: site records kept one year after handover', actionAfter: 'DISPOSE' });
  assert.equal(pol.status, 201, JSON.stringify(pol.json));
  // FR-04: a legal hold on one record
  const hold = await t.call(cfo, 'POST', `${A}/holds`, { entity: 'site.dpr', entityId: t.ids.d2, reason: 'Arbitration with the client over March progress' });
  assert.equal(hold.status, 201, JSON.stringify(hold.json));
  const pv = (await t.call(sys, 'POST', `${A}/jobs/preview`, { recordClass: 'site.dpr' })).json.data;
  assert.deepEqual([pv.total, pv.held, pv.eligible], [3, 1, 2], 'old approved DPRs only; the draft and the recent one are not due');
  const job = (await t.call(sys, 'POST', `${A}/jobs`, { recordClass: 'site.dpr', reason: 'Yearly archival of 2024 site records' })).json.data;
  assert.equal(job.status, 'SUBMITTED');
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM arc_records').get().n, 0, 'nothing is archived before AUD approves');
  assert.notEqual((await t.call(sys, 'POST', `${A}/jobs/${job.id}/act`, { action: 'approve' })).status, 200, 'the maker cannot approve');
  const done = (await t.call(aud, 'POST', `${A}/jobs/${job.id}/act`, { action: 'approve', comment: 'Scope checked' })).json.data;
  assert.deepEqual([done.status, done.records, done.held], ['DONE', 2, 1]);
  // T-01 read-only: the archived rows refuse changes; the held one is not archived
  assert.throws(() => t.db.prepare("UPDATE site_dprs SET status = 'CANCELLED' WHERE id = ?").run(t.ids.d1), /ARCHIVED/);
  assert.throws(() => t.db.prepare('DELETE FROM site_dprs WHERE id = ?').run(t.ids.d3), /ARCHIVED/);
  t.db.prepare("UPDATE site_dprs SET remarks = 'still live' WHERE id = ?").run(t.ids.d2);
  // T-01 retrievable: search, view with snapshot, checksum, job, policy and trail; the file in archive storage
  const found = (await t.call(aud, 'GET', `${A}/records?q=DPR-2024-001`)).json.data; assert.equal(found.total, 1);
  const rec = (await t.call(aud, 'GET', `${A}/records/${found.rows[0].id}`)).json.data;
  assert.deepEqual([rec.payload.doc_no, rec.intact, rec.readOnly, rec.job.id, rec.policy.retentionYears], ['DPR-2024-001', true, true, job.id, 1]);
  assert.ok(t.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'arc_records' AND action = 'view'").get(), 'viewing an archived record is audited');
  const gz = gunzipSync(readFileSync(join(t.storage, 'archive', done.file))).toString(); assert.equal(gz.split('\n').length, 2);
  assert.match(gz, /DPR-2024-003/); assert.doesNotMatch(gz, /DPR-2024-002/);
  // FR-02 closed projects: their records are archived whatever their age
  const cp = (await t.call(sys, 'POST', `${A}/jobs/preview`, { recordClass: 'site.dpr', closedProjectsOnly: true })).json.data; assert.equal(cp.eligible, 2);
  // a hold on the closed project keeps all of its records out (BR-01)
  const ph = (await t.call(aud, 'POST', `${A}/holds`, { entity: 'org_projects', entityId: t.closed, reason: 'Defect liability claim pending' })).json.data;
  assert.equal((await t.call(sys, 'POST', `${A}/jobs`, { recordClass: 'site.dpr', closedProjectsOnly: true, reason: 'Closed project archival' })).status, 422);
  await t.call(aud, 'POST', `${A}/holds/${ph.id}/release`, { reason: 'Claim settled in October' });
  const j2 = (await t.call(sys, 'POST', `${A}/jobs`, { recordClass: 'site.dpr', closedProjectsOnly: true, reason: 'Closed project archival' })).json.data;
  assert.equal((await t.call(aud, 'POST', `${A}/jobs/${j2.id}/act`, { action: 'approve' })).json.data.records, 2);
  const rep = (await t.call(dir, 'GET', `${A}/report`)).json.data; assert.equal(rep.rows.find((r) => r.recordClass === 'site.dpr').archived, 4);
  assert.equal((await t.call(se, 'POST', `${A}/holds`, { entity: 'site.dpr', entityId: t.ids.d1, reason: 'Not allowed for SE' })).status, 403);
});

test('FR-05 BR-01 disposal after retention (AUD → DIR) deletes past-retention archived records except held ones and issues a certificate; REVIEW policies are not disposed', async () => {
  const t = await setup();
  await t.call(sys, 'POST', `${A}/policies`, { recordClass: 'site.dpr', archiveAfterMonths: 12, retentionYears: 1, legalBasis: 'Contract clause 14', actionAfter: 'DISPOSE' });
  const j = (await t.call(sys, 'POST', `${A}/jobs`, { recordClass: 'site.dpr', reason: 'Yearly archival of 2024 site records' })).json.data;
  await t.call(aud, 'POST', `${A}/jobs/${j.id}/act`, { action: 'approve' });
  // a hold placed after archiving still protects the record from disposal
  await t.call(cfo, 'POST', `${A}/holds`, { entity: 'site.dpr', entityId: t.ids.d3, reason: 'Insurance claim on the March incident' });
  assert.equal((await t.call(sys, 'POST', `${A}/disposals`, { recordClass: 'site.dpr', reason: 'SYSADM may not propose' })).status, 403);
  const d = (await t.call(aud, 'POST', `${A}/disposals`, { recordClass: 'site.dpr', reason: 'Retention of one year has ended' })).json.data;
  assert.deepEqual([d.status, d.records, d.held], ['SUBMITTED', 2, 1]);
  const ok = (await t.call(dir, 'POST', `${A}/disposals/${d.id}/act`, { action: 'approve', comment: 'Approved' })).json.data;
  assert.equal(ok.status, 'DONE'); assert.equal(ok.disposed + ok.anonymised, 2); assert.match(ok.certificateNo, /^COD-1-/);
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM site_dprs WHERE id IN (?, ?) AND deleted_at IS NULL').get(t.ids.d1, t.ids.d2).n, 0, 'disposed');
  assert.ok(t.db.prepare('SELECT 1 FROM site_dprs WHERE id = ?').get(t.ids.d3), 'the held record is kept');
  assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM arc_records WHERE payload_json IS NULL AND disposed_at IS NOT NULL').get().n, 2, 'their archive copies are cleared');
  const pdf = await t.api.raw('GET', `${A}/disposals/${d.id}/certificate`, aud); assert.equal(pdf.status, 200); assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
  assert.ok(existsSync(join(t.storage, 'archive', `${ok.certificateNo}.pdf`)));
  await t.call(sys, 'POST', `${A}/policies`, { recordClass: 'fin.journal', archiveAfterMonths: 12, retentionYears: 8, legalBasis: 'Companies Act section 128: 8 years', actionAfter: 'REVIEW' });
  assert.match((await t.call(aud, 'POST', `${A}/disposals`, { recordClass: 'fin.journal', reason: 'Try to dispose journals' })).json.error.message, /REVIEW/);
});

test('FR-05 DPDP erasure: checks for employment, legal hold and statutory retention; DIR approves; the personal fields are redacted', async () => {
  const t = await setup();
  const chk = (await t.call(aud, 'GET', `${A}/erasures/check/${t.ids.newEmp}`)).json.data;
  assert.equal(chk.find((c) => /Statutory/.test(c.check)).ok, false, 'left in 2024: still within the 8-year statutory retention');
  assert.equal((await t.call(aud, 'POST', `${A}/erasures`, { subjectId: t.ids.active, basis: 'Request by e-mail', reason: 'Data principal request' })).json.data.status, 'REFUSED');
  assert.equal((await t.call(aud, 'POST', `${A}/erasures`, { subjectId: t.ids.newEmp, basis: 'Request by e-mail', reason: 'Data principal request' })).json.data.status, 'REFUSED');
  await t.call(cfo, 'POST', `${A}/holds`, { entity: 'hr.employee', entityId: t.ids.oldEmp, reason: 'Labour court case' });
  assert.equal((await t.call(aud, 'POST', `${A}/erasures`, { subjectId: t.ids.oldEmp, basis: 'Request by e-mail', reason: 'Data principal request' })).json.data.status, 'REFUSED', 'a legal hold blocks erasure');
  const h = (await t.call(cfo, 'GET', `${A}/holds`)).json.data.rows[0]; await t.call(cfo, 'POST', `${A}/holds/${h.id}/release`, { reason: 'Case closed in 2025' });
  const e = (await t.call(aud, 'POST', `${A}/erasures`, { subjectId: t.ids.oldEmp, basis: 'Written request dated 1 Nov 2026', reason: 'Data principal request under the DPDP Act' })).json.data;
  assert.equal(e.status, 'SUBMITTED', JSON.stringify(e.checks));
  const done = (await t.call(dir, 'POST', `${A}/erasures/${e.id}/act`, { action: 'approve', comment: 'Checks passed' })).json.data;
  assert.equal(done.status, 'DONE');
  const row = t.db.prepare('SELECT mobile, email, permanent_address, emp_code FROM hr_employees WHERE id = ?').get(t.ids.oldEmp);
  assert.deepEqual([row.mobile, row.email, row.permanent_address, row.emp_code], ['0000000000', null, '[erased]', 'E-OLD'], 'personal fields redacted; the employee code kept for the payroll history');
  assert.ok(t.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'hr_employees' AND action = 'personal_data_erased'").get());
});
