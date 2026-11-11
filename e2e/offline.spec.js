import { test, expect } from '@playwright/test';

// Development-header mode (port 3100). Part 04.15: a form filled in with no connection (checked with the rules kept on the phone, saved in the encrypted store, a photo with it), sent when the connection returns
// with the photo in chunks, nothing readable in the local database, a conflict decided on the Conflict Resolution page, the Devices page, and a revoked device that wipes itself.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|ERR_INTERNET_DISCONNECTED|Cannot reach the server/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const api = async (request, c, roles, user, method, path, data, ok = true) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  if (ok) expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return ok ? (await res.json()).data : res;
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
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, permissions: [] });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

test('AC-01 FR-01 FR-03 FR-04 FR-05 FR-07 FR-08 a form captured offline with a photo, kept encrypted, sent when the connection returns; T-03 a revoked device wipes its local store', async ({ browser, request }, info) => {
  test.setTimeout(90_000);
  const tag = info.project.name === 'mobile' ? 'M' : 'D';
  const c = await company(request, `OFF${tag}`);
  const project = await api(request, c, 'PM', 'e2e-pm', 'post', '/iam/org/projects', { code: `OF${tag}1`, name: 'Ring Road', type: 'ROAD' });
  const { page, context } = await open(browser, info, c, 'SE', 'e2e-se', '/field/forms');
  const errors = watch(page);
  await expect(page.getByRole('heading', { name: 'Field Forms', level: 1 })).toBeVisible();
  // the list of forms: the real one, and the planned ones with the part that brings them
  await expect(page.getByTestId('form-sample_doc')).toBeVisible();
  await expect(page.getByTestId('form-dpr')).not.toContainText('Available with part'); // live since part 14.02 registered it; it opens its own entry page
  await expect(page.getByTestId('form-attendance_punch')).not.toHaveAttribute('aria-disabled', 'true'); // live since part 07.05 registered it
  await page.getByTestId('form-sample_doc').click();
  await expect(page.getByTestId('field-form')).toBeVisible();
  await expect(page.getByTestId('ff-projectId')).toContainText(`OF${tag}1`); // the masters are on the phone
  // no connection from here on
  await context.setOffline(true);
  await expect(page.getByTestId('ff-online')).toContainText('Offline');
  // offline validation with the cached rules
  await page.getByTestId('ff-title').fill('ab');
  await page.getByTestId('ff-amount').fill('12.345');
  await page.getByTestId('ff-save').click();
  await expect(page.getByText('Title: give 3 to 200 characters.')).toBeVisible();
  await expect(page.getByText(/Amount \(₹\): write a number above zero/)).toBeVisible();
  await page.getByTestId('ff-title').fill('Offline shuttering for the bridge');
  await page.getByTestId('ff-amount').fill('18500.50');
  await page.getByTestId('ff-projectId').selectOption(String(project.id));
  await page.getByTestId('ff-photos').setInputFiles([{ name: 'site.png', mimeType: 'image/png', buffer: PNG }]);
  await page.getByTestId('ff-save').click();
  await expect(page.getByTestId('ff-saved')).toContainText('Saved on this phone');
  await expect(page.getByTestId('ff-queue')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('ff-item')).toContainText('Waiting to be sent');
  await noOverflow(page);
  // FR-01: the local database holds records and none of them is readable text
  const raw = await page.evaluate(() => new Promise((resolve, reject) => {
    const r = indexedDB.open('erp-offline');
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const g = r.result.transaction('records', 'readonly').objectStore('records').getAll();
      g.onsuccess = () => resolve(g.result.map((x) => ({ store: x.store, text: new TextDecoder().decode(new Uint8Array(x.data)) })));
    };
  }));
  expect(raw.length).toBeGreaterThan(3);
  expect(raw.some((x) => x.store === 'media')).toBe(true);
  expect(raw.some((x) => /shuttering|18500|Ring Road/i.test(x.text))).toBe(false);
  // Sync Status offline: the queue, no way to send
  await page.getByTestId('ff-queue').getByRole('link', { name: 'Sync status' }).click(); // inside the application: no page load while offline
  await expect(page.getByRole('heading', { name: 'Sync Status', level: 1 })).toBeVisible();
  await expect(page.getByTestId('ss-count')).toHaveAttribute('data-count', '1');
  await expect(page.getByTestId('ss-online')).toHaveAttribute('data-online', 'false');
  await expect(page.getByTestId('ss-force')).toBeDisabled();
  expect((await api(request, c, 'SE', 'e2e-se', 'get', '/eng/sample-docs')).rows.length).toBe(0);
  // the connection returns: the record and then the photo are sent
  await context.setOffline(false);
  await expect(page.getByTestId('ss-count')).toHaveAttribute('data-count', '0', { timeout: 30_000 });
  const docs = await api(request, c, 'SE', 'e2e-se', 'get', '/eng/sample-docs');
  expect(docs.rows.length).toBe(1);
  expect(docs.rows[0].title).toBe('Offline shuttering for the bridge');
  const files = await api(request, c, 'SE', 'e2e-se', 'get', `/core/files?entity=sample_doc&entityId=${docs.rows[0].id}`);
  expect((files.rows ?? files).length).toBe(1);
  await expect(page.getByTestId('ss-last')).not.toContainText('never');
  expect(errors).toEqual([]);

  // T-02 a conflict decided on the Conflict Resolution page (the clash is made through the sync API, as a second phone would)
  const dev = 'device-e2e-second-1';
  await api(request, c, 'SE', 'e2e-se', 'post', '/off/devices', { deviceId: dev, name: 'Second phone' });
  const doc = await api(request, c, 'SE', 'e2e-se', 'post', '/eng/sample-docs', { title: 'Kerb stones', amount: '1000.00', projectId: project.id });
  await api(request, c, 'SE', 'e2e-se', 'put', `/eng/sample-docs/${doc.id}`, { title: 'Kerb stones (site office)', amount: '1000.00', projectId: project.id, version: doc.version });
  const sent = await api(request, c, 'SE', 'e2e-se', 'post', '/off/sync', { deviceId: dev, commands: [{ id: `cmd-e2e-${tag}-conflict-1`, seq: 1, type: 'sample_doc', op: 'update', entityId: String(doc.id), baseVersion: doc.version, baseValues: { title: 'Kerb stones' }, values: { title: 'Kerb stones (from the phone)' }, createdAt: new Date().toISOString() }] });
  expect(sent.results[0].status).toBe('CONFLICT');
  await page.goto('/field/sync/conflicts');
  await expect(page.getByRole('heading', { name: 'Conflict Resolution', level: 1 })).toBeVisible();
  await expect(page.getByTestId('cf-title-mine')).toHaveText('Kerb stones (from the phone)');
  await expect(page.getByTestId('cf-title-server')).toHaveText('Kerb stones (site office)');
  await noOverflow(page);
  await page.getByTestId('cf-title').getByLabel(/Mine/).check();
  await page.getByTestId('cf-merge').click();
  await expect(page.getByText('No conflicts')).toBeVisible();
  const after = await api(request, c, 'SE', 'e2e-se', 'get', `/eng/sample-docs/${doc.id}`);
  expect(after.title).toBe('Kerb stones (from the phone)');

  // the Devices page for the IT administrator
  const it = await open(browser, info, c, 'ITADM', 'e2e-it', '/admin/devices');
  const e2 = watch(it.page);
  await expect(it.page.getByRole('heading', { name: 'Devices', level: 1 })).toBeVisible();
  await expect(it.page.getByRole('row', { name: /e2e-se/ }).first()).toBeVisible();
  await noOverflow(it.page);
  // T-03: the browser of the site engineer is revoked; at its next contact its local store is removed
  const list = await api(request, c, 'ITADM', 'e2e-it', 'get', '/off/devices?all=true');
  const mine = list.rows.find((r) => r.name !== 'Second phone' && r.user === 'e2e-se');
  await it.page.getByTestId(`dv-revoke-${mine.id}`).click();
  await it.page.getByTestId('dv-reason').fill('Phone lost on site');
  await it.page.getByRole('button', { name: 'Revoke the device' }).click();
  await expect(it.page.getByTestId('dv-notice')).toContainText('was revoked');
  await expect(it.page.getByTestId(`dv-row-${mine.id}`)).toContainText('Revoked');
  expect(e2).toEqual([]);
  await page.goto('/field/sync'); // the phone makes contact when the application opens: the server answers that the device is revoked
  await expect(page.getByText('This device was revoked and its offline data removed.')).toBeVisible({ timeout: 15_000 });
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
  expect(dbs).not.toContain('erp-offline');
  const after2 = (await api(request, c, 'ITADM', 'e2e-it', 'get', '/off/devices?all=true')).rows.find((r) => r.id === mine.id);
  expect(after2.status).toBe('WIPED');
});

test('AC-03 a person without the right sees the no-permission state on the Devices page', async ({ browser, request }, info) => {
  const c = await company(request, `OFN${info.project.name === 'mobile' ? 'M' : 'D'}`);
  const { page } = await open(browser, info, c, 'EMP', 'e2e-emp', '/admin/devices');
  await expect(page.getByRole('heading', { name: 'You do not have access to Devices' })).toBeVisible();
  await expect(page.getByText('off.device.manage')).toBeVisible();
  await noOverflow(page);
});
