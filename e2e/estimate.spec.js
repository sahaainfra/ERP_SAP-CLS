import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { REVIEW_ITEMS } from '../src/server/modules/est/constants.js';

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

const OUT = 'docs/erp/screenshots/estimate';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked it', checked: REVIEW_ITEMS.map(([, l]) => l) });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['dir', ['DIR']], ['est', ['EST']], ['est2', ['EST']], ['qs', ['QS']], ['com', ['COMMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, n, JSON.stringify(roles), `${t}-${n}@example.com`);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'ESE', 'Estimate test', 'ESE', '[]', '[]', 'EST', 'ACTIVE')").run(c).lastInsertRowid);
  const item = (ic, name, type, uom) => Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, search_text) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE', ?)").run(c, `${t.toUpperCase()}-${ic}`, name, type, cat, uom, name.toLowerCase()).lastInsertRowid);
  const it = { cement: item('CEM', 'Cement OPC 53', 'MATERIAL', 'MT'), sand: item('SND', 'Coarse sand', 'MATERIAL', 'CUM'), agg: item('AGG', 'Coarse aggregate 20 mm', 'MATERIAL', 'CUM'), mason: item('MSN', 'Mason', 'LABOUR', 'DAY'), beldar: item('BLD', 'Beldar', 'LABOUR', 'DAY'), mixer: item('MIX', 'Concrete mixer with operator', 'EQUIPMENT', 'DAY'), vib: item('VIB', 'Needle vibrator', 'EQUIPMENT', 'DAY'), m25: item('M25', 'RCC M25 in superstructure', 'WORK_ITEM', 'CUM') };
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Alpha towers', 'BUILDING')").run(c, `${t.toUpperCase()}P`).lastInsertRowid);
  db.close();
  return { it, project, u: (k) => `${t}-${k}` };
}
const BOQ = ['Section\tSection name\tItem\tDescription\tUnit\tQuantity\tClient rate', 'A\tEarthwork and PCC\tA.1\tPlain cement concrete 1:4:8 below foundations\tCUM\t100\t5600', 'B\tReinforced concrete\tB.1\tRCC M25 in columns, beams and slabs\tCUM\t250\t9100', 'B\tReinforced concrete\tB.2\tBrick masonry in cement mortar 1:6\tCUM\t40\t'].join('\n');

