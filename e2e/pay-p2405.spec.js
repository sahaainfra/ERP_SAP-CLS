import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createVault } from '../src/server/platform/integrations/vault.js';

// Development-header mode. Part 24.05 in the browser (ff.pay.p2405 ON in test), desktop and 360 px phone:
//  AC-01 the approved payroll is posted to the ledger, paid through a bank transfer prepared by payroll and released by the accounts manager, confirmed with the
//  UTR; the payslips generated (password-protected) and seen by the employee in self-service; the full-and-final of a cleared leaver prepared, sent for
//  approval and approved by the HR manager and the CFO. AC-07 no overflow at 360 px. Screenshots (docs/erp/screenshots/24.05).
const SHOTS = 'docs/erp/screenshots/24.05';
const shot = (page, info, name) => page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png`, fullPage: false });
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const as = async (browser, info, { user, roles, company }) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch, reducedMotion: 'reduce' });
  await context.addInitScript(([v]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })); }, [{ user, roles, company: String(company) }]);
  return { context, page: await context.newPage() };
};
let seq = 0;
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql;
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  const names = []; const params = [];
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `X${(seq += 1)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id; const low = code.toLowerCase();
  await post('/core/financial-years', 'SYSADM', company, { startDate: '2026-04-01' }); // the books are open for the run's date and today
  expect((await request.get('/api/v1/fin/accounts', { headers: H('ACCMGR', company, 'e2e-setup') })).status()).toBe(200); // the company's chart from the template
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF'); const v = createVault();
  try {
    const users = {}; for (const r of ['PAY', 'ACCMGR', 'HRMGR', 'CFO', 'EMP']) users[r] = fill(db, 'iam_users', { company_id: company, username: `${low}-${r.toLowerCase()}`, display_name: `${low}-${r}`, roles_json: JSON.stringify([r]), email: `${low}-${r.toLowerCase()}@example.com`, status: 'ACTIVE', is_active: 1 });
    const project = fill(db, 'org_projects', { company_id: company, code: `${code}P`, name: 'Tower A', type: 'BUILDING', status: 'ACTIVE' }); const site = fill(db, 'org_sites', { company_id: company, org_project_id: project, code: `${code}S`, name: 'Site 1' });
    const dept = fill(db, 'org_departments', { company_id: company, code: `${code}D`, name: 'Projects' });
    const emp = (n, name, user) => { const id = fill(db, 'hr_employees', { company_id: company, emp_code: `${code}${n}`, first_name: name.split(' ')[0], full_name: name, gender: 'MALE', dob: '1990-08-15', mobile: `900000000${n}`, employment_type: 'PERMANENT', doj: '2019-06-10', record_status: 'APPROVED', employment_status: 'ACTIVE', salary_payment_mode: 'BANK_TRANSFER', department_id: dept, user_id: user ?? null, email: `${low}${n}@example.com` });
      fill(db, 'hr_employee_statutory', { company_id: company, employee_id: id, pf_applicable: 1, esi_applicable: 0, pt_state: 'TS', pan_last4: '1234' });
      fill(db, 'hr_employee_banks', { company_id: company, employee_id: id, account_enc: v.encrypt(`50100${id}123456`, `hr_employee_bank/${company}/${id}`), account_hash: `h${company}-${id}`, account_last4: '3456', ifsc: 'HDFC0000123', account_name: name.toUpperCase(), bank_status: 'ACTIVE', verified_status: 'VERIFIED', is_primary: 1 }); return id; };
    const e1 = emp(1, 'Ravi Kumar', users.EMP); const e2 = emp(2, 'Sita Devi', null);
    const comps = JSON.stringify([{ code: 'BASIC', name: 'Basic pay', type: 'EARNING', amount: 25000, full: 25000 }, { code: 'DA', name: 'Dearness allowance', type: 'EARNING', amount: 5000, full: 5000 }, { code: 'HRA', name: 'House rent allowance', type: 'EARNING', amount: 15000, full: 15000 }, { code: 'SPECIAL', name: 'Special allowance', type: 'EARNING', amount: 5000, full: 5000 }, { code: 'PF_EE', name: 'Provident fund (employee)', type: 'DEDUCTION', amount: 1800 }, { code: 'PT', name: 'Professional tax', type: 'DEDUCTION', amount: 200 }, { code: 'TDS', name: 'Income tax (TDS on salary)', type: 'DEDUCTION', amount: 1000 }, { code: 'PF_ER', name: 'Employer EPF', type: 'EMPLOYER', amount: 550 }, { code: 'EPS_ER', name: 'Employer EPS (pension)', type: 'EMPLOYER', amount: 1250 }, { code: 'GRATUITY', name: 'Gratuity provision', type: 'EMPLOYER', amount: 1443 }]);
    const run = fill(db, 'pay_runs', { company_id: company, doc_no: `PRUN/${code}/2026-10`, period: '2026-10', run_type: 'REGULAR', status: 'APPROVED', employees_count: 2, gross_paise: 10000000, net_paise: 9400000, tds_paise: 200000, locked_at: '2026-11-02T00:00:00Z' });
    for (const e of [e1, e2]) fill(db, 'pay_run_lines', { company_id: company, run_id: run, employee_id: e, days_in_month: 31, payable_days: 31, paid_days: 31, lop_days: 0, components_json: comps, gross_paise: 5000000, taxable_paise: 5000000, deductions_paise: 300000, employer_paise: 324300, net_paise: 4700000, tds_paise: 100000, tds_json: '{"regime":"NEW"}', wages_json: '{"codeWages":30000}', flags_json: '[]', allocation_json: JSON.stringify([{ projectId: project, siteId: site, share: 1 }]), payment_mode: 'BANK_TRANSFER', bank_ok: 1 });
    // the approval event of the run, as 24.02 publishes it at the lock
    const ev = { eventId: randomUUID(), type: 'pay.run.approved', version: 1, occurredAt: new Date().toISOString(), companyId: company, projectId: null, siteId: null, entity: 'pay_runs', entityId: String(run), actorId: 'cfo', data: { runId: run, docNo: `PRUN/${code}/2026-10`, period: '2026-10', type: 'REGULAR', employees: 2 } };
    db.prepare('INSERT INTO core_outbox (event_type, aggregate_id, payload) VALUES (?, ?, ?)').run('pay.run.approved', String(run), JSON.stringify(ev));
    const gl = db.prepare("SELECT id FROM fin_accounts WHERE company_id = ? AND code = '150002'").get(company).id;
    fill(db, 'fin_bank_accounts', { company_id: company, code: `${code}B`, name: 'HDFC current', bank_name: 'HDFC Bank', ifsc: 'HDFC0000001', account_no_enc: v.encrypt('99887766554433', `fin_bank_account/${company}/${code}B`), account_last4: '4433', gl_account_id: gl, file_format: 'GENERIC_CSV', acct_status: 'ACTIVE' });
    // a cleared leaver whose inputs HR released
    const inputs = { employeeId: e2, lastWorkingDay: '2026-10-31', noticeDays: 30, servedDays: 25, notice: { shortDays: 5, waiverDays: 0, recoveryDays: 5, payInLieuDays: 0 }, leaveEncashmentDays: 12, gratuity: { eligible: true }, reimbursements: { pendingClaims: 0, amount: 0 }, recoveries: { advances: 0, items: [], total: 0 }, canRelease: true, blockers: [] };
    fill(db, 'hr_separations', { company_id: company, doc_no: `SEP/${code}/1`, doc_date: '2026-10-01', employee_id: e2, sep_type: 'RESIGNATION', reason_code: 'BETTER_OPPORTUNITY', reason: 'Moving on', submitted_on: '2026-10-06', notice_days: 30, standard_lwd: '2026-11-05', last_working_day: '2026-10-31', status: 'SETTLED', fnf_json: JSON.stringify(inputs), fnf_released_at: '2026-11-03T10:00:00Z', fnf_released_by: 'hr' });
    return { company, low, run };
  } finally { db.close(); }
}

