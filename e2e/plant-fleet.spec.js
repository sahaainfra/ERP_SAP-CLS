import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|ERR_INTERNET_DISCONNECTED|Cannot reach the server|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => { const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data }); expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') }); const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' }); return id;
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use; const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true }); const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) }); await page.goto(path); return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
// Part 17.07 in the browser (development-header mode, port 3100): the plant manager enters a cost item, the fleet control tower and the owning and operating cost show the cost an hour, telematics readings raise an alert and a position,
// and the project manager recommends the disposal of an old machine, approved by the plant manager, the CFO and the director. Desktop and mobile.
const OUT = 'docs/erp/screenshots/plant-fleet';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${Math.random().toString(36).slice(2, 8)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}




async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['pm', ['PM']], ['pl', ['PLANTMGR']], ['cf', ['CFO']], ['di', ['DIR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Fleet tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Fleet site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cls = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Excavator 20 t', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(c, `${T}-EXC`, cat).lastInsertRowid);
  const eq = fill(db, 'plt_equipment', { company_id: c, asset_code: `${T}-EX1`, class_item_id: cls, ownership: 'OWNED', purchase_value: 100000000, purchase_date: `${Number(today.slice(0, 4)) - 15}-01-01`, meter_type: 'HOURS', fuel_type: 'DIESEL', status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z', approved_by: 'x', requested_by: 'x', equip_state: 'DEPLOYED', org_project_id: pid, org_site_id: site });
  const al = fill(db, 'plt_allocations', { company_id: c, equipment_id: eq, org_project_id: pid, org_site_id: site, from_date: plus(-40), to_date: plus(60), internal_rate: 150000, charge_basis: 'DAY', status: 'APPROVED', phase: 'ON_SITE', arrived_on: plus(-40), arrival_meter: 1000000, requested_by: 'x' });
  for (const n of [5, 4, 3, 2]) fill(db, 'plt_logs', { company_id: c, equipment_id: eq, allocation_id: al, org_project_id: pid, org_site_id: site, log_date: plus(-n), shift: 'GENERAL', start_meter: 1000000, end_meter: 1008000, working_hrs: 8000, idle_hrs: 1000, status: 'APPROVED', requested_by: 'x' });
  fill(db, 'plt_job_cards', { company_id: c, equipment_id: eq, job_type: 'BREAKDOWN', complaint: 'x', opened_at: `${plus(-20)}T08:00`, closed_at: `${plus(-19)}T08:00`, job_status: 'CLOSED', status: 'APPROVED', total_cost: 70000000, requested_by: 'x' });
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site, eq };
}
test('Plant fleet: the control tower, the owning and operating cost, telematics, and the disposal recommendation approved by three levels', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `l${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  await api(request, c, 'PLANTMGR', s.u('pl'), 'post', '/plant/telematics/ingest', { source: 'GPSCO', readings: [{ assetCode: `${s.T}-EX1`, timestamp: `${plus(-2)}T08:00:00`, lat: 28.6139, lng: 77.209, engineHours: 500, ignition: true, fuelLevel: 150 }, { assetCode: `${s.T}-EX1`, timestamp: `${plus(-2)}T14:00:00`, lat: 28.6139, lng: 77.209, engineHours: 504, ignition: true, fuelLevel: 120 }] });
  const pl = await open(browser, info, c, 'PLANTMGR', s.u('pl'), '/plant/owning-cost'); const q = pl.page; const errors = watch(q);
  await expect(q.getByTestId('plant-owning-cost')).toBeVisible(); await expect(q.getByTestId('oc-row')).toHaveCount(1); await q.getByTestId('oc-pick').click(); await q.getByTestId('oc-type').selectOption('INSURANCE'); await q.getByTestId('oc-amount').fill('3000'); await q.getByTestId('oc-add').click(); await expect(q.getByTestId('oc-note')).toContainText('added'); await expect(q.getByTestId('oc-total')).toContainText('₹'); await noOverflow(q); await shot(q, '1-owning-cost', info);
  await q.getByTestId('oc-snapshot').click(); await expect(q.getByTestId('oc-snap-note')).toBeVisible();
  await q.goto('/plant/fleet-tower'); await expect(q.getByTestId('plant-fleet-tower')).toBeVisible(); await expect(q.getByTestId('ft-tile-fleet')).toContainText('1'); await expect(q.getByTestId('ft-map-point')).toHaveCount(1); await expect(q.getByTestId('ft-alert-row')).toHaveCount(1); await expect(q.getByTestId('ft-alert-row').first()).toHaveAttribute('data-kind', 'HOURS_MISMATCH'); await expect(q.getByTestId('ft-tile-costPerHour')).toContainText('₹'); await noOverflow(q); await shot(q, '2-tower', info);
  // the project manager recommends the disposal of the old machine
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/plant/replacement'); await expect(pm.page.getByTestId('rp-row')).toHaveCount(1); await pm.page.getByTestId('rp-recommend').click(); await pm.page.getByTestId('rp-reason').fill('Repairs exceed 70 percent of the value'); await pm.page.getByTestId('rp-value').fill('200000'); await noOverflow(pm.page); await shot(pm.page, '3-recommend', info); await pm.page.getByTestId('rp-save').click(); await expect(pm.page.getByTestId('rp-note')).toBeVisible();
  await pm.page.getByTestId('rp-recs').getByRole('link').first().click(); await expect(pm.page.getByTestId('dr-object')).toHaveAttribute('data-status', 'DRAFT'); const url = pm.page.url().replace(/^https?:\/\/[^/]+/, ''); await pm.page.getByTestId('dr-submit').click(); await expect(pm.page.getByTestId('dr-object')).toHaveAttribute('data-status', 'SUBMITTED');
  for (const [role, user] of [['PLANTMGR', s.u('pl')], ['CFO', s.u('cf')], ['DIR', s.u('di')]]) { const a = await open(browser, info, c, role, user, url); await expect(a.page.getByTestId('dr-decide')).toBeVisible(); await a.page.getByTestId('dr-approve').click(); await expect(a.page.getByTestId('dr-note')).toBeVisible(); await a.context.close(); }
  await pm.page.goto(url); await expect(pm.page.getByTestId('dr-object')).toHaveAttribute('data-status', 'APPROVED'); await noOverflow(pm.page); await shot(pm.page, '4-approved', info); await pm.context.close();
  const dl = q.waitForEvent('download'); await q.goto('/plant/owning-cost'); await q.getByTestId('oc-export').click(); expect((await dl).suggestedFilename()).toMatch(/owning-operating-cost/); await pl.context.close();
  const none = await open(browser, info, c, 'SK', 'nobody', '/plant/fleet-tower'); await expect(none.page.getByText('plant.fleet.view')).toBeVisible(); await none.context.close();
  expect(errors).toEqual([]);
});
