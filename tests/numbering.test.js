import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ROOT, migrateUp, openDatabase, transaction } from '../src/server/platform/db/index.js';
import { runChecks } from '../src/server/platform/integrity/index.js';
import '../src/server/modules/registry.js';
import { cancelNumber, issueNumber, previewNumber } from '../src/server/modules/core/numbering/service.js';
import { createApp } from '../src/server/app.js';
import { silentLogger } from '../src/server/platform/http/logger.js';
import { STATUTORY_MAX_LENGTH, formatNumber, formatProblems, parseFormat, periodKeyFor, tokensUsed } from '../src/shared/numbering.js';
import { admin, setupCompany, startApi, testConfig } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `key-${n}-${Math.random().toString(36).slice(2, 10)}` });

// ---- the format language (shared by the server and the format builder in the browser) ----
test('format tokens produce the number text', () => {
  const v = { prefix: 'INV', branch: 'MUM', project: 'P017', fy: '2026-27', date: '2026-10-15', seq: 42 };
  assert.equal(formatNumber('{PREFIX}/{PROJECT}/{FY}/{SEQ:6}', v), 'INV/P017/2026-27/000042');
  assert.equal(formatNumber('{PREFIX}-{FYS}-{SEQ:4}', v), 'INV-2627-0042');
  assert.equal(formatNumber('{BRANCH}/{YYYY}{MM}{DD}/{SEQ:3}', v), 'MUM/20261015/042');
  assert.equal(formatNumber('{YY}{MM}-{SEQ:5}', v), '2610-00042');
  assert.equal(formatNumber('X{SEQ:2}', { ...v, seq: 12345 }), 'X12345', 'a number past its width grows rather than wraps');
  assert.throws(() => formatNumber('{PROJECT}/{SEQ:4}', { ...v, project: undefined }), /needs a project code/);
});

test('a format must contain exactly one {SEQ:n} and only known tokens and safe characters', () => {
  assert.match(parseFormat('{PREFIX}').problems.join(), /exactly one \{SEQ:n\}/);
  assert.match(parseFormat('{SEQ:3}{SEQ:3}').problems.join(), /exactly one/);
  assert.match(parseFormat('{SEQ}').problems.join(), /width from 1 to 10/);
  assert.match(parseFormat('{SEQ:11}').problems.join(), /width from 1 to 10/);
  assert.match(parseFormat('{NOPE}{SEQ:3}').problems.join(), /not a known token/);
  assert.match(parseFormat('A B{SEQ:3}').problems.join(), /characters that are not allowed/);
  assert.match(parseFormat('{PREFIX{SEQ:3}').problems.join(), /./);
  assert.deepEqual(parseFormat('{PREFIX}/{FY}/{SEQ:6}').problems, []);
  assert.deepEqual([...tokensUsed('{PREFIX}/{FY}/{SEQ:6}')].sort(), ['FY', 'PREFIX', 'SEQ']);
});

test('reset rules need the year or month in the number, or numbers would repeat', () => {
  assert.match(formatProblems('{PREFIX}/{SEQ:6}', { resetRule: 'financial_year' }).join(), /needs \{FY\}/);
  assert.deepEqual(formatProblems('{PREFIX}/{FY}/{SEQ:6}', { resetRule: 'financial_year' }), []);
  // a calendar year alone repeats: Feb 2027 (FY 2026-27) and Apr 2027 (FY 2027-28) both read 2027
  assert.match(formatProblems('{PREFIX}/{YYYY}/{SEQ:6}', { resetRule: 'financial_year' }).join(), /needs \{FY\}/);
  assert.deepEqual(formatProblems('{PREFIX}/{YYYY}{MM}/{SEQ:6}', { resetRule: 'financial_year' }), []);
  assert.match(formatProblems('{PREFIX}/{YYYY}/{SEQ:6}', { resetRule: 'monthly' }).join(), /needs the year .* and \{MM\}/);
  assert.deepEqual(formatProblems('{PREFIX}/{YY}{MM}/{SEQ:4}', { resetRule: 'monthly' }), []);
  assert.deepEqual(formatProblems('{PREFIX}/{SEQ:6}', { resetRule: 'never' }), []);
});

