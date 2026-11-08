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

const OUT = 'docs/erp/screenshots/rfi';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['se', ['SE']], ['des', ['DESIGN']], ['pm', ['PM']], ['qs', ['QS']], ['bd', ['BD']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Flyover at the junction', 'ROAD')").run(c, `${t.toUpperCase()}-A`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, lifecycle_state, pm_user, created_by) VALUES (?, ?, 'EXECUTION', ?, 'e2e')").run(c, id, `${t}-pm`);
  db.close();
  return { u: (k) => `${t}-${k}`, project: id };
}
async function approve(request, c, roles, user, instanceId, action = 'approve') {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task of instance ${instanceId}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
}
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });

// Part 11.02: a site engineer raises an RFI on the phone with a photo and a finger markup, sends it; the design coordinator issues it; the answer (a design change with a cost and time impact) is recorded; the raiser asks to close it and the design coordinator and
// the raiser's lead verify it; the delay draft, the ball in court and the dashboard follow. A person without the right sees the no-permission state. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 RFI raised with a photo markup, routed, answered, verified and closed with impacts recorded, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = info.project.name === 'mobile' ? 'rfm' : 'rfd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const se = s.u('se'); const des = s.u('des'); const pm = s.u('pm');
  const r = await open(browser, info, c, 'SE', se, '/engg/rfi-raise');
  const errors = watch(r.page);
  await expect(r.page.getByRole('heading', { name: 'Raise RFI', level: 1 })).toBeVisible();
  await r.page.getByTestId('raise-project').selectOption(String(s.project));
  await r.page.getByTestId('raise-subject').fill('Sleeve clashes with beam B12 bars');
  await r.page.getByTestId('raise-question').fill('The 150 mm sleeve at grid C-4 cuts the bottom bars of beam B12. How are the bars to be arranged?');
  await r.page.getByTestId('raise-priority').selectOption('HIGH');
  await r.page.getByTestId('raise-activity').fill('A1010 Beam B12 reinforcement');
  await r.page.getByTestId('raise-activityCritical').check();
  await r.page.getByTestId('raise-holdActivity').check();
  await r.page.getByTestId('raise-timeFlag').check();
  await r.page.getByTestId('raise-photo').setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PNG });
  const canvas = r.page.getByTestId('raise-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  await r.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3); await r.page.mouse.down();
  await r.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4, { steps: 4 }); await r.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7, { steps: 4 }); await r.page.mouse.up();
  await expect(r.page.getByTestId('raise-undo')).toBeVisible();
  await shot(r.page, 'raise', info);
  await noOverflow(r.page);
  await r.page.getByTestId('raise-send').click();
  await expect(r.page.getByTestId('rfi')).toBeVisible();
  await expect(r.page.getByTestId('rfi')).toHaveAttribute('data-status', 'SUBMITTED');
  await expect(r.page.getByTestId('rfi')).toHaveAttribute('data-ball', 'DESIGN');
  const id = Number(new URL(r.page.url()).searchParams.get('id'));
  const files = await api(request, c, 'SE', se, 'get', `/core/files?entity=engg_rfi&entityId=${id}`);
  expect((files.rows ?? files).length, 'the marked-up photo is attached').toBe(1);
  // the design coordinator issues it
  const wf = (await api(request, c, 'SE', se, 'get', `/engg/rfis/${id}`)).issueWorkflowId;
  await approve(request, c, 'DESIGN', des, wf);
  await r.page.reload();
  await expect(r.page.getByTestId('rfi')).toHaveAttribute('data-status', 'ISSUED');
  await expect(r.page.getByTestId('rfi')).toHaveAttribute('data-ball', 'CONSULTANT');
  await expect(r.page.getByTestId('rfi-ball')).toContainText('critical path');
  await shot(r.page, 'rfi-issued', info);
  await noOverflow(r.page);
  // the design coordinator records the answer (a design change with an impact)
  const d = await open(browser, info, c, 'DESIGN', des, `/engg/rfi?id=${id}`);
  const e2 = watch(d.page);
  await d.page.getByRole('tab', { name: 'Response and impact' }).click();
  await d.page.getByTestId('ans-type').selectOption('DESIGN_CHANGE');
  await d.page.getByTestId('ans-text').fill('Move the sleeve 300 mm to the right and add two trimmer bars.');
  await d.page.getByTestId('ans-cost').fill('25000.50');
  await d.page.getByTestId('ans-days').fill('4');
  await d.page.getByTestId('ans-save').click();
  await expect(d.page.getByTestId('rfi-error')).toContainText('design change');
  await d.page.getByTestId('ans-instruction').fill('CI-014');
  await d.page.getByTestId('ans-save').click();
  await expect(d.page.getByTestId('rfi-note')).toContainText('answer is recorded');
  await expect(d.page.getByTestId('rfi-cost')).toContainText('25000.50');
  await expect(d.page.getByTestId('rfi-delay')).toContainText('4 days');
  await expect(d.page.getByTestId('rfi')).toHaveAttribute('data-ball', 'VERIFIER');
  await shot(d.page, 'rfi-answered', info);
  await noOverflow(d.page);
  // the raiser asks to close; the design coordinator and then the lead verify
  await r.page.reload();
  await r.page.getByTestId('rfi-close').click();
  await expect(r.page.getByTestId('rfi-note')).toContainText('verification');
  const wf2 = (await api(request, c, 'SE', se, 'get', `/engg/rfis/${id}`)).closeWorkflowId;
  await approve(request, c, 'DESIGN', des, wf2); await approve(request, c, 'PM', pm, wf2);
  await r.page.reload();
  await expect(r.page.getByTestId('rfi')).toHaveAttribute('data-status', 'CLOSED');
  await r.page.getByRole('tab', { name: 'Response and impact' }).click();
  await expect(r.page.getByTestId('rfi-verified')).toContainText(pm);
  await r.page.getByRole('tab', { name: 'Routing' }).click();
  await expect(r.page.getByTestId('rfi-routing')).toContainText('Closed');
  await shot(r.page, 'rfi-closed', info);
  // the register and the dashboard
  await d.page.goto('/engg/rfis');
  await expect(d.page.getByRole('heading', { name: 'RFI Register', level: 1 })).toBeVisible();
  await expect(d.page.getByText('RFI-00001').first()).toBeVisible();
  await shot(d.page, 'register', info);
  await d.page.goto('/engg/rfi-dashboard');
  await expect(d.page.getByRole('heading', { name: 'RFI Dashboard', level: 1 })).toBeVisible();
  await expect(d.page.getByTestId('rfid-tile-closed')).toHaveAttribute('data-value', '1');
  await expect(d.page.getByTestId('rfid-tile-open')).toHaveAttribute('data-value', '0');
  await expect(d.page.getByTestId('rfid-impact')).toContainText('25000.50');
  await shot(d.page, 'dashboard', info);
  await noOverflow(d.page);
  expect(errors).toEqual([]); expect(e2).toEqual([]);
});

test('AC-03 a person without the right sees the no-permission state', async ({ browser, request }, info) => {
  const t = info.project.name === 'mobile' ? 'rfn' : 'rfk';
  const c = await company(request, t.toUpperCase());
  seed(c, t);
  const { page } = await open(browser, info, c, 'BD', `${t}-bd`, '/engg/rfis');
  await expect(page.getByRole('heading', { name: /You do not have access/ })).toBeVisible();
  await expect(page.getByText('engg.rfi.view')).toBeVisible();
  await noOverflow(page);
});
