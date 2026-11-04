import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admin, setupCompany, startApi } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `series-${n}-${Math.random().toString(36).slice(2, 10)}` });
const sys = admin();
const acc = (user = 'asha') => ({ roles: 'ACCMGR', user, company: '1' });
const pm = { roles: 'PM', user: 'pooja', company: '1' };

const newType = (api, body) => api.call('POST', `${C}/document-types`, { ...sys, headers: key('t'), body: { module: 'fin', reason: 'register the document type', ...body } });
const newSeries = (api, body) => api.call('POST', `${C}/number-series`, { ...sys, headers: key('s'), body: { reason: 'create the series', resetRule: 'financial_year', ...body } });

// ---- document types ----
test('FR-03 document types are registered with module, retention, workflow and when they are numbered', async () => {
  const api = await startApi();
  const list = await api.call('GET', `${C}/document-types`, sys);
  assert.deepEqual(list.json.data.map((t) => t.code), ['SAMPLE_DOC', 'DMS_DOC', 'SAMPLE_MR'], 'the reference types are seeded: controlled documents (04.10), the sample document of this part and the sample material request of 03.02');
  const made = await newType(api, { code: 'TAX_INVOICE', name: 'Tax invoice', module: 'fin', retentionClass: 'statutory', statutory: true, assignAt: 'approval', workflowCode: 'FIN_INVOICE', templateId: 'tpl-invoice' });
  assert.equal(made.status, 201);
  assert.deepEqual([made.json.data.assignAt, made.json.data.statutory, made.json.data.workflowCode], ['approval', true, 'FIN_INVOICE']);
  assert.equal((await newType(api, { code: 'TAX_INVOICE', name: 'Again' })).status, 409);
  assert.equal((await newType(api, { code: 'lower case', name: 'Bad code' })).status, 400);
  const rule = await newType(api, { code: 'CREDIT_NOTE', name: 'Credit note', statutory: true, retentionClass: 'standard' });
  assert.equal(rule.status, 422);
  assert.match(rule.json.error.message, /statutory retention class/);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_document_types'").get().n, 1);
  await api.close();
});

test('document types are administered by the System Administrator; the Accounts Manager may read them', async () => {
  const api = await startApi();
  assert.equal((await api.call('GET', `${C}/document-types`, acc())).status, 200);
  assert.equal((await api.call('GET', `${C}/document-types`, pm)).status, 403);
  const denied = await api.call('POST', `${C}/document-types`, { ...acc(), headers: key(1), body: { code: 'XX_DOC', name: 'Nope', module: 'fin', reason: 'trying' } });
  assert.equal(denied.status, 403);
  await api.close();
});

test('once numbers are issued, a document type can no longer change whether it is statutory or when it is numbered', async () => {
  const api = await startApi();
  await setupCompany(api);
  const type = (await api.call('GET', `${C}/document-types`, sys)).json.data[0];
  const cosmetic = await api.call('PATCH', `${C}/document-types/${type.id}`, { ...sys, headers: key(1), body: { name: 'Sample voucher', version: type.version, reason: 'rename' } });
  assert.equal(cosmetic.json.data.name, 'Sample voucher');
  await api.call('POST', `${C}/numbering/next`, { ...sys, headers: key(2), body: { docType: 'SAMPLE_DOC', date: '2026-10-15' } });
  const rule = await api.call('PATCH', `${C}/document-types/${type.id}`, { ...sys, headers: key(3), body: { assignAt: 'submit', version: cosmetic.json.data.version, reason: 'number at submit' } });
  assert.equal(rule.status, 422);
  assert.match(rule.json.error.message, /Numbers have already been issued for SAMPLE_DOC/);
  const stale = await api.call('PATCH', `${C}/document-types/${type.id}`, { ...sys, headers: key(4), body: { name: 'x y', version: type.version, reason: 'stale update' } });
  assert.equal(stale.status, 409);
  await api.close();
});

