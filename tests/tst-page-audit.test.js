import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { CHECKLIST, registeredPages, scanFile } from '../src/server/modules/tst/pageaudit.js';
import { setupCompany, startApi } from './helpers.js';
import { enableFlags } from './tst-fixtures.js';

// Part 30.03 — page-by-page completion audit.
//  T-01  the crawl covers 100 % of the registered routes: results for every route make the coverage complete; a route that is not a
//        registered page is refused; a missing route is reported.
//  FR-01 the inventory is the client page registry joined with the navigation registry and the migration tracker (pattern, owner).
//  FR-02 the static scan finds buttons without a handler, dead links, placeholder text, hard-coded figures, data pages without their states,
//        console output; the application's own pages scan clean (the defects found were fixed in this part).
//  FR-03 a manual audit answers every checklist point, needs a note for a failed point and a defect behind it; evidence is a file of the audit.
//  FR-04 a defect is fixed with the commit and test named, or rescheduled with the page owner's approval (never by its requester).
//  BR-01 go-live is blocked while a business page of the navigation fails, has an open defect or was never checked.
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const QA = { roles: 'ITADM', user: 'qa-lead', company: '1' };
const PA = '/api/v1/tst/page-audits';
const key = () => ({ 'idempotency-key': `pa-${Math.random().toString(36).slice(2)}` });
async function world() { const api = await startApi(); opened.push(api); await setupCompany(api); enableFlags(api.db, 1); return { api, d: api.db }; }
const allPass = (over = {}) => CHECKLIST.map((c) => ({ code: c.code, result: over[c.code] ?? 'PASS', ...(over[c.code] === 'FAIL' ? { note: 'Export ignores the filters' } : {}) }));
async function crawlAll(w, pages, viewport, fail = {}) {
  let runId = null; let out = null;
  for (let i = 0; i < pages.length; i += 150) {
    const batch = pages.slice(i, i + 150).map((p) => ({ route: p.route, state: 'content', consoleErrors: fail[p.route] ? [fail[p.route]] : [], failedRequests: [], overflowPx: 0, loadMs: 400 }));
    const r = await w.api.call('POST', `${PA}/crawl`, { ...QA, headers: key(), body: { viewport, role: 'ALL_INTERNAL', results: batch, ...(runId ? { runId } : {}), final: i + 150 >= pages.length } });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    runId = r.json.data.id; out = r.json.data;
  }
  return out;
}

test('FR-01 T-01 the inventory holds every registered page; a crawl of every route gives 100 % coverage; an unknown route is refused', async () => {
  const w = await world();
  const reg = registeredPages().filter((p) => !p.onboardingOnly);
  const inv = await w.api.call('GET', `${PA}?pageSize=200`, QA);
  assert.equal(inv.status, 200, JSON.stringify(inv.json));
  assert.ok(inv.json.data.totals.pages >= reg.length && reg.length > 600, `${inv.json.data.totals.pages} pages, ${reg.length} registered`);
  assert.equal(inv.json.data.totals.notTested, inv.json.data.totals.pages, 'nothing tested yet');
  assert.equal(inv.json.data.goLive.blocked, true, 'BR-01: never checked blocks go-live');
  const mine = await w.api.call('GET', `${PA}?q=integration-matrix`, QA);
  assert.deepEqual(mine.json.data.rows.map((p) => [p.route, p.pattern, p.owner, p.inNav]), [['/admin/integration-matrix', 'REPORT', 'ITADM', true]]);
  // a partial crawl reports what is missing; the last batch closes the run
  const half = await w.api.call('POST', `${PA}/crawl`, { ...QA, headers: key(), body: { viewport: 'mobile', results: reg.slice(0, 10).map((p) => ({ route: p.route, state: 'content' })) } });
  assert.equal(half.status, 201);
  assert.equal(half.json.data.coverage.crawled, 10);
  assert.equal(half.json.data.coverage.missingCount, half.json.data.coverage.registered - 10);
  const bad = await w.api.call('POST', `${PA}/crawl`, { ...QA, headers: key(), body: { viewport: 'mobile', results: [{ route: '/no/such/page', state: 'content' }] } });
  assert.equal(bad.status, 400);
  const full = await crawlAll(w, reg, 'mobile');
  assert.equal(full.coverage.pct, 100, JSON.stringify(full.coverage.missing));
  assert.equal(full.coverage.missingCount, 0);
  assert.equal(full.pages, reg.length);
  // a finished crawl takes no more batches
  const late = await w.api.call('POST', `${PA}/crawl`, { ...QA, headers: key(), body: { viewport: 'mobile', runId: full.id, results: [{ route: reg[0].route, state: 'content' }] } });
  assert.equal(late.status, 409);
});

