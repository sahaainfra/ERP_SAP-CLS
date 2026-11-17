import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 166.8 in the browser (ff.mdm.p16608 is ON in test):
//  T-01 on the Statutory Changes page, cement (HSN 2523) is 28 % on 21-09-2025 and 18 % on 22-09-2025;
//  T-02 a contractor's TDS is section 393(1) of the 2025 Act from 01-04-2026 with Form 131; the TDS master shows the 2025-Act row with its nature;
//  FR-03 the statutory calendar; FR-04 a draft vendor invoice at 28 % dated after the change is listed to review;
//  T-03 / S-04 the employee's Salary tab: basic 40 %, allowances 60 % → wages 50 %; S-05 the wage rates page names the Code on Wages.
const SHOTS = 'docs/erp/screenshots/166.8';
const shot = (page, info, name, fullPage = false) => page.screenshot({ path: `${SHOTS}/after-${name}-${info.project.name}.png`, fullPage });
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const open = async (page, { user, roles, company, path }) => {
  await page.addInitScript(([v]) => {
    if (sessionStorage.getItem('erp.test.identity-set')) return;
    localStorage.setItem('erp.dev.identity', JSON.stringify(v));
    localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' }));
    sessionStorage.setItem('erp.test.identity-set', '1');
  }, [{ user, roles, company: String(company) }]);
  await page.goto(path);
};
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
let seq = 0;
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql;
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  const names = []; const params = [];
  for (const c of cols) {
    if (c.name === 'id') continue;
    if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `e2e${(seq += 1)}`)); }
  }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}

async function world(request, code) {
  const post = async (path, roles, company, data) => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, 'e2e-setup'), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Statutory Bridge', type: 'BRIDGE' })).id;
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  try {
    const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Ultra Cement Ltd', 'Ultra', 'PUBLIC_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}V`).lastInsertRowid);
    const vi = fill(db, 'bill_vendor_invoices', { company_id: company, org_project_id: project, vendor_id: vendor, doc_no: `VI/${code}/7`, invoice_no: 'UC/207', invoice_date: '2025-09-25', status: 'DRAFT', total_paise: 51_200 });
    fill(db, 'bill_vendor_invoice_lines', { company_id: company, invoice_id: vi, line_no: 1, hsn: '2523', qty_th: 1000, rate_paise: 40_000, gst_pct_bp: 2800, taxable_paise: 40_000, tax_paise: 11_200, amount_paise: 51_200 });
    const emp = fill(db, 'hr_employees', { company_id: company, emp_code: `${code}E1`, first_name: 'Asha', full_name: 'Asha Kulkarni', gender: 'FEMALE', dob: '1990-04-12', mobile: '9800000001', employment_type: 'PERMANENT', doj: '2024-06-01', status: 'APPROVED', employment_status: 'ACTIVE' });
    return { company, project, vi, emp };
  } finally { db.close(); }
}

test('T-01 T-02 FR-03 FR-04 the Statutory Changes page: cement 28 % then 18 %, section 393(1) with Form 131, the calendar and a draft invoice to review', async ({ page, request }, info) => {
  const w = await world(request, info.project.name === 'desktop' ? 'STD8' : 'STM8');
  await open(page, { user: `e2e-st-${info.project.name}`, roles: 'ACCMGR', company: w.company, path: '/admin/master-data/statutory' });
  await expect(page.getByRole('heading', { name: 'Statutory Changes', level: 1 })).toBeVisible();
  const look = page.getByTestId('st-lookup');
  await look.getByTestId('st-date').fill('2025-09-21'); await look.getByTestId('st-go').click();
  await expect(look.getByTestId('st-gst')).toContainText('28%');
  await look.getByTestId('st-date').fill('2025-09-22'); await look.getByTestId('st-go').click();
  await expect(look.getByTestId('st-gst')).toContainText('18%');
  await look.getByTestId('st-date').fill('2026-04-01'); await look.getByTestId('st-go').click();
  await expect(look.getByTestId('st-tds')).toContainText('Section 393(1)');
  await expect(look.getByTestId('st-tds')).toContainText('Form 131');
  await shot(page, info, 'statutory-on-a-date');
  await expect(page.getByTestId('st-due').first()).toBeVisible();
  const row = page.getByTestId('st-report-row').filter({ hasText: `VI/${info.project.name === 'desktop' ? 'STD8' : 'STM8'}/7` });
  await expect(row).toContainText('28%'); await expect(row).toContainText('18%');
  await page.getByTestId('st-report').scrollIntoViewIfNeeded();
  await shot(page, info, 'statutory-report');
  await noOverflow(page);
  // the TDS master shows the row of the 2025 Act with its nature
  await page.goto('/admin/master-data/common/tds-sections');
  await expect(page.getByText('393(1)').first()).toBeVisible();
  await shot(page, info, 'tds-sections');
});

test('T-03 S-04 the Salary tab: basic 40 % and allowances 60 % make wages 50 %; S-05 the wage rates page names the Code on Wages', async ({ page, request }, info) => {
  const w = await world(request, info.project.name === 'desktop' ? 'SWD8' : 'SWM8');
  const res = await request.put(`/api/v1/mdm/statutory/employees/${w.emp}/pay`, { headers: H('HRMGR', w.company, 'e2e-hr'), data: { effectiveFrom: '2025-12-01', reason: 'Salary structure', lines: [{ code: 'BASIC', amount: 40000 }, { code: 'HRA', amount: 30000 }, { code: 'CONVEYANCE', amount: 10000 }, { code: 'COMMISSION', amount: 20000 }] } });
  expect(res.status(), await res.text()).toBe(200);
  await open(page, { user: `e2e-hr-${info.project.name}`, roles: 'HRMGR', company: w.company, path: `/hr/employees/employee?id=${w.emp}&tab=salary` });
  const tab = page.getByTestId('e3-salary');
  await tab.getByTestId('e3-salary-month').fill('2026-05');
  await expect(tab.getByTestId('e3-wages-amount')).toHaveText('₹50,000');
  await expect(tab).toContainText('added back');
  await shot(page, info, 'employee-salary-tab');
  await noOverflow(page);
  await page.goto('/labour/wages');
  await expect(page.getByTestId('wr-code')).toContainText('Code on Wages, 2019');
  await shot(page, info, 'wage-rates-code');
});