// Part 09.01: the estimate workspace. The estimator starts an estimate for a project, pastes the client BOQ (checked, then added), prices the items (a typed cost rate, the released M25 rate analysis, a build-up of components),
// fills the indirect costs, the risks and the percentages; the totals and the margin by section are worked out on the server; the resource summary adds up cement, labour and plant; a second version changes a quantity and the
// comparison shows it; the version is approved (the commercial manager, then the director); a quantity surveyor sees it without costs. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 an estimate built from the pasted client BOQ with analyses, indirects and the resource summary; versions compared; approved; masked for QS, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'ETM' : 'ETD');
  const t = phone ? 'etm' : 'etd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const E = ['EST', c, g.u('est')];
  const call = (who, method, path, data) => api(request, who[1], who[0], who[2], method, path, data);
  for (const [i, v, uom] of [[g.it.cement, '7200', 'MT'], [g.it.sand, '1850', 'CUM'], [g.it.agg, '1650', 'CUM'], [g.it.mason, '950', 'DAY'], [g.it.beldar, '650', 'DAY'], [g.it.mixer, '2400', 'DAY'], [g.it.vib, '600', 'DAY']]) await call(E, 'post', '/mdm/resource-rates', { itemId: i, rate: v, uom, basis: 'MARKET_SURVEY', effectiveFrom: '2026-01-01' });
  const lines = [[g.it.cement, 'MT', '0.4', '2'], [g.it.sand, 'CUM', '0.42', '5'], [g.it.agg, 'CUM', '0.84', '5'], [g.it.mason, 'DAY', '0.17'], [g.it.beldar, 'DAY', '2.5'], [g.it.mixer, 'DAY', '0.07'], [g.it.vib, 'DAY', '0.07']].map(([itemId, uom, qty, w]) => ({ itemId, uom, qty, ...(w ? { wastagePct: w } : {}) }));
  const an = await call(E, 'post', '/mdm/analyses', { workItemId: g.it.m25, title: 'RCC M25 per cum', scope: 'STANDARD', basisQty: '1', basisUom: 'CUM', effectiveFrom: '2026-01-01', addons: { water: '1', overhead: '7.5', profit: '7.5' }, lines, submit: true });
  await decide(request, c, 'DIR', g.u('dir'), an.instanceId);

  // FR-01 the header
  const est = await open(browser, info, c, 'EST', g.u('est'), `/est/estimate/new?projectId=${g.project}`);
  const errors = watch(est.page);
  await expect(est.page.getByTestId('estimate-new')).toBeVisible();
  await est.page.getByTestId('est-title').fill('Alpha towers, civil works'); await est.page.getByTestId('est-hoOverheadPct').fill('2'); await est.page.getByTestId('est-contingencyPct').fill('1'); await est.page.getByTestId('est-escalationPct').fill('1.5');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '01-new-estimate');
  await est.page.getByTestId('est-create').click();
  await expect(est.page.getByTestId('estimate')).toHaveAttribute('data-status', 'DRAFT');
  const id = Number(new URL(est.page.url()).searchParams.get('id'));

  // FR-02 the client BOQ pasted, checked, added
  await est.page.getByTestId('est-import').click();
  await expect(est.page.getByTestId('boq-import')).toBeVisible();
  await est.page.getByTestId('imp-text').fill(BOQ);
  await expect(est.page.getByTestId('imp-count')).toContainText('3');
  await est.page.getByTestId('imp-check').click(); await expect(est.page.getByTestId('imp-ok')).toContainText('3');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '02-import-boq');
  await est.page.getByTestId('imp-commit').click(); await expect(est.page.getByTestId('imp-done')).toBeVisible();
  await est.page.getByTestId('imp-open').click();

  // FR-03 the items priced: a cost rate, the analysis, a build-up
  await expect(est.page.getByTestId('it-no-2')).toHaveValue('B.2');
  await est.page.getByTestId('it-cost-0').fill('5000'); await est.page.getByTestId('it-markup-0').fill('20');
  await expect(est.page.getByTestId('it-rate-0')).toContainText('6,000.00');
  await est.page.getByTestId('it-mode-1').selectOption('ANALYSIS'); await est.page.getByTestId('it-analysis-1').selectOption({ index: 1 }); await est.page.getByTestId('it-markup-1').fill('25');
  await est.page.getByTestId('it-mode-2').selectOption('MANUAL'); await est.page.getByTestId('it-markup-2').fill('15'); await est.page.getByTestId('it-build-2').click();
  for (const [j, [type, d, uom, q, r]] of [['MATERIAL', 'Cement OPC 53', 'MT', '0.06', '7200'], ['LABOUR', 'Mason', 'DAY', '0.7', '950'], ['OTHER', 'Scaffolding hire', 'NOS', '1', '85.5']].entries()) {
    await est.page.getByTestId('comp-add-2').click();
    await est.page.getByTestId(`comp-type-2-${j}`).selectOption(type); await est.page.getByTestId(`comp-desc-2-${j}`).fill(d); await est.page.getByTestId(`comp-uom-2-${j}`).fill(uom); await est.page.getByTestId(`comp-qty-2-${j}`).fill(q); await est.page.getByTestId(`comp-rate-2-${j}`).fill(r);
  }
  if (phone) await noOverflow(est.page);
  await shot(est.page, '03-items-build-up');
  await est.page.getByTestId('it-save').click();
  await expect(est.page.getByTestId('est-note')).toBeVisible();
  await expect(est.page.getByTestId('it-rate-1')).toContainText('9,006.56'); await expect(est.page.getByTestId('it-rate-2')).toContainText('1,359.88');
  await expect(est.page.getByTestId('est-selling')).toContainText('29,06,035.20');

  // FR-04 the indirects; FR-05 the risks
  await est.page.getByTestId('tab-indirects').click();
  for (const [k, [cat, d, basis, a, b]] of [['SITE_ESTABLISHMENT', 'Site office, stores and yard', 'LUMP_SUM', '50000'], ['STAFF', 'Site engineer, 12 months', 'QTY_RATE', '12', '15000'], ['BG_CHARGES', 'Performance guarantee commission', 'PERCENT', '1']].entries()) {
    await est.page.getByTestId('ind-add').click();
    await est.page.getByTestId(`ind-cat-${k}`).selectOption(cat); await est.page.getByTestId(`ind-desc-${k}`).fill(d); await est.page.getByTestId(`ind-basis-${k}`).selectOption(basis);
    if (basis === 'LUMP_SUM') await est.page.getByTestId(`ind-amount-${k}`).fill(a); else if (basis === 'QTY_RATE') { await est.page.getByTestId(`ind-qty-${k}`).fill(a); await est.page.getByTestId(`ind-rate-${k}`).fill(b); } else await est.page.getByTestId(`ind-percent-${k}`).fill(a);
  }
  await est.page.getByTestId('ind-save').click();
  await expect(est.page.getByTestId('ind-total')).toContainText('2,53,486.13');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '04-indirects');
  await est.page.getByTestId('tab-risks').click();
  for (const [k, [d, i, p]] of [['Rock in excavation', '100000', '25'], ['Monsoon delay', '40000', '50']].entries()) { await est.page.getByTestId('risk-add').click(); await est.page.getByTestId(`risk-desc-${k}`).fill(d); await est.page.getByTestId(`risk-impact-${k}`).fill(i); await est.page.getByTestId(`risk-prob-${k}`).fill(p); }
  await est.page.getByTestId('risk-save').click();
  await expect(est.page.getByTestId('est-margin')).toContainText('4.84%');
  await expect(est.page.getByTestId('est-bid')).toContainText('34,29,121.54');
  // FR-08 the margin by section
  await est.page.getByTestId('tab-sections').click();
  await expect(est.page.getByTestId('sec-margin-A')).toHaveText('16.67%'); await expect(est.page.getByTestId('sec-margin-B')).toHaveText('19.84%');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '05-cost-and-margin');

  // FR-06 the resources
  await est.page.getByTestId('est-resources').click();
  await expect(est.page.getByTestId('res-cement')).toContainText('104.4'); await expect(est.page.getByTestId('res-labour')).toContainText('695.5');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '06-resource-summary');

  // FR-07 a second version with less concrete, compared
  await est.page.goto(`/est/estimate?id=${id}`);
  await est.page.getByTestId('est-new-version').click();
  await est.page.waitForURL((u) => Number(u.searchParams.get('id')) !== id);
  const v2 = Number(new URL(est.page.url()).searchParams.get('id'));
  await expect(est.page.getByRole('heading', { level: 1 })).toContainText('/v2');
  await est.page.getByTestId('it-qty-1').fill('240'); await est.page.getByTestId('it-save').click(); await expect(est.page.getByTestId('est-note')).toBeVisible();
  await est.page.getByTestId('est-compare').click();
  await expect(est.page.getByTestId('cmp-row-B.1')).toHaveAttribute('data-change', 'CHANGED'); await expect(est.page.getByTestId('cmp-amount-B.1')).toContainText('-90065.60');
  await expect(est.page.getByTestId('cmp-counts')).toContainText('1 changed');
  if (phone) await noOverflow(est.page);
  await shot(est.page, '07-version-comparison');

  // approval: a colleague, then the director
  await est.page.goto(`/est/estimate?id=${v2}`);
  await est.page.getByTestId('est-submit').click(); await expect(est.page.getByTestId('estimate')).toHaveAttribute('data-status', 'SUBMITTED');
  const x = await call(E, 'get', `/est/estimates/${v2}`);
  await decide(request, c, 'COMMGR', g.u('com'), x.workflowInstanceId); await decide(request, c, 'DIR', g.u('dir'), x.workflowInstanceId);
  await est.page.reload(); await expect(est.page.getByTestId('estimate')).toHaveAttribute('data-status', 'APPROVED');
  await est.page.goto('/est/estimates'); await expect(est.page.getByText('Alpha towers, civil works').first()).toBeVisible();
  if (phone) await noOverflow(est.page);
  await shot(est.page, '08-estimates');

  // BR-02 a quantity surveyor sees the estimate without costs or margins
  const qs = await open(browser, info, c, 'QS', g.u('qs'), `/est/estimate?id=${v2}`);
  const qsErrors = watch(qs.page);
  await expect(qs.page.getByTestId('est-masked')).toBeVisible(); await expect(qs.page.getByTestId('est-cost')).toHaveCount(0); await expect(qs.page.getByTestId('est-selling')).toContainText('28');
  await expect(qs.page.getByTestId('tab-indirects')).toHaveCount(0);
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '09-qs-masked');
  expect(errors).toEqual([]); expect(qsErrors).toEqual([]);
});
