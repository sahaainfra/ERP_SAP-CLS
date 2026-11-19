import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 24.02 in the browser (ff.pay.p2402 ON in test), desktop and 360 px phone:
//  AC-01 the payroll of a month from locked attendance: the inputs check, the run computed, an employee's salary held with the reason, sent by payroll, approved
//  by the HR manager and the CFO, locked; the payroll register and the variance; an employee's tax declaration on the phone; AC-07 no overflow at 360 px.
//  Screenshots (docs/erp/screenshots/24.02).
const SHOTS = 'docs/erp/screenshots/24.02';
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
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id; const low = code.toLowerCase();
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF'); const emps = [];
  try {
    for (const [u, r] of [[`${low}-pay`, 'PAY'], [`${low}-hr`, 'HRMGR'], [`${low}-cfo`, 'CFO'], [`${low}-emp`, 'EMP']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE', is_active: 1 });
    const empUser = db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(company, `${low}-emp`).id;
    for (const [k, name] of [[1, 'Ravi Kumar'], [2, 'Sita Devi']]) { const id = fill(db, 'hr_employees', { company_id: company, emp_code: `${code}0${k}`, first_name: name.split(' ')[0], full_name: name, gender: k === 2 ? 'FEMALE' : 'MALE', dob: '1990-01-01', mobile: `900000000${k}`, employment_type: 'PERMANENT', doj: '2025-06-01', record_status: 'APPROVED', employment_status: 'ACTIVE', salary_payment_mode: 'BANK_TRANSFER', user_id: k === 1 ? empUser : null });
      fill(db, 'hr_employee_statutory', { company_id: company, employee_id: id, pf_applicable: 1, esi_applicable: 0, pt_state: 'TS' }); fill(db, 'hr_employee_banks', { company_id: company, employee_id: id, account_last4: '123' + k, ifsc: 'HDFC0000001', bank_status: 'ACTIVE', verified_status: 'VERIFIED', is_primary: 1 });
      for (let d = 1; d <= 31; d += 1) fill(db, 'att_daily', { company_id: company, person_type: 'EMPLOYEE', person_id: id, work_date: `2026-10-${String(d).padStart(2, '0')}`, status: k === 2 && d < 3 ? 'ABSENT' : 'PRESENT', paid_day: k === 2 && d < 3 ? 0 : 1, lop_day: k === 2 && d < 3 ? 1 : 0, locked: 1, computed_at: '2026-11-01T00:00:00Z', source: 'SYSTEM' }); emps.push(id); }
  } finally { db.close(); }
  const pay = `${low}-pay`; await request.get('/api/v1/pay/components', { headers: H('PAY', company, pay) });
  const s = await post('/pay/structures', 'PAY', company, { code: 'STAFF', name: 'Staff', components: ['BASIC', 'HRA', 'CONVEYANCE', 'SPECIAL', 'PF_EE', 'PT', 'TDS', 'PF_ER', 'EPS_ER', 'EDLI_ER', 'PF_ADMIN', 'GRATUITY'].map((c) => ({ code: c, ...(c === 'CONVEYANCE' ? { value: 1600 } : {}) })) }, pay);
  await post('/pay/calendar/generate', 'PAY', company, { fyStart: '2026-04-01' }, pay);
  const act = async (roles, user, instanceDoc) => { const t = await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H(roles, company, user) }); const task = (await t.json()).data.rows.find((x) => x.instance?.docId === String(instanceDoc)); expect(task, `${user} task`).toBeTruthy(); await post(`/workflow/tasks/${task.id}/act`, roles, company, { action: 'approve' }, user); };
  for (const [i, e] of emps.entries()) { const a = await post('/pay/assignments', 'PAY', company, { employeeId: e, structureId: s.id, ctcAnnual: i ? 480000 : 600000, effectiveFrom: '2026-04-01', reason: 'Joining structure' }, pay); await post(`/pay/assignments/${a.id}/submit`, 'PAY', company, {}, pay); await act('HRMGR', `${low}-hr`, a.id); await act('CFO', `${low}-cfo`, a.id); }
  return { company, emps, pay, hr: `${low}-hr`, cfo: `${low}-cfo`, emp: `${low}-emp` };
}

test('AC-01 the payroll of a month computed from locked attendance, a salary held, approved and locked; the register; a declaration, on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'PRM' : 'PRD');
  const pay = await as(browser, info, { user: w.pay, roles: 'PAY', company: w.company });
  await pay.page.goto('/payroll/runs'); await pay.page.getByTestId('pr-period').fill('2026-10'); await expect(pay.page.getByTestId('pr-att-locked')).toContainText('2 / 2');
  await pay.page.getByTestId('pr-create').click(); await expect(pay.page.getByTestId('pr-run')).toHaveAttribute('data-status', 'DRAFT'); await expect(pay.page.getByTestId('pr-lines').locator('li')).toHaveCount(2);
  pay.page.once('dialog', (d) => d.accept('Bank account under change'));
  await pay.page.getByTestId(`pr-hold-${w.emps[1]}`).click(); await expect(pay.page.getByTestId(`pr-line-${w.emps[1]}`)).toHaveAttribute('data-hold', '1');
  if (phone) await noOverflow(pay.page);
  await shot(pay.page, info, 'payroll-run-wizard');
  await pay.page.getByTestId('pr-submit').click(); await expect(pay.page.getByTestId('pr-run')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(pay.page.url()).searchParams.get('id');
  for (const [u, r] of [[w.hr, 'HRMGR'], [w.cfo, 'CFO']]) { const s = await as(browser, info, { user: u, roles: r, company: w.company }); await s.page.goto(`/payroll/runs?id=${id}`); await s.page.getByTestId('pr-decide-approve').click(); await expect(s.page.getByTestId('pr-decide')).toHaveCount(0); await s.context.close(); }
  await pay.page.goto(`/payroll/register?run=${id}`); await expect(pay.page.getByTestId('rg-lines')).toContainText('Ravi Kumar'); await expect(pay.page.getByTestId('rg-lines')).toContainText('held');
  if (phone) await noOverflow(pay.page);
  await shot(pay.page, info, 'payroll-register');
  await pay.page.getByTestId('rg-tab-variance').click(); await expect(pay.page.getByTestId('rg-variance')).toContainText('2 new');
  const emp = await as(browser, info, { user: w.emp, roles: 'EMP', company: w.company }); await emp.page.goto('/payroll/declarations'); await emp.page.getByTestId('dc-regime-OLD').click(); await emp.page.getByTestId('dc-sec80C').fill('120000'); await emp.page.getByTestId('dc-submit').click();
  await expect(emp.page.getByTestId('dc-mine')).toContainText('With payroll'); if (phone) await noOverflow(emp.page);
  await pay.context.close(); await emp.context.close();
});
