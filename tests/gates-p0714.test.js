import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../src/server/modules/registry.js';
import { memoryDb, setupCompany, startApi } from './helpers.js';
import { evidenceFile } from '../src/server/modules/hr/gates.js';
import { OVERVIEWS } from '../src/server/modules/ui/overviews.js';

// Part 07.14 (built in 166.6): the gates G1–G4 and the workforce dashboard (ff.hr.p0714, ON in test).
//  T-G1 every criterion has at least one evidence link and every link resolves; T-G2 a gate cannot pass while a criterion is open;
//  the sign-off goes through the workflow engine (technical lead, then the director); the report is a PDF; evidence is read from docs/erp only;
//  AC-03 who may see, review, export; the workforce cards are the figures of their HR services.
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const as = (roles, user, company = '1') => ({ roles, user, company });
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `gt-${k}-${Math.random().toString(36).slice(2, 10)}` });
const CATALOGUE = JSON.parse(readFileSync(new URL('../src/server/modules/hr/gate-catalogue.json', import.meta.url), 'utf8'));

test('T-G1 every criterion of every gate has at least one evidence link, and every link resolves to a document of docs/erp', () => {
  assert.deepEqual(CATALOGUE.gates.map((g) => g.code), ['G1', 'G2', 'G3', 'G4']);
  for (const g of CATALOGUE.gates) {
    assert.ok(g.criteria.length > 1, g.code);
    for (const c of g.criteria) {
      assert.ok(c.evidence.length >= 1, `${c.code} has evidence`);
      for (const e of c.evidence) assert.ok(evidenceFile(e.path), `${c.code}: ${e.path} resolves`);
    }
  }
  // the parts of G2 are the fourteen of 07.xx, the last criterion the defects of the gate
  const g2 = CATALOGUE.gates.find((g) => g.code === 'G2');
  assert.deepEqual(g2.criteria.filter((c) => c.kind === 'PART').map((c) => c.partId), ['07.01', '07.02', '07.03', '07.04', '07.05', '07.06', '07.07', '07.08', '07.09', '07.10', '07.11', '07.12', '07.13', '07.14']);
  assert.equal(g2.criteria.at(-1).code, 'G2-DEF');
  // nothing outside docs/erp is ever an evidence file
  for (const bad of ['docs/erp/../../package.json', '/etc/passwd', 'src/server/config.js', 'docs/erp/COMPLETION/../../../.env', 'docs/erp/nothing-here.md']) assert.equal(evidenceFile(bad), null, bad);
});

test('the migration: the tables of the gates, the flag, the menu, the workforce widgets', () => {
  const db = memoryDb();
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'hr_gates'").get());
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'hr_gate_criteria'").get());
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_feature_flags WHERE key = 'ff.hr.p0714'").get().n, 3);
  assert.deepEqual(db.prepare("SELECT route FROM ui_navigation_entries WHERE code IN ('hr-workforce', 'admin-gates') ORDER BY code").all().map((r) => r.route), ['/admin/gates', '/hr/workforce']);
  const wf = OVERVIEWS.find((o) => o.code === 'ov-workforce');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ui_widgets WHERE code LIKE 'ov.wf.%'").get().n, wf.cards.length);
  assert.throws(() => db.prepare("INSERT INTO hr_gate_criteria (company_id, gate_id, code, title, kind, status) VALUES (1, 1, 'x', 'x', 'PART', 'DONE')").run(), /CHECK|FOREIGN/);
});

