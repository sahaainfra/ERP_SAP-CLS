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
// Part 17.05 in the browser (development-header mode, port 3100): the plant manager sets up a plan, a service falls due, the plant supervisor raises the job card from the schedule, another supervisor approves, the store keeper reserves and issues the spare (the stock falls),
// the work is started and closed, the plan moves on, and the dashboard shows the figures. Desktop and mobile.
const OUT = 'docs/erp/screenshots/plant-maint';
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
  for (const [n, roles] of [['sk', ['SK']], ['su1', ['PMSUP']], ['su2', ['PMSUP']], ['pm', ['PM']], ['pl', ['PLANTMGR']], ['mg1', ['STOREMGR']], ['mg2', ['STOREMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Plant tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Plant site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cls = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Excavator 20 t', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(c, `${T}-EXC`, cat).lastInsertRowid);
  const filter = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Oil filter', 'MATERIAL', ?, 'nos', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-OILF`, cat).lastInsertRowid);
  const eq = fill(db, 'plt_equipment', { company_id: c, asset_code: `${T}-EX1`, class_item_id: cls, ownership: 'OWNED', purchase_value: 100000, meter_type: 'HOURS', fuel_type: 'DIESEL', status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z', approved_by: 'x', requested_by: 'x', equip_state: 'DEPLOYED', org_project_id: pid, org_site_id: site });
  const al = fill(db, 'plt_allocations', { company_id: c, equipment_id: eq, org_project_id: pid, org_site_id: site, from_date: plus(-5), to_date: plus(60), internal_rate: 150000, charge_basis: 'DAY', status: 'APPROVED', phase: 'ON_SITE', arrived_on: plus(-5), arrival_meter: 1000000, requested_by: 'x' });
  fill(db, 'plt_logs', { company_id: c, equipment_id: eq, allocation_id: al, org_project_id: pid, org_site_id: site, log_date: plus(-1), shift: 'GENERAL', start_meter: 1000000, end_meter: 1240000, working_hrs: 8000, status: 'APPROVED', requested_by: 'x' });
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site, eq, filter };
}
test('Plant maintenance: a plan falls due, the job card is raised, approved, spares reserved and issued, the work closed; the dashboard', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `j${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const plan = await api(request, c, 'PLANTMGR', s.u('pl'), 'post', '/plant/pm/plans', { code: `${s.T}-OIL`, task: 'Engine oil and filter', equipmentId: s.eq, intervalType: 'HOURS', interval: 250, critical: true, lastDoneMeter: 1000, lastDoneDate: plus(-5) });
  const store = await api(request, c, 'STOREMGR', s.u('mg1'), 'post', '/inv/stores', { code: `${s.T}-ST`, name: 'Plant store', type: 'SITE_STORE', projectId: s.pid, siteId: s.site, keepers: [s.u('sk')] }); const sub = await api(request, c, 'STOREMGR', s.u('mg1'), 'post', `/inv/stores/${store.id}/submit`, {});
  const tasks = await api(request, c, 'STOREMGR', s.u('mg2'), 'get', '/workflow/tasks?mine=assigned'); await api(request, c, 'STOREMGR', s.u('mg2'), 'post', `/workflow/tasks/${tasks.rows.find((x) => x.instance.id === sub.workflowInstanceId).id}/act`, { action: 'approve', comment: 'Fine' });
  await api(request, c, 'STOREMGR', s.u('mg1'), 'post', '/inv/movements', { storeId: store.id, itemId: s.filter, type: 'RECEIPT', qty: 10, rate: 450, date: today, reason: 'Opening stock' }); void plan;
  // the schedule shows the service due, and a critical overdue... the supervisor raises the card
  const su = await open(browser, info, c, 'PMSUP', s.u('su1'), '/plant/pm-schedule'); const p = su.page; const errors = watch(p);
  await expect(p.getByTestId('plant-pm-schedule')).toBeVisible(); await expect(p.getByTestId('ps-row')).toHaveCount(1); await expect(p.getByTestId('ps-row').first()).toHaveAttribute('data-state', 'DUE'); await noOverflow(p); await shot(p, '1-schedule', info);
  await p.getByTestId('ps-raise').click(); await expect(p.getByTestId('plant-job-new')).toBeVisible(); await expect(p.getByTestId('jn-pm-check')).toBeChecked(); await p.getByTestId('jn-mechanic').fill('Raju'); await p.getByTestId('jn-labour').fill('2'); await noOverflow(p); await shot(p, '2-new-job', info); await p.getByTestId('jn-save').click();
  await expect(p.getByTestId('jc-object')).toHaveAttribute('data-status', 'DRAFT'); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  await p.getByTestId('jc-spare-item').selectOption(String(s.filter)); await p.getByTestId('jc-spare-store').selectOption(String(store.id)); await p.getByTestId('jc-spare-qty').fill('1'); await p.getByTestId('jc-spare-add').click(); await expect(p.getByTestId('jc-spare-row')).toHaveCount(1);
  await p.getByTestId('jc-submit').click(); await expect(p.getByTestId('jc-object')).toHaveAttribute('data-status', 'SUBMITTED'); await noOverflow(p); await shot(p, '3-job-submitted', info);
  const su2 = await open(browser, info, c, 'PMSUP', s.u('su2'), url); await expect(su2.page.getByTestId('jc-decide')).toBeVisible(); await su2.page.getByTestId('jc-approve').click(); await expect(su2.page.getByTestId('jc-note')).toBeVisible(); await su2.context.close();
  // the store keeper reserves and issues the spare
  const sk = await open(browser, info, c, 'SK', s.u('sk'), url); await expect(sk.page.getByTestId('jc-object')).toHaveAttribute('data-status', 'APPROVED'); await sk.page.getByTestId('jc-reserve').click(); await expect(sk.page.getByTestId('jc-note')).toContainText('reserved'); await sk.page.getByTestId('jc-issue').click(); await expect(sk.page.getByTestId('jc-spare-row').first()).toHaveAttribute('data-status', 'ISSUED'); await noOverflow(sk.page); await sk.context.close();
  const db = new DatabaseSync('data/e2e.sqlite'); const onHand = db.prepare('SELECT COALESCE(SUM(qty_on_hand), 0) AS q FROM inv_balances WHERE item_id = ?').get(s.filter).q; db.close(); expect(onHand).toBe(9000);
  // the work: start, then close with the meter of the service
  await p.goto(url); await p.getByTestId('jc-start').click(); await expect(p.getByTestId('jc-object')).toHaveAttribute('data-work', 'IN_PROGRESS'); await p.getByTestId('jc-complete-open').click(); await p.getByTestId('jc-workdone').fill('Engine oil and filter changed'); await p.getByTestId('jc-meter').fill('1240'); await noOverflow(p); await shot(p, '4-complete', info); await p.getByTestId('jc-complete').click();
  await expect(p.getByTestId('jc-object')).toHaveAttribute('data-work', 'CLOSED'); await p.reload(); await expect(p.getByTestId('jc-details')).toContainText('1,240'); await noOverflow(p); await shot(p, '5-job-closed', info);
  // the plan moved on; the dashboard and the list
  const pl = await open(browser, info, c, 'PLANTMGR', s.u('pl'), '/plant/pm-schedule'); const q = pl.page; await expect(q.getByTestId('ps-row').first()).toHaveAttribute('data-state', 'OK'); await q.getByTestId('ps-tab-plans').click(); await expect(q.getByTestId('ps-plan-row')).toHaveCount(1);
  await q.getByTestId('ps-new').click(); await q.getByTestId('ps-code').fill(`${s.T}-GR`); await q.getByTestId('ps-task').fill('Greasing'); await q.getByTestId('ps-class').selectOption({ index: 1 }); await q.getByTestId('ps-interval').fill('50'); await q.getByTestId('ps-create').click(); await expect(q.getByTestId('ps-plan-row')).toHaveCount(2); await noOverflow(q); await shot(q, '6-plans', info);
  await q.goto('/plant/maintenance'); await expect(q.getByTestId('plant-maintenance')).toBeVisible(); await expect(q.getByTestId('md-tile-openJobs')).toBeVisible(); await expect(q.getByTestId('md-tile-monthCost')).toContainText('₹'); await noOverflow(q); await shot(q, '7-dashboard', info);
  const dl = q.waitForEvent('download'); await q.getByTestId('md-export').click(); expect((await dl).suggestedFilename()).toMatch(/maintenance-mtbf-mttr/); await q.goto('/plant/job-cards'); await expect(q.getByTestId('plant-job-cards')).toBeVisible(); await noOverflow(q); await shot(q, '8-list', info); await pl.context.close();
  const none = await open(browser, info, c, 'ACCMGR', 'nobody', '/plant/pm-schedule'); await expect(none.page.getByTestId('plant-pm-schedule')).toBeVisible(); await none.context.close();
  expect(errors).toEqual([]);
});
