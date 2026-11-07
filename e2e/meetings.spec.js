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

const OUT = 'docs/erp/screenshots/meetings';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['pm', ['PM']], ['pm2', ['PM']], ['pd', ['PD']], ['se', ['SE']], ['plan', ['PLAN']], ['newbie', []]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Ring road package 2', 'ROAD')").run(c, `${t.toUpperCase()}-R`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (?, ?, 'e2e')").run(c, id);
  db.close();
  return { u: (k) => `${t}-${k}`, id };
}
const pick = async (page, id, text, name) => { await page.locator(`#${id}`).click(); await page.locator(`#${id}`).fill(text); await page.getByRole('option', { name }).first().click(); };
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

// Part 10.05: the project manager keeps the stakeholder register (an e-mail a site engineer does not see) and the communication matrix, asks for a team member (the project manager and the project director approve; the role engine is asked for the role),
// and the minute-taker writes the minutes of a meeting with attendees, agenda, decisions and actions and sends them to the chair; the chair issues them; the action is a task of its owner, who starts and finishes it from the meeting; the tracker shows it;
// the issued minutes are locked and corrected by a revision. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 team, stakeholders, communication matrix, minutes issued by the chair and actions tracked as tasks, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'MTM' : 'MTD');
  const t = phone ? 'mtm' : 'mtd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/proj/stakeholders?projectId=${g.id}`);
  const errors = watch(pm.page);
  // the stakeholder register and the communication matrix
  await expect(pm.page.getByTestId('stk-empty')).toBeVisible();
  await pm.page.getByTestId('stk-add').click(); await pm.page.getByTestId('stk-f-org').fill('Public Works Department'); await pm.page.getByTestId('stk-f-name').fill('A. Joshi'); await pm.page.getByTestId('stk-f-influence').selectOption('HIGH'); await pm.page.getByTestId('stk-f-interest').selectOption('HIGH'); await pm.page.getByTestId('stk-f-email').fill('a.joshi@pwd.example'); await pm.page.getByTestId('stk-save').click();
  await expect(pm.page.locator('[data-testid="stk-row"][data-name="A. Joshi"]')).toContainText('Manage closely'); await expect(pm.page.getByTestId('stk-email')).toContainText('a.joshi@pwd.example');
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '01-stakeholders');
  await pm.page.getByRole('tab', { name: /communication matrix/i }).click(); await pm.page.getByTestId('comm-add').click(); await pm.page.getByTestId('comm-f-info').fill('Weekly progress report'); await pm.page.getByTestId('comm-f-stakeholder').selectOption({ index: 1 }); await pm.page.getByTestId('comm-f-frequency').selectOption('WEEKLY'); await pm.page.getByTestId('comm-save').click();
  await expect(pm.page.getByTestId('comm-row')).toContainText('Weekly progress report'); await shot(pm.page, '02-communication-matrix');
  const se = await open(browser, info, c, 'SE', g.u('se'), `/proj/stakeholders?projectId=${g.id}`); const seErrors = watch(se.page);
  await expect(se.page.getByTestId('stk-email')).toHaveText(/hidden/i); await expect(se.page.getByTestId('stk-add')).toHaveCount(0);
  // the team: a request; the project manager (another) and the project director approve
  await pm.page.goto(`/proj/team?projectId=${g.id}`); await expect(pm.page.getByTestId('team-empty')).toBeVisible();
  await pm.page.getByTestId('team-add').click(); await pick(pm.page, 'team-user', `newbie ${t}`, new RegExp(`newbie ${t}`)); await pm.page.getByTestId('team-role').selectOption('QS'); await pm.page.getByTestId('team-reason').fill('The quantity surveyor of this project');
  await pm.page.getByTestId('team-send').click(); await expect(pm.page.locator('[data-testid="team-row"]')).toHaveAttribute('data-status', 'REQUESTED', { timeout: 15_000 });
  const team = await api(request, c, 'PM', g.u('pm'), 'get', `/proj/team?projectId=${g.id}`); const inst = team.members[0].workflowInstanceId;
  await decide(request, c, 'PM', g.u('pm2'), inst); await decide(request, c, 'PD', g.u('pd'), inst);
  await pm.page.reload(); await expect(pm.page.locator('[data-testid="team-row"]')).toHaveAttribute('data-status', 'APPROVED'); await expect(pm.page.getByTestId('team-access')).toContainText(/role engine/i);
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '03-team');
  // the meeting: created by the minute-taker, chaired by the project manager
  const mt = await open(browser, info, c, 'SE', g.u('se'), '/proj/meetings'); const mtErrors = watch(mt.page);
  await mt.page.getByTestId('mtg-new').click(); await mt.page.getByTestId('mtg-f-project').selectOption(String(g.id)); await mt.page.getByTestId('mtg-f-title').fill('Weekly progress meeting 12');
  await pick(mt.page, 'mtg-f-chair', `pm ${t}`, new RegExp(`pm ${t}`)); await pick(mt.page, 'mtg-f-taker', `se ${t}`, new RegExp(`se ${t}`)); await mt.page.getByTestId('mtg-f-create').click();
  await expect(mt.page.getByTestId('meeting')).toBeVisible({ timeout: 15_000 }); await expect(mt.page.getByTestId('meeting')).toHaveAttribute('data-status', 'DRAFT');
  const meetingId = Number(new URL(mt.page.url()).searchParams.get('id'));
  await mt.page.getByTestId('agenda-add').click(); await mt.page.getByTestId('agenda-0').fill('Progress against the look-ahead');
  await mt.page.getByTestId('mtg-e-minutes').fill('The earthwork is four days behind; a second excavator was agreed with the consultant for ten days.');
  await mt.page.getByTestId('decision-add').click(); await mt.page.getByTestId('decision-0').fill('Add a second excavator for ten days');
  await mt.page.getByRole('tab', { name: /attendees/i }).click(); await mt.page.getByTestId('att-add-internal').click(); await pick(mt.page, 'att-user-0', `se ${t}`, new RegExp(`se ${t}`)); await mt.page.getByTestId('att-add-external').click(); await mt.page.getByTestId('att-name-1').fill('R. Kulkarni');
  await mt.page.getByRole('tab', { name: /^Actions$/ }).click(); await mt.page.getByTestId('act-add').click(); await mt.page.getByTestId('act-desc-0').fill('Mobilise the second excavator'); await pick(mt.page, 'act-owner-0', `plan ${t}`, new RegExp(`plan ${t}`)); await mt.page.getByTestId('act-due-0').fill(day(3));
  await mt.page.getByTestId('mtg-save').click(); await expect(mt.page.getByTestId('mtg-note')).toBeVisible();
  if (phone) await noOverflow(mt.page);
  await shot(mt.page, '04-meeting-draft');
  await mt.page.getByTestId('mtg-submit').click(); await expect(mt.page.getByTestId('meeting')).toHaveAttribute('data-status', 'SUBMITTED', { timeout: 15_000 });
  const winst = (await api(request, c, 'SE', g.u('se'), 'get', `/proj/meetings/${meetingId}`)).workflowInstanceId;
  await decide(request, c, 'PM', g.u('pm'), winst);
  await mt.page.reload(); await expect(mt.page.getByTestId('meeting')).toHaveAttribute('data-status', 'APPROVED'); await expect(mt.page.getByTestId('mtg-issued')).toBeVisible();
  await mt.page.getByRole('tab', { name: /^Actions$/ }).click(); await expect(mt.page.getByTestId('act-view')).toContainText('Mobilise the second excavator'); await expect(mt.page.getByTestId('act-view')).toHaveAttribute('data-status', 'OPEN');
  await mt.page.getByRole('tab', { name: /attendees/i }).click(); await expect(mt.page.getByTestId('mtg-distribution')).toContainText('R. Kulkarni');
  await shot(mt.page, '05-meeting-issued');
  // the owner starts and finishes the action from the meeting; the task follows (T-01)
  const plan = await open(browser, info, c, 'PLAN', g.u('plan'), `/proj/meeting?id=${meetingId}`); const planErrors = watch(plan.page);
  const tasks = await api(request, c, 'PLAN', g.u('plan'), 'get', '/tsk/tasks?view=assigned&entity=proj_meeting'); expect(tasks.rows).toHaveLength(1); expect(tasks.rows[0].dueDate ?? tasks.rows[0].due_date).toBe(day(3));
  await plan.page.getByRole('tab', { name: /^Actions$/ }).click(); await plan.page.getByTestId('act-start-1').click(); await expect(plan.page.getByTestId('act-view')).toHaveAttribute('data-status', 'IN_PROGRESS');
  await plan.page.getByTestId('act-done-1').click(); await expect(plan.page.getByTestId('act-view')).toHaveAttribute('data-status', 'DONE');
  await plan.page.goto('/proj/action-tracker'); await expect(plan.page.getByTestId('trk-done')).toHaveText('1'); await expect(plan.page.getByTestId('trk-total')).toHaveText('1'); if (phone) await noOverflow(plan.page); await shot(plan.page, '06-action-tracker');
  // the issued minutes are locked; a revision corrects them
  await pm.page.goto(`/proj/meeting?id=${meetingId}`); await expect(pm.page.getByTestId('mtg-save')).toHaveCount(0); pm.page.on('dialog', (d) => d.accept('The due date of the action moved')); await pm.page.getByTestId('mtg-revise').click();
  await expect(pm.page.getByTestId('meeting')).toHaveAttribute('data-rev', '1', { timeout: 15_000 }); await expect(pm.page.getByTestId('meeting')).toHaveAttribute('data-status', 'DRAFT');
  await shot(pm.page, '07-meeting-revision');
  // a business developer sees the no-permission state
  const bd = await open(browser, info, c, 'BD', g.u('se'), `/proj/meeting?id=${meetingId}`); await expect(bd.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  expect([...errors, ...seErrors, ...mtErrors, ...planErrors]).toEqual([]);
});
