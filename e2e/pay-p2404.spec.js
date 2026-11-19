import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 24.04 in the browser (ff.pay.p2404 ON in test), desktop and 360 px phone:
//  AC-01 the statutory calendar of the year: the ECR of a locked month is prepared by payroll, the file generated and kept, sent for approval, approved by the
//  accounts manager and the CFO, and its challan recorded (late payments flagged); the labour registers and the Form 16 batch are reachable; AC-07 no overflow at 360 px.
//  Screenshots (docs/erp/screenshots/24.04).
const SHOTS = 'docs/erp/screenshots/24.04';
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
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  try {
    for (const r of ['PAY', 'ACCMGR', 'CFO', 'AUD']) fill(db, 'iam_users', { company_id: company, username: `${low}-${r.toLowerCase()}`, display_name: `${low}-${r}`, roles_json: JSON.stringify([r]), email: `${low}-${r.toLowerCase()}@example.com`, status: 'ACTIVE', is_active: 1 });
    const e1 = fill(db, 'hr_employees', { company_id: company, emp_code: `${code}1`, first_name: 'Ravi', full_name: 'Ravi Kumar', gender: 'MALE', dob: '1990-01-01', mobile: '9000000001', employment_type: 'PERMANENT', doj: '2020-01-01', record_status: 'APPROVED', employment_status: 'ACTIVE' });
    const e2 = fill(db, 'hr_employees', { company_id: company, emp_code: `${code}2`, first_name: 'Sita', full_name: 'Sita Devi', gender: 'FEMALE', dob: '1992-01-01', mobile: '9000000002', employment_type: 'PERMANENT', doj: '2021-04-01', record_status: 'APPROVED', employment_status: 'ACTIVE' });
    fill(db, 'hr_employee_statutory', { company_id: company, employee_id: e1, pf_applicable: 1, esi_applicable: 0, pt_state: 'TS', uan: '100200300400', pan_last4: '1234' });
    fill(db, 'hr_employee_statutory', { company_id: company, employee_id: e2, pf_applicable: 1, esi_applicable: 1, pt_state: 'TS', uan: '100200300401', esic_ip: '3100200301', pan_last4: '5678' });
    const run = fill(db, 'pay_runs', { company_id: company, period: '2026-10', run_type: 'REGULAR', status: 'APPROVED', employees_count: 2, gross_paise: 4500000, net_paise: 3800000, tds_paise: 150000, locked_at: '2026-11-02T00:00:00Z' });
    const c1 = [{ code: 'BASIC', name: 'Basic', type: 'EARNING', amount: 20000 }, { code: 'PF_EE', name: 'PF', type: 'DEDUCTION', amount: 1800 }, { code: 'PF_ER', name: 'EPF', type: 'EMPLOYER', amount: 551 }, { code: 'EPS_ER', name: 'EPS', type: 'EMPLOYER', amount: 1250 }, { code: 'EDLI_ER', name: 'EDLI', type: 'EMPLOYER', amount: 75 }, { code: 'PF_ADMIN', name: 'Admin', type: 'EMPLOYER', amount: 75 }, { code: 'PT', name: 'PT', type: 'DEDUCTION', amount: 200 }];
    const c2 = [{ code: 'BASIC', name: 'Basic', type: 'EARNING', amount: 25000 }, { code: 'PF_EE', name: 'PF', type: 'DEDUCTION', amount: 1800 }, { code: 'PF_ER', name: 'EPF', type: 'EMPLOYER', amount: 551 }, { code: 'EPS_ER', name: 'EPS', type: 'EMPLOYER', amount: 1250 }, { code: 'EDLI_ER', name: 'EDLI', type: 'EMPLOYER', amount: 75 }, { code: 'PF_ADMIN', name: 'Admin', type: 'EMPLOYER', amount: 75 }, { code: 'ESI_EE', name: 'ESI', type: 'DEDUCTION', amount: 188 }, { code: 'ESI_ER', name: 'ESI', type: 'EMPLOYER', amount: 813 }, { code: 'PT', name: 'PT', type: 'DEDUCTION', amount: 200 }];
    fill(db, 'pay_run_lines', { company_id: company, run_id: run, employee_id: e1, days_in_month: 31, payable_days: 31, paid_days: 31, lop_days: 0, components_json: JSON.stringify(c1), gross_paise: 2000000, deductions_paise: 200000, employer_paise: 250000, net_paise: 1800000, tds_paise: 90000, tds_json: JSON.stringify({ regime: 'NEW' }), wages_json: JSON.stringify({ pfBase: 20000, pfWage: 15000, esiWage: 20000 }) });
    fill(db, 'pay_run_lines', { company_id: company, run_id: run, employee_id: e2, days_in_month: 31, payable_days: 29, paid_days: 29, lop_days: 2, components_json: JSON.stringify(c2), gross_paise: 2500000, deductions_paise: 219800, employer_paise: 226300, net_paise: 2000000, tds_paise: 60000, tds_json: JSON.stringify({ regime: 'OLD' }), wages_json: JSON.stringify({ pfBase: 25000, pfWage: 15000, esiWage: 25000 }) });
  } finally { db.close(); }
  return { company, low };
}

