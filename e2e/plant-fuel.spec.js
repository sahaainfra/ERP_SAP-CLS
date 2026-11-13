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
// Part 17.04 in the browser (development-header mode, port 3100): the fuel attendant issues fuel on the phone (meter prefilled from the last issue, photograph), the rules flag consumption above the norm, the plant supervisor verifies, a tank dip is
// set against the book, the anomaly is explained and accepted by the plant supervisor and the project manager, and the reports show the figures. Desktop and mobile.
const OUT = 'docs/erp/screenshots/plant-fuel';
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
  for (const [n, roles] of [['sk', ['SK']], ['su1', ['PMSUP']], ['pm', ['PM']], ['pl', ['PLANTMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Fuel tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Fuel site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cls = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Excavator 20 t', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(c, `${T}-EXC`, cat).lastInsertRowid);
  const eq = fill(db, 'plt_equipment', { company_id: c, asset_code: `${T}-EX1`, class_item_id: cls, ownership: 'OWNED', purchase_value: 100000, meter_type: 'HOURS', fuel_type: 'DIESEL', fuel_norm: 12000, fuel_norm_unit: 'L_PER_HOUR', tank_capacity: 200000, status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z', approved_by: 'x', requested_by: 'x', equip_state: 'DEPLOYED', org_project_id: pid, org_site_id: site });
  fill(db, 'plt_allocations', { company_id: c, equipment_id: eq, org_project_id: pid, org_site_id: site, from_date: plus(-5), to_date: plus(60), internal_rate: 150000, charge_basis: 'DAY', status: 'APPROVED', phase: 'ON_SITE', arrived_on: plus(-5), arrival_meter: 1000000, requested_by: 'x' });
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site, eq };
}
function baseline(c, s, tankId) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  const id = fill(db, 'plt_fuel_issues', { company_id: c, doc_no: `FI/E2E/${s.T}`, tank_id: tankId, equipment_id: s.eq, org_project_id: s.pid, org_site_id: s.site, issue_at: `${plus(-1)}T08:00`, issue_date: plus(-1), meter_reading: 1000000, litres: 100000, full_tank: 1, issued_by: 'x', received_by: 'Ram', rate: 9000, cost_amount: 900000, status: 'APPROVED', requested_by: 'x' }); db.close(); return id;
}
test('Plant fuel: the issue entered on the phone, flagged above the norm, verified; a dip against the book; the anomaly explained and accepted; the reports', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `h${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const tank = await api(request, c, 'PLANTMGR', s.u('pl'), 'post', '/plant/fuel/tanks', { code: `${s.T}-T1`, name: 'Site diesel tank', type: 'TANK', fuelType: 'DIESEL', projectId: s.pid, siteId: s.site, capacity: 5000, openingLitres: 1000, openingDate: plus(-10), openingRate: 90 }); baseline(c, s, tank.id);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/plant/fuel-issue'); const p = sk.page; const errors = watch(p);
  await expect(p.getByTestId('plant-fuel-issue')).toBeVisible(); await p.getByTestId('fi-tankId').selectOption(String(tank.id)); await p.getByTestId('fi-equipmentId').selectOption(String(s.eq)); await expect(p.getByTestId('fi-machine')).toContainText('200'); await expect(p.getByTestId('fi-meterReading')).toHaveValue('1000');
  await p.getByTestId('fi-meterReading').fill('1010'); await p.getByTestId('fi-litres').fill('150'); await p.getByTestId('fi-receivedBy').fill('Operator Ram'); await noOverflow(p); await shot(p, '1-issue', info); await p.getByTestId('fi-save').click(); await expect(p.getByTestId('fi-review')).toBeVisible(); await expect(p.getByTestId('fi-calc')).toContainText('15');
  await expect(p.getByTestId('fi-send')).toBeDisabled(); await p.getByTestId('fi-photo').setInputFiles({ name: 'meter.png', mimeType: 'image/png', buffer: PNG }); await expect(p.getByTestId('fi-note')).toContainText('photograph'); await p.getByTestId('fi-send').click();
  await expect(p.getByTestId('fi-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(p.getByTestId('fis-flags')).toContainText('above the norm'); const url = p.url().replace(/^https?:\/\/[^/]+/, ''); await noOverflow(p); await shot(p, '2-issue-flagged', info);
  // the plant supervisor verifies
  const su = await open(browser, info, c, 'PMSUP', s.u('su1'), url); await expect(su.page.getByTestId('fis-decide')).toBeVisible(); await su.page.getByTestId('fis-approve').click(); await expect(su.page.getByTestId('fis-note')).toBeVisible(); await expect(su.page.getByTestId('fi-object')).toHaveAttribute('data-status', 'APPROVED'); await su.context.close();
  // a dip well below the book
  await p.goto('/plant/fuel-dip'); await p.getByTestId('fd-tank').selectOption(String(tank.id)); await p.getByTestId('fd-litres').fill('500'); await p.getByTestId('fd-save').click(); await expect(p.getByTestId('fd-result')).toHaveAttribute('data-within', 'no'); await expect(p.getByTestId('fd-verdict')).toContainText('Beyond'); await noOverflow(p); await shot(p, '3-dip', info); await sk.context.close();
  // the anomaly: explained by the plant manager, accepted by the plant supervisor, then the project manager
  const db = new DatabaseSync('data/e2e.sqlite'); const an = db.prepare("SELECT id FROM plt_fuel_anomalies WHERE company_id = ? AND rule_code = 'OVER_NORM'").get(c).id; db.close();
  const pl = await open(browser, info, c, 'PLANTMGR', s.u('pl'), `/plant/fuel-anomalies?id=${an}`); const q = pl.page; await expect(q.getByTestId('fa-object')).toHaveAttribute('data-status', 'OPEN'); await q.getByTestId('fa-reason').selectOption('HEAVY_DUTY'); await q.getByTestId('fa-text').fill('Rock breaking for the whole shift'); await noOverflow(q); await shot(q, '4-anomaly', info);
  await q.getByTestId('fa-send').click(); await expect(q.getByTestId('fa-note')).toContainText('acceptance');
  const su2 = await open(browser, info, c, 'PMSUP', s.u('su1'), `/plant/fuel-anomalies?id=${an}`); await su2.page.getByTestId('fa-approve').click(); await expect(su2.page.getByTestId('fa-note')).toBeVisible(); await su2.context.close();
  const pm = await open(browser, info, c, 'PM', s.u('pm'), `/plant/fuel-anomalies?id=${an}`); await pm.page.getByTestId('fa-approve').click(); await expect(pm.page.getByTestId('fa-note')).toBeVisible(); await pm.page.reload(); await expect(pm.page.getByTestId('fa-object')).toHaveAttribute('data-status', 'ACCEPTED'); await pm.context.close();
  // the list and the reports
  await q.goto('/plant/fuel-anomalies'); await expect(q.getByTestId('plant-fuel-anomalies')).toBeVisible(); await expect(q.getByTestId('fa-summary')).toBeVisible();
  await q.goto('/plant/fuel-reports'); await expect(q.getByTestId('fr-recon-row').first()).toBeVisible(); await expect(q.getByTestId('fr-recon-totals')).toContainText('out of tolerance'); await noOverflow(q); await shot(q, '5-reconciliation', info);
  await q.getByTestId('fr-tab-cons').click(); await expect(q.getByTestId('fr-cons-row')).toHaveCount(1); await expect(q.getByTestId('fr-cons-row').first()).toContainText(`${s.T}-EX1`); await q.getByTestId('fr-drill').click(); await expect(q.getByTestId('fr-records')).toBeVisible(); await noOverflow(q); await shot(q, '6-consumption', info);
  const dl = q.waitForEvent('download'); await q.getByTestId('fr-export').click(); expect((await dl).suggestedFilename()).toMatch(/fuel-consumption/); await q.goto('/plant/fuel-tanks'); await expect(q.getByTestId('ft-row')).toHaveCount(1); await noOverflow(q); await shot(q, '7-tanks', info); await pl.context.close();
  const none = await open(browser, info, c, 'ACCMGR', 'nobody', '/plant/fuel-issue'); await expect(none.page.getByText('plant.issue.create')).toBeVisible(); await none.context.close();
  expect(errors).toEqual([]);
});
