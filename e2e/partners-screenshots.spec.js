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



// Screenshots of the 06.04 pages for docs/erp/screenshots/partners. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/partners';
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked the documents and the portal' });
};
const gst = (pan, state = '27') => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
async function setup(request, code) {
  const c = await company(request, code);
  const t = code.toLowerCase();
  const u = { proc: `${t}-proc`, proc2: `${t}-proc2`, acc: `${t}-acc`, acc2: `${t}-acc2`, cfo: `${t}-cfo`, dir: `${t}-dir`, se: `${t}-se` };
  people(c, [[u.proc, ['PROCMGR'], 'Pramod Purchase'], [u.proc2, ['PROCMGR'], 'Priya Purchase'], [u.acc, ['ACCMGR'], 'Anita Accounts'], [u.acc2, ['ACCMGR'], 'Arjun Accounts'], [u.cfo, ['CFO'], 'Chitra CFO'], [u.dir, ['DIR'], 'Dina Director'], [u.se, ['SE'], 'Seema Engineer']]);
  const vendor = (over = {}) => ({ legalName: 'Shree Ganesh Steel Traders Private Limited', tradeName: 'Ganesh Steel', constitution: 'PRIVATE_LIMITED', pan: 'AABCS1234C', roles: ['VENDOR'], categories: ['STEEL'], regions: ['MH'], gstins: [{ stateCode: 'MH', gstin: gst('AABCS1234C') }], addresses: [{ addressType: 'REGISTERED', address: 'Plot 12, MIDC Bhosari', city: 'Pune', stateCode: 'MH', pin: '411026' }], contacts: [{ name: 'Suresh Patil', designation: 'Accounts', email: 'accounts@ganeshsteel.example', mobile: '9876500011', isPrimary: true }], bank: { accountNo: '123456789012', ifsc: 'SBIN0001234', accountName: 'Shree Ganesh Steel Traders Pvt Ltd' }, tds: [{ section: '194Q' }], ...over });
  const active = async (body) => {
    const r = await api(request, c, 'PROCMGR', u.proc, 'post', '/mdm/partners', { ...body, submit: true });
    await act(request, c, 'PROCMGR', u.proc2, r.workflow.id);
    await act(request, c, 'ACCMGR', u.acc, r.workflow.id);
    return r;
  };
  return { c, u, vendor, active };
}

test('screenshots of the business partner pages', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  void watch; void noOverflow;
  const g = await setup(request, phone ? 'PRSM' : 'PRSD');
  const a = await g.active(g.vendor({ msmeNo: 'UDYAM-MH-26-0012345', msmeCategory: 'SMALL', cin: 'U27100MH2010PTC123456' }));
  await g.active(g.vendor({ legalName: 'Kaveri Transport Company', constitution: 'PARTNERSHIP', pan: 'AAFFK4321K', roles: ['TRANSPORTER'], gstins: [{ stateCode: 'KA', gstin: gst('AAFFK4321K', '29') }], addresses: [{ addressType: 'REGISTERED', address: 'Peenya Industrial Area', city: 'Bengaluru', stateCode: 'KA', pin: '560058' }], contacts: [{ name: 'Kiran Rao', mobile: '9845000011' }], bank: null, tds: [{ section: '194C' }] }));
  await api(request, g.c, 'PROCMGR', g.u.proc, 'post', '/mdm/partners', g.vendor({ legalName: 'Narmada Labour Contractors', constitution: 'PROPRIETORSHIP', pan: 'AAAPN5555N', roles: ['VENDOR'], gstins: [], contacts: [{ name: 'Narmada', mobile: '9822211100' }], bank: null, tds: [] }));
  await api(request, g.c, 'PROCMGR', g.u.proc, 'post', `/mdm/partners/${a.id}/documents`, { docType: 'INSURANCE', docNo: 'POL-778899', validFrom: day(-360), validUntil: day(10) });
  await api(request, g.c, 'PROCMGR', g.u.proc, 'post', `/mdm/partners/${a.id}/documents`, { docType: 'GST_CERTIFICATE', docNo: 'REG-06', validFrom: day(-900) });
  await api(request, g.c, 'PROCMGR', g.u.proc, 'post', `/mdm/partners/${a.id}/banks`, { accountNo: '9988776655', ifsc: 'ICIC0000104', accountName: 'Shree Ganesh Steel Traders Pvt Ltd', reason: 'The partner moved its account to ICICI Bank' });
  const shot = async (page, name, full = true) => { await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: full }); };
  const l = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/partners');
  await expect(l.page.getByText('Kaveri Transport Company').first()).toBeVisible();
  await shot(l.page, '01-business-partners');
  const p = await open(browser, info, g.c, 'ACCMGR', g.u.acc, `/admin/partners/partner?id=${a.id}&tab=banks`);
  await expect(p.page.getByTestId('pp-bank').first()).toBeVisible();
  await shot(p.page, '02-partner-360-banks');
  await p.page.getByTestId('pp-tab-documents').click();
  await expect(p.page.getByTestId('pp-doc').first()).toBeVisible();
  await shot(p.page, '03-partner-360-documents');
  const w = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/partners/new');
  await w.page.getByTestId('pr-legal').fill('Shree Ganesh Steel');
  await w.page.getByTestId('pr-constitution').selectOption('PRIVATE_LIMITED');
  await w.page.getByTestId('pr-pan').fill('AABCS1234C');
  await w.page.getByTestId('pr-role-VENDOR').check();
  await expect(w.page.getByTestId('pr-duplicates')).toBeVisible();
  await shot(w.page, '04-partner-registration-duplicate');
  const q = await open(browser, info, g.c, 'ACCMGR', g.u.acc, '/admin/partners/approvals');
  await expect(q.page.getByTestId('pa-row').first()).toBeVisible();
  await shot(q.page, '05-partner-approvals-and-bank-changes');
});
