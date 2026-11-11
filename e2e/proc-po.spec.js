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
// Part 15.05 in the browser (development-header mode, port 3100): an order is made from an approved comparative statement, approved by the procurement manager, sent; the vendor opens its own link, acknowledges and tells the dispatch;
// the order is amended with a comparison and the amendment approved; the tracker lists the open deliveries; the storekeeper sees no rate; the site engineer no access.
const OUT = 'docs/erp/screenshots/proc-po';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.parse(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(request, c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['ic', ['PROCIC']], ['mgr', ['PROCMGR']], ['pm', ['PM']], ['sk', ['SK']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower P', 'BUILDING', 'ACTIVE')").run(c, `${T}-P`).lastInsertRowid); db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (?, ?, ?, 'e2e')").run(c, pid, `${t}-pm`);
  const s1 = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CMT', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (?, 'PO-CEM', 'Cement OPC e2e', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 38000)").run(c, cat).lastInsertRowid);
  const v = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Ambuja Traders', 'Ambuja Traders', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-V1`).lastInsertRowid);
  db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, created_by) VALUES (?, ?, 'VENDOR', '[\"CEMENT\"]', 'e2e')").run(c, v); db.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, state_code, gstin, created_by) VALUES (?, ?, '29', '29AAAAA0000A1Z5', 'e2e')").run(c, v);
  db.prepare('INSERT INTO mdm_partner_contacts (company_id, partner_id, name, email, mobile, is_primary, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)').run(c, v, 'Ambuja', 'sales@ambuja.example', '9812345678', 'e2e');
  const pr = Number(db.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, created_by) VALUES (?, ?, ?, ?, ?, 'DIRECT', ?, ?, 'APPROVED', 38000000, 'e2e')").run(c, `PR/${T}/1`, iso(0), pid, s1, `${t}-se`, iso(30)).lastInsertRowid);
  const pl = Number(db.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (?, ?, 1, ?, 100000, 'bag', 38000, 3800000, 'MANUAL', ?, ?, 100000, 'e2e')").run(c, pr, item, iso(30), s1).lastInsertRowid);
  db.close();
  const call = async (roles, user, method, path, data) => { const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, `${t}-${user}`), data }); expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const approve = async (roles, user, instanceId) => { const tasks = (await call(roles, user, 'get', '/workflow/tasks?mine=assigned')).rows; const task = tasks.find((x) => x.instance.id === instanceId); expect(task, `${user} has the task`).toBeTruthy(); await call(roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'Fine, approved' }); };
  const rfq = await call('PROCIC', 'ic', 'post', '/proc/rfqs', { projectId: pid, title: 'Cement for the slab', dueDate: iso(7), lines: [{ prLineId: pl }], vendors: [{ vendorId: v, channel: 'LINK' }] }); await call('PROCIC', 'ic', 'post', `/proc/rfqs/${rfq.id}/issue`);
  const q = await call('PROCIC', 'ic', 'post', '/proc/quotations', { rfqId: rfq.id, vendorId: v, validUntil: iso(30), deliveryDays: 5, lines: [{ rfqLineId: rfq.lines[0].id, rate: 390, gstRate: 18 }] }); await call('PROCIC', 'ic', 'post', `/proc/quotations/${q.id}/submit`);
  const cs = await call('PROCIC', 'ic', 'post', '/proc/comparative-statements', { rfqId: rfq.id, recommendationType: 'OVERALL_L1' }); const sub = await call('PROCIC', 'ic', 'post', `/proc/comparative-statements/${cs.id}/submit`);
  await approve('PROCMGR', 'mgr', sub.workflowInstanceId); await approve('PM', 'pm', sub.workflowInstanceId);
  return { u: (k) => `${t}-${k}` };
}

