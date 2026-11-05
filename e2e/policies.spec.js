import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 05.01: the Messages app: a direct conversation started from the New page, messages with a file and a record card, the other person's list with an unread count, a reply
// that arrives without a reload, the three-pane layout on a computer and the single pane on a phone, the pop-out window and the dock over another page.
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
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/number-series', { docType: 'SAMPLE_DOC', name: 'Sample documents', prefix: 'SMP', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  return id;
}
// the people of the company: written straight into the throw-away database of the run (the dev-header mode has no sign-in to make them)
function people(c, list) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [name, roles, display] of list) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, name, display, JSON.stringify(roles), `${name}@example.com`);
  db.close();
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

// Part 05.05: company policies. The owner of a policy writes it (rich text, quiz, applicability), it is approved by the department head and the director, the employee acknowledges it with a knowledge check, the owner
// sees the percentage, revises it and compares the versions; a requirement becomes a draft control point that an administrator sees on the worklist and that is still inactive.
const act = async (request, c, roles, user, instanceId) => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked and fine' });
};


const IST = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
test('AC-01 AC-02 FR-01 FR-02 FR-03 FR-04 FR-07 a policy is written, approved, acknowledged with a quiz, revised and compared', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const c = await company(request, `PL${tag}`);
  const [hr, cfo, dir, e1, e2] = [`e2e-phr${t}`, `e2e-pcfo${t}`, `e2e-pdir${t}`, `e2e-pe1${t}`, `e2e-pe2${t}`];
  people(c, [[hr, ['HRMGR'], 'Hema HR'], [cfo, ['CFO'], 'Chandra CFO'], [dir, ['DIR'], 'Dina Director'], [e1, ['EMP'], 'Esha Employee'], [e2, ['EMP'], 'Eknath Employee']]);
  const a = await open(browser, info, c, 'HRMGR', hr, '/collab/policies');
  a.page.on('dialog', (d) => d.accept());
  const errors = watch(a.page);
  await expect(a.page.getByRole('heading', { name: 'Policy Register', level: 1 })).toBeVisible();
  await expect(a.page.getByText('No policy matches')).toBeVisible();
  await a.page.getByTestId('pr-new').click();
  await expect(a.page.getByRole('heading', { name: /Policy Editor/, level: 1 })).toBeVisible();
  await a.page.getByTestId('pe-title-input').fill('Leave policy');
  await a.page.getByTestId('pe-category').selectOption('HR');
  await a.page.getByTestId('rt-body').click();
  await a.page.keyboard.type('Every employee gets 24 days of leave a year. Leave is applied for in advance.');
  await a.page.getByTestId('pe-effective').fill(IST(0));
  await a.page.getByTestId('pe-review').fill(IST(365));
  await a.page.getByTestId('pe-role-EMP').check();
  await expect(a.page.getByTestId('pe-count')).toContainText('2 people', { timeout: 15_000 });
  await a.page.getByTestId('pe-add-q').click();
  await a.page.getByTestId('pe-q-0').fill('How many days of leave does an employee get a year?');
  await a.page.getByTestId('pe-q-0-o-0').fill('20');
  await a.page.getByTestId('pe-q-0-o-1').fill('24');
  await a.page.getByTestId('pe-q-0-c-1').check();
  await a.page.getByTestId('pe-save').click();
  await expect(a.page.getByTestId('pe-notice')).toContainText('Saved');
  await noOverflow(a.page);
  await a.page.getByTestId('pe-submit').click();
  await expect(a.page.getByTestId('policy-detail')).toBeVisible({ timeout: 20_000 });
  const pid = Number(new URL(a.page.url()).searchParams.get('id'));
  const reg = await api(request, c, 'HRMGR', hr, 'get', `/pol/policies/${pid}`);
  await act(request, c, 'CFO', cfo, reg.working.instanceId);
  await act(request, c, 'DIR', dir, reg.working.instanceId);
  await a.page.reload();
  await expect(a.page.getByTestId('pr-row')).toContainText('Active');
  await expect(a.page.getByTestId('pd-ack-row')).toHaveCount(2);

  // the employee: the policy is waiting; read it, fail the quiz, pass it
  const b = await open(browser, info, c, 'EMP', e1, '/collab/my-policies');
  errors.push(...watch(b.page));
  await expect(b.page.getByRole('heading', { name: 'My Policies', level: 1 })).toBeVisible();
  await expect(b.page.getByTestId('mp-row')).toContainText('Leave policy');
  await expect(b.page.getByTestId('mp-row')).toContainText('To acknowledge');
  await b.page.getByTestId('mp-open').click();
  await expect(b.page.getByTestId('reader-body')).toContainText('24 days of leave');
  await b.page.getByTestId('rd-q0-0').check();
  await b.page.getByTestId('reader-go').click();
  await expect(b.page.getByTestId('reader-wrong')).toBeVisible();
  await b.page.getByTestId('rd-q0-1').check();
  await b.page.getByTestId('reader-go').click();
  await expect(b.page.getByTestId('reader-done')).toContainText('knowledge check 100%');
  await noOverflow(b.page);
  await b.page.getByTestId('mp-tab-done').click();
  await expect(b.page.getByTestId('mp-row')).toContainText('Acknowledged');
  // an employee cannot open the register
  const n = await open(browser, info, c, 'EMP', e1, '/collab/policies');
  await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();

  // the owner: 50 per cent, then a new version through the approval, compared
  await a.page.reload();
  await expect(a.page.getByTestId('pr-row')).toContainText('50% of 2');
  await a.page.getByTestId('pd-revise').click();
  await expect(a.page.getByTestId('policy-editor')).toBeVisible();
  await a.page.getByTestId('rt-body').click();
  await a.page.keyboard.press('Control+End');
  await a.page.keyboard.type(' Unused leave is paid out at the end of the year.');
  await a.page.getByTestId('pe-change').fill('Unused leave is now paid out');
  await a.page.getByTestId('pe-effective').fill(IST(1));
  await a.page.getByTestId('pe-review').fill(IST(366));
  await a.page.getByTestId('pe-save').click();
  await expect(a.page.getByTestId('pe-notice')).toContainText('Saved');
  await a.page.getByTestId('pe-submit').click();
  await expect(a.page.getByTestId('policy-detail')).toBeVisible({ timeout: 20_000 });
  const v2 = await api(request, c, 'HRMGR', hr, 'get', `/pol/policies/${pid}`);
  await act(request, c, 'CFO', cfo, v2.working.instanceId);
  await act(request, c, 'DIR', dir, v2.working.instanceId);
  await a.page.reload();
  await expect(a.page.getByTestId('pd-version')).toHaveCount(2);
  await a.page.getByTestId('cmp-from').selectOption({ label: 'Version 1' });
  await a.page.getByTestId('cmp-to').selectOption({ label: 'Version 2' });
  await expect(a.page.getByTestId('diff')).toBeVisible();
  await expect(a.page.getByTestId('diff').locator('ins').first()).toContainText('Unused');
  await noOverflow(a.page);
  expect(errors).toEqual([]);
});

