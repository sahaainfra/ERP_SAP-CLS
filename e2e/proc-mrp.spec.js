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
// Part 15.02 in the browser (development-header mode, port 3100): planning runs MRP for a project from its schedule, BOQ norms, stock and orders; the result is drilled to the activities; the proposals are changed and accepted into a draft requisition;
// the heat-map shows the shortages and the long-lead list the order-by dates; item planning parameters are proposed by planning and approved by the procurement manager; a site engineer has no access.
const OUT = 'docs/erp/screenshots/proc-mrp';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.parse(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(request, c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['pcm', ['PCMGR']], ['mgr', ['PROCMGR']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower M', 'BUILDING', 'ACTIVE')").run(c, `${T}-M`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (?, ?, ?, 'e2e')").run(c, pid, `${t}-pcm`);
  const s1 = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'MR', 'MRP e2e', 'MRE', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = (code, name, uom, last) => Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, last_purchase_amount) VALUES (?, ?, ?, 'MATERIAL', ?, ?, '2026-01-01', 'ACTIVE', ?)").run(c, code, name, cat, uom, last).lastInsertRowid);
  const cement = item('CEMX', 'Cement OPC e2e', 'bag', 38000); const steel = item('STLX', 'TMT bars e2e', 'kg', 6500);
  const ver = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (?, ?, ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED', 'e2e')").run(c, `BQ/${T}`, pid).lastInsertRowid);
  const line = Number(db.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount, created_by) VALUES (?, ?, 'ITEM', '1.1', 'Concrete', 'cum', 100000, 0, 0, 'e2e')").run(c, ver).lastInsertRowid);
  db.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (?, ?, ?, 'MATERIAL', 'Cement', 'bag', 8000, 50000, 'e2e')").run(c, line, cement);
  db.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (?, ?, ?, 'MATERIAL', 'Steel', 'kg', 40000, 0, 'e2e')").run(c, line, steel);
  db.close();
  const cal = await api(request, c, 'PLAN', `${t}-plan`, 'post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); await api(request, c, 'PCMGR', `${t}-pcm`, 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await api(request, c, 'PLAN', `${t}-plan`, 'post', '/plan/schedules', { projectId: pid, name: 'Schedule', calendarId: cal.id, startDate: '2026-04-06' }); await api(request, c, 'PLAN', `${t}-plan`, 'post', `/plan/schedules/${sch.id}/import`, { rows: [{ code: 'A10', name: 'Slab concrete', duration: 14 }] });
  const d = new DatabaseSync('data/e2e.sqlite'); d.exec('PRAGMA busy_timeout = 8000;'); const act = d.prepare('SELECT id FROM plan_activities WHERE schedule_id = ?').get(sch.id).id; const next = iso(5); // 166.1: five days from today, whatever the weekday: the need date (three days earlier) is still ahead and the order-by date (the lead time before it) has passed
  d.prepare("UPDATE plan_activities SET es = ?, ef = ?, qty = 100000, uom = 'cum' WHERE id = ?").run(next, new Date(Date.parse(`${next}T00:00:00Z`) + 13 * 86_400_000).toISOString().slice(0, 10), act); d.prepare("UPDATE plan_schedules SET status = 'APPROVED' WHERE id = ?").run(sch.id); d.prepare("INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty, created_by) VALUES (?, ?, ?, 100000, 'e2e')").run(c, act, line); d.close();
  await api(request, c, 'SYSADM', 'e2e-setup', 'post', '/proc/stock/ingest', { levels: [{ itemId: cement, storeCode: `${T}-ST`, storeName: 'Tower store', kind: 'SITE', siteId: s1, freeQty: 200 }] });
  await api(request, c, 'SYSADM', 'e2e-setup', 'post', '/proc/supply/ingest', { supplies: [{ projectId: pid, itemId: cement, kind: 'PO', docRef: 'PO/E2E/1', balanceQty: 100, expectedOn: iso(0) > next ? iso(0) : new Date(Date.parse(`${next}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10) }] });
  return { u: (k) => `${t}-${k}`, pid, s1, T, cement };
}

test('MRP: run for a project, drill to the activities, change and accept proposals into a draft requisition, the heat-map and long-lead items, parameters by maker and checker', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `p${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(request, c, t);
  const pl = await open(browser, info, c, 'PLAN', s.u('plan'), '/proc/mrp'); const p = pl.page; const errors = watch(p);
  await expect(p.getByTestId('proc-mrp')).toBeVisible(); await expect(p.getByTestId('mrp-runs-empty')).toBeVisible(); await p.getByTestId('mrp-horizon').fill('8'); await p.getByTestId('mrp-go').click();
  await expect(p.getByTestId('run-object')).toBeVisible(); await expect(p.getByTestId('run-object')).toHaveAttribute('data-status', 'COMPLETED'); await expect(p.getByTestId('run-items')).toHaveText('2'); await expect(p.getByTestId('run-line').first()).toBeVisible();
  // the first week with a requirement: cement 420, the activity behind it
  const row = p.getByTestId('run-line').filter({ hasText: 'CEMX' }).filter({ hasText: '420' }).first(); await expect(row).toBeVisible(); await row.getByTestId('run-drill').click(); await expect(p.getByTestId('run-activities')).toContainText('A10'); await noOverflow(p); await shot(p, 'result', info);
  // the proposals: oldest order-by first; change one, accept the cement ones
  await p.goto(`/proc/mrp-proposals?runId=${new URL(p.url()).searchParams.get('id') ?? ''}`); await p.getByTestId('prop-project').selectOption({ index: 0 }); await expect(p.getByTestId('prop-row').first()).toBeVisible(); await expect(p.getByTestId('prop-row').first()).toHaveAttribute('data-urgency', 'LATE');
  await p.getByTestId('prop-row').filter({ hasText: 'CEMX' }).first().getByTestId('prop-modify-open').click(); await expect(p.getByTestId('prop-modify')).toBeVisible(); await p.getByTestId('prop-qty').fill('350'); await p.getByTestId('prop-save').click(); await expect(p.getByTestId('prop-row').filter({ hasText: 'CEMX' }).first()).toContainText('350');
  await shot(p, 'proposals', info); // PACK-W0-01: the 14-day activity starting 5 days from today falls into two or three weekly buckets depending on the weekday, so the
  // requisition has one line per accepted cement proposal rather than a fixed two
  const cement = await p.getByTestId('prop-row').filter({ hasText: 'CEMX' }).all(); expect(cement.length).toBeGreaterThanOrEqual(2); for (const r of cement) await r.getByTestId('prop-check').check(); await p.getByTestId('prop-accept').click();
  await expect(p.getByTestId('pr-object')).toBeVisible(); await expect(p.getByTestId('pr-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(p.getByTestId('pr-figures')).toContainText('MRP proposal'); await expect(p.getByTestId('pr-line')).toHaveCount(cement.length); await shot(p, 'draft-pr', info);
  // the heat-map and the long-lead list (the item has an approved long lead time)
  const pm = await open(browser, info, c, 'PROCMGR', s.u('mgr'), '/proc/item-params'); const m = pm.page; await expect(m.getByTestId('proc-params')).toBeVisible();
  // planning proposes parameters in the browser; the procurement manager approves them
  await p.goto('/proc/item-params?new=1'); await p.getByTestId('param-pick').click(); const sel = p.getByTestId('item-selector'); await sel.getByTestId('is-q').fill('CEMX'); await expect(sel.getByTestId('is-row')).toHaveCount(1); await sel.getByTestId('is-pick').check(); await sel.getByTestId('is-done').click();
  await p.getByTestId('param-lead').fill('60'); await p.getByTestId('param-moq').fill('100'); await p.getByTestId('param-pack').fill('50'); await p.getByTestId('param-safety').fill('50'); await p.getByTestId('param-longlead').check(); await p.getByTestId('param-capacity').fill('The plant supplies 2,000 bags a week'); await p.getByTestId('param-from').fill('2026-01-01'); await p.getByTestId('param-save').click();
  await expect(p.getByTestId('param-object')).toBeVisible(); await p.getByTestId('param-submit').click(); await expect(p.getByTestId('param-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(p.getByTestId('param-decide')).toHaveCount(0); await shot(p, 'param-submitted', info);
  const paramUrl = p.url().replace(/^https?:\/\/[^/]+/, ''); await m.goto(paramUrl); await expect(m.getByTestId('param-decide')).toBeVisible(); await m.getByTestId('param-approve').click(); await expect(m.getByTestId('param-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(m.getByTestId('param-locked')).toBeVisible();
  // a new run now plans with the lead time of 60 days: the long-lead list shows cement, late
  await p.goto('/proc/mrp'); await p.getByTestId('mrp-go').click(); await expect(p.getByTestId('run-object')).toBeVisible(); await m.goto('/proc/mrp-heatmap'); await expect(m.getByTestId('hm-grid')).toBeVisible();
  await expect(m.getByTestId('hm-row').filter({ hasText: 'CEMX' })).toBeVisible(); await expect(m.locator('[data-testid="hm-cell"][data-level="CRITICAL"]').first()).toBeVisible(); await expect(m.getByTestId('ll-row')).toHaveCount(1); await expect(m.getByTestId('ll-row')).toContainText('2,000 bags'); await expect(m.getByTestId('ll-row')).toHaveAttribute('data-late', '1'); await noOverflow(m); await shot(m, 'heatmap', info);
  const se = await open(browser, info, c, 'SE', s.u('se'), '/proc/mrp'); await expect(se.page.getByText('proc.run.view')).toBeVisible(); expect(errors).toEqual([]);
});