test('T-G2 a gate passes only when every criterion is met, then through the technical lead and the director; the report is a PDF', async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  const it1 = as('ITADM', 'gt-it1');
  const it2 = as('ITADM', 'gt-it2');
  const dir = as('DIR', 'gt-dir');
  const list = await api.call('GET', '/api/v1/hr/gates', it1);
  assert.equal(list.status, 200, JSON.stringify(list.json));
  assert.deepEqual(list.json.data.map((g) => [g.code, g.status]), [['G1', 'OPEN'], ['G2', 'OPEN'], ['G3', 'OPEN'], ['G4', 'OPEN']]);
  const g2 = (await api.call('GET', '/api/v1/hr/gates/G2', it1)).json.data;
  assert.equal(g2.counts.total, 15);
  assert.equal(g2.canReview, true);
  assert.ok(g2.criteria.every((c) => c.evidence.length >= 1 && c.evidence.every((e) => e.resolves)), 'T-G1 on the page too');
  // every evidence link of the page opens through the API (read only, the document's own type)
  const ev = await api.call('GET', `/api/v1/hr/gates/evidence?path=${encodeURIComponent('docs/erp/COMPLETION/07.01.md')}`, it1);
  assert.equal(ev.status, 200);
  for (const bad of ['docs/erp/../../package.json', 'package.json', '/etc/passwd']) assert.equal((await api.call('GET', `/api/v1/hr/gates/evidence?path=${encodeURIComponent(bad)}`, it1)).status, 404, bad);

  // T-G2: not sent while one is open; a criterion not met needs a reason
  const send = (who, k) => api.call('POST', '/api/v1/hr/gates/G2/submit', { ...who, headers: key(k), body: {} });
  const refused = await send(it1, 's0');
  assert.equal(refused.status, 422);
  assert.match(refused.json.error.message, /15 of its 15 criteria are not met/);
  const mark = (who, code, status, note, k) => api.call('POST', `/api/v1/hr/gates/G2/criteria/${code}`, { ...who, headers: key(k), body: { status, ...(note ? { note } : {}) } });
  assert.equal((await mark(it1, 'G2-P07.01', 'NOT_MET', null, 'n0')).status, 422, 'not met without a reason');
  assert.equal((await mark(it1, 'G2-P07.01', 'NOT_MET', 'the screenshots are missing', 'n1')).status, 200);
  for (const c of g2.criteria) {
    const r = await mark(it1, c.code, 'MET', null, `m-${c.code}`);
    assert.equal(r.status, 200, `${c.code}: ${JSON.stringify(r.json)}`);
  }
  // one put back to open: still refused
  assert.equal((await mark(it1, 'G2-DEF', 'OPEN', null, 'o1')).status, 200);
  assert.equal((await send(it1, 's1')).status, 422);
  assert.equal((await mark(it1, 'G2-DEF', 'MET', 'no Critical or High defect left without a decision', 'o2')).status, 200);
  // a director may not review; the reviewer sends it
  assert.equal((await mark(dir, 'G2-DEF', 'OPEN', null, 'd0')).status, 403);
  const sent = await send(it1, 's2');
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.data.status, 'SUBMITTED');
  assert.equal((await mark(it1, 'G2-DEF', 'OPEN', null, 'o3')).status, 409, 'locked once sent');

  // the sign-off: another technical lead (the maker never approves), then the director
  const act = async (who, k) => {
    const task = (await api.call('GET', '/api/v1/workflow/tasks?mine=assigned', who)).json.data.rows.find((t) => t.instance.docType === 'HR_GATE');
    assert.ok(task, `${who.user} has the sign-off task`);
    const r = await api.call('POST', `/api/v1/workflow/tasks/${task.id}/act`, { ...who, headers: key(k), body: { action: 'approve', comment: 'evidence checked' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  assert.ok(!(await api.call('GET', '/api/v1/workflow/tasks?mine=assigned', it1)).json.data.rows.some((t) => t.instance.docType === 'HR_GATE'), 'the reviewer who sent it does not sign it');
  await act(it2, 'a1');
  assert.equal((await api.call('GET', '/api/v1/hr/gates/G2', it1)).json.data.status, 'SUBMITTED', 'the director has not signed yet');
  await act(dir, 'a2');
  const passed = (await api.call('GET', '/api/v1/hr/gates/G2', dir)).json.data;
  assert.equal(passed.status, 'PASSED');
  assert.ok(passed.passedAt);
  assert.deepEqual(passed.history.filter((h) => h.event === 'APPROVED').map((h) => [h.by, h.role]), [['gt-it2', 'Technical lead (ITADM)'], ['gt-dir', 'Director (DIR)']]);

  // §2.3 the report: a PDF with the sign-off; the director and the auditor may download it, the HR manager may only look
  const pdf = await api.raw('GET', '/api/v1/hr/gates/G2/report', dir);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await api.call('GET', '/api/v1/hr/gates/G2/report', as('HRMGR', 'gt-hr'))).status, 403);
  assert.equal((await api.call('GET', '/api/v1/hr/gates/G2', as('HRMGR', 'gt-hr'))).status, 200);
  assert.ok(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'hr_gates' AND action = 'export'").get().n >= 1);
});

test('AC-03 who sees the gates and the workforce dashboard: the site engineer and the storekeeper see neither; the other gates stay open', async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const role of ['SE', 'SK', 'QS']) {
    assert.equal((await api.call('GET', '/api/v1/hr/gates', as(role, `gt-${role}`))).status, 403, role);
    assert.equal((await api.call('GET', '/api/v1/ui/widgets/ov.wf.present/data', as(role, `gt-${role}`))).status, 403, role);
  }
  for (const role of ['ITADM', 'DIR', 'AUD', 'HRMGR', 'SYSADM']) assert.equal((await api.call('GET', '/api/v1/hr/gates', as(role, `gt-${role}`))).status, 200, role);
  for (const role of ['HRMGR', 'PM', 'DIR', 'AUD']) assert.equal((await api.call('GET', '/api/v1/ui/widgets/ov.wf.present/data', as(role, `gt-${role}`))).status, 200, role);
  // another company's gates are its own
  const g1 = (await api.call('GET', '/api/v1/hr/gates/G1', as('ITADM', 'gt-it'))).json.data;
  assert.equal(g1.status, 'OPEN');
  assert.equal(g1.counts.total, CATALOGUE.gates[0].criteria.length);
});

