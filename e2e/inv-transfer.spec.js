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
// Part 16.05 in the browser (development-header mode, port 3100): a transfer is requested by the source keeper, approved, dispatched (stock in transit with a gate pass), part received at the destination with a damaged bag and a shortage,
// the in-transit report shows it, and the store manager resolves both discrepancies. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-transfer';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['sk1', ['SK']], ['sk2', ['SK']], ['mgr1', ['STOREMGR']], ['cm', ['CM']], ['pr', ['PROCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Transfer tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Transfer site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const store = (code, keeper) => { const st = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, ?, 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-${code}`, `Store ${code}`, pid, site, JSON.stringify([`${t}-${keeper}`])).lastInsertRowid); db.prepare("INSERT INTO inv_bins (company_id, store_id, code, is_default, created_by) VALUES (?, ?, 'MAIN', 1, 'e2e')").run(c, st); return st; };
  const a = store('A', 'sk1'); const b = store('B', 'sk2'); db.close(); return { u: (k) => `${t}-${k}`, T, item, a, b };
}

test('Stock transfer: requested, approved, dispatched into transit, received with a damaged bag and a shortage, reported in transit, and both discrepancies resolved', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const t = `t${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.a, itemId: s.item, type: 'RECEIPT', qty: 200, rate: 40, date: today, reason: 'Opening for the test' });
  const k = await open(browser, info, c, 'SK', s.u('sk1'), '/inv/transfer-new'); const p = k.page; const errors = watch(p);
  await expect(p.getByTestId('transfer-new')).toBeVisible(); await p.getByTestId('tn-from').selectOption({ index: 1 }); await p.getByTestId('tn-to').selectOption({ index: 1 }); await p.getByTestId('tn-item-0').selectOption({ index: 1 }); await p.getByTestId('tn-qty-0').fill('60'); await p.getByTestId('tn-reason').fill('Ground floor slab needs more cement'); await noOverflow(p); await shot(p, '1-request', info);
  await p.getByTestId('tn-send').click(); await expect(p.getByTestId('transfer-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url = here(p);
  const cm = await open(browser, info, c, 'CM', s.u('cm'), url); await expect(cm.page.getByTestId('transfer-decide')).toBeVisible(); await cm.page.getByTestId('transfer-approve').click(); await expect(cm.page.getByTestId('transfer-note')).toBeVisible(); await cm.context.close();
  await p.reload(); await expect(p.getByTestId('transfer-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('transfer-dispatch')).toBeVisible(); await p.getByTestId('td-vehicle').fill('MH 12 AB 1234'); await p.getByTestId('td-driver').fill('Ramesh'); await noOverflow(p); await shot(p, '2-dispatch', info);
  await p.getByTestId('td-send').click(); await expect(p.getByTestId('transfer-object')).toHaveAttribute('data-status', 'IN_TRANSIT'); await expect(p.getByTestId('transfer-pass')).toBeVisible(); await expect(p.getByTestId('transfer-line-1')).toContainText('60');
  const m = await open(browser, info, c, 'STOREMGR', s.u('mgr1'), '/inv/in-transit'); await expect(m.page.getByTestId('it-table')).toBeVisible(); await expect(m.page.getByTestId('it-bucket-0-2')).toBeVisible(); await noOverflow(m.page); await shot(m.page, '3-in-transit', info);
  const r = await open(browser, info, c, 'SK', s.u('sk2'), '/inv/transfer-receive'); const q = r.page; await expect(q.getByTestId('rc-list')).toBeVisible(); await q.getByTestId(/rc-open-/).first().click(); await expect(q.getByTestId('transfer-receive-form')).toBeVisible(); await q.getByTestId('rc-rec-1').fill('50'); await q.getByTestId('rc-dam-1').fill('5'); await q.getByTestId('rc-final').check(); await noOverflow(q); await shot(q, '4-receive', info);
  await q.getByTestId('rc-send').click(); await expect(q.getByTestId('transfer-object')).toHaveAttribute('data-status', 'DISCREPANCY'); await expect(q.getByTestId('transfer-held')).toBeVisible(); await expect(q.getByTestId('transfer-discrepancies')).toBeVisible(); await noOverflow(q); await shot(q, '5-discrepancy', info); await r.context.close();
  m.page.on('dialog', (d) => d.accept('Damaged bag goes back, the shortage was found in the yard')); await m.page.goto(url); await expect(m.page.getByTestId('transfer-discrepancies')).toBeVisible(); await m.page.getByTestId(/disc-return-/).first().click(); await expect(m.page.getByTestId('transfer-note')).toBeVisible(); await m.page.getByTestId(/disc-accept-/).first().click();
  await expect(m.page.getByTestId('transfer-object')).toHaveAttribute('data-status', 'RECEIVED'); await expect(m.page.getByTestId('transfer-postings')).toBeVisible(); await expect(m.page.getByTestId('transfer-value')).toContainText('2,400'); await noOverflow(m.page); await shot(m.page, '6-resolved', info);
  await m.page.goto('/inv/transfers?transit=1'); await expect(m.page.getByTestId('transfers')).toBeVisible(); await expect(m.page.getByTestId('transfer-kpis')).toBeVisible(); await noOverflow(m.page); await m.page.goto('/inv/in-transit'); await expect(m.page.getByTestId('it-empty')).toBeVisible(); await m.context.close();
  expect(errors).toEqual([]);
});
