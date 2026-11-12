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
// Part 16.08 in the browser (development-header mode, port 3100): assets are issued to a subcontractor on the phone and approved, the dashboard and the reconciliation show them, they come back good, repairable and lost,
// the recoveries go to the quantity surveyor and the project manager, a hired-in lot is billed and the bill checked. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-rta';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['sk1', ['SK']], ['mgr1', ['STOREMGR']], ['mgr2', ['STOREMGR']], ['cm', ['CM']], ['qs', ['QS']], ['pm', ['PM']], ['pr', ['PROCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Formwork tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Formwork site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'FORM', 'Formwork', 'FRM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Shuttering plate', 'RETURNABLE', ?, 'nos', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-PLT`, cat).lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Store A', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-A`, pid, site, JSON.stringify([`${t}-sk1`])).lastInsertRowid);
  const partner = (code) => Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run(c, `${T}-${code}`, `Partner ${code}`, code).lastInsertRowid);
  const subco = partner('SUBA'); const vendor = partner('RENT'); db.close(); return { u: (k) => `${t}-${k}`, T, item, a, subco, vendor, pid };
}
// the approver of a workflow instance decides its task through the API
async function approve(request, c, roles, user, docType, docId) {
  const rows = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H(roles, c, user) })).json()).data.rows; const task = rows.find((x) => x.instance.docType === docType && String(x.instance.docId) === String(docId)); expect(task, `${user} has the task`).toBeTruthy();
  const res = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: H(roles, c, user), data: { action: 'approve', comment: 'Approved in the test' } }); expect(res.status(), await res.text()).toBe(200);
}
const move = async (request, c, s, body) => { const m = await api(request, c, 'SK', s.u('sk1'), 'post', '/inv/rta/movements', body); await api(request, c, 'SK', s.u('sk1'), 'post', `/inv/rta/movements/${m.id}/submit`, {}); await approve(request, c, 'STOREMGR', s.u('mgr1'), 'INV_RTA_MOVEMENT', m.id); return m; };

