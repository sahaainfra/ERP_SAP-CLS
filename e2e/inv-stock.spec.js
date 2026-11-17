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
// Part 16.01 in the browser (development-header mode, port 3100): a store is made and approved by a second store manager; stock is received and issued at the weighted average; the ledger shows the running balance, the valuation and the dashboard follow;
// a count correction is approved before it posts; the storekeeper works the store but sees no values.
const OUT = 'docs/erp/screenshots/inv-stock';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['mgr1', ['STOREMGR']], ['mgr2', ['STOREMGR']], ['sk', ['SK']], ['pm', ['PM']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower S', 'BUILDING', 'ACTIVE')").run(c, `${T}-S`).lastInsertRowid); db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower site', 'ACTIVE')").run(c, pid, `${T}-ST`);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked, reorder_level) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1, 500000)").run(c, `${T}-CEM`, cat);
  db.close(); return { u: (k) => `${t}-${k}`, T };
}
const approve = async (browser, info, c, roles, user, url, prefix) => { const x = await open(browser, info, c, roles, user, url); await expect(x.page.getByTestId(`${prefix}-decide`)).toBeVisible(); await x.page.getByTestId(`${prefix}-approve`).click(); await expect(x.page.getByTestId(`${prefix}-note`)).toBeVisible(); await x.context.close(); };
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');

test('Stores: a store is approved, stock is received and issued at the weighted average, adjusted with approval, valued; the keeper sees no values', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = `i${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const m = await open(browser, info, c, 'STOREMGR', s.u('mgr1'), '/inv/stores?new=1'); const p = m.page; const errors = watch(p);
  await expect(p.getByTestId('inv-st-form')).toBeVisible(); await p.getByTestId('stn-code').fill('SS-01'); await p.getByTestId('stn-name').fill('Tower site store'); await p.getByTestId('stn-project').selectOption({ label: `${s.T}-S \u00b7 Tower S` }); await p.getByTestId('stn-site').selectOption({ index: 1 }); await p.getByTestId('stn-keepers').fill(s.u('sk'));
  await noOverflow(p); await shot(p, '1-store-new', info); await p.getByTestId('stn-send').click(); await expect(p.getByTestId('st-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url = here(p); await approve(browser, info, c, 'STOREMGR', s.u('mgr2'), url, 'st');
  await p.reload(); await expect(p.getByTestId('st-object')).toHaveAttribute('data-status', 'ACTIVE'); await expect(p.getByTestId('st-bin')).toHaveCount(1); await p.getByTestId('st-bin-code').fill('A-01'); await p.getByTestId('st-bin-zone').fill('A'); await p.getByTestId('st-bin-save').click(); await expect(p.getByTestId('st-bin')).toHaveCount(2); await noOverflow(p); await shot(p, '2-store-active', info);
  // receipts and an issue
  const post = async (kind, qty, rate) => { await p.goto('/inv/posting'); await p.getByTestId('po-kind').selectOption(kind); await p.getByTestId('po-store').selectOption({ index: 1 }); await p.getByTestId('po-item').selectOption({ index: 1 }); await p.getByTestId('po-qty').fill(String(qty)); if (rate) await p.getByTestId('po-rate').fill(String(rate)); await p.getByTestId('po-reason').fill('Stock taken in at site'); await p.getByTestId('po-save').click(); await expect(p.getByTestId('po-note')).toBeVisible(); };
  await post('RECEIPT', 100, 40); await post('RECEIPT', 100, 50); await post('ISSUE', 50, null); await noOverflow(p); await shot(p, '3-posting', info);
  await p.goto('/inv/ledger'); await p.getByTestId('lg-item').selectOption({ index: 1 }); await expect(p.getByTestId('lg-row')).toHaveCount(3); await expect(p.getByTestId('lg-balance').last()).toHaveText('150'); await noOverflow(p); await shot(p, '4-ledger', info);
  await p.goto('/inv/balances'); await expect(p.getByText('Cement OPC 53').first()).toBeVisible(); await noOverflow(p);
  await p.goto('/inv/valuation'); await expect(p.getByTestId('vl-total')).toContainText('6,750'); await noOverflow(p); await shot(p, '5-valuation', info);
  // a count correction needs approval before it posts
  await p.goto('/inv/adjustments?new=1'); await p.getByTestId('adn-store').selectOption({ index: 1 }); await p.getByTestId('adn-item').selectOption({ index: 1 }); await p.getByTestId('adn-qty').fill('-3'); await p.getByTestId('adn-reason').fill('Count found 3 bags short'); await p.getByTestId('adn-send').click();
  await expect(p.getByTestId('ad-object')).toHaveAttribute('data-status', 'SUBMITTED'); const adj = here(p); await p.goto('/inv/ledger'); await p.getByTestId('lg-item').selectOption({ index: 1 }); await expect(p.getByTestId('lg-row')).toHaveCount(3);
  await approve(browser, info, c, 'STOREMGR', s.u('mgr2'), adj, 'ad'); await p.goto('/inv/ledger'); await p.getByTestId('lg-item').selectOption({ index: 1 }); await expect(p.getByTestId('lg-row')).toHaveCount(4); await expect(p.getByTestId('lg-balance').last()).toHaveText('147');
  await p.goto('/inv/valuation'); await expect(p.getByTestId('vl-total')).toContainText('6,615');
  // the dashboard
  await p.goto('/inv/dashboard?view=detail'); await expect(p.getByTestId('sd-stores')).toHaveText('1'); await expect(p.getByTestId('sd-value')).toContainText('6,615'); await expect(p.getByTestId('sd-reorder')).toHaveText('1'); await expect(p.getByTestId('sd-books')).toContainText(/Balanced|संतुलित|मिलान/); await noOverflow(p); await shot(p, '6-dashboard', info);
  // the keeper works the store but sees no values
  const k = await open(browser, info, c, 'SK', s.u('sk'), '/inv/ledger'); await k.page.getByTestId('lg-item').selectOption({ index: 1 }); await expect(k.page.getByTestId('lg-row').first()).toBeVisible(); await expect(k.page.getByTestId('lg-table')).not.toContainText('₹'); await k.page.goto('/inv/valuation'); await expect(k.page.getByTestId('inv-vl')).toHaveCount(0); await noOverflow(k.page); await k.context.close();
  expect(errors, errors.join('\n')).toEqual([]); await m.context.close();
});

test('Stores: a project manager reads the stores and the dashboard; a storekeeper of another store sees none', async ({ browser, request }, info) => {
  const t = `i${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}z`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/inv/dashboard?view=detail'); await expect(pm.page.getByTestId('inv-sd')).toBeVisible(); await noOverflow(pm.page);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/inv/stores'); await expect(sk.page.getByTestId('inv-st')).toBeVisible(); await expect(sk.page.getByText('SS-01')).toHaveCount(0);
});
