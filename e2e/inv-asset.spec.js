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
// Part 16.09 in the browser (development-header mode, port 3100): a tool is registered and approved, an instrument with overdue calibration cannot be issued until it is calibrated, a tool is issued by QR with the receiver's code
// confirmed on the employee's own phone, the custody statement shows it, and its loss goes through the construction manager, the project manager and the HR manager. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-asset';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['sk1', ['SK']], ['mgr1', ['STOREMGR']], ['mgr2', ['STOREMGR']], ['cm', ['CM']], ['pm', ['PM']], ['hr', ['HRMGR']], ['emp1', ['EMP']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tools tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tools site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'TOOLS', 'Tools', 'TLS', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = (code, name, type) => Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, ?, ?, ?, 'nos', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-${code}`, name, type, cat).lastInsertRowid);
  const drill = item('DRL', 'Rotary hammer', 'TOOL'); const level = item('LVL', 'Auto level', 'EQUIPMENT');
  const a = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Store A', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-A`, pid, site, JSON.stringify([`${t}-sk1`])).lastInsertRowid);
  const uid = db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(c, `${t}-emp1`).id;
  const emp = Number(db.prepare("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, employment_type, doj, location_type, employment_status, user_id) VALUES (?, ?, 'Ravi', ?, 'ravi kumar', 'MALE', '1990-01-01', '9000000000', 'PERMANENT', '2024-01-01', 'SITE', 'ACTIVE', ?)").run(c, `${T}-E1`, `Ravi Kumar ${T}`, uid).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, T, drill, level, a, emp };
}
const decide = async (request, c, roles, user, docType, docId) => {
  const rows = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H(roles, c, user) })).json()).data.rows; const task = rows.find((x) => x.instance.docType === docType && String(x.instance.docId) === String(docId)); expect(task, `${user} has the task`).toBeTruthy();
  const res = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: H(roles, c, user), data: { action: 'approve', comment: 'Approved in the test' } }); expect(res.status(), await res.text()).toBe(200);
};

