import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, setupCompany, startApi } from './helpers.js';
import { createLogger } from '../src/server/platform/http/logger.js';

// Part 03.04: the Object Page's server contract on the reference record (a sample material request): allowedActions per role, the approval
// chain and its decisions, required documents, versions and the amendment comparison, the timeline, discussion, related records, reason
// codes, print, masks and the error envelope's correlation ID.
const U = '/api/v1/ui';
const json = { 'content-type': 'application/json' };
const key = (k) => ({ ...json, 'idempotency-key': `obj-${k}-${Math.random().toString(36).slice(2, 10)}` });
const pm = { roles: 'PM', user: 'pm1' };
const acc = { roles: 'ACCMGR', user: 'acc1' };
const cfo = { roles: 'CFO', user: 'cfo1' };
const sys = { roles: 'SYSADM', user: 'sys1' };
const today = '2026-10-31';

async function world(api, company = '1') {
  const as = (roles, user) => ({ roles, user, company });
  await setupCompany(api, { company });
  const mr = await api.call('POST', '/api/v1/core/number-series', { ...admin(company), headers: key('n'), body: { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' } });
  assert.equal(mr.status, 201, JSON.stringify(mr.json));
  const project = (await api.call('POST', '/api/v1/iam/org/projects', { ...as('PM', 'pm1'), headers: key('p'), body: { code: `NH${company}`, name: 'NH-48 Widening', type: 'ROAD' } })).json.data;
  const site = (await api.call('POST', '/api/v1/iam/org/sites', { ...as('PM', 'pm1'), headers: key('s'), body: { code: `S${company}`, name: 'Km 12 camp', projectId: project.id } })).json.data;
  return { project, site };
}
/** A second request on the same project (the world already exists). */
async function world2(api) {
  const p = api.db.prepare('SELECT id FROM org_projects ORDER BY id LIMIT 1').get();
  const s = api.db.prepare('SELECT id FROM org_sites ORDER BY id LIMIT 1').get();
  return { w: { project: { id: p.id }, site: { id: s.id } } };
}
const body = (w, extra = {}) => ({
  title: 'Footing F3 reinforcement', docDate: today, requiredBy: '2026-11-05', projectId: w.project.id, siteId: w.site.id, priority: 'NORMAL', returnable: false,
  lines: [{ description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000' }, { description: 'Binding wire', uom: 'KG', quantity: '100', unitRate: '82.5' }],
  ...extra,
});
const make = async (api, w, extra, who = pm) => (await api.call('POST', `${U}/sample-requests`, { ...who, headers: key('mk'), body: body(w, extra) })).json.data;
const submit = async (api, r, who = pm) => (await api.call('POST', `${U}/sample-requests/${r.id}/submit`, { ...who, headers: key('sub'), body: { version: r.version } })).json.data;
const get = async (api, id, who = pm) => (await api.call('GET', `${U}/sample-requests/${id}`, who)).json.data;
const ids = (r) => r.allowedActions.filter((a) => a.allowed).map((a) => a.id).sort();
const decide = (api, r, who, b) => api.call('POST', `${U}/sample-requests/${r.id}/decision`, { ...who, headers: key('dec'), body: { version: r.approval.version, ...b } });
/** A clean file attached to the request, as the file service would leave it. */
function attach(api, r, name = 'indent.pdf', company = 1) {
  return Number(api.db.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by) VALUES (?, ?, ?, 'pdf', 'application/pdf', 'document', 100, 'abc', 'CLEAN', 'sample_request', ?, 'pm1')").run(company, `k-${name}-${Math.random()}`, name, r.id).lastInsertRowid);
}

test('T-01 allowedActions from the server decide which buttons three roles see on the same record, and why the others are off', async () => {
  const api = await startApi();
  const w = await world(api);
  const draft = await make(api, w);
  // a draft: the person who raised it may change, submit and cancel it; others see why they cannot
  assert.deepEqual(ids(draft), ['cancel', 'edit', 'print', 'submit']);
  const asAcc = await get(api, draft.id, acc);
  assert.deepEqual(ids(asAcc), ['print']);
  assert.match(asAcc.allowedActions.find((a) => a.id === 'edit').reason, /Only pm1, who raised this request/);
  const sent = await submit(api, draft);
  assert.equal(sent.status, 'SUBMITTED');
  assert.match(sent.docNo, /^MR\/2026-27\/0001$/);
  assert.deepEqual(sent.approval && [sent.approval.status, sent.approval.chain], ['SUBMITTED', ['ACCMGR']]);
  // the same submitted request for three roles
  const forOwner = await get(api, draft.id, pm);
  const forApprover = await get(api, draft.id, acc);
  const forObserver = await get(api, draft.id, sys);
  assert.deepEqual(ids(forOwner), ['cancel', 'print']);
  assert.deepEqual(ids(forApprover), ['print', 'reject', 'return'], 'the approve button waits for the required document');
  assert.match(forApprover.allowedActions.find((a) => a.id === 'approve').reason, /Attach signed indent sheet first/);
  assert.deepEqual(ids(forObserver), ['print']);
  assert.match(forOwner.allowedActions.find((a) => a.id === 'approve').reason, /You raised this request, so someone else must decide it/);
  assert.match(forObserver.allowedActions.find((a) => a.id === 'approve').reason, /Waiting for ACCMGR \(step 1 of 1\)/);
  api.db.prepare("UPDATE core_files SET scan_status = 'CLEAN' WHERE linked_entity = 'sample_request'").run();
  const fileId = attach(api, draft);
  assert.equal((await api.call('POST', `${U}/objects/sample_request/${draft.id}/documents`, { ...pm, headers: key('l'), body: { requirementCode: 'INDENT', fileId } })).status, 201);
  assert.deepEqual(ids(await get(api, draft.id, acc)), ['approve', 'print', 'reject', 'return'], 'with the document attached the approver can approve');
  // the approve button waits for the required document, and says so
  const other = await submit(api, await make(api, (await world2(api)).w));
  const noDoc = await decide(api, other, acc, { action: 'approve' });
  assert.equal(noDoc.status, 422);
  assert.match(noDoc.json.error.message, /Attach signed indent sheet before approving/);
  await api.close();
});

test('FR-02 the approval chain follows the value, the decisions are made and recorded, and the record follows them', async () => {
  const api = await startApi();
  const w = await world(api);
  // a request worth ₹5,00,000 or more also needs the CFO
  const big = await submit(api, await make(api, w, { lines: [{ description: 'Structural steel', uom: 'MT', quantity: '10', unitRate: '60000' }] }));
  assert.deepEqual(big.approval.chain, ['ACCMGR', 'CFO']);
  const file = attach(api, big);
  assert.equal((await api.call('POST', `${U}/objects/sample_request/${big.id}/documents`, { ...pm, headers: key('l'), body: { requirementCode: 'INDENT', fileId: file } })).status, 201);
  // the CFO cannot go before the accounts manager; the requester cannot decide his own; a decision needs the right role
  assert.equal((await decide(api, big, cfo, { action: 'approve' })).status, 403);
  assert.equal((await decide(api, big, { roles: 'ACCMGR', user: 'pm1' }, { action: 'approve' })).status, 403, 'nobody approves their own request');
  const step1 = await decide(api, big, acc, { action: 'approve', comment: 'Within the budget' });
  assert.equal(step1.status, 200, JSON.stringify(step1.json));
  assert.equal(step1.json.data.approval.currentStep, 2);
  assert.equal(step1.json.data.status, 'SUBMITTED');
  const again = await decide(api, step1.json.data, acc, { action: 'approve' });
  assert.equal(again.status, 403, 'one person cannot decide two steps');
  const done = await decide(api, step1.json.data, cfo, { action: 'approve' });
  assert.equal(done.json.data.approval.status, 'APPROVED');
  assert.deepEqual(ids(await get(api, big.id, pm)), ['cancel', 'print']);
  // the panel's data: the rounds, each step with who decided and when, and the clock of the open step
  const view = (await api.call('GET', `${U}/objects/sample_request/${big.id}/approvals`, acc)).json.data;
  assert.equal(view.rounds.length, 1);
  assert.deepEqual(view.rounds[0].steps.map((s) => [s.role, s.state, s.decidedBy]), [['ACCMGR', 'APPROVED', 'acc1'], ['CFO', 'APPROVED', 'cfo1']]);
  assert.equal(view.rounds[0].sla, null, 'a closed approval has no clock');
  assert.equal(view.evidence, null);
  const small = await submit(api, await make(api, w));
  const open = (await api.call('GET', `${U}/objects/sample_request/${small.id}/approvals`, acc)).json.data.rounds[0];
  assert.deepEqual([open.sla.hours, open.sla.overdue, open.steps[0].state], [24, false, 'CURRENT']);
  // reject: a reason code and words are needed; the request is cancelled and keeps its number
  const noWhy = await decide(api, small, acc, { action: 'reject' });
  assert.equal(noWhy.status, 400);
  assert.equal(noWhy.json.error.details[0].field, 'reasonCode');
  assert.equal((await decide(api, small, acc, { action: 'reject', reasonCode: 'OVER_BUDGET' })).status, 400, 'words are needed too');
  const rejected = await decide(api, small, acc, { action: 'reject', reasonCode: 'OVER_BUDGET', comment: 'Over the quarterly budget for this site' });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.json));
  assert.equal(rejected.json.data.status, 'CANCELLED');
  assert.equal(rejected.json.data.docNo, small.docNo);
  const steps = (await api.call('GET', `${U}/objects/sample_request/${small.id}/approvals`, acc)).json.data.rounds[0].steps;
  assert.match(steps[0].comment, /^Over the budget for this work: Over the quarterly budget/);
  assert.equal(api.db.prepare("SELECT status FROM core_number_issues WHERE number = ?").get(small.docNo)?.status ?? 'CANCELLED', 'CANCELLED');
  assert.deepEqual(api.db.prepare("SELECT event_type FROM core_outbox WHERE event_type IN ('ui.sample_request.approved', 'ui.sample_request.rejected') ORDER BY id").all().map((e) => e.event_type), ['ui.sample_request.approved', 'ui.sample_request.rejected']);
  await api.close();
});

test('FR-10 T-03 a returned request is amended and sent again with its number; the comparison marks the changed header and line fields', async () => {
  const api = await startApi();
  const w = await world(api);
  const first = await submit(api, await make(api, w));
  const handed = await decide(api, first, acc, { action: 'return', reasonCode: 'CORRECT_QUANTITY', comment: 'Binding wire is double what the pour needs' });
  assert.equal(handed.json.data.status, 'DRAFT', JSON.stringify(handed.json));
  const returned = { json: { data: await get(api, first.id, pm) } };
  assert.equal(returned.json.data.docNo, first.docNo, 'a returned request keeps its number');
  assert.deepEqual(ids(returned.json.data), ['cancel', 'edit', 'print', 'submit']);
  // the requester changes the title, one quantity, removes nothing and adds a line
  const lineId = returned.json.data.lines[1].id;
  const amended = await api.call('PUT', `${U}/sample-requests/${first.id}`, { ...pm, headers: key('am'), body: {
    ...body(w, { title: 'Footing F3 reinforcement (revised)', requiredBy: '2026-11-08', lines: [{ id: returned.json.data.lines[0].id, description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000' }, { id: lineId, description: 'Binding wire', uom: 'KG', quantity: '50', unitRate: '82.5' }, { description: 'Cover blocks', uom: 'NOS', quantity: '400', unitRate: '6.25' }] }), version: returned.json.data.version } });
  assert.equal(amended.status, 200, JSON.stringify(amended.json));
  const second = await submit(api, amended.json.data);
  assert.equal(second.docNo, first.docNo, 'sent again with the same number');
  assert.equal(second.counts.approvals, 2, 'a new approval round');
  assert.deepEqual(second.approval.status, 'SUBMITTED');
  const versions = (await api.call('GET', `${U}/objects/sample_request/${first.id}/versions`, pm)).json.data;
  assert.deepEqual(versions.map((v) => v.label), ['Original', 'Amendment 1']);
  const diff = (await api.call('GET', `${U}/objects/sample_request/${first.id}/compare?from=1&to=2`, pm)).json.data;
  assert.deepEqual(diff.header.filter((h) => h.changed).map((h) => h.key), ['title', 'requiredBy', 'lineCount', 'total']);
  assert.deepEqual(diff.header.find((h) => h.key === 'title'), { key: 'title', label: 'Title', from: 'Footing F3 reinforcement', to: 'Footing F3 reinforcement (revised)', changed: true });
  assert.deepEqual(diff.lines.map((l) => l.status), ['same', 'changed', 'added']);
  assert.deepEqual(diff.lines[1].fields.filter((f) => f.changed).map((f) => [f.key, f.from, f.to]), [['quantity', '100.000', '50.000'], ['amount', '8250.00', '4125.00']]);
  assert.deepEqual(diff.summary, { headerChanged: 4, linesAdded: 1, linesRemoved: 0, linesChanged: 1 });
  // against the working copy, and an unknown version
  assert.equal((await api.call('GET', `${U}/objects/sample_request/${first.id}/compare?from=2&to=current`, pm)).json.data.summary.headerChanged, 0);
  assert.equal((await api.call('GET', `${U}/objects/sample_request/${first.id}/compare?from=1&to=9`, pm)).status, 404);
  // the commercial values are masked for a viewer who may not see them, in the comparison too
  const masked = (await api.call('GET', `${U}/objects/sample_request/${first.id}/compare?from=1&to=2`, sys)).json.data;
  assert.equal(masked.header.find((h) => h.key === 'total').to, '•••');
  assert.ok(masked.lines.every((l) => l.fields.filter((f) => f.key === 'amount' || f.key === 'unitRate').every((f) => f.to === '•••' || f.to === '' || f.from === '•••')));
  await api.close();
});

test('FR-03 the required documents are checked against the files attached; a file that is not scanned clean does not count', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await submit(api, await make(api, w));
  const docs = (who = pm) => api.call('GET', `${U}/objects/sample_request/${r.id}/documents`, who);
  const before = (await docs()).json.data;
  assert.deepEqual(before.requirements.map((x) => [x.code, x.required, x.satisfied]), [['INDENT', true, false], ['SITE_PHOTO', false, false]]);
  assert.equal(before.complete, false);
  const pending = attach(api, r, 'scan-me.pdf');
  api.db.prepare("UPDATE core_files SET scan_status = 'PENDING' WHERE id = ?").run(pending);
  const link = (fileId, requirementCode = 'INDENT') => api.call('POST', `${U}/objects/sample_request/${r.id}/documents`, { ...pm, headers: key('lk'), body: { requirementCode, fileId } });
  assert.equal((await link(pending)).status, 201);
  assert.equal((await docs()).json.data.complete, false, 'not scanned yet');
  api.db.prepare("UPDATE core_files SET scan_status = 'CLEAN' WHERE id = ?").run(pending);
  assert.equal((await docs()).json.data.complete, true);
  assert.equal((await link(pending)).status, 409, 'already linked');
  assert.equal((await link(99999)).status, 400, 'a file that is not on the record');
  assert.equal((await link(pending, 'NOT_A_DOC')).status, 400);
  const linkId = (await docs()).json.data.requirements[0].files[0].linkId;
  assert.equal((await api.call('DELETE', `${U}/objects/sample_request/${r.id}/documents/${linkId}`, pm)).status, 200);
  assert.equal((await docs()).json.data.complete, false);
  assert.equal((await docs({ ...pm, company: '2' })).status, 404, 'another company sees nothing of it');
  await api.close();
});

test('FR-04 FR-05 FR-06 the timeline merges audit, approval and comments in order; comments mention people; related records link back', async () => {
  const api = await startApi();
  const w = await world(api);
  const doc = (await api.call('POST', '/api/v1/core/sample-documents', { ...pm, headers: key('d'), body: { title: 'Pile cap P7', docDate: today, projectId: w.project.id } })).json.data;
  await api.call('POST', '/api/v1/iam/users', { roles: 'HRMGR', user: 'hr1', headers: key('u'), body: { displayName: 'Anil Verma', email: 'anil@example.com', username: 'anil.verma' } });
  api.db.prepare("UPDATE iam_users SET status = 'ACTIVE' WHERE username = 'anil.verma'").run();
  const r = await submit(api, await make(api, w, { sourceType: 'core.sample_document', sourceId: doc.id }));
  const c1 = await api.call('POST', `${U}/objects/sample_request/${r.id}/comments`, { ...pm, headers: key('c'), body: { body: 'Please check the rate with @anil.verma and @nobody.here' } });
  assert.equal(c1.status, 201, JSON.stringify(c1.json));
  assert.deepEqual(c1.json.data.mentions.map((m) => m.username), ['anil.verma'], 'only people who exist are mentioned');
  assert.equal((await api.call('POST', `${U}/objects/sample_request/${r.id}/comments`, { ...pm, headers: key('c'), body: { body: '   ' } })).status, 400);
  await decide(api, r, acc, { action: 'return', reasonCode: 'CLARIFY_SPEC', comment: 'Which grade of steel is meant?' });
  const tl = (await api.call('GET', `${U}/objects/sample_request/${r.id}/timeline`, acc)).json.data;
  assert.deepEqual(tl.map((e) => e.kind).sort(), ['approval', 'approval', 'audit', 'audit', 'audit', 'comment']);
  assert.ok(tl.every((e, i) => i === 0 || tl[i - 1].at >= e.at), 'newest first');
  assert.ok(tl.some((e) => e.kind === 'approval' && e.action === 'returned' && /Which grade/.test(e.reason ?? '')));
  assert.ok(tl.some((e) => e.kind === 'audit' && e.action === 'create' && e.changes.title.new === 'Footing F3 reinforcement'));
  assert.equal(tl.find((e) => e.kind === 'comment').mentions[0].name, 'Anil Verma');
  assert.equal((await api.call('GET', `${U}/objects/sample_request/${r.id}/comments`, acc)).json.data.length, 1);
  const rel = (await api.call('GET', `${U}/objects/sample_request/${r.id}/related`, acc)).json.data;
  assert.deepEqual(rel.map((x) => [x.kind, x.direction]), [['Source document', 'source'], ['Approval request', 'derived']]);
  assert.match(rel[0].label, /Pile cap P7/);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'ui.comment.created'").get().n, 1);
  // the system administrator sees the timeline with the commercial values masked
  const masked = (await api.call('GET', `${U}/objects/sample_request/${r.id}/timeline`, sys)).json.data;
  assert.equal(masked.find((e) => e.kind === 'audit' && e.action === 'create').changes.total.new, '•••');
  assert.doesNotMatch(JSON.stringify(masked), /\b6,?[0-9]{3}\.[0-9]{2}\b|"13[0-9]{3}\.00"/);
  await api.close();
});

test('BR-02 cancelling, rejecting and returning need a reason code; the codes come from the server; unknown record types and ids are 404', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await submit(api, await make(api, w));
  const codes = (await api.call('GET', `${U}/reason-codes?for=cancel`, pm)).json.data;
  assert.deepEqual(codes.map((c) => c.code), ['DUPLICATE', 'WRONG_PROJECT', 'NO_LONGER_NEEDED', 'SUPERSEDED', 'OTHER']);
  assert.equal(codes.find((c) => c.code === 'OTHER').needsText, true);
  assert.equal((await api.call('GET', `${U}/reason-codes?for=delete`, pm)).status, 400);
  const cancel = (b, who = pm) => api.call('POST', `${U}/sample-requests/${r.id}/cancel`, { ...who, headers: key('x'), body: { version: r.version, ...b } });
  assert.equal((await cancel({ reason: 'Raised by mistake today' })).status, 400, 'a code is needed');
  assert.equal((await cancel({ reasonCode: 'DUPLICATE' })).status, 400, 'and a few words');
  assert.equal((await cancel({ reasonCode: 'NOPE', reason: 'Raised by mistake today' })).status, 400);
  assert.equal((await cancel({ reasonCode: 'DUPLICATE', reason: 'Raised by mistake today' }, { roles: 'PM', user: 'pm2' })).status, 403, 'only the requester cancels');
  const done = await cancel({ reasonCode: 'DUPLICATE', reason: 'Raised by mistake today' });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.status, 'CANCELLED');
  const rounds = (await api.call('GET', `${U}/objects/sample_request/${r.id}/approvals`, pm)).json.data.rounds;
  assert.equal(rounds[0].status, 'CANCELLED', 'the open approval is withdrawn with it');
  assert.equal(api.db.prepare("SELECT reason FROM core_audit_log WHERE entity = 'ui_sample_requests' AND action = 'cancel'").get().reason, 'Duplicate of another request: Raised by mistake today');
  assert.equal((await api.call('GET', `${U}/objects/nothing/1/timeline`, pm)).status, 404);
  assert.equal((await api.call('GET', `${U}/objects/sample_request/9999/timeline`, pm)).status, 404);
  assert.equal((await api.call('GET', `${U}/objects/sample_request/${r.id}/timeline`, { roles: 'EMP', user: 'e1' })).status, 403);
  await api.close();
});

test('FR-09 print writes a PDF of the record, audited, with the commercial values masked for those who may not see them', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await submit(api, await make(api, w));
  const pdf = await api.raw('GET', `${U}/objects/sample_request/${r.id}/print`, pm);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /sample-request-MR-2026-27-0001\.pdf/);
  const text = pdf.buffer.toString('latin1');
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /Sample material request MR\/2026-27\/0001/);
  assert.match(text, /TMT bar 12 mm/);
  assert.match(text, /Printed by pm1/);
  assert.match(text, /Total Rs\.1,53,250\.00/);
  const masked = (await api.raw('GET', `${U}/objects/sample_request/${r.id}/print`, sys)).buffer.toString('latin1');
  assert.doesNotMatch(masked, /1,53,250|58000|153250/);
  assert.match(masked, /Total /);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'ui_sample_requests' AND action = 'print'").get().n, 2);
  await api.close();
});

test('the record answers masked for a viewer without the commercial right: total, rates and amounts', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await submit(api, await make(api, w));
  const seen = await get(api, r.id, sys);
  assert.equal(seen.total, '•••');
  assert.ok(seen.lines.every((l) => l.unitRate === '•••' && l.amount === '•••'));
  assert.equal((await get(api, r.id, pm)).total, '153250.00');
  await api.close();
});

test('T-02 an error carries a correlation ID that is the one the caller sent and the one in the server log', async () => {
  const lines = [];
  const api = await startApi({}, { logger: createLogger({ write: (l) => lines.push(l) }) });
  const id = 'corr-0001-object-page';
  const res = await api.call('GET', `${U}/objects/sample_request/424242/timeline`, { ...pm, headers: { 'x-correlation-id': id } });
  assert.equal(res.status, 404);
  assert.equal(res.json.error.correlationId, id);
  assert.equal(res.headers.get('x-correlation-id'), id);
  assert.ok(lines.some((l) => l.includes(id)), 'the server log names the same ID');
  const fresh = await api.call('GET', `${U}/objects/sample_request/424242/timeline`, pm);
  assert.match(fresh.json.error.correlationId, /^[0-9a-f-]{36}$/, 'one is made up when the caller sent none');
  await api.close();
});

test('the Object Page additions are hidden while ff.ui.p0304 is OFF; the record itself still opens', async () => {
  const api = await startApi();
  const w = await world(api);
  const r = await make(api, w);
  api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.ui.p0304'").run();
  for (const p of [`${U}/objects/sample_request/${r.id}/timeline`, `${U}/reason-codes?for=cancel`]) assert.equal((await api.call('GET', p, pm)).status, 404, p);
  assert.equal((await api.call('GET', `${U}/sample-requests/${r.id}`, pm)).status, 200);
  await api.close();
});
