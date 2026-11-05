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




// Part 06.03: the item master. A site engineer asks for an item with the wizard (category, template attributes, units, the duplicate check before sending); the procurement manager approves it; the Item
// page shows its units and converts bags to tonnes; an estimator keeps the bill of resources of a work item with the selector; the selector adds catalogue items to the lines of a sample request (AC-01).
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

test('T-02 FR-01 FR-07 the New Item wizard: template attributes, units, the duplicate warning before sending; approval by the steward', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'ITWM' : 'ITWD');
  await g.item(cement(g.cat));
  const p = await open(browser, info, g.c, 'SE', g.u.se, '/admin/items/new');
  const errors = watch(p.page);
  await p.page.getByTestId('ni-category').selectOption({ label: 'Civil materials › Cement' });
  await p.page.getByTestId('ni-type').selectOption('MATERIAL');
  await p.page.getByTestId('ni-next').click();
  await p.page.getByTestId('ni-spec-grade').selectOption('OPC 53');
  await p.page.getByTestId('ni-next').click();
  await expect(p.page.getByTestId('ni-error')).toContainText('IS standard');
  await p.page.getByTestId('ni-spec-standard').fill('IS 269');
  await p.page.getByTestId('ni-spec-packing').selectOption('50 kg bag');
  await p.page.getByTestId('ni-next').click();
  await p.page.getByTestId('ni-name').fill('Cement OPC 53, 50 kg bags');
  await p.page.getByTestId('ni-uom').selectOption('MT');
  await p.page.getByTestId('ni-add-uom').click();
  await p.page.getByTestId('ni-alt-uom').selectOption('BAG');
  await p.page.getByTestId('ni-alt-factor').fill('0.05');
  if (phone) await noOverflow(p.page);
  await p.page.getByTestId('ni-next').click();
  await expect(p.page.getByTestId('ni-duplicates')).toContainText('CEM-00001');
  await expect(p.page.getByTestId('ni-send')).toBeDisabled();
  await p.page.getByTestId('ni-ack').check();
  await p.page.getByTestId('ni-why').fill('The client wants this brand on the bridge');
  await p.page.getByTestId('ni-send').click();
  await expect(p.page.getByTestId('it-sent')).toBeVisible();
  await expect(p.page.getByRole('heading', { level: 1 })).toContainText('CEM-00002');
  const id = Number(new URL(p.page.url()).searchParams.get('id'));
  const it = await api(request, g.c, 'PROCMGR', g.u.proc, 'get', `/mdm/items/${id}`);
  await act(request, g.c, 'PROCMGR', g.u.proc, it.instanceId);
  await p.page.reload();
  await expect(p.page.getByRole('heading', { level: 1 })).toContainText('CEM-00002');
  await p.page.getByTestId('it-tab-uoms').click();
  await p.page.getByTestId('it-conv-q').fill('40');
  await p.page.getByTestId('it-conv-from').fill('BAG');
  await p.page.getByTestId('it-conv-to').fill('MT');
  await p.page.getByTestId('it-conv-go').click();
  await expect(p.page.getByTestId('it-conv-result')).toContainText('40 BAG = 2.000 MT');
  if (phone) await noOverflow(p.page);
  expect(errors).toEqual([]);
});

test('FR-04 FR-06 AC-01 a bill of resources kept with the selector; the Item Master list; catalogue items into the lines of a sample request', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'ITBM' : 'ITBD');
  await g.item(cement(g.cat));
  await g.item({ categoryId: g.cat('AGGREGATE'), itemType: 'MATERIAL', name: 'River sand', baseUom: 'CUM', spec: { kind: 'River sand' }, standardRate: '1800' });
  const pcc = await g.item({ categoryId: g.cat('WORKS'), itemType: 'WORK_ITEM', name: 'PCC 1:4:8 in foundations', baseUom: 'CUM', spec: { mix: '1:4:8', standard: 'DSR 4.1.8' } }, ['EST', g.u.est], ['EST', g.u.est2]);
  const e = await open(browser, info, g.c, 'EST', g.u.est, `/admin/items/item?id=${pcc.id}`);
  const errors = watch(e.page);
  await e.page.getByTestId('it-tab-resources').click();
  await e.page.getByTestId('it-res-add').click();
  const sel = e.page.getByTestId('item-selector');
  await sel.getByTestId('is-q').fill('cement');
  await expect(sel.getByTestId('is-row')).toHaveCount(1);
  await sel.getByTestId('is-pick').check();
  await sel.getByTestId('is-q').fill('sand');
  await expect(sel.getByTestId('is-row')).toHaveCount(1);
  await sel.getByTestId('is-pick').check();
  await sel.getByTestId('is-done').click();
  await expect(e.page.getByTestId('it-res-row')).toHaveCount(2);
  await e.page.getByTestId('it-res-qty').nth(0).fill('0.17');
  await e.page.getByTestId('it-res-qty').nth(1).fill('0.47');
  await e.page.getByTestId('it-res-save').click();
  await expect(e.page.getByTestId('it-res-saved')).toContainText('₹');
  if (phone) await noOverflow(e.page);
  // the list: category tree and search
  const l = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/items');
  await expect(l.page.getByTestId('item-master')).toBeVisible();
  await expect(l.page.getByText('OPC 53 grade cement').first()).toBeVisible();
  if (phone) await noOverflow(l.page);
  // AC-01: the selector in the lines of a sample request
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  db.prepare("INSERT OR IGNORE INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, 'ALPHA', 'Alpha bridge', 'ROAD', 'ACTIVE', 'e2e', 'e2e')").run(g.c);
  db.close();
  const s = await open(browser, info, g.c, 'SE', g.u.se, '/admin/sample-requests?new=1');
  const btn = s.page.getByTestId('lines-from-catalogue');
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  const sel2 = s.page.getByTestId('item-selector');
  await sel2.getByTestId('is-q').fill('opc');
  await expect(sel2.getByTestId('is-row')).toHaveCount(1);
  await sel2.getByTestId('is-pick').check();
  await sel2.getByTestId('is-done').click();
  await expect(s.page.locator('input[value^="CEM-00001 OPC 53 grade cement"]').first()).toBeVisible();
  if (phone) await noOverflow(s.page);
  expect(errors).toEqual([]);
});
