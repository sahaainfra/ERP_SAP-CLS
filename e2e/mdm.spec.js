import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { gstinCheckChar } from '../src/server/platform/mdm/index.js';

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


// Part 06.01: master data governance on the business partner master. A purchase manager asks for a partner that looks like an existing one: the form shows the possible duplicate before it is sent and asks to confirm;
// the pair appears in the duplicates report, is compared side by side and merged (approved by the steward and the accounts manager); the merged record stays and shows where it went. The dashboard, the change requests
// worklist and the rules and stewards page on a computer and on a phone.
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked against the documents' });
};
const gstin = (pan, state = '27') => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };
/** A company with a steward of the partner master (named through the approved change of rules and stewards) and some partners. */
async function governed(request, info, code) {
  const c = await company(request, code);
  const t = code.toLowerCase();
  const u = { proc: `${t}-proc`, acc: `${t}-acc`, stew: `${t}-stew`, sys: `${t}-sys`, it: `${t}-it` };
  people(c, [[u.proc, ['PROCMGR'], 'Pramod Purchase'], [u.acc, ['ACCMGR'], 'Anita Accounts'], [u.stew, ['SE'], 'Suresh Steward'], [u.sys, ['SYSADM'], 'Sam Admin'], [u.it, ['ITADM'], 'Indu IT']]);
  const cfg = await api(request, c, 'SYSADM', u.sys, 'post', '/mdm/config', { rules: [], stewards: [{ masterType: 'PARTNER', username: u.stew, role: 'PRIMARY' }], reason: 'The purchase lead keeps the partner master' });
  await act(request, c, 'ITADM', u.it, cfg.workflow.id);
  const partner = async (data, extra = {}) => {
    const r = await api(request, c, 'PROCMGR', u.proc, 'post', '/mdm/masters/PARTNER/records', { data, justification: 'New vendor for the Alpha project', ...extra });
    await act(request, c, 'SE', u.stew, r.workflow.id);
    await act(request, c, 'ACCMGR', u.acc, r.workflow.id);
    return r.record.id;
  };
  return { c, u, partner };
}

test('FR-02 BR-01 a similar partner is flagged before it is sent, compared and merged; the merged record stays and points to the survivor', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await governed(request, info, phone ? 'MDE2M' : 'MDE2D');
  const first = await g.partner({ name: 'Shree Ganesh Constructions Pvt Ltd', kind: 'VENDOR', pan: 'ABCDE1234F', gstin: gstin('ABCDE1234F'), mobile: '9876543210', pinCode: '411001', state: 'Maharashtra' });
  const p = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/master-data/records');
  const errors = watch(p.page);
  await expect(p.page.getByTestId('mdr-row')).toHaveCount(1);
  if (phone) await noOverflow(p.page);
  await p.page.getByTestId('mdm-new').click();
  const form = p.page.getByTestId('mdm-form');
  await form.getByTestId('mdf-name').fill('Shree Ganesh Construction');
  await form.getByTestId('mdf-kind').selectOption('SUBCONTRACTOR');
  await form.getByTestId('mdf-pan').fill('pqrsx6789k');
  await form.getByTestId('mdf-pan').blur();
  await expect(form.getByTestId('mdm-similar')).toContainText('Shree Ganesh Constructions');
  await form.getByTestId('mdf-why').fill('Subcontractor for the bridge works');
  await form.getByTestId('mdf-submit').click();
  await expect(form.getByTestId('mdf-error')).toContainText('confirm');
  await form.getByTestId('mdf-ack').check();
  await form.getByTestId('mdf-submit').click();
  await expect(form.getByTestId('mdm-form-done')).toContainText('Sent to the steward');
  await form.getByRole('button', { name: 'Close' }).click();
  await expect(p.page.getByTestId('mdm-record')).toBeVisible();
  await expect(p.page.getByTestId('mdd-pan')).toContainText('PQRSX6789K'.slice(-4));
  // the steward and the accounts manager approve the new record (in the approval inbox; here through the API)
  const reqs = await api(request, g.c, 'SE', g.u.stew, 'get', '/mdm/change-requests?view=review');
  expect(reqs.rows.length).toBe(1);
  await act(request, g.c, 'SE', g.u.stew, reqs.rows[0].instanceId);
  await act(request, g.c, 'ACCMGR', g.u.acc, reqs.rows[0].instanceId);
  // the duplicates report: compare, keep the first, ask to merge
  const d = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/master-data/duplicates?type=PARTNER');
  await expect(d.page.getByTestId('mdu-row')).toHaveCount(1);
  if (phone) await noOverflow(d.page);
  await d.page.getByTestId('mdu-compare').click();
  const dlg = d.page.getByTestId('mdu-dialog');
  await expect(dlg.getByTestId('mdu-field').first()).toBeVisible();
  const keepFirst = (await dlg.getByTestId('mdu-keep-a').locator('..').innerText()).includes('BP-00001') ? 'a' : 'b';
  await dlg.getByTestId(`mdu-keep-${keepFirst}`).check();
  await dlg.getByTestId('mdu-why').fill('The same company registered twice');
  await dlg.getByTestId('mdu-merge').click();
  await expect(d.page.getByTestId('mdu-note')).toContainText('sent for approval');
  const merge = (await api(request, g.c, 'SE', g.u.stew, 'get', '/mdm/change-requests?view=review')).rows.find((r) => r.changeType === 'MERGE');
  await act(request, g.c, 'SE', g.u.stew, merge.instanceId);
  await act(request, g.c, 'ACCMGR', g.u.acc, merge.instanceId);
  const second = merge.recordId;
  const m = await open(browser, info, g.c, 'PROCMGR', g.u.proc, `/admin/master-data/records?id=${second}`);
  await expect(m.page.getByTestId('mdd-merged')).toContainText('BP-00001');
  await m.page.getByTestId('mdd-merged').getByRole('link').click();
  await expect(m.page.getByRole('heading', { level: 1 })).toContainText('BP-00001');
  expect(first).toBeTruthy();
  if (phone) await noOverflow(m.page);
  expect(errors).toEqual([]);
});

