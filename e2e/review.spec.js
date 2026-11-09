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

const OUT = 'docs/erp/screenshots/review';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked it' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['dir', ['DIR']], ['est', ['EST']], ['com', ['COMMGR']], ['qs', ['QS']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, n, JSON.stringify(roles), `${t}-${n}@example.com`);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'RVE', 'Review test', 'RVE', '[]', '[]', 'EST', 'ACTIVE')").run(c).lastInsertRowid);
  const steel = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, search_text) VALUES (?, ?, 'TMT steel Fe 500D', 'MATERIAL', ?, 'MT', '2026-01-01', 'ACTIVE', 'tmt steel')").run(c, `${t.toUpperCase()}-STL`, cat).lastInsertRowid);
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Alpha towers', 'BUILDING')").run(c, `${t.toUpperCase()}P`).lastInsertRowid);
  db.close();
  return { steel, project, u: (k) => `${t}-${k}` };
}

// Part 09.03: the estimator gives a 3 % discount on the Bid Price Finalisation page (above the 2 % threshold: the director approves it), lists the assumptions and exclusions, and sends the estimate; the commercial manager
// reviews it on the Estimate Review panel (every checklist item ticked approves the review step), looks at the sensitivity of the bid price to steel and at the unbalanced items; the director approves; the priced BOQ is
// downloaded in Excel; a quantity surveyor sees the panel without costs. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 an estimate reviewed and approved with its bid summary; the priced BOQ exported in the client format, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'RVM' : 'RVD');
  const t = phone ? 'rvm' : 'rvd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const E = ['EST', c, g.u('est')];
  const call = (who, method, path, data) => api(request, who[1], who[0], who[2], method, path, data);
  await call(E, 'post', '/mdm/resource-rates', { itemId: g.steel, rate: '60000', uom: 'MT', basis: 'MARKET_SURVEY', effectiveFrom: '2026-01-01' });
  const e0 = await call(E, 'post', '/est/estimates', { projectId: g.project, title: 'Alpha towers, structure', basisDate: '2026-10-01', gstPct: '18' });
  const e = await call(E, 'put', `/est/estimates/${e0.id}/items`, { version: e0.rowVersion, items: [
    { sectionCode: 'A', sectionName: 'Earthwork and PCC', itemNo: 'A.1', description: 'PCC 1:4:8', uom: 'CUM', qty: '100', clientRate: '5600', mode: 'RATE', costRate: '5000', markupPct: '20' },
    { sectionCode: 'B', sectionName: 'Reinforced concrete', itemNo: 'R.1', description: 'Reinforcement Fe 500D, cut, bent and placed', uom: 'MT', qty: '20', mode: 'MANUAL', markupPct: '10', components: [{ type: 'MATERIAL', itemId: g.steel, uom: 'MT', qty: '1' }, { type: 'LABOUR', description: 'Bar bending gang', uom: 'MT', qty: '1', rate: '4000' }] },
    { sectionCode: 'C', sectionName: 'Sundries', itemNo: 'C.1', description: 'Cleaning on completion', uom: 'LS', qty: '10', mode: 'RATE', costRate: '100', markupPct: '0' }] });

  // FR-02, BR-01 the discount: 3 % is above the threshold, the director approves it
  const est = await open(browser, info, c, 'EST', g.u('est'), `/est/bid-price?id=${e.id}`);
  const errors = watch(est.page);
  await expect(est.page.getByTestId('bid-price')).toBeVisible();
  await expect(est.page.getByTestId('sum-bid')).toContainText('23,70,620.00');
  await est.page.getByTestId('bid-pct').fill('3'); await est.page.getByTestId('bid-reason').fill('to beat the expected L1 by a small margin');
  await expect(est.page.getByTestId('bid-over')).toBeVisible(); await expect(est.page.getByTestId('bid-live-price')).toContainText('22,99,501.40');
  await est.page.getByTestId('bid-save').click();
  await expect(est.page.getByTestId('bid-price')).toHaveAttribute('data-status', 'DRAFT');
  await est.page.getByTestId('bid-send').click(); await expect(est.page.getByTestId('bid-price')).toHaveAttribute('data-status', 'SUBMITTED');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '01-bid-price');
  const ds = await call(E, 'get', `/est/estimates/${e.id}/bid-summary`);
  await decide(request, c, 'DIR', g.u('dir'), ds.workflowInstanceId);
  await est.page.reload(); await expect(est.page.getByTestId('bid-price')).toHaveAttribute('data-status', 'APPROVED');
  await expect(est.page.getByTestId('sum-bid')).toContainText('22,99,501.40');

  // FR-03 the register
  await est.page.goto(`/est/review?id=${e.id}`);
  await est.page.getByTestId('tab-assumptions').click();
  for (const [i, [k, txt]] of [['ASSUMPTION', 'Water and power at the site boundary by the client'], ['EXCLUSION', 'Dewatering beyond 1.5 m depth']].entries()) { await est.page.getByTestId('asm-add').click(); await est.page.getByTestId(`asm-kind-${i}`).selectOption(k); await est.page.getByTestId(`asm-text-${i}`).fill(txt); }
  await est.page.getByTestId('asm-save').click(); await expect(est.page.getByTestId('rev-note')).toBeVisible();
  await call(E, 'post', `/est/estimates/${e.id}/submit`, {});

  // FR-01, FR-04 the commercial manager reviews on the panel
  const com = await open(browser, info, c, 'COMMGR', g.u('com'), `/est/review?id=${e.id}`);
  const comErrors = watch(com.page);
  await expect(com.page.getByTestId('rev-task')).toBeVisible();
  await expect(com.page.getByTestId('rev-approve')).toBeDisabled();
  for (const k of ['QUANTITIES', 'RATES', 'INDIRECTS', 'RISKS', 'ASSUMPTIONS']) await com.page.getByTestId(`rev-item-${k}`).check();
  await com.page.getByTestId('rev-comments').fill('Checked against the take-off and the library');
  if (phone) await noOverflow(com.page);
  await shot(com.page, '02-review-checklist');
  await com.page.getByTestId('rev-approve').click(); await expect(com.page.getByTestId('rev-note')).toBeVisible();
  // FR-02 the sensitivity: +10 % on steel = 6,000 more per MT x 1.10 x 20 MT = 1,32,000; less 3 % and with 18 % GST
  await com.page.getByTestId('tab-sensitivity').click();
  await expect(com.page.getByTestId('sens-table')).toContainText('TMT steel Fe 500D');
  if (phone) await noOverflow(com.page);
  await shot(com.page, '03-sensitivity');
  // FR-06 the unbalanced items
  await com.page.getByTestId('tab-unbalanced').click();
  await expect(com.page.getByTestId('unb-C.1')).toContainText('At or below cost');
  if (phone) await noOverflow(com.page);
  await shot(com.page, '04-unbalanced');
  const x = await call(E, 'get', `/est/estimates/${e.id}`);
  await decide(request, c, 'DIR', g.u('dir'), x.workflowInstanceId);
  await com.page.reload(); await expect(com.page.getByTestId('review')).toHaveAttribute('data-status', 'APPROVED');
  await com.page.getByTestId('tab-summary').click(); await expect(com.page.getByTestId('sum-words')).toContainText('Rupees Twenty-Two Lakh Ninety-Nine Thousand Five Hundred One and Forty Paise Only');
  if (phone) await noOverflow(com.page);
  await shot(com.page, '05-bid-summary');

  // FR-05 the priced BOQ in Excel (approved: not a draft)
  await com.page.goto(`/est/bid-price?id=${e.id}`);
  const [dl] = await Promise.all([com.page.waitForEvent('download'), com.page.getByTestId('bid-xlsx').click()]);
  expect(dl.suggestedFilename()).toMatch(/^priced-boq-EST-\d{5}-v1\.xlsx$/);
  const print = await request.get(`/api/v1/est/estimates/${e.id}/priced-boq?format=html`, { headers: { 'x-erp-user': g.u('com'), 'x-erp-roles': 'COMMGR', 'x-erp-company': String(c) } });
  expect(await print.text()).toContain('Rupees Six Thousand Only');
  if (phone) await noOverflow(com.page);
  await shot(com.page, '06-priced-boq');

  // BR-02 masking: a quantity surveyor sees the panel without costs
  const qs = await open(browser, info, c, 'QS', g.u('qs'), `/est/review?id=${e.id}`);
  const qsErrors = watch(qs.page);
  await expect(qs.page.getByTestId('review')).toBeVisible(); await expect(qs.page.getByTestId('rev-profit')).toHaveCount(0); await expect(qs.page.getByTestId('tab-sensitivity')).toHaveCount(0);
  await shot(qs.page, '07-qs-masked');
  expect(errors).toEqual([]); expect(comErrors).toEqual([]); expect(qsErrors).toEqual([]);
});
