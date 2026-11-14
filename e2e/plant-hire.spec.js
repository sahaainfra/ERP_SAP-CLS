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
// Part 17.06 in the browser (development-header mode, port 3100): the procurement manager makes a hire-out agreement, the plant supervisor and the project manager approve it, the plant manager computes the hire bill from the verified logs
// (minimum guarantee, GST), the bill is certified, and the comparison with owned cost is shown. Desktop and mobile.
const OUT = 'docs/erp/screenshots/plant-hire';
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
  for (const [n, roles] of [['su1', ['PMSUP']], ['pm', ['PM']], ['pl', ['PLANTMGR']], ['pr', ['PROCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Hire tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Hire site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cls = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Excavator 20 t', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(c, `${T}-EXC`, cat).lastInsertRowid);
  const partner = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Sub Contractor Ltd', 'SubCo', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run(c, `${T}-SC`).lastInsertRowid);
  const eq = fill(db, 'plt_equipment', { company_id: c, asset_code: `${T}-EX1`, class_item_id: cls, ownership: 'OWNED', purchase_value: 100000000, meter_type: 'HOURS', fuel_type: 'DIESEL', status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z', approved_by: 'x', requested_by: 'x', equip_state: 'DEPLOYED', org_project_id: pid, org_site_id: site });
  const al = fill(db, 'plt_allocations', { company_id: c, equipment_id: eq, org_project_id: pid, org_site_id: site, from_date: plus(-20), to_date: plus(60), internal_rate: 150000, charge_basis: 'DAY', status: 'APPROVED', phase: 'ON_SITE', arrived_on: plus(-20), arrival_meter: 1000000, requested_by: 'x' });
  for (const n of [5, 4, 3]) fill(db, 'plt_logs', { company_id: c, equipment_id: eq, allocation_id: al, org_project_id: pid, org_site_id: site, log_date: plus(-n), shift: 'GENERAL', start_meter: 1000000, end_meter: 1008000, working_hrs: 8000, status: 'APPROVED', requested_by: 'x' });
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site, eq, partner };
}
test('Plant hire: the agreement approved, the bill computed from verified logs and certified, the comparison with owned cost', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `k${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const pr = await open(browser, info, c, 'PROCMGR', s.u('pr'), '/plant/hire-agreements?new=1'); const p = pr.page; const errors = watch(p);
  await expect(p.getByTestId('plant-hire-new')).toBeVisible(); await p.getByTestId('hn-equipmentId').selectOption(String(s.eq)); await p.getByTestId('hn-partnerId').selectOption(String(s.partner)); await p.getByTestId('hn-projectId').selectOption(String(s.pid)); await p.getByTestId('hn-rate').fill('1000'); await p.getByTestId('hn-minGuarantee').fill('100'); await p.getByTestId('hn-gstPct').fill('18'); await p.getByTestId('hn-from').fill(plus(-10)); await p.getByTestId('hn-to').fill(plus(60)); await noOverflow(p); await shot(p, '1-new-agreement', info);
  await p.getByTestId('hn-save').click(); await expect(p.getByTestId('ha-object')).toHaveAttribute('data-status', 'DRAFT'); const url = p.url().replace(/^https?:\/\/[^/]+/, ''); await p.getByTestId('ha-submit').click(); await expect(p.getByTestId('ha-object')).toHaveAttribute('data-status', 'SUBMITTED');
  for (const [role, user] of [['PMSUP', s.u('su1')], ['PM', s.u('pm')]]) { const a = await open(browser, info, c, role, user, url); await expect(a.page.getByTestId('ha-decide')).toBeVisible(); await a.page.getByTestId('ha-approve').click(); await expect(a.page.getByTestId('ha-note')).toBeVisible(); await a.context.close(); }
  await p.goto(url); await expect(p.getByTestId('ha-object')).toHaveAttribute('data-status', 'APPROVED'); await noOverflow(p); await shot(p, '2-agreement', info);
  // the bill, computed from the verified logs
  const pl = await open(browser, info, c, 'PLANTMGR', s.u('pl'), '/plant/hire-bill'); const q = pl.page; await q.getByTestId('hc-agreement').selectOption({ index: 1 }); await q.getByTestId('hc-from').fill(plus(-10)); await q.getByTestId('hc-to').fill(plus(-1)); await q.getByTestId('hc-preview').click();
  await expect(q.getByTestId('hc-result')).toBeVisible(); await expect(q.getByTestId('hc-working')).toHaveText('24'); await expect(q.getByTestId('hc-billable')).toHaveText('33.333'); await noOverflow(q); await shot(q, '3-bill-preview', info);
  await q.getByTestId('hc-save').click(); await expect(q.getByTestId('hb-object')).toHaveAttribute('data-status', 'DRAFT'); const burl = q.url().replace(/^https?:\/\/[^/]+/, ''); await q.getByTestId('hb-submit').click(); await expect(q.getByTestId('hb-object')).toHaveAttribute('data-status', 'SUBMITTED');
  for (const [role, user] of [['PMSUP', s.u('su1')], ['PM', s.u('pm')]]) { const a = await open(browser, info, c, role, user, burl); await expect(a.page.getByTestId('hb-decide')).toBeVisible(); await a.page.getByTestId('hb-approve').click(); await expect(a.page.getByTestId('hb-note')).toBeVisible(); await a.context.close(); }
  await q.goto(burl); await expect(q.getByTestId('hb-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(q.getByTestId('hb-details')).toContainText('33,333'); await noOverflow(q); await shot(q, '4-bill-certified', info);
  await q.goto('/plant/hire-comparison'); await expect(q.getByTestId('plant-hire-comparison')).toBeVisible(); await expect(q.getByTestId('hp-row').first()).toBeVisible(); await noOverflow(q); await shot(q, '5-comparison', info);
  await q.goto('/plant/hire-agreements'); await expect(q.getByTestId('plant-hire-agreements')).toBeVisible(); const dl = q.waitForEvent('download'); await q.getByTestId('hl-export').click(); expect((await dl).suggestedFilename()).toMatch(/hire-agreements/); await noOverflow(q); await shot(q, '6-list', info); await pl.context.close();
  const none = await open(browser, info, c, 'SK', 'nobody', '/plant/hire-agreements'); await expect(none.page.getByText('plant.hire_agreement.view')).toBeVisible(); await none.context.close();
  expect(errors).toEqual([]);
});
