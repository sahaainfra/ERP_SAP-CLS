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



// Screenshots of the 06.02 pages for docs/erp/screenshots/common-masters. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/common-masters';
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

test('screenshots of the common master pages', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  void watch; void noOverflow;
  const { c, u } = await setup(request, phone ? 'CMSM' : 'CMSD');
  const rows = (await api(request, c, 'ACCMGR', u.acc, 'get', '/mdm/common/hsn-sac?q=2523')).rows;
  const r = await api(request, c, 'ACCMGR', u.acc, 'put', `/mdm/common/hsn-sac/${rows[0].id}`, { data: { defaultGstRate: 'GST18' }, effectiveFrom: IST(5), justification: 'GST Council notification: cement from 28% to 18%', version: rows[0].rowVersion });
  await act(request, c, 'ACCMGR', u.acc2, r.workflow.id);
  await act(request, c, 'CFO', u.cfo, r.workflow.id);
  const tds = (await api(request, c, 'ACCMGR', u.acc, 'get', '/mdm/common/tds-sections?q=194J')).rows[0];
  await api(request, c, 'ACCMGR', u.acc, 'put', `/mdm/common/tds-sections/${tds.id}`, { data: { thresholdSingle: '50000' }, effectiveFrom: IST(10), justification: 'Finance Act: threshold for professional fees raised', version: tds.rowVersion });
  await api(request, c, 'ACCMGR', u.acc, 'post', '/mdm/common/banks', { data: { ifsc: 'SBIN0001234', bankName: 'State Bank of India', branch: 'Shivajinagar', city: 'Pune', stateName: 'Maharashtra', micr: '411002003' } });
  await api(request, c, 'ACCMGR', u.acc, 'post', '/mdm/common/banks', { data: { ifsc: 'HDFC0000240', bankName: 'HDFC Bank', branch: 'Fort', city: 'Mumbai', stateName: 'Maharashtra' } });
  await api(request, c, 'ACCMGR', u.acc, 'post', '/mdm/common/exchange-rates', { data: { currencyCode: 'USD', rateDate: IST(-1), rateToInr: '83.5' } });
  await api(request, c, 'ACCMGR', u.acc, 'post', '/mdm/common/exchange-rates', { data: { currencyCode: 'EUR', rateDate: IST(-1), rateToInr: '90.25' } });
  const shot = async (page, name, full = true) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: full }); };
  let n = 1;
  for (const page of PAGES) {
    const x = await open(browser, info, c, 'ACCMGR', u.acc, `/admin/master-data/common/${page}`);
    await expect(x.page.locator('[data-testid^="cm-row-"]').first()).toBeVisible();
    if (page === 'hsn-sac') { await x.page.getByTestId('cm-q-hsn-sac').fill('2523'); await expect(x.page.getByTestId('cm-row-hsn-sac')).toHaveCount(1); await x.page.getByTestId('cm-open-hsn-sac').click(); await expect(x.page.getByTestId('cmr-history')).toHaveCount(2); }
    await shot(x.page, `${String(n).padStart(2, '0')}-${page}`);
    n += 1;
    await x.context.close();
  }
  const m = await open(browser, info, c, 'SYSADM', u.sys, '/admin/master-data/lookup-manager?list=DELAY_CAUSE');
  await expect(m.page.getByTestId('llm-row').first()).toBeVisible();
  await shot(m.page, `${String(n).padStart(2, '0')}-lookup-list-manager`);
  const f = await open(browser, info, c, 'ACCMGR', u.acc, '/admin/master-data/common/gst-rates');
  await f.page.getByTestId('cm-new-gst-rates').click();
  await expect(f.page.getByTestId('cm-form-gst-rates')).toBeVisible();
  await shot(f.page, `${String(n + 1).padStart(2, '0')}-gst-rate-proposal`, false);
});