// ---- series definitions ----
test('FR-04 a series definition is validated: statutory types need gap-free, formats and reset rules must be consistent', async () => {
  const api = await startApi();
  await newType(api, { code: 'TAX_INVOICE', name: 'Tax invoice', retentionClass: 'statutory', statutory: true });
  const notGapFree = await newSeries(api, { docType: 'TAX_INVOICE', name: 'Invoices', prefix: 'INV', format: '{PREFIX}/{FYS}/{SEQ:6}', gapFree: false });
  assert.equal(notGapFree.status, 422);
  assert.match(notGapFree.json.error.message, /statutory document type, so its series must be gap-free/);
  const tooLong = await newSeries(api, { docType: 'TAX_INVOICE', name: 'Invoices', prefix: 'INVOICE', format: '{PREFIX}/{FY}/{SEQ:8}', gapFree: true });
  assert.match(tooLong.json.error.message, /at most 16 characters/);
  const noYear = await newSeries(api, { docType: 'TAX_INVOICE', name: 'Invoices', prefix: 'INV', format: '{PREFIX}/{SEQ:6}', gapFree: true });
  assert.match(noYear.json.error.message, /needs \{FY\}/);
  const noPrefix = await newSeries(api, { docType: 'TAX_INVOICE', name: 'Invoices', prefix: '', format: '{PREFIX}/{FYS}/{SEQ:6}', gapFree: true });
  assert.match(noPrefix.json.error.message, /needs a prefix/);
  const bad = await newSeries(api, { docType: 'TAX_INVOICE', name: 'Invoices', prefix: 'INV', format: '{PREFIX} {SEQ:6}', gapFree: true });
  assert.equal(bad.status, 422);
  assert.equal((await newSeries(api, { docType: 'NOPE', name: 'x y', prefix: 'A', format: 'A{SEQ:3}' })).status, 404);
  const ok = await newSeries(api, { docType: 'TAX_INVOICE', name: 'Invoices', prefix: 'INV', format: '{PREFIX}/{FYS}/{SEQ:6}', gapFree: true });
  assert.equal(ok.status, 201);
  assert.deepEqual([ok.json.data.gapFree, ok.json.data.used, ok.json.data.issued], [true, false, 0]);
  await api.close();
});

