import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.01 FR-07, AC-02: a legacy approval (the wording requests of part 03.09) is decided by the workflow engine behind its own flag, and every outcome
// is the one the legacy code gives: the same answers, the same status and steps on the request, the same change in force.
const U = '/api/v1/ui';
const CR = '/api/v1/core/change-requests';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `ad-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company) => ({ roles, user, company });
const FLAG = 'ff.eng.p0401.legacy.ui_translation_change';

/** One run of the same story in one company; returns everything an observer could see. */
async function story(api, company) {
  const sys = as('SYSADM', 'sys1', company);
  const sys2 = as('SYSADM', 'sys2', company);
  const pm = as('PM', 'pm1', company);
  const trace = [];
  const log = (label, value) => trace.push([label, value]);
  const propose = (text) => api.call('POST', `${U}/translations/changes`, { ...sys, headers: key('p'), body: { changes: [{ namespace: 'field', key: 'title', lang: 'hi', text }], reason: 'clearer for the site team' } });
  const act = (who, id, action, comment = 'checked and fine') => api.call('POST', `${CR}/${id}/act`, { ...who, headers: key('a'), body: { action, comment } });
  const state = async (id) => { const r = (await api.call('GET', `${CR}/${id}`, sys)).json.data; return { status: r.status, step: r.currentStep, steps: r.steps.map((s) => [s.stepNo, s.role, s.decision, s.decidedBy, s.comment]) }; };
  const shown = async () => (await api.call('GET', `${U}/translations/hi/field`, pm)).json.data.strings.title;

  // 1. approve: the requester, a person without the role and a stale view are refused; a second administrator approves
  let r = await propose('साइट होम');
  log('propose', r.status);
  const id1 = r.json.data.id;
  log('self', (await act(sys, id1, 'approve')).status);
  log('self code', (await act(sys, id1, 'approve')).json.error.code);
  log('wrong role', (await act(pm, id1, 'approve')).status);
  log('stale', (await api.call('POST', `${CR}/${id1}/act`, { ...sys2, headers: key('a'), body: { action: 'approve', comment: 'ok', version: 99 } })).status);
  log('no comment on return', (await act(sys2, id1, 'return', '')).status);
  const done = await act(sys2, id1, 'approve');
  log('approve', done.status);
  log('after approve', await state(id1));
  log('in force', await shown());
  log('decided twice', (await act(sys2, id1, 'approve')).status);
  // 2. reject
  r = await propose('अलग शीर्षक');
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const id2 = r.json.data.id;
  log('reject', (await act(sys2, id2, 'reject', 'we keep the first wording')).status);
  log('after reject', await state(id2));
  log('still', await shown());
  // 3. return, resubmit, approve
  r = await propose('नया शीर्षक');
  const id3 = r.json.data.id;
  log('return', (await act(sys2, id3, 'return', 'please add the reason again')).status);
  log('after return', await state(id3));
  log('resubmit by someone else', (await api.call('POST', `${CR}/${id3}/resubmit`, { ...sys2, headers: key('r'), body: { reason: 'revised wording and reason' } })).status);
  log('resubmit', (await api.call('POST', `${CR}/${id3}/resubmit`, { ...sys, headers: key('r'), body: { reason: 'revised wording and reason' } })).status);
  log('after resubmit', await state(id3));
  log('approve resubmitted', (await act(sys2, id3, 'approve')).status);
  log('after approve 3', await state(id3));
  log('in force 3', await shown());
  // 4. withdraw
  r = await propose('वापस लिया');
  const id4 = r.json.data.id;
  log('withdraw by another', (await api.call('POST', `${CR}/${id4}/withdraw`, { ...sys2, headers: key('w'), body: {} })).status);
  log('withdraw', (await api.call('POST', `${CR}/${id4}/withdraw`, { ...sys, headers: key('w'), body: {} })).status);
  log('after withdraw', await state(id4));
  log('act on withdrawn', (await act(sys2, id4, 'approve')).status);
  return { trace, ids: [id1, id2, id3, id4] };
}

test('AC-02 FR-07 the translation requests decided by the workflow engine end exactly as they do under the legacy code', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  const made = await api.call('POST', '/api/v1/iam/org/companies', { ...as('SYSADM', 'sys1', '1'), headers: key('c'), body: { code: 'TWO', legalName: 'Two Infra Pvt Ltd', shortName: 'TWO' } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.data.id, 2);
  await setupCompany(api, { company: '2' });
  // company 2 stays on the legacy code
  api.db.prepare("INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, enabled, created_by, source_type) VALUES (?, 'test', 0, NULL, 2, 0, 'test', 'test')").run(FLAG);
  const viaEngine = await story(api, '1');
  const viaLegacy = await story(api, '2');
  assert.deepEqual(viaEngine.trace.map(([l, v]) => [l, JSON.stringify(v).replace(/\bsys[12]\b/g, 'sys')]), viaLegacy.trace.map(([l, v]) => [l, JSON.stringify(v).replace(/\bsys[12]\b/g, 'sys')]));
  // the engine really decided in company 1, and the legacy code in company 2
  const count = (company) => api.db.prepare("SELECT COUNT(*) AS n FROM wf_instances WHERE company_id = ? AND doc_type = 'LEGACY_UI_TRANSLATION_CHANGE'").get(company).n;
  assert.equal(count(1), 4);
  assert.equal(count(2), 0);
  const inst = api.db.prepare("SELECT * FROM wf_instances WHERE company_id = 1 AND doc_id = ?").get(String(viaEngine.ids[2]));
  assert.equal(inst.cycle, 2, 'the returned request went round again in the same instance');
  assert.deepEqual(api.db.prepare('SELECT status FROM wf_instances WHERE company_id = 1 ORDER BY id').all().map((r) => r.status), ['APPROVED', 'REJECTED', 'APPROVED', 'WITHDRAWN']);
  // its history is in the engine, and the audit trail has the engine's entries as well as the request's
  const events = api.db.prepare('SELECT event FROM wf_history WHERE instance_id = ? ORDER BY id').all(inst.id).map((h) => h.event);
  assert.ok(['SUBMITTED', 'RETURNED', 'RESUBMITTED', 'APPROVED', 'COMPLETED'].every((e) => events.includes(e)), events.join());
  await api.close();
});

test('FR-07 a request raised before its type moved onto the engine is carried on from the step it is at', async () => {
  const api = await startApi();
  await setupCompany(api, { company: '1' });
  api.db.prepare("INSERT INTO core_feature_flags (key, description, default_enabled, environment, company_id, enabled, created_by, source_type) VALUES (?, 'test', 0, NULL, 1, 0, 'test', 'test')").run(FLAG);
  const sys = as('SYSADM', 'sys1', '1');
  const sys2 = as('SYSADM', 'sys2', '1');
  const r = await api.call('POST', `${U}/translations/changes`, { ...sys, headers: key('p'), body: { changes: [{ namespace: 'field', key: 'title', lang: 'hi', text: 'पुराना अनुरोध' }], reason: 'raised before the engine' } });
  assert.equal(r.status, 201);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM wf_instances').get().n, 0);
  // the flag is turned on: the next decision is the engine's, begun at the step the request is at
  api.db.prepare('UPDATE core_feature_flags SET enabled = 1 WHERE key = ? AND company_id = 1').run(FLAG);
  const done = await api.call('POST', `${CR}/${r.json.data.id}/act`, { ...sys2, headers: key('a'), body: { action: 'approve', comment: 'carried on' } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.status, 'APPROVED');
  assert.equal(api.db.prepare("SELECT status FROM wf_instances WHERE doc_type = 'LEGACY_UI_TRANSLATION_CHANGE'").get().status, 'APPROVED');
  await api.close();
});
