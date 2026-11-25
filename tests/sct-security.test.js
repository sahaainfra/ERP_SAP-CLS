import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { enableFlags } from './tst-fixtures.js';
import { CONTROLS, authzFindings, authzMatrix, sastScan } from '../src/server/modules/tst/security.js';
import { ROUTE_POLICY } from '../src/server/platform/security/route-policy.js';

// Part 30.05: security findings and remediation. Scans (authorisation matrix, SAST, secrets; DAST and dependency results posted), findings
// of the independent tester, remediation to closure with an independent re-test, risk acceptance through the director, the DPDP and
// sensitive-path reviews, BR-01 the go-live verdict, roles and export.
const S = '/api/v1/tst/security';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'idempotency-key': `sct-${Date.now().toString(36)}-${(seq += 1)}` });
const lead = { roles: 'ITADM', user: 'seclead' }; const lead2 = { roles: 'ITADM', user: 'itadm2' }; const tester = { roles: 'AUD', user: 'pentester' }; const dir = { roles: 'DIR', user: 'dir1' }; const pm = { roles: 'PM', user: 'pm1' }; const sys = { roles: 'SYSADM', user: 'sys1' };
async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); enableFlags(api.db, 1, ['ff.qa.p3005']);
  for (const [u, r] of [['seclead', 'ITADM'], ['itadm2', 'ITADM'], ['pentester', 'AUD'], ['dir1', 'DIR']]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u, u, JSON.stringify([r]), `${u}@example.com`);
  return { api, d: api.db, call: (who, method, path, body) => api.call(method, `${S}${path}`, { ...who, headers: key(), body }) };
}

test('FR-01 the generator: every route × every role has its expected answer; the policy findings', () => {
  const m = authzMatrix();
  assert.equal(m.length, ROUTE_POLICY.length);
  const users = m.find((x) => x.method === 'GET' && x.path === '/api/v1/tst/security');
  assert.ok(users.holders.includes('ITADM') && users.holders.includes('AUD') && users.denied.includes('PM'));
  assert.equal(users.cases, 45, 'nobody and 44 roles');
  const f = authzFindings([{ m: 'POST', p: '/api/v1/x/things', g: 'public', k: null, scope: 'company', audit: true }, { m: 'POST', p: '/api/v1/x/:token/accept', g: 'public', k: null, scope: 'company', audit: true }, { m: 'GET', p: '/api/v1/x/y', g: 'permission', k: 'x.nobody.has', scope: 'company', audit: false }, { m: 'POST', p: '/api/v1/x/z', g: 'permission', k: 'tst.recon.run', scope: 'company', audit: false }]);
  assert.deepEqual(f.map((x) => [x.rule, x.severity]), [['PUBLIC_WRITE', 'HIGH'], ['PUBLIC_TOKEN_WRITE', 'INFO'], ['UNREACHABLE', 'LOW'], ['UNKNOWN_KEY', 'MEDIUM'], ['NOT_AUDITED', 'LOW']]);
  assert.deepEqual(authzFindings().filter((x) => ['HIGH', 'CRITICAL'].includes(x.severity)), [], 'the application policy has no high finding');
});

test('FR-02 SAST: each rule is found in a planted file; db.exec, a sanitised sink and an allowed line are not', () => {
  const root = mkdtempSync(join(tmpdir(), 'sast-')); mkdirSync(join(root, 'src', 'server'), { recursive: true });
  writeFileSync(join(root, 'src', 'server', 'bad.js'), ["import { execSync } from 'node:child_process';", 'eval(x);', 'execSync(`ls ${dir}`);', "db.prepare(`SELECT * FROM t WHERE a = ${req.query.a}`);", 'const o = { rejectUnauthorized: false };', 'const token = Math.random().toString(36);', 'el.innerHTML = html;', 'res.json({ e: err.stack });', "res.set('Access-Control-Allow-Origin', '*');", "createHash('md5').update(password);", 'eval(y); // sast:allow'].join('\n'));
  writeFileSync(join(root, 'src', 'server', 'ok.js'), ['db.exec(`SAVEPOINT ${sp}`);', "import DOMPurify from 'dompurify';", 'el.innerHTML = DOMPurify.sanitize(html);'].join('\n'));
  const s = sastScan(root);
  assert.equal(s.checked, 2);
  assert.deepEqual(s.findings.map((f) => f.rule).sort(), ['CORS_ANY', 'EVAL', 'EXEC', 'HTML_SINK', 'SQL_CONCAT', 'STACK_LEAK', 'TLS_OFF', 'WEAK_HASH', 'WEAK_RANDOM'].sort());
  assert.ok(s.findings.every((f) => f.endpoint.startsWith('src/server/bad.js:')));
});