test('Returnable site assets: issue on the phone and approval, dashboard and reconciliation, return good / repairable / lost, recoveries approved, a hired-in lot billed and checked', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `a${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/rta/catalogue', { itemId: s.item, group: 'FORMWORK', unitWeight: 12.5, internalRate: 2, rateBasis: 'DAY', replacementValue: 1000, lifeMonths: 60 });
  await move(request, c, s, { type: 'RECEIPT', itemId: s.item, toStoreId: s.a, qty: 200, movementDate: plus(-20) });
  const k = await open(browser, info, c, 'SK', s.u('sk1'), '/inv/rta-issue'); const p = k.page; const errors = watch(p);
  await expect(p.getByTestId('rta-issue')).toBeVisible(); await p.getByTestId('ri-item').selectOption({ index: 1 }); await p.getByTestId('ri-from').selectOption({ index: 1 }); await p.getByTestId('ri-qty').fill('40'); await p.getByTestId('ri-party').selectOption({ label: 'Partner SUBA' }); await p.getByTestId('ri-project').selectOption({ index: 1 }); await p.getByTestId('ri-expected').fill(plus(-1)); await p.getByTestId('ri-date').fill(plus(-10));
  await noOverflow(p); await shot(p, '1-issue', info); await p.getByTestId('ri-send').click(); await expect(p.getByTestId('rtam-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url = here(p);
  const cm = await open(browser, info, c, 'CM', s.u('cm'), url); await expect(cm.page.getByTestId('rtam-decide')).toBeVisible(); await cm.page.getByTestId('rtam-approve').click(); await expect(cm.page.getByTestId('rtam-note')).toBeVisible(); await cm.context.close();
  await p.reload(); await expect(p.getByTestId('rtam-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('rtam-qty')).toContainText('40');
  const m = await open(browser, info, c, 'STOREMGR', s.u('mgr1'), '/inv/rta'); const q = m.page; await expect(q.getByTestId('rta-dashboard')).toBeVisible(); await expect(q.getByTestId('rta-kpi-field')).toContainText('40'); await expect(q.getByTestId('rta-kpi-overdue')).toContainText('40'); await expect(q.getByTestId('rta-recon-status')).toBeVisible(); await noOverflow(q); await shot(q, '2-dashboard', info);
  await p.goto('/inv/rta-issue'); await p.getByTestId('ri-type').selectOption('RETURN'); await p.getByTestId('ri-item').selectOption({ index: 1 }); await p.getByTestId('ri-holding').selectOption({ index: 1 }); await p.getByTestId('ri-to').selectOption({ index: 1 }); await p.getByTestId('ri-good').fill('30'); await p.getByTestId('ri-repairable').fill('5'); await p.getByTestId('ri-lost').fill('5'); await p.getByTestId('ri-date').fill(plus(-2)); await noOverflow(p); await shot(p, '3-return', info);
  await p.getByTestId('ri-send').click(); await expect(p.getByTestId('rtam-object')).toHaveAttribute('data-status', 'SUBMITTED'); const ret = here(p);
  const cm2 = await open(browser, info, c, 'CM', s.u('cm'), ret); await cm2.page.getByTestId('rtam-approve').click(); await expect(cm2.page.getByTestId('rtam-note')).toBeVisible(); await cm2.context.close(); await p.reload(); await expect(p.getByTestId('rtam-split')).toBeVisible(); await expect(p.getByTestId('rtam-recoveries')).toBeVisible();
  await q.goto('/inv/rta-hire?tab=recoveries'); await expect(q.getByTestId('rec-table')).toBeVisible(); await q.locator('[data-testid^="rec-submit-"]').first().click(); await expect(q.getByTestId('rec-note')).toBeVisible(); await noOverflow(q); await shot(q, '4-recoveries', info);
  const qs = await open(browser, info, c, 'QS', s.u('qs'), '/inv/rta-hire?tab=recoveries'); await qs.page.locator('[data-testid^="rec-approve-"]').first().click(); await expect(qs.page.getByTestId('rec-note')).toBeVisible(); await qs.context.close();
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/inv/rta-hire?tab=recoveries'); await pm.page.locator('[data-testid^="rec-approve-"]').first().click(); await expect(pm.page.getByTestId('rec-note')).toBeVisible(); await pm.context.close();
  await q.reload(); await expect(q.getByTestId('rec-total-recover')).toBeVisible();
  await move(request, c, s, { type: 'HIRE_IN', itemId: s.item, toStoreId: s.a, qty: 50, vendorId: s.vendor, hireRate: 10, hireBasis: 'DAY', movementDate: plus(-4), orderRef: 'RENT/1' });
  await q.goto('/inv/rta-hire'); await expect(q.getByTestId('hire-table')).toBeVisible(); await expect(q.getByTestId('hire-total-internal')).toBeVisible(); await noOverflow(q); await shot(q, '5-hire', info);
  const pr = await open(browser, info, c, 'PROCMGR', s.u('pr'), '/inv/rta-hire'); const row = pr.page.locator('[data-testid^="hire-row-"]').filter({ hasText: 'Partner RENT' }).first(); await expect(row).toBeVisible(); await row.locator('[data-testid^="hire-billno-"]').fill('B-100'); await row.locator('[data-testid^="hire-billamt-"]').fill('2500'); await row.locator('[data-testid^="hire-verify-"]').click(); await expect(pr.page.getByTestId('hire-note')).toBeVisible(); await expect(row.locator('[data-testid^="hire-bill-"]')).toContainText('B-100'); await pr.context.close();
  await q.goto('/inv/rta?tab=catalogue'); await expect(q.getByTestId('rta-catalogue-table')).toBeVisible(); await noOverflow(q); await q.goto('/inv/rta-movements'); await expect(q.getByTestId('rta-movements')).toBeVisible(); await noOverflow(q);
  expect(errors).toEqual([]);
});
