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

const OUT = 'docs/erp/screenshots/epc';
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['des1', ['DESIGN']], ['des2', ['DESIGN']], ['pm', ['PM']], ['bd', ['BD']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Compressor house', 'INDUSTRIAL')").run(c, `${t.toUpperCase()}-A`).lastInsertRowid);
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

// Part 11.04: a planner registers deliverables (one with the form), records IFR and IFA, sends the IFC release and the chain (discipline lead, engineering manager, project manager) approves it; the weighted progress, the discipline roll-up and the S-curve follow;
// client comments are answered and closed, a hold is raised and cleared; a vendor document is received, reviewed and accepted after the engineering manager approves the code, and the tracker by purchase order shows it. A person without the right sees the no-permission state.
test('AC-01 deliverable register with weighted progress, S-curve, comments, holds and vendor document tracking, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = info.project.name === 'mobile' ? 'epm' : 'epd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const plan = s.u('plan'); const des1 = s.u('des1'); const des2 = s.u('des2'); const pm = s.u('pm');
  // a second deliverable of weight 100 comes through the API so the roll-up has two
  await api(request, c, 'PLAN', plan, 'post', '/engg/deliverables', { projectId: s.project, deliverableNo: `${t.toUpperCase()}-PIP-001`, title: 'Piping layout, compressor house', discipline: 'PIPING', type: 'DRAWING', weight: 100, packageName: 'PK2', planIfr: '2026-01-10', planIfa: '2026-02-10', planIfc: '2026-03-10' });
  const r = await open(browser, info, c, 'PLAN', plan, '/engg/deliverables');
  const errors = watch(r.page);
  await expect(r.page.getByRole('heading', { name: 'Deliverable Register', level: 1 })).toBeVisible();
  await r.page.getByTestId('del-new').click();
  await r.page.getByTestId('del-f-project').selectOption(String(s.project));
  await r.page.getByTestId('del-f-deliverableNo').fill(`${t.toUpperCase()}-STR-001`);
  await r.page.getByTestId('del-f-title').fill('Compressor foundation general arrangement');
  await r.page.getByTestId('del-f-packageName').fill('PK1');
  await r.page.getByTestId('del-f-planIfr').fill('2026-01-10'); await r.page.getByTestId('del-f-planIfa').fill('2026-02-10'); await r.page.getByTestId('del-f-planIfc').fill('2026-03-10');
  await shot(r.page, 'register-new', info);
  await noOverflow(r.page);
  await r.page.getByTestId('del-create').click();
  await expect(r.page.getByTestId('deliverable')).toBeVisible();
  const id = Number(new URL(r.page.url()).searchParams.get('id'));
  await expect(r.page.getByTestId('deliverable')).toHaveAttribute('data-progress', '0.00');
  await r.page.getByTestId('ms-record-IFR').click();
  await expect(r.page.getByTestId('deliverable')).toHaveAttribute('data-progress', '50.00');
  await r.page.getByTestId('ms-record-IFA').click();
  await expect(r.page.getByTestId('deliverable')).toHaveAttribute('data-progress', '70.00');
  // the IFC release: pending does not count; approved does
  await r.page.getByTestId('del-release').click();
  await expect(r.page.getByTestId('del-pending')).toBeVisible();
  await expect(r.page.getByTestId('deliverable')).toHaveAttribute('data-progress', '70.00');
  const wf = (await api(request, c, 'PLAN', plan, 'get', `/engg/deliverables/${id}`)).workflowInstanceId;
  await approve(request, c, 'DESIGN', des1, wf); await approve(request, c, 'DESIGN', des2, wf); await approve(request, c, 'PM', pm, wf);
  await r.page.reload();
  await expect(r.page.getByTestId('deliverable')).toHaveAttribute('data-milestone', 'IFC');
  await expect(r.page.getByTestId('deliverable')).toHaveAttribute('data-progress', '100.00');
  await shot(r.page, 'deliverable-released', info);
  await noOverflow(r.page);
  // the client comment resolution sheet
  await r.page.getByRole('tab', { name: 'Client comments' }).click();
  await r.page.getByTestId('crs-comment').fill('Show the anchor bolt projection and grout thickness');
  await r.page.getByTestId('crs-add').click();
  await expect(r.page.getByTestId('crs-A-1')).toHaveAttribute('data-status', 'OPEN');
  await r.page.getByTestId('crs-reply-A-1').fill('Projection and grout thickness added in revision B');
  await r.page.getByTestId('crs-respond-A-1').click();
  await expect(r.page.getByTestId('crs-A-1')).toHaveAttribute('data-status', 'RESPONDED');
  await r.page.getByTestId('crs-close-A-1').click();
  await expect(r.page.getByTestId('crs-A-1')).toHaveAttribute('data-status', 'CLOSED');
  // a hold
  await r.page.getByRole('tab', { name: 'Holds' }).click();
  await r.page.getByTestId('hold-description').fill('Waiting for the final compressor vendor loads');
  await r.page.getByTestId('hold-po').fill('PO-1001'); await r.page.getByTestId('hold-proc').check();
  await r.page.getByTestId('hold-raise').click();
  await expect(r.page.getByTestId('hold-HLD-00001')).toHaveAttribute('data-status', 'OPEN');
  await shot(r.page, 'deliverable-holds', info);
  // the progress dashboard
  const d = await open(browser, info, c, 'DESIGN', des1, '/engg/progress');
  const e2 = watch(d.page);
  await expect(d.page.getByRole('heading', { name: 'Engineering Progress', level: 1 })).toBeVisible();
  await expect(d.page.getByTestId('prog-disc-STRUCTURAL')).toHaveAttribute('data-progress', '100.00');
  await expect(d.page.getByTestId('prog-disc-PIPING')).toHaveAttribute('data-progress', '0.00');
  await expect(d.page.getByTestId('prog-tile-progress')).toHaveAttribute('data-value', '50.00');
  await expect(d.page.getByTestId('prog-tile-holds')).toHaveAttribute('data-value', '1');
  await expect(d.page.getByTestId('prog-tile-overdue')).toHaveAttribute('data-value', '1');
  await expect(d.page.getByTestId('scurve-planned')).toBeVisible();
  await expect(d.page.getByTestId('prog-overdue')).toContainText('PIP-001');
  await shot(d.page, 'progress', info);
  await noOverflow(d.page);
  // vendor document requirement
  await d.page.goto('/engg/vdr');
  await expect(d.page.getByRole('heading', { name: 'VDR Tracker', level: 1 })).toBeVisible();
  await d.page.getByTestId('vdr-new').click();
  await d.page.getByTestId('vdr-f-project').selectOption(String(s.project));
  await d.page.getByTestId('vdr-f-poRef').fill('PO-2001');
  await d.page.getByTestId('vdr-f-vendor').fill('Kirloskar Pumps');
  await d.page.getByTestId('vdr-f-title').fill('GA drawing of the cooling water pump');
  await d.page.getByTestId('vdr-create').click();
  await expect(d.page.getByTestId('vdr-item')).toBeVisible();
  await d.page.getByTestId('vdr-receive').click();
  await expect(d.page.getByTestId('vdr-item')).toHaveAttribute('data-status', 'RECEIVED');
  await d.page.getByTestId('vdr-code').selectOption('A');
  await d.page.getByTestId('vdr-send-review').click();
  await expect(d.page.getByTestId('vdr-item')).toHaveAttribute('data-status', 'IN_REVIEW');
  const vid = Number(new URL(d.page.url()).searchParams.get('id'));
  const wf2 = (await api(request, c, 'DESIGN', des1, 'get', `/engg/vdr-items/${vid}`)).workflowInstanceId;
  await approve(request, c, 'DESIGN', des2, wf2);
  await d.page.reload();
  await expect(d.page.getByTestId('vdr-item')).toHaveAttribute('data-status', 'ACCEPTED');
  await expect(d.page.getByTestId('vdr-review')).toContainText('A');
  await shot(d.page, 'vdr-item', info);
  await d.page.goto('/engg/vdr');
  await expect(d.page.getByTestId('vdr-po-PO-2001')).toBeVisible();
  await expect(d.page.getByTestId('vdr-tracker')).toContainText('100%');
  await shot(d.page, 'vdr-tracker', info);
  await noOverflow(d.page);
  expect(errors).toEqual([]); expect(e2).toEqual([]);
});

test('AC-03 a person without the right sees the no-permission state', async ({ browser, request }, info) => {
  const t = info.project.name === 'mobile' ? 'epn' : 'epk';
  const c = await company(request, t.toUpperCase());
  seed(c, t);
  const { page } = await open(browser, info, c, 'BD', `${t}-bd`, '/engg/deliverables');
  await expect(page.getByRole('heading', { name: /You do not have access/ })).toBeVisible();
  await expect(page.getByText('engg.deliverable.view')).toBeVisible();
  await noOverflow(page);
});
