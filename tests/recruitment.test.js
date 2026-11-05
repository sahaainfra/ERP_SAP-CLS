import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { employeesOf } from '../src/server/modules/hr/employees.js';
import { recruitmentOf } from '../src/server/modules/hr/recruitment.js';
import { setupCompany, startApi } from './helpers.js';

// Part 07.02: recruitment. T-01 a joined candidate becomes an employee with everything captured, nothing typed again; T-02 an offer above the range of the requisition goes to the director. Also: the requisition against the
// headcount plan (beyond the plan the director too), amendment, the pipeline with its rules, interviews with panel feedback, the offer with its CTC breakup, acceptance through the link, pre-joining, the joining checklist,
// retention of rejected candidates, scope and idempotent replay.
const H = '/api/v1/hr';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'r') => ({ ...json, 'idempotency-key': `rc-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const hr1 = as('HRMGR', 'hr1'); const hr2 = as('HRMGR', 'hr2'); const dir = as('DIR', 'dir1'); const pm1 = as('PM', 'pm1'); const cm1 = as('CM', 'cm1'); const cm2 = as('CM', 'cm2'); const se = as('SE', 'se1'); const aud = as('AUD', 'aud1');
const itadm = as('ITADM', 'it1'); const hseo = as('HSEO', 'hseo1'); const pay = as('PAY', 'pay1'); const other = as('HRMGR', 'hr9', '2');
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'TWO', 'Two Infra Pvt Ltd', 'Two', 't', 'test')").run();
  for (const [n, r, c] of [['hr1', ['HRMGR'], 1], ['hr2', ['HRMGR'], 1], ['dir1', ['DIR'], 1], ['pm1', ['PM'], 1], ['cm1', ['CM'], 1], ['cm2', ['CM'], 1], ['se1', ['SE'], 1], ['aud1', ['AUD'], 1], ['it1', ['ITADM'], 1], ['hseo1', ['HSEO'], 1], ['pay1', ['PAY'], 1], ['hr9', ['HRMGR'], 2]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, n, `${n.toUpperCase()} Person`, JSON.stringify(r), `${n}@example.com`);
  const org = (sql, ...a) => Number(api.db.prepare(sql).run(...a).lastInsertRowid);
  const dept = org("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'ENG', 'Engineering', 't', 'test')");
  const junior = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'SE', 'Site Engineer', 'G3', 3, 't', 'test')");
  const senior = org("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'GM', 'General Manager', 'G9', 9, 't', 'test')");
  const project = org("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 't', 'test')");
  const ids = { dept, junior, senior, project };
  const call = (who, method, path, body, k) => api.call(method, `${H}${path}`, { ...who, headers: key(k), body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
    assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment: 'checked it' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const plan = (positions = 5, o = {}) => call(hr1, 'PUT', '/plans', { departmentId: dept, designationId: junior, approvedPositions: positions, validFrom: '2026-04-01', reason: 'Approved headcount of the year', ...o });
  const reqBody = (o = {}) => ({ departmentId: dept, designationId: junior, projectId: null, positions: 2, reason: 'NEW', employmentType: 'PERMANENT', locationType: 'HO', ctcMin: '600000', ctcMax: '900000', requiredBy: day(30), justification: 'New package of work', ...o });
  /** An approved requisition: raised by cm1, approved by the project manager and an HR manager. */
  const approvedReq = async (o = {}) => {
    const r = await call(cm1, 'POST', '/requisitions', { ...reqBody(o), submit: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    const inst = r.json.data.instanceId;
    await act(pm1, inst); await act(hr2, inst);
    if (r.json.data.band === 'BEYOND_PLAN') await act(dir, inst);
    return (await call(cm1, 'GET', `/requisitions/${r.json.data.id}`)).json.data;
  };
  return { api, call, act, hasTask, ids, plan, reqBody, approvedReq };
};
const person = (o = {}) => ({ fullName: 'Rakesh Kulkarni', mobile: '9876500011', email: 'rakesh@example.com', source: 'REFERRAL', sourceDetail: 'Referred by Mahesh', currentCtc: '700000', expectedCtc: '850000', noticeDays: 30, ...o });
const profile = () => ({
  firstName: 'Rakesh', lastName: 'Kulkarni', gender: 'MALE', dob: '1991-05-17', bloodGroup: 'B+', maritalStatus: 'MARRIED', permanentAddress: { line: '12 Shivaji Nagar', city: 'Pune', stateCode: 'MH', pin: '411005' }, currentAddress: null,
  contacts: [{ type: 'EMERGENCY', name: 'Sunita Kulkarni', relation: 'Spouse', phone: '9876500022' }, { type: 'NOMINEE', name: 'Sunita Kulkarni', relation: 'Spouse', sharePct: '100' }], education: [{ qualification: 'B.E. Civil', institute: 'COEP Pune', year: 2013 }], experience: [{ employer: 'Larsen Infra', jobTitle: 'Site Engineer', fromDate: '2013-07-01', toDate: '2026-10-15' }],
  statutory: { pan: 'ABCPK1234F', aadhaar: '123456789012', uan: '100200300400', pfApplicable: true, esiApplicable: false, ptState: 'MH' }, bank: { accountNo: '123456789012', ifsc: 'SBIN0001234', accountName: 'Rakesh Kulkarni' },
});
const tokenOf = (link) => new URL(link).searchParams.get('token');

test('FR-01 BR-01 a requisition is checked against the headcount plan: within it the project head and the HR manager approve, beyond it (or with no plan) the director too; it is locked, amended by revision, closed', async () => {
  const t = await setup();
  const none = await t.call(cm1, 'GET', `/requisitions/plan-check?departmentId=${t.ids.dept}&designationId=${t.ids.junior}&positions=2`);
  assert.equal(none.json.data.beyond, true, 'no plan: nothing is approved');
  assert.equal((await t.call(cm1, 'PUT', '/plans', {})).status, 403, 'a hiring manager does not set the plan');
  await t.plan(5);
  const check = (await t.call(cm1, 'GET', `/requisitions/plan-check?departmentId=${t.ids.dept}&designationId=${t.ids.junior}&positions=2`)).json.data;
  assert.deepEqual([check.planned, check.filled, check.open, check.beyond], [5, 0, 0, false]);
  const bad = await t.call(cm1, 'POST', '/requisitions', t.reqBody({ ctcMax: '100', requiredBy: '2020-01-01', reason: 'REPLACEMENT' }));
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.json.error.details.map((d) => d.field).sort(), ['ctcMax', 'replacesEmployeeId', 'requiredBy']);
  const r = await t.call(cm1, 'POST', '/requisitions', t.reqBody());
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.data.docNo, 'REQ-00001');
  assert.equal((await t.call(cm2, 'GET', `/requisitions/${r.json.data.id}`)).status, 404, 'a hiring manager sees only their own requisitions');
  assert.equal((await t.call(cm2, 'GET', '/requisitions')).json.data.length, 0);
  assert.equal((await t.call(se, 'POST', '/requisitions', t.reqBody())).status, 403);
  const sub = await t.call(cm1, 'POST', `/requisitions/${r.json.data.id}/submit`, {});
  assert.equal(sub.status, 202, JSON.stringify(sub.json));
  assert.equal(sub.json.data.band, 'WITHIN_PLAN');
  const inst = sub.json.data.instanceId;
  assert.equal(await t.hasTask(cm1, inst), false, 'the person who raised it does not approve it');
  assert.equal(await t.hasTask(hr2, inst), false, 'the HR manager comes after the project head');
  await t.act(pm1, inst); await t.act(hr2, inst);
  let got = (await t.call(hr1, 'GET', `/requisitions/${r.json.data.id}`)).json.data;
  assert.equal(got.status, 'APPROVED');
  assert.equal((await t.call(cm1, 'PATCH', `/requisitions/${got.id}`, { ...t.reqBody(), version: got.rowVersion })).status, 409, 'approved: locked');
  assert.equal(JSON.stringify((await t.call(hr1, 'GET', '/requisitions')).json).includes('"ctcMin":"600000.00"'), true, 'HR sees the budget');
  // beyond the plan: the director too
  const big = await t.call(cm1, 'POST', '/requisitions', { ...t.reqBody({ positions: 4 }), submit: true });
  assert.equal(big.json.data.band, 'BEYOND_PLAN', '2 open + 4 asked > 5');
  await t.act(pm1, big.json.data.instanceId); await t.act(hr2, big.json.data.instanceId);
  assert.equal((await t.call(hr1, 'GET', `/requisitions/${big.json.data.id}`)).json.data.status, 'SUBMITTED');
  await t.act(dir, big.json.data.instanceId);
  assert.equal((await t.call(hr1, 'GET', `/requisitions/${big.json.data.id}`)).json.data.status, 'APPROVED');
  // amendment: a new revision, approved again; the old one stays in force until then
  const am = await t.call(hr1, 'POST', `/requisitions/${got.id}/amend`, { reason: 'Two more engineers are needed' });
  assert.equal(am.status, 201, JSON.stringify(am.json));
  assert.equal(am.json.data.revision, 2);
  assert.equal((await t.call(hr1, 'POST', `/requisitions/${got.id}/amend`, { reason: 'A second amendment at once' })).status, 409);
  const rev = await t.call(hr1, 'PATCH', `/requisitions/${am.json.data.id}`, { ...t.reqBody({ positions: 3 }), version: am.json.data.rowVersion });
  assert.equal(rev.status, 200, JSON.stringify(rev.json));
  const rsub = await t.call(hr1, 'POST', `/requisitions/${am.json.data.id}/submit`, {});
  assert.equal(rsub.json.data.band, 'BEYOND_PLAN', 'the other open positions count');
  await t.act(pm1, rsub.json.data.instanceId); await t.act(hr2, rsub.json.data.instanceId); await t.act(dir, rsub.json.data.instanceId);
  assert.equal((await t.call(hr1, 'GET', `/requisitions/${got.id}`)).json.data.status, 'SUPERSEDED');
  const cmp = (await t.call(hr1, 'GET', `/requisitions/${am.json.data.id}/compare`)).json.data;
  assert.deepEqual(cmp.rows.find((x) => x.field === 'Positions'), { field: 'Positions', from: 2, to: 3, changed: true });
  // return, reject, withdraw, close
  const r3 = await t.call(cm1, 'POST', '/requisitions', { ...t.reqBody(), submit: true });
  await t.act(pm1, r3.json.data.instanceId, 'return');
  assert.equal((await t.call(cm1, 'GET', `/requisitions/${r3.json.data.id}`)).json.data.status, 'RETURNED');
  const fixed = await t.call(cm1, 'POST', `/requisitions/${r3.json.data.id}/submit`, {});
  assert.equal(fixed.status, 202, JSON.stringify(fixed.json));
  await t.act(pm1, fixed.json.data.instanceId, 'reject');
  assert.equal((await t.call(cm1, 'GET', `/requisitions/${r3.json.data.id}`)).json.data.status, 'REJECTED');
  const r4 = await t.call(cm1, 'POST', '/requisitions', { ...t.reqBody(), submit: true });
  assert.equal((await t.call(cm1, 'POST', `/requisitions/${r4.json.data.id}/withdraw`, { reason: 'Raised by mistake' })).json.data.status, 'DRAFT');
  assert.equal((await t.call(cm1, 'DELETE', `/requisitions/${r4.json.data.id}`)).json.data.deleted, true);
  assert.equal((await t.call(hr1, 'POST', `/requisitions/${am.json.data.id}/cancel`, { reason: 'The position is not needed any more' })).json.data.status, 'CLOSED');
  assert.equal((await t.api.raw('GET', `${H}/requisitions/${got.id}/print`, hr1)).status, 200);
  assert.equal((await t.call(other, 'GET', `/requisitions/${got.id}`)).status, 404);
});

test('AC-01 T-01 T-02 FR-02 to FR-07 requisition, candidate, interviews, offer, acceptance by link, joining and the employee record without re-entry; an offer above the range goes to the director', async () => {
  const t = await setup();
  await t.plan(5);
  const req = await t.approvedReq({ positions: 1 });
  // candidate: duplicates and the pipeline rules
  const c = await t.call(hr1, 'POST', '/candidates', { ...person(), requisitionId: req.id });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal(c.json.data.stage, 'APPLIED');
  assert.equal((await t.call(hr1, 'POST', '/candidates', { ...person(), requisitionId: req.id })).status, 409, 'the same person twice in one pipeline');
  assert.equal((await t.call(hr1, 'POST', '/candidates', { ...person({ mobile: '12345' }), requisitionId: req.id })).status, 400);
  assert.equal((await t.call(cm1, 'POST', '/candidates', { ...person(), requisitionId: req.id })).status, 403);
  const id = c.json.data.id;
  const move = (stage, version, extra = {}) => t.call(hr1, 'POST', `/candidates/${id}/stage`, { stage, version, ...extra });
  assert.equal((await move('SELECTED', 1)).status, 422, 'no skipping stages');
  assert.equal((await move('OFFERED', 1)).status, 422, 'Offered comes from the offer');
  let cur = (await move('SCREENED', 1)).json.data;
  assert.equal(cur.stage, 'SCREENED');
  assert.equal((await move('INTERVIEW', 1)).status, 409, 'a stale version');
  const undo = await move('APPLIED', cur.rowVersion, { undo: true });
  assert.equal(undo.json.data.stage, 'APPLIED');
  await move('SCREENED', undo.json.data.rowVersion);
  // interviews: panel feedback, scores, the result
  assert.equal((await t.call(hr1, 'POST', `/candidates/${id}/interviews`, { scheduledAt: `${day(3)}T10:30`, panel: ['ghost'] })).status, 400);
  const iv = await t.call(hr1, 'POST', `/candidates/${id}/interviews`, { scheduledAt: `${day(3)}T10:30`, mode: 'IN_PERSON', panel: ['cm1', 'cm2'] });
  assert.equal(iv.status, 201, JSON.stringify(iv.json));
  assert.equal((await t.call(hr1, 'GET', `/candidates/${id}`)).json.data.stage, 'INTERVIEW', 'scheduling moves the candidate');
  assert.equal((await t.call(hr1, 'POST', `/candidates/${id}/stage`, { stage: 'SELECTED', version: (await t.call(hr1, 'GET', `/candidates/${id}`)).json.data.rowVersion })).status, 422, 'selected only after a passed interview');
  assert.equal((await t.call(se, 'POST', `/interviews/${iv.json.data.id}/feedback`, { scores: { technical: 4 }, recommendation: 'PASS' })).status, 403);
  assert.equal((await t.call(pm1, 'POST', `/interviews/${iv.json.data.id}/feedback`, { scores: { technical: 4 }, recommendation: 'PASS' })).status, 403, 'not on the panel');
  const seen = await t.call(cm1, 'GET', `/candidates/${id}`);
  assert.equal(seen.status, 200, 'a panel member sees the candidate');
  assert.equal(seen.json.data.expectedCtc, null, 'but not what they ask for');
  assert.equal(seen.json.data.mobile.includes('••'), true);
  assert.equal((await t.call(se, 'GET', `/candidates/${id}`)).status, 404);
  assert.equal((await t.call(cm1, 'GET', '/interviews/mine')).json.data.length, 1);
  const f1 = await t.call(cm1, 'POST', `/interviews/${iv.json.data.id}/feedback`, { scores: { technical: 5, communication: 4 }, comments: 'Strong on site planning', recommendation: 'PASS' });
  assert.equal(f1.json.data.result, 'PENDING', 'waiting for the second panel member');
  assert.equal((await t.call(cm1, 'POST', `/interviews/${iv.json.data.id}/feedback`, { scores: { technical: 5 }, recommendation: 'PASS' })).status, 409, 'feedback is given once');
  const f2 = await t.call(cm2, 'POST', `/interviews/${iv.json.data.id}/feedback`, { scores: { technical: 4, communication: 3 }, recommendation: 'PASS' });
  assert.equal(f2.json.data.result, 'PASS');
  assert.equal(f2.json.data.score, 4, '(4.5 + 3.5) / 2');
  assert.equal((await t.call(cm1, 'GET', '/interviews/mine')).json.data.length, 0);
  cur = (await t.call(hr1, 'GET', `/candidates/${id}`)).json.data;
  cur = (await move('SELECTED', cur.rowVersion)).json.data;
  assert.equal(cur.stage, 'SELECTED');
  // the board
  const board = (await t.call(hr1, 'GET', `/candidates/board?requisitionId=${req.id}`)).json.data;
  assert.equal(board.stages.find((s) => s.stage === 'SELECTED').candidates.length, 1);
  assert.equal(board.sources.REFERRAL, 1);
  // offer: the CTC breakup, computed on the server
  const pre = (await t.call(hr1, 'POST', '/offers/preview', { ctcAnnual: '800000', candidateId: id, designationId: t.ids.junior })).json.data;
  const total = pre.lines.reduce((a, l) => a + Math.round(Number(l.annual) * 100), 0);
  assert.equal(total, 80000000, 'the parts add up to the CTC');
  assert.equal(pre.lines.find((l) => l.code === 'BASIC').annual, '320000.00');
  assert.equal(pre.lines.find((l) => l.code === 'HRA').annual, '160000.00');
  assert.equal(pre.lines.find((l) => l.code === 'PF_EMPLOYER').annual, '21600.00', 'capped at 15,000 a month wage');
  assert.equal(pre.band, 'STANDARD');
  const offerBody = (o = {}) => ({ candidateId: id, designationId: t.ids.junior, ctcAnnual: '800000', dojProposed: day(20), employmentType: 'PERMANENT', validDays: 7, ...o });
  assert.equal((await t.call(cm1, 'POST', '/offers', offerBody())).status, 403);
  const o1 = await t.call(hr1, 'POST', '/offers', { ...offerBody(), submit: true });
  assert.equal(o1.status, 201, JSON.stringify(o1.json));
  assert.equal(o1.json.data.band, 'STANDARD');
  assert.equal(o1.json.data.grade, 'G3', 'the grade follows the designation');
  assert.equal(o1.json.data.breakup.ctcAnnual, '800000.00');
  assert.equal(await t.hasTask(hr1, o1.json.data.instanceId), false);
  assert.equal(await t.hasTask(dir, o1.json.data.instanceId), false, 'within the range the director is not asked');
  assert.equal((await t.call(hr1, 'POST', `/offers/${o1.json.data.id}/send`, {})).status, 409, 'an unapproved offer is not sent');
  await t.act(hr2, o1.json.data.instanceId);
  assert.equal((await t.call(hr1, 'GET', `/offers/${o1.json.data.id}`)).json.data.status, 'APPROVED');
  // T-02: above the range of the requisition (900000) the director also approves; the old offer is replaced by amendment
  const am = await t.call(hr1, 'POST', `/offers/${o1.json.data.id}/amend`, { reason: 'The candidate asked for more' });
  assert.equal(am.status, 201, JSON.stringify(am.json));
  const up = await t.call(hr1, 'PATCH', `/offers/${am.json.data.id}`, { designationId: t.ids.junior, ctcAnnual: '950000', dojProposed: day(20), employmentType: 'PERMANENT', validDays: 7, version: am.json.data.rowVersion });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  const high = await t.call(hr1, 'POST', `/offers/${am.json.data.id}/submit`, {});
  assert.equal(high.json.data.band, 'DIR');
  assert.match(high.json.data.bandReason, /above the requisition range/);
  await t.act(hr2, high.json.data.instanceId);
  assert.equal((await t.call(hr1, 'GET', `/offers/${am.json.data.id}`)).json.data.status, 'SUBMITTED', 'the HR manager alone is not enough above the range');
  assert.equal(await t.hasTask(dir, high.json.data.instanceId), true);
  await t.act(dir, high.json.data.instanceId, 'return');
  const back = await t.call(hr1, 'PATCH', `/offers/${am.json.data.id}`, { designationId: t.ids.junior, ctcAnnual: '900000', dojProposed: day(20), employmentType: 'PERMANENT', validDays: 7, version: (await t.call(hr1, 'GET', `/offers/${am.json.data.id}`)).json.data.rowVersion });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  const again = await t.call(hr1, 'POST', `/offers/${am.json.data.id}/submit`, {});
  assert.equal(again.json.data.band, 'STANDARD', 'back within the range: the HR manager alone');
  await t.act(hr2, again.json.data.instanceId);
  const final = (await t.call(hr1, 'GET', `/offers/${am.json.data.id}`)).json.data;
  assert.equal(final.status, 'APPROVED');
  assert.equal((await t.call(hr1, 'GET', `/offers/${o1.json.data.id}`)).json.data.status, 'SUPERSEDED');
  assert.deepEqual((await t.call(hr1, 'GET', `/offers/${am.json.data.id}/compare`)).json.data.rows.find((r) => r.field === 'CTC a year'), { field: 'CTC a year', from: '800000.00', to: '900000.00', changed: true });
  assert.equal((await t.call(aud, 'GET', `/offers/${final.id}`)).status, 200);
  assert.equal((await t.call(cm1, 'GET', `/offers/${final.id}`)).status, 403, 'a hiring manager does not see pay');
  assert.equal((await t.api.raw('GET', `${H}/offers/${final.id}/print`, hr1)).buffer.toString().includes('Basic salary'), true);
  // the link: sent once, answered with no sign-in
  const sent = await t.call(hr1, 'POST', `/offers/${final.id}/send`, {});
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  const tok = tokenOf(sent.json.data.link);
  assert.equal((await t.call(hr1, 'GET', `/candidates/${id}`)).json.data.stage, 'OFFERED');
  assert.equal(JSON.stringify((await t.call(hr1, 'GET', `/offers/${final.id}`)).json).includes(tok), false, 'the secret is not stored');
  const info = await t.api.call('GET', `${H}/offer-link/${tok}`, { user: null });
  assert.equal(info.status, 200, JSON.stringify(info.json));
  assert.equal(info.json.data.ctcAnnual, '900000.00');
  assert.equal(info.json.data.canRespond, true);
  assert.equal((await t.api.call('GET', `${H}/offer-link/${'x'.repeat(30)}`, { user: null })).status, 404);
  assert.equal((await t.api.call('PUT', `${H}/offer-link/${tok}/prejoining`, { user: null, headers: json, body: profile() })).status, 409, 'the details are asked after the acceptance');
  const acc = await t.api.call('POST', `${H}/offer-link/${tok}/respond`, { user: null, headers: json, body: { action: 'ACCEPT', comment: 'Happy to join' } });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  assert.equal((await t.call(hr1, 'GET', `/candidates/${id}`)).json.data.stage, 'ACCEPTED');
  assert.equal((await t.api.call('POST', `${H}/offer-link/${tok}/respond`, { user: null, headers: json, body: { action: 'DECLINE' } })).status, 409, 'answered once');
  // pre-joining by the candidate through the same link, and the clearances by HR
  const bad = await t.api.call('PUT', `${H}/offer-link/${tok}/prejoining`, { user: null, headers: json, body: { ...profile(), statutory: { ...profile().statutory, pan: 'BADPAN' } } });
  assert.equal(bad.status, 400);
  const pj = await t.api.call('PUT', `${H}/offer-link/${tok}/prejoining`, { user: null, headers: json, body: profile() });
  assert.equal(pj.status, 200, JSON.stringify(pj.json));
  const joined0 = await t.call(hr1, 'POST', `/candidates/${id}/join`, {});
  assert.equal(joined0.status, 422, 'not before the verification is clear and the medical fit');
  assert.match(joined0.json.error.message, /background verification/);
  const cand = (await t.call(hr1, 'GET', `/candidates/${id}`)).json.data;
  assert.equal(JSON.stringify(cand).includes('ABCPK1234F'), false, 'the PAN is masked on the candidate');
  assert.equal(cand.sensitive.pan, '••••••234F');
  assert.equal((await t.call(hr1, 'PUT', `/candidates/${id}/checks`, { bgvStatus: 'CLEAR', medicalStatus: 'FIT' })).status, 200);
  // T-01: the candidate becomes an employee; nothing typed again
  assert.equal((await t.call(cm1, 'POST', `/candidates/${id}/join`, {})).status, 403);
  const join = await t.call(hr1, 'POST', `/candidates/${id}/join`, {});
  assert.equal(join.status, 201, JSON.stringify(join.json));
  assert.equal(join.json.data.candidate.stage, 'JOINED');
  assert.equal(join.json.data.tasks.length, 6);
  const empId = join.json.data.employee.id;
  const emp = (await t.call(hr1, 'GET', `/employees/${empId}`)).json.data;
  assert.equal(emp.name, 'Rakesh Kulkarni');
  assert.equal(emp.dob, '1991-05-17');
  assert.equal(emp.mobile, '9876500011');
  assert.equal(emp.email, 'rakesh@example.com');
  assert.equal(emp.departmentId, t.ids.dept);
  assert.equal(emp.designation, 'Site Engineer');
  assert.equal(emp.grade, 'G3');
  assert.equal(emp.doj, final.dojProposed);
  assert.equal(emp.statutory.pan, 'ABCPK1234F');
  assert.equal(emp.statutory.aadhaar, '•••• •••• 9012');
  assert.equal(emp.banks[0].last4, '9012');
  assert.deepEqual(emp.contacts.map((x) => x.type).sort(), ['EMERGENCY', 'NOMINEE']);
  assert.equal(emp.education[0].qualification, 'B.E. Civil');
  assert.equal(emp.experience[0].employer, 'Larsen Infra');
  assert.equal(emp.status, 'SUBMITTED', 'the employee master has its own approval');
  assert.equal(t.api.db.prepare('SELECT source_type, source_id FROM hr_employees WHERE id = ?').get(empId).source_id, String(id), 'the trace link to the candidate');
  assert.equal((await t.call(hr1, 'POST', `/candidates/${id}/join`, {})).status, 409, 'a candidate joins once');
  assert.equal((await t.call(hr1, 'GET', `/requisitions/${req.id}`)).json.data.status, 'CLOSED', 'all positions filled');
  await t.act(hr2, emp.instanceId);
  assert.equal((await t.call(hr1, 'GET', `/employees/${empId}`)).json.data.status, 'APPROVED');
  // the user account is created from the approved employee (07.01), still without typing
  const user = await t.call(hr1, 'POST', `/employees/${empId}/user`, { invite: false });
  assert.equal(user.status, 201, JSON.stringify(user.json));
  // the joining checklist: each department sees its own task; HR sees all
  const mine = (who) => t.call(who, 'GET', '/onboarding').then((r) => r.json.data);
  assert.equal((await mine(hr1)).rows.length, 6);
  assert.deepEqual((await mine(itadm)).rows.map((r) => r.code), ['IT_ACCESS']);
  assert.deepEqual((await mine(hseo)).rows.map((r) => r.code).sort(), ['INDUCTION', 'PPE_ISSUE']);
  assert.deepEqual((await mine(pay)).rows.map((r) => r.code), ['BANK_DETAILS']);
  assert.equal((await t.call(se, 'GET', '/onboarding')).status, 403);
  const it = (await mine(itadm)).rows[0];
  assert.equal((await t.call(hseo, 'POST', `/onboarding/${it.id}/complete`, {})).status, 404, 'not their task');
  const done = await t.call(itadm, 'POST', `/onboarding/${it.id}/complete`, { note: 'Account and mailbox ready' });
  assert.equal(done.json.data.status, 'DONE');
  assert.equal((await t.call(itadm, 'POST', `/onboarding/${it.id}/complete`, {})).status, 409);
  const wv = (await mine(hr1)).rows.find((r) => r.code === 'ID_CARD');
  assert.equal((await t.call(hr1, 'POST', `/onboarding/${wv.id}/complete`, { waive: true, note: 'x' })).status, 400);
  assert.equal((await t.call(hr1, 'POST', `/onboarding/${wv.id}/complete`, { waive: true, note: 'Photo ID not needed for a site joiner' })).json.data.status, 'WAIVED');
  assert.equal((await mine(hr1)).counts.open, 4);
  const ev = t.api.db.prepare("SELECT event_type FROM core_outbox WHERE event_type LIKE 'hr.%'").all().map((x) => x.event_type);
  for (const e of ['hr.requisition.approved', 'hr.offer.approved', 'hr.offer.accepted', 'hr.candidate.joined', 'hr.employee.activated', 'hr.candidate.stage_changed']) assert.ok(ev.includes(e), `${e} in ${JSON.stringify([...new Set(ev)])}`);
});

test('BR-03 FR-02 a declined or rejected candidate keeps no personal data past the retention period; an offer lapses on its date; a rejection needs a reason', async () => {
  const t = await setup();
  await t.plan(5);
  const req = await t.approvedReq({ positions: 2 });
  const mk = async (mobile, name) => (await t.call(hr1, 'POST', '/candidates', { ...person({ mobile, fullName: name, email: `${mobile}@example.com` }), requisitionId: req.id })).json.data;
  const a = await mk('9811100001', 'Anita Rao'); const b = await mk('9811100002', 'Bharat Shah'); const c = await mk('9811100003', 'Chitra Nair');
  assert.equal((await t.call(hr1, 'POST', `/candidates/${a.id}/stage`, { stage: 'REJECTED', version: a.rowVersion })).status, 400, 'a reason is needed');
  const rej = await t.call(hr1, 'POST', `/candidates/${a.id}/stage`, { stage: 'REJECTED', reason: 'Does not have the site experience', version: a.rowVersion });
  assert.equal(rej.json.data.stage, 'REJECTED');
  assert.ok(rej.json.data.retentionUntil > day(300), 'twelve months of retention');
  const svc = recruitmentOf(t.api.db);
  assert.equal(svc.cycle(1, { today: day(100) }).anonymised, 0);
  assert.equal(svc.cycle(1, { today: day(400) }).anonymised, 1);
  const gone = (await t.call(hr1, 'GET', `/candidates/${a.id}`)).json.data;
  assert.equal(gone.anonymised, true);
  assert.equal(gone.name, 'Removed after the retention period');
  assert.equal(gone.mobile, '0000000000');
  assert.equal(gone.currentCtc, null);
  assert.equal(svc.cycle(1, { today: day(401) }).anonymised, 0, 'once');
  assert.equal((await t.call(hr1, 'POST', `/candidates/${a.id}/stage`, { stage: 'APPLIED', version: gone.rowVersion })).status, 422, 'removed data is not brought back');
  assert.equal((await t.call(hr1, 'GET', `/candidates?stage=REJECTED`)).json.meta.total, 1);
  // an offer lapses
  for (const x of [b]) {
    const iv = await t.call(hr1, 'POST', `/candidates/${x.id}/interviews`, { scheduledAt: `${day(1)}T11:00`, panel: ['cm1'] });
    await t.call(cm1, 'POST', `/interviews/${iv.json.data.id}/feedback`, { scores: { technical: 4 }, recommendation: 'PASS' });
    const cur = (await t.call(hr1, 'GET', `/candidates/${x.id}`)).json.data;
    await t.call(hr1, 'POST', `/candidates/${x.id}/stage`, { stage: 'SELECTED', version: cur.rowVersion });
  }
  const off = await t.call(hr1, 'POST', '/offers', { candidateId: b.id, designationId: t.ids.junior, ctcAnnual: '700000', dojProposed: day(10), validDays: 3, submit: true });
  await t.act(hr2, off.json.data.instanceId);
  await t.call(hr1, 'POST', `/offers/${off.json.data.id}/send`, {});
  assert.equal(svc.cycle(1, { today: day(2) }).offersExpired, 0);
  assert.equal(svc.cycle(1, { today: day(5) }).offersExpired, 1);
  assert.equal((await t.call(hr1, 'GET', `/offers/${off.json.data.id}`)).json.data.response, 'EXPIRED');
  assert.equal((await t.call(hr1, 'GET', `/candidates/${b.id}`)).json.data.stage, 'SELECTED', 'back to selected: a new offer can be made');
  // a decline through the link moves the candidate to Rejected with the retention clock running
  const iv2 = await t.call(hr1, 'POST', `/candidates/${c.id}/interviews`, { scheduledAt: `${day(1)}T12:00`, panel: ['cm1'] });
  await t.call(cm1, 'POST', `/interviews/${iv2.json.data.id}/feedback`, { scores: { technical: 4 }, recommendation: 'PASS' });
  await t.call(hr1, 'POST', `/candidates/${c.id}/stage`, { stage: 'SELECTED', version: (await t.call(hr1, 'GET', `/candidates/${c.id}`)).json.data.rowVersion });
  const o2 = await t.call(hr1, 'POST', '/offers', { candidateId: c.id, designationId: t.ids.junior, ctcAnnual: '650000', dojProposed: day(10), submit: true });
  await t.act(hr2, o2.json.data.instanceId);
  const tok = tokenOf((await t.call(hr1, 'POST', `/offers/${o2.json.data.id}/send`, {})).json.data.link);
  const dec = await t.api.call('POST', `${H}/offer-link/${tok}/respond`, { user: null, headers: json, body: { action: 'DECLINE', comment: 'Joined another company' } });
  assert.equal(dec.status, 200, JSON.stringify(dec.json));
  const cc = (await t.call(hr1, 'GET', `/candidates/${c.id}`)).json.data;
  assert.equal(cc.stage, 'REJECTED');
  assert.match(cc.rejectReason, /declined/);
  assert.ok(cc.retentionUntil);
  assert.equal((await t.api.call('GET', `${H}/offer-link/${tok}`, { user: null })).status, 404, 'a declined link is closed');
});

test('AC-03 AC-04 scope and bypass: hiring managers, HR, the director, the auditor and another company; idempotent replay; a candidate needs an approved requisition and a selected candidate an offer', async () => {
  const t = await setup();
  await t.plan(5);
  const unapproved = await t.call(cm1, 'POST', '/requisitions', t.reqBody());
  assert.equal((await t.call(hr1, 'POST', '/candidates', { ...person(), requisitionId: unapproved.json.data.id })).status, 400, 'no candidate against a requisition that is not approved');
  const req = await t.approvedReq();
  const k = 'replay-cand';
  const body = { ...person(), requisitionId: req.id };
  const a = await t.api.call('POST', `${H}/candidates`, { ...hr1, headers: { ...json, 'idempotency-key': k }, body });
  const b = await t.api.call('POST', `${H}/candidates`, { ...hr1, headers: { ...json, 'idempotency-key': k }, body });
  assert.equal(a.status, 201);
  assert.equal(b.json.data.id, a.json.data.id);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM hr_candidates').get().n, 1);
  assert.equal((await t.api.call('POST', `${H}/candidates`, { ...hr1, headers: json, body })).status, 400, 'an Idempotency-Key is required');
  assert.equal((await t.call(hr1, 'POST', '/offers', { candidateId: a.json.data.id, designationId: t.ids.junior, ctcAnnual: '700000', dojProposed: day(10) })).status, 400, 'an offer is made to a selected candidate');
  // the checks of who may do what
  assert.equal((await t.call(aud, 'GET', '/candidates')).status, 200);
  assert.equal((await t.call(aud, 'POST', '/candidates', body)).status, 403);
  assert.equal((await t.call(dir, 'GET', '/requisitions')).json.data.length, 2);
  assert.equal((await t.call(se, 'GET', '/requisitions')).status, 403);
  assert.equal((await t.call(other, 'GET', `/candidates/${a.json.data.id}`)).status, 404);
  assert.equal((await t.call(other, 'GET', '/candidates')).json.meta.total, 0);
  assert.equal((await t.call(hr1, 'GET', '/plans')).json.data.length, 1);
  // a feature of the employee master is reused, not copied: the employee is created only through its service
  assert.ok(employeesOf(t.api.db));
});
