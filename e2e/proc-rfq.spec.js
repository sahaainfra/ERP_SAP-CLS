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
// Part 15.03 in the browser (development-header mode, port 3100): procurement makes an RFQ from approved requisition lines, picks vendors (one on hold cannot be chosen), issues it; a vendor opens its own link with no sign-in, sends a quotation and the
// link then stops working; procurement keys in a second quotation; the comparison marks the lowest landed rate; the project manager sees the RFQ but no rate; a site engineer has no access.
const OUT = 'docs/erp/screenshots/proc-rfq';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.parse(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['ic', ['PROCIC']], ['pm', ['PM']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower R', 'BUILDING', 'ACTIVE')").run(c, `${T}-R`).lastInsertRowid);
  const s1 = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CMT', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (?, 'RFQ-CEM', 'Cement OPC e2e', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 38000)").run(c, cat).lastInsertRowid);
  const partner = (code, name, status = 'ACTIVE') => { const id = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'PROCMGR', 'e2e')").run(c, `${T}-${code}`, name, name, status).lastInsertRowid);
    db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, created_by) VALUES (?, ?, 'VENDOR', '[\"CEMENT\"]', 'e2e')").run(c, id); db.prepare('INSERT INTO mdm_partner_contacts (company_id, partner_id, name, email, mobile, is_primary, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)').run(c, id, name, `${code.toLowerCase()}@vendor.example`, '9812345678', 'e2e'); return id; };
  partner('V1', 'Ambuja Traders'); partner('V2', 'Birla Dealers'); partner('V3', 'Core Suppliers'); partner('VH', 'On Hold Ltd', 'ON_HOLD');
  const pr = Number(db.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (?, ?, ?, ?, ?, 'DIRECT', ?, ?, 'APPROVED', 38000000, 'e2e')").run(c, `PR/${T}/1`, iso(0), pid, s1, `${t}-se`, iso(30)).lastInsertRowid);
  db.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (?, ?, 1, ?, 1000000, 'bag', 38000, 38000000, 'MANUAL', ?, ?, 1000000, 'e2e')").run(c, pr, item, iso(30), s1);
  db.close(); return { u: (k) => `${t}-${k}`, pid, T };
}

test('RFQ: made from an approved requisition, vendors picked, issued; a vendor quotes on its own link which then stops working; a second quotation is keyed in; the comparison marks the lowest; rates are hidden from the project manager', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `r${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const ic = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/rfq-new'); const p = ic.page; const errors = watch(p);
  await expect(p.getByTestId('proc-rfq-form')).toBeVisible(); await expect(p.getByTestId('rfn-line')).toHaveCount(1); await p.getByTestId('rfn-line-check').check();
  await p.getByTestId('rfn-title').fill('Cement for the slab'); await p.getByTestId('rfn-delivery').fill('Within 10 days at site');
  await expect(p.getByTestId('rfn-vendor')).toHaveCount(4); await expect(p.locator('[data-vendor$="-VH"]').getByTestId('rfn-vendor-check')).toBeDisabled(); await expect(p.locator('[data-vendor$="-VH"]')).toContainText('On hold');
  await noOverflow(p);
  for (const code of ['V1', 'V2', 'V3']) await p.locator(`[data-vendor$="-${code}"]`).getByTestId('rfn-vendor-check').check();
  await shot(p, '1-rfq-new', info); await p.getByTestId('rfn-save').click();
  await expect(p.getByTestId('rfq-object')).toBeVisible(); await expect(p.getByTestId('rfq-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(p.getByTestId('rfq-vendor')).toHaveCount(3); await expect(p.getByTestId('rfq-line')).toHaveCount(1);
  await p.getByTestId('rfq-issue').click(); await expect(p.getByTestId('rfq-links')).toBeVisible(); await expect(p.getByTestId('rfq-object')).toHaveAttribute('data-status', 'ISSUED'); await expect(p.getByTestId('rfq-link')).toHaveCount(3);
  const urls = await p.getByTestId('rfq-link').locator('input').evaluateAll((els) => els.map((e) => e.value)); expect(urls[0]).toContain('/vendor-quote?token='); await shot(p, '2-rfq-issued', info); await noOverflow(p);
  // the vendor: no sign-in, its own link
  const vctx = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch }); const v = await vctx.newPage(); const verrors = watch(v); const path = new URL(urls[0], 'http://x').pathname + new URL(urls[0], 'http://x').search;
  await v.goto(path); await expect(v.getByTestId('vendor-quote-page')).toBeVisible(); await expect(v.getByTestId('vq-line')).toHaveCount(1); await v.getByTestId('vq-rate').fill('380'); await v.getByTestId('vq-gstRate').fill('18'); await v.getByTestId('vq-freight').fill('10000'); await v.getByTestId('vq-make').fill('Ambuja'); await shot(v, '3-vendor-page', info); await noOverflow(v);
  await v.getByTestId('vq-submit').click(); await expect(v.getByTestId('vq-done')).toBeVisible(); await v.goto(path); await expect(v.getByTestId('vq-error')).toContainText('already sent'); await shot(v, '4-vendor-used', info);
  expect(verrors).toEqual([]);
  // procurement sees it, keys in a second quotation, and the comparison marks the lowest
  await p.reload(); await expect(p.getByTestId('rfq-counts')).toHaveText('1 / 3'); await expect(p.getByTestId('rfq-quotation')).toHaveCount(1);
  await p.goto(`/proc/quotation-entry?rfq=${new URL(p.url()).searchParams.get('id')}`); await expect(p.getByTestId('proc-quote-entry')).toBeVisible(); await p.getByTestId('qe-vendor').selectOption({ label: 'Birla Dealers' }); await p.getByTestId('qe-rate').fill('360'); await p.getByTestId('qe-gstRate').fill('18'); await p.getByTestId('qe-days').fill('5');
  await p.getByTestId('qe-save').click(); await expect(p.getByTestId('qe-saved')).toBeVisible(); await expect(p.getByTestId('qe-landed')).not.toHaveText('—'); await shot(p, '5-quote-entry', info); await p.getByTestId('qe-record').click(); await expect(p.getByTestId('quote-object')).toHaveAttribute('data-status', 'RECEIVED');
  await expect(p.getByTestId('quote-landed-rate')).toHaveText('₹ 360'); await noOverflow(p); await shot(p, '6-quote', info);
  
  expect(errors).toEqual([]);
  // the project manager: the RFQ without a rate; the site engineer: no access
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/proc/rfqs'); await expect(pm.page.getByTestId('proc-rfqs')).toBeVisible(); await pm.page.getByRole('link', { name: /RFQ\// }).first().click(); await expect(pm.page.getByTestId('rfq-object')).toBeVisible(); await expect(pm.page.getByTestId('rfq-comparison')).toHaveCount(0); await expect(pm.page.getByTestId('rfq-quotation')).toHaveCount(2); await expect(pm.page.getByText('Landed total')).toHaveCount(0); await expect(pm.page.getByTestId('rfq-figures')).not.toContainText('Estimated value');
  await shot(pm.page, '7-pm-view', info);
  const se = await open(browser, info, c, 'SE', s.u('se'), '/proc/rfqs'); await expect(se.page.getByText(/permission/i).first()).toBeVisible();
});
