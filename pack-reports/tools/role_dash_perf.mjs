#!/usr/bin/env node
// PACK-15: role dashboards on three years of data. Boots the application in-process on a file database with every flag on, finds the tables
// each widget of the seven roles reads (by tracing the SQL the widget runs), fills those tables with three years of synthetic rows for the
// company (foreign keys off, every NOT NULL column given a value of its type, CHECK lists given their first value), then times, per role,
// the role dashboard and every widget's data as the page asks for them. The budget is 2 s for the whole dashboard.
//   node pack-reports/tools/role_dash_perf.mjs [--rows-per-day 40] [--out pack-reports/role-dash-perf.json]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(root);
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = resolve(root, opt('--out', 'pack-reports/role-dash-perf.json'));
const PER_DAY = Number(opt('--rows-per-day', 40));
const DB = resolve(root, 'pack-reports/role-dash-perf.sqlite');
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
process.env.DATABASE_PATH = DB;
await import(`${root}/src/server/modules/registry.js`);
const { startApi } = await import(`${root}/tests/helpers.js`);
const { ROLE_WIDGETS } = await import(`${root}/src/server/modules/bi/role-dashboards.js`);
const api = await startApi();
const db = api.db;
const ROLES = { MD: 'DIR', PD: 'PD', PM: 'PM', 'Site Engineer': 'SE', 'Store Keeper': 'SK', QS: 'QS', Accounts: 'ACCMGR' };
const who = (role) => ({ roles: role, user: `perf-${role.toLowerCase()}`, company: '1' });

// every flag on for company 1, the gates passed
for (const { key } of db.prepare('SELECT DISTINCT key FROM core_feature_flags WHERE company_id IS NULL').all()) db.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'perf', 0, 1)").run(key);
db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE company_id = 1").run();
db.exec("INSERT OR IGNORE INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','perf',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','perf',CURRENT_TIMESTAMP)");
const projects = [];
for (let i = 1; i <= 8; i += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 'perf', 'perf')").run(`PF${i}`, `Perf project ${i}`).lastInsertRowid));
const sites = projects.map((p, i) => Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, ?, 'ACTIVE')").run(p, `PF${i + 1}-S`, `Perf site ${i + 1}`).lastInsertRowid));

// the KPI tiles show a figure only once the metric is certified (BR-01) and for a chosen project: certified the application's way (the
// project controls manager asks, the CFO approves), and asked for project 1
const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `perf-${Math.random().toString(36).slice(2, 12)}` });
for (const code of ['spi', 'cpi', 'eac', 'gross-margin', 'revenue-to-date', 'dso', 'stock-turns', 'ltifr']) {
  const req = await api.call('POST', '/api/v1/bi/metrics/certifications', { roles: 'PCMGR', user: 'perf-pcm', company: '1', headers: key(), body: { code, certify: true, reason: 'Load test fixture' } });
  if (req.status !== 201) { console.error(`certify ${code}: ${req.status} ${JSON.stringify(req.json).slice(0, 120)}`); continue; }
  const ok = await api.call('POST', `/api/v1/bi/metrics/certifications/${req.json.data.id}/act`, { roles: 'CFO', user: 'perf-cfo', company: '1', headers: key(), body: { action: 'approve', version: req.json.data.version } });
  if (ok.status !== 200) console.error(`approve ${code}: ${ok.status} ${JSON.stringify(ok.json).slice(0, 120)}`);
}
const query = (w) => (w.startsWith('bi.') && !['bi.exec_alerts', 'bi.work_done_today', 'bi.why_cost', 'bi.leakage_open'].includes(w) ? `?projectId=${projects[0]}` : '');
// 1. which tables does each widget read? (trace the SQL of one call per widget and role)
const seen = new Set();
const prepare = db.prepare.bind(db);
db.prepare = (sql) => { for (const m of String(sql).matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]+)/gi)) seen.add(m[1]); return prepare(sql); };
for (const [, role] of Object.entries(ROLES)) for (const w of ROLE_WIDGETS[role] ?? []) await api.call('GET', `/api/v1/ui/widgets/${w}/data${query(w)}`, who(role));
db.prepare = prepare;
const tables = [...seen].filter((t) => prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t))
  .filter((t) => !/^(core_feature_flags|core_audit_log|core_outbox|core_inbox|org_companies|iam_users|iam_|core_idempotency|ui_widgets|ui_dashboards|core_settings|core_parameters|hr_gates|sqlite_)/.test(t));

