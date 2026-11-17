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



// Part 06.02: the common masters. An accounts manager proposes a GST change of an HSN code from a later date; another accounts manager and the CFO approve it; "as of" shows the old rate before the date and the
// new one from it. Banks reject an invalid IFSC. The system administrator edits a lookup list with Hindi labels; a person who works in Hindi gets the Hindi labels. Every register page on a computer and a phone.
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked against the notification' });
};
const IST = (n = 0) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
async function setup(request, code) {
  const c = await company(request, code);
  const t = code.toLowerCase();
  const u = { acc: `${t}-acc`, acc2: `${t}-acc2`, cfo: `${t}-cfo`, proc: `${t}-proc`, sys: `${t}-sys`, se: `${t}-se` };
  people(c, [[u.acc, ['ACCMGR'], 'Anita Accounts'], [u.acc2, ['ACCMGR'], 'Arjun Accounts'], [u.cfo, ['CFO'], 'Chitra CFO'], [u.proc, ['PROCMGR'], 'Pramod Purchase'], [u.sys, ['SYSADM'], 'Sam Admin'], [u.se, ['SE'], 'Seema Engineer']]);
  return { c, u };
}
const PAGES = ['uom', 'gst-rates', 'hsn-sac', 'tds-sections', 'states', 'currencies', 'banks', 'payment-terms', 'lookups'];

test('T-01 FR-02 a GST change of an HSN code from a date: proposed on the page, approved, and the rate as of a date', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const { c, u } = await setup(request, phone ? 'CMTM' : 'CMTD');
  const p = await open(browser, info, c, 'ACCMGR', u.acc, '/admin/master-data/common/hsn-sac');
  const errors = watch(p.page);
  await p.page.getByTestId('cm-q-hsn-sac').fill('6904');
  await expect(p.page.getByTestId('cm-row-hsn-sac')).toHaveCount(1);
  if (phone) await noOverflow(p.page);
  await p.page.getByTestId('cm-open-hsn-sac').click();
  await expect(p.page.getByTestId('cmr-defaultGstRate')).toHaveText('GST12');
  await p.page.getByTestId('cmr-change').click();
  const form = p.page.getByTestId('cm-form-hsn-sac');
  await form.getByTestId('cmf-defaultGstRate').selectOption('GST5');
  await form.getByTestId('cmf-from').fill(IST(5));
  await form.getByTestId('cmf-why').fill('GST Council notification: building bricks from 12% to 5%');
  await form.getByTestId('cmf-submit').click();
  await expect(form.getByTestId('cmf-done')).toContainText('Sent for approval');
  await form.getByRole('button', { name: 'Close' }).click();
  const req = (await api(request, c, 'ACCMGR', u.acc2, 'get', '/mdm/change-requests?view=review')).rows.find((r) => r.masterType === 'HSN_SAC');
  expect(req.fields[0].after).toBe('GST5');
  await act(request, c, 'ACCMGR', u.acc2, req.instanceId);
  await act(request, c, 'CFO', u.cfo, req.instanceId);
  await p.page.reload();
  await p.page.getByTestId('cm-q-hsn-sac').fill('6904');
  await p.page.getByTestId('cm-asof-hsn-sac').fill(IST(4));
  // the list shows the previous rows while the filtered ones load: wait for the one row, since a strict-mode violation is not retried
  await expect(p.page.getByTestId('cm-row-hsn-sac')).toHaveCount(1);
  await expect(p.page.getByTestId('cm-row-hsn-sac')).toContainText('GST12');
  await p.page.getByTestId('cm-asof-hsn-sac').fill(IST(5));
  await expect(p.page.getByTestId('cm-row-hsn-sac')).toHaveCount(1);
  await expect(p.page.getByTestId('cm-row-hsn-sac')).toContainText('GST5');
  await expect(p.page.getByTestId('cm-row-hsn-sac')).toContainText('Company');
  expect((await api(request, c, 'SE', u.se, 'get', `/mdm/tax/gst?hsn=6904&date=${IST(4)}`)).rate.igstPct).toBe('12');
  if (phone) await noOverflow(p.page);
  expect(errors).toEqual([]);
});

test('T-02 T-03 FR-06 FR-08 banks reject an invalid IFSC; the lookup list manager saves Hindi labels; every register page loads', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const { c, u } = await setup(request, phone ? 'CMBM' : 'CMBD');
  const b = await open(browser, info, c, 'ACCMGR', u.acc, '/admin/master-data/common/banks');
  const errors = watch(b.page);
  await b.page.getByTestId('cm-new-banks').click();
  const form = b.page.getByTestId('cm-form-banks');
  await form.getByTestId('cmf-ifsc').fill('SBIN001234');
  await form.getByTestId('cmf-bankName').fill('State Bank of India');
  await form.getByTestId('cmf-branch').fill('Shivajinagar');
  await form.getByTestId('cmf-submit').click();
  await expect(form.getByText(/not a valid IFSC/)).toBeVisible();
  await form.getByTestId('cmf-ifsc').fill('sbin0001234');
  await form.getByTestId('cmf-submit').click();
  await expect(form.getByTestId('cmf-done')).toHaveText('Saved.');
  await form.getByRole('button', { name: 'Close' }).click();
  await expect(b.page.getByTestId('cm-row-banks')).toContainText('SBIN0001234');
  if (phone) await noOverflow(b.page);
  const m = await open(browser, info, c, 'SYSADM', u.sys, '/admin/master-data/lookup-manager?list=WEATHER');
  await expect(m.page.getByTestId('llm-row')).toHaveCount(7);
  await m.page.getByTestId('llm-add').click();
  await m.page.getByTestId('llm-code').fill('DUST');
  await m.page.getByTestId('llm-en').last().fill('Dust storm');
  await m.page.getByTestId('llm-hi').last().fill('धूल भरी आँधी');
  await m.page.getByTestId('llm-reason').fill('Dust storms stop work at the Rajasthan sites');
  await m.page.getByTestId('llm-save').click();
  await expect(m.page.getByTestId('llm-note')).toContainText('1 added');
  if (phone) await noOverflow(m.page);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  db.prepare("INSERT INTO ui_user_preferences (company_id, user_ref, language, created_by, source_type) VALUES (?, ?, 'hi', 'e2e', 'e2e')").run(c, u.se);
  db.close();
  const hi = await request.get('/api/v1/mdm/lookups/weather', { headers: H('SE', c, u.se) });
  expect((await hi.json()).data.map((r) => r.name)).toContain('धूल भरी आँधी');
  for (const page of PAGES) {
    const x = await open(browser, info, c, 'ACCMGR', u.acc, `/admin/master-data/common/${page}`);
    await expect(x.page.getByTestId(`cm-page-${page}`)).toBeVisible();
    await expect(x.page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(x.page.locator('[data-testid^="cm-row-"]').first()).toBeVisible();
    if (phone) await noOverflow(x.page);
    await x.context.close();
  }
  expect(errors).toEqual([]);
});
