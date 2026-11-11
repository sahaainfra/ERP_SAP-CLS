import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 14.06 in the browser (development-header mode, port 3100): project controls enter a productivity norm and the project manager approves it (maker-checker); the records of three days are scored against it, the
// dashboard shows the efficiency, the weekly trend, the worst performer, the alert and the loss reasons; the site engineer records a loss and the report puts the shortfall to it; a quantity surveyor reads only.
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
const OUT = 'docs/erp/screenshots/site-productivity';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const ist = (n) => new Date(Date.now() + 19_800_000 - n * 86_400_000).toISOString().slice(0, 10);

async function seed(request, c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['pcm', ['PCMGR']], ['pm', ['PM']], ['se', ['SE']], ['qs', ['QS']], ['plan', ['PLAN']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower Q', 'BUILDING', 'ACTIVE')").run(c, `${T}-Q`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower Q site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const crew = Number(db.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (?, ?, ?, 'Masons one', 'Mason')").run(c, site, `${T}-M1`).lastInsertRowid);
  db.close();
  const cal = await api(request, c, 'PLAN', `${t}-plan`, 'post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); await api(request, c, 'PCMGR', `${t}-pcm`, 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await api(request, c, 'PLAN', `${t}-plan`, 'post', '/plan/schedules', { projectId: pid, name: 'Schedule', calendarId: cal.id, startDate: '2026-04-06' });
  await api(request, c, 'PLAN', `${t}-plan`, 'post', `/plan/schedules/${sch.id}/import`, { rows: [{ code: 'A10', name: 'Brickwork', duration: 10 }] });
  const d = new DatabaseSync('data/e2e.sqlite'); d.exec('PRAGMA busy_timeout = 8000;'); const a10 = d.prepare('SELECT id FROM plan_activities WHERE schedule_id = ? AND code = ?').get(sch.id, 'A10').id;
  d.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3' WHERE id = ?").run(a10); d.prepare("UPDATE plan_schedules SET status = 'APPROVED' WHERE id = ?").run(sch.id);
  // the records of three approved reports: 5 m3 over 5 man-days each day (1 m3 a man-day), with the reports behind them
  for (const n of [3, 2, 1]) { const did = Number(d.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, status, requested_by, project_id, site_id, created_by) VALUES (?, ?, ?, ?, ?, 'x', 'SITE', 'SUPERSEDED', 'x', ?, ?, 'e2e')").run(c, `DPR/${T}/${n}`, pid, site, ist(n), pid, site).lastInsertRowid);
    d.prepare("INSERT INTO prod_actuals (company_id, org_project_id, prod_site_id, work_date, activity_id, activity_code, work_type, crew_id, dpr_id, dpr_scope, qty, uom, man_days, alloc_basis, productivity, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'A10', 'UOM:m3', ?, ?, 'SITE', 5000, 'm3', 5000, 'WA', 1000, ?, 'e2e', 'site_dpr')").run(c, pid, site, ist(n), a10, crew, did, pid); }
  d.close(); return { u: (k) => `${t}-${k}`, pid };
}

test('a norm is entered and approved, the records are scored, and the dashboard and the report explain the losses', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `q${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(request, c, t);
  const pcm = await open(browser, info, c, 'PCMGR', s.u('pcm'), '/site/productivity'); const p = pcm.page; const errors = watch(p);
  await expect(p.getByTestId('site-productivity')).toBeVisible(); await expect(p.getByTestId('pd-efficiency')).toContainText('—'); await expect(p.getByTestId('pd-alerts-count')).toContainText('0');
  await p.goto('/site/productivity-norms?new=1'); await p.getByTestId('norm-project').selectOption({ index: 1 }); await p.getByTestId('norm-activity').selectOption({ index: 1 }); await p.getByTestId('norm-output').fill('1.5'); await p.getByTestId('norm-from').fill(ist(30)); await noOverflow(p); await shot(p, 'norm-form', info); await p.getByTestId('norm-save').click();
  await expect(p.getByTestId('norm-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(p.getByTestId('norm-value')).toContainText('1.5'); const nid = Number(new URL(p.url()).searchParams.get('id')); await p.getByTestId('norm-submit').click(); await expect(p.getByTestId('norm-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const pm = await open(browser, info, c, 'PM', s.u('pm'), `/site/productivity-norms?id=${nid}`); await pm.page.getByTestId('norm-comment').fill('checked'); await pm.page.getByTestId('norm-approve').click(); await expect(pm.page.getByTestId('norm-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(pm.page.getByTestId('norm-locked')).toBeVisible(); await shot(pm.page, 'norm', info); await pm.context.close();
  await p.goto(`/site/productivity?projectId=${s.pid}`); await expect(p.getByTestId('pd-efficiency')).toContainText('66.67'); await expect(p.getByTestId('pd-lost')).toContainText('5'); await expect(p.getByTestId('pd-alerts-count')).toContainText('1'); await expect(p.getByTestId('pd-alert')).toContainText('A10'); await expect(p.getByTestId('pd-worst-row').first()).toContainText('A10');
  await expect(p.getByTestId('pd-crew-row')).toContainText('Masons one'); await expect(p.getByTestId('pd-reasons')).toContainText(/Not explained/); expect(await p.getByTestId('pd-trend').locator('path[stroke]').count()).toBeGreaterThanOrEqual(1); await noOverflow(p); await shot(p, 'dashboard', info);
  // the site engineer records the weather as the loss of the three days; the report puts the shortfall to it
  const se = await open(browser, info, c, 'SE', s.u('se'), `/site/productivity-report?projectId=${s.pid}`); const sp = se.page; const se_errors = watch(sp);
  await expect(sp.getByTestId('pr-group-row')).toHaveCount(1); await sp.getByTestId('pr-loss-site').selectOption({ index: 1 }); await sp.getByTestId('pr-loss-date').fill(ist(2)); await sp.getByTestId('pr-loss-reason').selectOption('MATERIAL_SHORTAGE'); await sp.getByTestId('pr-loss-hours').fill('4'); await sp.getByTestId('pr-loss-save').click();
  await expect(sp.getByTestId('pr-loss-row')).toHaveCount(1); await expect(sp.getByTestId('pr-reasons')).toContainText('Material shortage'); await expect(sp.getByTestId('pr-reasons')).toContainText('Not explained'); await expect(sp.getByTestId('pr-totals')).toContainText('66.67'); await sp.getByTestId('pr-groupby').selectOption('CREW'); await expect(sp.getByTestId('pr-group-row').first()).toContainText('Masons one');
  await expect(sp.getByTestId('pr-benchmark').first()).toBeVisible(); await expect(sp.getByTestId('pr-records')).toBeVisible(); await sp.getByTestId('pr-records').getByRole('link').click(); await expect(sp.getByTestId('site-productivity-records')).toBeVisible(); await expect(sp.getByTestId('list-site.productivity')).toBeVisible(); await expect(sp.getByRole('alert')).toHaveCount(0); await sp.goBack(); await noOverflow(sp); await shot(sp, 'report', info); expect(se_errors).toEqual([]);
  // a quantity surveyor reads and cannot record or configure
  const qs = await open(browser, info, c, 'QS', s.u('qs'), `/site/productivity-report?projectId=${s.pid}`); await expect(qs.page.getByTestId('pr-groups')).toBeVisible(); await expect(qs.page.getByTestId('pr-loss-form')).toHaveCount(0);
  await qs.page.goto('/site/productivity-norms'); await expect(qs.page.getByTestId('norm-boq')).toHaveCount(0); expect(errors).toEqual([]);
});
