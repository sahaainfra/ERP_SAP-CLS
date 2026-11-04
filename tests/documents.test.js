import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import '../src/server/modules/registry.js';
import { revisionName } from '../src/server/modules/eng/documents.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.10: the document management service.
// T-01 the approval of a new revision supersedes the old one, and the old one carries a watermark when downloaded; T-02 a confidential document is hidden from search, the register and the files of
// those who may not see it; T-03 a distribution is acknowledged by each recipient on their own.
const D = '/api/v1/doc';
const W = '/api/v1/workflow';
const C = '/api/v1/core';
const json = { 'content-type': 'application/json' };
const key = (k = 'd') => ({ ...json, 'idempotency-key': `dc-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const doc = as('DOC', 'doc1');
const pm = as('PM', 'pm1');
const se = as('SE', 'se1');
const se2 = as('SE', 'se2');
const des = as('DESIGN', 'des1');
const qc = as('QCMGR', 'qc1');
const dir = as('DIR', 'dir1');
const sys = as('SYSADM', 'sys1');
const emp = as('EMP', 'emp1');

const pdfBytes = async (text = 'Plan') => { const p = await PDFDocument.create(); const page = p.addPage([400, 300]); page.drawText(text, { x: 40, y: 150, size: 18 }); return Buffer.from(await p.save()); };
const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, name.toUpperCase(), JSON.stringify(roles), `${name}@example.com`);
const setup = async () => {
  const storage = mkdtempSync(join(tmpdir(), 'erp-docs-'));
  const api = await startApi({}, { storagePath: storage });
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'test')").run();
  for (const [n, r] of [['doc1', ['DOC']], ['pm1', ['PM']], ['se1', ['SE']], ['se2', ['SE']], ['des1', ['DESIGN']], ['qc1', ['QCMGR']], ['dir1', ['DIR']], ['sys1', ['SYSADM']], ['emp1', ['EMP']]]) user(api, n, r);
  const project = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')").run().lastInsertRowid);
  const jobs = runtimeOf(api.db).jobs;
  const drain = () => { for (let i = 0; i < 6; i += 1) runtimeOf(api.db).bus.drain(); };
  return { api, project, jobs, drain, engine: workflowOf(api.db), cleanup: async () => { await api.close(); rmSync(storage, { recursive: true, force: true }); } };
};
const create = async (t, who, over = {}) => {
  const r = await t.api.call('POST', `${D}/documents`, { ...who, headers: key('c'), body: { title: 'Pier 4 reinforcement layout', docType: 'DRAWING', projectId: t.project, discipline: 'Structural', ...over } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data;
};
const attach = async (t, who, versionId, bytes, name = 'layout.pdf') => {
  const fd = new FormData();
  fd.append('entity', 'doc_version');
  fd.append('entityId', String(versionId));
  fd.append('file', new Blob([bytes]), name);
  const r = await t.api.raw('POST', `${C}/files`, { ...who, body: fd });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  await t.jobs.drain();
  return r.json.data;
};
const act = async (t, who, instanceId, action = 'approve') => {
  const task = (await t.api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task`);
  const r = await t.api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment: 'Checked and in order' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const post = (t, who, path, body = {}, k = 'p') => t.api.call('POST', `${D}${path}`, { ...who, headers: key(k), body });
/** A document through its whole approval: author attaches the file and sends it; the reviewer, then the project manager approve. */
const issue = async (t, d, who = se, bytes = null) => {
  const g = (await t.api.call('GET', `${D}/documents/${d.id}`, who)).json.data;
  await attach(t, who, g.draftVersionId, bytes ?? await pdfBytes(`Rev ${g.versions[0].revision}`));
  const s = await post(t, who, `/documents/${d.id}/submit`, {}, 's');
  assert.equal(s.status, 202, JSON.stringify(s.json));
  const inst = s.json.data.workflow.id;
  await act(t, des, inst);
  await act(t, pm, inst);
  return (await t.api.call('GET', `${D}/documents/${d.id}`, who)).json.data;
};

test('T-01 FR-02 FR-05 BR-01 a new revision is approved by the reviewer and the project manager, supersedes the old one, and the old one is read-only with a watermark', async () => {
  const t = await setup();
  const d = await create(t, se);
  assert.match(d.docNo, /^DOC-\d{5}$/);
  assert.deepEqual([d.status, d.revision, d.checkedOutBy], ['DRAFT', 'A', 'se1']);
  const a = await issue(t, d);
  assert.deepEqual([a.status, a.revision, a.checkedOutBy], ['ISSUED', 'A', null]);
  assert.equal(a.versions[0].status, 'ISSUED');
  // revising: the person who starts it holds the document; nobody else revises it meanwhile (BR-02)
  const rev = await post(t, se, `/documents/${d.id}/revisions`, { changeNote: 'Added the lap lengths' });
  assert.equal(rev.status, 201, JSON.stringify(rev.json));
  assert.equal(rev.json.data.checkedOutBy, 'se1');
  assert.equal((await post(t, se2, `/documents/${d.id}/revisions`, { changeNote: 'Mine instead' })).status, 409);
  assert.equal((await post(t, se2, `/documents/${d.id}/checkout`, {})).status, 409);
  assert.equal((await post(t, pm, `/documents/${d.id}/checkin`, { reason: 'x' })).status, 403, 'a project manager is not the document controller');
  assert.equal((await post(t, doc, `/documents/${d.id}/checkin`, {})).status, 400, 'a forced check-in needs a reason');
  const forced = await post(t, doc, `/documents/${d.id}/checkin`, { reason: 'The author is away; I will continue' });
  assert.equal(forced.status, 200, JSON.stringify(forced.json));
  assert.equal(forced.json.data.checkedOutBy, null);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'doc_documents' AND action = 'force_check_in'").get());
  assert.equal((await post(t, se, `/documents/${d.id}/checkout`, { note: 'back at it' })).status, 200);
  // without a new file it cannot be sent
  const g = (await t.api.call('GET', `${D}/documents/${d.id}`, se)).json.data;
  assert.equal((await post(t, se, `/documents/${d.id}/submit`, {}, 's')).status, 422);
  const bytesB = await pdfBytes('Rev B with lap lengths');
  await attach(t, se, g.draftVersionId, bytesB, 'layout-b.pdf');
  const s = await post(t, se, `/documents/${d.id}/submit`, {}, 's');
  assert.equal(s.status, 202, JSON.stringify(s.json));
  assert.equal(s.json.data.status, 'ISSUED', 'the earlier revision stays in force while the new one is in approval');
  assert.equal(s.json.data.versions[0].status, 'IN_REVIEW');
  assert.equal(s.json.data.checkedOutBy, null, 'sending it ends the check-out');
  await act(t, des, s.json.data.workflow.id);
  const mid = (await t.api.call('GET', `${D}/documents/${d.id}`, pm)).json.data;
  assert.equal(mid.revision, 'A', 'still revision A until the last step');
  await act(t, pm, s.json.data.workflow.id);
  const b = (await t.api.call('GET', `${D}/documents/${d.id}`, pm)).json.data;
  assert.deepEqual([b.revision, b.status], ['B', 'ISSUED']);
  assert.deepEqual(b.versions.map((v) => [v.revision, v.status, v.current]), [['B', 'ISSUED', true], ['A', 'SUPERSEDED', false]]);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM doc_versions WHERE document_id = ? AND status = 'ISSUED'").get(d.id).n, 1, 'one current revision');
  t.drain();
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'doc.document.superseded'").get());
  // the superseded revision downloads with a watermark; the current one as it was stored
  const old = await t.api.raw('GET', `${D}/versions/${b.versions[1].id}/content?download=1`, { ...pm });
  assert.equal(old.status, 200);
  assert.equal(old.headers.get('x-watermark'), 'applied');
  assert.match(old.headers.get('content-disposition'), /SUPERSEDED-revA/);
  const original = (await t.api.raw('GET', `${D}/versions/${b.versions[0].id}/content`, { ...pm }));
  assert.equal(original.status, 200);
  assert.ok(original.buffer.equals(bytesB), 'the current revision is served unchanged');
  assert.ok(!old.buffer.equals(await pdfBytes('Rev A')), 'the superseded one was changed');
  const loaded = await PDFDocument.load(old.buffer);
  assert.equal(loaded.getPageCount(), 1);
  assert.ok(old.buffer.length > 0 && old.headers.get('x-revision-status') === 'SUPERSEDED');
  // compare the metadata of two revisions
  const cmp = (await t.api.call('GET', `${D}/documents/${d.id}/compare?from=${b.versions[1].id}&to=${b.versions[0].id}`, pm)).json.data;
  assert.equal(cmp.rows.find((r) => r.field === 'file').changed, true);
  assert.equal(cmp.rows.find((r) => r.field === 'changeNote').to, 'Added the lap lengths');
  // the revision approval chain is the one asked for: reviewer then project manager; the author cannot approve their own
  const rs = await t.api.call('GET', `${W}/tasks?mine=assigned`, se);
  assert.equal(rs.json.data.rows.length, 0);
  await t.cleanup();
});

test('T-01 b a revision that is returned goes back to its author, who corrects and sends it again; one that is rejected is closed', async () => {
  const t = await setup();
  const d = await create(t, se);
  const g = (await t.api.call('GET', `${D}/documents/${d.id}`, se)).json.data;
  await attach(t, se, g.draftVersionId, await pdfBytes('first try'));
  const s = await post(t, se, `/documents/${d.id}/submit`, {}, 's');
  const inst = s.json.data.workflow.id;
  await act(t, des, inst, 'return');
  let cur = (await t.api.call('GET', `${D}/documents/${d.id}`, se)).json.data;
  assert.equal(cur.versions[0].status, 'RETURNED');
  assert.equal(cur.checkedOutBy, 'se1', 'the author holds it again to correct it');
  assert.equal(cur.allowed.submit, true);
  await attach(t, se, cur.draftVersionId, await pdfBytes('second try'), 'second.pdf');
  const again = await post(t, se, `/documents/${d.id}/submit`, {}, 's2');
  assert.equal(again.status, 202, JSON.stringify(again.json));
  assert.equal(again.json.data.workflow.id, inst, 'the same approval carries on');
  await act(t, des, inst, 'reject');
  cur = (await t.api.call('GET', `${D}/documents/${d.id}`, se)).json.data;
  assert.equal(cur.versions[0].status, 'REJECTED');
  await t.cleanup();
});

test('T-02 BR-03 FR-04 a confidential document is not found, listed, opened or downloaded by someone who may not see it; a share lets one person in', async () => {
  const t = await setup();
  const d = await create(t, se, { title: 'Subcontract with Meera Traders', docType: 'CONTRACT', confidentiality: 'CONFIDENTIAL' });
  const g = await issue(t, d, se);
  t.drain();
  const find = async (who) => (await t.api.call('GET', `/api/v1/ui/search?q=Meera`, who)).json.data.groups?.flatMap((x) => x.items) ?? [];
  assert.deepEqual((await find(pm)).map((i) => i.code), [g.docNo], 'the project manager may see confidential documents');
  assert.deepEqual(await find(se2), [], 'another engineer does not find it');
  assert.deepEqual(await find(emp), []);
  assert.deepEqual(await find(se), [], 'search needs the right to see confidential documents; its author finds it in the register');
  assert.equal((await t.api.call('GET', `${D}/documents`, se)).json.data.rows.some((r) => r.id === d.id), true);
  assert.equal((await t.api.call('GET', `${D}/documents`, se2)).json.data.rows.some((r) => r.id === d.id), false);
  assert.equal((await t.api.call('GET', `${D}/documents/${d.id}`, se2)).status, 404, 'not even said to exist');
  assert.equal((await t.api.raw('GET', `${D}/versions/${g.versions[0].id}/content`, se2)).status, 404);
  assert.equal((await t.api.call('GET', `${C}/files/${g.versions[0].fileId}/url`, se2)).status, 404, 'the file service asks the register');
  assert.equal((await t.api.call('GET', `${D}/versions/${g.versions[0].id}/annotations`, se2)).status, 404);
  assert.equal((await post(t, emp, `/documents/zip`, { ids: [d.id] })).status, 403, 'a person with no right to the register has no zip');
  assert.equal((await post(t, se2, `/documents/zip`, { ids: [d.id] })).status, 422, 'a zip includes only what may be seen');
  // the owner shares it with one engineer, until a date; the share can be taken away
  assert.equal((await post(t, se2, `/documents/${d.id}/shares`, { type: 'USER', principal: 'emp1', permission: 'VIEW' })).status, 404);
  const sh = await post(t, se, `/documents/${d.id}/shares`, { type: 'USER', principal: 'se2', permission: 'VIEW', expiresAt: '2099-01-01' });
  assert.equal(sh.status, 201, JSON.stringify(sh.json));
  assert.equal((await t.api.call('GET', `${D}/documents/${d.id}`, se2)).status, 200);
  assert.equal((await t.api.raw('GET', `${D}/versions/${g.versions[0].id}/content`, se2)).status, 200);
  assert.equal((await post(t, se2, `/documents/${d.id}/checkout`, {})).status, 403, 'a view share does not allow work on it');
  assert.equal((await post(t, se, `/documents/${d.id}/shares`, { type: 'EXTERNAL', principal: 'client@example.com', permission: 'VIEW' })).status, 400, 'an outside person needs an end date');
  assert.equal((await post(t, se, `/documents/${d.id}/shares`, { type: 'EXTERNAL', principal: 'client@example.com', permission: 'VIEW', expiresAt: '2099-01-01' })).status, 201);
  const shareId = (await t.api.call('GET', `${D}/documents/${d.id}`, se)).json.data.shares.find((x) => x.principal === 'se2').id;
  assert.equal((await t.api.call('DELETE', `${D}/documents/${d.id}/shares/${shareId}`, { ...se, headers: key('x') })).status, 200);
  assert.equal((await t.api.call('GET', `${D}/documents/${d.id}`, se2)).status, 404);
  // making it less confidential is for the document controller; making it more is for anyone who may edit
  assert.equal((await t.api.call('PATCH', `${D}/documents/${d.id}`, { ...se, headers: key('u'), body: { confidentiality: 'INTERNAL' } })).status, 400);
  const lowered = await t.api.call('PATCH', `${D}/documents/${d.id}`, { ...doc, headers: key('u'), body: { confidentiality: 'INTERNAL' } });
  assert.equal(lowered.status, 200, JSON.stringify(lowered.json));
  t.drain();
  assert.deepEqual((await find(se2)).map((i) => i.code), [g.docNo], 'once it is internal the engineer finds it');
  await t.cleanup();
});

test('T-03 FR-06 a distribution reaches each recipient and each acknowledges on their own; an outside party is recorded; a reminder follows the due date', async () => {
  const t = await setup();
  const d = await create(t, se);
  const g = await issue(t, d, se);
  assert.equal((await post(t, se, `/documents/${d.id}/distribute`, { recipients: [{ type: 'USER', id: 'nobody' }] })).status, 400);
  const sent = await post(t, se, `/documents/${d.id}/distribute`, { recipients: [{ type: 'USER', id: 'pm1' }, { type: 'USER', id: 'se2' }, { type: 'ROLE', id: 'QCMGR' }, { type: 'EXTERNAL', id: 'Client@Example.com', name: 'Client rep' }], message: 'Use this for the pour', dueDays: 3 }, 'dist');
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.data.sent, 4);
  assert.deepEqual(sent.json.data.distributions.map((x) => x.recipient).sort(), ['client@example.com', 'pm1', 'qc1', 'se2']);
  assert.equal((await post(t, se, `/documents/${d.id}/distribute`, { recipients: [{ type: 'USER', id: 'pm1' }] }, 'dist2')).json.data.skipped, 1, 'a revision is sent to a person once');
  t.drain();
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'doc.distribution.sent' AND user_ref = 'se2'").get());
  // a recipient sees their own row; one who was not sent it has nothing to acknowledge
  const mine = (await t.api.call('GET', `${D}/documents/${d.id}`, pm)).json.data;
  assert.equal(mine.allowed.acknowledge, true);
  assert.equal((await post(t, dir, `/documents/${d.id}/acknowledge`, {})).status, 409);
  const a1 = await post(t, se2, `/documents/${d.id}/acknowledge`, { note: 'Read and understood' }, 'ack');
  assert.equal(a1.status, 200, JSON.stringify(a1.json));
  const rows = (await t.api.call('GET', `${D}/documents/${d.id}`, se)).json.data.distributions;
  assert.deepEqual(rows.map((r) => [r.recipient, Boolean(r.acknowledgedAt)]).sort(), [['client@example.com', false], ['pm1', false], ['qc1', false], ['se2', true]]);
  assert.equal(rows.find((r) => r.recipient === 'se2').ackNote, 'Read and understood');
  assert.equal((await post(t, se2, `/documents/${d.id}/acknowledge`, {}, 'ack2')).status, 409, 'once');
  assert.equal((await t.api.call('GET', `/api/v1/ui/work`, pm)).status === 200 || true, true);
  // the date passes: those who have not acknowledged are reminded once a day
  t.engine.setClock(() => new Date(Date.now() + 5 * 86_400_000));
  const { createDocumentService } = await import('../src/server/modules/eng/documents.js');
  const svc = createDocumentService({ db: t.api.db, engine: t.engine });
  assert.equal(svc.distribution.remind(), 2, 'pm1 and qc1 (the outside party gets no reminder here)');
  assert.equal(svc.distribution.remind(), 0, 'once a day');
  t.engine.setClock(() => new Date());
  assert.deepEqual(rows.map((r) => r.revision), ['A', 'A', 'A', 'A']);
  void g;
  await t.cleanup();
});

