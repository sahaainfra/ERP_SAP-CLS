import { test, expect } from '@playwright/test';

// Both viewport projects share one database, so each test uses its own company per project.
const company = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const headers = (roles, companyId, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': companyId, 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}` });

async function open(page, roles, path, companyId, user = 'e2e-calc') {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: companyId });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  return errors;
}

const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};

test('AC-01 the registry lists every business calculation and the test bench shows result and trace', async ({ page }, info) => {
  const errors = await open(page, 'SYSADM', '/admin/formulas', company(info, '81', '82'), 'e2e-sys');
  await expect(page.getByRole('heading', { name: 'Formula Registry' })).toBeVisible();
  await expect(page).toHaveTitle(/Formula Registry/);
  for (const code of ['boq.line_amount', 'tax.gst_split', 'stock.weighted_average', 'billing.net_payable']) await expect(page.getByTestId(`formula-${code}`)).toBeVisible();
  await page.getByRole('searchbox').fill('stock');
  await expect(page.getByTestId('formula-tax.gst_split')).toHaveCount(0);
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'Open tax.gst_split' }).click();
  await expect(page.getByTestId('formula-detail')).toContainText('ACCMGR, then CFO');
  await expect(page.getByTestId('version-1')).toContainText('current');
  await expect(page.getByTestId('expression')).toContainText('half = gst_percent / 2');
  await page.getByTestId('bench-taxable').fill('1265.43');
  await page.getByTestId('bench-gst_percent').fill('18');
  await page.getByTestId('bench-supply').selectOption('intra');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('result-cgst')).toHaveText('113.89');
  await expect(page.getByTestId('result-total')).toHaveText('1493.21');
  await expect(page.getByTestId('trace')).toContainText('tax_total');
  await page.getByTestId('bench-taxable').fill('1.234');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'at most 2 decimal places' })).toBeVisible();
  await noOverflow(page);
  expect(errors.filter((e) => !/422/.test(e))).toEqual([]);
});

test('FR-03 / T-02 unit conversion on the page: an item factor chains with the generic one and beats a generic factor for the same pair', async ({ page, request }, info) => {
  const companyId = company(info, '83', '84');
  // Units and factors are shared by every company, so each run uses item codes of its own.
  const cement = `CEMENT_${companyId}`;
  const odd = `ODD_${companyId}`;
  const add = (body) => request.post('/api/v1/core/uom-conversions', { headers: headers('SYSADM', companyId, 'e2e-sys'), data: { reason: 'master data', ...body } });
  expect((await add({ from: 'BAG', to: 'KG', factor: '50', itemCode: cement })).status()).toBe(201);
  expect((await add({ from: 'MT', to: 'KG', factor: '990', itemCode: odd })).status()).toBe(201);
  await open(page, 'SYSADM', '/admin/formulas', companyId, 'e2e-sys');
  await page.getByText('Units of measure and conversions').click();
  await page.getByTestId('conv-from').selectOption('BAG');
  await page.getByTestId('conv-to').selectOption('MT');
  await page.getByTestId('conv-item').fill(cement);
  await page.getByRole('button', { name: 'Convert' }).click();
  await expect(page.getByTestId('conv-result')).toContainText('5.000');
  await expect(page.getByTestId('conv-result')).toContainText('(item)');
  await expect(page.getByTestId('conv-result')).toContainText('(generic)');
  await page.getByTestId('conv-from').selectOption('MT');
  await page.getByTestId('conv-to').selectOption('KG');
  await page.getByTestId('conv-item').fill(odd);
  await page.getByRole('button', { name: 'Convert' }).click();
  await expect(page.getByTestId('conv-result')).toContainText('99000.000');
  await page.getByTestId('conv-item').fill('');
  await page.getByRole('button', { name: 'Convert' }).click();
  await expect(page.getByTestId('conv-result')).toContainText('100000.000');
  await page.getByTestId('conv-from').selectOption('BAG');
  await page.getByTestId('conv-to').selectOption('KG');
  await page.getByRole('button', { name: 'Convert' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'no conversion from BAG to KG' })).toBeVisible();
  await noOverflow(page);
});

