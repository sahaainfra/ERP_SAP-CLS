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
// Part 16.07 in the browser (development-header mode, port 3100): reorder parameters are made and approved by a second person, a suggestion appears when stock falls below the level and becomes a DRAFT material request,
// the ageing report and redeployment tab show, labels are made and a scanned code fills a transfer line. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-reorder';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['sk1', ['SK']], ['mgr1', ['STOREMGR']], ['mgr2', ['STOREMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Reorder tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Reorder site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Store A', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-A`, pid, site, JSON.stringify([`${t}-sk1`])).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, T, item, a, code: `${T}-CEM` };
}

test('Reorder control: parameters approved by a second person, a suggestion becomes a draft material request, ageing and redeployment shown, labels made, a scanned code fills a transfer line', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `r${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.a, itemId: s.item, type: 'RECEIPT', qty: 100, rate: 40, date: today, reason: 'Opening for the test' });
  const m = await open(browser, info, c, 'STOREMGR', s.u('mgr1'), '/inv/reorder-params'); const p = m.page; const errors = watch(p);
  await expect(p.getByTestId('reorder-params')).toBeVisible(); await p.getByTestId('rp-store').selectOption({ index: 1 }); await p.getByTestId('rp-edit').click(); await expect(p.getByTestId('rp-editor')).toBeVisible(); await p.getByTestId('rp-add').click(); await p.getByTestId('rp-item-0').selectOption({ index: 1 });
  await p.getByTestId('rp-minQty-0').fill('10'); await p.getByTestId('rp-reorderLevel-0').fill('40'); await p.getByTestId('rp-reorderQty-0').fill('100'); await p.getByTestId('rp-maxQty-0').fill('200'); await noOverflow(p); await shot(p, '1-parameters', info);
  await p.getByTestId('rp-send').click(); await expect(p.getByTestId('rchange-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url = here(p);
  const a2 = await open(browser, info, c, 'STOREMGR', s.u('mgr2'), url); await expect(a2.page.getByTestId('rchange-decide')).toBeVisible(); await a2.page.getByTestId('rchange-approve').click(); await expect(a2.page.getByTestId('rchange-note')).toBeVisible(); await a2.context.close();
  await p.reload(); await expect(p.getByTestId('rchange-object')).toHaveAttribute('data-status', 'APPROVED'); await noOverflow(p);
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.a, itemId: s.item, type: 'ISSUE', qty: 70, date: today, reason: 'Issued for the test' });
  await p.goto('/inv/reorder-suggestions'); await expect(p.getByTestId('reorder-suggestions')).toBeVisible(); await p.getByTestId('rs-run').click(); await expect(p.getByTestId('rs-table')).toBeVisible(); await expect(p.getByTestId('rs-kpi-open')).toContainText('1'); await noOverflow(p); await shot(p, '2-suggestions', info);
  await p.locator('[data-testid^="rs-pick-"]').first().check(); await p.getByTestId('rs-convert').click(); await expect(p.getByTestId('rs-note')).toBeVisible(); await p.getByTestId('rs-status').selectOption(''); await expect(p.locator('[data-testid^="rs-mr-"]').first()).toBeVisible();
  await p.goto('/inv/ageing'); await expect(p.getByTestId('ageing-table')).toBeVisible(); await expect(p.getByTestId('ageing-chart')).toBeVisible(); await noOverflow(p); await shot(p, '3-ageing', info); await p.goto('/inv/ageing?tab=redeploy'); await expect(p.getByTestId('redeploy-empty')).toBeVisible(); await noOverflow(p);
  const k = await open(browser, info, c, 'SK', s.u('sk1'), '/inv/labels'); const q = k.page; await expect(q.getByTestId('labels')).toBeVisible(); await q.getByTestId('lb-search').fill(s.code); await q.getByTestId('lb-pick-0').check(); await q.getByTestId('lb-copies').fill('2'); await q.getByTestId('lb-make').click(); await expect(q.getByTestId('lb-sheet')).toBeVisible(); await expect(q.getByTestId('lb-card-0-1')).toBeVisible(); await expect(q.getByTestId('lb-print')).toBeVisible(); await noOverflow(q); await shot(q, '4-labels', info);
  await q.getByTestId('lb-format').selectOption('A4'); await q.getByTestId('lb-type').selectOption('BIN'); await q.getByTestId('lb-store').selectOption({ index: 1 }); await q.getByTestId('lb-pick-0').check(); await q.getByTestId('lb-make').click(); await expect(q.getByTestId('lb-sheet')).toBeVisible();
  await q.goto('/inv/transfer-new'); await expect(q.getByTestId('transfer-new')).toBeVisible(); await q.getByTestId('tn-scan').fill(`ERP:I:${s.code}`); await q.getByTestId('tn-scan').press('Enter'); await expect(q.getByTestId('tn-scan-msg')).toContainText(s.code); await expect(q.getByTestId('tn-item-0')).not.toHaveValue(''); await q.getByTestId('tn-scan').fill('NOPE-CODE'); await q.getByTestId('tn-scan').press('Enter'); await expect(q.getByTestId('tn-scan-msg')).toBeVisible(); await noOverflow(q); await shot(q, '5-scan', info);
  expect(errors).toEqual([]);
});