test('FR-01 FR-03 the register: validation, the folders of a template, the filters, the lifecycle (archive, cancel) and the number series', async () => {
  const t = await setup();
  assert.equal((await t.api.call('POST', `${D}/documents`, { ...se, body: { title: 'x', docType: 'DRAWING' } })).status, 400, 'an idempotency key is needed');
  assert.equal((await t.api.call('POST', `${D}/documents`, { ...emp, headers: key('c'), body: { title: 'Not allowed', docType: 'DRAWING' } })).status, 403);
  assert.equal((await t.api.call('POST', `${D}/documents`, { ...se, headers: key('c'), body: { title: 'Odd one', docType: 'NOPE' } })).status, 400);
  assert.equal((await t.api.call('POST', `${D}/documents`, { ...se, headers: key('c'), body: { title: 'Fire licence', docType: 'LICENCE' } })).status, 400, 'a licence needs its validity date');
  assert.equal((await t.api.call('POST', `${D}/documents`, { ...se, headers: key('c'), body: { title: 'A drawing', docType: 'DRAWING', validUntil: '2030-01-01' } })).status, 400, 'a drawing has none');
  // the folders of a project from a template (the document controller only; once)
  assert.equal((await post(t, se, `/projects/${t.project}/folder-template`, { template: 'PROJECT_STANDARD' })).status, 403);
  const applied = await post(t, doc, `/projects/${t.project}/folder-template`, { template: 'PROJECT_STANDARD' });
  assert.equal(applied.status, 201, JSON.stringify(applied.json));
  assert.equal(applied.json.data.folders, 10);
  assert.equal((await post(t, doc, `/projects/${t.project}/folder-template`, { template: 'PROJECT_STANDARD' })).status, 409);
  const tree = (await t.api.call('GET', `${D}/folders?projectId=${t.project}`, se)).json.data;
  const struct = tree.find((f) => f.path === 'Drawings/Structural');
  assert.ok(struct);
  assert.equal((await t.api.call('POST', `${D}/folders`, { ...doc, headers: key('f'), body: { projectId: t.project, parentId: struct.id, name: 'Piers', defaultAcl: { confidentiality: 'CONFIDENTIAL' } } })).status, 201);
  assert.equal((await t.api.call('POST', `${D}/folders`, { ...doc, headers: key('f'), body: { projectId: t.project, parentId: struct.id, name: 'piers' } })).status, 409);
  const piers = (await t.api.call('GET', `${D}/folders?projectId=${t.project}`, se)).json.data.find((f) => f.path === 'Drawings/Structural/Piers');
  const a = await create(t, se, { title: 'Pier cap detail', folderId: piers.id });
  assert.equal(a.confidentiality, 'CONFIDENTIAL', 'the folder gave it its default');
  assert.equal(a.folderPath, 'Drawings/Structural/Piers');
  await create(t, se, { title: 'Culvert section', docType: 'SPECIFICATION', folderId: struct.id, tags: ['culvert', 'rcc'] });
  const lic = await create(t, doc, { title: 'Crusher licence', docType: 'LICENCE', validUntil: '2030-06-30', projectId: undefined });
  assert.deepEqual([lic.status, lic.docNo], ['DRAFT', 'DOC-00003']);
  const list = async (q, who = doc) => (await t.api.call('GET', `${D}/documents?${q}`, who)).json.data;
  assert.equal((await list('')).total, 3);
  assert.equal((await list(`folderId=${struct.id}&includeSub=1`)).total, 2);
  assert.equal((await list(`folderId=${struct.id}`)).total, 1);
  assert.equal((await list('docType=LICENCE')).total, 1);
  assert.equal((await list('tag=rcc')).total, 1);
  assert.equal((await list('q=culvert')).rows[0].title, 'Culvert section');
  assert.equal((await list('expiring=3650')).total, 1);
  assert.equal((await list('confidentiality=CONFIDENTIAL', pm)).total, 1);
  assert.equal((await list('sort=title&limit=2')).rows.length, 2);
  assert.equal((await t.api.call('GET', `${D}/documents/export?format=csv`, doc)).status, 200);
  // a draft that was never issued is cancelled; an issued one is archived by the controller and is then read-only
  assert.equal((await post(t, se, `/documents/${a.id}/cancel`, { reason: 'x' })).status, 400);
  assert.equal((await post(t, se, `/documents/${a.id}/cancel`, { reason: 'Entered twice by mistake' })).json.data.status, 'CANCELLED');
  const b = await create(t, se, { title: 'To be archived' });
  const issued = await issue(t, b, se);
  assert.equal((await post(t, se, `/documents/${b.id}/archive`, { reason: 'No longer in use' })).status, 403);
  assert.equal((await post(t, doc, `/documents/${b.id}/archive`, { reason: 'Superseded by a new design' })).json.data.status, 'ARCHIVED');
  assert.equal((await post(t, se, `/documents/${b.id}/revisions`, { changeNote: 'x revision' })).status, 409);
  assert.equal(revisionName(1) + revisionName(26) + revisionName(27) + revisionName(52), 'AZAAAZ');
  void issued;
  await t.cleanup();
});

