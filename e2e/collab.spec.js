import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.14: the Discussion, Timeline and Trace tabs of a record (the sample document of the workflow engine), a thread with a reply, a reaction, an edit, a mention that is refused,
// the mentions inbox, the project activity feed, and a person without the right to the record.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const as = async (browser, info, company, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
  return page;
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
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

test('AC-01 AC-02 FR-01 FR-02 FR-03 FR-04 FR-05 Discussion, Timeline and Trace on a record; a thread, a reaction, an edit, a mention of no one, the mentions inbox and the project feed', async ({ browser, request }, info) => {
  test.setTimeout(100_000);
  const tag = info.project.name === 'mobile' ? 'M' : 'D';
  const c = await company(request, `COL${tag}`);
  const project = await api(request, c, 'PM', 'e2e-pm', 'post', '/iam/org/projects', { code: `CL${tag}1`, name: 'Ring Road', type: 'ROAD' });
  const doc = await api(request, c, 'PD', 'e2e-pd', 'post', '/eng/sample-docs', { title: 'Shuttering for the bridge', amount: '12000.00', projectId: project.id });
  await api(request, c, 'SYSADM', 'e2e-setup', 'post', '/iam/users', { displayName: 'Meera Pm', email: `meera.${tag}@example.com` }).catch(() => null);

  const pd = await as(browser, info, c, 'PD', 'e2e-pd', '/engine/sample-docs');
  const errors = watch(pd);
  await pd.getByRole('link', { name: doc.docNo, exact: true }).click();
  await expect(pd.getByTestId('collab-tabs')).toBeVisible();
  await expect(pd.getByRole('tab', { name: 'Discussion' })).toHaveAttribute('aria-selected', 'true');
  await expect(pd.getByText('No comments yet')).toBeVisible();
  // a comment, a reply and a reaction
  await pd.getByLabel('Add a comment').fill('Please confirm the quantity of sheets.');
  await pd.getByRole('button', { name: 'Post comment' }).click();
  await expect(pd.getByTestId('comment')).toHaveCount(1);
  await pd.getByRole('button', { name: 'Reply', exact: true }).first().click();
  await pd.getByLabel('Your reply').fill('Quantity confirmed: 40 sheets.');
  await pd.getByRole('button', { name: 'Reply', exact: true }).last().click();
  await expect(pd.getByTestId('comment')).toHaveCount(2);
  await pd.getByRole('button', { name: /^Acknowledged/ }).first().click();
  await expect(pd.getByRole('button', { name: 'Acknowledged, 1' }).first()).toHaveAttribute('aria-pressed', 'true');
  // an edit inside the window
  await pd.locator('.col-actions').first().getByRole('button', { name: 'Edit', exact: true }).click();
  await pd.getByLabel('Edit your comment').fill('Please confirm the quantity of sheets today.');
  await pd.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(pd.getByText('(edited)')).toBeVisible();
  // a name that is not a person is only text (a mention of a person who cannot see the record is refused: tests/collab.test.js BR-01)
  await pd.getByLabel('Add a comment').fill('Over to you @nobody-here');
  await pd.getByRole('button', { name: 'Post comment' }).click();
  await expect(pd.getByTestId('comment')).toHaveCount(3);
  // the timeline merges the sources, with filters
  await pd.getByRole('tab', { name: 'Timeline' }).click();
  await expect(pd.getByTestId('timeline-panel')).toBeVisible();
  await expect(pd.getByTestId('tl-comment').first()).toBeVisible();
  await pd.getByRole('button', { name: /^Comments/ }).click();
  await expect(pd.getByTestId('tl-audit')).toHaveCount(0);
  await pd.getByRole('button', { name: 'Everything' }).click();
  await expect(pd.getByTestId('tl-audit').first()).toBeVisible();
  // the trace of a record with no links
  await pd.getByRole('tab', { name: 'Trace' }).click();
  await expect(pd.getByTestId('trace-panel')).toBeVisible();
  await expect(pd.getByText('No source records')).toBeVisible();
  await expect(pd.getByText('No derived records')).toBeVisible();
  await noOverflow(pd);
  expect(errors).toEqual([]);

  // an amendment is linked to the document it amends by the system
  await api(request, c, 'SYSADM', 'e2e-setup', 'post', `/eng/sample-docs/${doc.id}/submit`, {}).catch(() => null);

  // the project activity feed
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', '/projects/activity');
  const e2 = watch(pm);
  await expect(pm.getByRole('heading', { name: 'Project Activity Feed', level: 1 })).toBeVisible();
  await pm.getByTestId('paf-project').selectOption(String(project.id));
  await expect(pm.getByTestId('tl-comment').first()).toBeVisible();
  await expect(pm.getByText(doc.docNo).first()).toBeVisible();
  await pm.getByRole('button', { name: /^Comments/ }).click();
  await expect(pm.getByTestId('tl-audit')).toHaveCount(0);
  await noOverflow(pm);
  expect(e2).toEqual([]);

  // the mentions inbox is part of the Notifications page
  const note = await as(browser, info, c, 'PM', 'e2e-pm', '/notifications');
  await expect(note.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(note.getByTestId('mentions-inbox')).toBeVisible();
  await expect(note.getByText('No unread mentions')).toBeVisible();
  await noOverflow(note);

  // a person without the right to the record
  const emp = await as(browser, info, c, 'EMP', 'e2e-emp', '/projects/activity');
  await expect(emp.getByRole('heading', { name: 'You do not have access to Project Activity Feed' })).toBeVisible();
  await expect(emp.getByText('col.activity.view')).toBeVisible();
  await noOverflow(emp);
});
