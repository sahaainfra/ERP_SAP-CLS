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

const OUT = 'docs/erp/screenshots/engg';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG2 = Buffer.concat([PNG, Buffer.from('rev-b')]);
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['doc1', ['DOC']], ['doc2', ['DOC']], ['des', ['DESIGN']], ['pm', ['PM']], ['se', ['SE']], ['bd', ['BD']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type) VALUES (?, ?, 'Flyover at the junction', 'ROAD')").run(c, `${t.toUpperCase()}-A`).lastInsertRowid);
  db.prepare("INSERT INTO proj_projects (company_id, project_id, lifecycle_state, pm_user, created_by) VALUES (?, ?, 'EXECUTION', ?, 'e2e')").run(c, id, `${t}-pm`);
  db.close();
  return { u: (k) => `${t}-${k}`, project: id };
}
/** Decides the approval of an instance as the person who holds the task. */
async function approve(request, c, roles, user, instanceId, action = 'approve') {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task of instance ${instanceId}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked' });
}
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });

// Part 11.01: a document controller registers a drawing, attaches the file and sends the IFC revision (document control, design coordinator, project manager); it is issued, a controlled copy goes to the site engineer, who acknowledges it on the
// "Current drawings for my site" page; a new IFC revision supersedes the old one: the old one is marked "SUPERSEDED, DO NOT USE", the site sees only the new one, and the compare viewer puts both side by side. A transmittal for approval is checked and issued,
// and the response codes are recorded on it. A person without the right sees the no-permission state. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 T-01 T-02 register, IFC approval, controlled copy, supersession, comparison, transmittal and responses, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = info.project.name === 'mobile' ? 'egm' : 'egd';
  const c = await company(request, t.toUpperCase());
  const s = seed(c, t); const doc1 = s.u('doc1'); const doc2 = s.u('doc2'); const des = s.u('des'); const pm = s.u('pm'); const se = s.u('se');
  const no = `${t.toUpperCase()}-STR-101`;

  // the document controller registers the drawing with the form
  const d = await open(browser, info, c, 'DOC', doc1, '/engg/drawings');
  const errors = watch(d.page);
  await expect(d.page.getByRole('heading', { name: 'Drawing Register', level: 1 })).toBeVisible();
  await d.page.getByTestId('eg-new').click();
  await d.page.getByTestId('eg-f-project').selectOption(String(s.project));
  await d.page.getByTestId('eg-f-no').fill(no);
  await d.page.getByTestId('eg-f-title').fill('Pier 4 reinforcement layout');
  await d.page.getByTestId('eg-f-package').fill('Substructure');
  await d.page.getByTestId('eg-f-planned').fill(day(-2));
  await d.page.getByTestId('eg-f-activity').fill('A1010 Pier 4 reinforcement');
  await shot(d.page, 'register-new', info);
  await noOverflow(d.page);
  await d.page.getByTestId('eg-create').click();
  await expect(d.page.getByTestId('drawing')).toBeVisible();
  await expect(d.page.getByRole('heading', { name: new RegExp(no) })).toBeVisible();
  await expect(d.page.getByTestId('drawing')).toHaveAttribute('data-usable', '0');
  // attach the file and send the IFC revision for approval
  await d.page.getByTestId('file-input').setInputFiles({ name: 'pier4-a.png', mimeType: 'image/png', buffer: PNG });
  await expect(d.page.getByTestId('file-pier4-a.png')).toBeVisible({ timeout: 20_000 });
  await d.page.getByTestId('rev-submit-A').click();
  await expect(d.page.getByTestId('dwg-note')).toContainText('Sent to document control');
  await expect(d.page.getByTestId('rev-A')).toHaveAttribute('data-status', 'SUBMITTED');
  const dr = await api(request, c, 'DOC', doc1, 'get', `/engg/drawings?filter[projectId]=${s.project}`);
  const id = dr[0].id;
  const wf1 = (await api(request, c, 'DOC', doc1, 'get', `/engg/drawings/${id}`)).revisions[0].workflowInstanceId;
  await approve(request, c, 'DOC', doc2, wf1); await approve(request, c, 'DESIGN', des, wf1); await approve(request, c, 'PM', pm, wf1);
  await d.page.reload();
  await expect(d.page.getByTestId('drawing')).toHaveAttribute('data-usable', '1');
  await expect(d.page.getByTestId('dwg-current')).toContainText('Issued for construction');
  await expect(d.page.getByTestId('rev-A')).toHaveAttribute('data-status', 'ISSUED');
  await shot(d.page, 'drawing-issued', info);
  await noOverflow(d.page);

  // a controlled copy for the site engineer
  await d.page.getByRole('tab', { name: 'Controlled copies' }).click();
  await d.page.getByTestId('dist-revision').selectOption({ label: 'A · Issued for construction' });
  await d.page.getByTestId('dist-users').fill(se);
  await d.page.getByTestId('dist-send').click();
  await expect(d.page.getByTestId('dwg-note')).toContainText('Controlled copies issued');
  await expect(d.page.getByTestId('dwg-copies')).toContainText(se);

  // the site engineer: the current drawing, the copy to acknowledge
  const site = await open(browser, info, c, 'SE', se, '/engg/site');
  const e2 = watch(site.page);
  await expect(site.page.getByRole('heading', { name: 'Current Drawings for my Site', level: 1 })).toBeVisible();
  await expect(site.page.getByTestId(`site-${no}`)).toHaveAttribute('data-revision', 'A');
  await expect(site.page.getByTestId(`site-copy-${no}`)).toContainText('not yet acknowledged');
  await shot(site.page, 'site-rev-a', info);
  await site.page.getByTestId(`site-ack-${no}`).click();
  await expect(site.page.getByTestId(`site-copy-${no}`)).toHaveText('Acknowledged');
  await site.page.getByTestId(`site-open-${no}`).click();
  await expect(site.page.getByTestId(`site-file-${no}`)).toBeVisible();
  await noOverflow(site.page);

  // revision B supersedes A
  await d.page.getByRole('tab', { name: 'Revisions' }).click();
  await d.page.getByTestId('rev-f-label').fill('B');
  await d.page.getByTestId('rev-f-note').fill('Added starter bars at pier 4');
  await d.page.getByTestId('rev-f-cloud').fill('Cloud 1: starter bars');
  await d.page.getByTestId('rev-create').click();
  await expect(d.page.getByTestId('dwg-note')).toContainText('draft');
  await d.page.getByTestId('file-input').setInputFiles({ name: 'pier4-b.png', mimeType: 'image/png', buffer: PNG2 });
  await expect(d.page.getByTestId('file-pier4-b.png')).toBeVisible({ timeout: 20_000 });
  await d.page.getByTestId('rev-submit-B').click();
  await expect(d.page.getByTestId('rev-B')).toHaveAttribute('data-status', 'SUBMITTED');
  const wf2 = (await api(request, c, 'DOC', doc1, 'get', `/engg/drawings/${id}`)).revisions.find((r) => r.label === 'B').workflowInstanceId;
  await approve(request, c, 'DOC', doc2, wf2); await approve(request, c, 'DESIGN', des, wf2); await approve(request, c, 'PM', pm, wf2);
  await d.page.reload();
  await expect(d.page.getByTestId('rev-A')).toHaveAttribute('data-status', 'SUPERSEDED');
  await expect(d.page.getByTestId('rev-banner-A')).toContainText('SUPERSEDED, DO NOT USE');
  await expect(d.page.getByTestId('rev-B')).toHaveAttribute('data-status', 'ISSUED');
  await shot(d.page, 'drawing-superseded', info);
  // the comparison viewer
  await d.page.getByRole('tab', { name: 'Compare' }).click();
  await d.page.getByTestId('cmp-from').selectOption({ label: 'A · Issued for construction' });
  await d.page.getByTestId('cmp-to').selectOption({ label: 'B · Issued for construction' });
  await expect(d.page.getByTestId('cmp-diff')).toContainText('Added starter bars at pier 4');
  await expect(d.page.getByTestId('cmp-left')).toContainText('SUPERSEDED, DO NOT USE');
  await expect(d.page.getByTestId('cmp-file-left')).toBeVisible(); await expect(d.page.getByTestId('cmp-file-right')).toBeVisible();
  await shot(d.page, 'compare', info);
  await noOverflow(d.page);
  // the site: only revision B, and the holder was told
  await site.page.reload();
  await expect(site.page.getByTestId(`site-${no}`)).toHaveAttribute('data-revision', 'B');
  await expect(site.page.getByTestId(`site-copy-${no}`)).toContainText('not yet acknowledged');
  await expect(site.page.getByTestId('site-list').locator('li')).toHaveCount(1);
  await shot(site.page, 'site-rev-b', info);
  const sdr = await api(request, c, 'SE', se, 'get', `/engg/revisions/${(await api(request, c, 'DOC', doc1, 'get', `/engg/drawings/${id}`)).revisions.find((r) => r.label === 'A').id}`);
  expect(sdr.file, 'the file of the superseded revision is closed to the site').toBeNull();
  expect(errors).toEqual([]); expect(e2).toEqual([]);

  // a transmittal for approval: a drawing issued for approval is picked, checked, issued, and the response codes are recorded
  const ifa = await api(request, c, 'DOC', doc1, 'post', '/engg/drawings', { projectId: s.project, drawingNo: `${no}-IFA`, title: 'Abutment details', discipline: 'CIVIL', revision: { label: 'P1', statusCode: 'IFA', changeNote: 'For approval' } });
  const fd = await request.post('/api/v1/core/files', { headers: { 'x-erp-user': doc1, 'x-erp-roles': 'DOC', 'x-erp-company': String(c) }, multipart: { entity: 'engg_drawing_revision', entityId: String(ifa.revisions[0].id), file: { name: 'abutment.png', mimeType: 'image/png', buffer: PNG } } });
  expect(fd.status(), await fd.text()).toBe(201);
  await api(request, c, 'DOC', doc1, 'post', `/engg/revisions/${ifa.revisions[0].id}/submit`, {});
  await d.page.goto('/engg/transmittals');
  await expect(d.page.getByRole('heading', { name: 'Transmittals', level: 1 })).toBeVisible();
  await d.page.getByTestId('tx-new').click();
  await d.page.getByTestId('tx-f-project').selectOption(String(s.project));
  await d.page.getByTestId('tx-f-party').fill('Mehta Associates');
  await d.page.getByTestId('tx-f-cover').fill('Please review and respond');
  await d.page.getByTestId(`tx-pick-${no}-IFA`).check();
  await d.page.getByTestId(`tx-pick-${no}`).check();
  await shot(d.page, 'transmittal-new', info);
  await noOverflow(d.page);
  await d.page.getByTestId('tx-create').click();
  await expect(d.page.getByTestId('transmittal')).toBeVisible();
  await expect(d.page.getByTestId('transmittal')).toHaveAttribute('data-status', 'DRAFT');
  await d.page.getByTestId('tx-submit').click();
  await expect(d.page.getByTestId('tx-note')).toContainText('document control');
  const txId = Number(new URL(d.page.url()).searchParams.get('id'));
  const wf3 = (await api(request, c, 'DOC', doc1, 'get', `/engg/transmittals/${txId}`)).workflowInstanceId;
  await approve(request, c, 'DOC', doc2, wf3); await approve(request, c, 'DESIGN', des, wf3);
  await d.page.reload();
  await expect(d.page.getByTestId('transmittal')).toHaveAttribute('data-status', 'ISSUED');
  // T-02 the responses
  await d.page.getByTestId(`tx-code-${no}`).selectOption('A');
  await d.page.getByTestId(`tx-code-${no}-IFA`).selectOption('C');
  await d.page.getByTestId(`tx-comment-${no}-IFA`).fill('Bearing seat level to be revised');
  await d.page.getByTestId('tx-respond').click();
  await expect(d.page.getByTestId('tx-note')).toContainText('recorded');
  await expect(d.page.getByTestId('transmittal')).toHaveAttribute('data-status', 'CLOSED');
  await expect(d.page.getByTestId(`tx-resp-${no}-IFA`)).toContainText('C Revise and resubmit');
  await shot(d.page, 'transmittal-closed', info);
  await noOverflow(d.page);
  const after = await api(request, c, 'DOC', doc1, 'get', `/engg/drawings/${ifa.id}`);
  expect([after.responseCode, after.transmittals.length]).toEqual(['C', 1]);

  // the dashboard
  await d.page.goto('/engg/dashboard');
  await expect(d.page.getByRole('heading', { name: 'Drawings Dashboard', level: 1 })).toBeVisible();
  await expect(d.page.getByTestId('eg-tile-total')).toHaveAttribute('data-value', '2');
  await expect(d.page.getByTestId('eg-tile-ifc')).toHaveAttribute('data-value', '1');
  await expect(d.page.getByTestId('eg-overdue')).toContainText(no);
  await shot(d.page, 'dashboard', info);
  await noOverflow(d.page);
  expect(errors).toEqual([]);
});

test('AC-03 a person without the right sees the no-permission state', async ({ browser, request }, info) => {
  const t = info.project.name === 'mobile' ? 'egn' : 'egk';
  const c = await company(request, t.toUpperCase());
  seed(c, t);
  const { page } = await open(browser, info, c, 'BD', `${t}-bd`, '/engg/drawings');
  await expect(page.getByRole('heading', { name: /You do not have access/ })).toBeVisible();
  await expect(page.getByText('engg.drawing.view')).toBeVisible();
  await noOverflow(page);
});