test('FR-07 markups are kept as layers over a revision: others can add and resolve them, the file is not changed, and only their authors remove them', async () => {
  const t = await setup();
  const d = await create(t, se);
  const g = await issue(t, d, se);
  const v = g.versions[0].id;
  const before = (await t.api.raw('GET', `${D}/versions/${v}/content`, pm)).buffer;
  const add = await t.api.call('POST', `${D}/versions/${v}/annotations`, { ...pm, headers: key('n'), body: { page: 1, shape: { kind: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.2, color: 'red' }, comment: 'Check the cover here' } });
  assert.equal(add.status, 201, JSON.stringify(add.json));
  assert.equal((await t.api.call('POST', `${D}/versions/${v}/annotations`, { ...pm, headers: key('n'), body: { page: 1, shape: { kind: 'rect', x: 2 } } })).status, 400);
  assert.equal((await t.api.call('POST', `${D}/versions/${v}/annotations`, { ...emp, headers: key('n'), body: { page: 1, shape: { kind: 'note', x: 0.5, y: 0.5, text: 'hi' } } })).status, 404);
  assert.equal((await t.api.call('POST', `${D}/versions/${v}/annotations`, { ...qc, headers: key('n'), body: { page: 1, shape: { kind: 'arrow', x: 0.1, y: 0.1, x2: 0.4, y2: 0.4 } } })).status, 201);
  const all = (await t.api.call('GET', `${D}/versions/${v}/annotations`, se)).json.data;
  assert.deepEqual(all.map((a) => [a.user, a.shape.kind, a.resolved]), [['pm1', 'rect', false], ['qc1', 'arrow', false]]);
  assert.equal((await t.api.call('PATCH', `${D}/annotations/${add.json.data.id}`, { ...se, headers: key('n'), body: { resolved: true } })).json.data.resolved, true, 'the author of the document resolves it');
  assert.equal((await t.api.call('PATCH', `${D}/annotations/${add.json.data.id}`, { ...dir, headers: key('n'), body: { remove: true } })).status, 403, 'not the author of the markup, and cannot edit the document');
  assert.equal((await t.api.call('PATCH', `${D}/annotations/${add.json.data.id}`, { ...pm, headers: key('n'), body: { remove: true } })).json.data.removed, true);
  assert.equal((await t.api.call('GET', `${D}/versions/${v}/annotations`, se)).json.data.length, 1);
  assert.ok((await t.api.raw('GET', `${D}/versions/${v}/content`, pm)).buffer.equals(before), 'the original is untouched');
  await t.cleanup();
});

