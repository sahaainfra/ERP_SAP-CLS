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
// the people and the organisation of the company: written straight into the throw-away database of the run
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  const people = [['hr', ['HRMGR']], ['hr2', ['HRMGR']], ['dir', ['DIR']], ['pm', ['PM']], ['cm', ['CM']], ['cm2', ['CM']], ['it', ['ITADM']], ['hseo', ['HSEO']], ['pay', ['PAY']], ['se', ['SE']]];
  for (const [n, roles] of people) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const dept = one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ENG', 'Engineering', 'e2e', 'e2e')", c);
  const des = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SE', 'Site Engineer', 'G3', 3, 'e2e', 'e2e')", c);
  db.close();
  return { dept, des, u: (k) => `${t}-${k}` };
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
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked it' });
};
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const OUT = 'docs/erp/screenshots/recruitment';

// Part 07.02: recruitment. A hiring manager raises a requisition (the plan check shown as it is typed); the project head and the HR manager approve; HR adds a candidate on the board and moves it; interviews and the pass by the
// panel; the offer builder shows the breakup and who approves; the candidate accepts through the link and gives the joining details; HR converts the candidate to an employee, and the joining checklist reaches the departments.
// On a computer and a phone; screenshots for the report.
test('AC-01 requisition, candidate, interview, offer, acceptance by link, joining, employee and checklist, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'RCM' : 'RCD');
  const g = seed(c, phone ? 'rcm' : 'rcd');
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  await api(request, c, 'HRMGR', g.u('hr'), 'put', '/hr/plans', { departmentId: g.dept, designationId: g.des, approvedPositions: 5, validFrom: '2026-04-01', reason: 'Approved headcount of the year' });
  // the hiring manager raises the requisition on the form
  const cm = await open(browser, info, c, 'CM', g.u('cm'), '/hr/requisitions/new');
  const errors = watch(cm.page);
  await cm.page.locator('#nr-department').click(); await cm.page.getByRole('option', { name: /Engineering/ }).click();
  await cm.page.locator('#nr-designation').click(); await cm.page.getByRole('option', { name: /Site Engineer/ }).first().click();
  await cm.page.getByTestId('nr-positions').fill('2');
  await cm.page.getByTestId('nr-ctc-min').fill('600000');
  await cm.page.getByTestId('nr-ctc-max').fill('900000');
  await cm.page.getByTestId('nr-why').fill('A new package of work needs two more site engineers');
  await expect(cm.page.getByTestId('nr-plan')).toContainText('Within the headcount plan');
  if (phone) await noOverflow(cm.page);
  await shot(cm.page, '01-new-requisition');
  await cm.page.getByTestId('nr-send').click();
  await expect(cm.page.getByTestId('rp-sent')).toBeVisible();
  const reqId = Number(new URL(cm.page.url()).searchParams.get('id'));
  const req = await api(request, c, 'CM', g.u('cm'), 'get', `/hr/requisitions/${reqId}`);
  await act(request, c, 'PM', g.u('pm'), req.instanceId);
  await act(request, c, 'HRMGR', g.u('hr2'), req.instanceId);
  await cm.page.reload();
  await expect(cm.page.getByTestId('requisition-page')).toContainText('Approved');
  await shot(cm.page, '02-requisition');
  // HR: the candidate on the board
  const hr = await open(browser, info, c, 'HRMGR', g.u('hr'), `/hr/recruitment?requisitionId=${reqId}`);
  await hr.page.getByTestId('cp-add').click();
  await hr.page.getByTestId('cp-add-req').selectOption(String(reqId));
  await hr.page.getByTestId('cp-add-name').fill('Rakesh Kulkarni');
  await hr.page.getByTestId('cp-add-mobile').fill('9876500011');
  await hr.page.getByTestId('cp-add-source').selectOption('REFERRAL');
  await hr.page.getByTestId('cp-add-expected').fill('850000');
  await hr.page.getByTestId('cp-add-go').click();
  await expect(hr.page.getByTestId('candidate-page')).toContainText('Rakesh Kulkarni');
  const candId = Number(new URL(hr.page.url()).searchParams.get('id'));
  await hr.page.goto(`/hr/recruitment?requisitionId=${reqId}`);
  await expect(hr.page.getByTestId('cp-col-APPLIED')).toContainText('Rakesh Kulkarni');
  await hr.page.getByTestId('cp-move').selectOption('SCREENED');
  await expect(hr.page.getByTestId('cp-col-SCREENED')).toContainText('Rakesh Kulkarni');
  await expect(hr.page.getByTestId('cp-undo')).toBeVisible();
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '03-candidate-pipeline');
  // the interview by the panel
  const iv = await api(request, c, 'HRMGR', g.u('hr'), 'post', `/hr/candidates/${candId}/interviews`, { scheduledAt: `${day(2)}T10:30`, panel: [g.u('cm'), g.u('cm2')] });
  const cmPage = await open(browser, info, c, 'CM', g.u('cm'), `/hr/recruitment/candidate?id=${candId}&tab=interviews`);
  await cmPage.page.getByTestId('cd-feedback-open').click();
  await cmPage.page.getByTestId('cd-fb-technical').fill('5');
  await cmPage.page.getByTestId('cd-fb-save').click();
  await expect(cmPage.page.getByTestId('cd-iv-note')).toContainText('Feedback saved');
  await expect(cmPage.page.getByTestId('candidate-page')).not.toContainText('850000');
  await api(request, c, 'CM', g.u('cm2'), 'post', `/hr/interviews/${iv.id}/feedback`, { scores: { technical: 4 }, recommendation: 'PASS' });
  await hr.page.goto(`/hr/recruitment/candidate?id=${candId}&tab=interviews`);
  await expect(hr.page.getByTestId('cd-result').first()).toContainText('pass');
  await shot(hr.page, '04-candidate-interviews');
  const cand = await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/candidates/${candId}`);
  await api(request, c, 'HRMGR', g.u('hr'), 'post', `/hr/candidates/${candId}/stage`, { stage: 'SELECTED', version: cand.rowVersion });
  // the offer builder: breakup and who approves
  await hr.page.goto(`/hr/offers/offer?candidateId=${candId}`);
  await hr.page.locator('#ob-designation').click(); await hr.page.getByRole('option', { name: /Site Engineer/ }).first().click();
  await hr.page.getByTestId('ob-ctc').fill('950000');
  await expect(hr.page.getByTestId('ob-route')).toContainText('director also approves');
  await hr.page.getByTestId('ob-ctc').fill('800000');
  await expect(hr.page.getByTestId('ob-route')).toContainText('HR manager approves');
  await expect(hr.page.getByTestId('ob-breakup')).toContainText('Basic salary');
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '05-offer-builder');
  await hr.page.getByTestId('ob-submit').click();
  await expect(hr.page.getByTestId('ob-facts')).toBeVisible();
  const offerId = Number(new URL(hr.page.url()).searchParams.get('id'));
  const offer = await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/offers/${offerId}`);
  await act(request, c, 'HRMGR', g.u('hr2'), offer.instanceId);
  await hr.page.reload();
  await hr.page.getByTestId('ob-send-link').click();
  const link = (await hr.page.getByTestId('ob-link').locator('code').innerText()).trim();
  // the candidate opens the link: no sign-in
  const { baseURL, viewport, hasTouch } = info.project.use;
  const ctx = await browser.newContext({ baseURL, viewport, hasTouch });
  const cp = await ctx.newPage();
  const cerrors = watch(cp);
  await cp.goto(new URL(link).pathname + new URL(link).search);
  await expect(cp.getByTestId('or-summary')).toContainText('Site Engineer');
  await shot(cp, '06-offer-link');
  await cp.getByTestId('or-accept').click();
  await expect(cp.getByTestId('or-accepted')).toBeVisible();
  await cp.getByTestId('pj-gender').selectOption('MALE');
  await cp.getByTestId('pj-dob').fill('1991-05-17');
  await cp.locator('[data-testid="pj-address"] input').first().fill('12 Shivaji Nagar');
  await cp.getByTestId('contact-name').first().fill('Sunita Kulkarni');
  await cp.getByTestId('contact-relation').first().fill('Spouse');
  await cp.getByTestId('contact-phone').first().fill('9876500022');
  await cp.getByTestId('pj-pan').fill('ABCPK1234F');
  await cp.getByTestId('pj-aadhaar').fill('123456789012');
  await cp.getByTestId('pj-acct').fill('123456789012');
  await cp.getByTestId('pj-ifsc').fill('SBIN0001234');
  await cp.getByTestId('pj-save').click();
  await expect(cp.getByTestId('pj-note')).toBeVisible();
  if (phone) await noOverflow(cp);
  expect(cerrors).toEqual([]);
  // HR: the checks, then the conversion
  await hr.page.goto(`/hr/recruitment/candidate?id=${candId}&tab=prejoining`);
  await expect(hr.page.getByTestId('cd-pj-state')).toContainText('The details are in');
  await hr.page.getByTestId('cd-bgv').selectOption('CLEAR');
  await hr.page.getByTestId('cd-medical').selectOption('FIT');
  await hr.page.waitForTimeout(600);
  await shot(hr.page, '07-candidate-prejoining');
  await hr.page.getByTestId('cd-join').click();
  await expect(hr.page.getByTestId('cd-note')).toContainText('was created and sent for approval');
  const done = await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/candidates/${candId}`);
  const emp = await api(request, c, 'HRMGR', g.u('hr'), 'get', `/hr/employees/${done.employeeId}`);
  expect(emp.name).toBe('Rakesh Kulkarni');
  expect(emp.statutory.pan).toBe('ABCPK1234F');
  await act(request, c, 'HRMGR', g.u('hr2'), emp.instanceId);
  // the joining checklist: the departments' own tasks
  const itp = await open(browser, info, c, 'ITADM', g.u('it'), '/hr/onboarding');
  await expect(itp.page.getByTestId('on-row')).toHaveCount(1);
  await expect(itp.page.getByTestId('on-row')).toContainText('IT access');
  await shot(itp.page, '08-onboarding-it');
  await hr.page.goto('/hr/onboarding');
  await expect(hr.page.getByTestId('on-row')).toHaveCount(6);
  if (phone) await noOverflow(hr.page);
  await shot(hr.page, '09-onboarding-hr');
  const se = await open(browser, info, c, 'SE', g.u('se'), '/hr/onboarding');
  await expect(se.page.getByTestId('no-permission')).toBeVisible();
  expect(errors).toEqual([]);
});