test('an unused series can be edited freely; the change is audited with its reason', async () => {
  const api = await startApi();
  const { series } = await setupCompany(api);
  const r = await api.call('PATCH', `${C}/number-series/${series.id}`, { ...sys, headers: key(1), body: { prefix: 'DOC', format: '{PREFIX}-{FYS}-{SEQ:5}', version: series.version, reason: 'shorter format before first use' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.nextNumber, 'DOC-2627-00001');
  const audit = api.db.prepare("SELECT reason, old_values, new_values FROM core_audit_log WHERE entity = 'core_number_series' ORDER BY id DESC LIMIT 1").get();
  assert.equal(audit.reason, 'shorter format before first use');
  assert.equal(JSON.parse(audit.old_values).prefix, 'SMP');
  assert.equal(JSON.parse(audit.new_values).prefix, 'DOC');
  await api.close();
});

test('a used series cannot be edited directly: the change needs an approved request (non-statutory: the System Administrator)', async () => {
  const api = await startApi();
  const { series } = await setupCompany(api);
  const next = async () => (await api.call('POST', `${C}/numbering/next`, { ...sys, headers: key('n'), body: { docType: 'SAMPLE_DOC', date: '2026-10-15' } })).json.data.number;
  assert.equal(await next(), 'SMP/2026-27/0001');

  const direct = await api.call('PATCH', `${C}/number-series/${series.id}`, { ...sys, headers: key(1), body: { format: '{PREFIX}-{FYS}-{SEQ:6}', version: series.version, reason: 'change after use' } });
  assert.equal(direct.status, 422);
  assert.equal(direct.json.error.code, 'CHANGE_REQUEST_REQUIRED');
  assert.equal((await api.call('PATCH', `${C}/number-series/${series.id}`, { ...sys, headers: key(2), body: { name: 'Renamed series', version: series.version, reason: 'rename only' } })).status, 200, 'a rename does not change any number');

  const noKey = await api.call('POST', `${C}/number-series/${series.id}/change-requests`, { ...sys, body: { changes: { format: '{PREFIX}-{FYS}-{SEQ:6}' }, reason: 'format change' } });
  assert.equal(noKey.status, 400, 'an Idempotency-Key is required');
  const req = await api.call('POST', `${C}/number-series/${series.id}/change-requests`, { ...admin('1', 'ravi'), headers: key(3), body: { changes: { format: '{PREFIX}-{FYS}-{SEQ:6}' }, reason: 'longer sequence for volume' } });
  assert.equal(req.status, 202);
  assert.deepEqual([req.json.data.chain, req.json.data.status], [['SYSADM'], 'SUBMITTED'], 'a non-statutory series needs one approval');
  assert.equal(await next(), 'SMP/2026-27/0002', 'until it is approved the old format is used');
  const dupe = await api.call('POST', `${C}/number-series/${series.id}/change-requests`, { ...admin('1', 'ravi'), headers: key(4), body: { changes: { prefix: 'ABC' }, reason: 'another change' } });
  assert.equal(dupe.status, 409);
  assert.equal((await api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...admin('1', 'ravi'), headers: key(5), body: { action: 'approve' } })).status, 403, 'the requester cannot approve');
  const done = await api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...admin('1', 'sunita'), headers: key(6), body: { action: 'approve' } });
  assert.equal(done.json.data.status, 'APPROVED');
  assert.equal(await next(), 'SMP-2627-000003', 'after approval the new format applies and the sequence continues');
  const audit = api.db.prepare("SELECT action FROM core_audit_log WHERE entity = 'core_number_series' AND action = 'change_approved'").all();
  assert.equal(audit.length, 1);
  await api.close();
});

test('a statutory series change needs the System Administrator and then the Accounts Manager, never the same person', async () => {
  const api = await startApi();
  await setupCompany(api, { gapFree: true, format: '{PREFIX}/{FYS}/{SEQ:6}' });
  const series = (await api.call('GET', `${C}/number-series`, sys)).json.data[0];
  const { transaction } = await import('../src/server/platform/db/index.js');
  const { issueNumber } = await import('../src/server/modules/core/numbering/service.js');
  transaction(api.db, () => issueNumber(api.db, { companyId: 1, docType: 'SAMPLE_DOC', date: '2026-10-15', actor: 't' }));
  const req = await api.call('POST', `${C}/number-series/${series.id}/change-requests`, { ...admin('1', 'ravi'), headers: key(1), body: { changes: { prefix: 'SM' }, reason: 'shorter prefix for the new template' } });
  assert.deepEqual(req.json.data.chain, ['SYSADM', 'ACCMGR']);
  const id = req.json.data.id;
  const act = (who, user) => api.call('POST', `${C}/change-requests/${id}/act`, { ...who, user, headers: key('a'), body: { action: 'approve' } });
  assert.equal((await act({ roles: 'ACCMGR', company: '1' }, 'asha')).status, 403, 'step 1 needs the System Administrator');
  assert.equal((await act({ roles: 'SYSADM', company: '1' }, 'sunita')).json.data.currentStep, 2);
  assert.equal((await act({ roles: 'SYSADM,ACCMGR', company: '1' }, 'sunita')).status, 403, 'the same person cannot approve both steps');
  const final = await act({ roles: 'ACCMGR', company: '1' }, 'asha');
  assert.equal(final.json.data.status, 'APPROVED');
  assert.equal((await api.call('GET', `${C}/number-series/${series.id}`, sys)).json.data.prefix, 'SM');
  await api.close();
});

