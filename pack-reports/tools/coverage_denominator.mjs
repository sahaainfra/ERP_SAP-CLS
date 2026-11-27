#!/usr/bin/env node
// PACK-00: the coverage denominator: one row per client page × role family, used by later packs (02, 44, 48, 52) as the "100 %" a
// coverage claim is measured against. Also writes the orphan report of PACK-00 scope item 3.
//
//   node pack-reports/tools/coverage_denominator.mjs [--out pack-reports]
//
// Read-only: it reads the client route tables (the same parser as e2e/pages.js and scripts/nav_check.mjs), the role templates
// (src/server/platform/authz/templates.js), the route policy, the navigation registry and the flag defaults of a fresh in-memory
// database (migrations only, no seed), and the E2E specs. It changes no tracked file. Re-running it on the same commit gives the same files.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(ROOT);
const args = process.argv.slice(2);
const OUT = resolve(ROOT, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'pack-reports');
mkdirSync(OUT, { recursive: true });

const { ROLE_TEMPLATES } = await import(join(ROOT, 'src/server/platform/authz/templates.js'));
const { ROUTE_POLICY } = await import(join(ROOT, 'src/server/platform/security/route-policy.js'));
const { registeredPages } = await import(join(ROOT, 'e2e/pages.js'));
const { openDatabase, migrateUp } = await import(join(ROOT, 'src/server/platform/db/index.js'));

// ---- role families: the department of each role template (docs/erp/06_ROLE_CATALOGUE.md), external portal roles as one family ----
const FAMILY_OF_DEPARTMENT = {
  'IT and administration': 'IT & administration', Platform: 'IT & administration', Management: 'Management', Finance: 'Finance',
  Procurement: 'Procurement', Commercial: 'Commercial', 'Human resources': 'Human resources', Quality: 'Quality',
  'Project controls': 'Project controls', Projects: 'Projects & site', 'Plant and machinery': 'Plant & machinery', Stores: 'Stores',
  'Health, safety and environment': 'HSE', Security: 'Security', Audit: 'Audit', 'Business development': 'Business development & estimation',
  Estimation: 'Business development & estimation', All: 'Every employee', Portal: 'External portal',
};
const families = new Map();
for (const t of ROLE_TEMPLATES) {
  const fam = FAMILY_OF_DEPARTMENT[t.department] ?? `Unclassified (${t.department})`;
  if (!families.has(fam)) families.set(fam, []);
  families.get(fam).push(t);
}
const heldBy = new Map(); // permission -> role codes
for (const t of ROLE_TEMPLATES) for (const p of t.permissions) { if (!heldBy.has(p)) heldBy.set(p, new Set()); heldBy.get(p).add(t.code); }

