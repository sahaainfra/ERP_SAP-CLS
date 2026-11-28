#!/usr/bin/env node
// PACK-08: the record-search quality set. Boots the application in-process on an in-memory database, seeds people, projects, sites and
// documents with English, Hindi and Telugu names in company 1 (and look-alikes in company 2), then asks 30 typical queries as each of four
// roles and scores them: hit@1 and hit@5 against the expected record (only where that role may see it), and leaks (a result of another
// company, or of a type the role may not open).
//   node pack-reports/tools/search_quality.mjs [--out pack-reports/search-quality.json]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(root);
const args = process.argv.slice(2);
const OUT = resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'pack-reports/search-quality.json');
await import(`${root}/src/server/modules/registry.js`);
const { setupCompany, startApi, admin } = await import(`${root}/tests/helpers.js`);
const { runtimeOf } = await import(`${root}/src/server/platform/runtime/index.js`);

const json = { 'content-type': 'application/json' };
let n = 0; const key = () => ({ ...json, 'idempotency-key': `sq-${(n += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const api = await startApi();
const call = async (who, method, path, body) => { const r = await api.call(method, path, { ...who, headers: key(), body }); if (r.status >= 300) throw new Error(`${method} ${path}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return r.json.data; };

// ---- seed ----
await setupCompany(api, { company: '1' });
const c2 = String((await call(as('SYSADM', 'sq-setup'), 'POST', '/api/v1/iam/org/companies', { code: 'SQ2', legalName: 'Look-alike Infra Pvt Ltd', shortName: 'SQ2' })).id);
await setupCompany(api, { company: c2 });
await call(admin('1'), 'POST', '/api/v1/core/number-series', { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:6}', resetRule: 'financial_year', reason: 'initial set-up' });
const pm = as('PM', 'pm1');
const projects = {};
for (const [code, name] of [['NH1', 'NH-48 Widening'], ['RR2', 'Ring Road Phase 2'], ['GB3', 'Godavari Bridge'], ['KP4', 'కాకినాడ పోర్ట్ జెట్టీ'], ['VJ5', 'విజయవాడ ఫ్లైఓవర్']]) {
  const p = await call(pm, 'POST', '/api/v1/iam/org/projects', { code, name, type: 'ROAD' });
  const s = await call(pm, 'POST', '/api/v1/iam/org/sites', { code: `${code}-S1`, name: `${code} camp`, projectId: p.id });
  projects[code] = { p, s };
}
await call(as('PM', 'pmx', c2), 'POST', '/api/v1/iam/org/projects', { code: 'NH9', name: 'NH-48 Widening (other company)', type: 'ROAD' });
const sys1 = as('SYSADM', 'sys1');
const people = [['rsharma', 'Rajesh Sharma'], ['pnair', 'Priya Nair'], ['sverma', 'सुनील वर्मा'], ['srao', 'శ్రీనివాస రావు'], ['vlakshmi', 'వెంకట లక్ష్మి'], ['rkumar', 'రమేష్ కుమార్'], ['amaheshwari', 'Anjali Maheshwari']];
for (const [username, displayName] of people) await call(sys1, 'POST', '/api/v1/iam/users', { username, displayName, email: `${username}@example.com` });
await call(as('SYSADM', 'sys2', c2), 'POST', '/api/v1/iam/users', { username: 'srao2', displayName: 'Srinivasa Rao', email: 'srao2@example.com' });
const docs = [];
for (const [i, [code, title]] of [['NH1', 'Cement for pier P3'], ['NH1', 'TMT bars 16 mm'], ['GB3', 'Shuttering plywood'], ['KP4', 'Diesel for the batching plant']].entries()) {
  const { p, s } = projects[code];
  const r = await call(pm, 'POST', '/api/v1/ui/sample-requests', { title, docDate: '2026-10-31', requiredBy: '2026-12-20', projectId: p.id, siteId: s.id, lines: [{ description: 'Line', uom: 'MT', quantity: '1', unitRate: '100' }] });
  const sub = await call(pm, 'POST', `/api/v1/ui/sample-requests/${r.id}/submit`, { version: r.version }).catch((e) => { console.error('submit failed:', e.message.slice(0, 200)); return null; });
  docs.push({ i, id: r.id, docNo: sub?.docNo ?? r.docNo ?? null, title });
}
await runtimeOf(api.db).bus.drain();

// ---- the query set: [query, expected type, expected title or doc number, what it tests] ----
const docNo = docs.find((d) => d.docNo)?.docNo;
const Q = [
  ['NH-48 Widening', 'project', 'NH-48 Widening', 'exact project name'],
  ['nh1', 'project', 'NH-48 Widening', 'project code, lower case'],
  ['widening', 'project', 'NH-48 Widening', 'one word of the name'],
  ['ring road', 'project', 'Ring Road Phase 2', 'two words'],
  ['godavari', 'project', 'Godavari Bridge', 'name'],
  ['godavri', 'project', 'Godavari Bridge', 'typo (missing letter)'],
  ['గోదావరి', 'project', 'Godavari Bridge', 'Telugu script for a Latin name'],
  ['కాకినాడ', 'project', 'కాకినాడ పోర్ట్ జెట్టీ', 'Telugu name in Telugu'],
  ['kakinada', 'project', 'కాకినాడ పోర్ట్ జెట్టీ', 'Telugu name typed in English'],
  ['kakinada port', 'project', 'కాకినాడ పోర్ట్ జెట్టీ', 'Telugu name typed in English, two words'],
  ['vijayawada', 'project', 'విజయవాడ ఫ్లైఓవర్', 'Telugu name typed in English'],
  ['KP4', 'project', 'కాకినాడ పోర్ట్ జెట్టీ', 'code of a Telugu-named project'],
  ['Rajesh Sharma', 'user', 'Rajesh Sharma', 'full name'],
  ['sharma', 'user', 'Rajesh Sharma', 'surname'],
  ['sarma', 'user', 'Rajesh Sharma', 'other spelling of the sound'],
  ['शर्मा', 'user', 'Rajesh Sharma', 'Devanagari for a Latin name'],
  ['priya', 'user', 'Priya Nair', 'first name'],
  ['sunil verma', 'user', 'सुनील वर्मा', 'Hindi name typed in English'],
  ['सुनील', 'user', 'सुनील वर्मा', 'Hindi name in Hindi'],
  ['srinivasa rao', 'user', 'శ్రీనివాస రావు', 'Telugu name typed in English'],
  ['srinivas', 'user', 'శ్రీనివాస రావు', 'Telugu name, short spelling'],
  ['శ్రీనివాస', 'user', 'శ్రీనివాస రావు', 'Telugu name in Telugu'],
  ['venkata lakshmi', 'user', 'వెంకట లక్ష్మి', 'Telugu name typed in English'],
  ['lakshmi', 'user', 'వెంకట లక్ష్మి', 'Telugu surname typed in English'],
  ['ramesh kumar', 'user', 'రమేష్ కుమార్', 'Telugu name typed in English'],
  ['maheshwari', 'user', 'Anjali Maheshwari', 'surname'],
  ['maheswari', 'user', 'Anjali Maheshwari', 'surname, other spelling'],
  ['cement pier', 'sample_request', 'Cement for pier P3', 'document title words'],
  [docNo ?? 'MR/2026-27/000001', 'sample_request', docNo ?? 'MR/2026-27/000001', 'document number'],
  [(docNo ?? 'MR/2026-27/000001').replace(/\D/g, '').slice(-6), 'sample_request', docNo ?? 'MR/2026-27/000001', 'document number, digits only'],
];

const ROLES = [['SYSADM', 'sq-sys'], ['PM', 'sq-pm'], ['ACCMGR', 'sq-acc'], ['EMP', 'sq-emp']];
const visibleTypes = async (who) => (await api.call('GET', '/api/v1/ui/search/types', who)).json?.data?.map((t) => t.type) ?? [];
const out = { at: new Date().toISOString(), queries: Q.length, roles: {} };
for (const [roles, user] of ROLES) {
  const who = as(roles, user); const types = await visibleTypes(who);
  const rows = []; let applicable = 0; let hit1 = 0; let hit5 = 0; const leaks = [];
  for (const [query, type, expect, what] of Q) {
    const r = await api.call('GET', `/api/v1/ui/search?${new URLSearchParams({ q: query })}`, who);
    const items = r.json?.data ?? [];
    const list = (Array.isArray(items) ? items : (items.groups ?? []).flatMap((g) => g.items ?? g.rows ?? [])).map((it) => ({ ...it, type: it.entity ?? it.type }));
    for (const it of list) {
      if (it.companyId && Number(it.companyId) !== 1) leaks.push({ query, it: JSON.stringify(it).slice(0, 120) });
      if (/other company/.test(it.title ?? '') || it.title === 'Srinivasa Rao') leaks.push({ query, it: it.title });
      if (it.type && !types.includes(it.type)) leaks.push({ query, it: `type ${it.type} not visible to ${roles}` });
    }
    const can = types.includes(type);
    const pos = list.findIndex((it) => it.type === type && ((it.title ?? '') === expect || (it.code ?? '') === expect || (it.docNo ?? '') === expect || (it.title ?? '').includes(expect)));
    if (can) { applicable += 1; if (pos === 0) hit1 += 1; if (pos >= 0 && pos < 5) hit5 += 1; }
    rows.push({ query, what, expectType: type, applicable: can, position: pos < 0 ? null : pos + 1, top: list.slice(0, 3).map((it) => `${it.type}:${it.title ?? it.code ?? ''}`) });
  }
  out.roles[roles] = { searchableTypes: types, applicable, hit1, hit5, leaks, rows };
}
await api.close();
mkdirSync(dirname(OUT), { recursive: true }); writeFileSync(OUT, JSON.stringify(out, null, 1));
for (const [r, v] of Object.entries(out.roles)) console.log(`${r.padEnd(7)} applicable ${String(v.applicable).padStart(2)}  hit@1 ${String(v.hit1).padStart(2)}  hit@5 ${String(v.hit5).padStart(2)}  leaks ${v.leaks.length}`);
for (const row of out.roles.SYSADM.rows) if (row.applicable && row.position !== 1) console.log(`  SYSADM miss: "${row.query}" (${row.what}) → ${row.position ?? 'not found'}; top: ${row.top.join(' | ')}`);
