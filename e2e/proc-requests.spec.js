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
// Part 15.01 in the browser (development-header mode, port 3100): a site engineer raises a material request on the phone with the stock of the site and the nearby store under the item; the construction manager approves it; procurement
// consolidates it into a requisition, which free stock stops until an exception is approved; the project manager approves it; a site engineer never sees the rates.
const OUT = 'docs/erp/screenshots/proc-requests';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });

async function seed(request, c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['se', ['SE']], ['cm', ['CM']], ['ic', ['PROCIC']], ['pm', ['PM']], ['pd', ['PD']], ['qs', ['QS']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower P', 'BUILDING', 'ACTIVE')").run(c, `${T}-P`).lastInsertRowid);
  const s1 = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid); const s2 = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Yard site', 'ACTIVE')").run(c, pid, `${T}-S2`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'PR', 'Procurement e2e', 'PRT', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (?, 'OPCX', 'Cement OPC e2e', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 38000)").run(c, cat).lastInsertRowid);
  db.close();
  await api(request, c, 'SYSADM', 'e2e-setup', 'post', '/proc/stock/ingest', { levels: [{ itemId: item, storeCode: `${T}-S1ST`, storeName: 'Tower store', kind: 'SITE', siteId: s1, freeQty: 10 }, { itemId: item, storeCode: `${T}-S2ST`, storeName: 'Yard store', kind: 'SITE', siteId: s2, freeQty: 100 }] });
  return { u: (k) => `${t}-${k}`, pid, s1, T };
}

