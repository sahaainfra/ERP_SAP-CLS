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
// Part 16.03 in the browser (development-header mode, port 3100): a receipt is made by the storekeeper from the vehicle unloaded at the gate (counted, accepted, rejected, batch), approved by the construction manager, posted to the stock;
// quality control passes part and fails part; the failed and rejected material goes back on a return approved by the procurement manager. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-grn';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['sk', ['SK']], ['mgr1', ['STOREMGR']], ['cm', ['CM']], ['qc', ['QCE']], ['pr', ['PROCMGR']], ['acc', ['ACCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Receipt tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-R`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Receipt site', 'ACTIVE')").run(c, pid, `${T}-RS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, 'Receipt Cement', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-V`, `${T} Receipt Cement Ltd`).lastInsertRowid);
  const po = Number(db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, status, requested_by, created_by) VALUES (?, ?, date('now'), ?, ?, ?, 'APPROVED', 'e2e', 'e2e')").run(c, `PO/${T}/1`, pid, site, vendor).lastInsertRowid);
  db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, rate, balance_qty, created_by) VALUES (?, ?, 1, ?, 'Cement 53 grade', 200000, 'bag', 4000, 200000, 'e2e')").run(c, po, item);
  const st = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Receipt store', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-ST`, pid, site, JSON.stringify([`${t}-sk`])).lastInsertRowid);
  db.prepare("INSERT INTO inv_bins (company_id, store_id, code, is_default, created_by) VALUES (?, ?, 'MAIN', 1, 'e2e')").run(c, st);
  db.prepare("INSERT INTO inv_gate_inward (company_id, doc_no, entry_date, org_project_id, org_site_id, vehicle_no, driver_name, material_desc, po_id, vendor_id, challan_no, unloading_store_id, status, requested_by, time_in, created_by) VALUES (?, ?, date('now'), ?, ?, 'MH12AB1234', 'Ramesh', 'OPC 53 cement', ?, ?, 'CH-77', ?, 'UNLOADING', 'e2e', strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'e2e')").run(c, `GIN/${T}/1`, pid, site, po, vendor, st);
  db.close(); return { u: (k) => `${t}-${k}`, T };
}

test('Goods receipt: made from the gate entry, approved and posted; QC passes part and fails part; the failed and rejected material goes back on an approved return', async ({ browser, request }, info) => {
  test.setTimeout(90_000);
  const t = `r${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const k = await open(browser, info, c, 'SK', s.u('sk'), '/inv/grn-new'); const p = k.page; const errors = watch(p);
  await expect(p.getByTestId('grn-new')).toBeVisible(); await expect(p.getByTestId('gn-source')).toContainText('MH12AB1234'); await noOverflow(p); await shot(p, '1-pick', info); await p.getByTestId(/gn-pick-/).first().click();
  await expect(p.getByTestId('gn-line-0')).toBeVisible(); await expect(p.getByTestId('gn-store')).not.toHaveValue(''); await p.getByTestId('gn-received-0').fill('100'); await p.getByTestId('gn-accepted-0').fill('90'); await expect(p.getByTestId('gn-rejected-0')).toHaveText('10'); await p.getByTestId('gn-insp-0').check(); await p.getByTestId('gn-batch-0').fill('B-2026-01'); await noOverflow(p); await shot(p, '2-count', info);
  await p.getByTestId('gn-send').click(); await expect(p.getByTestId('grn-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url = here(p); await expect(p.getByTestId('grn-value')).toHaveCount(0);
  const cm = await open(browser, info, c, 'CM', s.u('cm'), url); await expect(cm.page.getByTestId('grn-decide')).toBeVisible(); await cm.page.getByTestId('grn-approve').click(); await expect(cm.page.getByTestId('grn-note')).toBeVisible(); await cm.context.close();
  await p.reload(); await expect(p.getByTestId('grn-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('grn-postings')).toBeVisible(); await expect(p.getByTestId('grn-insp-1')).toContainText(/Under inspection|निरीक्षणाधीन/); await noOverflow(p); await shot(p, '3-posted', info);
  const q = await open(browser, info, c, 'QCE', s.u('qc'), url); await expect(q.page.getByTestId('grn-pass-1')).toBeVisible(); await q.page.getByTestId('grn-pass-1').fill('50'); await q.page.getByTestId('grn-fail-1').fill('40'); await q.page.getByTestId('grn-inspect').click(); await expect(q.page.getByTestId('grn-note')).toBeVisible(); await expect(q.page.getByTestId('grn-insp-1')).toContainText(/Partly passed|आंशिक/); await shot(q.page, '4-inspected', info); await q.context.close();
  await p.reload(); await p.getByTestId('grn-rtv').click(); await expect(p.getByTestId('rtv-form')).toBeVisible(); await p.getByTestId('rn-qty-1').fill('50'); await p.getByTestId('rn-reason').fill('Damaged bags and failed test'); await noOverflow(p); await shot(p, '5-return-new', info); await p.getByTestId('rn-send').click(); await expect(p.getByTestId('rtv-object')).toHaveAttribute('data-status', 'SUBMITTED'); const rurl = here(p);
  const pr = await open(browser, info, c, 'PROCMGR', s.u('pr'), rurl); await expect(pr.page.getByTestId('rtv-decide')).toBeVisible(); await pr.page.getByTestId('rtv-approve').click(); await expect(pr.page.getByTestId('rtv-note')).toBeVisible(); await pr.context.close();
  await p.reload(); await expect(p.getByTestId('rtv-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('rtv-pass')).toContainText('GPS/'); await expect(p.getByTestId('rtv-debit')).toBeVisible(); await noOverflow(p); await shot(p, '6-return-approved', info);
  await p.goto('/inv/grns'); await expect(p.getByTestId('grns')).toBeVisible(); await expect(p.getByText(/GRN\//).first()).toBeVisible(); await expect(p.getByTestId('grn-kpis')).toBeVisible(); await noOverflow(p); await shot(p, '7-list', info);
  await p.goto('/inv/rtvs'); await expect(p.getByText(/RTV\//).first()).toBeVisible(); await noOverflow(p);
  const a = await open(browser, info, c, 'ACCMGR', s.u('acc'), url); await expect(a.page.getByTestId('grn-value')).toContainText('3,60'); await a.page.goto('/inv/grn-new'); await expect(a.page.getByText(/permission|अनुमति/i).first()).toBeVisible(); await a.context.close();
  expect(errors).toEqual([]);
});
