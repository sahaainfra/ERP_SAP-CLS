import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 24.01 in the browser (ff.pay.p2401 ON in test), desktop and 360 px phone:
//  AC-01 the pay components with a formula tested, a salary structure previewed for a CTC, an employee's pay assignment made by payroll and approved by the HR
//  manager and the CFO; AC-07 no overflow at 360 px. Screenshots (docs/erp/screenshots/24.01).
const SHOTS = 'docs/erp/screenshots/24.01';
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
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `e2e${(seq += 1)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const low = code.toLowerCase(); const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF'); let emp;
  try {
    for (const [u, r] of [[`${low}-pay`, 'PAY'], [`${low}-hr`, 'HRMGR'], [`${low}-cfo`, 'CFO']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    emp = fill(db, 'hr_employees', { company_id: company, emp_code: `${code}01`, first_name: 'Ravi', full_name: 'Ravi Kumar', gender: 'MALE', dob: '1990-01-01', mobile: '9000000001', employment_type: 'PERMANENT', doj: '2025-06-01', record_status: 'APPROVED', employment_status: 'ACTIVE', grade: 'M2' });
    fill(db, 'hr_employee_statutory', { company_id: company, employee_id: emp, pf_applicable: 1, esi_applicable: 0, pt_state: 'TS' });
  } finally { db.close(); }
  const comps = await request.get('/api/v1/pay/components', { headers: H('PAY', company, `${low}-pay`) }); expect(comps.status()).toBe(200);
  const s = await post('/pay/structures', 'PAY', company, { code: 'STAFF', name: 'Staff', grade: 'M2', components: ['BASIC', 'HRA', 'CONVEYANCE', 'SPECIAL', 'PF_EE', 'PT', 'PF_ER', 'EPS_ER', 'EDLI_ER', 'PF_ADMIN', 'GRATUITY'].map((c) => ({ code: c, ...(c === 'CONVEYANCE' ? { value: 1600 } : {}) })) }, `${low}-pay`);
  return { company, emp, structure: s.id, pay: `${low}-pay`, hr: `${low}-hr`, cfo: `${low}-cfo` };
}

test('AC-01 components, a structure previewed and an employee pay assignment approved, on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'PSM' : 'PSD');
  const pay = await as(browser, info, { user: w.pay, roles: 'PAY', company: w.company });
  await pay.page.goto('/payroll/components'); await expect(pay.page.getByTestId('ps-list-EARNING')).toContainText('BASIC');
  await pay.page.getByTestId('ps-comp-new').click(); await pay.page.getByTestId('ps-comp-code').fill('SITE_HRA'); await pay.page.getByTestId('ps-comp-name').fill('Site HRA'); await pay.page.getByTestId('ps-comp-method').selectOption('FORMULA');
  await pay.page.getByTestId('ps-comp-formula').fill('round(min(BASIC, PF_CEILING) * 10 / 100, 0)'); await pay.page.getByTestId('ps-formula-test-btn').click(); await expect(pay.page.getByTestId('ps-formula-test')).toContainText('1,500');
  if (phone) await noOverflow(pay.page);
  await shot(pay.page, info, 'pay-components');
  await pay.page.getByTestId('ps-tab-structures').click(); await pay.page.getByTestId('ps-struct-STAFF').click(); await pay.page.getByTestId('ps-preview-ctc').fill('900000'); await pay.page.getByTestId('ps-preview-btn').click();
  await expect(pay.page.getByTestId('ps-breakup-ctc')).toContainText('75,000');
  await pay.page.goto('/payroll/assignments'); await pay.page.getByTestId('ps-asg-new-btn').click(); await pay.page.getByTestId('ps-asg-emp').selectOption(String(w.emp)); await pay.page.getByTestId('ps-asg-struct').selectOption(String(w.structure));
  await pay.page.getByTestId('ps-asg-ctc-in').fill('600000'); await pay.page.getByTestId('ps-asg-from').fill('2026-04-01'); await pay.page.getByTestId('ps-asg-reason').fill('Joining structure'); await pay.page.getByTestId('ps-asg-preview-btn').click();
  await expect(pay.page.getByTestId('ps-asg-preview-ctc')).toContainText('50,000'); await pay.page.getByTestId('ps-asg-save').click();
  await expect(pay.page.getByTestId('ps-assignment')).toHaveAttribute('data-status', 'DRAFT'); await pay.page.getByTestId('ps-asg-submit').click(); await expect(pay.page.getByTestId('ps-assignment')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(pay.page.url()).searchParams.get('id');
  for (const [u, r] of [[w.hr, 'HRMGR'], [w.cfo, 'CFO']]) { const s = await as(browser, info, { user: u, roles: r, company: w.company }); await s.page.goto(`/payroll/assignments?id=${id}`); await s.page.getByTestId('ps-decide-approve').click(); await expect(s.page.getByTestId('ps-decide')).toHaveCount(0); await s.context.close(); }
  await pay.page.goto('/payroll/assignments'); await expect(pay.page.getByTestId('ps-asg-list')).toContainText('Approved');
  if (phone) await noOverflow(pay.page);
  await shot(pay.page, info, 'employee-pay-assignments-revisions');
  await pay.context.close();
});
