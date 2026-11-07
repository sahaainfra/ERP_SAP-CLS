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
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

const OUT = 'docs/erp/screenshots/boq';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['qs', ['QS']], ['qs2', ['QS']], ['est', ['EST']], ['com', ['COMMGR']], ['pm', ['PM']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Ring road package 2', 'ROAD')").run(c, `${t.toUpperCase()}-R`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, created_by) VALUES (?, ?, 'e2e')").run(c, id);
  const w = (code, name) => Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, weight, created_by) VALUES (?, ?, ?, ?, 1, 500000, 'e2e')").run(c, id, code, name).lastInsertRowid);
  w('1', 'Earthwork'); w('2', 'Pavement');
  db.close();
  return { u: (k) => `${t}-${k}`, id, code: `${t.toUpperCase()}-R` };
}
const sheet = (bad) => ['Bill\tSection\tItem No\tDescription of work\tUnit\tQty\tRate (Rs)',
  'Bill 1 Roadwork\tEarthwork\t1.01\tExcavation in soil\tCUM\t1200\t185.50', 'Bill 1 Roadwork\tEarthwork\t1.02\tEmbankment with approved material\tCUM\t850\t310.25',
  `Bill 1 Roadwork\tPavement\t${bad ? '' : '2.01'}\tDense bituminous macadam 50 mm\tCUM\t95\t9250.75`, `Bill 1 Roadwork\tPavement\t2.02\tBituminous concrete 30 mm\tCUM\t${bad ? 'forty' : '40'}\t9890.00`].join('\n');