test('a change request that would be invalid or empty is refused when it is raised, not when it is approved', async () => {
  const api = await startApi();
  const { series } = await setupCompany(api);
  await api.call('POST', `${C}/numbering/next`, { ...sys, headers: key(0), body: { docType: 'SAMPLE_DOC', date: '2026-10-15' } });
  const ask = (changes) => api.call('POST', `${C}/number-series/${series.id}/change-requests`, { ...sys, headers: key('c'), body: { changes, reason: 'a considered change' } });
  assert.equal((await ask({ format: '{PREFIX}/{SEQ:6}' })).status, 422, 'would repeat every year');
  assert.equal((await ask({})).status, 400, 'nothing named');
  assert.equal((await ask({ prefix: 'SMP' })).status, 422, 'nothing would change');
  assert.equal((await ask({ seqStart: 50, bogus: 1 })).status, 400, 'unknown fields');
  await api.close();
});

test('a series is listed with its next number and how many numbers it has issued', async () => {
  const api = await startApi();
  await setupCompany(api);
  for (let i = 0; i < 3; i++) await api.call('POST', `${C}/numbering/next`, { ...sys, headers: key(i), body: { docType: 'SAMPLE_DOC' } });
  const list = await api.call('GET', `${C}/number-series?docType=SAMPLE_DOC`, acc());
  assert.deepEqual([list.json.data[0].used, list.json.data[0].issued], [true, 3]);
  assert.match(list.json.data[0].nextNumber, /^SMP\/\d{4}-\d{2}\/0004$/);
  const issues = await api.call('GET', `${C}/numbering/issues?seriesId=${list.json.data[0].id}`, acc());
  assert.equal(issues.json.meta.total, 3);
  assert.deepEqual(issues.json.data.map((i) => i.seq), [3, 2, 1]);
  assert.equal((await api.call('GET', `${C}/number-series/9999`, sys)).status, 404);
  assert.equal((await api.call('GET', `${C}/number-series`, { ...sys, company: '2' })).json.data.length, 0, 'another company sees none of these');
  await api.close();
});

// ---- the sample document: numbering at create or at submit, cancel keeps the number ----
test('FR-04 the document is numbered at the step its type is configured for: create, or submit', async () => {
  const api = await startApi();
  await setupCompany(api);
  const make = (title) => api.call('POST', `${C}/sample-documents`, { ...pm, headers: key('d'), body: { title, docDate: '2026-10-15' } });
  const submit = (d) => api.call('POST', `${C}/sample-documents/${d.id}/submit`, { ...pm, headers: key('s'), body: { version: d.version } });

  const atCreate = (await make('Numbered at create')).json.data;
  assert.equal(atCreate.docNo, 'SMP/2026-27/0001');
  assert.equal((await submit(atCreate)).json.data.docNo, 'SMP/2026-27/0001', 'submitting does not renumber');

  const type = (await api.call('GET', `${C}/document-types`, sys)).json.data[0];
  await api.call('PATCH', `${C}/document-types/${type.id}`, { ...sys, headers: key(1), body: { assignAt: 'submit', version: type.version, reason: 'number at submit' } }).then((r) => assert.equal(r.status, 422, 'blocked: numbers already issued'));
  api.db.exec("UPDATE core_document_types SET assign_at = 'submit'"); // as a fresh installation would have configured it
  const draft = (await make('Numbered at submit')).json.data;
  assert.equal(draft.docNo, null, 'a draft has no number yet');
  const sub = (await submit(draft)).json.data;
  assert.equal(sub.docNo, 'SMP/2026-27/0002');
  assert.equal(sub.status, 'SUBMITTED');
  await api.close();
});

