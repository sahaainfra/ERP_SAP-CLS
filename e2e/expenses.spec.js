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
  const users = {};
  for (const [n, roles] of [['hr', ['HRMGR']], ['mgr', ['PM']], ['emp', ['EMP']], ['emp2', ['EMP']]]) users[n] = Number(db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n.toUpperCase()} Person`, JSON.stringify(roles), `${t}-${n}@example.com`).lastInsertRowid);
  const one = (sql, ...a) => Number(db.prepare(sql).run(...a).lastInsertRowid);
  const dept = one("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (?, 'ENG', 'Engineering', 'e2e', 'e2e')", c);
  const des = one("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (?, 'SE', 'Site Engineer', 'G3', 3, 'e2e', 'e2e')", c);
  const p1 = one("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'P1', 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')", c);
  const s1 = one("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (?, ?, 'N1', 'Ring Road North', 'ACTIVE', 18.5204, 73.8567, 'CIRCLE', 200, 'e2e', 'e2e')", c, p1);
  let n = 0;
  const emp = (name, code, userId = null, managerId = null) => { n += 1; return one("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, employment_type, doj, location_type, employment_status, record_status, user_id, manager_id, site_id, project_id, grade, created_by, source_type) VALUES (?, ?, 'E', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, ?, ?, ?, 'G3', 'e2e', 'e2e')", c, code, name, `${t}${n}`, `93000${String(n).padStart(5, '0')}${t.length}`, dept, des, userId, managerId, s1, p1); };
  const dep = (e) => one("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (?, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 'e2e', 'e2e')", c, `DEP-${t}-${e}`, e, p1, s1, p1, s1);
  const manager = emp('Meera Manager', `${t.toUpperCase()}M`, users.mgr);
  const asha = emp('Asha Kulkarni', `${t.toUpperCase()}A`, users.emp, manager); const bhanu = emp('Bhanu Rao', `${t.toUpperCase()}B`, users.emp2, manager);
  for (const e of [manager, asha, bhanu]) dep(e);
  const shift = one("INSERT INTO att_shifts (company_id, code, name, start_minute, end_minute, break_minutes, grace_minutes, half_day_minutes, full_day_minutes, ot_after_minutes, status, created_by, source_type) VALUES (?, 'GEN', 'General', 540, 1080, 60, 15, 240, 480, 480, 'ACTIVE', 'e2e', 'e2e')", c);
  one("INSERT INTO att_policies (company_id, code, name, version_no, effective_from, rules_json, band, status, created_by, source_type) VALUES (?, 'PO', 'Policy PO', 1, '2026-01-01', ?, 'STANDARD', 'APPROVED', 'e2e', 'e2e')", c, JSON.stringify({ late: { enabled: true, countPerHalfDay: 3 }, earlyGoing: { enabled: true, graceMinutes: 0, countPerHalfDay: 3 }, missingPunch: { mode: 'REGULARISE' }, compOff: { enabled: false }, ot: { enabled: false } }));
  one("INSERT INTO att_policy_assignments (company_id, scope_type, scope_id, policy_code, shift_id, weekly_off_json, effective_from, created_by, source_type) VALUES (?, 'COMPANY', 0, 'PO', ?, ?, '2026-01-01', 'e2e', 'e2e')", c, shift, JSON.stringify({ type: 'FIXED', days: [0] }));
  db.close();
  return { s1, p1, u: (k) => `${t}-${k}` };
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


const OUT = 'docs/erp/screenshots/expenses';
const W = '/workflow';
const decide = async (request, c, roles, user, instanceId, action) => {
  const tasks = await api(request, c, roles, user, 'get', `${W}/tasks?mine=assigned`);
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `${W}/tasks/${task.id}/act`, { action, comment: 'checked it' });
};
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// Part 07.12: advances, expense claims and travel. The accounts manager makes a policy and the CFO activates it; Asha raises a claim on her phone: a hotel bill over the limit (flagged, with a justification), a bill photo from the camera input, a per diem
// computed by the server; it goes to the manager and the accounts manager (a deviation moves it up one level); the approver sees the flag; the accounts manager passes it for payment and records the payment; a salary advance goes through its chain
// and is paid out; the analysis and Hindi. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 policy, a claim with a bill photo and a flag, the approvals by band, pass for payment, a salary advance, the analysis and Hindi, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'EXM' : 'EXD');
  const t = phone ? 'exm' : 'exd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['acc', ['ACCMGR']], ['cfo', ['CFO']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, g.u(n), n, JSON.stringify(roles), `${g.u(n)}@example.com`);
  db.close();
  const day = (n) => new Date(Date.now() + 19_800_000 + n * 86_400_000).toISOString().slice(0, 10);
  // the accounts manager makes the policies, the CFO activates them
  const acc = await open(browser, info, c, 'ACCMGR', g.u('acc'), '/expenses/policies');
  const errors = watch(acc.page);
  await expect(acc.page.getByTestId('policies')).toBeVisible();
  await acc.page.getByTestId('po-grade').fill('G3'); await acc.page.getByTestId('po-category').selectOption('LODGING'); await acc.page.getByTestId('po-limit').fill('3000'); await acc.page.getByTestId('po-receipt').fill('500'); await acc.page.getByTestId('po-from').fill('2026-01-01');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, '01-policies');
  await acc.page.getByTestId('po-save').click();
  await expect(acc.page.getByTestId('po-row').first()).toHaveAttribute('data-status', 'DRAFT');
  const cfo = await open(browser, info, c, 'CFO', g.u('cfo'), '/expenses/policies');
  await cfo.page.getByTestId('po-row').first().getByTestId('po-activate').click();
  await expect(cfo.page.getByTestId('po-row').first()).toHaveAttribute('data-status', 'ACTIVE');
  const pd = (await api(request, c, 'ACCMGR', g.u('acc'), 'put', '/hr/expenses/policies', { grade: 'G3', category: 'PER_DIEM', cityTier: '*', perDiem: 500, effectiveFrom: '2026-01-01' }));
  await api(request, c, 'CFO', g.u('cfo'), 'post', `/hr/expenses/policies/${pd.id}/activate`, {});
  // Asha: the claim, with a flag, a bill photo and a per diem
  const emp = await open(browser, info, c, 'EMP', g.u('emp'), '/expenses/claim');
  const eErrors = watch(emp.page);
  await emp.page.getByTestId('cl-purpose').fill('Site inspection at Nagpur');
  const first = emp.page.getByTestId('cl-line').first();
  await first.getByTestId('cl-category').selectOption('LODGING'); await first.getByTestId('cl-date').fill(day(-2)); await first.getByTestId('cl-desc').fill('Hotel for two nights');
  await first.getByTestId('cl-amount').fill('4500'); await first.getByTestId('cl-vendor').fill('Hotel Orange'); await first.getByTestId('cl-invoice').fill('INV-9');
  await expect(first).toHaveAttribute('data-flag', 'OVER_LIMIT');
  await expect(first.getByTestId('cl-flag-text')).toContainText('limit');
  await first.getByTestId('cl-justification').fill('The only hotel with a room near the site that week');
  await emp.page.getByTestId('cl-add-line').click();
  const second = emp.page.getByTestId('cl-line').nth(1);
  await second.getByTestId('cl-category').selectOption('PER_DIEM'); await second.getByTestId('cl-date').fill(day(-2)); await second.getByTestId('cl-desc').fill('Per diem'); await second.getByTestId('cl-days').fill('2');
  await expect(second.getByTestId('cl-computed')).toContainText('1,000');
  await expect(emp.page.getByTestId('cl-total')).toContainText('5,500');
  await expect(emp.page.getByTestId('cl-level')).toContainText('accounts manager');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '02-claim-flag');
  await emp.page.getByTestId('cl-save').click();
  await expect(emp.page.getByTestId('claim')).toHaveAttribute('data-status', 'DRAFT');
  expect(new URL(emp.page.url()).searchParams.get('id')).toBeTruthy();
  // the bill photo from the camera input
  await emp.page.getByTestId('cl-line').first().getByTestId('cl-photo').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });
  await expect(emp.page.getByTestId('cl-note')).toContainText('photo');
  await expect(emp.page.getByTestId('cl-line').first().getByTestId('cl-bill')).toBeVisible();
  await emp.page.getByTestId('cl-save').click();
  await expect(emp.page.getByTestId('cl-note')).toContainText('saved');
  await shot(emp.page, '03-claim-photo');
  await emp.page.getByTestId('cl-send').click();
  await expect(emp.page.getByTestId('claim')).toHaveAttribute('data-status', 'SUBMITTED');
  const claimId = Number(new URL(emp.page.url()).searchParams.get('id'));
  // the manager sees the flag, approves; the accounts manager approves, passes for payment and records the payment
  const mgr = await open(browser, info, c, 'PM', g.u('mgr'), '/expenses/approvals');
  const mErrors = watch(mgr.page);
  const row = mgr.page.getByTestId('ca-row');
  await expect(row).toHaveCount(1); await expect(row).toHaveAttribute('data-flags', '1');
  await expect(row).toContainText('only hotel');
  if (phone) await noOverflow(mgr.page);
  await shot(mgr.page, '04-approvals');
  await mgr.page.getByTestId('ca-pick').check(); await mgr.page.getByTestId('ca-approve').click();
  await expect(mgr.page.getByTestId('ca-note')).toContainText('1 decided');
  await acc.page.goto('/expenses/approvals');
  await acc.page.getByTestId('ca-pick').check(); await acc.page.getByTestId('ca-approve').click();
  await expect(acc.page.getByTestId('ca-note')).toContainText('1 decided');
  await acc.page.reload();
  await acc.page.getByTestId('ca-pass').click();
  await expect(acc.page.getByTestId('ca-note')).toContainText('passed');
  acc.page.once('dialog', (d) => d.accept('NEFT-4471'));
  await acc.page.getByTestId('ca-paid').click();
  await expect(acc.page.getByTestId('ca-note')).toContainText('payment');
  await emp.page.goto(`/expenses/claim?id=${claimId}`);
  await expect(emp.page.getByTestId('claim')).toHaveAttribute('data-status', 'PAID');
  await shot(emp.page, '05-claim-paid');
  // a salary advance through its chain, paid out by accounts
  await emp.page.goto('/expenses/advance');
  await emp.page.getByTestId('ad-type').selectOption('SALARY'); await emp.page.getByTestId('ad-amount').fill('20000'); await emp.page.getByTestId('ad-purpose').fill('Family medical expenses'); await emp.page.getByTestId('ad-instalments').fill('4');
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '06-advance');
  await emp.page.getByTestId('ad-send').click();
  await expect(emp.page.getByTestId('advance')).toHaveAttribute('data-status', 'SUBMITTED');
  const advId = Number(new URL(emp.page.url()).searchParams.get('id'));
  const inst = (await api(request, c, 'EMP', g.u('emp'), 'get', `/hr/advances/${advId}`)).workflowInstanceId;
  await decide(request, c, 'PM', g.u('mgr'), inst, 'approve'); await decide(request, c, 'HRMGR', g.u('hr'), inst, 'approve');
  await acc.page.goto('/expenses/approvals');
  acc.page.once('dialog', (d) => d.accept('UTR-5521'));
  await acc.page.getByTestId('ca-disburse').click();
  await expect(acc.page.getByTestId('ca-note')).toContainText('payment');
  await emp.page.reload();
  await expect(emp.page.getByTestId('advance')).toHaveAttribute('data-status', 'DISBURSED');
  await expect(emp.page.getByTestId('ad-outstanding')).toContainText('20,000');
  await expect(emp.page.getByTestId('ad-recoveries')).toContainText('4,000'.replace('4,000', '5,000'));
  // my claims and advances list; the analysis for accounts
  await emp.page.goto('/expenses');
  await expect(emp.page.getByTestId('my-expenses')).toBeVisible();
  if (phone) await noOverflow(emp.page);
  await shot(emp.page, '07-my-expenses');
  await acc.page.goto('/expenses/analysis');
  await expect(acc.page.getByTestId('an-total')).toContainText('5,500');
  await expect(acc.page.getByTestId('an-byCategory')).toContainText('Lodging');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, '08-analysis');
  // Hindi
  const hi = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  const hp = await hi.newPage();
  const hiErrors = watch(hp);
  await hp.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'hi' })); }, { user: g.u('emp'), roles: 'EMP', company: String(c) });
  await hp.goto('/expenses/claim');
  await expect(hp.getByRole('heading', { level: 1 })).toHaveText('नया व्यय दावा');
  if (phone) await noOverflow(hp);
  await shot(hp, '09-hindi');
  expect([...errors, ...eErrors, ...mErrors, ...hiErrors]).toEqual([]);
});