test('FR-03 FR-05 FR-07 FR-08 the dashboard, a change from a later date with its history and as of, the change requests worklist and the rules and stewards', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await governed(request, info, phone ? 'MDF2M' : 'MDF2D');
  const id = await g.partner({ name: 'Kaveri Earthmovers', kind: 'VENDOR', pan: 'KAVER1234E', mobile: '9833333333', state: 'Karnataka' });
  const IST = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
  const r = await open(browser, info, g.c, 'PROCMGR', g.u.proc, `/admin/master-data/records?id=${id}`);
  const errors = watch(r.page);
  await r.page.getByTestId('mdd-change').click();
  const form = r.page.getByTestId('mdm-form');
  await form.getByTestId('mdf-state').selectOption('Tamil Nadu');
  await form.getByTestId('mdf-from').fill(IST(10));
  await expect(form.getByTestId('mdf-route')).toContainText('saved at once');
  await form.getByTestId('mdf-submit').click();
  await expect(form.getByTestId('mdm-form-done')).toContainText('applies from');
  await form.getByRole('button', { name: 'Close' }).click();
  await expect(r.page.getByTestId('mdd-state')).toHaveText('Karnataka');
  await expect(r.page.getByTestId('mdd-version')).toHaveCount(2);
  await r.page.getByTestId('mdd-asof').fill(IST(10));
  await expect(r.page.getByTestId('mdd-state')).toHaveText('Tamil Nadu');
  await expect(r.page.getByTestId('mdd-asof-note')).toContainText('version 2');
  if (phone) await noOverflow(r.page);
  // a sensitive change goes to the steward, who sees it in the worklist
  const fresh = await api(request, g.c, 'PROCMGR', g.u.proc, 'get', `/mdm/masters/PARTNER/records/${id}`);
  await api(request, g.c, 'PROCMGR', g.u.proc, 'put', `/mdm/masters/PARTNER/records/${id}`, { data: { bankAccount: '123456789012', ifsc: 'SBIN0001234' }, justification: 'New bank account letter received', version: fresh.rowVersion });
  const w = await open(browser, info, g.c, 'SE', g.u.stew, '/admin/master-data/change-requests?view=review');
  await expect(w.page.getByTestId('mcr-row')).toHaveCount(1);
  await w.page.getByTestId('mcr-row').getByRole('link').first().click();
  await expect(w.page.getByTestId('mcr-detail')).toContainText('New bank account letter received');
  await expect(w.page.getByTestId('mcr-field')).toHaveCount(2);
  if (phone) await noOverflow(w.page);
  const dash = await open(browser, info, g.c, 'ACCMGR', g.u.acc, '/admin/master-data');
  await expect(dash.page.getByTestId('mdm-master-PARTNER')).toBeVisible();
  await expect(dash.page.getByTestId('mdm-active-PARTNER')).toHaveText('1');
  await expect(dash.page.getByTestId('mdm-pending-PARTNER')).toHaveText('1');
  if (phone) await noOverflow(dash.page);
  const q = await open(browser, info, g.c, 'SYSADM', g.u.sys, '/admin/master-data/quality');
  await expect(q.page.getByTestId('mdq-steward')).toHaveCount(1);
  await q.page.getByTestId('mdq-edit').click();
  await q.page.getByTestId('mdq-add-steward').click();
  await q.page.getByTestId('mdq-steward-user').last().fill(g.u.acc);
  await q.page.getByTestId('mdq-reason').fill('Accounts keep the partner master as backup');
  await q.page.getByTestId('mdq-send').click();
  await expect(q.page.getByTestId('mdq-note')).toContainText('sent for approval');
  await expect(q.page.getByTestId('mdq-pending')).toBeVisible();
  if (phone) await noOverflow(q.page);
  expect(errors).toEqual([]);
});
