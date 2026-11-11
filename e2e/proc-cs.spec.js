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
// Part 15.04 in the browser (development-header mode, port 3100): a comparative statement is generated from the quotations of an RFQ, the L1 of each line is marked, a vendor who is not the L1 needs a reason, the statement is approved by the procurement manager and the
// project manager, and the site engineer has no access.
const OUT = 'docs/erp/screenshots/proc-cs';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.parse(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(request, c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['ic', ['PROCIC']], ['mgr', ['PROCMGR']], ['pm', ['PM']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower C', 'BUILDING', 'ACTIVE')").run(c, `${T}-C`).lastInsertRowid);
  const s1 = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CMT', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (?, 'CS-CEM', 'Cement OPC e2e', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 38000)").run(c, cat).lastInsertRowid);
  const partner = (code, name) => { const id = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-${code}`, name, name).lastInsertRowid);
    db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, created_by) VALUES (?, ?, 'VENDOR', '[\"CEMENT\"]', 'e2e')").run(c, id); return id; };
  const vs = [partner('V1', 'Ambuja Traders'), partner('V2', 'Birla Dealers'), partner('V3', 'Core Suppliers')];
  const pr = Number(db.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (?, ?, ?, ?, ?, 'DIRECT', ?, ?, 'APPROVED', 38000000, 'e2e')").run(c, `PR/${T}/1`, iso(0), pid, s1, `${t}-se`, iso(30)).lastInsertRowid);
  const pl = Number(db.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (?, ?, 1, ?, 1000000, 'bag', 38000, 38000000, 'MANUAL', ?, ?, 1000000, 'e2e')").run(c, pr, item, iso(30), s1).lastInsertRowid);
  db.close();
  const call = async (roles, user, method, path, data) => { const res = await request[method](`/api/v1/proc${path}`, { headers: H(roles, c, `${t}-${user}`), data }); expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const rfq = await call('PROCIC', 'ic', 'post', '/rfqs', { projectId: pid, title: 'Cement for the slab', dueDate: iso(7), lines: [{ prLineId: pl }], vendors: vs.map((v) => ({ vendorId: v, channel: 'LINK' })) });
  await call('PROCIC', 'ic', 'post', `/rfqs/${rfq.id}/issue`);
  for (const [v, rate, days] of [[vs[0], 400, 7], [vs[1], 390, 5], [vs[2], 410, 3]]) { const q = await call('PROCIC', 'ic', 'post', '/quotations', { rfqId: rfq.id, vendorId: v, validUntil: iso(30), deliveryDays: days, lines: [{ rfqLineId: rfq.lines[0].id, rate, gstRate: 18 }] }); await call('PROCIC', 'ic', 'post', `/quotations/${q.id}/submit`); }
  return { u: (k) => `${t}-${k}`, rfqId: rfq.id };
}

test('Comparative statement: generated from the quotations, L1 marked, non-L1 needs a reason, approved by value, hidden from site roles', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `c${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(request, c, t);
  const ic = await open(browser, info, c, 'PROCIC', s.u('ic'), `/proc/comparative-statements?new=1&rfq=${s.rfqId}`); const p = ic.page; const errors = watch(p);
  await expect(p.getByTestId('proc-cs-new')).toBeVisible(); await p.getByTestId('csn-type').selectOption('SPLIT_L1'); await p.getByTestId('csn-go').click();
  await expect(p.getByTestId('cs-object')).toBeVisible(); await expect(p.getByTestId('cs-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(p.getByTestId('cs-vendor-head')).toHaveCount(3);
  await expect(p.locator('[data-testid="cs-cell"][data-l1="1"]')).toHaveCount(1); await expect(p.locator('[data-testid="cs-cell"][data-selected="1"]')).toHaveCount(1); await expect(p.getByTestId('cs-value')).toContainText('3,90,000'); await shot(p, '1-statement', info); await noOverflow(p);
  // choose the dearer vendor by hand: not the L1, so a reason is needed
  const picks = p.getByTestId('cs-pick'); await picks.nth(1).fill('0'); await picks.nth(2).fill('1000'); await p.getByTestId('cs-save-selection').click(); await expect(p.getByTestId('cs-object').getByText('Not L1').first()).toBeVisible(); await expect(p.getByTestId('cs-value')).toContainText('4,10,000');
  await p.getByTestId('cs-submit').click(); await expect(p.getByTestId('cs-error')).toBeVisible(); await expect(p.getByTestId('cs-justification')).toContainText('reason'); await p.getByTestId('cs-reason').selectOption('DELIVERY'); await p.getByTestId('cs-justification-text').fill('Only this vendor can deliver within three days to the site'); await p.getByTestId('cs-save-justification').click();
  await expect(p.getByTestId('cs-level')).toHaveText('Project director'); await p.getByTestId('cs-submit').click(); await expect(p.getByTestId('cs-object')).toHaveAttribute('data-status', 'SUBMITTED'); await shot(p, '2-submitted', info);
  const mgr = await open(browser, info, c, 'PROCMGR', s.u('mgr'), p.url().replace(/^https?:\/\/[^/]+/, '')); await expect(mgr.page.getByTestId('cs-decide')).toBeVisible(); await mgr.page.getByTestId('cs-approve').click(); await expect(mgr.page.getByTestId('cs-note')).toBeVisible();
  const pm = await open(browser, info, c, 'PM', s.u('pm'), p.url().replace(/^https?:\/\/[^/]+/, '')); await expect(pm.page.getByTestId('cs-matrix')).toBeVisible(); await expect(pm.page.getByTestId('cs-justification-read')).toContainText('three days'); await pm.page.getByTestId('cs-approve').click(); await expect(pm.page.getByTestId('cs-note')).toBeVisible();
  await expect(pm.page.getByTestId('cs-object')).toHaveAttribute('data-status', 'SUBMITTED'); await shot(pm.page, '3-pm-view', info); await noOverflow(pm.page);
  expect(errors).toEqual([]);
  const se = await open(browser, info, c, 'SE', s.u('se'), '/proc/comparative-statements'); await expect(se.page.getByText(/permission/i).first()).toBeVisible();
});