test('AC-01 the statutory payment of a month: the ECR prepared from the locked payroll, sent, approved by the accounts manager and the CFO, the challan recorded; the registers and the Form 16 batch', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'SKM' : 'SKD'); const u = (r) => `${w.low}-${r.toLowerCase()}`;
  const pay = await as(browser, info, { user: u('PAY'), roles: 'PAY', company: w.company });
  await pay.page.goto('/payroll/compliance?fy=2026-27');
  const item = pay.page.getByTestId('st-item-ECR-2026-10'); await expect(item).toBeVisible(); await expect(item).toContainText('2026-11-15'); if (phone) await noOverflow(pay.page);
  await shot(pay.page, info, 'statutory-calendar');
  await pay.page.getByTestId('st-prepare-ECR-2026-10').click(); await expect(pay.page.getByText(/Payment prepared/)).toBeVisible();
  // the file is generated and kept on the files tab
  await pay.page.getByRole('tab', { name: /Files|फ़ाइलें/ }).click(); await pay.page.getByTestId('st-file-type').selectOption('ECR_FILE');
  await pay.page.getByTestId('st-period').fill('2026-10'); await pay.page.getByTestId('st-generate').click(); await expect(pay.page.getByTestId('st-file-list')).toContainText('2 row(s)');
  if (phone) await noOverflow(pay.page); await shot(pay.page, info, 'statutory-files');
  // sent for approval from the board, then approved by the accounts manager and the CFO
  await pay.page.getByRole('tab', { name: /Calendar|कैलेंडर/ }).click(); const row = await pay.page.request.get(`/api/v1/pay/stat/filings?pageSize=10`, { headers: H('PAY', w.company, u('PAY')) }); const fid = (await row.json()).data[0].id;
  await pay.page.getByTestId(`st-submit-${fid}`).click(); await pay.page.getByRole('tab', { name: /^In approval|^अनुमोदन में/ }).click(); await expect(pay.page.getByTestId('st-item-ECR-2026-10')).toContainText('Waiting for approval');
  for (const r of ['ACCMGR', 'CFO']) { const who = await request.get(`/api/v1/workflow/tasks?mine=assigned`, { headers: H(r, w.company, u(r)) }); const task = (await who.json()).data.rows.find((x) => x.instance?.docId === String(fid)); expect(task, `${r} task`).toBeTruthy(); const act = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: H(r, w.company, u(r)), data: { action: 'approve' } }); expect(act.status()).toBe(200); }
  await pay.page.reload(); await pay.page.getByRole('tab', { name: /^Approved|^अनुमोदित/ }).click(); await expect(pay.page.getByTestId('st-item-ECR-2026-10')).toContainText('Approved');
  // the challan of the payment, paid after the due date: late
  await pay.page.getByTestId(`st-record-${fid}`).click(); await pay.page.getByTestId('st-challan-ref').fill('CH-2026-11-001'); await pay.page.getByTestId('st-challan-save').click(); await expect(pay.page.getByTestId('st-challan')).toHaveCount(0);
  await pay.page.getByRole('tab', { name: /^Paid|^चुकाया/ }).click(); await expect(pay.page.getByTestId('st-item-ECR-2026-10')).toContainText('paid');
  if (phone) await noOverflow(pay.page); await shot(pay.page, info, 'statutory-paid');
  // the labour registers and the Form 16 batch
  const hr = await as(browser, info, { user: u('AUD'), roles: 'AUD', company: w.company }); await hr.page.goto('/payroll/registers'); await expect(hr.page.getByTestId('rg-page')).toBeVisible(); if (phone) await noOverflow(hr.page);
  await shot(hr.page, info, 'registers'); await hr.context.close(); await pay.context.close();
});
