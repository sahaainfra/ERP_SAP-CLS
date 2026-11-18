import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createVault } from '../src/server/platform/integrations/vault.js';

// Development-header mode. Part 23.04 in the browser (ff.fin.p2304 ON in test), desktop and 360 px phone:
//  AC-01 a payment proposal made in three steps by the finance executive (the bill picked from what is due), approved by the accounts manager, released by the CFO
//  (a third person) with the bank file, confirmed with the bank's UTR; the payments list. Screenshots (docs/erp/screenshots/23.04).
const SHOTS = 'docs/erp/screenshots/23.04';
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
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const fy = await request.post('/api/v1/core/financial-years', { headers: H('SYSADM', company, 'e2e-setup'), data: { startDate: '2026-04-01' } }); expect(fy.status(), await fy.text()).toBeLessThan(300);
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Payments Plaza', type: 'BUILDING' })).id;
  const opt = await request.get('/api/v1/fin/journals/options', { headers: H('FINEX', company, 'e2e-fin') }); expect(opt.status()).toBe(200);
  const bankGl = (await opt.json()).data.accounts.find((a) => a.code === '150002').id;
  const low = code.toLowerCase();
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  let vendor; let bill;
  try {
    for (const [u, r] of [[`${low}-fin`, 'FINEX'], [`${low}-acc`, 'ACCMGR'], [`${low}-cfo`, 'CFO']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, partner_status, steward_role, created_by) VALUES (?, ?, 'Deccan Cement Traders Pvt Ltd', 'Deccan Cement', 'PRIVATE_LIMITED', 'AABCD1234E', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}V`).lastInsertRowid);
    db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, created_by) VALUES (?, ?, 'VENDOR', 'e2e')").run(company, vendor);
    db.prepare("INSERT INTO mdm_partner_contacts (company_id, partner_id, name, email, is_primary, created_by) VALUES (?, ?, 'Accounts', 'accounts@example.com', 1, 'e2e')").run(company, vendor);
    db.prepare("INSERT INTO mdm_partner_banks (company_id, partner_id, account_no_encrypted, account_hash, account_last4, ifsc, account_name, bank_status, is_primary, created_by) VALUES (?, ?, ?, ?, '0042', 'HDFC0001234', 'DECCAN CEMENT TRADERS PRIVATE LIMITED', 'ACTIVE', 1, 'e2e')")
      .run(company, vendor, createVault().encrypt('501000000042', `mdm_partner_bank/${company}/${vendor}`), `e2e-${code}`);
    // an approved AP bill (23.03) due for payment: ₹1,18,000 less TDS ₹2,000
    bill = fill(db, 'ap_bills', { company_id: company, doc_no: `APB/${code}1`, bill_source: 'VENDOR_INVOICE', source_ref: `${code}-INV-1`, org_project_id: project, partner_id: vendor, payee_name: 'Deccan Cement Traders Pvt Ltd', bill_no: 'DCT/2207', bill_date: '2026-10-01', due_date: '2026-10-31', msme: 0, gross_paise: 10000000, gst_input_paise: 1800000, total_paise: 11800000, tds_paise: 200000, tds_section: '393(1)', net_payable_paise: 11600000, adjusted_paise: 0, paid_paise: 0, status: 'APPROVED', approved_by: 'e2e' });
  } finally { db.close(); }
  // the company's bank account, set up by the CFO
  const bank = await post('/fin/bank-accounts', 'CFO', company, { code: 'HDFC-CA', name: 'HDFC current account', bankName: 'HDFC Bank', ifsc: 'HDFC0000001', accountNo: '50200012345678', glAccountId: bankGl, fileFormat: 'GENERIC_CSV', chequeFrom: 200001, chequeTo: 200100 }, `${low}-cfo`);
  return { company, project, vendor, bill, bank: bank.id, fin: `${low}-fin`, acc: `${low}-acc`, cfo: `${low}-cfo` };
}

test('AC-01 a payment proposal in three steps, approved, released with the bank file by a third person, confirmed with the UTR; the payments list', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'PMM' : 'PMD');
  const fin = await as(browser, info, { user: w.fin, roles: 'FINEX', company: w.company });
  await fin.page.goto('/finance/payment-proposals?new=1');
  await expect(fin.page.getByTestId('pm-form')).toBeVisible();
  await fin.page.getByTestId('pm-bank').selectOption(String(w.bank));
  await fin.page.getByTestId('pm-mode').selectOption('NEFT');
  await fin.page.getByTestId('pm-date').fill(istToday());
  await fin.page.getByTestId('pm-purpose').fill('Weekly cement run');
  await fin.page.getByTestId('pm-next').click();
  await expect(fin.page.getByTestId('pm-candidates')).toBeVisible();
  await fin.page.getByTestId(`pm-pick-${w.bill}`).check();
  await expect(fin.page.getByTestId('pm-total')).toContainText('1,16,000.00');
  await fin.page.getByTestId('pm-next').click();
  await expect(fin.page.getByTestId('pm-review-line')).toHaveCount(1);
  await expect(fin.page.getByTestId('pm-band')).toContainText('accounts manager');
  if (phone) await noOverflow(fin.page);
  await shot(fin.page, info, 'create-payment-proposal');
  await fin.page.getByTestId('pm-save-submit').click();
  await expect(fin.page.getByTestId('pm-run')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(fin.page.url()).searchParams.get('id');

  // the accounts manager approves (≤ ₹10 lakh: alone)
  const tasks = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H('ACCMGR', w.company, w.acc) })).json()).data.rows;
  const task = tasks.find((x) => x.instance?.docType === 'FIN_PAYMENT'); expect(task, 'the accounts manager has the approval task').toBeTruthy();
  const r = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: H('ACCMGR', w.company, w.acc), data: { action: 'approve' } }); expect(r.status(), await r.text()).toBe(200);

  // the approver may not release; the CFO does
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.company });
  await acc.page.goto(`/finance/payment-proposals?id=${id}`);
  await expect(acc.page.getByTestId('pm-sod')).toContainText('You approved this proposal');
  await expect(acc.page.getByTestId('pm-release')).toHaveCount(0);
  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.company });
  await cfo.page.goto(`/finance/payment-proposals?id=${id}`);
  await expect(cfo.page.getByTestId('pm-run')).toHaveAttribute('data-status', 'APPROVED');
  cfo.page.once('dialog', (d) => d.accept());
  await cfo.page.getByTestId('pm-release').click();
  await expect(cfo.page.getByTestId('pm-run')).toHaveAttribute('data-run', 'RELEASED');
  const download = cfo.page.waitForEvent('download');
  await cfo.page.getByTestId('pm-file').click();
  const file = await download; expect(file.suggestedFilename()).toMatch(/\.csv$/);
  await cfo.page.getByTestId('pm-tab-payments').click();
  await expect(cfo.page.getByTestId('pm-payment')).toHaveCount(1);
  if (phone) await noOverflow(cfo.page);
  if (phone) await cfo.page.getByTestId('pm-actions').scrollIntoViewIfNeeded();
  await shot(cfo.page, info, 'payment-run-with-bank-file-download-and-');

  // the bank's confirmation: the UTR entered by the finance executive
  await fin.page.goto(`/finance/payment-proposals?id=${id}`);
  const row = fin.page.getByTestId('pm-confirm-row'); await expect(row).toHaveCount(1);
  const pid = (await fin.page.locator('[data-testid^="pm-utr-"]').getAttribute('data-testid')).replace('pm-utr-', '');
  await fin.page.getByTestId(`pm-utr-${pid}`).fill(`HDFCN5${Date.now()}`.slice(0, 18));
  await fin.page.getByTestId(`pm-paid-${pid}`).click();
  await expect(fin.page.getByTestId('pm-run')).toHaveAttribute('data-run', 'CONFIRMED');

  await fin.page.goto('/finance/payments');
  await expect(fin.page.getByText('Deccan Cement Traders Pvt Ltd').first()).toBeVisible();
  if (phone) await noOverflow(fin.page);
  await fin.page.getByText('Deccan Cement Traders Pvt Ltd').first().scrollIntoViewIfNeeded();
  await shot(fin.page, info, 'payments');
  await fin.page.getByTestId('pm-ptab-cheques').click();
  await expect(fin.page.getByTestId('pm-cheque-register')).toBeVisible();
  if (phone) await noOverflow(fin.page);
  await fin.context.close(); await acc.context.close(); await cfo.context.close();
});