// ---- pages: every module folder with an index.js (all of them, not only the crawler's list) ----
const moduleDirs = readdirSync('src/client/modules').filter((m) => existsSync(`src/client/modules/${m}/index.js`)).sort();
const pages = registeredPages(moduleDirs);
const declaredLines = moduleDirs.reduce((n, m) => n + (readFileSync(`src/client/modules/${m}/index.js`, 'utf8').match(/\{ path: '/g) ?? []).length, 0);
const crawlerSrc = readFileSync('e2e/pages.js', 'utf8');
const crawlerModules = new Set([...(/const MODULES = \[([^\]]*)\]/.exec(crawlerSrc)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]).concat('portal'));

// component file of each page: `const X = lazyPage(() => import('./File.jsx'), 'Name')` or a static import
function componentFiles(module) {
  const src = readFileSync(`src/client/modules/${module}/index.js`, 'utf8'); const map = new Map();
  for (const m of src.matchAll(/const (\w+) = lazyPage\(\(\) => import\('([^']+)'\)(?:, '(\w+)')?\)/g)) map.set(m[1], join(`src/client/modules/${module}`, m[2]));
  for (const m of src.matchAll(/import \{([^}]+)\} from '(\.[^']+)'/g)) for (const n of m[1].split(',')) map.set(n.trim().split(/\s+as\s+/).pop(), join(`src/client/modules/${module}`, m[2]));
  for (const m of src.matchAll(/import (\w+) from '(\.[^']+)'/g)) map.set(m[1], join(`src/client/modules/${module}`, m[2]));
  const pageOf = new Map(); for (const m of src.matchAll(/\{ path: '([^']+)'[^}]*?Page: (\w+)(\('[^']*'\))?/g)) pageOf.set(m[1], m[3] ? `${m[2]}${m[3]}` : m[2]);
  return { map, pageOf };
}
const compCache = new Map();
const resolveFile = (f) => [f, `${f}.jsx`, `${f}.js`].find((x) => existsSync(x)) ?? null;

// direct links handled by src/client/App.jsx outside the module tables (PACK-00 scope item 1)
const appSrc = readFileSync('src/client/App.jsx', 'utf8');
const DIRECT = ['/accept-invite', '/offer-response', '/approve-link', '/verify', '/vendor-quote', '/vendor-po'].map((p) => ({ route: p, found: appSrc.includes(`'${p}`) || appSrc.includes(`"${p}`) || appSrc.includes(`\`${p}`) }));

// ---- navigation registry and flag defaults from a fresh database (migrations only) ----
const db = openDatabase(':memory:'); migrateUp(db);
const nav = db.prepare("SELECT code, route, permission_key, feature_flag FROM ui_navigation_entries WHERE kind = 'page' AND is_active = 1").all();
const navByRoute = new Map(nav.map((e) => [e.route, e]));
const flagRows = db.prepare('SELECT key, default_enabled, enabled, environment, company_id, project_id FROM core_feature_flags WHERE deleted_at IS NULL').all();
const flagOnSomewhere = new Map();
for (const f of flagRows) flagOnSomewhere.set(f.key, (flagOnSomewhere.get(f.key) ?? false) || f.default_enabled === 1 || f.enabled === 1);
db.close();

// ---- E2E specs that name a route ----
const specs = readdirSync('e2e').filter((f) => f.endsWith('.spec.js')).map((f) => ({ f, src: readFileSync(join('e2e', f), 'utf8') }));
const specsFor = (route) => specs.filter(({ src }) => new RegExp(`['\`]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[?'\`/]|\\$\\{)`).test(src)).map((s) => s.f);

// ---- API routes a page's own file names (static and approximate: string literals that match a route of the policy) ----
const apiRoutes = ROUTE_POLICY.map((r) => ({ ...r, re: new RegExp(`^${r.p.replace(/:[A-Za-z0-9_]+/g, '[^/]+')}$`) }));
const BASES = new Map(); // module -> api base prefixes used by its api.js
for (const m of moduleDirs) {
  const f = `src/client/modules/${m}/api.js`; if (!existsSync(f)) continue;
  BASES.set(m, [...new Set([...readFileSync(f, 'utf8').matchAll(/[`'](\/[a-z][a-z0-9-]*)\$\{/g)].map((x) => x[1]))]);
}
function apiCallsOf(file, module) {
  if (!file) return [];
  const src = readFileSync(file, 'utf8'); const out = new Set();
  const lits = [...src.matchAll(/[`'"](\/[a-z][A-Za-z0-9_\-/${}.]*)(?:\?[^`'"]*)?[`'"]/g)].map((m) => m[1].replace(/\$\{[^}]+\}/g, 'X'));
  const bases = ['', ...(BASES.get(module) ?? []), `/${module}`];
  for (const lit of lits) for (const b of bases) {
    const full = lit.startsWith('/api/') ? lit : `/api/v1${b}${lit}`;
    for (const r of apiRoutes) if (r.re.test(full)) out.add(`${r.m} ${r.p}`);
  }
  return [...out];
}
const calledByAnyPage = new Set();

// ---- rows ----
const csv = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const pageRows = []; const denomRows = [];
for (const p of pages) {
  if (!compCache.has(p.module)) compCache.set(p.module, componentFiles(p.module));
  const { map, pageOf } = compCache.get(p.module);
  const comp = pageOf.get(p.route) ?? ''; const factory = comp.includes('(') ? comp.slice(0, comp.indexOf('(')) : null;
  // a page made by a factory in the index (mdm `register('uom')`) is the file that defines the factory, or the index itself
  const file = resolveFile(map.get(factory ?? comp) ?? '') ?? (factory ? `src/client/modules/${p.module}/index.js` : '');
  const line = readFileSync(`src/client/modules/${p.module}/index.js`, 'utf8').split('\n').find((l) => l.includes(`{ path: '${p.route}'`)) ?? '';
  const flag = /flag: '([^']+)'/.exec(line)?.[1] ?? '';
  const record = /menu: false/.test(line);
  const e = navByRoute.get(p.route);
  const calls = apiCallsOf(file, p.module); calls.forEach((c) => calledByAnyPage.add(c));
  const e2e = specsFor(p.route);
  pageRows.push({ ...p, comp, file, flag, record, nav: e?.code ?? '', calls, e2e });
  for (const [fam, roles] of families) {
    const internal = fam !== 'External portal';
    const withAccess = p.permission ? roles.filter((r) => heldBy.get(p.permission)?.has(r.code)).map((r) => r.code) : (internal ? roles.map((r) => r.code) : []);
    const access = p.module === 'portal' ? (internal ? (withAccess.length ? 'ADMIN' : 'NONE') : 'PORTAL') : withAccess.length === 0 ? 'NONE' : withAccess.length === roles.length ? 'ALL' : 'SOME';
    denomRows.push([`${p.route}|${fam}`, p.module, p.route, p.label, record ? 'record' : 'menu', p.permission ?? '(open by design)', flag, flag ? (flagOnSomewhere.get(flag) ? 'on somewhere' : 'off (fresh install)') : 'no flag', e?.code ?? '', fam, roles.length, withAccess.length, access, withAccess.join(' '), e2e.length, crawlerModules.has(p.module) ? 'yes' : 'no', calls.length, relative(ROOT, resolve(file || '.')) || '']);
  }
}
const HEAD = ['cell_id', 'module', 'route', 'label', 'kind', 'permission', 'flag', 'flag_default', 'nav_entry', 'role_family', 'family_roles', 'family_roles_with_access', 'access', 'roles_with_access', 'e2e_specs_naming_route', 'in_route_crawler', 'api_routes_named_by_page_file', 'page_file'];
writeFileSync(join(OUT, 'coverage-denominator.csv'), [HEAD.join(','), ...denomRows.map((r) => r.map(csv).join(','))].join('\n') + '\n');

// ---- orphans (scope item 3) ----
const pagePerms = new Set(pages.map((p) => p.permission).filter(Boolean));
const orphans = {
  pagesWithoutNavEntry: pageRows.filter((r) => !r.record && !r.nav).map((r) => r.route),
  recordPagesWithNavEntry: pageRows.filter((r) => r.record && r.nav).map((r) => r.route),
  navEntriesWithoutPage: nav.filter((e) => !pages.some((p) => p.route === e.route)).map((e) => `${e.code} → ${e.route}`),
  directLinksMissingInApp: DIRECT.filter((d) => !d.found).map((d) => d.route),
  modulesNotInRouteCrawler: moduleDirs.filter((m) => !crawlerModules.has(m)),
  pagesWithoutComponentFile: pageRows.filter((r) => !r.file).map((r) => r.route),
  pagePermissionsHeldByNoRole: [...pagePerms].filter((k) => !heldBy.has(k)).sort(),
  // a route's k is a key or an array of keys any one of which is enough
  routePermissionsHeldByNoRole: [...new Set(ROUTE_POLICY.filter((r) => r.k && ![r.k].flat().some((k) => heldBy.has(k))).map((r) => [r.k].flat().join(' | ')))].sort(),
  pagesBehindFlagOffInFreshInstall: pageRows.filter((r) => r.flag && !flagOnSomewhere.get(r.flag)).length,
  flagsOnPagesNotInFlagTable: [...new Set(pageRows.filter((r) => r.flag && !flagOnSomewhere.has(r.flag)).map((r) => r.flag))].sort(),
  pagesNamedByNoE2eSpec: pageRows.filter((r) => r.e2e.length === 0).map((r) => r.route),
  apiRoutesNamedByNoPageFile: ROUTE_POLICY.filter((r) => !calledByAnyPage.has(`${r.m} ${r.p}`)).length,
};
const summary = {
  pages: pages.length, declaredPathLines: declaredLines, menuPages: pageRows.filter((r) => !r.record).length, recordPages: pageRows.filter((r) => r.record).length,
  directLinks: DIRECT, roleTemplates: ROLE_TEMPLATES.length, roleFamilies: Object.fromEntries([...families].map(([k, v]) => [k, v.map((t) => t.code)])),
  denominatorRows: denomRows.length, navEntries: nav.length, apiRoutes: ROUTE_POLICY.length, flagRowsFreshInstall: flagRows.length,
  distinctPageFlags: new Set(pageRows.map((r) => r.flag).filter(Boolean)).size, accessCells: denomRows.reduce((a, r) => ({ ...a, [r[12]]: (a[r[12]] ?? 0) + 1 }), {}),
  orphanCounts: Object.fromEntries(Object.entries(orphans).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])),
};
writeFileSync(join(OUT, 'pack00-orphans.json'), JSON.stringify({ summary, orphans }, null, 1) + '\n');
console.log(JSON.stringify(summary, null, 1));
