#!/usr/bin/env node
// npm run erp:scope-probe -- [--db data/e2e.sqlite] [--out reports/scope-probe.json]
// Cross-company probe (audit AUD-DEF-012/013, remediation step 0.2). On a scratch copy of a populated database (by default the one the
// E2E run leaves behind), a brand-new company is created and a person of it, holding every internal role with every feature on, asks:
//  - every GET route with one `:id` parameter, for ids 1, 2 and 3 (records of other companies in a populated database);
//  - every GET list route without parameters (a new company owns nothing, so a list must be empty or hold installation-wide rows only).
// A detail answer of 200 with data is a leak unless the route is in ALLOWED below (installation-wide records, company_id NULL).
// A list row whose companyId names another company is a leak. Exit 1 on any leak. The source database is only read (VACUUM INTO).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const source = resolve(root, opt('db', 'data/e2e.sqlite'));
const out = resolve(root, opt('out', 'reports/scope-probe.json'));

/** Routes that answer installation-wide records (company_id NULL) or a check result about nobody; reviewed 2026-11-24. */
export const ALLOWED = Object.freeze({
  '/api/v1/core/jobs/:id': 'system jobs are installation-wide (core_jobs.company_id NULL)',
  '/api/v1/fin/posting-rules/:id': 'the standard posting rules are installation-wide templates (company_id NULL)',
  '/api/v1/iam/roles/:id': 'the system roles are installation-wide',
  '/api/v1/pay/statutory-params/:id': 'statutory rates are national (company_id NULL)',
  '/api/v1/tpl/templates/:id': 'the standard document templates are installation-wide',
  '/api/v1/admin/archive/erasures/check/:id': 'answers "no such employee" for a person outside the company: no data',
});

const hasData = (d) => d != null && !(Array.isArray(d) && d.length === 0) && !(typeof d === 'object' && !Array.isArray(d) && Array.isArray(d.rows) && d.rows.length === 0 && Object.keys(d).length <= 2);

export async function probe(file, { log = console.log } = {}) {
  const { createApp } = await import('../src/server/app.js');
  await import('../src/server/modules/registry.js');
  const { loadConfig } = await import('../src/server/platform/config/index.js');
  const { ROUTE_POLICY } = await import('../src/server/platform/security/route-policy.js');
  const { TEMPLATE_PERMISSIONS } = await import('../src/server/platform/authz/templates.js');
  const { securityOf } = await import('../src/server/platform/security/index.js');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = OFF');
  const z = Number(db.prepare("INSERT INTO org_companies (code, legal_name, short_name, created_by) VALUES ('SCOPEPROBE', 'Scope Probe', 'Probe', 'scope-probe') RETURNING id").get().id);
  for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, ?, 'scope probe', 0, 1)").run(key, z);
  const roles = Object.keys(TEMPLATE_PERMISSIONS).filter((c) => !/^X-/.test(c)).join(',');
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } };
  const app = createApp({ config: loadConfig({ NODE_ENV: 'test', DATABASE_PATH: file, AUTH_MODE: 'dev-headers' }), db, logger: quiet });
  securityOf(db).limiter.suspend(true);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const H = { 'x-erp-user': 'scope-probe', 'x-erp-roles': roles, 'x-erp-company': String(z) };
  const result = { company: z, detailRoutes: 0, listRoutes: 0, leaks: [], allowed: [] };
  const gets = ROUTE_POLICY.filter((r) => r.m === 'GET' && r.p.startsWith('/api/v1/') && r.g !== 'public');
  try {
    for (const r of gets.filter((x) => (x.p.match(/:/g) ?? []).length === 1 && /\/:id($|\/)/.test(x.p))) {
      result.detailRoutes += 1;
      for (const n of [1, 2, 3]) {
        const url = r.p.replace(':id', String(n));
        if (/export|pdf|print|download|content/.test(url)) continue;
        const res = await fetch(base + url, { headers: H });
        const body = await res.json().catch(() => null);
        if (res.status !== 200 || !hasData(body?.data)) continue;
        if (ALLOWED[r.p]) { if (!result.allowed.includes(r.p)) result.allowed.push(r.p); continue; }
        result.leaks.push({ kind: 'detail', route: r.p, id: n, sample: JSON.stringify(body.data).slice(0, 200) });
        break;
      }
    }
    for (const r of gets.filter((x) => !x.p.includes(':'))) {
      result.listRoutes += 1;
      const res = await fetch(base + r.p, { headers: H }); if (res.status !== 200) continue;
      const body = await res.json().catch(() => null); const d = body?.data;
      const rows = Array.isArray(d) ? d : Array.isArray(d?.rows) ? d.rows : Array.isArray(d?.items) ? d.items : [];
      const foreign = rows.filter((x) => x && typeof x === 'object' && ((x.companyId != null && x.companyId !== z) || (x.company_id != null && x.company_id !== z)));
      if (foreign.length) result.leaks.push({ kind: 'list', route: r.p, rows: foreign.length, sample: JSON.stringify(foreign[0]).slice(0, 200) });
    }
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
  }
  log(`Scope probe: ${result.detailRoutes} detail routes x ids 1-3, ${result.listRoutes} list routes as a new company; ${result.allowed.length} allowed installation-wide routes; ${result.leaks.length} leak(s).`);
  for (const l of result.leaks) log(`  LEAK ${l.kind} ${l.route}${l.id ? ` (id ${l.id})` : ''}: ${l.sample}`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(source)) { console.log(`Scope probe skipped: no populated database at ${source} (run the E2E suite first).`); process.exit(0); }
  const dir = mkdtempSync(join(tmpdir(), 'scope-probe-'));
  const copy = join(dir, 'probe.sqlite');
  const src = new DatabaseSync(source, { readOnly: true });
  src.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
  src.close();
  let code;
  try {
    const result = await probe(copy);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
    code = result.leaks.length ? 1 : 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(code);
}
