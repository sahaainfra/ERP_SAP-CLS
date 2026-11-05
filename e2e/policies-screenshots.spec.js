import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 05.01: the Messages app: a direct conversation started from the New page, messages with a file and a record card, the other person's list with an unread count, a reply
// that arrives without a reload, the three-pane layout on a computer and the single pane on a phone, the pop-out window and the dock over another page.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
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

// Screenshots of the 05.05 pages for docs/erp/screenshots/policies. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/policies';
const act = async (request, c, roles, user, instanceId) => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked and fine' });
};



const IST = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
test('screenshots of the policy pages', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, `PS${tag}`);
  const [hr, pr, cfo, dir, sys, e1, e2, e3] = [`shot-phr${t}`, `shot-ppr${t}`, `shot-pcfo${t}`, `shot-pdir${t}`, `shot-psys${t}`, `shot-pe1${t}`, `shot-pe2${t}`, `shot-pe3${t}`];
  people(c, [[hr, ['HRMGR'], 'Hema HR'], [pr, ['PROCMGR'], 'Pramod Procurement'], [cfo, ['CFO'], 'Chandra CFO'], [dir, ['DIR'], 'Dina Director'], [sys, ['SYSADM'], 'Sam Admin'], [e1, ['EMP'], 'Esha Employee'], [e2, ['EMP'], 'Eknath Employee'], [e3, ['EMP'], 'Esther Employee']]);
  const quiz = [{ q: 'How many days of leave does an employee get a year?', options: ['20', '24', '30'], correct: 1 }, { q: 'When is leave applied for?', options: ['After taking it', 'In advance'], correct: 1 }];
  const leave = await api(request, c, 'HRMGR', hr, 'post', '/pol/policies', { title: 'Leave policy', category: 'HR', body: '<h2>Leave</h2><p>Every employee gets 24 days of leave a year.</p><p>Leave is applied for in advance and approved by the reporting manager.</p><ul><li>Casual leave: 8 days</li><li>Earned leave: 16 days</li></ul>', changeSummary: '', applicability: { roles: ['EMP'] }, effectiveFrom: IST(0), reviewDue: IST(365), quiz, passMark: 50, ackDueDays: 14 });
  const s1 = await api(request, c, 'HRMGR', hr, 'post', `/pol/versions/${leave.working.id}/submit`, {});
  await act(request, c, 'CFO', cfo, s1.workflow.id);
  await act(request, c, 'DIR', dir, s1.workflow.id);
  await api(request, c, 'EMP', e1, 'post', '/pol/acknowledge', { versionId: leave.working.id, answers: [1, 1] });
  await api(request, c, 'EMP', e2, 'post', '/pol/acknowledge', { versionId: leave.working.id, answers: [1, 1] });
  const rev = await api(request, c, 'HRMGR', hr, 'post', `/pol/policies/${leave.id}/versions`, {});
  await api(request, c, 'HRMGR', hr, 'put', `/pol/versions/${rev.working.id}`, { title: 'Leave policy', category: 'HR', body: '<h2>Leave</h2><p>Every employee gets 30 days of leave a year.</p><p>Leave is applied for in advance and approved by the reporting manager.</p><ul><li>Casual leave: 10 days</li><li>Earned leave: 20 days</li></ul><p>Unused leave is paid out at the end of the year.</p>', changeSummary: 'Leave raised from 24 to 30 days; unused leave is paid out', applicability: { roles: ['EMP'] }, effectiveFrom: IST(1), reviewDue: IST(366), quiz, passMark: 50, ackDueDays: 14, version: rev.working.rowVersion });
  const s2 = await api(request, c, 'HRMGR', hr, 'post', `/pol/versions/${rev.working.id}/submit`, {});
  await act(request, c, 'CFO', cfo, s2.workflow.id);
  await act(request, c, 'DIR', dir, s2.workflow.id);
  const purchase = await api(request, c, 'PROCMGR', pr, 'post', '/pol/policies', { title: 'Purchase policy', category: 'PROCUREMENT', body: '<p>A purchase above five lakh rupees needs the procurement manager.</p>', changeSummary: '', applicability: { roles: ['EMP'] }, effectiveFrom: IST(0), reviewDue: IST(300), quiz: [], passMark: 100, ackDueDays: 14 });
  await api(request, c, 'PROCMGR', pr, 'post', '/pol/requirements', { versionId: purchase.working.id, clauseRef: '4.2', requirementText: 'A purchase above five lakh needs the procurement manager', artifactType: 'CONTROL_POINT', config: { code: 'CP-PROC-92', module: 'proc', stage: 'APPROVE', description: 'A purchase above the limit needs the procurement manager', enforcement: 'EXCEPTION', rule: { field: 'amount', op: 'gt', value: 500000 }, ownerRole: 'PROCMGR' } });
  const s3 = await api(request, c, 'PROCMGR', pr, 'post', `/pol/versions/${purchase.working.id}/submit`, {});
  await act(request, c, 'CFO', cfo, s3.workflow.id);
  await act(request, c, 'DIR', dir, s3.workflow.id);
  const reqs = await api(request, c, 'PROCMGR', pr, 'get', `/pol/requirements?versionId=${purchase.working.id}`);
  await api(request, c, 'PROCMGR', pr, 'post', `/pol/requirements/${reqs.rows[0].id}/convert`, {});
  const shot = async (page, name, full = false) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: full }); };
  const a = await open(browser, info, c, 'HRMGR', hr, `/collab/policies?id=${leave.id}`);
  await expect(a.page.getByTestId('policy-detail')).toBeVisible();
  await expect(a.page.getByTestId('pd-version')).toHaveCount(2);
  await shot(a.page, '01-policy-register', true);
  await a.page.getByTestId('cmp-from').selectOption({ label: 'Version 1' });
  await a.page.getByTestId('cmp-to').selectOption({ label: 'Version 2' });
  await expect(a.page.getByTestId('diff')).toBeVisible();
  await shot(a.page, '02-version-compare', true);
  const r = await api(request, c, 'HRMGR', hr, 'post', `/pol/policies/${leave.id}/versions`, {});
  void r;
  const ed = await open(browser, info, c, 'HRMGR', hr, `/collab/policies/edit?id=${leave.id}`);
  await expect(ed.page.getByTestId('pe-form')).toBeVisible();
  await expect(ed.page.getByTestId('pe-count')).toContainText('people', { timeout: 15_000 });
  await shot(ed.page, '03-policy-editor', true);
  const e = await open(browser, info, c, 'EMP', e3, '/collab/my-policies');
  await expect(e.page.getByTestId('mp-row').first()).toBeVisible();
  await shot(e.page, '04-my-policies');
  await e.page.getByTestId('mp-open').first().click();
  await expect(e.page.getByTestId('reader-ack')).toBeVisible();
  await shot(e.page, '05-policy-reader-quiz', true);
  const rq = await open(browser, info, c, 'PROCMGR', pr, `/collab/policies/edit?id=${purchase.id}&tab=requirements`);
  await expect(rq.page.getByTestId('rq-row')).toBeVisible();
  await shot(rq.page, '06-requirements-for-controls', true);
  const d = await open(browser, info, c, 'SYSADM', sys, '/admin/policy-drafts');
  await expect(d.page.getByTestId('pdr-row')).toBeVisible();
  await shot(d.page, '07-policy-to-protocol-drafts', true);
});
