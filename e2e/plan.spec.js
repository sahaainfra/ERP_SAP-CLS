import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100).
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
};
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' });
  return id;
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
const OUT = 'docs/erp/screenshots/plan';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['pcm', ['PCMGR']], ['pm', ['PM']], ['se', ['SE']], ['emp', ['EMP']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower A', 'BUILDING', 'ACTIVE')").run(c, `${t.toUpperCase()}-T`).lastInsertRowid);
  const w = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '2', 'Superstructure', 1, 'e2e')").run(c, pid).lastInsertRowid);
  for (const [i, code] of ['F1', 'F2', 'F3'].entries()) db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, sort_order, created_by) VALUES (?, ?, 'FLOOR', ?, ?, ?, 'e2e')").run(c, pid, code, `Floor ${i + 1}`, i + 1);
  db.close();
  return { u: (k) => `${t}-${k}`, pid, w };
}
async function approve(request, c, roles, user, instanceId) {
  const task = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows.find((x) => x.instance.id === instanceId); expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked' });
}

// Part 13.01: a planner drafts a calendar that the project controls manager puts in force; a schedule is created, activities are generated per floor from the RCC floor cycle, a link that would close a loop is refused with its path,
// the schedule is calculated on the server and shows its critical path; a selection is edited in bulk; progress is entered at a data date; the schedule is approved and locked; the float report shows the critical chain. A person without the right sees the no-permission state.
test('AC-01 schedule created from a template, linked, calculated with critical path and progress-updated, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = info.project.name === 'mobile' ? 'planm' : 'pland';
  const c = await company(request, t.toUpperCase()); const s = seed(c, t); const planner = s.u('plan');
  // the calendar: drafted on the page, put in force by the project controls manager
  const r = await open(browser, info, c, 'PLAN', planner, '/plan/calendars'); const errors = watch(r.page);
  await expect(r.page.getByRole('heading', { name: 'Work Calendars', level: 1 })).toBeVisible();
  await expect(r.page.getByTestId('pcal-empty')).toBeVisible();
  await r.page.getByTestId('pcal-code').fill('SIX'); await r.page.getByTestId('pcal-name').fill('Six-day week'); await r.page.getByTestId('pcal-reason').fill('The site works Monday to Saturday');
  await shot(r.page, 'calendar-draft', info); await noOverflow(r.page);
  await r.page.getByTestId('pcal-save').click(); await expect(r.page.locator('[data-testid="pcal-row"][data-status="DRAFT"]')).toHaveCount(1);
  await expect(r.page.getByTestId('pcal-activate')).toHaveCount(0);
  const k = await open(browser, info, c, 'PCMGR', s.u('pcm'), '/plan/calendars');
  await k.page.getByTestId('pcal-activate').click(); await expect(k.page.locator('[data-testid="pcal-row"][data-status="ACTIVE"]')).toHaveCount(1);
  await k.page.getByTestId('pcal-show').click(); await expect(k.page.getByTestId('pcal-day').first()).toBeVisible();
  // the schedule
  await r.page.goto('/plan/schedules'); await r.page.getByTestId('ps-new').click();
  await r.page.getByTestId('ps-project').selectOption(String(s.pid)); await r.page.getByTestId('ps-name').fill('Tower A working schedule');
  await expect(r.page.getByTestId('ps-calendar').locator('option')).toHaveCount(2); await r.page.getByTestId('ps-calendar').selectOption({ index: 1 }); await r.page.getByTestId('ps-start').fill('2026-04-06');
  await r.page.getByTestId('ps-save').click();
  await expect(r.page.getByTestId('plan-activities')).toHaveAttribute('data-status', 'DRAFT'); await expect(r.page.getByTestId('pa-empty')).toBeVisible();
  const scheduleId = Number(new URL(r.page.url()).searchParams.get('scheduleId'));
  // generate per floor from the RCC floor cycle
  await r.page.getByTestId('pa-generate').click(); await expect(r.page.getByRole('heading', { name: 'Generate Activities from Template', level: 1 })).toBeVisible();
  const tplOption = r.page.getByTestId('pg-template').locator('option', { hasText: 'STD-RCC-FLOOR' }); await r.page.getByTestId('pg-template').selectOption(await tplOption.getAttribute('value'));
  await r.page.getByTestId('pg-wbs').selectOption(String(s.w)); for (let i = 0; i < 3; i += 1) await r.page.getByTestId('pg-loc-pick').nth(i).check();
  await r.page.getByTestId('pg-preview').click(); await expect(r.page.getByTestId('pg-row')).toHaveCount(15); await expect(r.page.getByTestId('pg-run')).toContainText('15');
  await shot(r.page, 'generate-preview', info); await noOverflow(r.page);
  await r.page.getByTestId('pg-run').click(); await expect(r.page.getByTestId('pg-note')).toContainText('15'); await r.page.getByTestId('pg-open').click();
  await expect(r.page.getByTestId('pa-row')).toHaveCount(15); await expect(r.page.getByTestId('pa-needscalc')).toBeVisible();
  // a link that closes a loop is refused with its path
  await r.page.locator('[data-testid="pa-row"][data-code="F1-SHUT"]').getByTestId('pa-open').click();
  await r.page.getByTestId('pa-pred-pick').selectOption({ label: await r.page.getByTestId('pa-pred-pick').locator('option', { hasText: 'F3-DESH' }).innerText() });
  await r.page.getByTestId('pa-pred-add').click(); await expect(r.page.getByTestId('pa-error')).toContainText('Loop: F1-SHUT');
  // calculate: the critical path
  await r.page.getByTestId('pa-calc').click(); await expect(r.page.getByTestId('pa-note')).toBeVisible(); await expect(r.page.getByTestId('pa-needscalc')).toHaveCount(0);
  // the floors chain from concreting to the next shuttering: the curing and deshuttering of the first two floors have float
  await expect(r.page.locator('[data-testid="pa-row"][data-critical="1"]')).toHaveCount(11, { timeout: 10_000 });
  await expect(r.page.locator('[data-testid="pa-row"][data-code="F1-CURE"]')).toHaveAttribute('data-critical', '0');
  await shot(r.page, 'activities-calculated', info); await noOverflow(r.page);
  // bulk edit: the curing of every floor to 10 days
  for (const code of ['F1-CURE', 'F2-CURE', 'F3-CURE']) await r.page.locator(`[data-testid="pa-row"][data-code="${code}"]`).getByTestId('pa-select').check();
  await r.page.getByTestId('pa-bulk-duration').fill('10'); await r.page.getByTestId('pa-bulk-apply').click(); await expect(r.page.getByTestId('pa-note')).toContainText('3');
  const before = await r.page.getByTestId('pa-finish').innerText(); await r.page.getByTestId('pa-calc').click(); await expect(r.page.getByTestId('pa-finish')).not.toHaveText(before);
  await r.page.getByTestId('pa-filter').selectOption('critical'); await expect(r.page.locator('[data-testid="pa-row"][data-critical="0"]')).toHaveCount(0);
  await r.page.getByTestId('pa-filter').selectOption('all');
  // progress at a data date
  await r.page.getByTestId('pa-progress').click(); await r.page.getByTestId('pa-prog-date').fill('2026-04-10');
  const first = r.page.getByTestId('pa-prog-row').first(); await first.getByTestId('pa-prog-start').fill('2026-04-06'); await first.getByTestId('pa-prog-finish').fill('2026-04-08');
  await r.page.getByTestId('pa-prog-save').click(); await expect(r.page.getByTestId('pa-note')).toBeVisible(); await expect(r.page.getByTestId('pa-datadate')).not.toHaveText('—');
  // approval by the project controls manager; the logic is locked
  await r.page.getByTestId('pa-submit').click(); await expect(r.page.getByTestId('plan-activities')).toHaveAttribute('data-status', 'SUBMITTED');
  const sch = await api(request, c, 'PLAN', planner, 'get', `/plan/schedules/${scheduleId}`); await approve(request, c, 'PCMGR', s.u('pcm'), sch.workflowInstanceId);
  await r.page.reload(); await expect(r.page.getByTestId('plan-activities')).toHaveAttribute('data-status', 'APPROVED'); await expect(r.page.getByTestId('pa-locked')).toBeVisible(); await expect(r.page.getByTestId('pa-add')).toHaveCount(0);
  // the report
  await r.page.getByTestId('pa-report').click(); await expect(r.page.getByRole('heading', { name: 'Critical Path & Float Report', level: 1 })).toBeVisible();
  await expect(r.page.getByTestId('pc-paths')).toContainText('F3-CONC → F3-CURE → F3-DESH'); await expect(r.page.getByTestId('pc-paths')).not.toContainText('F1-SHUT'); // finished work is off the critical path await expect(r.page.getByTestId('pc-row').first()).toBeVisible();
  await shot(r.page, 'critical-report', info); await noOverflow(r.page);
  expect(errors, errors.join('\n')).toEqual([]);
  // a site engineer reads; an employee has no right
  const v = await open(browser, info, c, 'SE', s.u('se'), `/plan/activities?scheduleId=${scheduleId}`); await expect(v.page.getByTestId('pa-row').first()).toBeVisible(); await expect(v.page.getByTestId('pa-calc')).toHaveCount(0);
  const n = await open(browser, info, c, 'EMP', s.u('emp'), '/plan/schedules'); await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible(); await shot(n.page, 'no-permission', info);
});
