import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// PACK-10 (ff.list.pack10). Development-header mode (port 3100).
// 1. A bulk action over rows that include one the person may not act on: the preview names it and why, the action runs on the
//    allowed rows only, the forbidden row is untouched.
// 2. Phone cards: a plain table (no data-label) gets its column names as captions below 640 px; with the flag off it does not.
// 3. A list of 10,000 rows, paged by the server: the page opens and pages with its main thread never blocked for long.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const open = async (page, company, roles, path, user) => {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
};
async function world(request, code, { flag = true } = {}) {
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
  if (flag) {
    const f = await request.patch('/api/v1/core/feature-flags/ff.list.pack10', { headers: H('SYSADM', company, 'e2e-setup'), data: { scope: { level: 'company', companyId: company }, enabled: true, reason: 'e2e: PACK-10' } });
    expect(f.status(), await f.text()).toBe(200);
  }
  const project = await post('/iam/org/projects', 'PM', company, { code: `${code}-P`, name: 'NH-48 Widening', type: 'ROAD' });
  return { company, project, post };
}

test('PACK-10 a bulk action with a forbidden row: the preview names it and why, only the allowed rows are done', async ({ page, request }, info) => {
  test.setTimeout(90_000);
  const w = await world(request, pick(info, 'BPVD', 'BPVM'));
  const me = pick(info, 'e2e-bulk-d', 'e2e-bulk-m');
  const mk = (title, user) => w.post('/ui/sample-requests', 'PM', w.company, { title, docDate: '2026-11-02', requiredBy: '2026-12-20', projectId: w.project.id, lines: [{ description: 'Cement OPC 53', uom: 'BAG', quantity: '10', unitRate: '400' }] }, user);
  const mine1 = await mk('Mine one', me);
  const mine2 = await mk('Mine two', me);
  const theirs = await mk('Somebody else', 'e2e-else');
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await open(page, w.company, 'PM', '/admin/sample-requests', me);
  await expect(page.getByText('3 requests, page 1 of 1')).toBeVisible();
  for (const box of await page.getByRole('checkbox', { name: /^Select (?!every)/ }).all()) await box.check();
  await expect(page.getByTestId('bulk-bar')).toContainText('3 selected');

  await page.getByRole('button', { name: 'Submit selected' }).click();
  const preview = page.getByTestId('bulk-preview');
  await expect(preview).toContainText('Submit selected: 2 of the 3 selected rows can be done.');
  const refused = page.getByTestId('bulk-preview-refused');
  await expect(refused.getByRole('listitem')).toHaveCount(1);
  await expect(refused.locator(`li[data-id="${theirs.id}"]`)).toContainText('Only e2e-else, who raised this request, can do this.');
  await expect(page.getByRole('heading', { name: /2 of the 3 selected rows/ })).toBeFocused();
  await page.getByTestId('bulk-preview-go').click();
  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toContainText('Submit 2 request(s)?');
  await dialog.getByRole('button', { name: 'Submit selected' }).click();
  await expect(page.getByTestId('bulk-result')).toContainText('Submit selected: 2 done.');

  const status = async (id) => (await (await request.get(`/api/v1/ui/sample-requests/${id}`, { headers: H('PM', w.company, me) })).json()).data.status;
  expect(await status(mine1.id)).toBe('SUBMITTED');
  expect(await status(mine2.id)).toBe('SUBMITTED');
  expect(await status(theirs.id)).toBe('DRAFT');
  expect(errors).toEqual([]);
});

const PLAIN = `<table id="pack10-plain"><thead><tr><th>Item</th><th colspan="2">Quantity and unit</th><th>Rate</th></tr></thead>
  <tbody><tr><td>Cement</td><td>10</td><td>BAG</td><td data-label="Own label">400</td></tr><tr><td colspan="4">No more rows</td></tr></tbody></table>`;