test('AC-01 AC-02 FR-05 BR-02 a requirement becomes a draft control point that stays inactive; the administrator sees it on the worklist', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const c = await company(request, `PD${tag}`);
  const [pr, cfo, dir, sys] = [`e2e-dpr${t}`, `e2e-dcfo${t}`, `e2e-ddir${t}`, `e2e-dsys${t}`];
  people(c, [[pr, ['PROCMGR'], 'Pramod Procurement'], [cfo, ['CFO'], 'Chandra CFO'], [dir, ['DIR'], 'Dina Director'], [sys, ['SYSADM'], 'Sam Admin'], [`e2e-demp${t}`, ['EMP'], 'Esha Employee']]);
  const made = await api(request, c, 'PROCMGR', pr, 'post', '/pol/policies', { title: 'Purchase policy', category: 'PROCUREMENT', body: '<p>A purchase above five lakh rupees needs the procurement manager.</p>', changeSummary: '', applicability: { roles: ['EMP'] }, effectiveFrom: IST(0), reviewDue: IST(300), quiz: [], passMark: 100, ackDueDays: 14 });
  const a = await open(browser, info, c, 'PROCMGR', pr, `/collab/policies/edit?id=${made.id}&tab=requirements`);
  a.page.on('dialog', (d) => d.accept());
  const errors = watch(a.page);
  await expect(a.page.getByTestId('requirements')).toBeVisible();
  await a.page.getByTestId('rq-clause').fill('4.2');
  await a.page.getByTestId('rq-text').fill('A purchase above five lakh needs the procurement manager');
  await a.page.getByTestId('rq-code').fill('CP-PROC-91');
  await a.page.getByTestId('rq-description').fill('A purchase above the limit needs the procurement manager');
  await a.page.getByTestId('rq-add').click();
  await expect(a.page.getByTestId('rq-row')).toContainText('4.2');
  // before approval it cannot be converted
  await expect(a.page.getByTestId('rq-convert')).toBeDisabled();
  const sub = await api(request, c, 'PROCMGR', pr, 'post', `/pol/versions/${made.working.id}/submit`, {});
  await act(request, c, 'CFO', cfo, sub.workflow.id);
  await act(request, c, 'DIR', dir, sub.workflow.id);
  await a.page.reload();
  await expect(a.page.getByTestId('pe-nodraft')).toBeVisible(); // the policy is approved: there is no draft to edit, the requirements remain
  await expect(a.page.getByTestId('rq-convert')).toBeEnabled();
  await a.page.getByTestId('rq-convert').click();
  await expect(a.page.getByTestId('rq-row')).toContainText('Draft: the control is OFF');
  await noOverflow(a.page);
  // the administrator's worklist
  const s = await open(browser, info, c, 'SYSADM', sys, '/admin/policy-drafts');
  errors.push(...watch(s.page));
  await expect(s.page.getByRole('heading', { name: 'Policy-to-Protocol Drafts', level: 1 })).toBeVisible();
  await expect(s.page.getByTestId('pdr-row')).toContainText('CP-PROC-91');
  await expect(s.page.getByTestId('pdr-row')).toContainText('Draft: the control is OFF');
  await expect(s.page.getByTestId('pdr-sum-draft')).toContainText('1');
  await noOverflow(s.page);
  const ctl = await open(browser, info, c, 'SYSADM', sys, '/admin/controls');
  await expect(ctl.page.getByText('CP-PROC-91').first()).toBeVisible({ timeout: 20_000 });
  // an employee has no worklist and no register
  const n = await open(browser, info, c, 'EMP', `e2e-demp${t}`, '/admin/policy-drafts');
  await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});