test('T-01 the workforce cards are the figures of their HR services for the same person', async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  const hr = as('HRMGR', 'gt-hrm');
  const card = async (code) => { const r = await api.call('GET', `/api/v1/ui/widgets/${code}/data`, hr); assert.equal(r.status, 200, `${code}: ${JSON.stringify(r.json)}`); return r.json.data.data; };
  const today = (await api.call('GET', '/api/v1/att/report/today', hr)).json.data;
  const present = await card('ov.wf.present');
  assert.equal(present.value, today.totals.present);
  const att = await card('ov.wf.attendance_today');
  assert.deepEqual(att.categories.slice(0, 3), ['Present', 'Absent', 'Late']);
  assert.deepEqual(att.series[0].values.slice(0, 3), [today.totals.present, today.totals.absent, today.totals.late]);
  const strength = (await api.call('GET', '/api/v1/hr/labour/strength', hr)).json.data ?? [];
  const labour = await card('ov.wf.labour_on_site');
  assert.equal(labour.rows.length, strength.filter((x) => x.present || x.deployed).slice(0, 8).length);
  const ov = (await api.call('GET', '/api/v1/hr/employees/overview?from=2026-04-01&to=2027-03-31', hr)).json.data;
  const sites = await card('ov.wf.headcount_by_site');
  assert.deepEqual(sites.rows.map((r) => [r.label, r.value]), ov.bySite.slice(0, 8).map((r) => [r.label, r.n]));
  const ot = await card('ov.wf.overtime');
  assert.equal(typeof ot.value, 'number');
  assert.match(ot.note, /No overtime budget/);
  const exp = await card('ov.wf.expiring');
  assert.ok(Array.isArray(exp.rows));
  for (const c of ['ov.wf.leave_liability', 'ov.wf.attrition', 'ov.wf.pending']) await card(c);
});