// Part 10.04: the quantity surveyor imports the client's BOQ with the column wizard (the wrong rows are listed with their row numbers and nothing is made, then the corrected sheet is imported as a tender version), maps items to WBS nodes (the splits must
// sum to the quantity; several items at once to one node), keeps resource norms, makes the contract version, which the estimator sends for the freeze and QS, the commercial manager and the project manager approve; after that the BOQ is immutable, a change
// of mapping is a request approved by a second QS and the project manager; the reports show the abstract, the comparison and the unmapped items; a site engineer sees no rates. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 client BOQ imported with the wizard, mapped to the WBS with norms, frozen with approval, and reported, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'BQM' : 'BQD');
  const t = phone ? 'bqm' : 'bqd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const qs = await open(browser, info, c, 'QS', g.u('qs'), '/proj/boq-import');
  const errors = watch(qs.page);
  await expect(qs.page.getByTestId('boq-import-wizard')).toBeVisible();
  await qs.page.getByTestId('imp2-project').selectOption(String(g.id)); await qs.page.getByTestId('imp2-name').fill('Client BOQ, package 2');
  // step 1: the sheet with two wrong rows; step 2: the columns are guessed from the headings; step 3: the rows to correct
  await qs.page.getByTestId('imp2-text').fill(sheet(true)); await expect(qs.page.getByTestId('imp2-count')).toContainText('4');
  await qs.page.getByTestId('imp2-next1').click();
  await expect(qs.page.getByTestId('imp2-missing')).toHaveCount(0);
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '01-import-map');
  await qs.page.getByTestId('imp2-next2').click();
  await expect(qs.page.getByTestId('imp2-errors-count')).toHaveText('2');
  await expect(qs.page.getByTestId('imp2-error-row').first()).toContainText('4'); await expect(qs.page.getByTestId('imp2-error-row').nth(1)).toContainText('5');
  await expect(qs.page.getByTestId('imp2-commit')).toBeDisabled();
  await shot(qs.page, '02-import-errors');
  // the corrected sheet: the total is shown before anything is made
  await qs.page.getByRole('button', { name: /^Back$/ }).click(); await qs.page.getByRole('button', { name: /^Back$/ }).click();
  await qs.page.getByTestId('imp2-text').fill(sheet(false)); await qs.page.getByTestId('imp2-next1').click(); await qs.page.getByTestId('imp2-next2').click();
  await expect(qs.page.getByTestId('imp2-errors-count')).toHaveText('0'); await expect(qs.page.getByTestId('imp2-total')).toContainText(/\d[\d,]*\.\d{2}/);
  await expect(qs.page.getByTestId('imp2-preview')).toBeVisible(); await shot(qs.page, '03-import-preview');
  await qs.page.getByTestId('imp2-commit').click();
  await expect(qs.page.getByTestId('boq-version')).toBeVisible({ timeout: 20_000 });
  await expect(qs.page.getByTestId('boq-version')).toHaveAttribute('data-type', 'TENDER');
  await expect(qs.page.getByTestId('boq-items')).toHaveText('4');
  await expect(qs.page.locator('[data-testid="boq-row"][data-code="2.01"]')).toContainText('9250.75');
  const tenderUrl = qs.page.url(); const tenderId = Number(new URL(tenderUrl).searchParams.get('id'));
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '04-boq-tender');
  // a line by hand; the quantity of a line changed
  await qs.page.getByTestId('boq-add-line').click(); await qs.page.getByTestId('bl-code').fill('NS-1'); await qs.page.getByTestId('bl-desc').fill('Non-schedule item: dewatering'); await qs.page.getByTestId('bl-uom').fill('LS'); await qs.page.getByTestId('bl-qty').fill('1'); await qs.page.getByTestId('bl-rate').fill('50000');
  await qs.page.getByTestId('bl-save').click(); await expect(qs.page.locator('[data-testid="boq-row"][data-code="NS-1"]')).toContainText('Non-schedule');
  // the mapping tool: several items to one node, then splits that must sum to the quantity
  await qs.page.goto(`/proj/boq-mapping?versionId=${tenderId}`);
  await expect(qs.page.getByTestId('map-grid')).toBeVisible();
  await qs.page.getByLabel('Select 1.01').check(); await qs.page.getByLabel('Select 1.02').check(); await qs.page.getByTestId('map-bulk-wbs').selectOption({ label: '1 Earthwork' }); await qs.page.getByTestId('map-bulk-apply').click();
  await expect(qs.page.locator('[data-testid="map-row"][data-code="1.01"]')).toHaveAttribute('data-mapped', 'MAPPED');
  await qs.page.getByTestId('map-splits-2.01').click(); await qs.page.getByTestId('split-add').click(); await qs.page.getByTestId('split-wbs-0').selectOption({ label: '2 Pavement'}); await qs.page.getByTestId('split-add').click();
  await qs.page.getByTestId('split-qty-0').fill('60'); await qs.page.getByTestId('split-wbs-1').selectOption({ label: '1 Earthwork' }); await qs.page.getByTestId('split-qty-1').fill('30');
  await expect(qs.page.getByTestId('split-save')).toBeDisabled(); await expect(qs.page.getByTestId('split-sum')).toContainText('90');
  await qs.page.getByTestId('split-qty-1').fill('35'); await expect(qs.page.getByTestId('split-save')).toBeEnabled(); await shot(qs.page, '05-mapping-splits');
  await qs.page.getByTestId('split-save').click(); await expect(qs.page.locator('[data-testid="map-row"][data-code="2.01"]')).toHaveAttribute('data-mapped', 'MAPPED');
  await qs.page.getByTestId('map-norms-1.01').click(); await qs.page.getByTestId('norm-add').click(); await qs.page.getByTestId('norm-desc-0').fill('Excavator 1.0 cum');
  await qs.page.getByTestId('norm-qty-0').fill('0.05'); await qs.page.getByTestId('norm-save').click(); await expect(qs.page.locator('[data-testid="map-row"][data-code="1.01"]')).toContainText('1');
  await shot(qs.page, '06-mapping');
  // the contract version from the tender; the estimator sends it for the freeze
  await qs.page.goto('/proj/versions'); await qs.page.getByTestId('bq-new').click();
  await qs.page.getByTestId('bq-f-project').selectOption(String(g.id)); await qs.page.getByTestId('bq-f-type').selectOption('CONTRACT'); await qs.page.getByTestId('bq-f-name').fill('Contract BOQ'); await qs.page.getByTestId('bq-f-from').selectOption('VERSION');
  await qs.page.getByTestId('bq-f-source').selectOption({ index: 1 }); await qs.page.getByTestId('bq-f-create').click();
  await expect(qs.page.getByTestId('boq-version')).toHaveAttribute('data-type', 'CONTRACT', { timeout: 15_000 });
  const contractId = Number(new URL(qs.page.url()).searchParams.get('id'));
  const est = await open(browser, info, c, 'EST', g.u('est'), `/proj/version?id=${contractId}`); const estErrors = watch(est.page);
  est.page.on('dialog', (d) => d.accept());
  await est.page.getByTestId('boq-submit').click(); await expect(est.page.getByTestId('boq-version')).toHaveAttribute('data-status', 'SUBMITTED', { timeout: 15_000 });
  await expect(est.page.getByTestId('boq-add-line')).toHaveCount(0);
  const inst = (await api(request, c, 'EST', g.u('est'), 'get', `/proj/versions/${contractId}`)).workflowInstanceId;
  await decide(request, c, 'QS', g.u('qs'), inst); await decide(request, c, 'COMMGR', g.u('com'), inst); await decide(request, c, 'PM', g.u('pm'), inst);
  await est.page.reload(); await expect(est.page.getByTestId('boq-version')).toHaveAttribute('data-status', 'APPROVED'); await expect(est.page.getByTestId('boq-frozen')).toBeVisible(); await expect(est.page.getByTestId('boq-frozen-note')).toBeVisible();
  await expect(est.page.getByTestId('boq-add-line')).toHaveCount(0); await expect(est.page.getByTestId('boq-delete')).toHaveCount(0);
  if (phone) await noOverflow(est.page);
  await shot(est.page, '07-boq-frozen');
  // after the freeze: a change of mapping is a request; a second QS and the project manager approve it
  await qs.page.goto(`/proj/boq-mapping?versionId=${contractId}`); await qs.page.getByTestId('map-splits-1.02').click();
  await qs.page.getByTestId('split-qty-0').fill('850'); await qs.page.getByTestId('split-wbs-0').selectOption({ label: '2 Pavement' }); await qs.page.getByTestId('split-reason').fill('The embankment is built in the pavement zone'); await qs.page.getByTestId('split-save').click();
  await expect(qs.page.getByTestId('map-note')).toBeVisible();
  const ch = await api(request, c, 'QS', g.u('qs'), 'get', `/proj/boq-changes?versionId=${contractId}`); expect(ch).toHaveLength(1); expect(ch[0].status).toBe('SUBMITTED');
  await decide(request, c, 'QS', g.u('qs2'), ch[0].workflowInstanceId); await decide(request, c, 'PM', g.u('pm'), ch[0].workflowInstanceId);
  await qs.page.goto(`/proj/version?id=${contractId}`); await qs.page.getByRole('tab', { name: /changes/i }).click(); await expect(qs.page.getByTestId('boq-change')).toHaveAttribute('data-status', 'APPROVED');
  await shot(qs.page, '08-change-approved');
  // the reports: abstract, comparison, unmapped items
  await qs.page.goto(`/proj/boq-reports?versionId=${contractId}`);
  await expect(qs.page.getByTestId('rep-abstract')).toBeVisible(); await expect(qs.page.getByTestId('rep-total')).toBeVisible(); await expect(qs.page.getByTestId('rep-abstract-row').first()).toContainText('Bill 1');
  await shot(qs.page, '09-abstract');
  await qs.page.goto(`/proj/boq-reports?versionId=${contractId}&compare=${tenderId}`); await expect(qs.page.getByTestId('rep-compare')).toBeVisible(); await expect(qs.page.getByTestId('cmp-added')).toHaveText('0');
  await qs.page.getByRole('tab', { name: /unmapped/i }).click(); await expect(qs.page.getByTestId('rep-unmapped')).toBeVisible(); await expect(qs.page.getByTestId('rep-unmapped')).toContainText('NS-1'); await expect(qs.page.getByTestId('rep-unmapped-row')).toHaveCount(2);
  await shot(qs.page, '10-unmapped');
  // a site engineer reads the quantities and sees no rates; a business developer sees the no-permission state
  const se = await open(browser, info, c, 'SE', g.u('se'), `/proj/version?id=${contractId}`);
  await expect(se.page.getByTestId('boq-grid')).toBeVisible(); await expect(se.page.getByTestId('boq-total')).toHaveCount(0); await expect(se.page.getByRole('columnheader', { name: /^Rate/ })).toHaveCount(0); await expect(se.page.getByRole('columnheader', { name: /^Amount/ })).toHaveCount(0);
  const bd = await open(browser, info, c, 'BD', g.u('se'), `/proj/version?id=${contractId}`);
  await expect(bd.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  expect([...errors, ...estErrors]).toEqual([]);
});