test('a statutory number is at most 16 characters of letters, digits, "/" and "-"', () => {
  assert.equal(STATUTORY_MAX_LENGTH, 16);
  assert.deepEqual(formatProblems('{PREFIX}/{FYS}/{SEQ:6}', { resetRule: 'financial_year', statutory: true, sample: { prefix: 'INV' } }), []);
  assert.match(formatProblems('{PREFIX}/{FY}/{SEQ:8}', { resetRule: 'financial_year', statutory: true, sample: { prefix: 'INVOICE' } }).join(), /at most 16 characters; this format can reach/);
  assert.match(formatProblems('{PREFIX}#{FY}-{SEQ:4}', { resetRule: 'financial_year', statutory: true, sample: { prefix: 'A' } }).join(), /may only contain letters, digits/);
});

test('counters restart per financial year or month, or never', () => {
  assert.equal(periodKeyFor('never', { fy: '2026-27', date: '2026-10-15' }), '');
  assert.equal(periodKeyFor('financial_year', { fy: '2026-27', date: '2026-10-15' }), '2026-27');
  assert.equal(periodKeyFor('monthly', { fy: '2026-27', date: '2026-10-15' }), '2026-10');
});

// ---- issuing numbers ----
test('T-01 100 parallel requests produce 100 unique sequential numbers', async () => {
  const api = await startApi();
  await setupCompany(api);
  const results = await Promise.all(
    Array.from({ length: 100 }, (_, i) => api.call('POST', `${C}/numbering/next`, { ...admin(), headers: key(i), body: { docType: 'SAMPLE_DOC', date: '2026-10-15' } })),
  );
  assert.ok(results.every((r) => r.status === 201), results.find((r) => r.status !== 201)?.json?.error?.message);
  const numbers = results.map((r) => r.json.data.number);
  assert.equal(new Set(numbers).size, 100, 'no number was given twice');
  const seqs = results.map((r) => r.json.data.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 100 }, (_, i) => i + 1), 'the sequence is 1 to 100 with no gap');
  assert.ok(numbers.includes('SMP/2026-27/0001') && numbers.includes('SMP/2026-27/0100'));
  await api.close();
});

