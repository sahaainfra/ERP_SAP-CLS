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
// Part 16.11 in the browser (development-header mode, port 3100): the store manager opens the materials dashboard, the inventory value equals the ledger, a tile opens its records, the queues and alerts show, the funnel opens the documents behind a stage; a storekeeper is refused. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-mmd';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${Math.random().toString(36).slice(2, 8)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['mgr1', ['STOREMGR']], ['sk1', ['SK']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Dashboard tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Dashboard site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cement = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Vendor Ltd', 'VendorCo', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-V`).lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Store A', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-A`, pid, site, JSON.stringify([`${t}-sk1`])).lastInsertRowid);
  const mr = fill(db, 'proc_material_requests', { company_id: c, org_project_id: pid, mr_site_id: site, status: 'APPROVED', doc_date: today, doc_no: `MR/${T}/1` }); fill(db, 'proc_mr_lines', { mr_id: mr, item_id: cement, qty: 800_000 });
  const g = fill(db, 'inv_grns', { company_id: c, org_project_id: pid, store_id: a, vendor_id: vendor, status: 'APPROVED', received_date: today, po_id: 1, doc_no: `GRN/${T}/1` }); fill(db, 'inv_grn_lines', { company_id: c, grn_id: g, item_id: cement, received_qty: 500_000, accepted_qty: 500_000, rejected_qty: 0, inspection_required: 1, inspection_status: 'PENDING', line_value: 2_000_000 });
  db.close(); return { u: (k) => `${t}-${k}`, T, cement, a, pid };
}

test('Materials dashboard: the value equals the ledger, a tile opens its records, queues and the lifecycle funnel open the documents; the storekeeper is refused', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `m${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.a, itemId: s.cement, type: 'RECEIPT', qty: 1000, rate: 40, date: today, reason: 'Opening for the test' });
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.a, itemId: s.cement, type: 'ISSUE', qty: 300, date: today, reason: 'Issued for the slab' });
  const m = await open(browser, info, c, 'STOREMGR', s.u('mgr1'), '/inv/materials-dashboard'); const p = m.page; const errors = watch(p);
  await expect(p.getByTestId('inv-md')).toBeVisible(); await expect(p.getByTestId('md-value')).toContainText('28,000'); await expect(p.getByTestId('md-tiles')).toContainText('Equals the stock ledger'); await expect(p.getByTestId('md-inspection')).toHaveText('1'); await expect(p.getByTestId('md-mrs')).toHaveText('1');
  await p.getByTestId('md-open-inspection').click(); await expect(p.getByTestId('md-drill')).toBeVisible(); await expect(p.getByTestId('md-drill-table-row')).toHaveCount(1); await noOverflow(p); await shot(p, '1-dashboard', info);
  await expect(p.getByTestId('md-queue')).toHaveCount(4); await expect(p.getByTestId('md-bars-store')).toBeVisible();
  await p.getByTestId('md-project').selectOption(String(s.pid)); await expect(p.getByRole('heading', { level: 1 })).toContainText(`${s.T}-T`); await p.getByTestId('md-store').selectOption(String(s.a)); await expect(p.getByRole('heading', { level: 1 })).toContainText(`${s.T}-A`);
  const dl = p.waitForEvent('download'); await p.getByTestId('md-export').click(); expect((await dl).suggestedFilename()).toMatch(/materials-dashboard/);
  await p.goto('/inv/material-funnel'); await expect(p.getByTestId('inv-mf')).toBeVisible(); await expect(p.getByTestId('mf-row')).toHaveCount(1); await expect(p.getByTestId('mf-cell-required')).toContainText('800'); await expect(p.getByTestId('mf-cell-delivered')).toContainText('500');
  await p.getByTestId('mf-cell-delivered').click(); await expect(p.getByTestId('mf-records-table-row')).toHaveCount(1); await expect(p.getByTestId('mf-item')).toBeVisible(); await noOverflow(p); await shot(p, '2-funnel', info);
  await p.getByTestId('mf-search').fill('zzzz'); await expect(p.getByTestId('mf-empty')).toBeVisible(); await noOverflow(p);
  const sk = await open(browser, info, c, 'SK', s.u('sk1'), '/inv/materials-dashboard'); await expect(sk.page.getByText('inv.dashboard.view')).toBeVisible(); await sk.context.close();
  expect(errors).toEqual([]);
});
