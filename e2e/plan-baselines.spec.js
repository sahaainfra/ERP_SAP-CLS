import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 13.03 in the browser (development-header mode, port 3100): the planner takes a baseline of the schedule and sends it; the project manager and then the project director approve it and it is the
// current, frozen baseline; the schedule moves on and the variance report shows what slipped, with its chart, filter, totals and export; the quality check lists its fourteen points and opens what a
// check found; the Gantt carries the baseline bars; a revision is started with its kind and reason; a file of MS Project is read, checked and applied to the working schedule of another project in the
// three steps of the wizard; the site engineer reads and changes nothing.
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
  const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
const OUT = 'docs/erp/screenshots/plan-baselines';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['pcm', ['PCMGR']], ['pm', ['PM']], ['pd', ['PD']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const project = (code, name) => {
    const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${t.toUpperCase()}-${code}`, name).lastInsertRowid);
    const w1 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '1', 'Substructure', 1, 'e2e')").run(c, pid).lastInsertRowid);
    db.prepare("INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (?, ?, ?, '1.1', 'Footings', 2, 'e2e')").run(c, pid, w1);
    db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '2', 'Superstructure', 1, 'e2e')").run(c, pid); return pid;
  };
  const out = { u: (k) => `${t}-${k}`, pid: project('B', 'Tower B'), pid2: project('C', 'Tower C') }; db.close(); return out;
}
async function approve(request, c, roles, user, instanceId) {
  const task = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows.find((x) => x.instance.id === instanceId); expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked' });
}

test('AC-01 baselines are approved and frozen; variance, quality, the baseline bars, a revision and the import of an MS Project file work', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `b${info.project.name[0]}${Date.now().toString(36).slice(-5)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t); const planner = s.u('plan'); const P = (m, path, data) => api(request, c, 'PLAN', planner, m, path, data);
  const cal = await P('post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); await api(request, c, 'PCMGR', s.u('pcm'), 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await P('post', '/plan/schedules', { projectId: s.pid, name: 'Tower B working schedule', calendarId: cal.id, startDate: '2026-04-06' });
  await P('post', `/plan/schedules/${sch.id}/import`, { rows: [
    { code: 'A10', name: 'Excavation', wbsCode: '1.1', duration: 5 }, { code: 'A20', name: 'PCC under footings', wbsCode: '1.1', duration: 3, predecessors: 'A10' }, { code: 'A30', name: 'Footing concrete', wbsCode: '1.1', duration: 2, predecessors: 'A20' },
    { code: 'A40', name: 'Ground floor columns', wbsCode: '2', duration: 4, predecessors: 'A30' }, { code: 'M50', name: 'Plinth complete', wbsCode: '2', type: 'MILESTONE', duration: 0, predecessors: 'A40' }] });
  await P('post', `/plan/schedules/${sch.id}/calculate`, {});
  const sch2 = await P('post', '/plan/schedules', { projectId: s.pid2, name: 'Tower C from the file', calendarId: cal.id, startDate: '2026-04-06' });

  // ---- a baseline is taken from the list page and sent ----
  const r = await open(browser, info, c, 'PLAN', planner, '/plan/baselines'); const errors = watch(r.page); const page = r.page;
  await expect(page.getByTestId('plan-baselines')).toBeVisible(); await page.getByTestId('bl-new').click();
  await page.getByTestId('bl-project').selectOption(String(s.pid)); await page.getByTestId('bl-schedule').selectOption(String(sch.id));
  await expect(page.getByTestId('bl-kind')).toHaveValue('Original programme'); await page.getByTestId('bl-name').fill('Contract programme'); await page.getByTestId('bl-reason').fill('The programme agreed with the client at award');
  await shot(page, 'new', info); await page.getByTestId('bl-save').click();
  await expect(page.getByTestId('bl-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(page.getByRole('heading', { level: 1 })).toContainText('Contract programme');
  const id = Number(new URL(page.url()).searchParams.get('id')); expect(id).toBeGreaterThan(0);
  await page.getByTestId('bl-submit').click(); await expect(page.getByTestId('bl-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(page.getByTestId('bl-edit')).toHaveCount(0);
  // ---- the manager, then the director: approved, current, frozen ----
  const b = await P('get', `/plan/baselines/${id}`); await approve(request, c, 'PM', s.u('pm'), b.workflowInstanceId); await approve(request, c, 'PD', s.u('pd'), b.workflowInstanceId);
  await page.reload(); await expect(page.getByTestId('bl-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(page.getByTestId('bl-current')).toBeVisible(); await expect(page.getByTestId('bl-frozen')).toBeVisible();
  await expect(page.getByTestId('bl-history')).toContainText('approve'); await expect(page.getByTestId('bl-compare-var')).toContainText('0'); await shot(page, 'approved', info); await noOverflow(page);
  // ---- the schedule moves on: the variance report ----
  const acts = (await P('get', `/plan/schedules/${sch.id}/activities?pageSize=1000`)).rows; await P('patch', `/plan/activities/${acts.find((a) => a.code === 'A20').id}`, { duration: 7 }); await P('post', `/plan/schedules/${sch.id}/calculate`, {});
  await page.goto(`/plan/variance?baselineId=${id}`); await expect(page.getByRole('heading', { name: 'Variance and Quality', level: 1 })).toBeVisible();
  await expect(page.getByTestId('var-finish-var')).toContainText('+'); await expect(page.getByTestId('var-row')).toHaveCount(5); await expect(page.getByTestId('var-bars')).toBeVisible(); await expect(page.getByTestId('var-buckets')).toBeVisible();
  await expect(page.getByTestId('var-row').first().getByTestId('var-fv')).toContainText('+'); await shot(page, 'variance', info); await noOverflow(page);
  await page.getByTestId('var-only').selectOption('milestones'); await expect(page.getByTestId('var-row')).toHaveCount(1); await expect(page.getByTestId('var-row')).toHaveAttribute('data-code', 'M50');
  await page.getByTestId('var-only').selectOption('slipped'); await expect(page.getByTestId('var-row')).toHaveCount(4);
  const dl = page.waitForEvent('download'); await page.getByTestId('var-export-xlsx').click(); expect((await dl).suggestedFilename()).toMatch(/^variance-.*\.xlsx$/);
  // ---- the quality check of the same schedule ----
  await page.getByTestId('var-schedule').selectOption(String(sch.id)); await page.getByTestId('var-tab-quality').click();
  await expect(page.getByTestId('q-row')).toHaveCount(14); await expect(page.locator('[data-testid="q-row"][data-code="RESOURCES"]')).toHaveAttribute('data-status', 'NA'); await expect(page.locator('[data-testid="q-row"][data-code="LOGIC"]')).toHaveAttribute('data-status', 'PASS');
  await expect(page.getByTestId('q-failed')).toHaveText('0'); await page.getByTestId('q-longduration').fill('5'); await expect(page.locator('[data-testid="q-row"][data-code="HIGH_DURATION"]')).toHaveAttribute('data-status', 'FAIL');
  await page.locator('[data-testid="q-row"][data-code="HIGH_DURATION"]').getByTestId('q-drill').click(); await expect(page.getByTestId('q-drill-row')).toHaveCount(1); await expect(page.getByTestId('q-drill-row')).toContainText('A20');
  await shot(page, 'quality', info); await noOverflow(page);
  // ---- the Gantt carries the bars of the current baseline ----
  await page.goto(`/plan/gantt?scheduleId=${sch.id}`); await expect(page.getByTestId('pgt-baseline')).toBeChecked(); await expect(page.getByTestId('pgt-base')).toHaveCount(4);
  await page.getByTestId('pgt-baseline').uncheck(); await expect(page.getByTestId('pgt-base')).toHaveCount(0); await page.getByTestId('pgt-baseline').check(); await shot(page, 'gantt-baseline', info);
  // ---- a revision: its kind, reason and summary; the change against the current baseline is worked out ----
  await page.goto(`/plan/baselines?id=${id}`); await page.getByTestId('bl-amend').click(); await page.getByTestId('bl-amend-kind').selectOption('EOT');
  await page.getByTestId('bl-amend-reason').fill('Extension of time 1 for the late drawings'); await page.getByTestId('bl-amend-summary').fill('PCC under footings four days longer'); await page.getByTestId('bl-amend-save').click();
  await expect(page.getByTestId('bl-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(page.getByTestId('bl-change')).toBeVisible(); await expect(page.getByTestId('bl-change-finish')).toContainText('+'); await expect(page.getByTestId('bl-others')).toContainText('Extension of time');
  await shot(page, 'revision', info); await noOverflow(page);
  // ---- the import wizard: the schedule written as an MS Project file is read into the blank schedule of the other project ----
  const file = await request.get(`/api/v1/plan/schedules/${sch.id}/exchange?format=msp`, { headers: H('PLAN', c, planner) }); expect(file.status()).toBe(200);
  await page.goto(`/plan/import?scheduleId=${sch2.id}`); await expect(page.getByRole('heading', { name: 'Import Schedule', level: 1 })).toBeVisible(); await expect(page.getByTestId('imp-read')).toBeDisabled();
  await page.getByTestId('imp-file').setInputFiles({ name: 'tower-b.xml', mimeType: 'application/xml', buffer: await file.body() }); await page.getByTestId('imp-read').click();
  await expect(page.getByTestId('imp-current')).toHaveAttribute('data-status', 'ANALYSED'); await expect(page.getByTestId('imp-n-acts')).toHaveText('5'); await expect(page.getByTestId('imp-ok')).toBeVisible();
  await expect(page.getByTestId('imp-cal-map')).toHaveValue(String(cal.id)); await expect(page.getByTestId('imp-wbs-map')).toHaveCount(3); await expect(page.getByTestId('imp-codefrom')).toHaveValue('TEXT1');
  await page.getByTestId('imp-mode').selectOption('MERGE'); await expect(page.getByTestId('imp-mode')).toHaveValue('MERGE'); await page.getByTestId('imp-mode').selectOption('REPLACE'); await expect(page.getByTestId('imp-mode')).toHaveValue('REPLACE');
  await shot(page, 'import-mapping', info); await noOverflow(page);
  await page.getByTestId('imp-apply').click(); await expect(page.getByTestId('imp-current')).toHaveAttribute('data-status', 'IMPORTED'); await expect(page.getByTestId('imp-created')).toHaveText('5'); await expect(page.getByTestId('imp-differ')).toHaveText('0 / 5');
  await expect(page.getByTestId('imp-list')).toContainText('tower-b.xml'); await shot(page, 'import-applied', info); await noOverflow(page);
  expect((await P('get', `/plan/schedules/${sch2.id}`)).activities).toBe(5);
  // a file that is no schedule is refused with its reason
  await page.getByTestId('imp-file').setInputFiles({ name: 'notes.xml', mimeType: 'application/xml', buffer: Buffer.from('just some notes') }); await page.getByTestId('imp-read').click(); await expect(page.getByTestId('imp-error')).toContainText('not MS Project XML');
  expect(errors, errors.join('\n')).toEqual([]);

  // ---- the site engineer reads the baseline and the variance and changes nothing; the import is not theirs ----
  const v = await open(browser, info, c, 'SE', s.u('se'), `/plan/baselines?id=${id}`); const e2 = watch(v.page);
  await expect(v.page.getByTestId('bl-object')).toHaveAttribute('data-status', 'APPROVED'); for (const k of ['bl-amend', 'bl-edit', 'bl-submit', 'bl-print', 'bl-file-msp']) await expect(v.page.getByTestId(k)).toHaveCount(0);
  await v.page.goto(`/plan/variance?baselineId=${id}`); await expect(v.page.getByTestId('var-row').first()).toBeVisible(); await expect(v.page.getByTestId('var-export-xlsx')).toHaveCount(0);
  await v.page.goto(`/plan/import?scheduleId=${sch2.id}`); await expect(v.page.getByTestId('imp-read')).toHaveCount(0);
  expect(e2, e2.join('\n')).toEqual([]);
});
