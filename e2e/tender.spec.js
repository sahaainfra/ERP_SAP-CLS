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
const open = async (browser, info, c, roles, user, path, extra = {}) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, ...extra });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });


const OUT = 'docs/erp/screenshots/tender';
const W = '/workflow';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', `${W}/tasks?mine=assigned`);
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `${W}/tasks/${task.id}/act`, { action, comment: 'checked it' });
};
function seedBd(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['bd1', ['BD']], ['dir', ['DIR']], ['est', ['EST']], ['est2', ['EST']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, n, JSON.stringify(roles), `${t}-${n}@example.com`);
  const partner = (code, name, status) => { const id = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'COMMGR', 'e2e', 'e2e')").run(c, code, name, name.toLowerCase(), status).lastInsertRowid); db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, 'CLIENT')").run(c, id); return id; };
  const nhai = partner(`${t.toUpperCase()}C1`, 'National Highways Authority', 'ACTIVE'); partner(`${t.toUpperCase()}C2`, 'State PWD Maharashtra', 'PROSPECT');
  db.close();
  return { nhai, u: (k) => `${t}-${k}` };
}
const pick = async (page, id, text, name) => { await page.locator(`#${id}`).click(); await page.locator(`#${id}`).fill(text); await page.getByRole('option', { name }).first().click(); };