test('cancelling a document keeps its number, and a failed submit leaves the number unused (gap-free)', async () => {
  const api = await startApi();
  await setupCompany(api, { gapFree: true, format: '{PREFIX}/{FYS}/{SEQ:6}' });
  const make = (docDate = '2026-10-15') => api.call('POST', `${C}/sample-documents`, { ...pm, headers: key('d'), body: { title: 'Voucher', docDate } });
  const a = (await make()).json.data;
  const b = (await make()).json.data;
  assert.deepEqual([a.docNo, b.docNo], ['SMP/2627/000001', 'SMP/2627/000002']);
  const cancelled = await api.call('POST', `${C}/sample-documents/${a.id}/cancel`, { ...pm, headers: key('x'), body: { version: a.version, reason: 'raised in error' } });
  assert.equal(cancelled.json.data.status, 'CANCELLED');
  assert.equal(cancelled.json.data.docNo, 'SMP/2627/000001', 'the number stays on the cancelled document');
  assert.equal(api.db.prepare("SELECT status FROM core_number_issues WHERE number = 'SMP/2627/000001'").get().status, 'CANCELLED');
  assert.equal((await make()).json.data.docNo, 'SMP/2627/000003', 'the cancelled number is not reused');
  const failed = await make('2031-01-01'); // no period: refused before a number is taken
  assert.equal(failed.status, 422);
  assert.equal((await make()).json.data.docNo, 'SMP/2627/000004', 'the refused document used no number');
  const dupCancel = await api.call('POST', `${C}/sample-documents/${a.id}/cancel`, { ...pm, headers: key('y'), body: { version: cancelled.json.data.version, reason: 'again by mistake' } });
  assert.equal(dupCancel.status, 422);
  await api.close();
});

test('submitting needs an Idempotency-Key, a current version and only works on drafts; a retry does not renumber', async () => {
  const api = await startApi();
  await setupCompany(api);
  const d = (await api.call('POST', `${C}/sample-documents`, { ...pm, headers: key('d'), body: { title: 'Voucher', docDate: '2026-10-15' } })).json.data;
  const noKey = await api.call('POST', `${C}/sample-documents/${d.id}/submit`, { ...pm, body: { version: d.version } });
  assert.equal(noKey.status, 400);
  assert.equal((await api.call('POST', `${C}/sample-documents/${d.id}/submit`, { ...pm, headers: key(1), body: { version: d.version + 5 } })).status, 409);
  const h = { 'idempotency-key': 'submit-retry-0001' };
  const first = await api.call('POST', `${C}/sample-documents/${d.id}/submit`, { ...pm, headers: h, body: { version: d.version } });
  const retry = await api.call('POST', `${C}/sample-documents/${d.id}/submit`, { ...pm, headers: h, body: { version: d.version } });
  assert.deepEqual(retry.json, first.json);
  assert.equal(retry.headers.get('idempotency-replayed'), 'true');
  const again = await api.call('POST', `${C}/sample-documents/${d.id}/submit`, { ...pm, headers: key(2), body: { version: first.json.data.version } });
  assert.equal(again.status, 422);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_number_issues').get().n, 1);
  await api.close();
});

test('documents are private to their company', async () => {
  const api = await startApi();
  await setupCompany(api);
  await setupCompany(api, { company: '2', prefix: 'TWO' });
  const d1 = (await api.call('POST', `${C}/sample-documents`, { ...pm, headers: key(1), body: { title: 'One', docDate: '2026-10-15' } })).json.data;
  const d2 = (await api.call('POST', `${C}/sample-documents`, { roles: 'PM', user: 'pia', company: '2', headers: key(2), body: { title: 'Two', docDate: '2026-10-15' } })).json.data;
  assert.deepEqual([d1.docNo, d2.docNo], ['SMP/2026-27/0001', 'TWO/2026-27/0001'], 'each company has its own series and counter');
  const mine = await api.call('GET', `${C}/sample-documents`, pm);
  assert.deepEqual(mine.json.data.map((d) => d.title), ['One']);
  const cross = await api.call('POST', `${C}/sample-documents/${d2.id}/submit`, { ...pm, headers: key(3), body: { version: d2.version } });
  assert.equal(cross.status, 404);
  await api.close();
});