test('AC-02 / AC-03 a bill is calculated by the engine and "Show calculation" opens the steps and the formula version', async ({ page }, info) => {
  const errors = await open(page, 'PM', '/admin/sample-bills', company(info, '85', '86'), 'e2e-pm');
  await expect(page.getByRole('heading', { name: 'Sample Bills', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No sample bills yet' })).toBeVisible();
  await page.getByRole('button', { name: 'New sample bill' }).first().click();
  const dlg = page.getByRole('dialog', { name: 'New sample bill' });
  await dlg.getByLabel('Title').fill('Foundation concrete');
  await dlg.getByLabel('Quantity').fill('12.5');
  await dlg.getByLabel('Rate').fill('101.2345');
  await dlg.getByLabel('GST %').fill('18');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/saved\. Every amount was calculated by the server/)).toBeVisible();
  const row = page.getByTestId(/^bill-\d+$/).first();
  await expect(row).toContainText('1,265.43');
  await expect(row).toContainText('113.89');
  await expect(row).toContainText('1,493.21');
  await page.getByRole('button', { name: 'Show calculation of CGST for Foundation concrete' }).click();
  const trace = page.getByRole('dialog', { name: /How CGST was calculated/ });
  await expect(trace.getByTestId('trace-version')).toHaveText('1');
  await expect(trace.getByTestId('trace')).toContainText('tax.gst_split');
  await expect(trace.getByTestId('trace')).toContainText('round(taxable * half / 100, 2)');
  await expect(trace.getByTestId('trace')).toContainText('1265.43');
  await trace.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Show calculation of Taxable for Foundation concrete' }).click();
  await expect(page.getByRole('dialog', { name: /How Taxable was calculated/ }).getByTestId('trace')).toContainText('boq.line_amount');
  await page.getByRole('dialog', { name: /How Taxable was calculated/ }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Submit Foundation concrete' }).click();
  await expect(page.getByText(/submitted\. Its amounts and formula versions are now fixed/)).toBeVisible();
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('AC-06 a new version goes draft, shadow, comparison, request, two approvals and only then takes over', async ({ page, request }, info) => {
  const companyId = company(info, '87', '88');
  const code = `boq.e2e_${companyId}`; // formulas are shared by every company, so the scenario has a formula of its own
  const h = (roles, user) => headers(roles, companyId, user);
  const body = { description: 'Line amount to paise', expression: 'amount = round(quantity * rate, 2)', inputs: [{ name: 'quantity', type: 'quantity', min: '0' }, { name: 'rate', type: 'rate', min: '0' }], outputs: [{ name: 'amount', type: 'money' }], roundingPolicy: 'half_up', effectiveFrom: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10), tests: [{ inputs: { quantity: '12.5', rate: '101.2345' }, expect: { amount: '1265.43' } }] };
  expect((await request.post('/api/v1/core/formulas', { headers: h('SYSADM', 'e2e-sys'), data: { code, ownerModule: 'boq', financial: true, ...body, reason: 'a formula for this scenario' } })).status()).toBe(201);
  const first = await request.post(`/api/v1/core/formulas/${code}/versions/1/activation-requests`, { headers: h('SYSADM', 'e2e-sys'), data: { reason: 'activate version one' } });
  expect(first.status()).toBe(201);
  const requestId = (await first.json()).data.id;
  for (const [roles, user] of [['PCMGR', 'e2e-pcmgr'], ['CFO', 'e2e-cfo']]) {
    expect((await request.post(`/api/v1/core/change-requests/${requestId}/act`, { headers: h(roles, user), data: { action: 'approve', comment: 'ok' } })).status()).toBe(200);
  }

  const errors = await open(page, 'SYSADM', '/admin/formulas', companyId, 'e2e-sys');
  await page.getByRole('button', { name: `Open ${code}` }).click();
  await expect(page.getByTestId('version-1')).toContainText('current');
  await page.getByRole('button', { name: 'New version' }).click();
  const dlg = page.getByRole('dialog', { name: `New version of ${code}` });
  await dlg.getByLabel(/^Description/).fill('Line amount rounded to the nearest rupee');
  await dlg.getByLabel(/^Formula/).fill('amount = round(quantity * rate, 0)');
  await dlg.getByLabel(/^Test cases/).fill(JSON.stringify([{ inputs: { quantity: '12.5', rate: '101.2345' }, expect: { amount: '1265.00' } }]));
  await dlg.getByLabel(/^Effective from/).fill(new Date(Date.now() + 5.5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10));
  await dlg.getByLabel(/Reason/).fill('whole rupees for the pilot');
  await dlg.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Version 2 of boq\.e2e_\d+ saved as a draft/)).toBeVisible();
  await expect(page.getByTestId('version-2')).toContainText('draft');
  await expect(page.getByTestId('version-1')).toContainText('current');

  await page.getByRole('button', { name: 'Start shadow mode' }).click();
  const shadow = page.getByRole('dialog', { name: 'Start shadow mode' });
  await shadow.getByLabel(/Reason/).fill('compare on real bills first');
  await shadow.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText(/now runs beside the active version/)).toBeVisible();
  await expect(page.getByTestId('version-2')).toContainText('shadow');

  await page.getByRole('button', { name: 'See the comparison' }).click();
  await expect(page.getByRole('heading', { name: 'Shadow Comparison Report' })).toBeVisible();
  await expect(page.getByTestId('live-empty')).toBeVisible();
  await page.getByTestId('cmp-cases').fill(JSON.stringify([{ quantity: '12.5', rate: '101.2345' }, { quantity: '10', rate: '100' }, { quantity: '3', rate: '0.005' }, { quantity: '-1', rate: '1' }]));
  await page.getByLabel('Recent real calculations').fill('0');
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByTestId('cmp-result')).toBeVisible();
  await expect(page.getByTestId('cmp-cases-count')).toHaveText('4');
  await expect(page.getByTestId('cmp-differing')).toHaveText('2');
  await expect(page.getByTestId('cmp-identical')).toHaveText('2');
  await expect(page.getByTestId('case-1').first()).toContainText('1265.43');
  await expect(page.getByTestId('case-1').first()).toContainText('1265.00');
  await expect(page.getByTestId('case-4')).toContainText('at least 0');
  await noOverflow(page);
  await page.getByRole('link', { name: 'Back to the registry' }).click();

  await page.getByRole('button', { name: `Open ${code}` }).click();
  await page.getByRole('button', { name: 'Show version 2' }).click();
  await page.getByRole('button', { name: 'Request activation' }).click();
  const req = page.getByRole('dialog', { name: 'Request activation' });
  await req.getByLabel(/Reason/).fill('agreed with project controls and finance');
  await req.getByRole('button', { name: 'Send for approval' }).click();
  await expect(page.getByRole('status').filter({ hasText: /needs approval by PCMGR, then CFO/ })).toBeVisible();
  await expect(page.getByTestId('version-2')).toContainText('activation requested');

  const decide = async (roles, user, notYourTurn) => {
    const p = await page.context().newPage();
    await open(p, roles, '/admin/approvals', companyId, user);
    await expect(p.getByRole('heading', { name: 'Approvals' })).toBeVisible();
    const card = p.getByTestId(/^request-/).filter({ hasText: `Activate ${code} version 2` });
    await expect(card).toBeVisible();
    if (notYourTurn) {
      await expect(card).toContainText('It is not your turn');
      await expect(card.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
    } else {
      await expect(card).toContainText('Show the formula');
      await card.getByRole('button', { name: /^Approve/ }).click();
      await expect(p.getByText(/(approved, waiting for the next approver|approved and applied)/)).toBeVisible();
    }
    await p.close();
  };
  await decide('CFO', 'e2e-cfo', true);
  await decide('PCMGR', 'e2e-pcmgr', false);
  await decide('CFO', 'e2e-cfo', false);

  await page.reload();
  await page.getByRole('button', { name: `Open ${code}` }).click();
  await expect(page.getByTestId('version-2')).toContainText('future');
  await expect(page.getByTestId('version-1')).toContainText('current');
  await expect(page.getByTestId('version-1')).toContainText(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10));
  await noOverflow(page);
  expect(errors.filter((e) => !/40[0-9]/.test(e))).toEqual([]);
});

