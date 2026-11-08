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

const OUT = 'docs/erp/screenshots/submittal';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['qce', ['QCE']], ['qcm', ['QCMGR']], ['pm', ['PM']], ['bd', ['BD']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Flyover at the junction', 'ROAD')").run(c, `${t.toUpperCase()}-A`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, lifecycle_state, pm_user, created_by) VALUES (?, ?, 'EXECUTION', ?, 'e2e')").run(c, id, `${t}-pm`);
  db.close();
  return { u: (k) => `${t}-${k}`, project: id };
}
async function approve(request, c, roles, user, instanceId, action = 'approve') {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task of instance ${instanceId}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
}
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });

// Part 11.03: a quality control engineer prepares a material approval, attaches the datasheet and sends it; the quality control manager approves it inside; the consultant's response C (revise and resubmit) starts revision 2; revision 2 is approved internally and the
// response A makes the make an approved make that procurement reads (the purchase-order check passes for it and warns for another make). The schedule shows the submittal against its required date. A person without the right sees the no-permission state.
test('AC-01 a material approval reviewed through two cycles, approved make visible to procurement, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = info.project.name === 'mobile' ? 'sbm' : 'sbd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const qce = s.u('qce'); const qcm = s.u('qcm');
  const r = await open(browser, info, c, 'QCE', qce, '/engg/submittals');
  const errors = watch(r.page);
  await expect(r.page.getByRole('heading', { name: 'Submittal Register', level: 1 })).toBeVisible();
  await r.page.getByTestId('sub-new').click();
  await r.page.getByTestId('sub-f-project').selectOption(String(s.project));
  await r.page.getByTestId('sub-f-title').fill('OPC 53 grade cement for the foundation concrete');
  await r.page.getByTestId('sub-f-specSection').fill('03 30 00');
  await r.page.getByTestId('sub-f-materialRef').fill('OPC 53 cement');
  await r.page.getByTestId('sub-f-make').fill('UltraTech');
  await r.page.getByTestId('sub-f-model').fill('OPC 53');
  await shot(r.page, 'register-new', info);
  await noOverflow(r.page);
  await r.page.getByTestId('sub-create').click();
  await expect(r.page.getByTestId('submittal')).toBeVisible();
  await expect(r.page.getByTestId('submittal')).toHaveAttribute('data-status', 'DRAFT');
  const id = Number(new URL(r.page.url()).searchParams.get('id'));
  await r.page.getByTestId('sub-submit').click();
  await expect(r.page.getByTestId('sub-act-error')).toContainText('Attach the documents');
  await r.page.getByRole('tab', { name: 'Documents' }).click();
  await r.page.getByTestId('file-input').setInputFiles({ name: 'datasheet.png', mimeType: 'image/png', buffer: PNG });
  await expect(r.page.getByTestId('file-datasheet.png')).toBeVisible({ timeout: 20_000 });
  await r.page.getByTestId('sub-submit').click();
  await expect(r.page.getByTestId('sub-note')).toContainText('internal approval');
  await expect(r.page.getByTestId('submittal')).toHaveAttribute('data-status', 'SUBMITTED');
  const wf1 = (await api(request, c, 'QCE', qce, 'get', `/engg/submittals/${id}`)).workflowInstanceId;
  await approve(request, c, 'QCMGR', qcm, wf1);
  await r.page.reload();
  await expect(r.page.getByTestId('submittal')).toHaveAttribute('data-status', 'WITH_CONSULTANT');
  await shot(r.page, 'submittal-with-consultant', info);
  // the quality control manager records the consultant's response C
  const m = await open(browser, info, c, 'QCMGR', qcm, `/engg/submittal?id=${id}`);
  const e2 = watch(m.page);
  await m.page.getByTestId('sub-code').selectOption('C');
  await m.page.getByTestId('sub-record').click();
  await expect(m.page.getByTestId('sub-act-error')).toContainText('comments');
  await m.page.getByTestId('sub-comment').fill('Add the manufacturer test certificate for the 28-day strength');
  await m.page.getByTestId('sub-record').click();
  await expect(m.page.getByTestId('sub-note')).toContainText('response is recorded');
  await expect(m.page.getByTestId('submittal')).toHaveAttribute('data-status', 'REVISE');
  // the preparer resubmits: revision 2
  await r.page.reload();
  await r.page.getByTestId('sub-change').fill('Manufacturer test certificate added');
  await r.page.getByTestId('sub-resubmit').click();
  await expect(r.page.getByTestId('sub-note')).toContainText('new revision');
  await expect(r.page.getByTestId('submittal')).toHaveAttribute('data-revision', '2');
  await r.page.getByTestId('sub-submit').click();
  await expect(r.page.getByTestId('submittal')).toHaveAttribute('data-status', 'SUBMITTED');
  const wf2 = (await api(request, c, 'QCE', qce, 'get', `/engg/submittals/${id}`)).workflowInstanceId;
  await approve(request, c, 'QCMGR', qcm, wf2);
  await m.page.reload();
  await m.page.getByTestId('sub-code').selectOption('A');
  await m.page.getByTestId('sub-record').click();
  await expect(m.page.getByTestId('submittal')).toHaveAttribute('data-status', 'APPROVED');
  await expect(m.page.getByTestId('sub-make')).toContainText('UltraTech');
  await m.page.getByRole('tab', { name: 'Revisions and responses' }).click();
  await expect(m.page.getByTestId('sub-rev-1')).toContainText('C Revise and resubmit');
  await expect(m.page.getByTestId('sub-rev-2')).toContainText('A Approved');
  await shot(m.page, 'submittal-approved', info);
  await noOverflow(m.page);
  // procurement reads the approved make
  const ok = await api(request, c, 'PM', s.u('pm'), 'get', `/engg/submittals/po-check?projectId=${s.project}&material=${encodeURIComponent('OPC 53 cement')}&make=UltraTech`);
  expect([ok.status, ok.reason]).toEqual(['OK', 'APPROVED']);
  const no = await api(request, c, 'PM', s.u('pm'), 'get', `/engg/submittals/po-check?projectId=${s.project}&material=${encodeURIComponent('OPC 53 cement')}&make=Birla`);
  expect([no.status, no.reason]).toEqual(['WARN', 'MAKE_NOT_APPROVED']);
  // the schedule
  await m.page.goto('/engg/submittal-schedule');
  await expect(m.page.getByRole('heading', { name: 'Submittal Schedule vs Required Dates', level: 1 })).toBeVisible();
  await expect(m.page.getByTestId('ss-count-total')).toHaveAttribute('data-value', '1');
  await expect(m.page.getByTestId('ss-count-onTime')).toHaveAttribute('data-value', '1');
  await expect(m.page.getByTestId('ss-row-SUB-00001')).toHaveAttribute('data-state', 'ON_TIME');
  await shot(m.page, 'schedule', info);
  await noOverflow(m.page);
  await m.page.goto('/engg/submittals');
  await expect(m.page.getByText('SUB-00001').first()).toBeVisible();
  expect(errors).toEqual([]); expect(e2).toEqual([]);
});

test('AC-03 a person without the right sees the no-permission state', async ({ browser, request }, info) => {
  const t = info.project.name === 'mobile' ? 'sbn' : 'sbk';
  const c = await company(request, t.toUpperCase());
  seed(c, t);
  const { page } = await open(browser, info, c, 'BD', `${t}-bd`, '/engg/submittals');
  await expect(page.getByRole('heading', { name: /You do not have access/ })).toBeVisible();
  await expect(page.getByText('engg.submittal.view')).toBeVisible();
  await noOverflow(page);
});