test('T-01 four processes taking gap-free numbers from one database file at once get 100 unique, gap-free numbers', { timeout: 120000 }, async () => {
  const dir = join(ROOT, '.deploy-test', 'numbering');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'shared.sqlite');
  const db = openDatabase(file);
  migrateUp(db);
  const app = createApp({ config: testConfig({ DATABASE_PATH: file }), db, logger: silentLogger });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const api = {
    call: async (method, path, { body, roles, company, user }) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': company }, body: JSON.stringify(body) });
      return { status: res.status, json: await res.json() };
    },
  };
  const setup = await setupCompany(api, { gapFree: true, format: '{PREFIX}/{FYS}/{SEQ:6}' });
  assert.equal(setup.responses.series.status, 201, JSON.stringify(setup.responses.series.json));
  await new Promise((r) => server.close(r));
  db.close();

  const run = (n) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['tests/helpers/number_worker.mjs', file, '1', '25', String(n)], { cwd: ROOT });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker ${n} failed: ${err}`))));
    });
  const all = (await Promise.all([1, 2, 3, 4].map(run))).flat();
  assert.equal(all.length, 100);
  assert.equal(new Set(all).size, 100, 'no number was handed out twice');

  const check = new DatabaseSync(file, { readOnly: true });
  const seqs = check.prepare('SELECT seq FROM core_number_issues ORDER BY seq').all().map((r) => r.seq);
  assert.deepEqual(seqs, Array.from({ length: 100 }, (_, i) => i + 1), 'the sequence runs 1 to 100');
  assert.equal(check.prepare('SELECT next_value FROM core_number_counters').get().next_value, 101);
  check.close();
});

test('T-02 gap-free: a failed transaction does not consume a number', async () => {
  const api = await startApi();
  await setupCompany(api, { gapFree: true, format: '{PREFIX}/{FYS}/{SEQ:6}' });
  const ctx = { companyId: 1, docType: 'SAMPLE_DOC', date: '2026-10-15', actor: 'tester' };
  const first = transaction(api.db, () => issueNumber(api.db, ctx));
  assert.equal(first.number, 'SMP/2627/000001');
  assert.throws(
    () =>
      transaction(api.db, () => {
        const n = issueNumber(api.db, ctx);
        assert.equal(n.number, 'SMP/2627/000002');
        throw new Error('saving the document failed');
      }),
    /saving the document failed/,
  );
  const next = transaction(api.db, () => issueNumber(api.db, ctx));
  assert.equal(next.number, 'SMP/2627/000002', 'the number the failed document took is given out again');
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_number_issues').get().n, 2);
  assert.throws(() => issueNumber(api.db, ctx), /inside the transaction that saves the document/, 'outside a transaction a gap-free number is refused');
  await api.close();
});

test('a cancelled document keeps its number, the next one continues, and the gap check stays green', async () => {
  const api = await startApi();
  await setupCompany(api, { gapFree: true, format: '{PREFIX}/{FYS}/{SEQ:6}' });
  const ctx = { companyId: 1, docType: 'SAMPLE_DOC', date: '2026-10-15', actor: 'tester' };
  const a = transaction(api.db, () => issueNumber(api.db, ctx));
  const b = transaction(api.db, () => issueNumber(api.db, ctx));
  assert.equal(cancelNumber(api.db, { companyId: 1, docType: 'SAMPLE_DOC', number: a.number }), true);
  assert.equal(cancelNumber(api.db, { companyId: 1, docType: 'SAMPLE_DOC', number: a.number }), false, 'cancelling twice changes nothing');
  const c = transaction(api.db, () => issueNumber(api.db, ctx));
  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3], 'the cancelled number is not reused');
  assert.deepEqual(api.db.prepare('SELECT number, status FROM core_number_issues ORDER BY seq').all().map((r) => r.status), ['CANCELLED', 'ISSUED', 'ISSUED']);
  const gaps = runChecks(api.db).results.find((r) => r.code === 'sequence_gaps');
  assert.equal(gaps.status, 'pass');
  await api.close();
});

test('the integrity suite reports a gap in a gap-free series as a Critical failure', async () => {
  const api = await startApi();
  await setupCompany(api, { gapFree: true, format: '{PREFIX}/{FYS}/{SEQ:6}' });
  const ctx = { companyId: 1, docType: 'SAMPLE_DOC', date: '2026-10-15', actor: 'tester' };
  for (let i = 0; i < 3; i++) transaction(api.db, () => issueNumber(api.db, ctx));
  api.db.exec('DELETE FROM core_number_issues WHERE seq = 2'); // someone deleted a number: forbidden, and detected
  const r = runChecks(api.db).results.find((x) => x.code === 'sequence_gaps');
  assert.equal(r.status, 'fail');
  assert.equal(r.severity, 'Critical');
  assert.deepEqual(r.samples[0].group, { series_id: 1, period_key: '2026-27' });
  await api.close();
});

test('counters restart each financial year, each month, or never, per the reset rule', async () => {
  const api = await startApi();
  await setupCompany(api);
  const sys = admin();
  await api.call('POST', `${C}/financial-years`, { ...sys, body: { startDate: '2027-04-01' } });
  const take = (date) => issueNumber(api.db, { companyId: 1, docType: 'SAMPLE_DOC', date, actor: 't' }).number;
  assert.equal(take('2026-10-15'), 'SMP/2026-27/0001');
  assert.equal(take('2027-03-31'), 'SMP/2026-27/0002');
  assert.equal(take('2027-04-01'), 'SMP/2027-28/0001', 'a new financial year restarts at 1');
  assert.equal(take('2026-11-01'), 'SMP/2026-27/0003', 'an earlier date still uses its own year counter');

  await api.call('PATCH', `${C}/number-series/1`, { ...sys, body: { resetRule: 'monthly', format: '{PREFIX}/{YY}{MM}/{SEQ:3}', version: 1, reason: 'monthly numbering' }, headers: key(1) }).then((r) => {
    assert.equal(r.status, 422, 'a used series cannot be edited directly');
  });
  await api.close();

  const fresh = await startApi();
  await setupCompany(fresh, { resetRule: 'monthly', format: '{PREFIX}/{YY}{MM}/{SEQ:3}' });
  const t = (date) => issueNumber(fresh.db, { companyId: 1, docType: 'SAMPLE_DOC', date, actor: 't' }).number;
  assert.deepEqual([t('2026-10-02'), t('2026-10-30'), t('2026-11-01')], ['SMP/2610/001', 'SMP/2610/002', 'SMP/2611/001']);
  await fresh.close();

  const never = await startApi();
  await setupCompany(never, { resetRule: 'never', format: '{PREFIX}-{SEQ:5}' });
  const n = (date) => issueNumber(never.db, { companyId: 1, docType: 'SAMPLE_DOC', date, actor: 't' }).number;
  assert.deepEqual([n('2026-10-02'), n('2027-05-01')], ['SMP-00001', 'SMP-00002']);
  await never.close();
});

test('the most specific series wins: project, then branch, then the company-wide one', async () => {
  const api = await startApi();
  await setupCompany(api);
  const sys = admin();
  const make = (extra) => api.call('POST', `${C}/number-series`, { ...sys, body: { docType: 'SAMPLE_DOC', prefix: 'X', format: '{PREFIX}-{SEQ:3}', resetRule: 'never', reason: 'scoped series', ...extra } });
  assert.equal((await make({ name: 'Branch', prefix: 'BR', branchCode: 'MUM' })).status, 201);
  assert.equal((await make({ name: 'Project', prefix: 'PR', projectId: 7 })).status, 201);
  assert.equal((await make({ name: 'Project and branch', prefix: 'PB', projectId: 7, branchCode: 'MUM' })).status, 201);
  assert.equal((await make({ name: 'Dup', prefix: 'D', projectId: 7 })).status, 409, 'one series per scope');
  const num = (extra) => issueNumber(api.db, { companyId: 1, docType: 'SAMPLE_DOC', date: '2026-10-15', actor: 't', ...extra }).number;
  assert.equal(num({ projectId: 7, branchCode: 'MUM' }), 'PB-001');
  assert.equal(num({ projectId: 7 }), 'PR-001');
  assert.equal(num({ branchCode: 'MUM' }), 'BR-001');
  assert.equal(num({ branchCode: 'DEL' }), 'SMP/2026-27/0001', 'no series for this branch: the company-wide one is used');
  assert.equal(num({ projectId: 8 }), 'SMP/2026-27/0002');
  await api.close();
});

test('AC-02 the preview is exactly the number that is issued next, and it does not use the number', async () => {
  const api = await startApi();
  await setupCompany(api, { format: '{PREFIX}/{PROJECT}/{FY}/{SEQ:6}' });
  const sys = admin();
  const q = 'docType=SAMPLE_DOC&date=2026-10-15&projectCode=P017';
  for (let i = 0; i < 3; i++) {
    const p1 = await api.call('GET', `${C}/numbering/preview?${q}`, sys);
    const p2 = await api.call('GET', `${C}/numbering/preview?${q}`, sys);
    assert.deepEqual(p1.json.data, p2.json.data, 'previewing twice gives the same answer');
    const issued = await api.call('POST', `${C}/numbering/next`, { ...sys, headers: key(i), body: { docType: 'SAMPLE_DOC', date: '2026-10-15', projectCode: 'P017' } });
    assert.equal(issued.json.data.number, p1.json.data.number);
    assert.equal(issued.json.data.number, `SMP/P017/2026-27/${String(i + 1).padStart(6, '0')}`);
  }
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_number_issues').get().n, 3);
  await api.close();
});

test('asking for a number the wrong way is refused with a message that says what to do', async () => {
  const api = await startApi();
  const sys = admin();
  const ask = (body, o = {}) => api.call('POST', `${C}/numbering/next`, { ...sys, headers: key(1), body, ...o });
  assert.match((await ask({ docType: 'SAMPLE_DOC' })).json.error.message, /No numbering series is set up/);
  await setupCompany(api);
  assert.equal((await ask({ docType: 'NOPE_DOC' })).json.error.code, 'DOCUMENT_TYPE_UNKNOWN');
  const noFy = await ask({ docType: 'SAMPLE_DOC', date: '2030-01-15' });
  assert.equal(noFy.json.error.code, 'FINANCIAL_YEAR_MISSING');
  assert.match(noFy.json.error.message, /15-Jan-2030/);
  assert.equal((await ask({ docType: 'SAMPLE_DOC', point: 'submit' })).json.error.code, 'NUMBERING_POINT_MISMATCH');
  const noKey = await api.call('POST', `${C}/numbering/next`, { ...sys, body: { docType: 'SAMPLE_DOC' } });
  assert.equal(noKey.status, 400);
  assert.deepEqual(noKey.json.error.details.map((d) => d.field), ['Idempotency-Key']);
  assert.equal((await ask({ docType: 'SAMPLE_DOC', companyId: 2 })).status, 403, 'only your own company');
  assert.equal((await ask({ docType: 'SAMPLE_DOC' }, { roles: 'PM' })).status, 403);
  assert.equal((await ask({ docType: 'SAMPLE_DOC', surprise: 1 })).status, 400, 'unknown fields are rejected');
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_number_issues').get().n, 0, 'none of that used a number');
  await api.close();
});

test('a retried request with the same Idempotency-Key returns the same number and uses only one', async () => {
  const api = await startApi();
  await setupCompany(api);
  const h = { 'idempotency-key': 'issue-retry-0001' };
  const a = await api.call('POST', `${C}/numbering/next`, { ...admin(), headers: h, body: { docType: 'SAMPLE_DOC', date: '2026-10-15' } });
  const b = await api.call('POST', `${C}/numbering/next`, { ...admin(), headers: h, body: { docType: 'SAMPLE_DOC', date: '2026-10-15' } });
  assert.equal(a.json.data.number, b.json.data.number);
  assert.equal(b.headers.get('idempotency-replayed'), 'true');
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_number_issues').get().n, 1);
  await api.close();
});

test('a gap-free series cannot be issued over HTTP, because the number would be lost if no document is saved', async () => {
  const api = await startApi();
  await setupCompany(api, { gapFree: true, format: '{PREFIX}/{FYS}/{SEQ:6}' });
  const r = await api.call('POST', `${C}/numbering/next`, { ...admin(), headers: key(1), body: { docType: 'SAMPLE_DOC', date: '2026-10-15' } });
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, 'GAP_FREE_VIA_API');
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_number_issues').get().n, 0);
  await api.close();
});

test('the number is checked: a statutory number over 16 characters is refused when it would be issued', async () => {
  const api = await startApi();
  await setupCompany(api, { gapFree: true, format: '{PREFIX}/{FYS}/{SEQ:6}', prefix: 'SMPL' });
  assert.equal(previewNumber(api.db, { companyId: 1, docType: 'SAMPLE_DOC', date: '2026-10-15' }).number, 'SMPL/2627/000001');
  transaction(api.db, () => issueNumber(api.db, { companyId: 1, docType: 'SAMPLE_DOC', date: '2026-10-15', actor: 't' }));
  api.db.exec('UPDATE core_number_counters SET next_value = 999999999');
  assert.throws(() => previewNumber(api.db, { companyId: 1, docType: 'SAMPLE_DOC', date: '2026-10-15' }), (e) => e.code === 'NUMBER_TOO_LONG' && /at most 16/.test(e.message));
  await api.close();
});
