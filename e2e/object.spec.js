import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). The Object Page (part 03.04) on the reference record: the header and the buttons the server allows
// for three people, the tabs, the approval flow with its dialogs, the required-document checklist, discussion, timeline, print, amendment
// comparison, the error state with its correlation ID, and the feedback components. Each viewport works in its own company.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|403|404|409|422)/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const open = async (page, company, roles, path, user) => {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
};

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const current = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup') });
  const version = current.ok() ? (await current.json()).data?.version : undefined;
  const put = await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', company, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } });
  expect(put.status(), await put.text()).toBe(200);
  await post('/core/financial-years', 'SYSADM', company, { startDate: '2026-04-01' });
  await post('/core/number-series', 'SYSADM', company, { docType: 'SAMPLE_MR', name: 'Sample material requests', prefix: 'MR', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  const project = await post('/iam/org/projects', 'PM', company, { code: `${code}-P`, name: 'NH-48 Widening', type: 'ROAD' });
  const site = await post('/iam/org/sites', 'PM', company, { code: `${code}-S1`, name: 'Km 12 camp', projectId: project.id });
  const make = async (title, user) => {
    const r = await post('/ui/sample-requests', 'PM', company, { title, docDate: '2026-10-31', requiredBy: '2026-11-20', projectId: project.id, siteId: site.id, lines: [{ description: 'TMT bar 12 mm', uom: 'MT', quantity: '2.5', unitRate: '58000' }, { description: 'Binding wire', uom: 'KG', quantity: '100', unitRate: '82.5' }] }, user);
    return post(`/ui/sample-requests/${r.id}/submit`, 'PM', company, { version: r.version }, user);
  };
  return { company, make, project };
}

test('Object Page: the header and the buttons follow the viewer; checklist, discussion, approval, timeline and print work end to end', async ({ page, context, request }, info) => {
  test.setTimeout(150_000);
  test.skip(info.project.name === 'mobile', 'the phone layout has its own test');
  const w = await world(request, 'OBJD');
  const errors = watch(page);
  const r = await w.make('Footing F3 reinforcement', 'e2e-pm');
  await open(page, w.company, 'PM', `/admin/sample-requests?open=${r.id}`, 'e2e-pm');
  // the header: number, subtitle, chips, key figures, owner and dates
  await expect(page.getByRole('heading', { name: r.docNo })).toBeVisible();
  const head = page.getByTestId('op-header');
  await expect(head).toContainText('Footing F3 reinforcement');
  await expect(head).toContainText('Awaiting ACCMGR');
  await expect(page.getByTestId('fig-total')).toHaveText('1,53,250.00');
  await expect(head).toContainText('Requested by: e2e-pm');
  expect((await head.evaluate((el) => getComputedStyle(el).position))).toBe('sticky');
  // the owner may cancel; the approval buttons are off and say why (tooltip and the "why" list)
  await expect(page.getByTestId('action-cancel')).toHaveAttribute('aria-disabled', 'false');
  await expect(page.getByTestId('action-approve')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('action-approve')).toHaveAttribute('title', /You raised this request, so someone else must decide it/);
  await expect(page.getByTestId('action-edit')).toHaveCount(0);
  await page.getByText('Why are some actions off?').click();
  await expect(page.locator('.op-why')).toContainText('Approve: You raised this request');
  // the tabs, by keyboard too
  for (const t of ['Details', 'Lines', 'Attachments', 'Approvals', 'Timeline', 'Discussion', 'Related', 'Amendments']) await expect(page.getByRole('tab', { name: new RegExp(`^${t}`) })).toBeVisible();
  await page.getByRole('tab', { name: 'Details' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Lines' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('total-amount')).toHaveText('1,53,250.00');
  // attachments: the checklist asks for the indent; upload it as that document
  await page.getByRole('tab', { name: /^Attachments/ }).click();
  await expect(page.getByTestId('req-INDENT')).toContainText('needed before approval');
  await page.getByLabel('Which document this file is').selectOption('INDENT');
  await page.getByTestId('file-input').setInputFiles([{ name: 'indent-sheet.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') }]);
  await expect(page.getByTestId('req-INDENT')).toContainText('indent-sheet.pdf');
  await expect(page.getByTestId('req-INDENT')).toContainText('attached', { timeout: 20_000 });
  // discussion: a comment appears at once and on the timeline
  await page.getByRole('tab', { name: /^Discussion/ }).click();
  await expect(page.getByTestId('discussion-panel')).toContainText('No comments yet');
  await page.getByLabel('Add a comment').fill('Please look at the binding wire quantity.');
  await page.getByRole('button', { name: 'Post comment' }).click();
  await expect(page.getByTestId('comment')).toContainText('Please look at the binding wire quantity.');
  await page.getByRole('tab', { name: /^Timeline/ }).click();
  await expect(page.getByTestId('tl-comment')).toContainText('commented by e2e-pm');
  await expect(page.getByTestId('tl-audit').first()).toBeVisible();
  await page.getByRole('button', { name: 'Comments' }).click();
  await expect(page.getByTestId('tl-audit')).toHaveCount(0);
  await page.getByRole('tab', { name: /^Related/ }).click();
  await expect(page.getByTestId('empty-state')).toContainText('No related records');
  // print: a progress dialog while the PDF is made, then the download
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('action-print').click()]);
  expect(download.suggestedFilename()).toMatch(/^sample-request-MR-2026-27-\d{4}\.pdf$/);
  await expect(page.getByTestId('toast-success')).toContainText('is ready');
  // the approver, in another window: the document is attached, so Approve is allowed; approve with a comment
  const acc = await context.newPage();
  const accErrors = watch(acc);
  await open(acc, w.company, 'ACCMGR', `/admin/sample-requests?open=${r.id}&tab=approvals`, 'e2e-acc');
  await expect(acc.getByTestId('action-approve')).toHaveAttribute('aria-disabled', 'false');
  await expect(acc.getByTestId('action-cancel')).toHaveAttribute('aria-disabled', 'true');
  await expect(acc.getByTestId('action-cancel')).toHaveAttribute('title', /Only e2e-pm, who raised this request/);
  await expect(acc.getByTestId('approval-panel')).toContainText('Waiting for a decision');
  await expect(acc.getByTestId('sla')).toContainText(/Due in 23 h/);
  await expect(acc.getByTestId('evidence-slot')).toBeVisible();
  await acc.getByTestId('action-approve').click();
  await expect(acc.getByTestId('confirm-dialog')).toContainText('This is the last step');
  await acc.getByLabel('Comment (optional)').fill('Within the budget.');
  await acc.getByTestId('confirm-dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(acc.getByTestId('toast-success')).toContainText('Approve: done.');
  await expect(acc.getByTestId('op-header')).toContainText('Approved');
  await expect(acc.getByTestId('approval-history')).toContainText('e2e-acc');
  await expect(acc.getByTestId('approval-history')).toContainText('Within the budget.');
  await expect(acc.getByTestId('action-approve')).toHaveCount(0);
  await noOverflow(page);
  expect(errors).toEqual([]);
  expect(accErrors).toEqual([]);
});

test('Object Page: return with a reason code, amend and send again; the comparison marks what changed; the owner sees why it came back', async ({ page, context, request }, info) => {
  test.setTimeout(150_000);
  test.skip(info.project.name === 'mobile', 'the desktop run covers the flow; the phone layout has its own test');
  const w = await world(request, 'OBJR');
  const errors = watch(page);
  const r = await w.make('Pier P4 shuttering', 'e2e-pm');
  const acc = await context.newPage();
  await open(acc, w.company, 'ACCMGR', `/admin/sample-requests?open=${r.id}`, 'e2e-acc');
  await acc.getByTestId('action-return').click();
  // a reason code and words are required, and the dialog says so
  await acc.getByTestId('confirm-dialog').getByRole('button', { name: 'Return for changes' }).click();
  await expect(acc.getByTestId('confirm-dialog')).toContainText('Choose a reason.');
  await acc.getByTestId('reason-picker').getByLabel('Reason').selectOption('CORRECT_QUANTITY');
  await acc.getByTestId('confirm-dialog').getByRole('button', { name: 'Return for changes' }).click();
  await expect(acc.getByTestId('confirm-dialog')).toContainText('Explain in at least 5 characters.');
  await acc.getByTestId('reason-picker').getByLabel('Explain in a few words').fill('The binding wire is double what the pour needs');
  await acc.getByTestId('confirm-dialog').getByRole('button', { name: 'Return for changes' }).click();
  await expect(acc.getByTestId('toast-success')).toContainText('Return for changes: done.');
  await expect(acc.getByTestId('op-header')).toContainText('Returned');
  // the owner: the request is a draft again, with a banner; change it and send it again with the same number
  await open(page, w.company, 'PM', `/admin/sample-requests?open=${r.id}`, 'e2e-pm');
  await expect(page.getByTestId('returned-banner')).toContainText('keeps its number');
  await expect(page.getByRole('heading', { name: r.docNo })).toBeVisible();
  await page.getByTestId('action-edit').click();
  await expect(page.getByRole('heading', { name: new RegExp(`Change ${r.docNo.replace('/', '\\/')}`) })).toBeVisible();
  await page.locator('#f-title').fill('Pier P4 shuttering (revised)');
  await page.locator('#f-lines-1-quantity').fill('50');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('op-subtitle')).toHaveText('Pier P4 shuttering (revised)');
  await page.getByTestId('action-submit').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByTestId('toast-success').filter({ hasText: 'Submit for approval: done.' })).toBeVisible();
  await expect(page.getByTestId('op-header')).toContainText('Awaiting ACCMGR');
  await expect(page.getByRole('heading', { name: r.docNo })).toBeVisible();
  // the amendment comparison: the changed fields are marked
  await page.getByRole('tab', { name: /^Amendments/ }).click();
  await page.getByLabel('Older version').selectOption('1');
  await page.getByLabel('Newer version').selectOption('2');
  await expect(page.getByTestId('compare-summary')).toContainText('2 header field(s) changed; 1 line(s) changed, 0 added, 0 removed.');
  await expect(page.getByTestId('cmp-title')).toHaveClass(/op-changed/);
  await expect(page.getByTestId('cmp-title')).toContainText('Pier P4 shuttering (revised)');
  await expect(page.getByTestId('cmp-requiredBy')).not.toHaveClass(/op-changed/);
  await expect(page.getByTestId('cmp-line-changed')).toContainText('Quantity');
  await expect(page.getByTestId('cmp-line-same')).toBeVisible();
  // both approval rounds are on the Approvals tab
  await page.getByRole('tab', { name: /^Approvals/ }).click();
  await expect(page.getByTestId('approval-history')).toContainText('Correct the quantities or rates: The binding wire is double');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('T-02 a missing record shows the error state with the correlation ID the page sent; a person without the right sees what is missing', async ({ page, request }, info) => {
  const w = await world(request, pick(info, 'OBJED', 'OBJEM'));
  const sent = [];
  page.on('request', (rq) => { if (/\/api\/v1\/ui\/sample-requests\/987654/.test(rq.url())) sent.push(rq.headers()['x-correlation-id']); });
  await open(page, w.company, 'PM', '/admin/sample-requests?open=987654', pick(info, 'e2e-err-d', 'e2e-err-m'));
  const state = page.getByTestId('error-state');
  await expect(state).toContainText('Could not find this request');
  await expect(state).toContainText('does not exist');
  const shown = await page.getByTestId('correlation-id').textContent();
  expect(sent.length).toBeGreaterThan(0);
  expect(shown).toBe(sent[0]);
  await noOverflow(page);
  // no permission: a role without core.sample.use opening the register's list
  await open(page, w.company, 'EMP', '/admin/sample-requests', pick(info, 'e2e-emp-d', 'e2e-emp-m'));
  await expect(page.getByTestId('no-permission')).toContainText('This needs the core.sample.use permission');
  await noOverflow(page);
});

test('T-04 the Object Page at phone width: no horizontal page scroll, tabs scroll inside their bar, the buttons are reachable', async ({ page, request }, info) => {
  const w = await world(request, pick(info, 'OBJMD', 'OBJMM'));
  const errors = watch(page);
  const r = await w.make('Retaining wall R2', 'e2e-pm');
  await open(page, w.company, 'PM', `/admin/sample-requests?open=${r.id}`, 'e2e-pm');
  await expect(page.getByRole('heading', { name: r.docNo })).toBeVisible();
  await noOverflow(page);
  for (const t of ['Lines', 'Approvals', 'Timeline', 'Discussion', 'Related']) {
    await page.getByRole('tab', { name: new RegExp(`^${t}`) }).click();
    await noOverflow(page);
  }
  await expect(page.getByTestId('action-cancel')).toBeVisible();
  await page.getByRole('tab', { name: /^Lines/ }).click();
  await expect(page.getByTestId('total-amount')).toBeVisible();
  expect(errors).toEqual([]);
});

test('Feedback components: toasts, banners, confirmation with a reason code, the progress dialog, the offline banner and the standard states', async ({ page }, info) => {
  const errors = watch(page);
  await open(page, 1, 'SYSADM', '/admin/design-system/object-page', pick(info, 'e2e-fb-d', 'e2e-fb-m'));
  await expect(page.getByRole('heading', { name: 'Object Page', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Success toast' }).click();
  await expect(page.getByTestId('toast-success')).toContainText('Saved. The request is a draft.');
  await page.getByRole('button', { name: 'Error toast (stays until closed)' }).click();
  await expect(page.getByTestId('toast-error')).toBeVisible();
  await page.getByTestId('toast-error').getByRole('button', { name: 'Dismiss this message' }).click();
  await expect(page.getByTestId('toast-error')).toHaveCount(0);
  await page.getByTestId('demo-banner').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await page.getByRole('button', { name: 'Confirmation with a reason code' }).click();
  const dlg = page.locator('dialog[open][data-testid="confirm-dialog"]');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Cancel request' }).click();
  await expect(dlg).toContainText('Choose a reason.');
  await dlg.getByTestId('reason-picker').getByLabel('Reason').selectOption('DUPLICATE');
  await dlg.getByTestId('reason-picker').getByLabel('Explain in a few words').fill('Entered twice by mistake');
  await dlg.getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.getByTestId('toast-success').last()).toContainText('Cancelled with the reason DUPLICATE.');
  await page.getByRole('button', { name: 'Progress dialog' }).click();
  await expect(page.getByTestId('progress-dialog')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Preparing the report' })).toBeVisible();
  await expect(page.getByTestId('progress-dialog')).toBeHidden({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Show the offline banner' }).click();
  await expect(page.getByTestId('offline-banner')).toContainText('You are offline');
  await page.getByRole('button', { name: 'Back online' }).click();
  await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  for (const id of ['skeleton', 'empty-state', 'error-state', 'no-permission']) await expect(page.getByTestId(id).first()).toBeVisible();
  await expect(page.getByTestId('correlation-id')).toHaveText('3f2c1a9e-7b44-4d51-9b58-0c2a6f1d9e10');
  await noOverflow(page);
  expect(errors).toEqual([]);
});
