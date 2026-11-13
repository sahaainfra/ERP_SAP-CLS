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
// Part 17.02 in the browser (development-header mode, port 3100): the site engineer raises a requisition, the construction manager and the project manager approve it, the plant manager finds a free machine at the allocation desk and allocates it,
// the project manager approves, the supervisor sends it, accepts it on arrival against the checklist, assigns an operator (blocked without a certificate) and demobilises it; the Gantt shows the bars and moves a draft. Desktop and mobile.
const OUT = 'docs/erp/screenshots/plant-alloc';
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
  for (const [n, roles] of [['se', ['SE']], ['cm', ['CM']], ['pm', ['PM']], ['pl', ['PLANTMGR']], ['su', ['PMSUP']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Allocation tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Allocation site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'EQUIP', 'Equipment', 'EQ', '[]', '[]', 'PLANTMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cls = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Mobile crane 25 t', 'EQUIPMENT', ?, 'nos', '2026-01-01', 'ACTIVE', 0)").run(c, `${T}-CRN`, cat).lastInsertRowid);
  const eq = fill(db, 'plt_equipment', { company_id: c, asset_code: `${T}-CR1`, class_item_id: cls, make: 'Escorts', model: 'F-15', ownership: 'OWNED', purchase_value: 5000000, meter_type: 'HOURS', fuel_norm_unit: 'L_PER_HOUR', road_vehicle: 0, lifting: 1, operator_required: 1, operator_licence_class: 'CRANE_OP', capacity: '25 t', status: 'APPROVED', approved_at: '2026-01-01T00:00:00Z', approved_by: 'x', requested_by: 'x', equip_state: 'AVAILABLE' });
  fill(db, 'plt_documents', { company_id: c, equipment_id: eq, doc_type: 'LOAD_TEST', valid_until: plus(300), doc_status: 'CURRENT', mandatory: 1 });
  fill(db, 'trn_cert_types', { company_id: c, code: 'CRANE_OP', name: 'Crane operator licence', validity_months: 12, alert_days: 30 }); const e1 = fill(db, 'hr_employees', { company_id: c, emp_code: `${T}-E1`, full_name: 'Raju Operator', employment_status: 'ACTIVE' });
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site, cls, eq, e1 };
}
test('Plant allocation: requisition, approvals, allocation, arrival with checklist, operator certificate check, Gantt, demobilisation', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const t = `a${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  // the site engineer asks for a crane
  const se = await open(browser, info, c, 'SE', s.u('se'), '/plant/requisitions/new'); const p = se.page; const errors = watch(p);
  await p.getByTestId('rn-project').selectOption(String(s.pid)); await p.getByTestId('rn-site').selectOption(String(s.site)); await p.getByTestId('rn-class').selectOption(String(s.cls)); await p.getByTestId('rn-capacity').fill('25 t'); await p.getByTestId('rn-from').fill(plus(1)); await p.getByTestId('rn-to').fill(plus(40)); await p.getByTestId('rn-purpose').fill('Slab lifting, block A');
  await expect(p.getByTestId('rn-avail')).toContainText('1 machine'); await noOverflow(p); await shot(p, '1-requisition-form', info); await p.getByTestId('rn-submit').click(); await expect(p.getByTestId('rq-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  for (const [role, user] of [['CM', 'cm'], ['PM', 'pm']]) { const a = await open(browser, info, c, role, s.u(user), url); await expect(a.page.getByTestId('rq-decide')).toBeVisible(); await a.page.getByTestId('rq-approve').click(); await expect(a.page.getByTestId('rq-note')).toBeVisible(); await a.context.close(); }
  // the allocation desk
  const pl = await open(browser, info, c, 'PLANTMGR', s.u('pl'), '/plant/requisitions'); const q = pl.page; await q.getByTestId('rq-view-desk').click(); await expect(q.getByTestId('rq-desk-row')).toHaveCount(1); await q.getByTestId('rq-desk-row').getByRole('link').click();
  await expect(q.getByTestId('rq-object')).toHaveAttribute('data-fulfilment', 'OPEN'); await expect(q.getByTestId('rq-avail-row')).toHaveCount(1); await expect(q.getByTestId('rq-avail-row')).toHaveAttribute('data-usable', 'true'); await shot(q, '2-desk', info); await q.getByTestId('rq-allocate').getByRole('link').click();
  await expect(q.getByTestId('plant-al-new')).toBeVisible(); await q.getByTestId('an-rate').fill('1800'); await q.getByTestId('an-submit').click(); await expect(q.getByTestId('al-object')).toHaveAttribute('data-status', 'SUBMITTED'); const aurl = q.url().replace(/^https?:\/\/[^/]+/, '');
  const pm = await open(browser, info, c, 'PM', s.u('pm'), aurl); await expect(pm.page.getByTestId('al-decide')).toBeVisible(); await pm.page.getByTestId('al-approve').click(); await expect(pm.page.getByTestId('al-note')).toBeVisible(); await pm.context.close();
  // the supervisor sends, accepts on arrival and assigns an operator
  const su = await open(browser, info, c, 'PMSUP', s.u('su'), aurl); const m = su.page; await expect(m.getByTestId('al-object')).toHaveAttribute('data-phase', 'PLANNED'); await m.getByTestId('al-tab-mobilisation').click(); await m.getByTestId('al-vehicle').fill('MH12TR0001'); await m.getByTestId('al-dispatch-meter').fill('1500'); await m.getByTestId('al-mobilise-go').click(); await expect(m.getByTestId('al-object')).toHaveAttribute('data-phase', 'IN_TRANSIT');
  await m.getByTestId('al-arrival-meter').fill('1501'); await m.getByTestId('al-check-BRAKES_SAFETY').selectOption('FAIL'); await m.getByTestId('al-note-BRAKES_SAFETY').fill('Worn pads'); await m.getByTestId('al-arrive-go').click(); await expect(m.getByTestId('al-error')).toContainText('cannot be accepted'); await noOverflow(m); await shot(m, '3-checklist-blocked', info);
  await m.getByTestId('al-check-BRAKES_SAFETY').selectOption('PASS'); await m.getByTestId('al-arrive-go').click(); await expect(m.getByTestId('al-object')).toHaveAttribute('data-phase', 'ON_SITE'); await expect(m.getByTestId('al-arrival-shown')).toContainText('1,501');
  await m.getByTestId('al-tab-operators').click(); await expect(m.getByTestId('al-ops-empty')).toContainText('licensed operator'); await m.getByTestId('al-op-search').fill('Raju'); await m.getByTestId('al-op-person').selectOption({ index: 1 }); await m.getByTestId('al-op-go').click(); await expect(m.getByTestId('al-error')).toContainText('no Crane operator licence');
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); fill(db, 'trn_certifications', { company_id: c, person_type: 'EMPLOYEE', person_id: s.e1, cert_type: 'CRANE_OP', number: 'L-1', valid_from: plus(-100), valid_until: plus(400), verified: 1, cert_status: 'ACTIVE' }); db.close();
  await m.getByTestId('al-op-go').click(); await expect(m.getByTestId('al-op-row')).toHaveCount(1); await noOverflow(m); await shot(m, '4-operator', info);
  // the Gantt
  await m.goto('/plant/gantt'); await expect(m.getByTestId('plant-gantt')).toBeVisible(); await expect(m.getByTestId('gt-bar')).toHaveCount(1); await expect(m.getByTestId('gt-bar')).toHaveAttribute('data-editable', 'false'); await expect(m.getByTestId('gt-legend')).toBeVisible(); await m.getByTestId('gt-zoom').selectOption('week'); await noOverflow(m); await shot(m, '5-gantt', info);
  // demobilise
  await m.goto(aurl); await m.getByTestId('al-tab-mobilisation').click(); await m.getByTestId('al-departure-meter').fill('1400'); await m.getByTestId('al-demob-go').click(); await expect(m.getByTestId('al-error')).toContainText('cannot be below'); await m.getByTestId('al-departure-meter').fill('1560'); await m.getByTestId('al-demob-go').click(); await expect(m.getByTestId('al-object')).toHaveAttribute('data-phase', 'RELEASED'); await expect(m.getByTestId('al-usage')).toContainText('59');
  await m.goto('/plant/allocations'); await expect(m.getByTestId('plant-al-list')).toBeVisible(); await noOverflow(m);
  const sk = await open(browser, info, c, 'SK', 'nobody', '/plant/allocations'); await expect(sk.page.getByText('plant.allocation.view')).toBeVisible(); await sk.context.close();
  expect(errors).toEqual([]);
});