test('PM gets the no-access state on the registry and no navigation to it', async ({ page }, info) => {
  await open(page, 'PM', '/admin/formulas', company(info, '89', '90'), 'e2e-pm');
  await expect(page.getByRole('heading', { name: 'Formula Registry', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'You do not have access to the formula registry' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Formulas' })).toHaveCount(0);
});

test('Approvals: the requester cannot decide their own request and an empty inbox says so', async ({ page, request }, info) => {
  const companyId = company(info, '91', '92');
  await open(page, 'CFO', '/admin/approvals', companyId, 'e2e-cfo');
  await expect(page.getByRole('heading', { name: 'Nothing is waiting' })).toBeVisible();
  const code = `boq.e2e_inbox_${companyId}`;
  const created = await request.post('/api/v1/core/formulas', {
    headers: headers('SYSADM', companyId, 'e2e-sys'),
    data: { code, ownerModule: 'boq', financial: true, description: 'Rounded to rupees', expression: 'amount = round(quantity * rate, 0)', inputs: [{ name: 'quantity', type: 'quantity' }, { name: 'rate', type: 'rate' }], outputs: [{ name: 'amount', type: 'money' }], roundingPolicy: 'half_up', effectiveFrom: new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10), tests: [{ inputs: { quantity: '12.5', rate: '101.2345' }, expect: { amount: '1265.00' } }], reason: 'whole rupees' },
  });
  expect(created.status()).toBe(201);
  const asked = await request.post(`/api/v1/core/formulas/${code}/versions/1/activation-requests`, { headers: headers('SYSADM', companyId, 'e2e-sys'), data: { reason: 'activate rupees' } });
  expect(asked.status()).toBe(201);
  const sys = await page.context().newPage();
  await open(sys, 'SYSADM', '/admin/approvals', companyId, 'e2e-sys');
  const card = sys.getByTestId(/^request-/).filter({ hasText: `Activate ${code} version 1` });
  await expect(card).toContainText('You raised this request, so someone else must decide it');
  await noOverflow(sys);
});
