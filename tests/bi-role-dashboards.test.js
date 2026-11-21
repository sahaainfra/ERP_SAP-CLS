import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { NEW_WIDGET_CODES, RETIRED, ROLE_WIDGETS, scanSources } from '../src/server/modules/bi/role-dashboards.js';
import { ROLE_TEMPLATES } from '../src/server/platform/authz/templates.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';

// Part 27.10: role dashboards consolidation.
// T-01 the automated scan finds no hard-coded figures in the dashboard code (and does find them when planted); every role of the catalogue has
// a default dashboard whose widgets it may use and whose data loads; FR-02 the new widgets read the owners' records in scope; FR-03 duplicates
// are retired and saved layouts follow the alias; FR-01 the inventory; roles; flag off.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const as = (roles, user) => ({ roles, user, company: '1' });

async function setup({ flag = true } = {}) {
  const api = await startApi(); opened.push(api); await setupCompany(api); const { db } = api;
  const fl = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Role dashboard fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', 'ff.ui.p0307', ...(flag ? ['ff.bi.p2710'] : [])]) { try { fl.run(code); } catch { /* already on */ } }
  db.exec("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)");
  return { api, db, get: (who, path) => api.call('GET', path, who) };
}

test('T-01 BR-01 the scan finds no hard-coded figure or sample data in the dashboards, and finds one planted', () => {
  const clean = scanSources();
  assert.ok(clean.available && clean.files > 500, 'the client and server code are scanned');
  assert.deepEqual(clean.findings, [], JSON.stringify(clean.findings.slice(0, 5)));
  const root = mkdtempSync(join(tmpdir(), 'scan-'));
  try {
    mkdirSync(join(root, 'src/client/x'), { recursive: true }); mkdirSync(join(root, 'src/server/modules/y'), { recursive: true });
    writeFileSync(join(root, 'src/client/x/Page.jsx'), 'export const P = () => <KpiTile label="Revenue" value="₹ 12,40,000" />;\nconst mockData = [1, 2];\n');
    writeFileSync(join(root, 'src/server/modules/y/w.js'), "widgetRegistry.register({ code: 'y.z', provider(ctx) { return { label: 'Open', value: 42 }; } });\n");
    const dirty = scanSources(root);
    assert.deepEqual(dirty.findings.map((f) => f.rule).sort(), ['LITERAL_KPI', 'LITERAL_PROVIDER', 'SAMPLE_DATA']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('T-01 FR-02 every role of the catalogue has a default dashboard of widgets it may use, and each widget loads', async () => {
  const t = await setup();
  for (const r of ROLE_TEMPLATES) assert.ok(ROLE_WIDGETS[r.code], `role ${r.code} has a dashboard`);
  const failures = [];
  for (const r of ROLE_TEMPLATES) {
    const who = as(r.code, `rd-${r.code.toLowerCase()}`);
    const d = await t.get(who, '/api/v1/ui/dashboards/role-dashboard');
    if (d.status !== 200) { failures.push(`${r.code}: ${d.status}`); continue; }
    const layout = d.json.data.layout;
    if (d.json.data.source !== 'role' || d.json.data.roleCode !== r.code) failures.push(`${r.code}: source ${d.json.data.source}`);
    if (layout.length < 2) failures.push(`${r.code}: only ${layout.length} widgets`);
    for (const item of layout) {
      const w = await t.get(who, `/api/v1/ui/widgets/${item.widget}/data`);
      if (w.status !== 200) failures.push(`${r.code} ${item.widget}: ${w.status} ${JSON.stringify(w.json?.error?.message ?? '')}`);
    }
  }
  assert.deepEqual(failures, []);
  // the duplicates are retired and a saved layout that still names one follows the alias
  for (const [from, to] of Object.entries(RETIRED)) {
    assert.equal(t.db.prepare('SELECT is_active FROM ui_widgets WHERE code = ?').get(from).is_active, 0, `${from} is retired`);
    assert.equal(t.db.prepare('SELECT is_active FROM ui_widgets WHERE code = ?').get(to).is_active, 1);
  }
  t.db.prepare("INSERT INTO ui_dashboards (company_id, code, name, owner_type, owner_ref, permission_key, layout_json) VALUES (1, 'role-dashboard', 'Mine', 'user', 'rd-hsee', 'self', ?)").run(JSON.stringify([{ id: 'a', widget: 'hse.ltifr', w: 3, h: 1 }]));
  const mine = (await t.get(as('HSEE', 'rd-hsee'), '/api/v1/ui/dashboards/role-dashboard')).json.data;
  assert.deepEqual(mine.layout.map((i) => i.widget), ['ov.hse.ltifr']);
});

test('FR-02 the new widgets read the owners\' records; FR-01 the inventory; roles; flag off', async () => {
  const t = await setup(); const { db } = t; const day = todayIST();
  const p = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'RD-P', 'Role Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const s = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'RD-S', 'Site', 'ACTIVE')").run(p).lastInsertRowid);
  db.exec('PRAGMA foreign_keys = OFF');
  const wa = db.prepare("INSERT INTO site_work_authorisations (company_id, wa_no, org_project_id, wa_site_id, plan_date, activity_id, planned_qty, start_time, end_time, supervisor, status) VALUES (1, ?, ?, ?, ?, 1, 1000, '08:00', '18:00', 'sup', ?)");
  wa.run('WA-1', p, s, day, 'APPROVED'); wa.run('WA-2', p, s, day, 'SUBMITTED'); wa.run('WA-3', p, s, day, 'DRAFT');
  db.prepare("INSERT INTO ap_bills (company_id, doc_no, bill_source, org_project_id, partner_id, payee_name, bill_no, bill_date, due_date, net_payable_paise, paid_paise, adjusted_paise, status) VALUES (1, 'APB-R1', 'DIRECT', ?, 1, 'Vendor', 'B-1', ?, ?, 5000000, 1000000, 0, 'APPROVED')").run(p, day, day);
  db.prepare("INSERT INTO ap_bills (company_id, doc_no, bill_source, org_project_id, partner_id, payee_name, bill_no, bill_date, due_date, net_payable_paise, paid_paise, adjusted_paise, status) VALUES (1, 'APB-R2', 'DIRECT', ?, 1, 'Vendor', 'B-2', ?, '2099-01-01', 9000000, 0, 0, 'APPROVED')").run(p, day);
  db.exec('PRAGMA foreign_keys = ON');
  const se = as('SE', 'rd-se'); const acc = as('ACCMGR', 'rd-acc');
  const w = (await t.get(se, '/api/v1/ui/widgets/site.wa_today/data')).json.data;
  assert.equal((w.data ?? w).value, 2, 'today\'s submitted and approved WAs, not the draft');
  const pay = (await t.get(acc, '/api/v1/ui/widgets/fin.payments_due/data')).json.data;
  assert.equal((pay.data ?? pay).value, 40000, 'only the bill due within 7 days, net of what was paid');
  assert.equal((await t.get(se, '/api/v1/ui/widgets/fin.payments_due/data')).status, 403, 'the SE may not use the accounts widget');
  for (const code of NEW_WIDGET_CODES) assert.ok(db.prepare('SELECT 1 FROM ui_widgets WHERE code = ? AND is_active = 1').get(code), code);
  // the inventory
  const sys = as('SYSADM', 'rd-sys');
  const inv = await t.get(sys, '/api/v1/bi/dashboard-inventory'); assert.equal(inv.status, 200, JSON.stringify(inv.json));
  const d = inv.json.data;
  assert.equal(d.totals.noProvider, 0); assert.equal(d.totals.retired, 7); assert.equal(d.totals.rolesCovered, d.totals.roles);
  assert.equal(d.roles.length, ROLE_TEMPLATES.length); assert.deepEqual(d.roles.filter((r) => r.hidden.length).map((r) => r.role), [], 'every card of a role dashboard is one the role may use');
  assert.equal(d.widgets.find((x) => x.code === 'bi.spi').source, 'CERTIFIED_METRIC');
  assert.equal(d.widgets.find((x) => x.code === 'hse.ltifr').supersededBy, 'ov.hse.ltifr');
  assert.ok(d.widgets.find((x) => x.code === 'site.wa_today').roles.includes('SE'));
  assert.deepEqual(d.scan.findings, []);
  assert.equal((await t.get(sys, '/api/v1/bi/dashboard-inventory?status=RETIRED')).json.data.widgets.length, 7);
  const x = await t.api.raw('GET', '/api/v1/bi/dashboard-inventory/export?format=csv', sys); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /site\.wa_today/);
  assert.equal((await t.get(se, '/api/v1/bi/dashboard-inventory')).status, 403);
  assert.equal((await t.get(se, '/api/v1/bi/role-dashboard')).json.data.roles[0].role, 'SE');
  const off = await setup({ flag: false });
  assert.equal((await off.get(sys, '/api/v1/bi/dashboard-inventory')).status, 404);
});
