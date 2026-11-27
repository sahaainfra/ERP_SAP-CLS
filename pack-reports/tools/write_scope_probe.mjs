#!/usr/bin/env node
// PACK-03: the write-route cross-company probe. Extends scripts/scope_probe.mjs (GET only) to POST/PUT/PATCH/DELETE routes.
//
//   node pack-reports/tools/write_scope_probe.mjs [--db data/e2e.sqlite] [--out pack-reports/write-scope-probe.json]
//
// On a scratch copy (VACUUM INTO) of a populated database, a brand-new company is created with a person holding every internal role and
// every flag on. For every write route with exactly one `:id`, ids 1, 2 and 3 (records of other companies in a populated database) are
// sent with a generic body ({ version: 1, reason, comment }) and an idempotency key. Each answer is classified:
//   PASS_404 / PASS_403   the record was not found / the action refused: the expected answer for another company's id
//   FOUND_409             a version conflict or business-rule refusal that names the record: the service found another company's record
//                         (existence disclosed, nothing written); listed for review
//   INCONCLUSIVE_4XX      400/422 validation before the record was looked up: the body did not get far enough to tell
//   WRITE_2XX             the write was accepted: a fingerprint of every other company's rows (count, sum of version, max of
//                         updated_at per table with company_id) is compared before and after; CROSS_COMPANY_WRITE if it changed
//   ERROR_5XX             a server error (reported)
// The source database is only read. Exit 1 on any CROSS_COMPANY_WRITE.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(root);
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const source = resolve(root, opt('db', 'data/e2e.sqlite'));
const out = resolve(root, opt('out', 'pack-reports/write-scope-probe.json'));
if (!existsSync(source)) { console.log(`no populated database at ${source} (run the E2E suite first)`); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), 'write-probe-')); const file = join(dir, 'probe.sqlite');
{ const src = new DatabaseSync(source, { readOnly: true }); src.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`); src.close(); }

const { createApp } = await import(join(root, 'src/server/app.js'));
await import(join(root, 'src/server/modules/registry.js'));
const { loadConfig } = await import(join(root, 'src/server/platform/config/index.js'));
const { ROUTE_POLICY } = await import(join(root, 'src/server/platform/security/route-policy.js'));
const { TEMPLATE_PERMISSIONS } = await import(join(root, 'src/server/platform/authz/templates.js'));
const { securityOf } = await import(join(root, 'src/server/platform/security/index.js'));

const db = new DatabaseSync(file);
db.exec('PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 10000;');
const z = Number(db.prepare("INSERT INTO org_companies (code, legal_name, short_name, created_by) VALUES ('WRITEPROBE', 'Write Probe', 'WProbe', 'write-probe') RETURNING id").get().id);
for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'write probe', 1, 1)").run(key, z);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name)
  .filter((t) => db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().some((c) => c.name === 'company_id'));
const colsOf = new Map(tables.map((t) => [t, new Set(db.prepare(`PRAGMA table_info(${JSON.stringify(t)})`).all().map((c) => c.name))]));
function fingerprint() {
  const f = {};
  for (const t of tables) {
    const c = colsOf.get(t);
    const parts = ['COUNT(*) AS n', c.has('version') ? 'COALESCE(SUM(version), 0) AS v' : '0 AS v', c.has('updated_at') ? "COALESCE(MAX(updated_at), '') AS u" : "'' AS u", c.has('deleted_at') ? 'SUM(deleted_at IS NOT NULL) AS d' : '0 AS d'];
    const r = db.prepare(`SELECT ${parts.join(', ')} FROM ${JSON.stringify(t)} WHERE company_id IS NOT NULL AND company_id <> ?`).get(z);
    f[t] = `${r.n}|${r.v}|${r.u}|${r.d}`;
  }
  return f;
}
const diff = (a, b) => Object.keys(a).filter((t) => a[t] !== b[t]);

const roles = Object.keys(TEMPLATE_PERMISSIONS).filter((c) => !/^X-/.test(c)).join(',');
const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } };
const app = createApp({ config: loadConfig({ NODE_ENV: 'test', DATABASE_PATH: file, AUTH_MODE: 'dev-headers' }), db, logger: quiet });
securityOf(db).limiter.suspend(true);
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const headers = () => ({ 'x-erp-user': 'write-probe', 'x-erp-roles': roles, 'x-erp-company': String(z), 'content-type': 'application/json', 'idempotency-key': randomUUID() });
const BODY = { version: 1, reason: 'PACK-03 write-route probe', comment: 'PACK-03 write-route probe' };

const writes = ROUTE_POLICY.filter((r) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(r.m) && r.p.startsWith('/api/v1/') && r.g !== 'public' && (r.p.match(/:/g) ?? []).length === 1 && /\/:id($|\/)/.test(r.p));
const result = { company: z, routes: writes.length, requests: 0, counts: {}, inconclusiveByCode: {}, crossCompanyWrites: [], found409: [], errors5xx: [], accepted2xx: [], inconclusiveSamples: [] };
let before = fingerprint();
try {
  for (const r of writes) {
    const verdicts = [];
    for (const n of [1, 2, 3]) {
      const url = r.p.replace(':id', String(n));
      const res = await fetch(base + url, { method: r.m, headers: headers(), body: r.m === 'DELETE' ? undefined : JSON.stringify(BODY) });
      result.requests += 1;
      const body = await res.json().catch(() => null); const code = body?.error?.code ?? ''; const msg = String(body?.error?.message ?? '').slice(0, 160);
      let v;
      if (res.status === 404) v = 'PASS_404';
      else if (res.status === 403 || res.status === 401) v = 'PASS_403';
      else if (res.status >= 500) { v = 'ERROR_5XX'; result.errors5xx.push({ route: `${r.m} ${r.p}`, id: n, code, msg }); }
      else if (res.status === 409) { v = 'FOUND_409'; result.found409.push({ route: `${r.m} ${r.p}`, id: n, code, msg }); }
      else if (res.status >= 400) { v = 'INCONCLUSIVE_4XX'; const k = `${res.status} ${code}`; result.inconclusiveByCode[k] = (result.inconclusiveByCode[k] ?? 0) + 1; if (result.inconclusiveSamples.length < 60 && n === 1) result.inconclusiveSamples.push({ route: `${r.m} ${r.p}`, k, msg }); }
      else {
        const after = fingerprint(); const changed = diff(before, after); before = after;
        if (changed.length) { v = 'CROSS_COMPANY_WRITE'; result.crossCompanyWrites.push({ route: `${r.m} ${r.p}`, id: n, status: res.status, tables: changed.slice(0, 10) }); }
        else { v = 'WRITE_2XX_OWN_COMPANY_ONLY'; result.accepted2xx.push({ route: `${r.m} ${r.p}`, id: n, status: res.status }); }
      }
      verdicts.push(v);
      if (v === 'PASS_404' || v === 'PASS_403') break; // the route answers as it should; the other ids add nothing
    }
    const worst = ['CROSS_COMPANY_WRITE', 'ERROR_5XX', 'FOUND_409', 'WRITE_2XX_OWN_COMPANY_ONLY', 'INCONCLUSIVE_4XX', 'PASS_403', 'PASS_404'].find((x) => verdicts.includes(x));
    result.counts[worst] = (result.counts[worst] ?? 0) + 1;
  }
} finally {
  await new Promise((r) => server.close(r)); db.close(); rmSync(dir, { recursive: true, force: true });
}
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(`Write probe: ${result.routes} write routes with one :id, ${result.requests} requests as a new company:`, JSON.stringify(result.counts), 'inconclusive by code:', JSON.stringify(result.inconclusiveByCode));
for (const w of result.crossCompanyWrites) console.log(`  CROSS-COMPANY WRITE ${w.route} id ${w.id} (${w.status}): ${w.tables.join(', ')}`);
process.exit(result.crossCompanyWrites.length ? 1 : 0);