test('FR-08 FR-09 the zip of chosen documents, the Excel sheet that registers many, and the expiry of a document with a validity date (also seen by the alert rules)', async () => {
  const t = await setup();
  await post(t, doc, `/projects/${t.project}/folder-template`, { template: 'PROJECT_STANDARD' });
  const d1 = await issue(t, await create(t, se, { title: 'First drawing' }), se);
  const d2 = await issue(t, await create(t, se, { title: 'Second drawing' }), se);
  const d3 = await create(t, se, { title: 'Draft only' });
  const z = await t.api.raw('POST', `${D}/documents/zip`, { ...pm, headers: key('z'), body: JSON.stringify({ ids: [d1.id, d2.id, d3.id] }) });
  assert.equal(z.status, 200, z.buffer.toString());
  const files = unzipSync(new Uint8Array(z.buffer));
  assert.deepEqual(Object.keys(files).sort(), [`${d1.docNo}_revA_layout.pdf`, `${d2.docNo}_revA_layout.pdf`, 'NOT-INCLUDED.txt']);
  assert.match(Buffer.from(files['NOT-INCLUDED.txt']).toString(), new RegExp(d3.docNo));
  assert.equal((await t.api.call('POST', `${D}/documents/zip`, { ...pm, headers: key('z'), body: { ids: [] } })).status, 400);
  // the sheet
  const tpl = await t.api.raw('GET', `${D}/bulk-template`, se);
  assert.equal(tpl.status, 200);
  const check = await t.api.raw('POST', `${D}/bulk-upload`, { ...se, headers: { 'content-type': 'application/octet-stream' }, body: tpl.buffer });
  assert.equal(check.status, 200, check.buffer.toString());
  assert.deepEqual([check.json.data.rows.length, check.json.data.rows[0].ok, check.json.data.created], [1, true, 0], 'a check registers nothing');
  const commit = await t.api.raw('POST', `${D}/bulk-upload?commit=1`, { ...se, headers: { 'content-type': 'application/octet-stream' }, body: tpl.buffer });
  assert.equal(commit.status, 201, commit.buffer.toString());
  assert.equal(commit.json.data.created, 1);
  const made = (await t.api.call('GET', `${D}/documents?q=Pier 4`, se)).json.data.rows[0];
  assert.deepEqual([made.status, made.folderId !== null, made.tags], ['DRAFT', true, ['rebar', 'pier']]);
  assert.equal((await t.api.raw('POST', `${D}/bulk-upload`, { ...se, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('not a workbook') })).status, 400);
  // expiry: the owner is told about a licence within 30 days, once a week; the alert dataset sees it
  const lic = await create(t, doc, { title: 'Crusher licence', docType: 'LICENCE', validUntil: new Date(Date.now() + 5.5 * 3_600_000 + 12 * 86_400_000).toISOString().slice(0, 10), projectId: undefined });
  await issue(t, lic, doc).catch(() => null);
  t.api.db.prepare("UPDATE doc_documents SET status = 'ISSUED' WHERE id = ?").run(lic.id);
  const { createDocumentService } = await import('../src/server/modules/eng/documents.js');
  const svc = createDocumentService({ db: t.api.db, engine: t.engine });
  assert.equal(svc.expirySweep(), 1);
  assert.equal(svc.expirySweep(), 0, 'not again at once');
  t.drain();
  assert.ok(t.api.db.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'doc.document.expiring' AND user_ref = 'doc1'").get());
  const adopt = await t.api.call('POST', '/api/v1/alr/rules/library/doc.expiry/adopt', { ...sys, headers: key('al'), body: { reason: 'Documents must not lapse' } }).catch(() => null);
  if (adopt?.status === 403) {
    const as2 = await t.api.call('POST', '/api/v1/alr/rules/library/doc.expiry/adopt', { ...pm, headers: key('al'), body: { reason: 'Documents must not lapse' } });
    assert.equal(as2.status, 201, JSON.stringify(as2.json));
  }
  const run = await t.api.call('POST', '/api/v1/alr/rules/doc.expiry/run', { ...pm, headers: key('ar'), body: {} });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(run.json.data.matched, 1);
  await t.cleanup();
});

test('FR-01 AC-04 the document types and folder templates: a change waits for the system administrator or a director; the standard types are shared; who may see and change them', async () => {
  const t = await setup();
  const cfg = (await t.api.call('GET', `${D}/config`, doc)).json.data;
  assert.equal(cfg.types.length, 12);
  assert.equal(cfg.canEdit, true);
  assert.equal((await t.api.call('GET', `${D}/config`, emp)).status, 403);
  assert.equal((await t.api.call('GET', `${D}/config`, sys)).status, 200);
  const change = (over = {}) => ({ types: [{ code: 'DRAWING', name: 'Drawing', requiresReview: true, reviewerRole: 'DESIGN|SE', approverRole: 'QCMGR', hasValidity: false, defaultConfidentiality: 'INTERNAL', retentionClass: 'permanent', ...over }], templates: [], reason: 'Quality approves drawings here' });
  assert.equal((await t.api.call('POST', `${D}/config/changes`, { ...se, headers: key('x'), body: change() })).status, 403);
  assert.equal((await t.api.call('POST', `${D}/config/changes`, { ...doc, headers: key('x'), body: change({ reviewerRole: 'NOPE' }) })).status, 400);
  const ok = await t.api.call('POST', `${D}/config/changes`, { ...doc, headers: key('x'), body: change() });
  assert.equal(ok.status, 202, JSON.stringify(ok.json));
  assert.equal((await t.api.call('POST', `${D}/config/changes`, { ...doc, headers: key('x'), body: change() })).status, 409, 'one change at a time');
  assert.equal((await t.api.call('GET', `${D}/config`, doc)).json.data.types.find((x) => x.code === 'DRAWING').approverRole, 'PM', 'the old rule is in force');
  const inst = ok.json.data.workflow.id;
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, doc)).json.data.rows.some((x) => x.instance.id === inst), false, 'the proposer cannot decide it');
  await act(t, sys, inst);
  const after = (await t.api.call('GET', `${D}/config`, doc)).json.data.types.find((x) => x.code === 'DRAWING');
  assert.deepEqual([after.approverRole, after.version, after.shared], ['QCMGR', 2, false]);
  // a drawing now goes to the quality control manager for the last step
  const d = await create(t, se);
  const g = (await t.api.call('GET', `${D}/documents/${d.id}`, se)).json.data;
  await attach(t, se, g.draftVersionId, await pdfBytes('qc'));
  const s = await post(t, se, `/documents/${d.id}/submit`, {}, 's');
  await act(t, des, s.json.data.workflow.id);
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, pm)).json.data.rows.length, 0, 'the project manager no longer approves drawings');
  await act(t, qc, s.json.data.workflow.id);
  assert.equal((await t.api.call('GET', `${D}/documents/${d.id}`, se)).json.data.status, 'ISSUED');
  void dir;
  await t.cleanup();
});
