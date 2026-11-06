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

const OUT = 'docs/erp/screenshots/mto';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHhgCAh6X4CYAAAAASUVORK5CYII=', 'base64');
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked against the drawing' });
};
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['qs', ['QS']], ['des', ['DESIGN']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, n, JSON.stringify(roles), `${t}-${n}@example.com`);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'MTE', 'MTO test', 'MTE', '[]', '[]', 'EST', 'ACTIVE')").run(c).lastInsertRowid);
  const item = (ic, name, type, uom) => Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, search_text) VALUES (?, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE', ?)").run(c, `${t.toUpperCase()}-${ic}`, name, type, cat, uom, name.toLowerCase()).lastInsertRowid);
  const it = { cement: item('CEM', 'Cement OPC 53', 'MATERIAL', 'MT'), sand: item('SND', 'Coarse sand', 'MATERIAL', 'CUM'), m25: item('M25', 'RCC M25 concrete', 'WORK_ITEM', 'CUM') };
  for (const [cid, q, u, w, n] of [[it.cement, 400, 'MT', 20000, 1], [it.sand, 420, 'CUM', 50000, 2]]) db.prepare('INSERT INTO mdm_item_resources (company_id, parent_item_id, component_item_id, qty_per_unit, uom, wastage_pct, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c, it.m25, cid, q, u, w, n);
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Alpha towers', 'BUILDING')").run(c, `${t.toUpperCase()}P`).lastInsertRowid);
  db.close();
  return { it, project, u: (k) => `${t}-${k}` };
}
const pick = async (page, id, text, name) => { await page.locator(`#${id}`).click(); await page.locator(`#${id}`).fill(text); await page.getByRole('option', { name }).first().click(); };

// Part 09.02: a quantity surveyor measures the columns and beams of a drawing on a take-off sheet (concrete volume template, the M25 work item) with the drawing beside it, sends it to the checker (the design lead releases it),
// sees the material explosion (cement and sand with wastage through the bill of resources), makes revision 1 for drawing revision B with more beams and reads the delta; then prepares the bar bending schedule of the columns
// (12 mm straight bars: 100 x 6 m = 532.8 kg; stirrups by shape code 51), released and summed by diameter. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 take-off and BBS sheets give quantities with revisions and deltas; the explosion gives the material requirements, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'MTM' : 'MTD');
  const t = phone ? 'mtm' : 'mtd';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const replies = []; const answer = (page) => page.on('dialog', (d) => d.accept(replies.shift() ?? ''));

  // FR-01 the take-off sheet
  const qs = await open(browser, info, c, 'QS', g.u('qs'), `/est/takeoff?new=1&projectId=${g.project}`);
  const errors = watch(qs.page); answer(qs.page);
  await expect(qs.page.getByTestId('takeoff-new')).toBeVisible();
  await qs.page.getByTestId('to-title').fill('Tower A superstructure'); await qs.page.getByTestId('to-drawing').fill('STR-A-201'); await qs.page.getByTestId('to-drawing-rev').fill('A');
  await qs.page.getByTestId('to-create').click();
  await expect(qs.page.getByTestId('takeoff')).toHaveAttribute('data-status', 'DRAFT');
  const id = Number(new URL(qs.page.url()).searchParams.get('id'));
  for (const [i, [ref, d, n, l, b, h]] of [['B.1', 'Columns C1', '4', '0.45', '0.3', '3.2'], ['B.1', 'Beams B1', '6', '5', '0.3', '0.45']].entries()) {
    await qs.page.getByTestId('to-add').click();
    await qs.page.getByTestId(`to-ref-${i}`).fill(ref); await qs.page.getByTestId(`to-desc-${i}`).fill(d); await qs.page.getByTestId(`to-tpl-${i}`).selectOption('CONCRETE_VOLUME');
    await pick(qs.page, `to-work-${i}`, 'RCC', /RCC M25/);
    await qs.page.getByTestId(`to-nos-${i}`).fill(n); await qs.page.getByTestId(`to-length-${i}`).fill(l); await qs.page.getByTestId(`to-breadth-${i}`).fill(b); await qs.page.getByTestId(`to-height-${i}`).fill(h);
  }
  await expect(qs.page.getByTestId('to-qty-0')).toHaveText('1.728'); await expect(qs.page.getByTestId('to-qty-1')).toHaveText('4.05');
  await qs.page.getByTestId('to-save').click(); await expect(qs.page.getByTestId('to-note')).toBeVisible();
  await expect(qs.page.getByTestId('to-items')).toContainText('5.778');
  await qs.page.getByTestId('drawing-viewer').getByTestId('file-input').setInputFiles({ name: 'STR-A-201-A.png', mimeType: 'image/png', buffer: PNG });
  await expect(qs.page.getByTestId('drawing-image')).toBeVisible({ timeout: 15_000 });
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '01-takeoff-sheet');
  await qs.page.getByTestId('to-submit').click(); await expect(qs.page.getByTestId('takeoff')).toHaveAttribute('data-status', 'SUBMITTED');
  const x = await api(request, c, 'QS', g.u('qs'), 'get', `/est/takeoffs/${id}`);
  await decide(request, c, 'DESIGN', g.u('des'), x.workflowInstanceId);
  await qs.page.reload(); await expect(qs.page.getByTestId('takeoff')).toHaveAttribute('data-status', 'APPROVED');

  // FR-04 the explosion: 5.778 cum of M25: cement 2.311 MT + 2% = 2.357; sand 2.427 cum + 5% = 2.548
  await qs.page.getByTestId('to-explosion').click();
  await expect(qs.page.getByTestId(`exp-qty-${t.toUpperCase()}-CEM`)).toHaveText('2.357'); await expect(qs.page.getByTestId(`exp-qty-${t.toUpperCase()}-SND`)).toHaveText('2.548');
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '02-material-explosion');

  // FR-05 revision 1 for drawing revision B: 8 beams; the delta against R0
  await qs.page.goto(`/est/takeoff?id=${id}`);
  replies.push('B', 'drawing revision B: two more beams');
  await qs.page.getByTestId('to-revise').click();
  await qs.page.waitForURL((u) => Number(u.searchParams.get('id')) !== id);
  await expect(qs.page.getByTestId('takeoff')).toHaveAttribute('data-status', 'DRAFT');
  await qs.page.getByTestId('to-nos-1').fill('8'); await qs.page.getByTestId('to-save').click(); await expect(qs.page.getByTestId('to-note')).toBeVisible();
  await qs.page.getByTestId('to-delta').click();
  await expect(qs.page.getByTestId('delta-row-B.1')).toHaveAttribute('data-change', 'CHANGED'); await expect(qs.page.getByTestId('delta-d-B.1')).toHaveText('+1.35');
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '03-revision-delta');

  // FR-02 the bar bending schedule of the columns
  await qs.page.goto(`/est/bbs/sheet?new=1&projectId=${g.project}`);
  await qs.page.getByTestId('bbs-title').fill('Columns C1, ground floor'); await qs.page.getByTestId('bbs-member').fill('C1'); await qs.page.getByTestId('bbs-drawing').fill('STR-GF-101');
  await qs.page.getByTestId('bbs-create').click(); await expect(qs.page.getByTestId('bbs')).toHaveAttribute('data-status', 'DRAFT');
  const bid = Number(new URL(qs.page.url()).searchParams.get('id'));
  await qs.page.getByTestId('bbs-add').click();
  await qs.page.getByTestId('bbs-mark-0').fill('B1'); await qs.page.getByTestId('bbs-dia-0').selectOption('12'); await qs.page.getByTestId('bbs-shape-0').selectOption('00'); await qs.page.getByTestId('bbs-a-0').fill('6'); await qs.page.getByTestId('bbs-members-0').fill('10'); await qs.page.getByTestId('bbs-bars-0').fill('10');
  await expect(qs.page.getByTestId('bbs-w-0')).toHaveText('532.8');
  await qs.page.getByTestId('bbs-add').click();
  await qs.page.getByTestId('bbs-mark-1').fill('S1'); await qs.page.getByTestId('bbs-dia-1').selectOption('8'); await qs.page.getByTestId('bbs-shape-1').selectOption('51'); await qs.page.getByTestId('bbs-a-1').fill('0.3'); await qs.page.getByTestId('bbs-b-1').fill('0.45'); await qs.page.getByTestId('bbs-members-1').fill('30');
  await expect(qs.page.getByTestId('bbs-cut-1')).toHaveText('1.612');
  await qs.page.getByTestId('bbs-save').click(); await expect(qs.page.getByTestId('bbs-note')).toBeVisible();
  await expect(qs.page.getByTestId('bbs-weight')).toContainText('551.902');
  await expect(qs.page.getByTestId('bbs-dia-row-12')).toContainText('532.8');
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '04-bbs-editor');
  await qs.page.getByTestId('bbs-submit').click(); await expect(qs.page.getByTestId('bbs')).toHaveAttribute('data-status', 'SUBMITTED');
  const y = await api(request, c, 'QS', g.u('qs'), 'get', `/est/bbs/${bid}`);
  await decide(request, c, 'DESIGN', g.u('des'), y.workflowInstanceId);
  await qs.page.goto(`/est/bbs-summary?projectId=${g.project}`);
  await expect(qs.page.getByTestId('bsum-total')).toContainText('551.902'); await expect(qs.page.getByTestId('bsum-8')).toContainText('19.102');
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '05-bbs-summary');
  await qs.page.goto('/est/takeoffs'); await expect(qs.page.getByText('Tower A superstructure').first()).toBeVisible();
  if (phone) await noOverflow(qs.page);
  await shot(qs.page, '06-takeoff-sheets');
  await qs.page.goto('/est/bbs'); await expect(qs.page.getByText(phone ? 'C1' : 'Columns C1, ground floor').first()).toBeVisible();
  await shot(qs.page, '07-bbs-list');
  expect(errors).toEqual([]);
});