test('FR-02 the static scan finds dummy buttons, dead links, placeholder text, hard-coded figures, missing states and console output', () => {
  const root = mkdtempSync(join(tmpdir(), 'pa-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'Bad.jsx'), [
    "import { useQuery } from '@tanstack/react-query';",
    'const FIGURES = [{ label: "Revenue", amount: 125000 }, { label: "Cost", amount: 98000 }];',
    'export default function Bad() {',
    "  const q = useQuery({ queryKey: ['x'], queryFn: () => 1 });",
    '  console.log(q);',
    '  return <section><button type="button" className="btn" disabled={q.data > 1}>Approve</button><a href="#">Details</a><p>Coming soon</p>',
    '    <button type="button" onClick={() => 1}>Works</button><button type="button" data-sample>Sample</button></section>;',
    '}',
  ].join('\n'));
  const s = scanFile(root, 'src/Bad.jsx');
  assert.deepEqual(s.findings.map((f) => f.rule).sort(), ['BUTTON_NO_HANDLER', 'CONSOLE_OUTPUT', 'DEAD_LINK', 'HARDCODED_FIGURES', 'NO_ERROR_STATE', 'NO_LOADING_STATE', 'PLACEHOLDER_TEXT']);
  assert.equal(s.findings.find((f) => f.rule === 'BUTTON_NO_HANDLER').line, 6);
  // the application's own pages: clean after this part's fixes
  const findings = [];
  const seen = new Set();
  for (const p of registeredPages()) { if (!p.file || seen.has(p.file)) continue; seen.add(p.file); for (const f of scanFile(process.cwd(), p.file).findings) findings.push(`${p.file}:${f.line} ${f.rule}`); }
  assert.deepEqual(findings, []);
  assert.ok(seen.size > 500);
});

