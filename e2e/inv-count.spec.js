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
// Part 16.06 in the browser (development-header mode, port 3100): a store keeper plans a count, the store manager starts it, two keepers count blind and recount a difference, the count is closed and reviewed, the adjustment is raised;
// scrap is entered and written off through approval; the expiry report is shown. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-count';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['sk1', ['SK']], ['sk2', ['SK']], ['mgr1', ['STOREMGR']], ['mgr2', ['STOREMGR']], ['mgr3', ['STOREMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Count tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Count site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Store A', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-A`, pid, site, JSON.stringify([`${t}-sk1`, `${t}-sk2`])).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, T, item, a };
}

test('Physical verification: a plan is approved, started, counted blind with a recount, closed, reviewed and adjusted; scrap is entered and written off; expiry is shown', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `c${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.a, itemId: s.item, type: 'RECEIPT', qty: 100, rate: 40, date: today, reason: 'Opening for the test' });
  const k = await open(browser, info, c, 'SK', s.u('sk1'), '/inv/count-plans'); const p = k.page; const errors = watch(p);
  await expect(p.getByTestId('count-plans')).toBeVisible(); await p.getByTestId('plan-add').click(); await p.getByTestId('plan-store').selectOption({ index: 1 }); await p.getByTestId('plan-create').click();
  await expect(p.getByTestId('plan-object')).toHaveAttribute('data-status', 'DRAFT'); const url = here(p); await noOverflow(p); await shot(p, '1-plan', info);
  await p.getByTestId('plan-submit').click(); await expect(p.getByTestId('plan-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const a2 = await open(browser, info, c, 'STOREMGR', s.u('mgr2'), url); await expect(a2.page.getByTestId('plan-decide')).toBeVisible(); await a2.page.getByTestId('plan-approve').click(); await expect(a2.page.getByTestId('plan-note')).toBeVisible(); await a2.context.close();
  const m = await open(browser, info, c, 'STOREMGR', s.u('mgr1'), url); await expect(m.page.getByTestId('plan-object')).toHaveAttribute('data-status', 'APPROVED'); await m.page.getByTestId('plan-start').click(); await expect(m.page.getByTestId('plan-object')).toHaveAttribute('data-status', 'COUNTING'); await expect(m.page.getByTestId('plan-frozen')).toBeVisible(); await shot(m.page, '2-counting', info);
  const b = await open(browser, info, c, 'SK', s.u('sk1'), '/inv/blind-count'); const q = b.page; await expect(q.getByTestId('blind-queue')).toBeVisible(); await q.getByTestId(/queue-open-/).first().click(); await expect(q.getByTestId('blind-sheet')).toBeVisible();
  await expect(q.getByTestId('sheet-lines')).not.toContainText('100'); await q.getByTestId('sheet-qty-1').fill('90'); await noOverflow(q); await shot(q, '3-blind', info); await q.getByTestId('sheet-save').click(); await expect(q.getByTestId('sheet-note')).toBeVisible(); await expect(q.getByTestId('sheet-recount')).toContainText('1');
  const r = await open(browser, info, c, 'SK', s.u('sk2'), q.url().replace(/^https?:\/\/[^/]+/, '')); await r.page.getByTestId('mode-recount').click(); await r.page.getByTestId('sheet-qty-1').fill('91'); await r.page.getByTestId('sheet-save').click(); await expect(r.page.getByTestId('sheet-note')).toBeVisible();
  await r.page.goto(url); await expect(r.page.getByTestId('plan-close')).toBeVisible(); await r.page.getByTestId('plan-close').click(); await expect(r.page.getByTestId('plan-object')).toHaveAttribute('data-status', 'REVIEW'); await expect(r.page.getByTestId('plan-lines')).not.toContainText('Book'); await r.context.close();
  const v = await open(browser, info, c, 'STOREMGR', s.u('mgr3'), url); await expect(v.page.getByTestId('plan-lines')).toBeVisible(); await v.page.getByTestId('plan-reason-1').fill('Bags torn and swept away'); await v.page.getByTestId('plan-save-reasons').click(); await expect(v.page.getByTestId('plan-note')).toBeVisible(); await v.page.getByTestId('plan-adjust').click(); await expect(v.page.getByTestId('plan-adjustment')).toBeVisible(); await noOverflow(v.page); await shot(v.page, '4-adjusted', info);
  await v.page.goto('/inv/count-variance'); await expect(v.page.getByTestId('cv-table')).toBeVisible(); await expect(v.page.getByTestId('cv-loss')).toBeVisible(); await noOverflow(v.page); await shot(v.page, '5-variance', info);
  await p.goto('/inv/scrap?tab=register'); await expect(p.getByTestId('entry-new')).toBeVisible(); await p.getByTestId('entry-store').selectOption({ index: 1 }); await p.getByTestId('entry-what').fill('Steel off-cuts'); await p.getByTestId('entry-qty').fill('2'); await p.getByTestId('entry-uom').fill('lot'); await p.getByTestId('entry-save').click(); await expect(p.getByTestId('entry-note')).toBeVisible(); await noOverflow(p); await shot(p, '6-scrap', info);
  await m.page.goto('/inv/scrap?tab=disposals'); await m.page.getByTestId('disposal-add').click(); await m.page.getByTestId('disp-store').selectOption({ index: 1 }); await m.page.getByTestId('disp-method').selectOption('WRITE_OFF'); await m.page.locator('[data-testid^="disp-pick-"]').first().check(); await m.page.getByTestId('disp-create').click();
  await expect(m.page.getByTestId('disposal-object')).toHaveAttribute('data-status', 'DRAFT'); await m.page.getByTestId('disposal-submit').click(); await expect(m.page.getByTestId('disposal-object')).toHaveAttribute('data-status', 'SUBMITTED'); await noOverflow(m.page); await shot(m.page, '7-disposal', info);
  await m.page.goto('/inv/scrap?tab=expiry'); await expect(m.page.getByTestId('expiry')).toBeVisible(); await expect(m.page.getByTestId('expiry-empty')).toBeVisible(); await noOverflow(m.page); await m.context.close();
  expect(errors).toEqual([]);
});
