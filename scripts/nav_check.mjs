#!/usr/bin/env node
// Navigation registry check (part 03.05, AC-02): every page of the client route table has an entry in the navigation registry, and every
// registry entry opens a page. A page without an entry would not be in anyone's menu; an entry without a page would be a dead link.
import { readdirSync, readFileSync } from 'node:fs';
import { openDatabase, migrateUp } from '../src/server/platform/db/index.js';

const routes = [];
for (const m of readdirSync('src/client/modules')) {
  let src;
  try { src = readFileSync(`src/client/modules/${m}/index.js`, 'utf8'); } catch { continue; }
  for (const line of src.split('\n')) {
    const p = /\{ path: '([^']+)', label: '([^']+)'(.*?)Page:/.exec(line);
    if (p) routes.push({ path: p[1], label: p[2], permission: /permission: '([^']+)'/.exec(p[3])?.[1] ?? null, flag: /flag: '([^']+)'/.exec(p[3])?.[1] ?? null });
  }
}

const db = openDatabase(':memory:');
migrateUp(db);
const entries = db.prepare("SELECT code, route, permission_key, feature_flag, parent_code, placement FROM ui_navigation_entries WHERE kind = 'page' AND is_active = 1").all();
const problems = [];
for (const r of routes) {
  const e = entries.find((x) => x.route === r.path);
  if (!e) { problems.push(`page ${r.path} (${r.label}) has no navigation entry`); continue; }
  const expected = r.path === '/home' || r.path === '/account/profile' ? null : r.permission ?? 'self';
  if ((e.permission_key ?? null) !== expected) problems.push(`${r.path}: the registry says permission ${e.permission_key}, the page says ${expected}`);
  if (r.path !== '/home' && (e.feature_flag ?? null) !== r.flag) problems.push(`${r.path}: the registry says flag ${e.feature_flag}, the page says ${r.flag}`);
}
for (const e of entries) if (!routes.some((r) => r.path === e.route)) problems.push(`navigation entry ${e.code} opens ${e.route}, which is no page`);
for (const code of ['admin-about', 'admin-data-health', 'admin-architecture', 'admin-design-system', 'admin-feature-flags']) {
  const e = entries.find((x) => x.code === code);
  if (e && e.placement !== 'console') problems.push(`${code} is build or technical information and belongs in the Technical Console, not in business navigation (BR-03)`);
}
if (problems.length) {
  console.error(`Navigation check FAILED:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`Navigation check OK: ${routes.length} pages, ${entries.length} entries, every page in the registry once.`);