test('material request to purchase requisition: stock shown on the phone, approval by the construction manager, consolidation, the stock check, approval by value, rates hidden from the site engineer', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `m${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(request, c, t);
  const se = await open(browser, info, c, 'SE', s.u('se'), '/proc/material-requests/new'); const p = se.page; const errors = watch(p);
  await expect(p.getByTestId('proc-mr-new')).toBeVisible(); await p.getByTestId('mrn-site').selectOption({ label: `${s.T}-S1 Tower site` }); await p.getByTestId('mrn-purpose').fill('Slab pour on level 3');
  await p.getByTestId('mrn-add').click(); const sel = p.getByTestId('item-selector'); await sel.getByTestId('is-q').fill('OPCX'); await expect(sel.getByTestId('is-row')).toHaveCount(1); await sel.getByTestId('is-pick').check(); await sel.getByTestId('is-done').click();
  await expect(p.getByTestId('mrn-line')).toHaveCount(1); await p.getByTestId('mrn-qty').fill('40'); await expect(p.getByTestId('mr-store')).toHaveCount(2); await expect(p.getByTestId('mr-stock')).toContainText('Yard store'); await expect(p.getByTestId('mr-stock')).toContainText('100');
  await noOverflow(p); await shot(p, 'mr-new', info); await p.getByTestId('mrn-send').click();
  await expect(p.getByTestId('mr-object')).toBeVisible(); await expect(p.getByTestId('mr-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(p.getByTestId('mr-line')).toHaveCount(1); await expect(p.getByTestId('mr-line')).toContainText('OPCX'); await shot(p, 'mr-submitted', info);
  const mrUrl = p.url().replace(/^https?:\/\/[^/]+/, '');
  // the construction manager approves
  const cm = await open(browser, info, c, 'CM', s.u('cm'), mrUrl); const m = cm.page; await expect(m.getByTestId('mr-decide')).toBeVisible(); await m.getByTestId('mr-approve').click(); await expect(m.getByTestId('mr-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(m.getByTestId('mr-figures')).toContainText(`${s.T}-S1`);
  // procurement consolidates it
  const ic = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/consolidate'); const i = ic.page; await expect(i.getByTestId('con-mr')).toHaveCount(1); await i.getByTestId('con-check').check(); await i.getByTestId('con-preview').click(); await expect(i.getByTestId('con-group')).toHaveCount(1); await expect(i.getByTestId('con-group')).toContainText('40'); await expect(i.getByTestId('con-group')).toContainText('Covers the need'); await shot(i, 'consolidate', info);
  await i.getByTestId('con-create').click(); await expect(i.getByTestId('pr-object')).toBeVisible(); await expect(i.getByTestId('pr-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(i.getByTestId('pr-sources')).toContainText('MR/'); await expect(i.getByTestId('pr-total')).toContainText('15,200'); await expect(i.getByTestId('pr-stock-line')).toContainText('Free stock covers it');
  // the free stock stops it
  await i.getByTestId('pr-submit').click(); await expect(i.getByTestId('pr-error')).toBeVisible(); await expect(i.getByTestId('pr-object')).toHaveAttribute('data-status', 'DRAFT'); await shot(i, 'pr-stopped', info);
  const prId = Number(new URL(i.url()).searchParams.get('id')); const H2 = (k) => ({ ...H('PROCIC', c, s.u('ic')), 'idempotency-key': `e2e-${k}-${Math.random()}` });
  const ex = await request.post('/api/v1/pcs/exceptions', { headers: H2('x'), data: { controlCode: 'CP-PROC-01', entity: 'proc_pr', entityId: String(prId), reasonCode: 'URGENT_COMMERCIAL', justification: 'The stock is reserved for the podium and the slab needs this cement now.' } }); expect(ex.status(), await ex.text()).toBe(201); const e = (await ex.json()).data;
  const f = new DatabaseSync('data/e2e.sqlite'); f.exec('PRAGMA busy_timeout = 8000;'); f.prepare("INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, linked_entity, linked_id, created_by, source_type) VALUES (?, ?, 'quote.jpg', 'jpg', 'image/jpeg', 'image', 1000, 'abc', 'CLEAN', 'pcs_exception', ?, ?, 'test')").run(c, `ev-${e.id}-${t}`, String(e.id), s.u('ic')); f.close();
  const sub = await request.post(`/api/v1/pcs/exceptions/${e.id}/submit`, { headers: H2('s'), data: {} }); expect(sub.status(), await sub.text()).toBe(201); const inst = (await sub.json()).data.workflow.id;
  const task = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H('PM', c, s.u('pm')) })).json()).data.rows.find((x) => x.instance.id === inst); const act = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: { ...H('PM', c, s.u('pm')), 'idempotency-key': `e2e-a-${Math.random()}` }, data: { action: 'approve', comment: 'ok' } }); expect(act.status()).toBe(200);
  await i.getByTestId('pr-submit').click(); await expect(i.getByTestId('pr-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(i.getByTestId('pr-decide')).toHaveCount(0);
  // the project manager approves; the site engineer sees no rates
  const pm = await open(browser, info, c, 'PM', s.u('pm'), `/proc/requisitions?id=${prId}`); const q = pm.page; await expect(q.getByTestId('pr-decide')).toBeVisible(); await expect(q.getByTestId('pr-budget')).toBeVisible(); await q.getByTestId('pr-approve').click(); await expect(q.getByTestId('pr-object')).toHaveAttribute('data-status', 'APPROVED'); await noOverflow(q); await shot(q, 'pr-approved', info);
  const se2 = await open(browser, info, c, 'SE', s.u('se'), `/proc/requisitions?id=${prId}`); await expect(se2.page.getByTestId('pr-object')).toBeVisible(); await expect(se2.page.getByTestId('pr-total')).toContainText('Not shown'); await expect(se2.page.getByTestId('pr-lines')).not.toContainText('₹');
  const lst = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/material-requests'); await expect(lst.page.getByTestId('proc-mrs')).toBeVisible(); await expect(lst.page.locator('[data-testid^="row-"], [data-testid="list-card"]').locator('visible=true').first()).toBeVisible(); await noOverflow(lst.page); await shot(lst.page, 'mr-list', info);
  const prl = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/requisitions'); await expect(prl.page.getByTestId('proc-prs')).toBeVisible(); await expect(prl.page.locator('[data-testid^="row-"], [data-testid="list-card"]').locator('visible=true').first()).toBeVisible(); await shot(prl.page, 'pr-list', info);
  const nope = await open(browser, info, c, 'QS', s.u('qs'), '/proc/consolidate'); await expect(nope.page.getByText('proc.requisition.create')).toBeVisible(); expect(errors).toEqual([]);
});
