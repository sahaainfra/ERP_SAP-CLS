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
// Part 15.10 in the browser (development-header mode, port 3100): the procurement manager reads the dashboard (tiles, drill-down to records, queues, charts) and the spend, cycle time and compliance reports; the storekeeper has no access.
const OUT = 'docs/erp/screenshots/proc-ana';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.parse(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['mgr', ['PROCMGR']], ['sk', ['SK']], ['pm', ['PM']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower A', 'BUILDING', 'ACTIVE')").run(c, `${T}-A`).lastInsertRowid); const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Site', 'ACTIVE')").run(c, pid, `${T}-S`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE')").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const vendor = (code, name) => Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-${code}`, name, name).lastInsertRowid);
  const v1 = vendor('V1', 'Ambuja Traders'); const v2 = vendor('V2', 'Birla Dealers');
  const pr = (status, docDate, approved, qty, bal, est) => { const id = Number(db.prepare("INSERT INTO proc_requisitions (company_id, doc_no, doc_date, org_project_id, pr_site_id, pr_source, requested_by, required_by, status, total_amount, approved_at, created_by) VALUES (?, ?, ?, ?, ?, 'DIRECT', ?, ?, ?, ?, ?, 'e2e')").run(c, `${T}/PR/${Math.random().toString(36).slice(2, 6)}`, docDate, pid, site, `${t}-mgr`, iso(30), status, qty * est / 1000, approved).lastInsertRowid); return Number(db.prepare("INSERT INTO proc_pr_lines (company_id, pr_id, line_no, item_id, qty, uom, est_rate, est_amount, valued_from, required_by, delivery_site_id, balance_qty, created_by) VALUES (?, ?, 1, ?, ?, 'bag', ?, ?, 'MANUAL', ?, ?, ?, 'e2e')").run(c, id, item, qty, est, qty * est / 1000, iso(30), site, bal).lastInsertRowid); };
  const l1 = pr('APPROVED', iso(-20), `${iso(-18)}T05:00:00.000Z`, 100000, 100000, 40000); pr('SUBMITTED', iso(-3), null, 50000, 50000, 20000);
  const po = (vendorId, status, days, total, source, prLine, sent) => { const id = Number(db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, po_source, status, requested_by, total_amount, approved_at, sent_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'e2e')").run(c, `${T}/PO/${Math.random().toString(36).slice(2, 6)}`, iso(-days), pid, vendorId, source, status, `${t}-mgr`, total, `${iso(-days)}T05:00:00.000Z`, sent ? `${iso(-1)}T05:00:00.000Z` : null).lastInsertRowid); const line = Number(db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, pr_line_id, item_id, description, qty, uom, rate, line_amount, balance_qty, created_by) VALUES (?, ?, 1, ?, ?, 'Cement', 100000, 'bag', 40000, ?, 100000, 'e2e')").run(c, id, prLine, item, total).lastInsertRowid); return { id, line }; };
  const p1 = po(v1, 'APPROVED', 10, 4_000_000, 'DIRECT', l1, true); po(v2, 'APPROVED', 5, 1_500_000, 'DIRECT', null, false); po(v2, 'SUBMITTED', 1, 2_000_000, 'DIRECT', null, false);
  db.prepare("INSERT INTO proc_po_schedules (company_id, po_id, po_line_id, due_date, qty, received_qty, created_by) VALUES (?, ?, ?, ?, 100000, 0, 'e2e')").run(c, p1.id, p1.line, iso(-4));
  db.close(); return { u: (k) => `${t}-${k}`, T, pid };
}

test('Procurement dashboard: tiles, drill-down to records, work queues and charts; spend, cycle time and compliance reports', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = `a${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const m = await open(browser, info, c, 'PROCMGR', s.u('mgr'), '/proc/dashboard'); const p = m.page; const errors = watch(p);
  await expect(p.getByTestId('proc-pd')).toBeVisible(); await expect(p.getByTestId('pd-openPrs')).toHaveText('2'); await expect(p.getByTestId('pd-pending')).toHaveText('1'); await expect(p.getByTestId('pd-overdue')).toHaveText('1'); await expect(p.getByTestId('pd-spendFy')).toContainText('55,000'); await expect(p.getByTestId('pd-single')).toHaveText('100%');
  await expect(p.getByTestId('pd-cycle')).toContainText('8'); await expect(p.getByTestId('pd-queue-posAwaitingRelease-count')).toHaveText('1'); await expect(p.getByTestId('pd-cat-row').first()).toContainText('Cement'); await expect(p.getByTestId('pd-concentration')).toBeVisible(); await noOverflow(p); await shot(p, '1-dashboard', info);
  // drill-down: a tile opens the records behind it
  await p.getByTestId('pd-open-pending').click(); await expect(p.getByTestId('pd-drill-row')).toHaveCount(1); await p.getByTestId('pd-open-openPrs').click(); await expect(p.getByTestId('pd-drill-row')).toHaveCount(2); await shot(p, '2-drill', info);
  // the project filter
  await p.getByTestId('an-project').selectOption({ index: 1 }); await expect(p.getByTestId('pd-openPrs')).toHaveText('2');
  // spend analysis
  await p.goto('/proc/spend-analysis'); await expect(p.getByTestId('sp-row')).toHaveCount(1); await expect(p.getByTestId('sp-total')).toContainText('55,000'); await p.getByTestId('sp-group').selectOption('vendor'); await expect(p.getByTestId('sp-row')).toHaveCount(2); await p.getByTestId('sp-open').first().click(); await expect(p.getByTestId('sp-detail-row').first()).toBeVisible(); await noOverflow(p); await shot(p, '3-spend', info);
  const dl = p.waitForEvent('download'); await p.getByTestId('sp-export').click(); expect((await dl).suggestedFilename()).toContain('spend-by-vendor');
  // cycle time
  await p.goto('/proc/cycle-time'); await expect(p.getByTestId('ct-avg')).toContainText('8'); await expect(p.getByTestId('ct-row')).toHaveCount(1); await expect(p.getByTestId('ct-stages')).toBeVisible(); await noOverflow(p); await shot(p, '4-cycle', info);
  // compliance
  await p.goto('/proc/procurement-compliance'); await expect(p.getByTestId('co-single-row')).toHaveCount(2); await expect(p.getByTestId('co-exceptions')).toBeVisible(); await noOverflow(p); await shot(p, '5-compliance', info);
  expect(errors, errors.join('\n')).toEqual([]); await m.context.close();
});

test('Procurement dashboard: a project manager reads it; a storekeeper has no access', async ({ browser, request }, info) => {
  const t = `a${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}z`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/proc/dashboard'); await expect(pm.page.getByTestId('proc-pd')).toBeVisible(); await noOverflow(pm.page);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/proc/dashboard'); await expect(sk.page.getByTestId('proc-pd')).toHaveCount(0);
});
