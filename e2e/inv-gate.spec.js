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
// Part 16.02 in the browser (development-header mode, port 3100): a delivery with an open PO is recorded, weighed (a 5% difference is flagged), handed over to stores and leaves; an unexpected delivery is held until the store manager accepts it;
// a returnable gate pass is requested by the storekeeper, approved by the construction manager, verified once at the gate by its QR code, shown overdue and marked back. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-gate';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');
const plus = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['guard', ['GUARD']], ['sk', ['SK']], ['mgr1', ['STOREMGR']], ['cm', ['CM']], ['pm', ['PM']], ['pr', ['PROCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Gate tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-G`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Gate site', 'ACTIVE')").run(c, pid, `${T}-GS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, 'Gate Cement', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-V`, `${T} Gate Cement Ltd`).lastInsertRowid);
  const po = Number(db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, po_site_id, vendor_id, status, requested_by, created_by) VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', 'e2e', 'e2e')").run(c, `PO/${T}/1`, plus(0), pid, site, vendor).lastInsertRowid);
  db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, balance_qty, created_by) VALUES (?, ?, 1, ?, 'Cement 53 grade', 100000, 'bag', 100000, 'e2e')").run(c, po, item);
  const st = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Gate store', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-ST`, pid, site, JSON.stringify([`${t}-sk`])).lastInsertRowid);
  db.prepare("INSERT INTO inv_bins (company_id, store_id, code, is_default, created_by) VALUES (?, ?, 'MAIN', 1, 'e2e')").run(c, st);
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site };
}