// 2. fill them: three years of rows, spread over the projects, sites and days
db.exec('PRAGMA foreign_keys = OFF');
const days = 3 * 365;
const start = Date.UTC(2023, 11, 1);
const filled = {};
for (const t of tables) {
  const cols = prepare(`PRAGMA table_info(${t})`).all();
  const sql = prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(t).sql;
  const firstOf = (name) => { const m = new RegExp(`${name}\\s+[A-Z]+[^,]*CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql) ?? new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  const uniques = prepare(`PRAGMA index_list(${t})`).all().filter((i) => i.unique).flatMap((i) => prepare(`PRAGMA index_info(${i.name})`).all().map((c) => c.name));
  const use = cols.filter((c) => c.name !== 'id' && (c.notnull && c.dflt_value == null || ['company_id', 'org_project_id', 'project_id', 'site_id', 'org_site_id'].includes(c.name) || /(_date|_at|_on|period_end|date)$/.test(c.name)));
  const ins = prepare(`INSERT OR IGNORE INTO ${t} (${use.map((c) => c.name).join(', ')}) VALUES (${use.map(() => '?').join(', ')})`);
  let n = 0;
  db.exec('BEGIN');
  try {
    for (let d = 0; d < days; d += 1) {
      const day = new Date(start + d * 86_400_000).toISOString();
      for (let k = 0; k < PER_DAY / Math.max(1, Math.min(tables.length / 8, 4)); k += 1) {
        const i = n;
        const vals = use.map((c) => {
          if (c.name === 'company_id') return 1;
          if (['org_project_id', 'project_id'].includes(c.name)) return projects[i % projects.length];
          if (['site_id', 'org_site_id'].includes(c.name)) return sites[i % sites.length];
          if (/(_at)$/.test(c.name)) return day;
          if (/(_date|_on|date|period_end)$/.test(c.name)) return day.slice(0, 10);
          if (c.name === 'period') return day.slice(0, 7);
          const ch = firstOf(c.name); if (ch !== null) return /^-?\d+$/.test(ch) ? Number(ch) : ch;
          if (/INT|REAL|NUM/i.test(c.type)) return uniques.includes(c.name) ? i + 1 : (i % 97) + 1;
          return uniques.includes(c.name) || /(_no|code|key|ref)$/.test(c.name) ? `PF-${t}-${i}` : (/json/.test(c.name) ? '{}' : `perf ${i % 50}`);
        });
        try { if (ins.run(...vals).changes) n += 1; } catch { /* a row this filler cannot make: skipped */ }
        if (n === 0 && d > 3) break;
      }
      if (n === 0 && d > 3) break;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); console.error(`fill ${t}: ${e.message}`); }
  filled[t] = n;
}
db.exec('PRAGMA foreign_keys = ON; ANALYZE;');

// 3. time each role: the dashboard, then its widgets one after another (one Node process answers them all, so the sum is the wait)
const out = { at: new Date().toISOString(), days, rowsPerDay: PER_DAY, tablesFilled: filled, roles: {} };
for (const [label, role] of Object.entries(ROLES)) {
  const runs = [];
  for (let rep = 0; rep < 3; rep += 1) {
    const t0 = performance.now();
    const dash = await api.call('GET', '/api/v1/bi/role-dashboard', who(role));
    const per = {};
    for (const w of ROLE_WIDGETS[role] ?? []) { const w0 = performance.now(); const r = await api.call('GET', `/api/v1/ui/widgets/${w}/data${query(w)}`, who(role)); per[w] = { ms: Math.round(performance.now() - w0), status: r.status }; }
    runs.push({ totalMs: Math.round(performance.now() - t0), dashboardStatus: dash.status, widgets: per });
  }
  const best = runs.slice(1).sort((x, y) => x.totalMs - y.totalMs)[0]; // the first run warms the caches; the better of the next two
  out.roles[label] = { role, ...best, firstMs: runs[0].totalMs };
  const slow = Object.entries(best.widgets).sort((x, y) => y[1].ms - x[1].ms).slice(0, 2).map(([w, v]) => `${w} ${v.ms} ms`).join(', ');
  const errors = Object.entries(best.widgets).filter(([, v]) => v.status >= 400).map(([w, v]) => `${w}:${v.status}`);
  console.log(`${label.padEnd(14)} ${role.padEnd(7)} total ${String(best.totalMs).padStart(5)} ms (first ${runs[0].totalMs} ms)  slowest: ${slow}${errors.length ? `  errors: ${errors.join(' ')}` : ''}  ${best.totalMs < 2000 ? 'OK' : 'OVER 2 s'}`);
}
await api.close();
mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(out, null, 1));
console.log(`rows: ${Object.values(filled).reduce((a, b) => a + b, 0)} in ${Object.keys(filled).length} tables`);
for (const s of ['', '-wal', '-shm']) rmSync(DB + s, { force: true });