test('Tools and small assets: register and approve, calibration blocks the issue, issue by QR with the receiver code, the custody statement, and a loss approved by CM, PM and HR', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `s${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const k = await open(browser, info, c, 'SK', s.u('sk1'), '/inv/small-assets'); const p = k.page; const errors = watch(p);
  await expect(p.getByTestId('small-assets')).toBeVisible(); await p.getByTestId('asset-add').click(); await p.getByTestId('asset-item').selectOption({ label: `${s.T}-DRL · Rotary hammer` }); await p.getByTestId('asset-store').selectOption({ index: 1 }); await p.getByTestId('asset-serial').fill('RH-100'); await p.getByTestId('asset-make').fill('Bosch'); await p.getByTestId('asset-value').fill('9500'); await p.getByTestId('asset-create').click();
  await expect(p.getByTestId('asset-object')).toHaveAttribute('data-status', 'DRAFT'); await noOverflow(p); await shot(p, '1-asset', info); const url = here(p); await p.getByTestId('asset-submit').click(); await expect(p.getByTestId('asset-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const m2 = await open(browser, info, c, 'STOREMGR', s.u('mgr2'), url); await expect(m2.page.getByTestId('asset-decide')).toBeVisible(); await m2.page.getByTestId('asset-approve').click(); await expect(m2.page.getByTestId('asset-note')).toBeVisible(); await m2.context.close();
  await p.reload(); await expect(p.getByTestId('asset-object')).toHaveAttribute('data-status', 'APPROVED'); await p.getByTestId('asset-tag').click(); await expect(p.getByTestId('asset-qr')).toBeVisible(); const tag = (await p.getByTestId('asset-qr').locator('strong').innerText()).trim();
  const lv = await api(request, c, 'SK', s.u('sk1'), 'post', '/inv/small-assets', { itemId: s.level, storeId: s.a, serialNo: 'LV-1', value: 30000, calibrationRequired: true, calibrationDue: plus(-4) }); await api(request, c, 'SK', s.u('sk1'), 'post', `/inv/small-assets/${lv.id}/submit`, {}); await decide(request, c, 'STOREMGR', s.u('mgr1'), 'INV_ASSET', lv.id);
  await p.goto(`/inv/small-assets?id=${lv.id}`); await expect(p.getByTestId('asset-cal-overdue')).toBeVisible(); await p.getByTestId('asset-act-issue').click(); await p.getByTestId('af-custodianId').selectOption({ index: 1 }); await p.getByTestId('af-go').click(); await expect(p.getByTestId('asset-error')).toContainText('Calibration'); await noOverflow(p); await shot(p, '2-calibration-blocks', info);
  await p.getByTestId('asset-act-calibrate').click(); await p.getByTestId('af-certificateNo').fill('CAL/2026/77'); await p.getByTestId('af-lab').fill('NABL lab'); await p.getByTestId('af-dueDate').fill(plus(300)); await p.getByTestId('af-go').click(); await expect(p.getByTestId('asset-note')).toBeVisible(); await expect(p.getByTestId('asset-cal-overdue')).toHaveCount(0);
  await p.goto('/inv/asset-scan'); await expect(p.getByTestId('asset-scan')).toBeVisible(); await p.getByTestId('asset-scan-input').fill(`ERP:A:${tag}`); await p.getByTestId('asset-scan-input').press('Enter'); await expect(p.getByTestId('scan-tool')).toBeVisible(); await p.getByTestId('scan-who').selectOption({ index: 1 }); await noOverflow(p); await shot(p, '3-scan', info); await p.getByTestId('scan-issue').click(); await expect(p.getByTestId('scan-note')).toBeVisible(); await expect(p.getByTestId('scan-state')).toContainText('waiting');
  const db = new DatabaseSync('data/e2e.sqlite'); const id = db.prepare('SELECT id FROM ast_small_assets WHERE tag_code = ? AND company_id = ?').get(tag, c).id; const { createHash } = await import('node:crypto'); db.prepare("UPDATE ast_custody_log SET ack_hash = ? WHERE asset_id = ? AND ack_status = 'PENDING'").run(createHash('sha256').update(`${id}:246810`).digest('hex'), id); db.close();
  const e = await open(browser, info, c, 'EMP', s.u('emp1'), '/inv/asset-scan'); await expect(e.page.getByTestId(`mine-${tag}`)).toBeVisible(); await e.page.getByTestId(`mine-code-${tag}`).fill('246810'); await noOverflow(e.page); await shot(e.page, '4-employee', info); await e.page.getByTestId(`mine-confirm-${tag}`).click(); await expect(e.page.getByTestId('mine-note')).toBeVisible(); await e.context.close();
  const h = await open(browser, info, c, 'HRMGR', s.u('hr'), '/inv/custody'); const q = h.page; await expect(q.getByTestId('custody')).toBeVisible(); await q.getByTestId('cs-person').selectOption({ index: 1 }); await expect(q.getByTestId(`cs-row-${tag}`)).toBeVisible(); await expect(q.getByTestId('cs-clear')).toContainText('not clear'); await noOverflow(q); await shot(q, '5-statement', info);
  await p.goto(`/inv/small-assets?id=${id}`); await expect(p.getByTestId('asset-object')).toHaveAttribute('data-state', 'ISSUED'); await p.getByTestId('asset-act-loss').click(); await p.getByTestId('af-description').fill('Left on the roof and gone by morning'); await p.getByTestId('af-go').click(); await expect(p.getByTestId('loss-object')).toBeVisible();
  await p.getByTestId('loss-investigation').fill('Checked the site log and the guards: no sign of a break-in'); await p.getByTestId('loss-save').click(); await expect(p.getByTestId('loss-note')).toBeVisible(); await noOverflow(p); await shot(p, '6-loss', info); await p.getByTestId('loss-submit').click(); await expect(p.getByTestId('loss-object')).toHaveAttribute('data-status', 'SUBMITTED'); const lurl = here(p);
  for (const [roles, user] of [['CM', 'cm'], ['PM', 'pm'], ['HRMGR', 'hr']]) { const a = await open(browser, info, c, roles, s.u(user), lurl); await expect(a.page.getByTestId('loss-decide')).toBeVisible(); await a.page.getByTestId('loss-approve').click(); await expect(a.page.getByTestId('loss-note')).toBeVisible(); await a.context.close(); }
  await p.reload(); await expect(p.getByTestId('loss-object')).toHaveAttribute('data-status', 'APPROVED'); await p.goto(`/inv/small-assets?id=${id}`); await expect(p.getByTestId('asset-object')).toHaveAttribute('data-state', 'LOST');
  await q.goto('/inv/custody?tab=calibration'); await expect(q.getByTestId('calibration-due')).toBeVisible(); await noOverflow(q); await q.goto('/inv/small-assets?tab=loss'); await expect(q.getByTestId('small-assets')).toBeVisible(); await noOverflow(q);
  expect(errors).toEqual([]);
});