test('FR-03 FR-04 BR-01 a manual audit by role with evidence; a defect fixed, another rescheduled by the page owner; go-live clears when every page passes', async () => {
  const w = await world();
  const reg = registeredPages().filter((p) => !p.onboardingOnly);
  const PM = { roles: 'PM', user: 'pm1', company: '1' };
  const PD = { roles: 'PD', user: 'pd1', company: '1' };
  const code = 'site.dprs';
  assert.ok(reg.some((p) => p.route === '/site/dprs'), 'the DPR page is registered');
  // validation: every point answered, a failed point has a note and a defect
  const missing = await w.api.call('POST', PA, { ...PM, headers: key(), body: { pageCode: code, roleTested: 'SE', checklist: allPass().slice(1) } });
  assert.equal(missing.status, 400);
  assert.match(JSON.stringify(missing.json.error.details), /NAV is missing/);
  const noNote = await w.api.call('POST', PA, { ...PM, headers: key(), body: { pageCode: code, roleTested: 'SE', checklist: allPass().map((c) => (c.code === 'LISTS' ? { code: 'LISTS', result: 'FAIL' } : c)) } });
  assert.equal(noNote.status, 400);
  const noDefect = await w.api.call('POST', PA, { ...PM, headers: key(), body: { pageCode: code, roleTested: 'SE', checklist: allPass({ LISTS: 'FAIL' }) } });
  assert.equal(noDefect.status, 400);
  assert.match(JSON.stringify(noDefect.json.error.details), /defect/);
  const rec = await w.api.call('POST', PA, { ...PM, headers: key(), body: { pageCode: code, roleTested: 'SE', checklist: allPass({ LISTS: 'FAIL' }), defects: [{ title: 'The DPR export ignores the date filter', severity: 'MAJOR', checklist: 'LISTS' }, { title: 'The weather icon has no text alternative', severity: 'MINOR', checklist: 'A11Y' }], notes: 'Tested on a 360 px phone as the site engineer.' } });
  assert.equal(rec.status, 201, JSON.stringify(rec.json));
  const audit = rec.json.data;
  assert.equal(audit.status, 'FAIL');
  assert.equal(audit.kind, 'MANUAL');
  // evidence: only a file attached to this audit
  const file = Number(w.d.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by) VALUES (1, 'k/1', 'dpr-360.png', 'png', 'image/png', 'image', 1200, ?, 'CLEAN', 'tst_page_audit', ?, 'pm1')").run('a'.repeat(64), audit.id).lastInsertRowid);
  const other = Number(w.d.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by) VALUES (1, 'k/2', 'x.png', 'png', 'image/png', 'image', 1200, ?, 'CLEAN', 'hd_tickets', 1, 'pm1')").run('b'.repeat(64)).lastInsertRowid);
  assert.equal((await w.api.call('POST', `${PA}/${audit.id}/evidence`, { ...PM, headers: key(), body: { fileId: other } })).status, 400);
  assert.equal((await w.api.call('POST', `${PA}/${audit.id}/evidence`, { ...QA, headers: key(), body: { fileId: file } })).status, 403, 'only the tester adds evidence');
  const ev = await w.api.call('POST', `${PA}/${audit.id}/evidence`, { ...PM, headers: key(), body: { fileId: file } });
  assert.equal(ev.status, 200, JSON.stringify(ev.json));
  assert.deepEqual(ev.json.data.evidence, [file]);
  // defect 1 fixed with its commit and test; defect 2 rescheduled: the owner (PD for project pages) approves, not the requester
  const fix = await w.api.call('POST', `${PA}/${audit.id}/defects/1/fix`, { ...PM, headers: key(), body: { fixRef: 'commit abc123, e2e/site-dpr.spec.js' } });
  assert.equal(fix.status, 200, JSON.stringify(fix.json));
  assert.equal(fix.json.data.defects[0].status, 'FIXED');
  const rq = await w.api.call('POST', `${PA}/${audit.id}/defects/2/reschedule`, { ...PM, headers: key(), body: { targetPart: '30.07', reason: 'Accessibility pass of the field pages' } });
  assert.equal(rq.status, 201, JSON.stringify(rq.json));
  assert.equal(rq.json.data.audit.defects[1].status, 'RESCHEDULE_REQUESTED');
  const owner = rq.json.data.request.chain[0];
  assert.equal(owner, 'CM', 'the owner the migration tracker names for the DPR page');
  const self = await w.api.call('POST', `${PA}/reschedules/${rq.json.data.request.id}/act`, { roles: 'PM,CM', user: 'pm1', company: '1', headers: key(), body: { action: 'approve' } });
  assert.notEqual(self.status, 200, 'the requester never approves their own request, even holding the owner role');
  assert.equal((await w.api.call('POST', `${PA}/reschedules/${rq.json.data.request.id}/act`, { ...PD, headers: key(), body: { action: 'approve' } })).status, 403, 'another role is not the owner');
  const ok = await w.api.call('POST', `${PA}/reschedules/${rq.json.data.request.id}/act`, { roles: 'CM', user: 'cm1', company: '1', headers: key(), body: { action: 'approve' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const page = await w.api.call('GET', `${PA}/pages/${code}`, QA);
  assert.deepEqual(page.json.data.audits[0].defects.map((x) => [x.status, x.targetPart ?? null]), [['FIXED', null], ['RESCHEDULED', '30.07']]);
  assert.equal(page.json.data.page.openDefects, 0);
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'tst.page_defect.rescheduled'").get().n, 1);
  // BR-01: the manual audit failed, so the page fails until a passing audit; then every page crawled clean and scanned clean → go-live clear
  assert.equal(page.json.data.page.status, 'FAIL');
  assert.equal((await w.api.call('POST', PA, { ...PM, headers: key(), body: { pageCode: code, roleTested: 'SE', checklist: allPass() } })).status, 201);
  const scan = await w.api.call('POST', `${PA}/static-scan`, { ...QA, headers: key(), body: {} });
  assert.equal(scan.status, 201); assert.equal(scan.json.data.failed, 0);
  await crawlAll(w, reg, 'mobile', { '/site/dprs': 'TypeError: x is undefined' });
  let s = (await w.api.call('GET', PA, QA)).json.data;
  assert.equal(s.goLive.blocked, true);
  assert.deepEqual(s.goLive.blocking.map((p) => p.route), ['/site/dprs']);
  await crawlAll(w, reg, 'mobile');
  s = (await w.api.call('GET', PA, QA)).json.data;
  assert.equal(s.goLive.blocked, false, JSON.stringify(s.goLive.blocking));
  assert.equal(s.totals.failed, 0);
});

test('AC-03 roles: SE 403, a module owner reads and records, AUD reads but neither crawls nor scans, another company; export audited', async () => {
  const w = await world();
  assert.equal((await w.api.call('GET', PA, { roles: 'SE', user: 'se1', company: '1' })).status, 403);
  assert.equal((await w.api.call('GET', PA, { roles: 'PROCMGR', user: 'pm', company: '1' })).status, 200);
  const AUD = { roles: 'AUD', user: 'aud1', company: '1' };
  assert.equal((await w.api.call('GET', PA, AUD)).status, 200);
  assert.equal((await w.api.call('POST', `${PA}/static-scan`, { ...AUD, headers: key(), body: {} })).status, 403);
  assert.equal((await w.api.call('POST', `${PA}/crawl`, { ...AUD, headers: key(), body: { viewport: 'desktop', results: [{ route: '/admin/page-audit', state: 'content' }] } })).status, 403);
  assert.equal((await w.api.call('POST', PA, { ...AUD, headers: key(), body: { pageCode: 'site.dprs', roleTested: 'SE', checklist: allPass() } })).status, 403);
  assert.equal((await w.api.call('GET', PA, { ...QA, company: '2' })).status, 404, 'the flag is off in company 2');
  assert.equal((await w.api.call('GET', `${PA}/pages/no.such.page`, QA)).status, 404);
  assert.equal((await w.api.call('POST', PA, { ...QA, headers: key(), body: { pageCode: 'no.such.page', roleTested: 'SE', checklist: allPass() } })).status, 400);
  const x = await w.api.raw('GET', `${PA}/export?format=xlsx&module=tst`, AUD);
  assert.equal(x.status, 200);
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'report' AND entity_id = 'tst.page_audit' AND action = 'export'").get().n, 1);
  assert.equal((await w.api.raw('GET', `${PA}/export?format=xlsx`, { roles: 'PROCMGR', user: 'pm', company: '1' })).status, 403, 'module owners do not export the whole audit');
});