test('Purchase order: from an approved statement, approved and sent; the vendor acknowledges and tells the dispatch; amended with a comparison; the tracker; masked for the storekeeper', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `o${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(request, c, t);
  const ic = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/po-new'); const p = ic.page; const errors = watch(p);
  await expect(p.getByTestId('proc-po-form')).toBeVisible(); const csSel = p.getByTestId('pon-cs'); await expect(csSel.locator('option')).toHaveCount(2); await csSel.selectOption({ index: 1 }); await p.getByTestId('pon-vendor').selectOption({ index: 1 });
  await p.getByTestId('pon-state').fill('27'); await p.getByTestId('pon-address').fill('Tower site, Pune'); await p.getByTestId('pon-advance').fill('20'); await noOverflow(p); await shot(p, '1-po-new', info); await p.getByTestId('pon-save').click();
  await expect(p.getByTestId('po-object')).toBeVisible(); await expect(p.getByTestId('po-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(p.getByTestId('po-tax')).toContainText('7,020'); await expect(p.getByText('IGST').first()).toBeVisible(); await expect(p.getByTestId('po-total')).toContainText('46,020');
  const url = p.url().replace(/^https?:\/\/[^/]+/, ''); await p.getByTestId('po-submit').click(); await expect(p.getByTestId('po-object')).toHaveAttribute('data-status', 'SUBMITTED'); await shot(p, '2-submitted', info);
  const mgr = await open(browser, info, c, 'PROCMGR', s.u('mgr'), url); await expect(mgr.page.getByTestId('po-decide')).toBeVisible(); await mgr.page.getByTestId('po-approve').click(); await expect(mgr.page.getByTestId('po-note')).toBeVisible();
  await p.reload(); await expect(p.getByTestId('po-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('po-sent')).not.toHaveText('—'); await p.getByTestId('po-resend').click(); await expect(p.getByTestId('po-link')).toBeVisible();
  const href = await p.getByTestId('po-link').locator('input').inputValue(); const vpath = new URL(href, 'http://x').pathname + new URL(href, 'http://x').search; await shot(p, '3-approved', info);
  // the vendor
  const vctx = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch }); const v = await vctx.newPage(); const verrors = watch(v); await v.goto(vpath); await expect(v.getByTestId('vendor-po-page')).toBeVisible(); await expect(v.getByTestId('vp-not-acked')).toBeVisible();
  await v.getByTestId('vp-ack').click(); await expect(v.getByTestId('vp-acked')).toBeVisible(); await v.getByTestId('vp-qty').fill('30'); await v.getByTestId('vp-vehicle').fill('MH12AB1234'); await v.getByTestId('vp-arrival').fill(iso(4)); await shot(v, '4-vendor-page', info); await noOverflow(v); await v.getByTestId('vp-send').click(); await expect(v.getByTestId('vp-done')).toContainText('ASN/'); expect(verrors).toEqual([]);
  await p.reload(); await expect(p.getByTestId('po-ack')).not.toHaveText('—'); await expect(p.getByTestId('po-dispatches')).toBeVisible();
  // the amendment: the quantity falls, the comparison is shown, the manager approves
  await p.goto(url.replace('purchase-orders', 'po-amend')); await expect(p.getByTestId('amend-form')).toBeVisible(); await p.getByTestId('amend-qty').fill('80'); await p.getByTestId('amend-reason').fill('The pour is smaller than planned'); await p.getByTestId('amend-compare-go').click();
  await expect(p.getByTestId('amend-compare')).toBeVisible(); await expect(p.getByTestId('amend-change')).toHaveCount(1); await expect(p.getByTestId('amend-delta')).toContainText('9,204'); await shot(p, '5-amendment', info); await noOverflow(p); await p.getByTestId('amend-submit').click(); await expect(p.getByTestId('amend-note')).toBeVisible();
  const mg2 = await open(browser, info, c, 'PROCMGR', s.u('mgr'), p.url().replace(/^https?:\/\/[^/]+/, '')); await expect(mg2.page.getByTestId('amend-decide')).toBeVisible(); await mg2.page.getByTestId('amend-approve').click(); await expect(mg2.page.getByTestId('amend-note')).toBeVisible();
  await p.goto(url); await expect(p.getByTestId('po-total')).toContainText('36,816'); await expect(p.getByTestId('po-amendments')).toBeVisible();
  // the tracker and the masks
  await p.goto('/proc/po-tracker'); await expect(p.getByTestId('trk-table')).toBeVisible(); await expect(p.getByTestId('trk-row')).toHaveCount(1); await shot(p, '6-tracker', info); await noOverflow(p); expect(errors).toEqual([]);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), url); await expect(sk.page.getByTestId('po-lines')).toBeVisible(); await expect(sk.page.getByTestId('po-total')).toHaveText('—'); await expect(sk.page.getByTestId('po-line').first()).not.toContainText('₹'); await shot(sk.page, '7-storekeeper', info);
  const se = await open(browser, info, c, 'SE', s.u('se'), '/proc/purchase-orders'); await expect(se.page.getByText(/permission/i).first()).toBeVisible();
});
