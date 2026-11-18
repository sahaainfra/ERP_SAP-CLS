import { test, expect } from '@playwright/test';

// Development-header mode. Part 23.01 in the browser (ff.fin.p2301 is ON in test), on the desktop and on a 360 px phone:
//  AC-01 a manual journal typed with its dimensions (the project the account asks for), balanced live, sent for approval, approved and posted by the accounts manager;
//  T-01 not balanced: the totals say so and it cannot be sent; the account ledger with its running balance and a link back to the voucher; the trial balance balances
//  and opens the ledger of an account. Screenshots of the four pages (docs/erp/screenshots/23.01).
const SHOTS = 'docs/erp/screenshots/23.01';
const shot = (page, info, name) => page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png`, fullPage: false });
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const as = async (browser, info, { user, roles, company }) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch, reducedMotion: 'reduce' });
  await context.addInitScript(([v]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })); }, [{ user, roles, company: String(company) }]);
  return { context, page: await context.newPage() };
};
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

async function world(request, code) {
  const post = async (path, roles, company, data) => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, 'e2e-setup'), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const fy = await request.post('/api/v1/core/financial-years', { headers: H('SYSADM', company, 'e2e-setup'), data: { startDate: '2026-04-01' } }); expect(fy.status(), await fy.text()).toBeLessThan(300);
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Ledger Flyover', type: 'BRIDGE' })).id;
  const opt = await request.get('/api/v1/fin/journals/options', { headers: H('FINEX', company, 'e2e-fin') }); expect(opt.status(), await opt.text()).toBe(200);
  const accounts = (await opt.json()).data.accounts; const acct = (c) => accounts.find((a) => a.code === c).id;
  return { company, project, overheads: acct('560004'), bank: acct('150002') };
}

test('AC-01 T-01 a manual journal typed with its dimensions, balanced live, approved and posted; the ledger and the trial balance', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'GLM' : 'GLD');
  const fin = await as(browser, info, { user: 'e2e-fin', roles: 'FINEX', company: w.company });
  await fin.page.goto('/finance/journal-entry');
  await expect(fin.page.getByTestId('gl-entry')).toBeVisible();
  await fin.page.getByTestId('gl-date').fill('2026-06-15');
  await fin.page.getByTestId('gl-narration').fill('Generator hire for June');
  await fin.page.getByTestId('gl-account-1').selectOption(String(w.overheads));
  await expect(fin.page.getByTestId('gl-projectId-1')).toBeVisible(); // the account asks for a project (its 06.05 rule)
  await fin.page.getByTestId('gl-projectId-1').selectOption(String(w.project));
  await fin.page.getByTestId('gl-debit-1').fill('25000.75');
  await fin.page.getByTestId('gl-account-2').selectOption(String(w.bank));
  await fin.page.getByTestId('gl-credit-2').fill('25000');
  await expect(fin.page.getByTestId('gl-balance-state')).toHaveAttribute('data-balanced', 'no');
  await expect(fin.page.getByTestId('gl-save-submit')).toBeDisabled();
  await fin.page.getByTestId('gl-credit-2').fill('25000.75');
  await expect(fin.page.getByTestId('gl-balance-state')).toHaveAttribute('data-balanced', 'yes');
  await expect(fin.page.getByTestId('gl-total-debit')).toContainText('25,000.75');
  if (phone) await noOverflow(fin.page);
  await shot(fin.page, info, 'manual-journal');
  await fin.page.getByTestId('gl-save-submit').click();
  await expect(fin.page.getByTestId('gl-journal')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(fin.page.url()).searchParams.get('id');
  await expect(fin.page.getByTestId('gl-approve')).toHaveCount(0); // the maker never approves (SoD-03)

  const acc = await as(browser, info, { user: 'e2e-acc', roles: 'ACCMGR', company: w.company });
  await acc.page.goto(`/finance/journals?id=${id}`);
  await expect(acc.page.getByTestId('gl-decide')).toBeVisible();
  await acc.page.getByTestId('gl-approve').click();
  await expect(acc.page.getByTestId('gl-journal')).toHaveAttribute('data-status', 'APPROVED');
  await expect(acc.page.getByTestId('gl-facts')).toContainText('JV/2026-27/000001');
  await expect(acc.page.getByTestId('gl-line-1')).toContainText(phone ? 'GLMP' : 'GLDP'); // the project of the line, as a dimension chip
  if (phone) await noOverflow(acc.page);

  await acc.page.goto('/finance/journals');
  await expect(acc.page.getByText('JV/2026-27/000001').first()).toBeVisible();
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'journals');

  await acc.page.goto(`/finance/ledger?accountId=${w.overheads}&from=2026-04-01&to=2026-06-30`);
  await expect(acc.page.getByTestId('gl-ledger-row')).toHaveCount(1);
  await expect(acc.page.getByTestId('gl-ledger-closing')).toContainText('25,000.75 Dr');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'account-ledger');
  await acc.page.getByTestId('gl-ledger-row').getByRole('link', { name: 'JV/2026-27/000001' }).click();
  await expect(acc.page.getByTestId('gl-journal')).toHaveAttribute('data-status', 'APPROVED');

  await acc.page.goto('/finance/trial-balance?asOf=2026-06-30');
  await expect(acc.page.getByTestId('gl-tb-state')).toHaveAttribute('data-balanced', 'yes');
  await expect(acc.page.getByTestId('gl-tb-dr')).toContainText('25,000.75');
  await expect(acc.page.getByTestId('gl-tb-cr')).toContainText('25,000.75');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'trial-balance');
  await acc.page.getByTestId('gl-tb-row').filter({ hasText: '560004' }).getByRole('link').click();
  await expect(acc.page.getByTestId('gl-ledger-row')).toHaveCount(1);
  await fin.context.close(); await acc.context.close();
});
