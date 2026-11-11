import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 14.05 in the browser (development-header mode, port 3100): the planner prepares a monthly progress period with an adjustment and the actual cost, sends it; the project manager closes it from the page; the
// dashboard shows the indexes, the S-curve, the WBS variances and the milestone; the report and the client report agree; a construction manager sees percentages only. Desktop and phone, no console errors.
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
const OUT = 'docs/erp/screenshots/site-progress';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const ist = (n) => new Date(Date.now() + 19_800_000 - n * 86_400_000).toISOString().slice(0, 10);

async function seed(request, c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['pm', ['PM']], ['cm', ['CM']], ['pcm', ['PCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower P', 'BUILDING', 'ACTIVE')").run(c, `${T}-P`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower P site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const w1 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '1', 'Substructure', 1, 'e2e')").run(c, pid).lastInsertRowid);
  const w2 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '2', 'Superstructure', 1, 'e2e')").run(c, pid).lastInsertRowid);
  db.close();
  const cal = await api(request, c, 'PLAN', `${t}-plan`, 'post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); await api(request, c, 'PCMGR', `${t}-pcm`, 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await api(request, c, 'PLAN', `${t}-plan`, 'post', '/plan/schedules', { projectId: pid, name: 'Tower schedule', calendarId: cal.id, startDate: '2026-04-06' });
  await api(request, c, 'PLAN', `${t}-plan`, 'post', `/plan/schedules/${sch.id}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 20 }, { code: 'A20', name: 'Raft concrete', duration: 10, predecessors: 'A10' }, { code: 'M1', name: 'Raft complete', duration: 1, predecessors: 'A20' }] }); await api(request, c, 'PLAN', `${t}-plan`, 'post', `/plan/schedules/${sch.id}/calculate`, {});
  const d = new DatabaseSync('data/e2e.sqlite'); d.exec('PRAGMA busy_timeout = 8000;'); const a = Object.fromEntries(d.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ?').all(sch.id).map((x) => [x.code, x.id]));
  d.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3', wbs_id = ? WHERE id = ?").run(w1, a.A10); d.prepare("UPDATE plan_activities SET qty = 50000, uom = 'm3', wbs_id = ? WHERE id = ?").run(w2, a.A20); d.prepare("UPDATE plan_activities SET act_type = 'MILESTONE', duration_days = 0, wbs_id = ? WHERE id = ?").run(w2, a.M1);
  d.prepare("UPDATE plan_schedules SET status = 'APPROVED', start_date = ? WHERE id = ?").run(ist(9), sch.id);
  d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(ist(-12), a.A10); d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(ist(-9), a.A20); d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(ist(-4), a.M1);
  const bud = Number(d.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, name, status, created_by, source_type) VALUES (?, ?, ?, ?, 'Budget', 'APPROVED', 'e2e', 'e2e')").run(c, `BUD/${T}`, ist(30), pid).lastInsertRowid);
  for (const [w, amt] of [[w1, 60_000_000], [w2, 40_000_000]]) d.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, wbs_id, resource_type, resource_name, amount, created_by, source_type) VALUES (?, ?, 'DIRECT', ?, 'OTHER', 'Work', ?, 'e2e', 'e2e')").run(c, bud, w, amt);
  const snap = { v: 1, activities: [{ code: 'A10', start: ist(9), finish: ist(-10) }, { code: 'A20', start: ist(4), finish: ist(-5) }, { code: 'M1', start: ist(3), finish: ist(3) }] };
  d.prepare("INSERT INTO plan_baselines (company_id, doc_no, doc_date, org_project_id, schedule_id, baseline_no, name, reason, snapshot_json, snapshot_hash, status, is_current, created_by, source_type) VALUES (?, ?, ?, ?, ?, 0, 'Baseline', 'Original', ?, 'h', 'APPROVED', 1, 'e2e', 'e2e')").run(c, `BL/${T}`, ist(20), pid, sch.id, JSON.stringify(snap));
  // the quantities of two approved reports (what the consumer of site.dpr.approved writes)
  for (const [code, qty] of [['A10', 50000], ['A20', 5000]]) { const did = Number(d.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, status, requested_by, project_id, site_id, created_by) VALUES (?, ?, ?, ?, ?, 'x', 'SITE', 'SUPERSEDED', 'x', ?, ?, 'e2e')").run(c, `DPR/${T}/${code}`, pid, site, ist(0), pid, site).lastInsertRowid); d.prepare("INSERT INTO prs_activity_progress (company_id, org_project_id, activity_id, activity_code, work_date, qty, cum_qty, pct_complete, source, dpr_id, dpr_scope, prog_site_id, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DPR', ?, 'SITE', ?, ?, 'e2e', 'site_dpr')").run(c, pid, a[code], code, ist(0), qty, qty, code === 'A10' ? 5000 : 1000, did, site, pid); }
  d.close(); return { u: (k) => `${t}-${k}`, pid };
}

test('a progress period is prepared, closed and shown on the dashboard, the report and the client report', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `p${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(request, c, t);
  const plan = await open(browser, info, c, 'PLAN', s.u('plan'), '/site/periods?new=1'); const p = plan.page; const errors = watch(p);
  await expect(p.getByTestId('per-form')).toBeVisible(); await p.getByTestId('per-project').selectOption({ index: 1 }); await expect(p.getByTestId('per-start')).toHaveValue(ist(9)); await p.getByTestId('per-type').selectOption('MONTH'); await p.getByTestId('per-cost').fill('420000');
  await p.getByTestId('per-adj-add').click(); await p.getByTestId('per-adj-code').selectOption({ index: 2 }); await p.getByTestId('per-adj-qty').fill('5'); await p.getByTestId('per-adj-reason').fill('x'); await p.getByTestId('per-send').click(); await expect(p.getByTestId('per-error')).toBeVisible(); await expect(p.getByText(/at least 5 characters/i).first()).toBeVisible();
  await p.getByTestId('per-adj-reason').fill('The measured sheet shows five cubic metres more'); await noOverflow(p); await shot(p, 'period-form', info); await p.getByTestId('per-send').click();
  await expect(p.getByTestId('per-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(p.getByTestId('per-physical')).toContainText('38'); await expect(p.getByTestId('per-planned')).toContainText('50'); await expect(p.getByTestId('per-spi')).toContainText('0.76'); const id = Number(new URL(p.url()).searchParams.get('id')); await noOverflow(p);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), `/site/periods?id=${id}`); await pm.page.getByTestId('per-comment').fill('checked'); await pm.page.getByTestId('per-approve').click(); await expect(pm.page.getByTestId('per-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(pm.page.getByTestId('per-locked')).toBeVisible(); await expect(pm.page.getByTestId('per-wbs-row')).toHaveCount(2); await shot(pm.page, 'period-closed', info); await pm.context.close();
  await p.goto(`/site/progress?projectId=${s.pid}`); await expect(p.getByTestId('prg-physical')).toContainText('38'); await expect(p.getByTestId('prg-spi')).toContainText('0.76'); await expect(p.getByTestId('prg-cpi')).toContainText('0.90'); await expect(p.getByTestId('prg-eac')).toBeVisible();
  await expect(p.getByTestId('prg-exception').first()).toBeVisible(); await expect(p.getByTestId('prg-wbs-row')).toHaveCount(2); await expect(p.getByTestId('prg-wbs-row').nth(1)).toHaveAttribute('data-behind', '1'); await expect(p.getByTestId('prg-milestone-row')).toContainText('M1'); await expect(p.getByTestId('prg-curve-panel').locator('svg[role="img"], svg').first()).toBeVisible(); expect(await p.getByTestId('prg-curve-panel').locator('path[stroke]').count()).toBeGreaterThanOrEqual(3);
  await p.getByTestId('prg-mode-financial').click(); await expect(p.getByTestId('prg-mode-financial')).toHaveAttribute('aria-pressed', 'true'); await noOverflow(p); await shot(p, 'dashboard', info);
  await p.getByTestId('prg-wbs-row').nth(1).getByRole('link').click(); await expect(p.getByTestId('site-progress-report')).toBeVisible(); await expect(p.getByTestId('rep-activity-row')).toHaveCount(2); await expect(p.getByTestId('rep-activity-row').first()).toContainText('A20');
  await p.getByTestId('rep-wbs').selectOption(''); await expect(p.getByTestId('rep-activity-row')).toHaveCount(3); await expect(p.getByTestId('rep-totals')).toContainText('38'); await noOverflow(p); await shot(p, 'report', info);
  await p.goto(`/site/client-progress?projectId=${s.pid}`); await expect(p.getByTestId('cli-report')).toHaveAttribute('data-live', '0'); await expect(p.getByTestId('cli-actual')).toContainText('38'); await expect(p.getByTestId('cli-wbs')).toContainText('Substructure'); await expect(p.getByTestId('cli-report')).not.toContainText('₹'); await noOverflow(p); await shot(p, 'client', info);
  // a construction manager sees percentages and no money
  const cm = await open(browser, info, c, 'CM', s.u('cm'), `/site/progress?projectId=${s.pid}`); await expect(cm.page.getByTestId('prg-spi')).toContainText('0.76'); await expect(cm.page.getByTestId('prg-cpi')).toHaveCount(0); await expect(cm.page.getByTestId('prg-eac')).toHaveCount(0); await expect(cm.page.getByTestId('prg-mode-financial')).toHaveCount(0);
  expect(errors).toEqual([]);
});
