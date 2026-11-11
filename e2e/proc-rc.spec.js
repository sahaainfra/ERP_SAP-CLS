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
// Part 15.06 in the browser (development-header mode, port 3100): a rate contract is made and approved by the procurement and commercial managers; a call-off order is made from it at the contract rate and approved by the procurement manager alone;
// the ceiling stops a further call-off; a price-variation revision is worked out from the index and applied when approved; a service order is approved, a service entry sheet is certified by a site engineer and the project manager.
const OUT = 'docs/erp/screenshots/proc-rc';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.parse(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(request, c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['ic', ['PROCIC']], ['mgr', ['PROCMGR']], ['com', ['COMMGR']], ['pm', ['PM']], ['se1', ['SE']], ['se2', ['SE']], ['sk', ['SK']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower R', 'BUILDING', 'ACTIVE')").run(c, `${T}-R`).lastInsertRowid); db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (?, ?, ?, 'e2e')").run(c, pid, `${t}-pm`);
  db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower site', 'ACTIVE')").run(c, pid, `${T}-S1`);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'STEEL', 'Steel', 'STL', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (?, 'RC-STL', 'TMT 12 mm e2e', 'MATERIAL', ?, 'kg', '2026-01-01', 'ACTIVE', 6000)").run(c, cat);
  for (const [code, name] of [['V1', 'Tata Steel Dealers'], ['V2', 'Secure Guards Ltd']]) { const v = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-${code}`, name, name).lastInsertRowid); db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, created_by) VALUES (?, ?, 'VENDOR', '[]', 'e2e')").run(c, v); db.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, state_code, gstin, created_by) VALUES (?, ?, '27', ?, 'e2e')").run(c, v, `27AAAAA000${code === 'V1' ? '1' : '2'}A1Z5`); }
  db.close(); return { u: (k) => `${t}-${k}`, T };
}
const approve = async (browser, info, c, roles, user, url, prefix) => { const x = await open(browser, info, c, roles, user, url); await expect(x.page.getByTestId(`${prefix}-decide`)).toBeVisible(); await x.page.getByTestId(`${prefix}-approve`).click(); await expect(x.page.getByTestId(`${prefix}-note`)).toBeVisible(); await x.context.close(); };

test('Rate contract: made and approved, call-off at the contract rate, the ceiling, price variation; service order and service entry sheet', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = `k${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(request, c, t);
  const ic = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/rate-contracts?new=1'); const p = ic.page; const errors = watch(p);
  await expect(p.getByTestId('proc-rc-form')).toBeVisible(); await p.getByTestId('rcn-title').fill('Annual steel 2026-27'); await p.getByTestId('rcn-vendor').selectOption({ label: 'Tata Steel Dealers' }); await p.getByTestId('rcn-ceiling').fill('600000'); await p.getByTestId('rcn-valid-to').fill(iso(300));
  await p.getByTestId('rcn-pv-on').check(); await p.getByTestId('rcn-index-code').fill('STEEL'); await p.getByTestId('rcn-base-period').fill('2026-04'); await p.getByTestId('rcn-base-index').fill('100'); await p.getByTestId('rcn-linked').fill('80');
  await p.getByTestId('rcn-add').click(); const sel = p.getByTestId('item-selector'); await sel.getByTestId('is-q').fill('RC-STL'); await expect(sel.getByTestId('is-row')).toHaveCount(1); await sel.getByTestId('is-pick').check(); await sel.getByTestId('is-done').click();
  await p.getByTestId('rcn-rate').fill('60'); await p.getByTestId('rcn-ceiling-qty').fill('10000'); await p.getByTestId('rcn-pv-linked').check(); await noOverflow(p); await shot(p, '1-rc-new', info); await p.getByTestId('rcn-save').click();
  await expect(p.getByTestId('rc-object')).toBeVisible(); await expect(p.getByTestId('rc-object')).toHaveAttribute('data-status', 'DRAFT'); const url = p.url().replace(/^https?:\/\/[^/]+/, ''); await p.getByTestId('rc-submit').click(); await expect(p.getByTestId('rc-object')).toHaveAttribute('data-status', 'SUBMITTED');
  await approve(browser, info, c, 'PROCMGR', s.u('mgr'), url, 'rc'); await approve(browser, info, c, 'COMMGR', s.u('com'), url, 'rc'); await p.reload(); await expect(p.getByTestId('rc-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('rc-rate')).toHaveText('₹ 60'); await shot(p, '2-rc-approved', info);
  const rcId = new URL(p.url(), 'http://x').searchParams.get('id');
  // a call-off at the contract rate, approved by the procurement manager alone
  await p.goto(`/proc/po-new?rc=${rcId}`); await expect(p.getByTestId('pon-rc-lines')).toBeVisible(); await p.getByTestId('pon-rc-qty').fill('9000'); await p.getByTestId('pon-state').fill('27'); await p.getByTestId('pon-address').fill('Tower site, Pune'); await p.getByTestId('pon-save').click();
  await expect(p.getByTestId('po-object')).toBeVisible(); await expect(p.getByTestId('po-total')).toContainText('5,40,000'); const poUrl = p.url().replace(/^https?:\/\/[^/]+/, ''); await p.getByTestId('po-submit').click(); await approve(browser, info, c, 'PROCMGR', s.u('mgr'), poUrl, 'po');
  await p.goto(url); await expect(p.getByTestId('rc-used')).toContainText('90%'); await expect(p.getByTestId('rc-warning').first()).toBeVisible(); await expect(p.getByTestId('rc-calloffs')).toBeVisible(); await shot(p, '3-rc-consumed', info);
  // the ceiling stops a further call-off
  await p.goto(`/proc/po-new?rc=${rcId}`); await p.getByTestId('pon-rc-qty').fill('2000'); await p.getByTestId('pon-state').fill('27'); await p.getByTestId('pon-save').click(); await expect(p.getByTestId('pon-error')).toBeVisible();
  // price variation
  await p.goto(url); await p.getByTestId('rc-ix-period').fill('2026-11'); await p.getByTestId('rc-ix-value').fill('112.5'); await p.getByTestId('rc-ix-save').click(); await expect(p.getByTestId('rc-note')).toBeVisible(); await p.getByTestId('rc-pv-period').fill('2026-11'); await p.getByTestId('rc-pv-go').click(); await expect(p.getByTestId('rc-revision')).toHaveCount(1);
  await approve(browser, info, c, 'PROCMGR', s.u('mgr'), url, 'rc'); await approve(browser, info, c, 'COMMGR', s.u('com'), url, 'rc'); await p.reload(); await expect(p.getByTestId('rc-rate')).toHaveText('₹ 66'); await shot(p, '4-rc-pv', info); await noOverflow(p);
  expect(errors).toEqual([]);
  // a service order and a service entry sheet
  const so = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/service-orders?new=1'); const q = so.page; await expect(q.getByTestId('proc-so-form')).toBeVisible(); await q.getByTestId('son-vendor').selectOption({ label: 'Secure Guards Ltd' }); await q.getByTestId('son-title').fill('Site security'); await q.getByTestId('son-scope').fill('Round-the-clock security of the site for twelve months');
  await q.getByTestId('son-kind').selectOption('PER_MONTH'); await q.getByTestId('son-desc').fill('Security guards'); await q.getByTestId('son-qty').fill('12'); await q.getByTestId('son-rate').fill('40000'); await shot(q, '5-so-new', info); await q.getByTestId('son-save').click();
  await expect(q.getByTestId('so-object')).toBeVisible(); await expect(q.getByTestId('so-value')).toContainText('4,80,000'); const soUrl = q.url().replace(/^https?:\/\/[^/]+/, ''); await q.getByTestId('so-submit').click(); await approve(browser, info, c, 'PROCMGR', s.u('mgr'), soUrl, 'so'); await q.reload(); await expect(q.getByTestId('so-object')).toHaveAttribute('data-status', 'APPROVED');
  const soId = new URL(q.url(), 'http://x').searchParams.get('id'); const se1 = await open(browser, info, c, 'SE', s.u('se1'), `/proc/service-entries?new=1&so=${soId}`); const e = se1.page; await expect(e.getByTestId('proc-se-form')).toBeVisible(); await e.getByTestId('sen-from').fill(iso(0)); await e.getByTestId('sen-to').fill(iso(30)); await e.getByTestId('sen-qty').first().fill('3'); await shot(e, '6-se-new', info); await noOverflow(e); await e.getByTestId('sen-send').click();
  await expect(e.getByTestId('se-object')).toHaveAttribute('data-status', 'SUBMITTED'); const seUrl = e.url().replace(/^https?:\/\/[^/]+/, ''); await expect(e.getByTestId('se-amount')).toHaveCount(0);
  await approve(browser, info, c, 'SE', s.u('se2'), seUrl, 'se'); await approve(browser, info, c, 'PM', s.u('pm'), seUrl, 'se'); await e.reload(); await expect(e.getByTestId('se-object')).toHaveAttribute('data-status', 'APPROVED'); await q.goto(soUrl); await expect(q.getByTestId('so-certified')).toContainText('25%'); await shot(q, '7-so-certified', info);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/proc/rate-contracts'); await expect(sk.page.getByText(/permission/i).first()).toBeVisible();
});
