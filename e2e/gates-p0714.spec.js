import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 07.14 (built in 166.6, ff.hr.p0714 ON in test): the workforce dashboard (the site cards first), the
// programme gates, a gate's criteria reviewed on its page with their evidence, sign-off refused while a criterion is open, the PDF report, and a
// gate signed by the technical lead and the director shown as passed with its sign-off.
const SHOTS = 'docs/erp/screenshots/166.6';
const shot = (page, info, name, fullPage = true) => page.screenshot({ path: `${SHOTS}/after-${name}-${info.project.name}.png`, fullPage });
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const open = async (page, { user, roles, company = '1', path }) => {
  await page.addInitScript(([v]) => {
    if (sessionStorage.getItem('erp.test.identity-set')) return;
    localStorage.setItem('erp.dev.identity', JSON.stringify(v));
    localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' }));
    sessionStorage.setItem('erp.test.identity-set', '1');
  }, [{ user, roles, company: String(company) }]);
  await page.goto(path);
};
function errorsOf(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function company(request, code) {
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-setup'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBeLessThan(300);
  return (await res.json()).data.id;
}

test('the workforce dashboard: attendance today and contract labour first, each card from its HR service, no sideways scroll on a phone', async ({ page }, info) => {
  const errors = errorsOf(page);
  await open(page, { user: 'e2e-wf-hr', roles: 'HRMGR', path: '/hr/workforce' });
  await expect(page.getByRole('heading', { name: 'Workforce Dashboard', level: 1 })).toBeVisible();
  const order = await page.locator('[data-testid^="widget-ov.wf."]').evaluateAll((els) => els.map((e) => e.dataset.widget));
  expect(order.slice(0, 3)).toEqual(['ov.wf.attendance_today', 'ov.wf.present', 'ov.wf.labour_on_site']);
  expect(order).toHaveLength(9);
  await expect(page.getByTestId('widget-ov.wf.present').getByTestId('widget-source')).toHaveText("Source: Attendance, today's report");
  await expect(page.getByTestId('widget-ov.wf.overtime')).toContainText('No overtime budget is set');
  if (info.project.name === 'mobile') expect(await noSidewaysScroll(page)).toBe(true);
  await shot(page, info, 'workforce');
  expect(errors).toEqual([]);
});

test('T-G2 a gate page: evidence opens, a criterion is met or not met with a reason, sign-off is refused while criteria are open, the report downloads', async ({ page, context, request }, info) => {
  const errors = errorsOf(page);
  const c = await company(request, info.project.name === 'desktop' ? 'GTD6' : 'GTM6'); // the gates of a company of its own: the runs do not share a review
  await open(page, { user: `e2e-gate-it-${info.project.name}`, roles: 'ITADM', company: c, path: '/admin/gates' });
  await expect(page.getByRole('heading', { name: 'Programme Gates', level: 1 })).toBeVisible();
  for (const g of ['G1', 'G2', 'G3', 'G4']) await expect(page.getByTestId(`gate-${g}`)).toBeVisible();
  await expect(page.getByTestId('gates-derived')).toContainText('derived');
  await shot(page, info, 'gates');
  await page.getByTestId('gate-G2').getByRole('link', { name: /G2 Workforce-First Gate/ }).click();
  await expect(page.getByRole('heading', { name: 'G2 Workforce-First Gate', level: 1 })).toBeVisible();
  // the evidence of a criterion opens (a new tab with the document)
  const crit = page.getByTestId('criterion-G2-P07.01');
  const [doc] = await Promise.all([context.waitForEvent('page'), crit.getByTestId('evidence-open').first().click()]);
  await doc.waitForLoadState();
  expect(doc.url()).toMatch(/^blob:/);
  await doc.close();
  // not met needs a reason: the server says so on the criterion
  await crit.getByRole('button', { name: 'Not met', exact: true }).click();
  await expect(crit.getByRole('alert')).toContainText('Say why the criterion is not met');
  await crit.getByLabel('Note').fill('the phone screenshots are missing');
  await crit.getByRole('button', { name: 'Not met', exact: true }).click();
  await expect(crit).toHaveAttribute('data-status', 'NOT_MET');
  await expect(crit).toContainText('the phone screenshots are missing');
  await crit.getByRole('button', { name: 'Met', exact: true }).click();
  await expect(crit).toHaveAttribute('data-status', 'MET');
  // T-G2: the button stays off while any criterion is open
  await expect(page.getByTestId('gate-submit')).toBeDisabled();
  await expect(page.getByTestId('gate-blocked')).toContainText('still to do');
  if (info.project.name === 'mobile') expect(await noSidewaysScroll(page)).toBe(true);
  await shot(page, info, 'gate-g2-review', false);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('gate-report').click()]);
  expect(download.suggestedFilename()).toBe('gate-G2-report.pdf');
  expect(errors).toEqual([]);
});

test('a gate signed by the technical lead and the director is shown as passed, with its sign-off', async ({ page, request }, info) => {
  test.skip(info.project.name !== 'desktop', 'one company and one sign-off are enough');
  test.setTimeout(120_000);
  const c = await company(request, 'GTE6');
  const call = async (method, path, roles, user, data) => {
    const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), ...(data ? { data } : {}) });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const g3 = await call('get', '/hr/gates/G3', 'ITADM', 'e2e-g3-it1');
  for (const cr of g3.criteria) await call('post', `/hr/gates/G3/criteria/${cr.code}`, 'ITADM', 'e2e-g3-it1', { status: 'MET', note: 'evidence read' });
  await call('post', '/hr/gates/G3/submit', 'ITADM', 'e2e-g3-it1', {});
  for (const [roles, user] of [['ITADM', 'e2e-g3-it2'], ['DIR', 'e2e-g3-dir']]) {
    const task = (await call('get', '/workflow/tasks?mine=assigned', roles, user)).rows.find((t) => t.instance.docType === 'HR_GATE');
    await call('post', `/workflow/tasks/${task.id}/act`, roles, user, { action: 'approve', comment: 'signed' });
  }
  await open(page, { user: 'e2e-g3-dir', roles: 'DIR', company: c, path: '/admin/gate?code=G3' });
  await expect(page.getByRole('heading', { name: 'G3 Project Baseline Gate', level: 1 })).toBeVisible();
  await expect(page.getByTestId('gate')).toHaveAttribute('data-status', 'PASSED');
  const signoff = page.getByRole('region', { name: 'Sign-off' });
  await expect(signoff).toContainText('Technical lead (ITADM) · e2e-g3-it2: approved');
  await expect(signoff).toContainText('Director (DIR) · e2e-g3-dir: approved');
  await shot(page, info, 'gate-g3-passed', false);
});
