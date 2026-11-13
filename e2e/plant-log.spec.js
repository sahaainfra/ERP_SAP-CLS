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
// Part 17.03 in the browser (development-header mode, port 3100): the supervisor enters the day of a machine on the phone (meter prefilled from the arrival, hours, work authorisation, photograph of the meter), a second supervisor verifies it from the worklist
// and the site engineer finishes the chain; the utilisation report shows the figures; a breakdown is reported and the machine is marked. Desktop and mobile.
const OUT = 'docs/erp/screenshots/plant-log';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${Math.random().toString(36).slice(2, 8)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['su1', ['PMSUP']], ['su2', ['PMSUP']], ['se', ['SE']], ['pm', ['PM']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Log tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Log site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cls = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Excavator 20 t', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(c, `${T}-EXC`, cat).lastInsertRowid);
  const eq = fill(db, 'plt_equipment', { company_id: c, asset_code: `${T}-EX1`, class_item_id: cls, ownership: 'OWNED', purchase_value: 100000, meter_type: 'HOURS', fuel_norm_unit: 'L_PER_HOUR', status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z', approved_by: 'x', requested_by: 'x', equip_state: 'DEPLOYED', org_project_id: pid, org_site_id: site });
  fill(db, 'plt_allocations', { company_id: c, equipment_id: eq, org_project_id: pid, org_site_id: site, from_date: plus(-3), to_date: plus(60), internal_rate: 150000, charge_basis: 'DAY', status: 'APPROVED', phase: 'ON_SITE', arrived_on: plus(-3), arrival_meter: 1200000, requested_by: 'x' });
  const act = fill(db, 'plan_activities', { company_id: c, code: `${T}-A1`, name: 'Bulk excavation', schedule_id: 1 }); const wa = fill(db, 'site_work_authorisations', { company_id: c, org_project_id: pid, wa_site_id: site, plan_date: today, activity_id: act, planned_qty: 100000, uom: 'm3', status: 'APPROVED', start_time: '08:00', end_time: '17:00', supervisor: 'sup', wa_no: `WA/${T}/1` });
  fill(db, 'site_wa_resources', { company_id: c, wa_id: wa, resource_type: 'PLANT', trade: `${T}-EX1`, res_key: `plant:${T.toLowerCase()}-ex1`, label: `${T}-EX1`, uom: 'h', planned_qty: 100000 });
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site, eq };
}
test('Plant log books: the day of a machine entered on the phone, verified from the worklist, utilisation, and a breakdown', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const t = `g${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const su = await open(browser, info, c, 'PMSUP', s.u('su1'), '/plant/log-entry'); const p = su.page; const errors = watch(p);
  await expect(p.getByTestId('plant-log-entry')).toBeVisible(); await p.getByTestId('le-equipmentId').selectOption(String(s.eq)); await expect(p.getByTestId('le-previous')).toContainText('1,200'); await expect(p.getByTestId('le-startMeter')).toHaveValue('1200');
  await p.getByTestId('le-endMeter').fill('1208'); await p.getByTestId('le-workingHrs').fill('8'); await expect(p.getByTestId('le-total')).toContainText('8'); await expect(p.getByTestId('le-run')).toContainText('8'); await p.getByTestId('le-waId').selectOption({ index: 1 }); await p.getByTestId('le-workQty').fill('120'); await p.getByTestId('le-workUom').fill('m3'); await p.getByTestId('le-fuelLitres').fill('72');
  await noOverflow(p); await shot(p, '1-entry', info); await p.getByTestId('le-save').click(); await expect(p.getByTestId('le-review')).toBeVisible(); await expect(p.getByTestId('le-flags')).toHaveCount(0);
  await p.getByTestId('le-send').click(); await expect(p.getByTestId('le-error')).toContainText('photograph'); await p.getByTestId('le-photo').setInputFiles({ name: 'meter.png', mimeType: 'image/png', buffer: PNG }); await expect(p.getByTestId('le-note')).toContainText('Photograph'); await p.getByTestId('le-send').click(); await expect(p.getByTestId('lg-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  // the second supervisor verifies from the worklist, the site engineer finishes
  const v = await open(browser, info, c, 'PMSUP', s.u('su2'), '/plant/log-verification'); await expect(v.page.getByTestId('lv-row')).toHaveCount(1); await v.page.getByTestId('lv-check').check(); await noOverflow(v.page); await shot(v.page, '2-worklist', info); await v.page.getByTestId('lv-bulk').click(); await expect(v.page.getByTestId('lv-note')).toContainText('1 log'); await v.context.close();
  const e = await open(browser, info, c, 'SE', s.u('se'), url); await expect(e.page.getByTestId('lg-decide')).toBeVisible(); await e.page.getByTestId('lg-approve').click(); await expect(e.page.getByTestId('lg-note')).toBeVisible(); await e.context.close();
  await p.goto(url); await expect(p.getByTestId('lg-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('lg-details')).toContainText('120'); await noOverflow(p); await shot(p, '3-log', info);
  // utilisation (the project manager reports)
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/plant/utilisation'); const q = pm.page; await expect(q.getByTestId('ut-row')).toHaveCount(1); await q.getByTestId('ut-group').selectOption('equipment'); await expect(q.getByTestId('ut-row').first()).toContainText(`${s.T}-EX1`); await expect(q.getByTestId('ut-util')).toContainText('%'); await q.getByTestId('ut-open').first().click(); await expect(q.getByTestId('ut-drill-row')).toHaveCount(1); await expect(q.getByTestId('ut-bars')).toBeVisible(); await noOverflow(q); await shot(q, '4-utilisation', info);
  const dl = q.waitForEvent('download'); await q.getByTestId('ut-export').click(); expect((await dl).suggestedFilename()).toMatch(/equipment-utilisation/); await pm.context.close();
  // a breakdown
  await p.goto('/plant/logs?tab=breakdowns'); await p.getByTestId('bd-open').click(); await p.getByTestId('bd-equipment').selectOption(String(s.eq)); await p.getByTestId('bd-category').selectOption('HYDRAULIC'); await p.getByTestId('bd-description').fill('Boom cylinder leaking oil'); await p.getByTestId('bd-go').click(); await expect(p.getByTestId('bd-note')).toContainText('marked'); await noOverflow(p); await shot(p, '5-breakdown', info);
  await p.goto(`/plant/equipment?id=${s.eq}`); await expect(p.getByTestId('eq-object')).toHaveAttribute('data-state', 'BREAKDOWN');
  const sk = await open(browser, info, c, 'SK', 'nobody', '/plant/utilisation'); await expect(sk.page.getByText('plant.log.report')).toBeVisible(); await sk.context.close();
  expect(errors).toEqual([]);
});
