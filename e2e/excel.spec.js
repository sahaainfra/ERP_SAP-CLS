import { test, expect } from '@playwright/test';
import { templateWorkbook } from '../src/server/modules/eng/xl-xlsx.js';

// Development-header mode (port 3100). Part 04.13: the Import Center (download a template, upload a filled file with a duplicate, a bad code and a formula, read the preview and the errors, download the error file,
// import only the correct rows), the import job page, the template designer (a change waits for approval) and a person without the right.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const as = async (browser, info, company, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(company) });
  await page.goto(path);
  return page;
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
async function company(request, code) {
  const post = async (path, data) => {
    const res = await request.post(`/api/v1${path}`, { headers: H('SYSADM', 1, 'e2e-setup'), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const id = (await post('/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  expect((await request.put('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup'), data: { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) } })).status()).toBeLessThan(300);
  return id;
}
const api = async (request, c, roles, user, method, path, data, ok = true) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  if (ok) expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return ok ? (await res.json()).data : res;
};
const filled = async (request, c, rows) => {
  const cols = (await api(request, c, 'SYSADM', 'e2e-hr', 'get', '/xl/templates')).types.find((t) => t.code === 'ORG_DESIGNATION').columns;
  return Buffer.from(templateWorkbook({ importType: 'ORG_DESIGNATION', version: 0, title: 'x', columns: cols.map((x) => ({ key: x.key, label: x.label, required: x.required, type: x.type })), instructions: [], rowsRaw: true, rows: rows.map((r) => cols.map((x) => r[x.key] ?? null)) }));
};

test('AC-01 AC-02 FR-01 FR-02 FR-03 FR-04 FR-05 the Import Center end to end: template, upload, preview, row errors, error file, commit of the correct rows, history', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `IMP${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const hr = await as(browser, info, c, 'SYSADM', 'e2e-hr', '/import');
  const errors = watch(hr);
  await expect(hr.getByRole('heading', { name: 'Import Center', level: 1 })).toBeVisible();
  await expect(hr.getByTestId('type-ORG_DESIGNATION')).toContainText('Designations');
  await expect(hr.getByTestId('download-ENG_SAMPLE_DOC')).toHaveCount(0);
  await noOverflow(hr);
  const [dl] = await Promise.all([hr.waitForEvent('download'), hr.getByTestId('download-ORG_DESIGNATION').click()]);
  expect(dl.suggestedFilename()).toBe('org_designation-template-v0.xlsx');
  // a file with a duplicate, a bad code, a formula and a missing name, and two good rows
  const file = await filled(request, c, [
    { code: 'SE-1', name: 'Site Engineer', grade: 'G3', level: 4 },
    { code: 'SE-1', name: 'Site Engineer again' },
    { code: '!!', name: 'Bad code' },
    { code: 'SE-2', name: '=HYPERLINK("http://evil.example")' },
    { code: 'SE-3', name: 'Project Engineer', level: 6 },
    { code: 'SE-4' },
  ]);
  await hr.getByTestId('upload-type').selectOption('ORG_DESIGNATION');
  await hr.getByTestId('upload-file').setInputFiles({ name: 'designations.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: file });
  await hr.getByTestId('upload-go').click();
  await expect(hr.getByTestId('import-job')).toHaveAttribute('data-status', 'PREVIEW', { timeout: 30_000 });
  await expect(hr.getByTestId('count-errors')).toHaveText('4');
  await expect(hr.getByTestId('preview-table')).toContainText('Will create');
  await noOverflow(hr);
  await hr.getByTestId('tab-errors').click();
  const table = hr.getByTestId('errors-table');
  await expect(table).toContainText('Duplicate of row 2');
  await expect(table).toContainText('Code: use letters, digits');
  await expect(table).toContainText('holds a formula'.replace('holds a formula', 'starts with "="'));
  await expect(table).toContainText('Name is required');
  const [ef] = await Promise.all([hr.waitForEvent('download'), hr.getByTestId('error-file').click()]);
  expect(ef.suggestedFilename()).toBe('designations-errors.xlsx');
  // errors block the commit unless the correct rows alone are chosen
  await expect(hr.getByTestId('commit')).toBeDisabled();
  await hr.getByTestId('skip-invalid').check();
  await hr.getByTestId('commit').click();
  await expect(hr.getByTestId('import-job')).toHaveAttribute('data-status', 'COMMITTED', { timeout: 30_000 });
  await expect(hr.getByTestId('job-result')).toContainText('2 created');
  const got = await api(request, c, 'SYSADM', 'e2e-hr', 'get', '/iam/org/designations?limit=50');
  const made = Array.isArray(got) ? got : got.rows ?? got.items ?? [];
  expect(made.map((r) => r.code).sort()).toEqual(['SE-1', 'SE-3']);
  await hr.goto('/import');
  await expect(hr.getByTestId('jobs-table')).toContainText('Imported');
  await expect(hr.getByTestId('jobs-table')).toContainText('designations.xlsx');
  await noOverflow(hr);
  expect(errors).toEqual([]);
});

test('AC-04 AC-03 the template designer: a change waits for a second person, takes effect when a director approves it; a person without the right sees nothing', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `IMD${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys', '/admin/import-templates');
  const errors = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Import Template Designer', level: 1 })).toBeVisible();
  await sys.getByTestId('designer-type').selectOption('ORG_DESIGNATION');
  await sys.getByLabel('Label of name').fill('Designation name');
  await sys.getByLabel('grade is required').check();
  await noOverflow(sys);
  await expect(sys.getByTestId('designer-send')).toBeDisabled();
  await sys.getByTestId('designer-reason').fill('Our wording and a mandatory grade');
  await sys.getByTestId('designer-send').click();
  await expect(sys.getByTestId('designer-sent')).toBeVisible();
  await expect(sys.getByTestId('designer-pending')).toBeVisible({ timeout: 20_000 });
  const t = (await api(request, c, 'SYSADM', 'e2e-sys', 'get', '/xl/designer')).types.find((x) => x.code === 'ORG_DESIGNATION');
  const task = (await api(request, c, 'DIR', 'e2e-dir', 'get', '/workflow/tasks?mine=assigned')).rows.find((x) => x.instance.id === t.pending.instanceId);
  expect(task).toBeTruthy();
  await api(request, c, 'DIR', 'e2e-dir', 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'Checked' });
  await sys.goto('/admin/import-templates');
  await sys.getByTestId('designer-type').selectOption('ORG_DESIGNATION');
  await expect(sys.getByTestId('designer-history')).toContainText('Active');
  await expect(sys.getByLabel('Label of name')).toHaveValue('Designation name');
  await noOverflow(sys);
  const emp = await as(browser, info, c, 'EMP', 'e2e-emp', '/import');
  await expect(emp.getByTestId('no-permission')).toBeVisible();
  const emp2 = await as(browser, info, c, 'EMP', 'e2e-emp', '/admin/import-templates');
  await expect(emp2.getByTestId('no-permission')).toBeVisible();
  expect(errors).toEqual([]);
});
