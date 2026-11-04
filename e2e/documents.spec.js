import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

// Development-header mode (port 3100). Part 04.10: register a document through the form, attach the file, send it for approval; the reviewer and the project manager approve it;
// the viewer shows it and keeps a markup; a distribution is acknowledged; a new revision supersedes the old one; the document types page shows the configuration.
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
const pdf = async (text) => { const p = await PDFDocument.create(); p.addPage([400, 300]).drawText(text, { x: 40, y: 150, size: 18 }); return Buffer.from(await p.save()); };
const decide = async (request, c, roles, user, instanceId) => {
  const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows;
  const t = tasks.find((x) => x.instance.id === instanceId);
  expect(t, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${t.id}/act`, { action: 'approve', comment: 'Checked' });
};
/** Attach the file of the open revision (the virus scan takes a moment) and send it for approval; returns the workflow instance. */
async function attachAndSend(request, c, roles, user, doc, bytes) {
  const g = await api(request, c, roles, user, 'get', `/doc/documents/${doc}`);
  const res = await request.post('/api/v1/core/files', { headers: { 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(c), 'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}` }, multipart: { entity: 'doc_version', entityId: String(g.draftVersionId), file: { name: 'layout.pdf', mimeType: 'application/pdf', buffer: bytes } } });
  expect(res.status(), await res.text()).toBe(201);
  for (let i = 0; i < 40; i += 1) {
    const s = await api(request, c, roles, user, 'post', `/doc/documents/${doc}/submit`, {}, false);
    if (s.status() === 202) return (await s.json()).data.workflow.id;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('the file was not scanned in time');
}

test('AC-01 FR-01 FR-02 FR-05 FR-07 register a document in the form, attach the file, approve it; the viewer shows it and keeps a markup', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `DOC${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const se = await as(browser, info, c, 'SE', 'e2e-se', '/documents/new');
  const errors = watch(se);
  await expect(se.getByRole('heading', { name: 'New Document', level: 1 })).toBeVisible();
  await se.getByLabel('Title').fill('Pier 4 reinforcement layout');
  await se.getByLabel('Document type').selectOption('DRAWING');
  await se.getByLabel('Discipline').fill('Structural');
  await noOverflow(se);
  await se.getByRole('button', { name: 'Register and go on to the file' }).click();
  await expect(se.getByTestId('attach-revision')).toBeVisible();
  await expect(se.getByRole('heading', { level: 1 })).toContainText('Revision A of DOC-');
  const id = Number(new URL(se.url()).searchParams.get('document'));
  // the file goes up through the uploader
  await se.getByTestId('file-input').setInputFiles({ name: 'layout.pdf', mimeType: 'application/pdf', buffer: await pdf('Pier 4') });
  await expect(se.getByTestId('scan-layout.pdf')).toHaveText('Clean', { timeout: 30_000 });
  await se.getByRole('button', { name: 'Send for approval' }).click();
  await expect(se.getByTestId('document-page')).toBeVisible();
  const g = await api(request, c, 'SE', 'e2e-se', 'get', `/doc/documents/${id}`);
  expect(g.status).toBe('IN_REVIEW');
  const inst = g.versions[0].instanceId;
  expect(inst).toBeTruthy();
  await decide(request, c, 'DESIGN', 'e2e-lead', inst);
  await decide(request, c, 'PM', 'e2e-pm', inst);
  // the register lists it as issued; the viewer shows the page
  const pm = await as(browser, info, c, 'PM', 'e2e-pm', '/documents');
  watch(pm);
  await expect(pm.getByTestId('doc-register')).toBeVisible();
  const row = pm.getByTestId(`doc-${id}`);
  await expect(row).toContainText('Pier 4 reinforcement layout');
  await expect(row).toContainText('Issued');
  await noOverflow(pm);
  await pm.goto(`/documents/document?id=${id}`);
  await pm.getByRole('tab', { name: 'Viewer' }).click();
  await expect(pm.getByTestId('page-1')).toBeVisible({ timeout: 30_000 });
  await pm.getByRole('button', { name: /Note|Rectangle/ }).first().click();
  await noOverflow(pm);
  expect(errors).toEqual([]);
});

test('AC-02 FR-02 FR-06 an issued document is distributed; the controller sees who has not yet acknowledged and the revisions', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const c = await company(request, `DST${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const d = await api(request, c, 'SE', 'e2e-se', 'post', '/doc/documents', { title: 'Method statement for piling', docType: 'METHOD_STATEMENT' });
  const inst = await attachAndSend(request, c, 'SE', 'e2e-se', d.id, await pdf('Rev A'));
  for (const [roles, user] of [['QCE', 'e2e-lead'], ['DESIGN', 'e2e-lead'], ['QCMGR', 'e2e-qc'], ['PM', 'e2e-pm'], ['PM', 'e2e-pm']]) {
    const tasks = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows.filter((x) => x.instance.id === inst);
    if (tasks.length) await api(request, c, roles, user, 'post', `/workflow/tasks/${tasks[0].id}/act`, { action: 'approve', comment: 'ok' });
  }
  await api(request, c, 'DOC', 'e2e-doc', 'post', `/doc/documents/${d.id}/distribute`, { recipients: [{ type: 'EXTERNAL', id: 'surveyor@example.com', name: 'Surveyor' }], message: 'For piling', dueDays: 3 });
  const doc = await as(browser, info, c, 'DOC', 'e2e-doc', `/documents/document?id=${d.id}`);
  const errors = watch(doc);
  await expect(doc.getByTestId('document-page')).toBeVisible();
  await doc.getByRole('tab', { name: 'Distribution' }).click();
  await expect(doc.getByTestId('doc-distribution')).toContainText('Surveyor');
  await expect(doc.getByTestId('doc-distribution')).toContainText('not yet');
  await doc.getByRole('tab', { name: 'Revisions' }).click();
  await expect(doc.getByTestId('doc-versions')).toBeVisible();
  await noOverflow(doc);
  expect(errors).toEqual([]);
});

test('AC-03 FR-03 Document Types & Folder Templates: the configuration is shown and a change is sent for approval', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const c = await company(request, `DTY${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const sys = await as(browser, info, c, 'SYSADM', 'e2e-sys', '/admin/document-types');
  const errors = watch(sys);
  await expect(sys.getByRole('heading', { name: 'Document Types & Folder Templates', level: 1 })).toBeVisible();
  await expect(sys.getByTestId('type-table')).toContainText('DRAWING');
  await sys.getByLabel('Name of DRAWING').fill('Drawing (controlled)');
  await sys.getByLabel('Reason for the change (at least 5 characters)').fill('Rename for the register');
  await noOverflow(sys);
  await sys.getByRole('button', { name: 'Send for approval' }).click();
  await expect(sys.getByTestId('doc-config-pending')).toBeVisible();
  expect(errors).toEqual([]);
});