// Part 08.02: the tender register. A business development executive registers a tender (the authority from the partner master, dates, cost, EMD); a colleague of the estimation team approves the registration; the estimation manager works out the bid capacity
// (A x N x 2 - B), fills the eligibility checklist, evaluates bid or no-bid (a colleague, then the director approve), records an addendum that moves the submission, a pre-bid query with its clarification, a team task and a tender document, and marks the tender ready for
// submission only when everything is in place; the calendar and the dashboard show the deadlines; Hindi. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 a tender is registered, evaluated, worked on (eligibility, addenda, queries, tasks, documents) and made ready, with the calendar, the dashboard and Hindi, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(540_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'TDM' : 'TDD');
  const t = phone ? 'tdm' : 'tdd';
  const g = seedBd(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
  // registration by business development
  const bd1 = await open(browser, info, c, 'BD', g.u('bd1'), '/bd/tender/new');
  const errors = watch(bd1.page);
  await expect(bd1.page.getByTestId('tender-new')).toBeVisible();
  await pick(bd1.page, 'td-client', 'National', /National Highways/);
  await bd1.page.getByTestId('td-reference').fill('NHAI/2027/PKG-3'); await bd1.page.getByTestId('td-portal').selectOption('CPPP');
  await bd1.page.getByTestId('td-name').fill('Four-laning of NH-48, package 3'); await bd1.page.getByTestId('td-location').fill('Pune'); await bd1.page.getByTestId('td-region').selectOption('WEST');
  await bd1.page.getByTestId('td-cost').fill('500000000'); await bd1.page.getByTestId('td-emd').fill('10000000'); await bd1.page.getByTestId('td-fee').fill('25000'); await bd1.page.getByTestId('td-bidtype').selectOption('ITEM_RATE'); await bd1.page.getByTestId('td-period').fill('24');
  await bd1.page.getByTestId('td-publish').fill(day(-3)); await bd1.page.getByTestId('td-prebid').fill(day(5)); await bd1.page.getByTestId('td-submission').fill(`${day(21)}T15:00`); await bd1.page.getByTestId('td-opening').fill(`${day(21)}T16:00`);
  if (phone) await noOverflow(bd1.page);
  await shot(bd1.page, '01-new-tender');
  await bd1.page.getByTestId('td-save-send').click();
  await expect(bd1.page.getByTestId('tender')).toHaveAttribute('data-status', 'SUBMITTED');
  const tenderId = Number(new URL(bd1.page.url()).searchParams.get('id'));
  const tender = await api(request, c, 'BD', g.u('bd1'), 'get', `/bd/tenders/${tenderId}`);
  await decide(request, c, 'EST', g.u('est2'), tender.workflowInstanceId);
  await bd1.page.reload();
  await expect(bd1.page.getByTestId('tender')).toHaveAttribute('data-status', 'APPROVED');
  await expect(bd1.page.getByTestId('tender')).toContainText('Registered');
  // the estimation manager: capacity, eligibility
  const est = await open(browser, info, c, 'EST', g.u('est'), `/bd/tender?id=${tenderId}`);
  const eErrors = watch(est.page);
  await expect(est.page.getByTestId('tender')).toHaveAttribute('data-stage', 'OPEN');
  await expect(est.page.getByTestId('readiness')).toHaveAttribute('data-ready', 'no');
  await est.page.getByTestId('cap-turnover').fill('400000000'); await est.page.getByTestId('cap-commitments').fill('300000000'); await est.page.getByTestId('cap-save').click();
  await expect(est.page.getByTestId('capacity-result')).toContainText('1,30,00,00,000');
  await expect(est.page.getByTestId('td-fig-capacity')).toContainText('1,30,00,00,000');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '02-capacity');
  await est.page.getByTestId('tab-eligibility').click();
  await expect(est.page.locator('[data-testid="el-row"][data-criterion="BID_CAPACITY"]')).toHaveAttribute('data-result', 'PASS');
  await est.page.locator('[data-testid="el-row"][data-criterion="TURNOVER"] [data-testid="el-edit"]').click();
  await est.page.getByTestId('el-requirement').fill('150000000'); await est.page.getByTestId('el-our').fill('400000000'); await est.page.getByTestId('el-save').click();
  await expect(est.page.locator('[data-testid="el-row"][data-criterion="TURNOVER"]')).toHaveAttribute('data-result', 'PASS');
  await est.page.locator('[data-testid="el-row"][data-criterion="SIMILAR_WORK"] [data-testid="el-edit"]').click();
  await est.page.getByTestId('el-our-text').fill('Three NH works of 40 crore each'); await est.page.getByTestId('el-result').selectOption('PASS'); await est.page.getByTestId('el-save').click();
  await expect(est.page.locator('[data-testid="el-row"][data-criterion="SIMILAR_WORK"]')).toHaveAttribute('data-result', 'PASS');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '03-eligibility');
  // the other criteria by the API (the same calls the form makes)
  const cur = await api(request, c, 'EST', g.u('est'), 'get', `/bd/tenders/${tenderId}`);
  for (const e of cur.eligibility.rows.filter((r) => r.result === 'PENDING')) {
    if (e.auto) await api(request, c, 'EST', g.u('est'), 'patch', `/bd/eligibility/${e.id}`, { requirement: 100000000, our: 300000000, version: e.rowVersion });
    else await api(request, c, 'EST', g.u('est'), 'patch', `/bd/eligibility/${e.id}`, { result: 'PASS', version: e.rowVersion });
  }
  // not ready yet: the decision
  await est.page.reload();
  await est.page.getByTestId('tab-details').click();
  await expect(est.page.getByTestId('td-ready')).toHaveCount(0);
  await expect(est.page.locator('[data-testid="rd-item"][data-code="DECISION"]')).toHaveAttribute('data-ok', 'no');
  // bid or no-bid
  await est.page.getByTestId('td-decide').click();
  await expect(est.page.getByTestId('bid-decision')).toBeVisible();
  for (const k of ['STRATEGIC_FIT', 'MARGIN', 'RISK', 'CAPACITY', 'COMPETITION']) await est.page.getByTestId(`bid-${k}`).selectOption('4');
  await expect(est.page.getByTestId('bid-total')).toHaveText('80/100');
  await expect(est.page.getByTestId('bid-recommendation')).toHaveText('Bid');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '04-bid-decision');
  await est.page.getByTestId('bid-save-send').click();
  await expect(est.page.getByTestId('bid-decision')).toHaveAttribute('data-status', 'SUBMITTED');
  const decisionId = Number(new URL(est.page.url()).searchParams.get('id'));
  const dec = await api(request, c, 'EST', g.u('est'), 'get', `/bd/bid-decisions/${decisionId}`);
  await decide(request, c, 'EST', g.u('est2'), dec.workflowInstanceId); await decide(request, c, 'DIR', g.u('dir'), dec.workflowInstanceId);
  await est.page.reload();
  await expect(est.page.getByTestId('bid-decision')).toHaveAttribute('data-status', 'APPROVED');
  await est.page.goto(`/bd/tender?id=${tenderId}`);
  await expect(est.page.getByTestId('tender')).toHaveAttribute('data-stage', 'BID');
  // an addendum that moves the submission
  await est.page.getByTestId('tab-addenda').click();
  await est.page.getByTestId('ad-kind').selectOption('CORRIGENDUM'); await est.page.getByTestId('ad-summary').fill('Submission extended by a week'); await est.page.getByTestId('ad-impact').selectOption('DATES'); await est.page.getByTestId('ad-impact-note').fill('More time for the financial bid');
  await est.page.getByTestId('ad-new-submission').fill(`${day(28)}T15:00`); await est.page.getByTestId('ad-new-opening').fill(`${day(28)}T16:00`); await est.page.getByTestId('ad-save').click();
  await expect(est.page.getByTestId('ad-row')).toHaveCount(1);
  await expect(est.page.getByTestId('date-log')).toContainText('submission_at');
  await expect(est.page.getByTestId('ad-row')).toHaveAttribute('data-ack', 'no');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '05-addenda');
  // not ready until the addendum is read
  await est.page.getByTestId('tab-details').click();
  await expect(est.page.locator('[data-testid="rd-item"][data-code="ADDENDA"]')).toHaveAttribute('data-ok', 'no');
  await expect(est.page.getByTestId('td-ready')).toBeVisible();
  est.page.once('dialog', (d) => d.dismiss());
  await est.page.getByTestId('td-ready').click();
  await expect(est.page.getByTestId('td-error')).toContainText('addendum');
  await est.page.getByTestId('tab-addenda').click(); await est.page.getByTestId('ad-ack').click();
  await expect(est.page.getByTestId('ad-row')).toHaveAttribute('data-ack', 'yes');
  // a pre-bid query and its clarification
  await est.page.getByTestId('tab-queries').click();
  await est.page.getByTestId('qu-clause').fill('ITB 12.3'); await est.page.getByTestId('qu-query').fill('May a joint venture partner meet the turnover criterion?'); await est.page.getByTestId('qu-save').click();
  await expect(est.page.getByTestId('qu-row')).toHaveAttribute('data-status', 'DRAFT');
  await est.page.getByTestId('qu-send').click(); await expect(est.page.getByTestId('qu-row')).toHaveAttribute('data-status', 'SUBMITTED');
  await est.page.getByTestId('qu-respond').click(); await est.page.getByTestId('qu-response-text').fill('Yes, up to fifty percent of the criterion.'); await est.page.getByTestId('qu-response-save').click();
  await expect(est.page.getByTestId('qu-row')).toHaveAttribute('data-status', 'ANSWERED');
  await expect(est.page.getByTestId('qu-response')).toContainText('fifty percent');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '06-queries');
  // a team task and a document
  await est.page.getByTestId('tab-tasks').click();
  await est.page.getByTestId('tk-kind').selectOption('ESTIMATION'); await est.page.getByTestId('tk-title').fill('Price the bill of quantities'); await est.page.getByTestId('tk-assignee').fill(g.u('est2')); await est.page.getByTestId('tk-due').fill(day(10)); await est.page.getByTestId('tk-save').click();
  await expect(est.page.getByTestId('tk-row')).toHaveCount(1);
  await est.page.getByTestId('tk-done').click();
  await expect(est.page.getByTestId('tk-row')).toHaveAttribute('data-status', 'DONE');
  await est.page.getByTestId('tab-documents').click();
  await est.page.getByTestId('dc-title').fill('Notice inviting tender'); await est.page.getByTestId('dc-kind').selectOption('NIT'); await est.page.getByTestId('dc-save').click();
  await expect(est.page.getByTestId('dc-row')).toHaveCount(1);
  if (phone) await noOverflow(est.page);
  await shot(est.page, '07-documents');
  // ready for submission
  await est.page.getByTestId('tab-details').click();
  await expect(est.page.getByTestId('readiness')).toHaveAttribute('data-ready', 'yes');
  await est.page.getByTestId('td-ready').click();
  await expect(est.page.getByTestId('tender')).toHaveAttribute('data-stage', 'READY');
  await expect(est.page.getByTestId('td-unready')).toBeVisible();
  if (phone) await noOverflow(est.page);
  await shot(est.page, '08-ready');
  // the calendar and the dashboard
  await est.page.goto('/bd/tender-calendar');
  await expect(est.page.getByTestId('tender-calendar')).toBeVisible();
  const submission = est.page.locator(`[data-testid="cal-agenda"] li[data-kind="SUBMISSION"][data-date="${day(28)}"]`);
  const inThisMonth = day(28).slice(0, 7) === day(0).slice(0, 7);
  if (!inThisMonth) await est.page.getByTestId('cal-next').click();
  await expect(submission.or(est.page.locator('[data-testid="cal-agenda"] li[data-kind="PREBID"]')).first()).toBeVisible();
  if (phone) await noOverflow(est.page);
  await shot(est.page, '09-calendar');
  await est.page.goto('/bd/tender-dashboard');
  await expect(est.page.getByTestId('tender-dashboard')).toBeVisible();
  await expect(est.page.getByTestId('tile-live')).toHaveText('1');
  await expect(est.page.getByTestId('tile-ready')).toHaveText('1');
  await expect(est.page.getByTestId('tile-ratio')).toContainText('100%');
  await expect(est.page.getByTestId('tdash-upcoming')).toContainText('TDR-');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '10-dashboard');
  await est.page.goto('/bd/tenders'); await expect(est.page.getByTestId('tenders')).toBeVisible(); if (phone) await noOverflow(est.page); await shot(est.page, '11-register');
  // business development reads the decision and has no way to manage
  await bd1.page.goto(`/bd/tender?id=${tenderId}`);
  await expect(bd1.page.getByTestId('td-ready')).toHaveCount(0);
  // Hindi
  const hi = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  const hp = await hi.newPage();
  const hiErrors = watch(hp);
  await hp.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'hi' })); }, { user: g.u('est'), roles: 'EST', company: String(c) });
  await hp.goto('/bd/tender-dashboard');
  await expect(hp.getByRole('heading', { level: 1 })).toHaveText('निविदा डैशबोर्ड');
  if (phone) await noOverflow(hp);
  await shot(hp, '12-hindi');
  expect([...errors, ...eErrors, ...hiErrors]).toEqual([]);
});