test('PACK-10 phone cards: a plain table gets its column names as captions; a label set by the page is kept; flag off adds nothing', async ({ browser, request }, info) => {
  test.skip(info.project.name !== 'mobile', 'captions are for phone-sized screens');
  const on = await world(request, 'BPCM');
  const off = await world(request, 'BPCO', { flag: false });
  const { baseURL, viewport, hasTouch } = info.project.use;
  for (const [w, user, expectOn] of [[on, 'e2e-cap-on', true], [off, 'e2e-cap-off', false]]) {
    const context = await browser.newContext({ baseURL, viewport, hasTouch });
    const page = await context.newPage();
    await open(page, w.company, 'PM', '/admin/sample-requests', user);
    await expect(page.getByText(/requests?|No .* yet/).first()).toBeVisible();
    await page.waitForTimeout(500); // the flag is read
    await page.evaluate((html) => { const d = document.createElement('div'); d.innerHTML = html; document.querySelector('main')?.append(d) ?? document.body.append(d); }, PLAIN);
    const cells = page.locator('#pack10-plain tbody tr').first().locator('td');
    if (expectOn) {
      await expect(cells.nth(0)).toHaveAttribute('data-label', 'Item');
      await expect(cells.nth(1)).toHaveAttribute('data-label', 'Quantity and unit');
      await expect(cells.nth(2)).toHaveAttribute('data-label', 'Quantity and unit');
      await expect(cells.nth(3)).toHaveAttribute('data-label', 'Own label');
      await expect(page.locator('#pack10-plain tbody tr').nth(1).locator('td')).not.toHaveAttribute('data-label', /.+/);
      // the caption is drawn (the stylesheet writes data-label above the value)
      expect(await cells.nth(0).evaluate((td) => getComputedStyle(td, '::before').content)).toBe('"Item"');
    } else {
      await page.waitForTimeout(300);
      await expect(cells.nth(0)).not.toHaveAttribute('data-label', /.+/);
    }
    await context.close();
  }
});

test('PACK-10 a list of 10,000 rows (paged by the server) opens and pages without long blocking of the main thread', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const w = await world(request, pick(info, 'BTKD', 'BTKM'));
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 15000'); // the server and other specs write to the same file at the same time
  const ins = db.prepare("INSERT INTO ui_sample_requests (company_id, doc_no, doc_date, status, title, project_id, requested_by, required_by, priority, total_amount, line_count, created_by, created_at, source_type) VALUES (?, ?, ?, ?, ?, ?, 'e2e-big', '2026-12-31', 'NORMAL', ?, 1, 'e2e', ?, 'e2e')");
  db.exec('BEGIN');
  for (let i = 1; i <= 10_000; i += 1) ins.run(w.company, `MR/BIG/${String(i).padStart(6, '0')}`, `2026-${String((i % 7) + 4).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, i % 3 ? 'SUBMITTED' : 'CANCELLED', `Lot ${i} ${i % 2 ? 'cement' : 'steel'}`, w.project.id, (i % 97) * 10_000, '2026-11-01T00:00:00.000Z');
  db.exec('COMMIT');
  db.close();

  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true });
  });
  const t0 = Date.now();
  await open(page, w.company, 'PM', '/admin/sample-requests', pick(info, 'e2e-big-d', 'e2e-big-m'));
  await expect(page.getByText(/10,?000 requests, page 1 of/)).toBeVisible({ timeout: 30_000 });
  const firstPaint = Date.now() - t0;
  const reset = () => page.evaluate(() => { const w0 = window.__long; window.__long = []; return w0; });
  const onOpen = await reset();
  // the next page: answered by the server, the page draws only its rows
  const pager = page.getByRole('button', { name: /Next page|Next/ }).first();
  const t1 = Date.now();
  await pager.click();
  await expect(page.getByText(/10,?000 requests, page 2 of/)).toBeVisible();
  const pageMs = Date.now() - t1;
  const onPage = await reset();
  // the largest page the server gives (200 rows): drawn without a long block
  const t2 = Date.now();
  await page.getByLabel('Rows per page').selectOption('200');
  await expect(page.getByText(/10,?000 requests, page 1 of 50/)).toBeVisible();
  const bigMs = Date.now() - t2;
  const onBig = await reset();
  const rows = await page.locator('tbody tr, [data-testid="list-cards"] > *').count();
  const m = { project: info.project.name, firstPaintMs: firstPaint, nextPageMs: pageMs, page200Ms: bigMs, rowsDrawn: rows, longTasksOnOpenMs: onOpen, longTasksOnPageMs: onPage, longTasksOn200Ms: onBig };
  info.annotations.push({ type: 'measure', description: JSON.stringify(m) });
  console.log('PACK-10 10k list', JSON.stringify(m));
  expect(rows).toBeLessThanOrEqual(200);
  expect(Math.max(0, ...onPage), 'no long task over 200 ms when paging').toBeLessThan(200);
  expect(Math.max(0, ...onBig), 'no long task over 400 ms drawing 200 rows').toBeLessThan(400);
  expect(pageMs).toBeLessThan(3000);
});
