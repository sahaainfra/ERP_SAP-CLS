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




// Screenshots of the 06.03 pages for docs/erp/screenshots/items. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/items';
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked the specification' });
};
async function setup(request, code) {
  const c = await company(request, code);
  const t = code.toLowerCase();
  const u = { proc: `${t}-proc`, proc2: `${t}-proc2`, est: `${t}-est`, est2: `${t}-est2`, se: `${t}-se`, sys: `${t}-sys` };
  people(c, [[u.proc, ['PROCMGR'], 'Pramod Purchase'], [u.proc2, ['PROCMGR'], 'Priya Purchase'], [u.est, ['EST'], 'Esha Estimator'], [u.est2, ['EST'], 'Eshan Estimator'], [u.se, ['SE'], 'Seema Engineer'], [u.sys, ['SYSADM'], 'Sam Admin']]);
  const cats = (await api(request, c, 'PROCMGR', u.proc, 'get', '/mdm/item-categories')).rows;
  const cat = (k) => cats.find((x) => x.code === k).id;
  /** An item through its approval by a second steward of its category. */
  const item = async (body, who = ['PROCMGR', u.proc], approver = ['PROCMGR', u.proc2]) => {
    const r = await api(request, c, who[0], who[1], 'post', '/mdm/items', { justification: 'Needed on the Alpha project', ...body });
    await act(request, c, approver[0], approver[1], r.workflow.id);
    return r.item;
  };
  return { c, u, cat, item };
}
const cement = (cat) => ({ categoryId: cat('CEMENT'), itemType: 'MATERIAL', name: 'OPC 53 grade cement', baseUom: 'MT', spec: { grade: 'OPC 53', standard: 'IS 269', packing: '50 kg bag' }, stockTracked: true, standardRate: '7200', uoms: [{ uom: 'BAG', factorToBase: '0.05' }] });

test('screenshots of the item master pages', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  void watch; void noOverflow;
  const g = await setup(request, phone ? 'ITSM' : 'ITSD');
  const cem = await g.item(cement(g.cat));
  await g.item({ categoryId: g.cat('STEEL'), itemType: 'MATERIAL', name: 'TMT bar Fe 500D 12 mm', baseUom: 'MT', spec: { grade: 'Fe 500D', dia: '12', length: '12' }, standardRate: '62000', uoms: [{ uom: 'NOS', factorToBase: '0.01066' }] });
  const sand = await g.item({ categoryId: g.cat('AGGREGATE'), itemType: 'MATERIAL', name: 'River sand', baseUom: 'CUM', spec: { kind: 'River sand' }, standardRate: '1800' });
  const agg = await g.item({ categoryId: g.cat('AGGREGATE'), itemType: 'MATERIAL', name: 'Coarse aggregate 40 mm', baseUom: 'CUM', spec: { kind: 'Coarse aggregate', size: '40' }, standardRate: '1500' });
  const mason = await g.item({ categoryId: g.cat('LABOUR'), itemType: 'LABOUR', name: 'Mason', baseUom: 'DAY', spec: { skill: 'Skilled' }, standardRate: '900' }, ['EST', g.u.est], ['EST', g.u.est2]);
  const pcc = await g.item({ categoryId: g.cat('WORKS'), itemType: 'WORK_ITEM', name: 'PCC 1:4:8 in foundations', baseUom: 'CUM', spec: { mix: '1:4:8', standard: 'DSR 4.1.8' } }, ['EST', g.u.est], ['EST', g.u.est2]);
  const cur = await api(request, g.c, 'EST', g.u.est, 'get', `/mdm/items/${pcc.id}`);
  await api(request, g.c, 'EST', g.u.est, 'put', `/mdm/items/${pcc.id}/resources`, { lines: [{ componentId: cem.id, quantity: '3.4', uom: 'BAG', wastagePct: '2' }, { componentId: sand.id, quantity: '0.47', uom: 'CUM', wastagePct: '5' }, { componentId: agg.id, quantity: '0.94', uom: 'CUM', wastagePct: '3' }, { componentId: mason.id, quantity: '0.1', uom: 'DAY' }], version: cur.rowVersion });
  const shot = async (page, name, full = true) => { await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: full }); };
  const l = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/items');
  await expect(l.page.getByText('PCC 1:4:8 in foundations').first()).toBeVisible();
  await shot(l.page, '01-item-master');
  const o = await open(browser, info, g.c, 'EST', g.u.est, `/admin/items/item?id=${pcc.id}&tab=resources`);
  await expect(o.page.getByTestId('it-res-row')).toHaveCount(4);
  await shot(o.page, '02-item-bill-of-resources');
  const u = await open(browser, info, g.c, 'PROCMGR', g.u.proc, `/admin/items/item?id=${cem.id}&tab=uoms`);
  await expect(u.page.getByTestId('it-uom-row')).toHaveCount(1);
  await shot(u.page, '03-item-units');
  const w = await open(browser, info, g.c, 'SE', g.u.se, '/admin/items/new');
  await w.page.getByTestId('ni-category').selectOption({ label: 'Civil materials › Reinforcement steel' });
  await w.page.getByTestId('ni-type').selectOption('MATERIAL');
  await w.page.getByTestId('ni-next').click();
  await expect(w.page.getByTestId('ni-spec-grade')).toBeVisible();
  await shot(w.page, '04-new-item-template');
  const c = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/items/categories');
  await c.page.getByTestId('ic-node').filter({ hasText: 'Cement' }).first().click();
  await expect(c.page.getByTestId('ic-form')).toBeVisible();
  await shot(c.page, '05-item-categories');
  await o.page.getByTestId('it-tab-resources').click();
  await o.page.getByTestId('it-res-add').click();
  await o.page.getByTestId('item-selector').getByTestId('is-q').fill('cum');
  await o.page.getByTestId('item-selector').getByTestId('is-q').fill('sand');
  await expect(o.page.getByTestId('item-selector').getByTestId('is-row').first()).toBeVisible();
  await shot(o.page, '06-item-selector', false);
  const m = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/items/migration');
  await expect(m.page.getByTestId('item-migration')).toBeVisible();
  await shot(m.page, '07-item-migration');
});
