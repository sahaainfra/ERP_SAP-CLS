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

// Screenshots of the 06.05 pages for docs/erp/screenshots/finance. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/finance';
test('screenshots of the finance master pages', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  void watch; void noOverflow;
  const c = await company(request, phone ? 'FSSM' : 'FSSD');
  const t = phone ? 'fssm' : 'fssd';
  people(c, [[`${t}-acc`, ['ACCMGR'], 'Anita Accounts'], [`${t}-cfo`, ['CFO'], 'Chitra CFO']]);
  const chart = await api(request, c, 'ACCMGR', `${t}-acc`, 'get', '/fin/accounts');
  const mat = chart.accounts.find((a) => a.code === '510001');
  const g = chart.groups.find((x) => x.code === '5600');
  await api(request, c, 'ACCMGR', `${t}-acc`, 'post', '/fin/accounts', { code: '560030', name: 'Site security services', groupId: g.id, type: 'EXPENSE', normalBalance: 'DR', dimensions: { PROJECT: 'MANDATORY' }, reason: 'security guards at the sites' });
  const shot = async (path, name, prep) => {
    const { page, context } = await open(browser, info, c, 'ACCMGR', `${t}-acc`, path);
    await page.waitForLoadState('networkidle');
    if (prep) await prep(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: !phone });
    await context.close();
  };
  await shot('/finance/chart-of-accounts', 'chart-of-accounts', (p) => expect(p.getByTestId('coa-account').first()).toBeVisible());
  await shot('/finance/chart-of-accounts?tab=schedule', 'schedule-iii', (p) => expect(p.getByTestId('coa-s3-status')).toBeVisible());
  await shot('/finance/chart-of-accounts?tab=import', 'import-report', async (p) => { await p.getByTestId('coa-import-text').fill('Name,Under\nUltratech Cement Ltd,Sundry Creditors\nHDFC Bank CA 0042,Bank Accounts\nOutput CGST 9%,Duties & Taxes\nSuspense,Suspense A/c'); await p.getByTestId('coa-import-preview').click(); await expect(p.getByTestId('coa-import-summary')).toBeVisible(); });
  await shot(`/finance/accounts/account?id=${mat.id}`, 'account', async (p) => { await p.getByTestId('acc-probe-check').click(); await expect(p.getByTestId('acc-probe-result')).toBeVisible(); });
  await shot(`/finance/accounts/account?id=${mat.id}&tab=dimensions`, 'account-dimensions', (p) => expect(p.getByTestId('acc-dim').first()).toBeVisible());
  await shot('/finance/cost-codes', 'cost-codes', async (p) => { await p.getByTestId('cc-head').filter({ hasText: '1.1 Cement' }).click(); await expect(p.getByTestId('cc-detail')).toBeVisible(); });
  await shot('/finance/category-mapping', 'category-mapping', (p) => expect(p.getByTestId('cm-status')).toBeVisible());
});
