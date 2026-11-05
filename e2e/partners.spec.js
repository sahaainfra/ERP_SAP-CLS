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



// Part 06.04: the business partner master. The procurement manager registers a vendor with the wizard (the duplicate of a PAN shown as it is typed) and sends it; another procurement manager and the
// accounts manager approve it. On Partner 360 a bank change holds payments, is confirmed by a call-back and approved by the accounts manager and the CFO; a site engineer sees the account masked. A blacklisting
// asked for on the page is approved by the director; the worklist shows what waits, on a computer and a phone.
const act = async (request, c, roles, user, instanceId, action = 'approve') => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked the documents and the portal' });
};
const gst = (pan, state = '27') => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };
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

test('FR-01 FR-07 AC-01 the registration wizard: duplicate shown while typing, sent for approval, approved by the steward and the accounts manager', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'PRWM' : 'PRWD');
  await g.active(g.vendor());
  const p = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/partners/new');
  const errors = watch(p.page);
  await p.page.getByTestId('pr-legal').fill('Kaveri Cement Distributors');
  await p.page.getByTestId('pr-constitution').selectOption('PARTNERSHIP');
  await p.page.getByTestId('pr-pan').fill('AABCS1234C');
  await expect(p.page.getByTestId('pr-duplicates')).toContainText('same PAN');
  await p.page.getByTestId('pr-pan').fill('AAFFK4321K');
  await p.page.getByTestId('pr-role-VENDOR').check();
  await expect(p.page.getByTestId('pr-duplicates')).toHaveCount(0);
  if (phone) await noOverflow(p.page);
  await p.page.getByTestId('pr-next').click();
  await p.page.getByTestId('pr-add-gstin').click();
  await p.page.getByTestId('pr-gst-state').selectOption('KA');
  await p.page.getByTestId('pr-gstin').fill(gst('AAFFK4321K', '29'));
  await p.page.getByTestId('pr-addr').fill('No. 14, Peenya Industrial Area');
  await p.page.getByTestId('pr-addr-state').selectOption('KA');
  await p.page.getByTestId('pr-next').click();
  await p.page.getByTestId('pr-contact-name').fill('Kiran Rao');
  await p.page.getByTestId('pr-contact-mobile').fill('9845000011');
  await p.page.getByTestId('pr-next').click();
  await p.page.getByTestId('pr-acct').fill('50100012345678');
  await p.page.getByTestId('pr-ifsc').fill('HDFC0000240');
  await p.page.getByTestId('pr-acct-name').fill('Kaveri Cement Distributors');
  await p.page.getByTestId('pr-next').click();
  await expect(p.page.getByTestId('pr-review')).toContainText('ending 5678');
  await p.page.getByTestId('pr-send').click();
  await expect(p.page.getByTestId('pp-sent')).toBeVisible();
  await expect(p.page.getByRole('heading', { level: 1 })).toContainText('BP-00002');
  const id = Number(new URL(p.page.url()).searchParams.get('id'));
  const it = await api(request, g.c, 'PROCMGR', g.u.proc, 'get', `/mdm/partners/${id}`);
  await act(request, g.c, 'PROCMGR', g.u.proc2, it.instanceId);
  await act(request, g.c, 'ACCMGR', g.u.acc, it.instanceId);
  await p.page.reload();
  await expect(p.page.getByTestId('partner-page')).toContainText('Active');
  if (phone) await noOverflow(p.page);
  expect(errors).toEqual([]);
});

test('FR-02 BR-01 BR-03 FR-06 a bank change on Partner 360 holds payments and is confirmed by a call-back; masked for a site engineer; a blacklisting approved by the director; the worklist', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const g = await setup(request, phone ? 'PRBM' : 'PRBD');
  const r = await g.active(g.vendor());
  const p = await open(browser, info, g.c, 'PROCMGR', g.u.proc, `/admin/partners/partner?id=${r.id}&tab=banks`);
  const errors = watch(p.page);
  await p.page.getByTestId('pp-bank-change').click();
  await p.page.getByTestId('pp-new-acct').fill('9988776655');
  await p.page.getByTestId('pp-new-ifsc').fill('ICIC0000104');
  await p.page.getByTestId('pp-new-why').fill('The partner moved its account to ICICI Bank');
  await p.page.getByTestId('pp-new-go').click();
  await expect(p.page.getByTestId('pp-bank-note')).toContainText('Payments are on hold');
  await expect(p.page.getByTestId('pp-payment')).toContainText('On hold');
  await p.page.getByTestId('pp-confirm').locator('summary').click();
  await p.page.getByLabel('Spoke to').fill('Suresh Patil');
  await p.page.getByLabel('Registered number called').fill('9876500011');
  await p.page.getByLabel('What was confirmed').fill('Confirmed the new ICICI account on a recorded call');
  await p.page.getByTestId('pp-confirm-go').click();
  await expect(p.page.getByTestId('pp-bank-note')).toContainText('Confirmed');
  if (phone) await noOverflow(p.page);
  const w = await open(browser, info, g.c, 'ACCMGR', g.u.acc, '/admin/partners/approvals');
  await expect(w.page.getByTestId('pa-row').first()).toContainText('Bank change');
  await expect(w.page.getByTestId('pa-decide').first()).toBeVisible();
  if (phone) await noOverflow(w.page);
  const bank = (await api(request, g.c, 'ACCMGR', g.u.acc, 'get', `/mdm/partners/${r.id}`)).banks.find((b) => b.last4 === '6655');
  await act(request, g.c, 'ACCMGR', g.u.acc, bank.instanceId);
  await act(request, g.c, 'CFO', g.u.cfo, bank.instanceId);
  const s = await open(browser, info, g.c, 'SE', g.u.se, `/admin/partners/partner?id=${r.id}&tab=banks`);
  await expect(s.page.getByTestId('pp-bank').first()).toContainText('••••••6655');
  await expect(s.page.getByTestId('pp-bank-show')).toHaveCount(0);
  await expect(s.page.getByTestId('pp-pan')).toContainText('••••••234C');
  await p.page.reload();
  await p.page.getByTestId('pp-blacklist').click();
  await p.page.getByTestId('pp-reason').fill('Supplied substandard steel twice; test reports attached');
  await p.page.getByTestId('pp-action-go').click();
  await expect(p.page.getByTestId('pp-note')).toContainText('director');
  const req = (await api(request, g.c, 'PROCMGR', g.u.proc, 'get', `/mdm/partners/${r.id}`)).statusRequests[0];
  await act(request, g.c, 'DIR', g.u.dir, req.instanceId);
  await p.page.reload();
  await expect(p.page.getByTestId('partner-page')).toContainText('Blacklisted');
  const l = await open(browser, info, g.c, 'PROCMGR', g.u.proc, '/admin/partners');
  await expect(l.page.getByText('Shree Ganesh Steel Traders Private Limited').first()).toBeVisible();
  if (phone) await noOverflow(l.page);
  expect(errors).toEqual([]);
});
