import { test, expect } from '@playwright/test';

// Both viewport projects share one database, so each project works in its own company, created through the API first.
const pick = (info, desktop, mobile) => (info.project.name === 'desktop' ? desktop : mobile);
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });

async function newCompany(request, code) {
  const res = await request.post('/api/v1/iam/org/companies', { headers: H('SYSADM', 1, 'e2e-sys'), data: { code, legalName: `${code} Infra Pvt Ltd`, shortName: code } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).data.id;
}

async function open(page, roles, path, company, user) {
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(path);
  return errors;
}

const noOverflow = async (page) => {
  await page.addStyleTag({ content: '* { font-family: Verdana, sans-serif !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
};

async function decide(request, company, type, code, roles, user, action = 'approve') {
  const list = await request.get(`/api/v1/core/change-requests?filter[type]=${type}`, { headers: H(roles, company, user) });
  const pending = (await list.json()).data.filter((r) => r.status === 'SUBMITTED' && (r.payload.code === code || r.payload.siteId)).at(-1);
  expect(pending, `a pending ${type} request`).toBeTruthy();
  const res = await request.post(`/api/v1/core/change-requests/${pending.id}/act`, { headers: H(roles, company, user), data: { action, comment: 'checked and fine' } });
  expect(res.status(), await res.text()).toBe(200);
}

test('Departments and designations: create, search, edit, export, and a blocked deactivation lists what blocks it', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'ORGDESK', 'ORGMOB'));
  const errors = await open(page, 'HRMGR', '/admin/organisation', company, 'e2e-hr');
  await expect(page.getByRole('heading', { name: 'Organisation', exact: true })).toBeVisible();
  await expect(page).toHaveTitle(/Organisation/);
  await page.getByRole('tab', { name: 'Departments' }).click();
  await expect(page.getByRole('heading', { name: 'No departments' })).toBeVisible();

  await page.getByRole('button', { name: 'New department' }).first().click();
  await page.locator('dialog[open] input[name=code]').fill('ops');
  await page.locator('dialog[open] input[name=name]').fill('Operations');
  await page.locator('dialog[open] select[name=kind]').selectOption('DIVISION');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('departments-row-OPS')).toContainText('Operations');

  await page.getByRole('button', { name: 'New department' }).first().click();
  await page.locator('dialog[open] input[name=code]').fill('QA');
  await page.locator('dialog[open] input[name=name]').fill('Quality');
  await page.locator('dialog[open] select[name=parentId]').selectOption({ label: 'OPS - Operations' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('departments-row-QA')).toContainText('OPS');

  // the same code under the same parent is refused with a clear message
  await page.getByRole('button', { name: 'New department' }).first().click();
  await page.locator('dialog[open] input[name=code]').fill('qa');
  await page.locator('dialog[open] input[name=name]').fill('Quality again');
  await page.locator('dialog[open] select[name=parentId]').selectOption({ label: 'OPS - Operations' });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('dialog[open]')).toContainText('already used');
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('searchbox', { name: 'Search Departments' }).fill('qual');
  await expect(page.getByTestId('departments-row-QA')).toBeVisible();
  await expect(page.getByTestId('departments-row-OPS')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search Departments' }).fill('');

  await page.getByRole('button', { name: 'Edit QA' }).click();
  await page.locator('dialog[open] input[name=name]').fill('Quality Assurance');
  await page.locator('dialog[open] textarea[name=reason]').fill('Renamed by the head of HR');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('departments-row-QA')).toContainText('Quality Assurance');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toBe('departments.csv');

  await page.getByText('Columns').click();
  await page.getByRole('group', { name: 'Choose columns' }).getByLabel('Branch').uncheck();
  await expect(page.getByRole('columnheader', { name: 'Branch' })).toHaveCount(0);
  await page.getByText('Columns').click();

  await page.getByRole('button', { name: 'Deactivate OPS' }).click();
  await page.locator('dialog[open] textarea[name=reason]').fill('Reorganised away entirely');
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(page.getByTestId('blockers')).toContainText('1 active sub-departments');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Deactivate QA' }).click();
  await page.locator('dialog[open] textarea[name=reason]').fill('Merged into operations');
  await page.getByRole('button', { name: 'Deactivate', exact: true }).click();
  await expect(page.getByTestId('departments-row-QA')).toContainText('Inactive');

  await page.getByRole('tab', { name: 'Designations' }).click();
  await page.getByRole('button', { name: 'New designation' }).first().click();
  await page.locator('dialog[open] input[name=code]').fill('GM');
  await page.locator('dialog[open] input[name=name]').fill('General Manager');
  await page.locator('dialog[open] input[name=level]').fill('9');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('designations-row-GM')).toContainText('General Manager');

  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors.filter((e) => !/status of (409|422)/.test(e))).toEqual([]);
});

