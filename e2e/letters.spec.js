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

const OUT = 'docs/erp/screenshots/letters';
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['doc', ['DOC']], ['pm', ['PM']], ['com', ['COMMGR']], ['se', ['SE']], ['bd', ['BD']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
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

// Part 11.05: a document controller registers an inward instruction, answers it with an outward letter drafted from a standard text, the project manager approves it (it is numbered and put on letterhead only then), it is issued by courier and the acknowledgement is kept as proof;
// the inward letter shows as answered and the thread links the two. A notice with a time limit is opened, the countdown alert fires before its deadline, and an outward notice that names it serves it in time. A person without the right sees the no-permission state.
test('AC-01 inward registration, outward letter approved and issued, thread, time-bar countdown and serving, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = info.project.name === 'mobile' ? 'ltm' : 'ltd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const doc = s.u('doc'); const pm = s.u('pm'); const se = s.u('se');
  const code = `${t.toUpperCase()}-A`;
  const r = await open(browser, info, c, 'DOC', doc, '/engg/letters');
  const errors = watch(r.page);
  await expect(r.page.getByRole('heading', { name: 'Correspondence Register', level: 1 })).toBeVisible();
  await r.page.getByTestId('lt-new-in').click();
  await r.page.getByTestId('lt-f-project').selectOption(String(s.project));
  await r.page.getByTestId('lt-f-theirRef').fill('CL/ENG/2026/041');
  await r.page.getByTestId('lt-f-party').fill('Mehta Associates (engineer)');
  await r.page.getByTestId('lt-f-subject').fill('Instruction to change the pier 4 foundation level');
  await r.page.getByTestId('lt-f-clauseRef').fill('13.1');
  await r.page.getByTestId('lt-f-assignedTo').fill(se);
  await r.page.getByTestId('lt-f-tags').fill('foundation, pier4');
  await shot(r.page, 'register-new', info);
  await noOverflow(r.page);
  await r.page.getByTestId('lt-register').click();
  await expect(r.page.getByTestId('letter')).toBeVisible();
  await expect(r.page.getByTestId('letter')).toHaveAttribute('data-number', `${code}/IN/0001`);
  await expect(r.page.getByTestId('lt-response')).toContainText('Waiting for our reply');
  const inId = Number(new URL(r.page.url()).searchParams.get('id'));
  // the reply: drafted from a standard text
  await r.page.getByTestId('lt-reply').click();
  await expect(r.page.getByTestId('letter-draft')).toBeVisible();
  await r.page.getByTestId('draft-template').selectOption('REPLY_INSTRUCTION');
  await expect(r.page.getByTestId('draft-subject')).toHaveValue(/CL\/ENG\/2026\/041/);
  await expect(r.page.getByTestId('draft-body')).toHaveValue(/Dear Sir/);
  await expect(r.page.getByTestId('draft-party')).toHaveValue('Mehta Associates (engineer)');
  await shot(r.page, 'draft', info);
  await noOverflow(r.page);
  await r.page.getByTestId('draft-save').click();
  await expect(r.page.getByTestId('letter')).toHaveAttribute('data-status', 'DRAFT');
  await expect(r.page.getByTestId('letter')).toHaveAttribute('data-number', '');
  const outId = Number(new URL(r.page.url()).searchParams.get('id'));
  await r.page.getByTestId('lt-submit').click();
  await expect(r.page.getByTestId('letter')).toHaveAttribute('data-status', 'SUBMITTED');
  const wf = (await api(request, c, 'DOC', doc, 'get', `/engg/letters/${outId}`)).workflowInstanceId;
  await approve(request, c, 'PM', pm, wf);
  await r.page.reload();
  await expect(r.page.getByTestId('letter')).toHaveAttribute('data-status', 'APPROVED');
  await expect(r.page.getByTestId('letter')).toHaveAttribute('data-number', `${code}/OUT/0001`);
  await expect(r.page.getByTestId('lt-print')).toContainText('letterhead');
  // issue by courier and the acknowledgement
  await r.page.getByTestId('lt-mode').selectOption('COURIER');
  await r.page.getByTestId('lt-delivery').fill('DTDC 4491');
  await r.page.getByTestId('lt-issue').click();
  await expect(r.page.getByTestId('letter')).toHaveAttribute('data-status', 'ISSUED');
  await expect(r.page.getByTestId('lt-issued-mode')).toContainText('DTDC 4491');
  await r.page.getByTestId('lt-ackby').fill('Mehta Associates, site office');
  await r.page.getByTestId('lt-acknote').fill('Signed copy received');
  await r.page.getByTestId('lt-ack').click();
  await expect(r.page.getByTestId('letter')).toHaveAttribute('data-status', 'ACKNOWLEDGED');
  await expect(r.page.getByTestId('lt-acked')).toContainText('Mehta Associates');
  await shot(r.page, 'letter-acknowledged', info);
  await noOverflow(r.page);
  // the thread and the answered inward letter
  await r.page.getByRole('tab', { name: 'Thread' }).click();
  await expect(r.page.getByTestId(`lt-th-${inId}`)).toBeVisible();
  await expect(r.page.getByTestId(`lt-th-${outId}`)).toHaveAttribute('data-current', '1');
  await r.page.goto(`/engg/letter?id=${inId}`);
  await expect(r.page.getByTestId('lt-response')).toContainText('Answered');
  // the register tabs
  await r.page.goto('/engg/letters');
  await r.page.getByTestId('lt-tab-OUT').click();
  await expect(r.page.getByText(`${code}/OUT/0001`).first()).toBeVisible();
  await shot(r.page, 'register-outward', info);
  // a time bar and its countdown
  const p = await open(browser, info, c, 'PM', pm, '/engg/time-bars');
  const e2 = watch(p.page);
  await expect(p.page.getByRole('heading', { name: 'Notices and Time Bars', level: 1 })).toBeVisible();
  await p.page.getByTestId('tb-new').click();
  await p.page.getByTestId('tb-f-project').selectOption(String(s.project));
  await p.page.getByTestId('tb-f-description').fill('Notice of claim for the delayed site handover');
  await p.page.getByTestId('tb-f-clause').fill('20.1');
  await p.page.getByTestId('tb-f-event').fill(day(-23));
  await p.page.getByTestId('tb-f-days').fill('28');
  await p.page.getByTestId('tb-f-owner').fill(se);
  await p.page.getByTestId('tb-create').click();
  await expect(p.page.getByTestId('tb-row-TB-00001')).toHaveAttribute('data-urgency', 'WARNING');
  await p.page.getByTestId('tb-run').click();
  await expect(p.page.getByTestId('tb-note')).toContainText('1 countdown');
  const told = await api(request, c, 'SE', se, 'get', '/ntf/notifications');
  expect(JSON.stringify(told)).toContain('TB-00001');
  await shot(p.page, 'timebars', info);
  await noOverflow(p.page);
  // an outward notice that names the bar serves it in time
  await p.page.goto('/engg/letter-draft');
  await p.page.getByTestId('draft-project').selectOption(String(s.project));
  await p.page.getByTestId('draft-template').selectOption('NOTICE_CLAIM');
  await p.page.getByTestId('draft-clause').fill('20.1');
  await p.page.getByTestId('draft-party').fill('Mehta Associates (engineer)');
  await p.page.getByTestId('draft-timebar').selectOption({ index: 1 });
  await p.page.getByTestId('draft-save').click();
  await expect(p.page.getByTestId('letter')).toHaveAttribute('data-status', 'DRAFT');
  const nId = Number(new URL(p.page.url()).searchParams.get('id'));
  await p.page.getByTestId('lt-submit').click();
  const wf2 = (await api(request, c, 'PM', pm, 'get', `/engg/letters/${nId}`)).workflowInstanceId;
  await approve(request, c, 'COMMGR', s.u('com'), wf2);
  await p.page.reload();
  await expect(p.page.getByTestId('letter')).toHaveAttribute('data-status', 'APPROVED');
  await p.page.getByTestId('lt-issue').click();
  await expect(p.page.getByTestId('letter')).toHaveAttribute('data-status', 'ISSUED');
  await expect(p.page.getByTestId('lt-timebar')).toContainText('Served in time');
  await p.page.goto('/engg/time-bars');
  await expect(p.page.getByTestId('tb-row-TB-00001')).toHaveAttribute('data-status', 'SERVED');
  expect(errors).toEqual([]); expect(e2).toEqual([]);
});

test('AC-03 a person without the right sees the no-permission state', async ({ browser, request }, info) => {
  const t = info.project.name === 'mobile' ? 'ltn' : 'ltk';
  const c = await company(request, t.toUpperCase());
  seed(c, t);
  const { page } = await open(browser, info, c, 'BD', `${t}-bd`, '/engg/letters');
  await expect(page.getByRole('heading', { name: /You do not have access/ })).toBeVisible();
  await expect(page.getByText('engg.letter.view')).toBeVisible();
  await noOverflow(page);
});
