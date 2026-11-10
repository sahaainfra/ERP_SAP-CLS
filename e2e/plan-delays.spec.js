import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 13.05 in the browser (development-header mode, port 3100): the planner records a delay with its cause, responsibility and the activity it holds, links an RFI as evidence, analyses its
// time impact with a fragnet (the completion moves from 16 to 21 April) and sends the classification; the project manager and then the commercial manager approve it and it is locked; the summary
// shows it as excusable and compensable and opens it from its cell; the site engineer reads the register and changes nothing.
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
const OUT = 'docs/erp/screenshots/plan-delays';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['pcm', ['PCMGR']], ['pm', ['PM']], ['com', ['COMMGR']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower D', 'BUILDING', 'ACTIVE')").run(c, `${T}-D`).lastInsertRowid);
  db.prepare("INSERT INTO engg_rfis (company_id, rfi_no, org_project_id, subject, question, discipline, activity_ref, required_by, status) VALUES (?, ?, ?, 'Footing level', 'What is the footing level?', 'STRUCTURAL', 'A20', '2026-04-08', 'RESPONDED')").run(c, `${T}-RFI/1`, pid);
  db.close(); return { u: (k) => `${t}-${k}`, pid, T };
}
async function approve(request, c, roles, user, instanceId) {
  const task = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows.find((x) => x.instance.id === instanceId); expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked' });
}

test('AC-01 a delay is recorded with evidence and its time impact, approved and locked; the summary shows it for the claims', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `d${info.project.name[0]}${Date.now().toString(36).slice(-5)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t); const planner = s.u('plan'); const P = (m, path, data) => api(request, c, 'PLAN', planner, m, path, data);
  const cal = await P('post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); await api(request, c, 'PCMGR', s.u('pcm'), 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await P('post', '/plan/schedules', { projectId: s.pid, name: 'Tower D schedule', calendarId: cal.id, startDate: '2026-04-06' });
  await P('post', `/plan/schedules/${sch.id}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 5 }, { code: 'A20', name: 'PCC bed', duration: 3, predecessors: 'A10' }, { code: 'A30', name: 'Footing concrete', duration: 2, predecessors: 'A20' }] });
  await P('post', `/plan/schedules/${sch.id}/calculate`, {});

  // ---- the delay is recorded ----
  const r = await open(browser, info, c, 'PLAN', planner, '/plan/delays'); const errors = watch(r.page); const page = r.page;
  await expect(page.getByTestId('plan-delays')).toBeVisible(); await page.getByTestId('dl-new').click(); await page.getByTestId('dl-project').selectOption(String(s.pid));
  await page.getByTestId('dl-title').fill('Footing levels changed by the consultant'); await page.getByTestId('dl-cause').selectOption('LATE_DRAWINGS'); await page.getByTestId('dl-resp').selectOption('EMPLOYER');
  await page.getByTestId('dl-from').fill('2026-04-11'); await page.getByTestId('dl-to').fill('2026-04-15'); await expect(page.getByTestId('dl-days')).toContainText('5 days');
  await page.locator('[data-testid="dl-act"][data-code="A20"]').check(); await page.getByTestId('dl-mitigation').fill('Crew moved to the boundary wall'); await shot(page, 'new', info); await page.getByTestId('dl-save').click();
  await expect(page.getByTestId('dl-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(page.getByTestId('dl-affected')).toContainText('A20'); const id = Number(new URL(page.url()).searchParams.get('id'));
  // the evidence: the RFI
  await page.getByTestId('dl-ev-kind').selectOption('engg_rfi'); await page.getByTestId('dl-ev-pick').selectOption({ index: 1 }); await page.getByTestId('dl-ev-add').click(); await expect(page.getByTestId('dl-evidence-row')).toContainText('Footing level');
  // ---- the time impact: a 4-day redesign between A10 and A20 ----
  await page.getByTestId('dl-analyse').click(); await expect(page.getByTestId('tia-delay-line')).toBeVisible(); await page.getByTestId('tia-date').fill('2026-04-06');
  await page.getByTestId('tia-act-name').fill('Redesign of the footings'); await page.getByTestId('tia-act-dur').fill('4');
  const lk = page.getByTestId('tia-link'); await lk.nth(0).getByTestId('tia-link-pred').fill('A10'); await lk.nth(0).getByTestId('tia-link-succ').fill('F10'); await lk.nth(1).getByTestId('tia-link-pred').fill('F10'); await lk.nth(1).getByTestId('tia-link-succ').fill('A20');
  await page.getByTestId('tia-preview').click(); await expect(page.getByTestId('tia-before')).toContainText('16 Apr 2026'); await expect(page.getByTestId('tia-after')).toContainText('21 Apr 2026'); await expect(page.getByTestId('tia-impact')).toContainText('5 days (4 working days)');
  await expect(page.getByTestId('tia-moved-row')).toHaveCount(2); await shot(page, 'tia', info); await noOverflow(page);
  await page.getByTestId('tia-save').click(); await expect(page.getByTestId('dl-object')).toBeVisible(); await expect(page.getByTestId('dl-impact')).toContainText('5'); await expect(page.getByTestId('dl-tia-row')).toHaveCount(1);
  // ---- sent; the project manager and then the commercial manager approve ----
  await page.getByTestId('dl-submit').click(); await expect(page.getByTestId('dl-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(page.getByTestId('dl-edit')).toHaveCount(0);
  const d = await P('get', `/plan/delays/${id}`); await approve(request, c, 'PM', s.u('pm'), d.workflowInstanceId); await approve(request, c, 'COMMGR', s.u('com'), d.workflowInstanceId);
  await page.reload(); await expect(page.getByTestId('dl-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(page.getByTestId('dl-locked')).toBeVisible(); await expect(page.getByTestId('dl-analyse')).toHaveCount(0); await shot(page, 'approved', info); await noOverflow(page);
  // ---- the summary ----
  await page.goto('/plan/delay-summary'); await page.getByTestId('ds-project').selectOption(String(s.pid)); await expect(page.getByTestId('ds-count')).toHaveText('1');
  await expect(page.getByTestId('ds-excusable')).toHaveText('5'); await expect(page.getByTestId('ds-compensable')).toHaveText('5'); await expect(page.getByTestId('ds-non')).toHaveText('0');
  await page.getByTestId('ds-cell').first().click(); await expect(page.getByTestId('ds-drill-row')).toHaveCount(1); await expect(page.getByTestId('ds-export-xlsx')).toBeVisible(); await shot(page, 'summary', info); await noOverflow(page);
  expect(errors, errors.join('\n')).toEqual([]);
  // ---- the site engineer reads and changes nothing ----
  const v = await open(browser, info, c, 'SE', s.u('se'), `/plan/delays?id=${id}`); const e2 = watch(v.page);
  await expect(v.page.getByTestId('dl-object')).toHaveAttribute('data-status', 'APPROVED'); for (const k of ['dl-amend', 'dl-edit', 'dl-print', 'dl-ev-add']) await expect(v.page.getByTestId(k)).toHaveCount(0);
  await expect(v.page.getByTestId('dl-new')).toHaveCount(0, { timeout: 1000 }).catch(() => null); await v.page.goto('/plan/delays'); await expect(v.page.getByTestId('dl-new')).toHaveCount(0);
  await v.page.goto('/plan/delay-summary'); await expect(v.page.getByTestId('ds-count')).toBeVisible(); await expect(v.page.getByTestId('ds-export-xlsx')).toHaveCount(0);
  expect(e2, e2.join('\n')).toEqual([]);
});