test('Companies and branches: only the system administrator manages them', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'CODESK', 'COMOB'));
  const errors = await open(page, 'HRMGR', '/admin/organisation', company, 'e2e-hr2');
  await expect(page.getByRole('tab', { name: 'Companies' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New company' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Branches & regions' }).click();
  await expect(page.getByRole('button', { name: 'New branch' })).toHaveCount(0);

  const sysPage = await page.context().newPage();
  await sysPage.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'e2e-sys', roles: 'SYSADM', company: '1' });
  await sysPage.goto('/admin/organisation');
  await sysPage.getByRole('tab', { name: 'Branches & regions' }).click();
  await sysPage.getByRole('button', { name: 'New branch' }).first().click();
  await sysPage.locator('dialog[open] input[name=code]').fill(pick(info, 'MUM1', 'MUM2'));
  await sysPage.locator('dialog[open] input[name=name]').fill('Mumbai');
  await sysPage.locator('dialog[open] select[name=stateCode]').selectOption('27');
  await sysPage.getByRole('button', { name: 'Save' }).click();
  await expect(sysPage.getByTestId(`branches-row-${pick(info, 'MUM1', 'MUM2')}`)).toContainText('27 Maharashtra');
  await sysPage.close();
  expect(errors).toEqual([]);
});