test('AC-01 the payroll posted, paid by bank file and its payslips distributed; the full-and-final of a cleared leaver approved', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'PSM' : 'PSD'); const u = (r) => `${w.low}-${r.toLowerCase()}`;
  const pay = await as(browser, info, { user: u('PAY'), roles: 'PAY', company: w.company });
  // 1. post
  await pay.page.goto(`/payroll/posting?run=${w.run}`); await expect(pay.page.getByTestId('pp-run')).toBeVisible();
  await pay.page.getByTestId('pp-step-post').click(); const postBtn = pay.page.getByTestId('pp-post-btn'); if (await postBtn.isVisible().catch(() => false)) await postBtn.click();
  await expect(pay.page.getByTestId('pp-balanced')).toHaveText('Yes'); await expect(pay.page.getByTestId('pp-next-pay')).toBeVisible();
  if (phone) await noOverflow(pay.page); await shot(pay.page, info, 'post-payroll-create-payment');
  // 2. pay: payroll prepares, the accounts manager releases and confirms
  await pay.page.getByTestId('pp-step-pay').click(); await pay.page.getByTestId('pp-prepare').click(); await expect(pay.page.getByText(/transfer is prepared/)).toBeVisible();
  if (phone) await noOverflow(pay.page); await shot(pay.page, info, 'post-payroll-transfer');
  const acc = await as(browser, info, { user: u('ACCMGR'), roles: 'ACCMGR', company: w.company }); await acc.page.goto(`/payroll/posting?run=${w.run}`); await acc.page.getByTestId('pp-step-pay').click();
  const tr = acc.page.locator('[data-testid^="pp-transfer-"]').first(); const tid = (await tr.getAttribute('data-testid')).split('-').pop();
  await acc.page.getByTestId(`pp-release-${tid}`).click(); await expect(acc.page.getByText(/bank file is ready/)).toBeVisible();
  await acc.page.getByTestId(`pp-open-${tid}`).click(); const utrs = acc.page.locator('[data-testid^="pp-utr-"]'); await expect(utrs.first()).toBeVisible();
  for (let i = 0; i < await utrs.count(); i += 1) await utrs.nth(i).fill(`HDFCN5202611190000${i + 1}`);
  await acc.page.getByTestId(`pp-confirm-${tid}`).click(); await expect(acc.page.getByText(/answer is recorded/)).toBeVisible(); await expect(acc.page.getByTestId('pp-paid')).toHaveText('2');
  if (phone) await noOverflow(acc.page); await acc.context.close();
  // 3. payslips
  await pay.page.reload(); await pay.page.getByTestId('pp-step-payslips').click(); await pay.page.getByTestId('pp-generate').click(); await expect(pay.page.getByTestId('pp-generated')).toHaveText('2 / 2', { timeout: 60_000 });
  await pay.page.getByTestId('pp-email').click(); await expect(pay.page.getByTestId('pp-emailed')).toHaveText('2');
  if (phone) await noOverflow(pay.page); await shot(pay.page, info, 'payslips-distribution');
  const me = await as(browser, info, { user: u('EMP'), roles: 'EMP', company: w.company }); await me.page.goto('/payroll/my-payslips'); await expect(me.page.getByTestId('my-slip-2026-10')).toBeVisible();
  if (phone) await noOverflow(me.page); await shot(me.page, info, 'my-payslips'); await me.context.close();
  // 4. the full-and-final
  await pay.page.goto('/payroll/fnf'); await pay.page.locator('[data-testid^="ff-start-"]').first().click(); await expect(pay.page.getByTestId('ff-object')).toBeVisible();
  await expect(pay.page.getByTestId('ff-c-GRATUITY')).toContainText('1,21,153.85'); await expect(pay.page.getByTestId('ff-due')).toHaveText('2026-11-03');
  await pay.page.getByTestId('ff-submit').click(); await expect(pay.page.getByTestId('ff-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const fid = new URL(pay.page.url()).searchParams.get('id');
  for (const r of ['HRMGR', 'CFO']) { const who = await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H(r, w.company, u(r)) }); const task = (await who.json()).data.rows.find((x) => x.instance?.docId === String(fid)); expect(task, `${r} task`).toBeTruthy(); const a = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: H(r, w.company, u(r)), data: { action: 'approve' } }); expect(a.status()).toBe(200); }
  await pay.page.reload(); await expect(pay.page.getByTestId('ff-object')).toHaveAttribute('data-status', 'APPROVED');
  if (phone) await noOverflow(pay.page); await shot(pay.page, info, 'full-final-settlement-with-components-an');
  await pay.page.getByTestId('ff-tab-payment').click(); await expect(pay.page.getByTestId('ff-pay')).toBeVisible(); if (phone) await noOverflow(pay.page);
  await pay.context.close();
});
