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
// Part 16.10 in the browser (development-header mode, port 3100): the QS makes the monthly reconciliation of a site, sees the figures from the ledger and the progress reports, explains the excess consumption, sends it,
// the project manager and the project director approve and it is locked; the status page and the wastage trend show it. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-mrc';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : 'x')); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['qs', ['QS']], ['pm', ['PM']], ['pd', ['PD']], ['mgr1', ['STOREMGR']], ['sk1', ['SK']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Recon tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-T`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Recon site', 'ACTIVE')").run(c, pid, `${T}-TS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const cement = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const a = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Store A', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-A`, pid, site, JSON.stringify([`${t}-sk1`])).lastInsertRowid);
  const ver = fill(db, 'proj_boq_versions', { company_id: c, project_id: pid, org_project_id: pid }); const line = fill(db, 'proj_boq_lines', { company_id: c, version_id: ver, line_kind: 'ITEM', item_code: `${T}-C1`, description: 'Concrete', uom: 'm3', qty: 100_000 });
  fill(db, 'proj_boq_line_norms', { company_id: c, line_id: line, resource_item_id: cement, norm_type: 'MATERIAL', description: 'Cement', uom: 'bag', qty_per_unit: 8000, wastage_pct: 500 });
  const act = fill(db, 'plan_activities', { company_id: c, code: `${T}-A1`, name: 'Slab concrete', project_id: pid, org_project_id: pid }); fill(db, 'plan_activity_boq', { company_id: c, activity_id: act, boq_line_id: line, qty: 100_000 });
  const dpr = fill(db, 'site_dprs', { company_id: c, org_project_id: pid, dpr_site_id: site, dpr_date: today, status: 'APPROVED', scope: 'SITE', supervisor: 'sup', doc_no: `DPR/${T}/1` }); fill(db, 'site_dpr_work', { company_id: c, dpr_id: dpr, activity_id: act, qty: 30_000 });
  db.close(); return { u: (k) => `${t}-${k}`, T, cement, a, pid, site };
}

test('Monthly material reconciliation: the site is flagged missing, the QS makes it, explains the excess, the project manager and director approve and lock it; the month can be closed', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const t = `k${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  await api(request, c, 'QS', s.u('qs'), 'post', '/inv/reconciliation-materials', { itemId: s.cement, defaultWastagePct: 5 });
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.a, itemId: s.cement, type: 'RECEIPT', qty: 1000, rate: 40, date: today, reason: 'Opening for the test' });
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.a, itemId: s.cement, type: 'ISSUE', qty: 300, date: today, reason: 'Issued for the slab' });
  const q = await open(browser, info, c, 'QS', s.u('qs'), '/inv/reconciliations'); const p = q.page; const errors = watch(p);
  await expect(p.getByTestId('mrc-status')).toBeVisible(); await expect(p.getByTestId(`mrc-site-${s.T}-TS`)).toContainText('Missing'); await expect(p.getByTestId('mrc-kpi-missing')).toContainText('1'); await expect(p.getByTestId('mrc-close-ready')).toContainText('cannot be closed'); await noOverflow(p); await shot(p, '1-status', info);
  await p.getByTestId(`mrc-generate-${s.T}-TS`).click(); await expect(p.getByTestId('mrc-object')).toHaveAttribute('data-status', 'DRAFT'); const url = here(p);
  await expect(p.getByTestId(`mrc-book-${s.cement}`)).toContainText('700'); await expect(p.getByTestId(`mrc-theo-${s.cement}`)).toContainText('252'); await expect(p.getByTestId(`mrc-actual-${s.cement}`)).toContainText('300'); await expect(p.getByTestId(`mrc-var-${s.cement}`)).toContainText('48'); await expect(p.getByTestId('mrc-unexplained')).toContainText('1'); await noOverflow(p); await shot(p, '2-workbench', info);
  await p.getByTestId(`mrc-drill-${s.cement}`).click(); await expect(p.getByTestId('mrc-drilldown')).toBeVisible(); await expect(p.getByTestId('mrc-work')).toContainText('Slab concrete');
  await p.getByTestId('mrc-submit').click(); await expect(p.getByTestId('mrc-error')).toContainText('reason'); await p.getByTestId(`mrc-reason-${s.cement}`).selectOption('SPILLAGE'); await p.getByTestId(`mrc-expl-${s.cement}`).fill('Bags were torn by the rain and swept up on the podium'); await p.getByTestId('mrc-save').click(); await expect(p.getByTestId('mrc-note')).toBeVisible(); await expect(p.getByTestId('mrc-unexplained')).toContainText('0');
  await p.getByTestId('mrc-submit').click(); await expect(p.getByTestId('mrc-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const pm = await open(browser, info, c, 'PM', s.u('pm'), url); await expect(pm.page.getByTestId('mrc-decide')).toBeVisible(); await pm.page.getByTestId('mrc-approve').click(); await expect(pm.page.getByTestId('mrc-note')).toBeVisible(); await pm.context.close();
  const pd = await open(browser, info, c, 'PD', s.u('pd'), url); await expect(pd.page.getByTestId('mrc-decide')).toBeVisible(); await pd.page.getByTestId('mrc-approve').click(); await expect(pd.page.getByTestId('mrc-note')).toBeVisible(); await pd.context.close();
  await p.reload(); await expect(p.getByTestId('mrc-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('mrc-locked')).toBeVisible(); await expect(p.getByTestId('mrc-save')).toHaveCount(0); await noOverflow(p); await shot(p, '3-approved', info);
  await p.goto('/inv/reconciliations'); await expect(p.getByTestId(`mrc-site-${s.T}-TS`)).toContainText('Approved'); await expect(p.getByTestId('mrc-close-ready')).toContainText('can be closed'); await noOverflow(p);
  await p.goto('/inv/wastage-trend'); await expect(p.getByTestId('wastage-trend')).toBeVisible(); await expect(p.getByTestId('wt-table')).toBeVisible(); await expect(p.getByTestId('wt-chart')).toBeVisible(); await noOverflow(p); await shot(p, '4-trend', info);
  await p.goto('/inv/reconciliations?tab=materials'); await expect(p.getByTestId('mrc-mat-table')).toBeVisible(); await noOverflow(p); await p.goto('/inv/reconciliations?tab=list'); await expect(p.getByTestId('reconciliations')).toBeVisible(); await noOverflow(p);
  expect(errors).toEqual([]);
});