test('Project and site: create, approve activation, draw and test a geofence, then change it by approval', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'PRJDESK', 'PRJMOB'));
  const code = pick(info, 'TWR-D', 'TWR-M');
  const errors = await open(page, 'PM', '/admin/projects', company, 'e2e-pm');
  await expect(page.getByRole('heading', { name: 'Projects & Sites' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No projects' })).toBeVisible();

  await page.getByRole('button', { name: 'New project' }).first().click();
  await page.locator('dialog[open] input[name=code]').fill(code);
  await page.locator('dialog[open] input[name=name]').fill('Harbour Tower');
  await page.locator('dialog[open] select[name=type]').selectOption('BUILDING');
  await page.locator('dialog[open] input[name=startDate]').fill('2026-11-01');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId(`projects-row-${code}`)).toContainText('Draft');
  await page.getByRole('link', { name: code }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toBeVisible();
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toContainText('Draft');

  await page.getByRole('button', { name: 'Request activation' }).click();
  await page.locator('dialog[open] textarea[name=reason]').fill('Contract signed, mobilising');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByTestId('object-notice')).toContainText('sent to the project director');
  await page.getByRole('tab', { name: 'Approvals' }).click();
  await expect(page.locator('article.card').first()).toContainText('Waiting');
  await decide(request, company, 'org_activation', code, 'PD', 'e2e-pd');
  await decide(request, company, 'org_activation', code, 'PCMGR', 'e2e-pc');
  await page.reload();
  await page.getByRole('link', { name: code }).first().click();
  await expect(page.getByRole('heading', { name: new RegExp(code) })).toContainText('Active');
  await page.getByRole('tab', { name: 'Timeline' }).click();
  await expect(page.getByRole('table', { name: 'Audit trail' })).toContainText('Activated after approval');

  // a site of the project
  await page.getByRole('tab', { name: 'Sites' }).click();
  await page.getByRole('button', { name: 'New site' }).first().click();
  await page.locator('dialog[open] input[name=code]').fill('S1');
  await page.locator('dialog[open] input[name=name]').fill('Tower A');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('sites-row-S1')).toContainText('Draft');
  await page.getByTestId('sites-row-S1').getByRole('link', { name: 'S1' }).click();
  await expect(page.getByRole('heading', { name: /S1/ })).toBeVisible();

  // draw a polygon on the canvas and save it (a draft site takes it directly)
  await page.getByRole('tab', { name: 'Geofence' }).click();
  const editor = page.getByTestId('geofence-editor');
  await expect(editor).toBeVisible();
  await editor.getByLabel('Go to latitude').fill('19.076');
  await editor.getByLabel('Go to longitude').fill('72.8777');
  await editor.getByRole('button', { name: 'Polygon', exact: true }).click();
  const canvas = editor.locator('svg.gf-canvas');
  for (const [x, y] of [[220, 120], [420, 120], [420, 280], [220, 280]]) await canvas.click({ position: { x: (x / 640) * (await canvas.boundingBox()).width, y: (y / 400) * (await canvas.boundingBox()).height } });
  await expect(editor.getByRole('table', { name: 'Polygon corners' }).locator('tbody tr')).toHaveCount(4);
  await editor.getByRole('button', { name: 'Close shape' }).click();
  await page.getByRole('button', { name: 'Save geofence' }).click();
  await expect(page.getByTestId('object-notice')).toContainText('geofence was saved');
  await expect(page.locator('.tile').filter({ hasText: 'Geofence' })).toContainText('Polygon');

  // test a point: the middle of the canvas is inside; far away is outside
  const editor2 = page.getByTestId('geofence-editor');
  await editor2.getByRole('button', { name: 'Test a point' }).click();
  const box = await editor2.locator('svg.gf-canvas').boundingBox();
  await editor2.locator('svg.gf-canvas').click({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(editor2.getByTestId('gf-test-result')).toContainText('Inside the fence');
  await expect(editor2.getByTestId('gf-test-marker')).toBeVisible();
  const test = editor2.getByRole('group', { name: 'Test a coordinate' });
  await test.getByLabel('Latitude').fill('19.2');
  await test.getByLabel('Longitude').fill('72.8777');
  await test.getByRole('button', { name: 'Test this coordinate' }).click();
  await expect(editor2.getByTestId('gf-test-result')).toContainText('Outside the fence');

  // the site becomes active by approval, then a geofence change needs approval too
  await page.getByRole('button', { name: 'Request activation' }).click();
  await page.locator('dialog[open] textarea[name=reason]').fill('Mobilise the tower site');
  await page.getByRole('button', { name: 'Send request' }).click();
  await decide(request, company, 'org_activation', 'S1', 'PD', 'e2e-pd');
  await decide(request, company, 'org_activation', 'S1', 'PCMGR', 'e2e-pc');
  await page.reload();
  await page.getByRole('link', { name: code }).first().click();
  await page.getByRole('tab', { name: 'Sites' }).click();
  await expect(page.getByTestId('sites-row-S1')).toContainText('Active');
  await page.getByTestId('sites-row-S1').getByRole('link', { name: 'S1' }).click();
  await page.getByRole('tab', { name: 'Geofence' }).click();
  const live = page.getByTestId('geofence-editor');
  await live.getByRole('button', { name: 'Circle', exact: true }).click();
  const b2 = await live.locator('svg.gf-canvas').boundingBox();
  await live.locator('svg.gf-canvas').click({ position: { x: b2.width * 0.5, y: b2.height * 0.5 } });
  await expect(page.getByRole('button', { name: 'Request geofence change' })).toBeEnabled();
  await page.getByRole('button', { name: 'Request geofence change' }).click();
  await expect(page.locator('dialog[open] textarea[name=reason]')).toHaveAttribute('required', '');
  await page.locator('dialog[open] textarea[name=reason]').fill('Boundary redrawn as a circle after the survey');
  await page.getByRole('button', { name: 'Send request' }).click();
  await expect(page.getByTestId('object-notice')).toContainText('sent to the system administrator');
  await expect(page.locator('article.card').first()).toContainText('Waiting');
  await decide(request, company, 'org_geofence_change', 'S1', 'SYSADM', 'e2e-sys2');
  await page.reload();
  await page.getByRole('link', { name: code }).first().click();
  await page.getByRole('tab', { name: 'Sites' }).click();
  await page.getByTestId('sites-row-S1').getByRole('link', { name: 'S1' }).click();
  await expect(page.locator('.tile').filter({ hasText: 'Geofence' })).toContainText('100 m circle');

  // the shell's context switcher lists the project and its site
  const switcher = page.getByRole('group', { name: 'Working context' });
  await expect(switcher).toBeVisible();
  await switcher.getByLabel('Project').selectOption({ label: code });
  await expect(switcher.getByLabel('Site')).toBeEnabled();
  await expect(switcher.getByLabel('Site').locator('option', { hasText: 'S1' })).toHaveCount(1);

  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Site deactivation is blocked while a cost centre is still mapped to it, with the blocker listed', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'BLKDESK', 'BLKMOB'));
  const mk = async (roles, path, data, user) => (await (await request.post(`/api/v1/iam/org${path}`, { headers: H(roles, company, user), data })).json()).data;
  const project = await mk('PM', '/projects', { code: 'BLK', name: 'Blocked project', type: 'ROAD' }, 'e2e-pm2');
  const act = async (entity, id, code) => {
    await request.post(`/api/v1/iam/org/${entity}/${id}/activation-requests`, { headers: H('PM', company, 'e2e-pm2'), data: { reason: 'Mobilise now please' } });
    await decide(request, company, 'org_activation', code, 'PD', 'e2e-pd');
    await decide(request, company, 'org_activation', code, 'PCMGR', 'e2e-pc');
  };
  await act('projects', project.id, 'BLK');
  const site = await mk('PM', '/sites', { projectId: project.id, code: 'BS1', name: 'Blocked site' }, 'e2e-pm2');
  await act('sites', site.id, 'BS1');
  await mk('ACCMGR', '/cost-centres', { code: 'CC-BS1', name: 'Site cost', linkedType: 'SITE', linkedId: site.id }, 'e2e-acc');

  const errors = await open(page, 'PM', '/admin/projects', company, 'e2e-pm2');
  await page.getByRole('link', { name: 'BLK' }).first().click();
  await page.getByRole('tab', { name: 'Sites' }).click();
  await page.getByTestId('sites-row-BS1').getByRole('link', { name: 'BS1' }).click();
  await page.getByRole('button', { name: 'Deactivate' }).click();
  await page.locator('dialog[open] textarea[name=reason]').fill('Site demobilised after handover');
  await page.getByRole('button', { name: 'Deactivate', exact: true }).last().click();
  await expect(page.getByTestId('blockers')).toContainText('1 active cost centres linked to it');
  await expect(page.locator('h1')).toContainText('Active');
  expect(errors.filter((e) => !/status of 422/.test(e))).toEqual([]);
});

test('Organisation chart: search, move a department with undo, and the other views', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'CHTDESK', 'CHTMOB'));
  const mk = async (data) => (await (await request.post('/api/v1/iam/org/departments', { headers: H('HRMGR', company, 'e2e-hr3'), data })).json()).data;
  const eng = await mk({ code: 'ENG', name: 'Engineering', kind: 'DIVISION' });
  await mk({ code: 'CIV', name: 'Civil', parentId: eng.id });
  await mk({ code: 'FIN', name: 'Finance', kind: 'DIVISION' });
  const errors = await open(page, 'HRMGR', '/admin/org-chart', company, 'e2e-hr3');
  await expect(page.getByRole('heading', { name: 'Organisation Chart' })).toBeVisible();
  await expect(page.getByTestId('chart-ENG')).toContainText('Engineering');
  await expect(page.getByTestId('chart-CIV')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search the chart' }).fill('civil');
  await expect(page.getByTestId('chart-CIV')).toBeVisible();
  await expect(page.getByTestId('chart-FIN')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Search the chart' }).fill('');

  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.getByTestId('chart-CIV')).toHaveCount(0);
  await page.getByRole('button', { name: 'Expand all' }).click();

  await page.getByRole('button', { name: 'Move CIV' }).click();
  await page.locator('dialog[open] select[name=parentId]').selectOption({ label: 'FIN Finance' });
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(page.getByTestId('chart-notice')).toContainText('Civil was moved');
  await expect(page.getByTestId('chart-FIN').locator('[data-testid=chart-CIV]')).toBeVisible();
  await page.getByRole('button', { name: 'Undo move' }).click();
  await expect(page.getByTestId('chart-notice')).toContainText('undone');
  await expect(page.getByTestId('chart-ENG').locator('[data-testid=chart-CIV]')).toBeVisible();

  if (info.project.name === 'desktop') {
    await page.getByTestId('chart-CIV').locator('.chart-node').first().dragTo(page.getByTestId('chart-FIN').locator('.chart-node').first());
    await expect(page.getByTestId('chart-FIN').locator('[data-testid=chart-CIV]')).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Projects & sites' }).click();
  await expect(page.getByRole('heading', { name: 'No projects yet' })).toBeVisible();
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});