test('Gate: a delivery is entered, weighed, handed over and leaves; an unexpected one is held; a returnable gate pass is approved, verified once by QR, overdue and marked back', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = `g${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const g = await open(browser, info, c, 'GUARD', s.u('guard'), '/inv/gate-entry'); const p = g.page; const errors = watch(p);
  await expect(p.getByTestId('gate-entry-new')).toBeVisible(); await p.getByTestId('ge-site').selectOption({ index: 1 }); await p.getByTestId('ge-vendor-q').fill('Gate Cement'); await expect(p.getByTestId('ge-vendor').locator('option')).toHaveCount(2); await p.getByTestId('ge-vendor').selectOption({ index: 1 });
  await expect(p.getByTestId('ge-po').locator('option')).toHaveCount(2); await p.getByTestId('ge-po').selectOption({ index: 1 }); await p.getByTestId('ge-vehicle').fill('MH 12 AB 1234'); await p.getByTestId('ge-driver').fill('Ramesh Patil'); await p.getByTestId('ge-phone').fill('9876543210'); await p.getByTestId('ge-challan').fill('CH-1001'); await p.getByTestId('ge-challan-kg').fill('20000'); await p.getByTestId('ge-material').fill('OPC 53 cement, 400 bags');
  await expect(p.getByTestId('ge-expected')).toBeVisible(); await expect(p.getByTestId('ge-po-lines')).toBeVisible(); await noOverflow(p); await shot(p, '1-entry-new', info);
  await p.getByTestId('ge-send').click(); await expect(p.getByTestId('ge-object')).toHaveAttribute('data-status', 'AT_GATE'); const entry = here(p);
  // the weighbridge: gross, then tare after unloading; 5% over the challan is beyond the 2% tolerance
  await p.getByTestId('ge-gross').fill('28000'); await p.getByTestId('ge-weigh-save').click(); await expect(p.getByTestId('ge-note')).toBeVisible(); await p.getByTestId('ge-tare').fill('7000'); await p.getByTestId('ge-weigh-save').click();
  await expect(p.getByTestId('ge-net')).toContainText('21,000'); await expect(p.getByTestId('ge-variance')).toContainText('5.00'); await expect(p.getByTestId('ge-variance')).toContainText(/Beyond the tolerance|सहनसीमा से अधिक/); await noOverflow(p); await shot(p, '2-entry-weighed', info);
  // the storekeeper assigns the store and hands over
  const k = await open(browser, info, c, 'SK', s.u('sk'), entry); await expect(k.page.getByTestId('ge-unload')).toBeVisible(); await k.page.getByTestId('ge-store').selectOption({ index: 1 }); await k.page.getByTestId('ge-assign').click(); await expect(k.page.getByTestId('ge-object')).toHaveAttribute('data-status', 'UNLOADING');
  await k.page.getByTestId('ge-handover').click(); await expect(k.page.getByTestId('ge-object')).toHaveAttribute('data-status', 'HANDED_OVER'); await k.context.close();
  // the guard lets the vehicle out
  await p.goto('/inv/gate-exit'); await expect(p.getByTestId('gate-exit')).toBeVisible(); await expect(p.getByTestId('gx-ready')).toContainText('MH12AB1234'); await noOverflow(p); await shot(p, '3-exit', info); await p.getByTestId('gx-ready').getByRole('button').first().click(); await expect(p.getByTestId('gx-none')).toBeVisible();
  await p.goto(entry); await expect(p.getByTestId('ge-object')).toHaveAttribute('data-status', 'EXITED'); await expect(p.getByTestId('ge-turnaround')).toBeVisible();
  // a delivery with no order is flagged and held; the store manager accepts it
  await p.goto('/inv/gate-entry'); await p.getByTestId('ge-site').selectOption({ index: 1 }); await p.getByTestId('ge-vehicle').fill('GJ 01 ZZ 7777'); await p.getByTestId('ge-driver').fill('Unknown driver'); await p.getByTestId('ge-material').fill('Sand, unannounced load'); await expect(p.getByTestId('ge-flags')).toBeVisible(); await shot(p, '4-entry-flagged', info);
  await p.getByTestId('ge-send').click(); await expect(p.getByTestId('ge-object')).toHaveAttribute('data-status', 'SUBMITTED'); const held = here(p); const m = await open(browser, info, c, 'STOREMGR', s.u('mgr1'), held);
  await expect(m.page.getByTestId('ge-decide')).toBeVisible(); await m.page.getByTestId('ge-accept').click(); await expect(m.page.getByTestId('ge-note')).toBeVisible(); await m.context.close(); await p.reload(); await expect(p.getByTestId('ge-object')).toHaveAttribute('data-status', 'AT_GATE');
  // a returnable gate pass
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/inv/gate-pass'); const q = sk.page; await expect(q.getByTestId('gate-pass-form')).toBeVisible(); await q.getByTestId('gp-site').selectOption({ index: 1 }); await q.getByTestId('gp-return').fill(plus(7)); await q.getByTestId('gp-destination').fill('Workshop, Pune'); await q.getByTestId('gp-purpose').fill('Motor repair');
  await q.getByTestId('gp-vehicle').fill('MH 14 XY 9999'); await q.getByTestId('gp-item-0').fill('Bar bending machine'); await q.getByTestId('gp-qty-0').fill('1'); await noOverflow(q); await shot(q, '5-pass-new', info); await q.getByTestId('gp-send').click(); await expect(q.getByTestId('gp-object')).toHaveAttribute('data-status', 'SUBMITTED'); const passUrl = here(q);
  await p.goto('/inv/gate-exit'); const code0 = await new DatabaseSync('data/e2e.sqlite').prepare('SELECT qr_code FROM inv_gate_passes WHERE company_id = ? ORDER BY id DESC LIMIT 1').get(c).qr_code; await p.getByTestId('gx-code').fill(code0); await p.getByTestId('gx-verify').click(); await expect(p.getByTestId('gx-error')).toContainText(/waiting for approval|स्वीकृति/i);
  const cm = await open(browser, info, c, 'CM', s.u('cm'), passUrl); await expect(cm.page.getByTestId('gp-decide')).toBeVisible(); await cm.page.getByTestId('gp-approve').click(); await expect(cm.page.getByTestId('gp-note')).toBeVisible(); await cm.context.close();
  await q.reload(); await expect(q.getByTestId('gp-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(q.getByTestId('gp-qr')).toBeVisible(); const code = (await q.getByTestId('gp-qr').locator('figcaption').textContent()).trim(); expect(code).toMatch(/^GP:[0-9A-F]{20}$/); await noOverflow(q); await shot(q, '6-pass-approved', info);
  await p.goto('/inv/gate-exit'); await p.getByTestId('gx-code').fill(code); await p.getByTestId('gx-verify').click(); await expect(p.getByTestId('gx-ok')).toBeVisible(); await shot(p, '7-exit-verified', info);
  await p.getByTestId('gx-code').fill(code); await p.getByTestId('gx-verify').click(); await expect(p.getByTestId('gx-error')).toContainText(/already used|पहले/i);
  // overdue and marked back
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.prepare('UPDATE inv_gate_passes SET expected_return = ? WHERE company_id = ?').run(plus(-2), c); db.close();
  await q.goto('/inv/gate-passes?overdue=1'); await expect(q.getByTestId('gate-passes')).toBeVisible(); await expect(q.getByText(/GPS\//).first()).toBeVisible(); await noOverflow(q); await shot(q, '8-returnables-overdue', info);
  await q.goto(passUrl); await expect(q.getByTestId('gp-overdue')).toBeVisible(); await q.getByTestId('gp-return-btn').click(); await expect(q.getByTestId('gp-note')).toBeVisible(); await expect(q.getByTestId('gp-object')).toHaveAttribute('data-status', 'CLOSED');
  // the register
  const r = await open(browser, info, c, 'PROCMGR', s.u('pr'), '/inv/gate-register'); await expect(r.page.getByTestId('gr-kpis')).toBeVisible(); await expect(r.page.getByTestId('gr-kpi-weightFlags').locator('.kpi-value')).toHaveText('1'); await expect(r.page.getByText('MH12AB1234').first()).toBeVisible(); await noOverflow(r.page); await shot(r.page, '9-register', info);
  await r.page.goto('/inv/gate-entry'); await expect(r.page.getByText(/permission|अनुमति/i).first()).toBeVisible(); await r.context.close();
  expect(errors).toEqual([]);
});
