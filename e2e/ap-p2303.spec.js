import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.03 in the browser (ff.fin.p2303 ON in test), desktop and 360 px phone:
//  AC-01 a direct expense bill typed with its TDS shown live (s.393(1), 2 % above ₹30,000), approved by the head of the maker's department and the accounts
//  manager, posted; held for a dispute; the AP bills list, the vendor ledger and
//  statement, the ageing and TDS reports. Screenshots (docs/erp/screenshots/23.03).
const SHOTS = 'docs/erp/screenshots/23.03';
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
  const post = async (path, roles, company, data) => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, 'e2e-setup'), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const fy = await request.post('/api/v1/core/financial-years', { headers: H('SYSADM', company, 'e2e-setup'), data: { startDate: '2026-04-01' } }); expect(fy.status(), await fy.text()).toBeLessThan(300);
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Payables Plaza', type: 'BUILDING' })).id;
  const opt = await request.get('/api/v1/fin/journals/options', { headers: H('FINEX', company, 'e2e-fin') }); expect(opt.status()).toBe(200);
  const expense = (await opt.json()).data.accounts.find((a) => a.code === '560004').id;
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  try {
    db.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (?, ?, ?) ON CONFLICT(company_id) DO UPDATE SET gstins_json = excluded.gstins_json").run(company, `${code} Infra Pvt Ltd`, JSON.stringify([{ gstin: '36AAACM1234F1Z5', stateCode: '36' }]));
    const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, partner_status, steward_role, created_by) VALUES (?, ?, 'Charminar Facility Services Pvt Ltd', 'Charminar', 'PRIVATE_LIMITED', 'AABCC1234F', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}V`).lastInsertRowid);
    db.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, gstin, state_code, gstin_status, created_by) VALUES (?, ?, '36AABCC1234F1Z9', '36', 'ACTIVE', 'e2e')").run(company, vendor);
    db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, created_by) VALUES (?, ?, 'VENDOR', 'e2e')").run(company, vendor);
    // the maker's department and its head (the first step of a direct expense bill, §9)
    const user = (u, roles) => fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([roles]), email: `${u}@example.com`, status: 'ACTIVE' });
    const finUser = user(`${code.toLowerCase()}-fin`, 'FINEX'); const headUser = user(`${code.toLowerCase()}-head`, 'PM'); user(`${code.toLowerCase()}-acc`, 'ACCMGR');
    const dept = fill(db, 'org_departments', { company_id: company, kind: 'DEPARTMENT', code: `${code}-ADM`, name: 'Administration' });
    fill(db, 'iam_user_profiles', { user_id: finUser, company_id: company, department_id: dept, is_active: 1 });
    fill(db, 'org_assignments', { company_id: company, entity_type: 'DEPARTMENT', entity_id: dept, role: 'HEAD', user_id: headUser, effective_from: '2026-01-01', applied: 1, is_active: 1 });
    return { company, project, vendor, expense, finUser: `${code.toLowerCase()}-fin`, headUser: `${code.toLowerCase()}-head`, accUser: `${code.toLowerCase()}-acc` };
  } finally { db.close(); }
}

test('AC-01 a direct expense bill with its TDS, approved and posted, held; the AP bills list; the vendor ledger and the payables reports', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'APM' : 'APD');
  const fin = await as(browser, info, { user: w.finUser, roles: 'FINEX', company: w.company });
  await fin.page.goto('/finance/ap-bills?new=1');
  await expect(fin.page.getByTestId('ap-direct-form')).toBeVisible();
  await fin.page.getByTestId('ap-partner').selectOption(String(w.vendor));
  await fin.page.getByTestId('ap-project').selectOption(String(w.project));
  await fin.page.getByTestId('ap-billno').fill('CFS/2207');
  await fin.page.getByTestId('ap-billdate').fill('2026-07-05');
  await fin.page.getByTestId('ap-desc').fill('Housekeeping of the site office for June');
  await fin.page.getByTestId('ap-expense').selectOption(String(w.expense));
  await fin.page.getByTestId('ap-amount').fill('50000'); await fin.page.getByTestId('ap-gst').fill('9000');
  await expect(fin.page.getByTestId('ap-tds-preview')).toContainText('393(1)');
  await expect(fin.page.getByTestId('ap-tds-amount')).toContainText('1,000.00');
  if (phone) await noOverflow(fin.page);
  await fin.page.getByTestId('ap-save-submit').click();
  await expect(fin.page.getByTestId('ap-bill')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(fin.page.url()).searchParams.get('id');
  // the head of the maker's department approves first, then the accounts manager (₹59,000: no CFO step)
  const tasks = async (roles, user) => (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H(roles, w.company, user) })).json()).data.rows;
  for (const [roles, user] of [['PM', w.headUser], ['ACCMGR', w.accUser]]) {
    const task = (await tasks(roles, user)).find((x) => x.instance?.docType === 'FIN_AP_DIRECT');
    expect(task, `${user} has the approval task`).toBeTruthy();
    const r = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: H(roles, w.company, user), data: { action: 'approve' } }); expect(r.status(), await r.text()).toBe(200);
  }
  const acc = await as(browser, info, { user: w.accUser, roles: 'ACCMGR', company: w.company });
  await acc.page.goto(`/finance/ap-bills?id=${id}`);
  await expect(acc.page.getByTestId('ap-bill')).toHaveAttribute('data-status', 'APPROVED');
  await expect(acc.page.getByTestId('ap-bill-tds')).toContainText('1,000');
  acc.page.once('dialog', (d) => d.accept('Quality of the June service disputed'));
  await acc.page.getByTestId('ap-hold').click();
  await expect(acc.page.getByTestId('ap-bill')).toHaveAttribute('data-hold', 'yes');
  if (phone) await noOverflow(acc.page);

  await acc.page.goto('/finance/ap-bills');
  await expect(acc.page.getByText('Charminar Facility Services Pvt Ltd').first()).toBeVisible();
  if (phone) await noOverflow(acc.page);
  await acc.page.getByText('Charminar Facility Services Pvt Ltd').first().scrollIntoViewIfNeeded();
  await shot(acc.page, info, 'ap-bills-with-holds-due-filters');

  await acc.page.goto(`/finance/payables?tab=ledger&partnerId=${w.vendor}`);
  await expect(acc.page.getByTestId('ap-ledger-row')).toHaveCount(2);
  await expect(acc.page.getByTestId('ap-ledger-closing')).toContainText('58,000');
  if (phone) await noOverflow(acc.page);
  await acc.page.getByTestId('ap-ledger-closing').scrollIntoViewIfNeeded();
  await shot(acc.page, info, 'vendor-ledger-statement');
  await acc.page.getByTestId('ap-tab-tds').click();
  await expect(acc.page.getByTestId('ap-tds-total')).toContainText('1,000');
  await acc.page.getByTestId('ap-tab-ageing').click();
  await expect(acc.page.getByTestId('ap-ageing')).toBeVisible();
  if (phone) await noOverflow(acc.page);
  await fin.context.close(); await acc.context.close();
});