test('T-01 FR-01 FR-02 FR-05 scans raise and deduplicate findings; a closed finding seen again reopens; DAST and dependency results are posted', async () => {
  const t = await boot();
  const a = await t.call(lead, 'POST', '/scans', { kind: 'AUTHZ' }); assert.equal(a.status, 201, JSON.stringify(a.json));
  assert.deepEqual([a.json.data.kind, a.json.data.summary.coveragePct, a.json.data.checked], ['AUTHZ', 100, ROUTE_POLICY.length]); assert.ok(a.json.data.summary.cases > 200_000);
  const sast = await t.call(lead, 'POST', '/scans', { kind: 'SAST' }); assert.equal(sast.status, 201); assert.ok(sast.json.data.checked > 1000);
  const again = await t.call(lead, 'POST', '/scans', { kind: 'SAST' }); assert.deepEqual([again.json.data.summary.raised, again.json.data.summary.seen], [0, sast.json.data.findings], 'the second scan raises nothing new');
  const sec = await t.call(lead, 'POST', '/scans', { kind: 'SECRETS' }); assert.equal(sec.status, 201, JSON.stringify(sec.json)); assert.equal(sec.json.data.findings, 0, 'no secret in the repository'); assert.ok(sec.json.data.checked > 1000);
  const dast = await t.call(lead, 'POST', '/scans/results', { kind: 'DAST', checked: 120, findings: [{ severity: 'HIGH', title: 'Reflected input in an error message', endpoint: 'GET /api/v1/mdm/items?q=', cwe: 'CWE-79', rule: 'REFLECT' }, { severity: 'LOW', title: 'Missing Permissions-Policy header', endpoint: 'GET /', rule: 'HEADER' }] });
  assert.equal(dast.status, 201, JSON.stringify(dast.json)); assert.equal(dast.json.data.summary.raised, 2);
  const dep = await t.call(lead, 'POST', '/scans/results', { kind: 'DEPENDENCIES', checked: 812, findings: [{ severity: 'MEDIUM', title: 'xlsx: prototype pollution', endpoint: 'xlsx@0.18.5', cwe: 'GHSA-4r6h-8v6p-xvw6', rule: 'npm-audit' }] });
  assert.equal(dep.status, 201, JSON.stringify(dep.json));
  let o = (await t.call(lead, 'GET', '?status=BLOCKING')).json.data;
  assert.equal(o.goLive.blocked, true); assert.equal(o.goLive.high, 1); assert.equal(o.authzCoverage.pct, 100);
  const high = o.blocking[0]; assert.equal(high.title, 'Reflected input in an error message');
  assert.ok(t.d.prepare("SELECT 1 FROM ntf_notifications WHERE template_code = 'sct.finding.raised'").get() || t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'sct.finding.raised'").get(), 'the security lead is told');
  // fixed by the lead, re-tested by the independent tester; the fixer cannot re-test
  assert.equal((await t.call(lead, 'POST', `/findings/${high.id}/fix`, { fixedIn: 'abc1234def', note: 'Escaped in the error envelope' })).json.data.status, 'FIXED');
  o = (await t.call(lead, 'GET', '')).json.data; assert.equal(o.goLive.blocked, true, 'fixed but not re-tested still blocks');
  assert.equal((await t.call(lead, 'POST', `/findings/${high.id}/retest`, { result: 'PASS', note: 'Checked my own fix' })).status, 403);
  assert.equal((await t.call(lead2, 'POST', `/findings/${high.id}/retest`, { result: 'FAIL', note: 'Still reflected with a double-encoded payload' })).json.data.status, 'OPEN', 'a failed re-test reopens');
  await t.call(lead, 'POST', `/findings/${high.id}/fix`, { fixedIn: 'def5678abc' });
  const closed = await t.call(tester, 'POST', `/findings/${high.id}/retest`, { result: 'PASS', note: 'Payload list of 40 cases: none reflected' }); assert.deepEqual([closed.json.data.status, closed.json.data.retestedBy], ['CLOSED', 'pentester']);
  o = (await t.call(lead, 'GET', '')).json.data; assert.equal(o.goLive.blocked, false, 'BR-01 nothing critical or high is open');
  // the same issue found again by a later scan reopens it
  const re = await t.call(lead, 'POST', '/scans/results', { kind: 'DAST', checked: 120, findings: [{ severity: 'HIGH', title: 'Reflected input in an error message', endpoint: 'GET /api/v1/mdm/items?q=', cwe: 'CWE-79', rule: 'REFLECT' }] });
  assert.equal(re.json.data.summary.reopened, 1); assert.equal((await t.call(lead, 'GET', `/findings/${high.id}`)).json.data.status, 'OPEN');
  const hist = (await t.call(tester, 'GET', `/findings/${high.id}`)).json.data.history.map((h) => h.action); assert.deepEqual(hist, ['create', 'fix', 'retest_fail', 'fix', 'retest_pass', 'reopen']);
});

test('FR-02 FR-05 BR-01 the tester records findings; risk acceptance and false positives need the director; a critical is never accepted', async () => {
  const t = await boot();
  const crit = await t.call(tester, 'POST', '/findings', { source: 'PENTEST', severity: 'CRITICAL', title: 'IDOR: another project\'s DPR opens by changing the id', endpoint: 'GET /api/v1/site/dprs/:id', cwe: 'CWE-639', description: 'As SE of project A, DPR 12 of project B opens.' });
  assert.equal(crit.status, 201, JSON.stringify(crit.json)); assert.equal(crit.json.data.findingNo, 'SEC-00001');
  assert.equal((await t.call(tester, 'POST', '/findings', { source: 'PENTEST', severity: 'CRITICAL', title: 'IDOR: another project\'s DPR opens by changing the id', endpoint: 'GET /api/v1/site/dprs/:id' })).status, 409, 'once');
  assert.equal((await t.call(tester, 'POST', '/findings', { source: 'SAST', severity: 'LOW', title: 'A scan finding typed by hand' })).status, 400);
  const mob = await t.call(tester, 'POST', '/findings', { source: 'MOBILE', severity: 'HIGH', title: 'The offline cache keeps DPR photos after sign-out', endpoint: 'PWA cache erp-field' }); assert.equal(mob.status, 201);
  const low = await t.call(tester, 'POST', '/findings', { source: 'PENTEST', severity: 'MEDIUM', title: 'Verbose server banner on the static host', endpoint: 'GET /' });
  assert.equal((await t.call(lead, 'POST', `/findings/${crit.json.data.id}/risk`, { decision: 'ACCEPT', reason: 'Business wants to go live first', until: '2027-01-31' })).status, 422, 'a critical is fixed, never accepted');
  assert.equal((await t.call(lead, 'POST', `/findings/${mob.json.data.id}/risk`, { decision: 'ACCEPT', reason: 'Field app pilot only on company phones' })).status, 400, 'an acceptance has an end date');
  const req = await t.call(lead, 'POST', `/findings/${mob.json.data.id}/risk`, { decision: 'ACCEPT', reason: 'Field app pilot only on company phones with MDM wipe', until: '2027-01-31' });
  assert.equal(req.status, 201, JSON.stringify(req.json)); assert.equal(req.json.data.finding.status, 'RISK_PENDING');
  let o = (await t.call(dir, 'GET', '')).json.data; assert.deepEqual([o.goLive.critical, o.goLive.high], [1, 1], 'a pending decision still blocks');
  assert.equal((await t.call(lead, 'POST', `/risk-requests/${req.json.data.request.id}/act`, { action: 'approve' })).status, 403, 'the requester never decides');
  assert.equal((await t.call(dir, 'POST', `/risk-requests/${req.json.data.request.id}/act`, { action: 'approve', comment: 'Accepted until January with MDM' })).json.data.status, 'APPROVED');
  assert.equal((await t.call(dir, 'GET', `/findings/${mob.json.data.id}`)).json.data.status, 'ACCEPTED');
  const fp = await t.call(lead, 'POST', `/findings/${low.json.data.id}/risk`, { decision: 'FALSE_POSITIVE', reason: 'The banner is the CDN, not our server' });
  assert.equal((await t.call(dir, 'POST', `/risk-requests/${fp.json.data.request.id}/act`, { action: 'reject', comment: 'Hide the banner instead' })).json.data.status, 'REJECTED');
  assert.equal((await t.call(lead, 'GET', `/findings/${low.json.data.id}`)).json.data.status, 'OPEN', 'refused: open again');
  await t.call(lead, 'POST', `/findings/${crit.json.data.id}/fix`, { fixedIn: '0a1b2c3d' }); await t.call(tester, 'POST', `/findings/${crit.json.data.id}/retest`, { result: 'PASS', note: 'Another project\'s DPR now answers 404' });
  o = (await t.call(dir, 'GET', '')).json.data; assert.equal(o.goLive.blocked, false);
  assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'sct_findings' AND action = 'risk_accepted'").get());
});

test('FR-03 FR-04 the DPDP checklist and the sensitive paths: every control reviewed; a gap raises a finding', async () => {
  const t = await boot();
  assert.ok(CONTROLS.filter((c) => c.area === 'DPDP').length >= 10); assert.deepEqual(CONTROLS.filter((c) => c.area === 'PATH').map((c) => c.code), ['PATH-UPLOAD', 'PATH-EXPORT', 'PATH-AI', 'PATH-WEBHOOK', 'PATH-SOCKET', 'PATH-PWA']);
  let o = (await t.call(lead, 'GET', '')).json.data; assert.equal(o.reviews.unreviewed, CONTROLS.length);
  for (const c of CONTROLS) {
    const gap = c.code === 'DPDP-07';
    const r = await t.call(lead, 'POST', '/reviews', { controlCode: c.code, status: gap ? 'GAP' : 'PASS', evidence: gap ? 'No breach register or 72-hour procedure for the Data Protection Board' : `Reviewed ${c.label} against the code and the running system`, ...(gap ? { severity: 'HIGH' } : {}) });
    assert.equal(r.status, 201, JSON.stringify(r.json)); assert.equal(Boolean(r.json.data.findingId), gap);
  }
  o = (await t.call(lead, 'GET', '')).json.data; assert.deepEqual([o.reviews.unreviewed, o.reviews.gaps, o.goLive.high], [0, 1, 1]);
  assert.equal(o.blocking[0].source, 'REVIEW'); assert.equal(o.blocking[0].endpoint, 'DPDP-07');
  assert.equal((await t.call(lead, 'POST', '/reviews', { controlCode: 'NOPE', status: 'PASS', evidence: 'Something long enough' })).status, 400);
});

test('AC-03 restricted: the lead, the tester and the director read; only the lead scans and fixes; others are refused; export audited; never cached', async () => {
  const t = await boot();
  const r = await t.call(lead, 'GET', ''); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(r.json.data.can, { record: true, manage: true, retest: true, scan: true, review: true, export: true });
  assert.deepEqual((await t.call(tester, 'GET', '')).json.data.can, { record: true, manage: false, retest: true, scan: false, review: false, export: true });
  assert.equal((await t.call(dir, 'GET', '')).status, 200); assert.equal((await t.call(sys, 'GET', '')).status, 200);
  for (const who of [pm, { roles: 'CFO', user: 'cfo1' }, { roles: 'HRMGR', user: 'hr1' }]) assert.equal((await t.call(who, 'GET', '')).status, 403, who.roles);
  assert.equal((await t.call(tester, 'POST', '/scans', { kind: 'SAST' })).status, 403); assert.equal((await t.call(sys, 'POST', '/findings', { source: 'PENTEST', severity: 'LOW', title: 'A title long enough' })).status, 403);
  const f = await t.call(tester, 'POST', '/findings', { source: 'PENTEST', severity: 'LOW', title: 'Autocomplete on the password field' });
  assert.equal((await t.call(tester, 'POST', `/findings/${f.json.data.id}/fix`, { fixedIn: 'abcdef12' })).status, 403);
  const x = await t.api.raw('GET', `${S}/export?format=csv`, tester); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /Autocomplete/);
  assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'report' AND entity_id = 'sct.findings'").get());
  assert.equal((await t.call({ ...lead, company: '2' }, 'GET', '')).status, 404, 'the flag is per company');
  assert.equal((await t.call(lead, 'GET', `/findings/${f.json.data.id + 999}`)).status, 404);
});