test('Cost and profit centres: list, map to a project, hierarchy view, and no access without the permission', async ({ page, request }, info) => {
  const company = await newCompany(request, pick(info, 'CCDESK', 'CCMOB'));
  const project = (await (await request.post('/api/v1/iam/org/projects', { headers: H('PM', company, 'e2e-pm3'), data: { code: 'CCP', name: 'Mapped project', type: 'EPC' } })).json()).data;
  const errors = await open(page, 'ACCMGR', '/admin/cost-centres', company, 'e2e-acc2');
  await expect(page.getByRole('heading', { name: 'Cost & Profit Centres' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No cost centres' })).toBeVisible();

  await page.getByRole('button', { name: 'New cost centre' }).first().click();
  await page.locator('dialog[open] input[name=code]').fill('GRP');
  await page.locator('dialog[open] input[name=name]').fill('Group');
  await page.locator('dialog[open] select[name=type]').selectOption('PROFIT');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('cost-centres-row-GRP')).toContainText('Profit centre');

  await page.getByRole('button', { name: 'New cost centre' }).first().click();
  await page.locator('dialog[open] input[name=code]').fill('OPS1');
  await page.locator('dialog[open] input[name=name]').fill('Project operations');
  await page.locator('dialog[open] select[name=parentId]').selectOption({ label: 'GRP - Group' });
  await page.locator('dialog[open] select[name=linkedType]').selectOption('PROJECT');
  await page.locator('dialog[open] select[name=linkedId]').selectOption({ label: `${project.code} - ${project.name}` });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('cost-centres-row-OPS1')).toContainText('Project: Mapped project');

  await page.getByRole('tab', { name: 'Hierarchy' }).click();
  await expect(page.getByTestId('cc-GRP').locator('[data-testid=cc-OPS1]')).toBeVisible();

  const forbidden = await page.context().newPage();
  await forbidden.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: 'nobody', roles: 'SUPPLIER', company: String(company) });
  await forbidden.goto('/admin/cost-centres');
  expect(await forbidden.getByRole('link', { name: 'Cost & Profit Centres' }).count()).toBe(0);
  await forbidden.close();
  if (info.project.name === 'mobile') await noOverflow(page);
  expect(errors).toEqual([]);
});
