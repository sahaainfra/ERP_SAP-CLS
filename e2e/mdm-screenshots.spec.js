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


// Screenshots of the 06.01 pages for docs/erp/screenshots/mdm. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/mdm';
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

test('screenshots of the master data governance pages', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  void watch; void noOverflow;
  const g = await governed(request, info, phone ? 'MDSM' : 'MDSD');
  const a = await g.partner({ name: 'Shree Ganesh Constructions Pvt Ltd', kind: 'VENDOR', pan: 'ABCDE1234F', gstin: gstin('ABCDE1234F'), mobile: '9876543210', pinCode: '411001', state: 'Maharashtra', email: 'accounts@shreeganesh.example' });
  await g.partner({ name: 'Patel Steel Traders', kind: 'VENDOR', pan: 'AAAPP1111A', mobile: '9811111111', state: 'Gujarat' });
  await g.partner({ name: 'Kaveri Earthmovers', kind: 'SUBCONTRACTOR', mobile: '9833333333', state: 'Karnataka' });
  await g.partner({ name: 'Shree Ganesh Construction', kind: 'SUBCONTRACTOR', pan: 'PQRSX6789K' }, { acknowledgeDuplicates: true });
  const rec = await api(request, g.c, 'PROCMGR', g.u.proc, 'get', `/mdm/masters/PARTNER/records/${a}`);
  await api(request, g.c, 'PROCMGR', g.u.proc, 'put', `/mdm/masters/PARTNER/records/${a}`, { data: { address: 'Plot 12, Hadapsar Industrial Estate' }, version: rec.rowVersion });
  const r2 = await api(request, g.c, 'PROCMGR', g.u.proc, 'get', `/mdm/masters/PARTNER/records/${a}`);
  await api(request, g.c, 'PROCMGR', g.u.proc, 'put', `/mdm/masters/PARTNER/records/${a}`, { data: { bankAccount: '123456789012', ifsc: 'SBIN0001234' }, justification: 'New bank account letter received', version: r2.rowVersion });
  const shot = async (page, name, full = true) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: full }); };
  const d = await open(browser, info, g.c, 'ACCMGR', g.u.acc, '/admin/master-data');
  await expect(d.page.getByTestId('mdm-master-PARTNER')).toBeVisible();
  await shot(d.page, '01-master-data-governance');
  const w = await open(browser, info, g.c, 'SE', g.u.stew, '/admin/master-data/change-requests?view=review');
  await expect(w.page.getByTestId('mcr-row')).toHaveCount(1);
  await w.page.getByTestId('mcr-row').getByRole('link').first().click();
  await expect(w.page.getByTestId('mcr-detail')).toBeVisible();
  await shot(w.page, '02-master-change-requests');
  const du = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/master-data/duplicates?type=PARTNER');
  await expect(du.page.getByTestId('mdu-row')).toHaveCount(1);
  await shot(du.page, '03-duplicate-candidates');
  await du.page.getByTestId('mdu-compare').click();
  await expect(du.page.getByTestId('mdu-field').first()).toBeVisible();
  await shot(du.page, '04-duplicate-compare-merge', false);
  const q = await open(browser, info, g.c, 'SYSADM', g.u.sys, '/admin/master-data/quality');
  await expect(q.page.getByTestId('mdq-steward')).toHaveCount(1);
  await shot(q.page, '05-data-quality-rules-and-stewards');
  const l = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/master-data/records');
  await expect(l.page.getByTestId('mdr-row')).toHaveCount(4);
  await shot(l.page, '06-master-records');
  const one = await open(browser, info, g.c, 'ACCMGR', g.u.acc, `/admin/master-data/records?id=${a}`);
  await expect(one.page.getByTestId('mdd-version')).toHaveCount(3);
  await shot(one.page, '07-master-record-history');
  await l.page.getByTestId('mdm-new').click();
  const form = l.page.getByTestId('mdm-form');
  await form.getByTestId('mdf-name').fill('Patel Steel Trader');
  await form.getByTestId('mdf-kind').selectOption('VENDOR');
  await form.getByTestId('mdf-mobile').fill('98111 11111');
  await form.getByTestId('mdf-mobile').blur();
  await expect(form.getByTestId('mdm-similar')).toBeVisible();
  await shot(l.page, '08-new-partner-duplicate-warning', false);
});
