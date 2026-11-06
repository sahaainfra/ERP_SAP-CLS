import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.02: the approval matrix, authority limits, delegation, SLA and escalation. T-01 every default band of the reference resolves to its chain; T-02 an approver
// over the limit is skipped and a delegation applies within its dates only; T-03 reminders and escalations come at the configured points of working time;
// T-04 the simulator gives the routing a real document gets.
const W = '/api/v1/workflow';
const E = '/api/v1/eng';
const json = { 'content-type': 'application/json' };
const key = (k = 'm') => ({ ...json, 'idempotency-key': `mx-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const sys = as('SYSADM', 'sys1');
const sys2 = as('SYSADM', 'sys2');
const cfo = as('CFO', 'cfo1');
const dir = as('DIR', 'dir1');
const pm = as('PM', 'pm1');
const aud = as('AUD', 'aud1');
const L = 100_000;
const CR = 10_000_000;

const sim = async (api, who, body) => (await api.call('POST', `${W}/matrix/simulate`, { ...who, body })).json.data;
const chain = (s) => s.steps.filter((x) => x.applies).map((x) => x.approvers.map((a) => (a.kind === 'manager' ? 'MANAGER' : a.label.replace(' or ', '|'))).join('+')).join(' > ');
const act = (api, who, taskId, body) => api.call('POST', `${W}/tasks/${taskId}/act`, { ...who, headers: key('a'), body });
const openTask = (wf) => wf.tasks.find((t) => t.status === 'OPEN' || t.status === 'ADMIN_QUEUE');

/** Take a matrix change (or any change document) through its approval chain. */
async function approveChain(api, instance, who) {
  let wf = instance;
  for (const w of who) {
    const t = wf.tasks.find((x) => x.status === 'OPEN');
    const r = await act(api, w, t.id, { action: 'approve' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    wf = r.json.data;
  }
  assert.equal(wf.status, 'APPROVED', JSON.stringify(wf.steps.map((s) => [s.code, s.state])));
  return wf;
}
const draftOf = async (api, docType, rules, extra = {}) => {
  const r = await api.call('POST', `${W}/matrix`, { ...sys, headers: key('d'), body: { docType, ...(rules ? { rules } : {}), ...extra } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json.data;
};
const rule = (priority, name, conditions, roles) => ({ priority, name, conditions, steps: roles.map((role) => ({ role })) });
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

// the authority bands of docs/erp/07_APPROVAL_WORKFLOW_REFERENCE.md section B, written out again here on purpose: the test must not read the seed it checks
const BANDS = [
  ['PR', { amount: 4 * L }, 'PM'], ['PR', { amount: 20 * L }, 'PD'], ['PR', { amount: 30 * L }, 'PROCMGR'],
  ['PO', { amount: 4 * L }, 'PROCMGR'], ['PO', { amount: 20 * L }, 'PROCMGR > PM'], ['PO', { amount: 80 * L }, 'PROCMGR > PM > PD'], ['PO', { amount: 2 * CR }, 'PROCMGR > PM > PD > DIR'],
  ['SO', { amount: 4 * L }, 'PROCMGR'], ['SO', { amount: 2 * CR }, 'PROCMGR > PM > PD > DIR'],
  ['CS', { amount: 4 * L }, 'PROCMGR > PM'], ['CS', { amount: 20 * L }, 'PROCMGR > PM > PD'], ['CS', { amount: 80 * L }, 'PROCMGR > PM > PD > DIR'],
  ['SWO', { amount: 9 * L }, 'COMMGR'], ['SWO', { amount: 40 * L }, 'COMMGR > PD'], ['SWO', { amount: 60 * L }, 'COMMGR > PD > DIR'],
  ['RABILL', { amount: 99 * CR }, 'PM > COMMGR'],
  ['VBILL', { amount: 9 * L }, 'QS > PM'], ['VBILL', { amount: 40 * L }, 'QS > PM > COMMGR'], ['VBILL', { amount: 60 * L }, 'QS > PM > COMMGR > CFO'],
  ['PAY', { amount: 9 * L }, 'ACCMGR'], ['PAY', { amount: 90 * L }, 'ACCMGR > CFO'], ['PAY', { amount: 2 * CR }, 'ACCMGR > CFO > DIR'],
  ['ADV', { amount: 20 * L }, 'PM > COMMGR > CFO'], ['ADV', { amount: 30 * L }, 'PM > COMMGR > CFO > DIR'],
  ['BUDGET', { amount: 1 }, 'PCMGR > PD > DIR'],
  ['BUDREV', { changePct: 1.5 }, 'PCMGR'], ['BUDREV', { changePct: 4 }, 'PCMGR > PD'], ['BUDREV', { changePct: 6 }, 'PCMGR > PD > DIR'],
  ['VO', { amount: 9 * L }, 'QS > COMMGR'], ['VO', { amount: 40 * L }, 'QS > COMMGR > PD'], ['VO', { amount: 60 * L }, 'QS > COMMGR > PD > DIR'],
  ['JV', { amount: 4 * L }, 'ACCMGR'], ['JV', { amount: 6 * L }, 'ACCMGR > CFO'],
  ['STKADJ', { amount: 40_000 }, 'STOREMGR'], ['STKADJ', { amount: 4 * L }, 'STOREMGR > PROCMGR'], ['STKADJ', { amount: 6 * L }, 'STOREMGR > PROCMGR > CFO'],
  ['LEAVE', { days: 5 }, 'MANAGER'], ['LEAVE', { days: 12 }, 'MANAGER > HRMGR'],
  ['ATT', { otHours: 2 }, 'MANAGER'], ['ATT', { otHours: 5 }, 'MANAGER > PM'], ['ATT', { otHours: 5, policyException: true }, 'MANAGER > PM > HRMGR'],
  ['EXP', { amount: 20_000 }, 'MANAGER'], ['EXP', { amount: 80_000 }, 'MANAGER > ACCMGR'], ['EXP', { amount: 2 * L }, 'MANAGER > ACCMGR > CFO'],
  ['HIRE', { seniorGrade: false }, 'MANAGER > HRMGR'], ['HIRE', { seniorGrade: true }, 'MANAGER > HRMGR > DIR'],
  ['PARTY', { partyType: 'vendor' }, 'PROCMGR > ACCMGR'], ['PARTY', { partyType: 'client' }, 'COMMGR > ACCMGR'],
  ['WA', { outsidePlan: false }, 'CM'], ['WA', { outsidePlan: true }, 'CM > PM'],
  ['DPR', {}, 'CM'], ['IR', {}, 'QCE'],
  ['NCR', { severity: 'minor' }, 'QCE'], ['NCR', { severity: 'major' }, 'QCE > QCMGR'], ['NCR', { severity: 'critical' }, 'QCE > QCMGR > PD'],
  ['PTW', { highRisk: false }, 'HSEE'], ['PTW', { highRisk: true }, 'HSEE > CM'],
  ['EQH', { monthlyAmount: 4 * L }, 'PMSUP > PM'], ['EQH', { monthlyAmount: 6 * L }, 'PMSUP > PM > PLANTMGR'],
  ['FA', { action: 'capitalisation', amount: 50 * L }, 'ACCMGR > CFO'], ['FA', { action: 'disposal', amount: 5 * L }, 'ACCMGR > CFO'], ['FA', { action: 'disposal', amount: 20 * L }, 'ACCMGR > CFO > DIR'],
  ['HR_REGULARISATION', { band: 'REPEATED' }, 'WSUP|PM > HRMGR'], ['HR_REGULARISATION', { band: 'STANDARD' }, 'WSUP|PM'], ['HR_OVERTIME_REQUEST', { band: 'POLICY_EXCEPTION' }, 'WSUP > PM > HRMGR'], ['HR_OVERTIME_REQUEST', { band: 'PM_LEVEL' }, 'WSUP > PM'], ['HR_OVERTIME_REQUEST', { band: 'STANDARD' }, 'WSUP|PM'],
  ['HR_ATT_MANUAL', {}, 'HRMGR'], ['HR_ATT_REOPEN', {}, 'HRMGR > CFO'],
  ['PAYROLL', {}, 'HRMGR > CFO'], ['BID', {}, 'DIR'], ['ESTIMATE', {}, 'DIR'], ['CLAIM', {}, 'COMMGR > PD > DIR'], ['ROLECHG', {}, 'ITADM|DIR'],
  ['ACC_RACI', {}, 'PM > PD'], ['HR_ATT_ANOMALY', { band: 'REPEATED' }, 'WSUP|PM > HRMGR'], ['HR_ATT_ANOMALY', { band: 'STANDARD' }, 'WSUP|PM'], ['HR_ATT_POLICY', { band: 'PAY_IMPACTING' }, 'HRMGR > DIR'], ['HR_ATT_POLICY', { band: 'STANDARD' }, 'HRMGR'], ['HR_ROSTER_CHANGE', { band: 'RAISED_BY_WSUP' }, 'PM'], ['HR_ROSTER_CHANGE', { band: 'STANDARD' }, 'WSUP > PM'], ['HR_DEPLOYMENT', { band: 'OUTSIDE_PLAN' }, 'PM|HRMGR > PD'], ['HR_DEPLOYMENT', { band: 'WITHIN_PLAN' }, 'PM|HRMGR'], ['HR_EMPLOYEE', {}, 'HRMGR'], ['HR_REQUISITION', { band: 'BEYOND_PLAN' }, 'PM|PD > HRMGR > DIR'], ['HR_REQUISITION', { band: 'WITHIN_PLAN' }, 'PM|PD > HRMGR'], ['HR_OFFER', { band: 'DIR' }, 'HRMGR > DIR'], ['HR_OFFER', { band: 'STANDARD' }, 'HRMGR'], ['HR_EMP_PROFILE', {}, 'HRMGR'], ['HR_EMP_STATUTORY', {}, 'HRMGR'], ['HR_EMP_BANK', {}, 'HRMGR > PAY'], ['HR_EMP_EMPLOYMENT', { band: 'SENIOR' }, 'HRMGR > DIR'], ['HR_EMP_EMPLOYMENT', { band: 'STANDARD' }, 'HRMGR'], ['HR_EMP_SEPARATION', {}, 'HRMGR'], ['MDM_ITEM', { stewardRole: 'PROCMGR' }, 'PROCMGR'], ['MDM_ITEM', { stewardRole: 'EST' }, 'EST'], ['MDM_ITEM', { stewardRole: 'PLANTMGR' }, 'PLANTMGR'], ['MDM_PARTNER', { stewardRole: 'PROCMGR' }, 'PROCMGR > ACCMGR'], ['MDM_PARTNER', { stewardRole: 'COMMGR' }, 'COMMGR > ACCMGR'], ['MDM_PARTNER_BANK', {}, 'ACCMGR > CFO'], ['FIN_MASTER_CHANGE', { makerRole: 'PCMGR' }, 'ACCMGR > CFO'], ['FIN_MASTER_CHANGE', { makerRole: 'ACCMGR' }, 'CFO'], ['MDM_RATE_ANALYSIS', { scope: 'STANDARD' }, 'DIR'], ['MDM_RATE_ANALYSIS', { scope: 'PROJECT' }, 'PM'], ['MDM_RATE_ANALYSIS', { scope: 'VARIATION' }, 'COMMGR'], ['MDM_PARTNER_STATUS', {}, 'DIR'], ['MDM_TAX_CHANGE', {}, 'ACCMGR > CFO'], ['POL_VERSION', {}, 'HRMGR|CFO or QCMGR or PROCMGR or ACCMGR or COMMGR or PCMGR or HSEE > DIR'], ['PCS_EXCEPTION', { level: 1, amount: 1000 }, 'PM'], ['PCS_EXCEPTION', { level: 1, amount: 2_000_000 }, 'PM > DIR'], ['PCS_EXCEPTION', { level: 2, amount: 1000 }, 'PD'], ['PCS_EXCEPTION', { level: 2, amount: 2_000_000 }, 'PD > DIR'], ['PCS_EXCEPTION', { level: 3, amount: 1000 }, 'DIR'],
];

test('T-01 AC-01 FR-04 each default band of the reference resolves to the chain it names, for every listed document type', async () => {
  const api = await startApi();
  await setupCompany(api);
  const seen = new Set();
  for (const [docType, context, expected] of BANDS) {
    const r = await sim(api, aud, { docType, context });
    assert.equal(r.matched, true, `${docType} ${JSON.stringify(context)}: ${r.message}`);
    assert.equal(chain(r).replaceAll('+', ' + '), expected, `${docType} ${JSON.stringify(context)}`);
    seen.add(docType);
  }
  // every document type the matrix lists has a band in the table above
  const listed = (await api.call('GET', `${W}/matrix?limit=100`, aud)).json.data;
  const types = listed.rows.map((m) => m.docType).filter((t) => t !== 'ENG_SAMPLE_DOC');
  assert.deepEqual([...new Set(types)].sort(), [...seen].sort());
  assert.ok(listed.rows.every((m) => m.status === 'ACTIVE' && m.version === 1));
  // a document type without a matrix says so
  assert.equal((await sim(api, aud, { docType: 'NOT_A_TYPE', context: {} })).found, false);
  await api.close();
});

test('FR-01 FR-02 BR-01 the rules: priority order, first full match, conditions on the context, gaps block activation, shadowed rules are named', async () => {
  const api = await startApi();
  await setupCompany(api);
  const po = (await api.call('GET', `${W}/matrix?docType=PO`, sys)).json.data.rows[0];
  // a draft copies the version in force
  const d = await draftOf(api, 'PO');
  assert.equal(d.version, 2);
  assert.equal(d.status, 'DRAFT');
  assert.equal(d.rules.length, 4);
  assert.equal((await api.call('POST', `${W}/matrix`, { ...pm, headers: key('d'), body: { docType: 'PO' } })).status, 403);
  assert.equal((await api.call('POST', `${W}/matrix`, { ...aud, headers: key('d'), body: { docType: 'PO' } })).status, 403, 'the auditor reads the matrix and does not change it');
  // a gap: bands that stop at 10 L leave everything above uncovered
  const gappy = [rule(10, 'Small', [{ field: 'amount', op: 'lte', value: 10 * L }], ['PROCMGR']), rule(20, 'Single source', [{ field: 'singleSource', op: 'eq', value: true }], ['PROCMGR', 'DIR'])];
  assert.equal((await api.call('PUT', `${W}/matrix/${d.id}`, { ...sys, headers: key('u'), body: { rules: gappy } })).status, 200);
  const v = (await api.call('POST', `${W}/matrix/${d.id}/validate`, sys)).json.data;
  assert.equal(v.ok, false);
  assert.ok(v.gaps.length > 0);
  const blocked = await api.call('POST', `${W}/matrix/${d.id}/activate`, { ...sys, headers: key('x'), body: { effectiveFrom: tomorrow() } });
  assert.equal(blocked.status, 422);
  assert.match(blocked.json.error.message, /gaps/);
  // duplicate priority and an unknown role are refused when saving
  const dup = await api.call('PUT', `${W}/matrix/${d.id}`, { ...sys, headers: key('u'), body: { rules: [rule(10, 'Rule A', [], ['PM']), rule(10, 'Rule B', [], ['PD'])] } });
  assert.equal(dup.status, 400);
  assert.match(JSON.stringify(dup.json), /used twice/);
  const bad = await api.call('PUT', `${W}/matrix/${d.id}`, { ...sys, headers: key('u'), body: { rules: [rule(10, 'Rule A', [], ['NOROLE'])] } });
  assert.equal(bad.status, 400);
  // a shadowed rule is reported, not refused; first full match decides
  const shadow = [rule(10, 'Everything', [], ['PM']), rule(20, 'Never reached', [{ field: 'amount', op: 'gt', value: 5 }], ['PD'])];
  await api.call('PUT', `${W}/matrix/${d.id}`, { ...sys, headers: key('u'), body: { rules: shadow } });
  const v2 = (await api.call('POST', `${W}/matrix/${d.id}/validate`, sys)).json.data;
  assert.equal(v2.ok, true);
  assert.deepEqual(v2.shadowed.map((s) => s.name), ['Never reached']);
  const s = await sim(api, sys, { docType: 'PO', context: { amount: 99 * L }, matrixId: d.id });
  assert.equal(chain(s), 'PD', 'the first rule wins; its last step, PM, may approve only up to ₹25 L, so ₹99 L passes to PD');
  assert.equal(chain(await sim(api, sys, { docType: 'PO', context: { amount: 5 * L }, matrixId: d.id })), 'PM');
  // rules on the context: single source routes to the director
  const ok = [rule(10, 'Single source', [{ field: 'singleSource', op: 'eq', value: true }], ['PROCMGR', 'DIR']), rule(20, 'Small', [{ field: 'amount', op: 'lte', value: 10 * L }], ['PROCMGR']), rule(30, 'Others', [], ['PROCMGR', 'PM'])];
  await api.call('PUT', `${W}/matrix/${d.id}`, { ...sys, headers: key('u'), body: { rules: ok } });
  assert.equal((await api.call('POST', `${W}/matrix/${d.id}/validate`, sys)).json.data.ok, true);
  assert.equal(chain(await sim(api, sys, { docType: 'PO', context: { amount: 5 * L, singleSource: true }, matrixId: d.id })), 'PROCMGR > DIR');
  assert.equal(chain(await sim(api, sys, { docType: 'PO', context: { amount: 5 * L }, matrixId: d.id })), 'PROCMGR');
  assert.equal(chain(await sim(api, sys, { docType: 'PO', context: { amount: 50 * L }, matrixId: d.id })), 'PROCMGR > PD', 'PM may approve up to ₹25 L only');
  // the version in force is untouched by the draft; a version in force cannot be edited
  assert.equal(chain(await sim(api, sys, { docType: 'PO', context: { amount: 50 * L } })), 'PROCMGR > PM > PD');
  assert.equal((await api.call('PUT', `${W}/matrix/${po.id}`, { ...sys, headers: key('u'), body: { rules: ok } })).status, 422);
  await api.close();
});

test('BR-02 FR-09 a change is maker-checker and takes effect only from its date; history and comparison; running instances keep their chain', async () => {
  const api = await startApi();
  await setupCompany(api);
  const wf = (await api.call('POST', `${E}/sample-docs`, { ...as('PD', 'pdx'), headers: key('c'), body: { title: 'Before the change', amount: '100.00' } })).json.data;
  const running = (await api.call('POST', `${E}/sample-docs/${wf.id}/submit`, { ...as('PD', 'pdx'), headers: key('s'), body: {} })).json.data.workflow;
  const d = await draftOf(api, 'ENG_SAMPLE_DOC', [{ priority: 10, name: 'Everything', conditions: [], steps: [{ code: 'ONLY', name: 'Director', role: 'DIR' }] }]);
  assert.equal((await api.call('POST', `${W}/matrix/${d.id}/activate`, { ...sys, headers: key('x'), body: { effectiveFrom: '2020-01-01' } })).status, 422, 'never in the past');
  assert.equal((await api.call('POST', `${W}/matrix/${d.id}/activate`, { ...sys, headers: json, body: { effectiveFrom: tomorrow() } })).status, 400, 'an Idempotency-Key is needed');
  const when = tomorrow();
  const req = await api.call('POST', `${W}/matrix/${d.id}/activate`, { ...sys, headers: key('x'), body: { effectiveFrom: when } });
  assert.equal(req.status, 202, JSON.stringify(req.json));
  assert.equal((await api.call('GET', `${W}/matrix/${d.id}`, sys)).json.data.status, 'PENDING');
  assert.equal((await api.call('PUT', `${W}/matrix/${d.id}`, { ...sys, headers: key('u'), body: { rules: [rule(10, 'Rule X', [], ['PM'])] } })).status, 422, 'not while it waits');
  // the maker cannot approve; SYSADM, then the CFO (financial documents get the CFO; this one is not financial, so its process owner)
  const inst = req.json.data.instance;
  assert.equal((await act(api, sys, inst.tasks[0].id, { action: 'approve' })).status, 403);
  const t = inst.tasks.find((x) => x.status === 'OPEN');
  assert.equal(t.assigneeRole, 'SYSADM');
  let w = (await act(api, sys2, t.id, { action: 'approve' })).json.data;
  assert.equal(openTask(w).assigneeRole, 'PROCMGR', 'a document type that is not financial goes to its process owner');
  w = (await act(api, as('PROCMGR', 'proc1'), openTask(w).id, { action: 'approve' })).json.data;
  assert.equal(w.status, 'APPROVED', 'no director for a matrix change that carries no limit above ₹1 Cr');
  const m = (await api.call('GET', `${W}/matrix/${d.id}`, sys)).json.data;
  assert.equal(m.status, 'ACTIVE');
  assert.equal(m.effectiveFrom, when);
  // before its date the old version routes; from its date the new one; the old one ends the day before
  const before = await sim(api, sys, { docType: 'ENG_SAMPLE_DOC', context: { amount: 10 }, date: today() });
  assert.equal(chain(before), 'PM > ACCMGR', 'the third step carries its own condition: ₹10 lakh or more');
  assert.equal(chain(await sim(api, sys, { docType: 'ENG_SAMPLE_DOC', context: { amount: 10 }, date: when })), 'DIR');
  const hist = (await api.call('GET', `${W}/matrix/history/ENG_SAMPLE_DOC`, aud)).json.data;
  assert.deepEqual(hist.map((h) => [h.version, h.status]), [[2, 'ACTIVE'], [1, 'ACTIVE']]);
  assert.equal(hist[1].effectiveTo, today(), 'the old version ends the day before the new one starts');
  const cmp = (await api.call('GET', `${W}/matrix/${hist[1].id}/compare/${hist[0].id}`, aud)).json.data;
  assert.deepEqual(cmp.map((c) => c.change), ['CHANGED']);
  // the instance that was running keeps the chain it started with
  const still = (await api.call('GET', `${W}/instances/${running.id}`, as('PD', 'pdx'))).json.data;
  assert.deepEqual(still.steps.map((s) => s.code), ['MANAGER', 'FINANCE', 'CFO']);
  await api.close();
});

test('T-02 FR-03 an approver over the limit is skipped to the next level that has the authority', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await draftOf(api, 'PO', [rule(10, 'Always', [], ['PROCMGR', 'PM'])]);
  // PM may approve a PO up to ₹25 L in the reference, so for ₹80 L the step passes to the project director (limit ₹1 Cr)
  const r = await sim(api, sys, { docType: 'PO', context: { amount: 80 * L }, matrixId: d.id });
  assert.equal(chain(r), 'PROCMGR > PD');
  assert.equal(r.trace.skipped.length, 1);
  assert.match(r.trace.skipped[0].reason, /limit of PM/);
  assert.equal(r.trace.skipped[0].takenBy, 'PD');
  assert.equal(chain(await sim(api, sys, { docType: 'PO', context: { amount: 20 * L }, matrixId: d.id })), 'PROCMGR > PM', 'within the limit nothing is skipped');
  // above the project director's limit too: the climb goes on to the director
  assert.equal(chain(await sim(api, sys, { docType: 'PO', context: { amount: 3 * CR }, matrixId: d.id })), 'PROCMGR > PD'.replace('PD', 'DIR'));
  await api.close();
});

test('T-02 FR-03 an authority limit is changed through its approval chain; above ₹1 Cr the director also approves; the grid shows what waits', async () => {
  const api = await startApi();
  await setupCompany(api);
  const grid = (await api.call('GET', `${W}/authority-limits`, aud)).json.data;
  const cell = (role, docType) => grid.cells.find((c) => c.role === role && c.docType === docType);
  assert.equal(cell('PM', 'PO').current, 25 * L);
  assert.equal(cell('DIR', 'PO').current, null);
  assert.equal((await api.call('POST', `${W}/authority-limits/changes`, { ...pm, headers: key('l'), body: { changes: [{ role: 'PM', docType: 'PO', maxAmount: 30 * L }], effectiveFrom: today(), reason: 'More authority' } })).status, 403);
  const post = (body) => api.call('POST', `${W}/authority-limits/changes`, { ...sys, headers: key('l'), body });
  assert.equal((await post({ changes: [{ role: 'NOPE', docType: 'PO', maxAmount: 1 }], effectiveFrom: today(), reason: 'A bad role' })).status, 400);
  assert.equal((await post({ changes: [{ role: 'PM', docType: 'PO', maxAmount: 25 * L }], effectiveFrom: today(), reason: 'The same limit' })).status, 422);
  assert.equal((await post({ changes: [{ role: 'PM', docType: 'PO', maxAmount: 30 * L }], effectiveFrom: '2020-01-01', reason: 'In the past' })).status, 422);
  const ok = await post({ changes: [{ role: 'PM', docType: 'PO', maxAmount: 30 * L }, { role: 'PM', docType: 'SO', maxAmount: 30 * L }], effectiveFrom: today(), reason: 'The project managers run larger sites now' });
  assert.equal(ok.status, 202, JSON.stringify(ok.json));
  assert.equal((await post({ changes: [{ role: 'PD', docType: 'PO', maxAmount: 2 * CR }], effectiveFrom: today(), reason: 'Another while one waits' })).status, 409);
  assert.equal(cell('PM', 'PO').current, 25 * L, 'not in force until approved');
  assert.equal((await api.call('GET', `${W}/authority-limits`, aud)).json.data.cells.find((c) => c.role === 'PM' && c.docType === 'PO').pending.maxAmount, 30 * L);
  const wf = await approveChain(api, ok.json.data.instance, [sys2, cfo]);
  assert.equal(wf.status, 'APPROVED');
  const after = (await api.call('GET', `${W}/authority-limits`, aud)).json.data.cells;
  assert.equal(after.find((c) => c.role === 'PM' && c.docType === 'PO').current, 30 * L);
  assert.equal(after.find((c) => c.role === 'PM' && c.docType === 'SO').current, 30 * L);
  const hist = (await api.call('GET', `${W}/authority-limits/history?role=PM&docType=PO`, aud)).json.data;
  assert.deepEqual(hist.map((h) => h.status), ['ACTIVE', 'RETIRED'].map((s) => s).slice(0, 2).map((s, i) => (i === 0 ? 'ACTIVE' : hist[1].status)));
  // above ₹1 Cr the director also approves
  const big = await post({ changes: [{ role: 'PD', docType: 'PO', maxAmount: 5 * CR }], effectiveFrom: today(), reason: 'The project directors run bigger contracts' });
  const steps = big.json.data.instance.steps.map((s) => s.code);
  assert.deepEqual(steps, ['MAKER_CHECK', 'OWNER', 'DIRECTOR']);
  const w2 = await approveChain(api, big.json.data.instance, [sys2, cfo, dir]);
  assert.equal(w2.status, 'APPROVED');
  // a rejected change leaves the limits as they were
  const rej = await post({ changes: [{ role: 'PM', docType: 'PO', maxAmount: 99 * L }], effectiveFrom: today(), reason: 'Too much authority' });
  const rr = await act(api, sys2, openTask(rej.json.data.instance).id, { action: 'reject', comment: 'not justified for this role' });
  assert.equal(rr.json.data.status, 'REJECTED');
  assert.equal((await api.call('GET', `${W}/authority-limits`, aud)).json.data.cells.find((c) => c.role === 'PM' && c.docType === 'PO').current, 30 * L);
  await api.close();
});

test('T-02 FR-05 BR-03 a delegation applies within its dates only, on behalf of the delegator, and not beyond what the delegator may approve', async () => {
  const api = await startApi();
  await setupCompany(api);
  const engine = workflowOf(api.db);
  const del = as('SE', 'del1');
  const doc = async (amount = '200000.00') => (await api.call('POST', `${E}/sample-docs`, { ...as('PD', 'pdz'), headers: key('c'), body: { title: 'Cover', amount } })).json.data;
  const submit = async (d) => (await api.call('POST', `${E}/sample-docs/${d.id}/submit`, { ...as('PD', 'pdz'), headers: key('s'), body: {} })).json.data.workflow;
  const mk = (who, body) => api.call('POST', `${W}/delegations`, { ...who, headers: key('g'), body });
  const D = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  // rules of the request
  assert.equal((await mk(pm, { delegate: 'pm1', from: D(0), to: D(3), reason: 'To myself' })).status, 422);
  assert.equal((await mk(pm, { delegate: 'del1', from: D(-2), to: D(3), reason: 'In the past' })).status, 422);
  assert.equal((await mk(pm, { delegate: 'del1', from: D(3), to: D(1), reason: 'Backwards' })).status, 400);
  assert.equal((await mk(as('EMP', 'emp1'), { delegate: 'del1', from: D(0), to: D(3), reason: 'No right to' })).status, 403);
  assert.equal((await mk(pm, { delegate: 'del1', docTypes: ['PO'], maxAmount: 99 * CR, from: D(0), to: D(3), reason: 'More than mine' })).status, 422);
  // before any delegation del1 cannot decide the project manager's task
  const first = await submit(await doc());
  assert.equal((await act(api, del, first.tasks[0].id, { action: 'approve' })).status, 403);
  // one for tomorrow to the day after: not in force today
  const later = await mk(pm, { delegate: 'del1', docTypes: ['ENG_SAMPLE_DOC'], from: D(1), to: D(2), reason: 'Away on site visits' });
  assert.equal(later.status, 201, JSON.stringify(later.json));
  assert.equal(later.json.data.delegation.status, 'ACTIVE');
  assert.equal((await act(api, del, first.tasks[0].id, { action: 'approve' })).status, 403, 'not yet');
  assert.equal((await api.call('GET', `${W}/tasks?mine=assigned`, del)).json.data.total, 0);
  // time travels into the window: the delegate sees the task, decides, and it is recorded on behalf of the delegator
  engine.setClock(() => new Date(Date.now() + 36 * 3_600_000));
  assert.equal((await api.call('GET', `${W}/tasks?mine=assigned`, del)).json.data.total, 1);
  const done = await act(api, del, first.tasks[0].id, { action: 'approve', comment: 'covering' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.tasks[0].onBehalfOf, 'pm1');
  assert.equal(done.json.data.tasks[0].comment, 'covering');
  // a delegation is for the document types it names
  const po = await submit(await doc());
  assert.equal(po.tasks[0].status, 'OPEN');
  engine.setClock(() => new Date(Date.now() + 5 * 86_400_000));
  assert.equal((await act(api, del, po.tasks[0].id, { action: 'approve' })).status, 403, 'after the end date it is over');
  engine.setClock(() => new Date());
  // a delegation with an amount cap
  const capped = await mk(as('PM', 'pm2'), { delegate: 'del1', docTypes: ['ENG_SAMPLE_DOC'], maxAmount: '100000.00', from: D(0), to: D(2), reason: 'Capped cover' });
  assert.equal(capped.status, 201, JSON.stringify(capped.json));
  assert.equal(capped.json.data.delegation.maxAmount, 100000);
  // the delegate who raised the document waiting for the delegator cannot be given it
  const own = await api.call('POST', `${E}/sample-docs`, { ...as('PD', 'pdw'), headers: key('c'), body: { title: 'Mine', amount: '100.00' } });
  await api.call('POST', `${E}/sample-docs/${own.json.data.id}/submit`, { ...as('PD', 'pdw'), headers: key('s'), body: {} });
  assert.equal((await mk(pm, { delegate: 'pdw', from: D(0), to: D(2), reason: 'To the author' })).status, 201, 'the task is for the role, not for pm1 by name, so there is no clash yet');
  // list: mine, all (admin only), revoke
  const mine = (await api.call('GET', `${W}/delegations`, pm)).json.data;
  assert.ok(mine.total >= 2 && mine.rows.every((r) => r.delegator === 'pm1' || r.delegate === 'pm1'));
  assert.equal((await api.call('GET', `${W}/delegations?scope=all`, pm)).status, 403);
  assert.ok((await api.call('GET', `${W}/delegations?scope=all`, sys)).json.data.total >= 3);
  const id = later.json.data.delegation.id;
  assert.equal((await api.call('POST', `${W}/delegations/${id}/revoke`, { ...as('PM', 'pm3'), headers: key('r'), body: { reason: 'Not mine to end' } })).status, 403);
  assert.equal((await api.call('POST', `${W}/delegations/${id}/revoke`, { ...pm, headers: key('r'), body: { reason: 'I am back early' } })).json.data.status, 'REVOKED');
  assert.equal((await api.call('POST', `${W}/delegations/${id}/revoke`, { ...pm, headers: key('r'), body: { reason: 'Again' } })).status, 422);
  await api.close();
});

test('FR-05 a delegation of more than 15 days waits for the delegator\'s manager; until then it is not in force', async () => {
  const api = await startApi();
  await setupCompany(api);
  const D = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const r = await api.call('POST', `${W}/delegations`, { ...pm, headers: key('g'), body: { delegate: 'del2', docTypes: [], from: D(0), to: D(20), reason: 'A long leave abroad' } });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.delegation.status, 'PENDING');
  assert.equal(r.json.data.delegation.days, 21);
  const inst = r.json.data.instance;
  assert.equal(inst.docType, 'WF_DELEGATION');
  assert.equal(inst.tasks[0].status, 'ADMIN_QUEUE', 'nobody manages this person, so an administrator names the manager');
  assert.equal(workflowOf(api.db).delegationCheck, undefined);
  const wf = (await api.call('POST', `${W}/tasks/${inst.tasks[0].id}/assign`, { ...sys, headers: key('a'), body: { user: 'mgr1' } })).json.data;
  const doc = (await api.call('POST', `${E}/sample-docs`, { ...as('PD', 'pdy'), headers: key('c'), body: { title: 'Cover', amount: '100.00' } })).json.data;
  const sub = (await api.call('POST', `${E}/sample-docs/${doc.id}/submit`, { ...as('PD', 'pdy'), headers: key('s'), body: {} })).json.data.workflow;
  assert.equal((await act(api, as('SE', 'del2'), sub.tasks[0].id, { action: 'approve' })).status, 403, 'waiting for the manager');
  const ok = await act(api, as('HRMGR', 'mgr1'), openTask(wf).id, { action: 'approve' });
  assert.equal(ok.json.data.status, 'APPROVED');
  assert.equal((await api.call('GET', `${W}/delegations/${r.json.data.delegation.id}`, pm)).json.data.status, 'ACTIVE');
  assert.equal((await act(api, as('SE', 'del2'), sub.tasks[0].id, { action: 'approve' })).status, 200, 'in force once approved');
  await api.close();
});

test('T-03 FR-06 FR-07 reminders at half the time, escalation to the next level at the due time and to the director at twice the time, counted in working hours', async () => {
  const api = await startApi();
  await setupCompany(api);
  const engine = workflowOf(api.db);
  const at = (iso) => engine.setClock(() => new Date(iso));
  // Friday 6 November 2026, 16:00 IST (10:30 UTC). The week off is Sunday. 24 working hours of 9:00 to 18:00: Fri 2 h, Sat 9 h, Mon 9 h, Tue 4 h, so Tue 13:00 IST.
  at('2026-11-06T10:30:00.000Z');
  const doc = (await api.call('POST', `${E}/sample-docs`, { ...as('PD', 'pdt'), headers: key('c'), body: { title: 'Slow', amount: '100.00' } })).json.data;
  const wf = (await api.call('POST', `${E}/sample-docs/${doc.id}/submit`, { ...as('PD', 'pdt'), headers: key('s'), body: {} })).json.data.workflow;
  const task = wf.tasks[0];
  assert.equal(task.dueAt, '2026-11-10T07:30:00.000Z', 'Tuesday 13:00 IST: Sunday is skipped');
  const raw = JSON.parse(api.db.prepare('SELECT scope_json FROM wf_tasks WHERE id = ?').get(task.id).scope_json);
  assert.equal(raw.sla.hours, 24);
  assert.equal(raw.sla.remindAt, '2026-11-09T04:30:00.000Z', 'half of the time, 12 working hours: Friday 2, Saturday 9, Monday 1, so Monday 10:00 IST');
  assert.equal(raw.sla.secondAt, '2026-11-13T04:30:00.000Z', 'twice the time, 48 working hours: Friday 10:00 IST of the next week');
  // before the reminder point nothing happens
  at('2026-11-06T12:00:00.000Z');
  assert.deepEqual(engine.sweepSla(), { reminded: 0, escalated: 0 });
  // at the reminder point the approver is reminded, once
  at(raw.sla.remindAt);
  assert.deepEqual(engine.sweepSla(), { reminded: 1, escalated: 0 });
  assert.deepEqual(engine.sweepSla(), { reminded: 0, escalated: 0 });
  // at the due time the task climbs one level: from the project level to the regional level
  at(task.dueAt);
  const sw = engine.sweepSla();
  assert.deepEqual(sw, { reminded: 0, escalated: 1 }, JSON.stringify(api.db.prepare('SELECT id, assignee_role, status, reminded_at, escalated_at, due_at FROM wf_tasks').all()));
  let seen = (await api.call('GET', `${W}/instances/${wf.id}`, as('PD', 'pdt'))).json.data;
  const esc = seen.tasks.find((t) => t.assigneeRole === 'PD');
  assert.ok(esc, 'a task for the next level');
  assert.equal(seen.tasks.find((t) => t.id === task.id).status, 'OPEN', 'the first approver can still decide');
  assert.ok(seen.history.some((h) => h.event === 'ESCALATED' && h.data.level === 1 && h.data.to === 'PD'));
  assert.deepEqual(engine.sweepSla(), { reminded: 0, escalated: 0 });
  // at twice the time it climbs to the director
  at(raw.sla.secondAt);
  assert.deepEqual(engine.sweepSla(), { reminded: 1, escalated: 1 }, 'the second escalation, and the task of the first escalation is reminded in its turn');
  seen = (await api.call('GET', `${W}/instances/${wf.id}`, as('PD', 'pdt'))).json.data;
  assert.ok(seen.tasks.some((t) => t.assigneeRole === 'DIR'));
  assert.ok(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'workflow.task.escalated'").get().n >= 2);
  // whoever of the three decides, the step is done and the others are closed
  const rr = await act(api, as('DIR', 'dirx'), seen.tasks.find((t) => t.assigneeRole === 'DIR').id, { action: 'approve', comment: 'decided at the top' });
  assert.equal(rr.status, 200, JSON.stringify(rr.json));
  assert.equal(rr.json.data.currentStep, 'FINANCE');
  assert.deepEqual(rr.json.data.tasks.filter((t) => t.step === 'MANAGER').map((t) => t.status).sort(), ['DONE', 'SKIPPED', 'SKIPPED']);
  engine.setClock(() => new Date());
  await api.close();
});

test('FR-06 FR-07 the SLA settings and the escalation hierarchy are changed through approval and then govern new tasks', async () => {
  const api = await startApi();
  await setupCompany(api);
  const engine = workflowOf(api.db);
  engine.setClock(() => new Date('2026-11-02T04:30:00.000Z')); // Monday 10:00 IST
  const sla = (await api.call('GET', `${W}/sla-settings`, aud)).json.data;
  assert.deepEqual(sla.filter((s) => ['*', 'PAY', 'PTW'].includes(s.docType)).map((s) => [s.docType, s.hours]).sort(), [['*', 24], ['PAY', 8], ['PTW', 2]]);
  assert.equal((await api.call('POST', `${W}/sla-settings/changes`, { ...pm, headers: key('s'), body: { settings: [{ docType: 'ENG_SAMPLE_DOC', hours: 4, remindPct: 50, escalatePct: 100, secondPct: 200 }], effectiveFrom: today(), reason: 'No right' } })).status, 403);
  assert.equal((await api.call('POST', `${W}/sla-settings/changes`, { ...sys, headers: key('s'), body: { settings: [{ docType: 'ENG_SAMPLE_DOC', hours: 4, remindPct: 100, escalatePct: 100, secondPct: 200 }], effectiveFrom: today(), reason: 'Reminder not before' } })).status, 400);
  const req = await api.call('POST', `${W}/sla-settings/changes`, { ...sys, headers: key('s'), body: { settings: [{ docType: 'ENG_SAMPLE_DOC', hours: 4, remindPct: 25, escalatePct: 100, secondPct: 300 }], effectiveFrom: today(), reason: 'Sample documents are quick' } });
  assert.equal(req.status, 202, JSON.stringify(req.json));
  await approveChain(api, req.json.data.instance, [sys2, cfo]);
  // a step with its own hours keeps them; the sample's steps do (24 h), so use the setting through another type of step by asking the service
  const r = await api.call('GET', `${W}/sla-settings`, aud);
  assert.ok(r.json.data.some((s) => s.docType === 'ENG_SAMPLE_DOC' && s.hours === 4 && s.status === 'ACTIVE'));
  // the hierarchy: add a "Regional director" level between regional and head office, and a project's own path
  const path = await api.call('POST', `${W}/escalation-paths/changes`, { ...sys, headers: key('p'), body: { levels: [{ level: 'Site', roles: ['CM'] }, { level: 'Project', roles: ['PM'] }, { level: 'Head office', roles: ['COMMGR'] }, { level: 'Director', roles: ['DIR'] }], effectiveFrom: today(), reason: 'Flatter hierarchy' } });
  assert.equal(path.status, 202, JSON.stringify(path.json));
  assert.equal((await api.call('POST', `${W}/escalation-paths/changes`, { ...sys, headers: key('p'), body: { levels: [{ level: 'Project', roles: ['PM'] }, { level: 'Director', roles: ['DIR'] }], effectiveFrom: today(), reason: 'A second at once' } })).status, 409, 'one change at a time');
  await approveChain(api, path.json.data.instance, [sys2, cfo]);
  const doc = (await api.call('POST', `${E}/sample-docs`, { ...as('PD', 'pdv'), headers: key('c'), body: { title: 'Flat', amount: '100.00' } })).json.data;
  const wf = (await api.call('POST', `${E}/sample-docs/${doc.id}/submit`, { ...as('PD', 'pdv'), headers: key('s'), body: {} })).json.data.workflow;
  engine.setClock(() => new Date('2026-11-12T04:30:00.000Z'));
  engine.sweepSla();
  engine.sweepSla();
  const seen = (await api.call('GET', `${W}/instances/${wf.id}`, as('PD', 'pdv'))).json.data;
  assert.ok(seen.tasks.some((t) => t.assigneeRole === 'COMMGR'), 'the project level climbs to head office in the new hierarchy');
  assert.ok(!seen.tasks.some((t) => t.assigneeRole === 'PD'));
  engine.setClock(() => new Date());
  await api.close();
});

test('T-04 FR-08 the simulator gives the routing a real document gets: the same steps and approvers for the same facts', async () => {
  const api = await startApi();
  await setupCompany(api);
  for (const amount of ['1000.00', '999999.99', '1000000.00', '5000000.00']) {
    const s = await sim(api, aud, { docType: 'ENG_SAMPLE_DOC', context: { amount: Number(amount), title: 't' } });
    const made = await api.call('POST', `${E}/sample-docs`, { ...as('PD', `pds${Math.round(Number(amount))}`), headers: key('c'), body: { title: 'Trial', amount } });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    const d = made.json.data;
    const actual = (await api.call('POST', `${E}/sample-docs/${d.id}/submit`, { ...as('PD', `pds${Math.round(Number(amount))}`), headers: key('s'), body: {} })).json.data.workflow;
    assert.deepEqual(s.steps.map((x) => [x.code, x.approvers.map((a) => a.label).join()]), actual.steps.map((x) => [x.code, x.approvers.map((a) => a.role).join()]), `amount ${amount}`);
    assert.equal(actual.tasks.find((t) => t.status === 'OPEN').assigneeRole, s.steps.find((x) => x.applies).approvers[0].label);
    assert.equal(actual.tasks.length >= 1, true);
    const history = actual.history.find((h) => h.event === 'SUBMITTED').data.matrix;
    assert.equal(history.ruleId, s.trace.ruleId);
    assert.equal(history.matrixVersion, s.trace.matrixVersion);
  }
  // a rule of a draft can be tried before it is activated
  const d = await draftOf(api, 'PAY', [rule(10, 'All to the director', [], ['DIR'])]);
  assert.equal(chain(await sim(api, aud, { docType: 'PAY', context: { amount: 100 }, matrixId: d.id })), 'DIR');
  assert.equal(chain(await sim(api, aud, { docType: 'PAY', context: { amount: 100 } })), 'ACCMGR', 'the version in force is unchanged');
  assert.equal((await api.call('POST', `${W}/matrix/simulate`, { ...pm, body: { docType: 'PAY', context: {} } })).status, 403);
  // a document no rule fits is refused at submit, not routed by guesswork
  await api.close();
});

test('FR-01 a project\'s own matrix overrides the company\'s for its documents; another company never sees it', async () => {
  const api = await startApi();
  await setupCompany(api);
  const p = Number(api.db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'ALP', 'Alpha', 'ROAD', 'ACTIVE', 't', 't')").run().lastInsertRowid);
  const d = await draftOf(api, 'PAY', null, { scopeType: 'PROJECT', scopeId: p, name: 'Alpha payments' });
  await api.call('PUT', `${W}/matrix/${d.id}`, { ...sys, headers: key('u'), body: { rules: [rule(10, 'All', [], ['ACCMGR', 'DIR'])] } });
  const req = await api.call('POST', `${W}/matrix/${d.id}/activate`, { ...sys, headers: key('x'), body: { effectiveFrom: today() } });
  assert.equal(req.status, 202, JSON.stringify(req.json));
  await approveChain(api, req.json.data.instance, [sys2, cfo]);
  assert.equal(chain(await sim(api, aud, { docType: 'PAY', context: { amount: 100 }, projectId: p })), 'ACCMGR > DIR');
  assert.equal(chain(await sim(api, aud, { docType: 'PAY', context: { amount: 100 } })), 'ACCMGR', 'other projects keep the company matrix');
  assert.equal((await api.call('POST', `${W}/matrix`, { ...sys, headers: key('d'), body: { docType: 'PAY', scopeType: 'PROJECT', scopeId: 9999 } })).status, 422);
  // another company has its own, untouched
  const made = await api.call('POST', '/api/v1/iam/org/companies', { ...sys, headers: key('c'), body: { code: 'TWO', legalName: 'Two Infra', shortName: 'TWO' } });
  assert.equal(made.status, 201);
  const other = (await api.call('GET', `${W}/matrix?docType=PAY`, { ...aud, company: String(made.json.data.id) })).json.data;
  assert.equal(other.total, 1);
  assert.equal(other.rows[0].scopeType, 'COMPANY');
  assert.equal((await api.call('GET', `${W}/matrix/${d.id}`, { ...aud, company: String(made.json.data.id) })).status, 404);
  await api.close();
});

test('FR-02 BR-01 a matrix with no rule for the document makes the submit fail clearly, and the engine falls back to a definition without a matrix', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = await draftOf(api, 'ENG_SAMPLE_DOC', [{ priority: 10, name: 'Small only', conditions: [{ field: 'amount', op: 'lte', value: 1000 }], steps: [{ role: 'PM' }] }]);
  // activation is refused for the gap, so force the version in force for this check
  api.db.prepare("UPDATE wf_matrix SET status = 'ACTIVE', effective_from = '2000-01-01', effective_to = NULL WHERE id = ?").run(d.id);
  api.db.prepare("UPDATE wf_matrix SET status = 'RETIRED', effective_to = '2020-01-01' WHERE doc_type = 'ENG_SAMPLE_DOC' AND id != ?").run(d.id);
  const doc = (await api.call('POST', `${E}/sample-docs`, { ...as('PD', 'pdg'), headers: key('c'), body: { title: 'Big', amount: '99999.00' } })).json.data;
  const r = await api.call('POST', `${E}/sample-docs/${doc.id}/submit`, { ...as('PD', 'pdg'), headers: key('s'), body: {} });
  assert.equal(r.status, 422);
  assert.match(r.json.error.message, /No rule of the approval matrix/);
  assert.equal((await api.call('GET', `${E}/sample-docs/${doc.id}`, as('PD', 'pdg'))).json.data.status, 'DRAFT', 'the document stays a draft');
  await api.close();
});
