import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.06 in the browser (ff.fin.p2306 ON in test), desktop and 360 px phone:
//  AC-01 a bank statement imported and matched by itself to the books; a site imprest voucher with the photo of its bill sent from the phone and posted within the
//  custodian's band; the daily cash and bank position. Screenshots (docs/erp/screenshots/23.06).
const SHOTS = 'docs/erp/screenshots/23.06';
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const fy = await request.post('/api/v1/core/financial-years', { headers: H('SYSADM', company, 'e2e-setup'), data: { startDate: '2026-04-01' } }); expect(fy.status(), await fy.text()).toBeLessThan(300);
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Imprest Towers', type: 'BUILDING' })).id;
  const opt = await request.get('/api/v1/fin/journals/options', { headers: H('FINEX', company, 'e2e-fin') }); expect(opt.status()).toBe(200);
  const bankGl = (await opt.json()).data.accounts.find((a) => a.code === '150002').id;
  const low = code.toLowerCase();
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  let client;
  try {
    for (const [u, r] of [[`${low}-fin`, 'FINEX'], [`${low}-acc`, 'ACCMGR'], [`${low}-sacc`, 'SACC'], [`${low}-cfo`, 'CFO']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    client = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, partner_status, steward_role, created_by) VALUES (?, ?, 'Telangana Housing Board', 'TSHB', 'GOVERNMENT', 'AAAGT1234F', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}C`).lastInsertRowid);
  } finally { db.close(); }
  const bank = (await post('/fin/bank-accounts', 'CFO', company, { code: 'HDFC-CA', name: 'HDFC current account', bankName: 'HDFC Bank', ifsc: 'HDFC0000001', accountNo: '50200012345678', glAccountId: bankGl, fileFormat: 'GENERIC_CSV' }, `${low}-cfo`)).id;
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  await request.put(`/api/v1/fin/bank-profiles/${bank}`, { headers: H('CFO', company, `${low}-cfo`), data: { kind: 'CURRENT', scope: 'COMPANY', openingDate: '2026-04-01', opening: 500000 } });
  const imp = (await post('/fin/imprests', 'ACCMGR', company, { name: 'Tower A site imprest', kind: 'SITE', projectId: project, custodian: `${low}-sacc`, limit: 25000 }, `${low}-acc`)).id;
  // the float: cash withdrawn from the bank, approved by the accounts manager
  const k = await post('/fin/contras', 'FINEX', company, { kind: 'WITHDRAWAL', date: day, fromBankId: bank, toImprestId: imp, amount: 20000, reference: 'CHQ 300010', purpose: 'Float of the Tower A imprest' }, `${low}-fin`);
  await post(`/fin/contras/${k.id}/submit`, 'FINEX', company, {}, `${low}-fin`);
  const tasks = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H('ACCMGR', company, `${low}-acc`) })).json()).data.rows;
  const task = tasks.find((x) => x.instance?.docType === 'FIN_CONTRA'); expect(task).toBeTruthy();
  const a = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: H('ACCMGR', company, `${low}-acc`), data: { action: 'approve' } }); expect(a.status(), await a.text()).toBe(200);
  // a receipt of the books (23.05): the client paid ₹1,50,000 into the account
  const db2 = new DatabaseSync('data/e2e.sqlite'); db2.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  try { fill(db2, 'ar_receipts', { company_id: company, doc_no: `RCPT/${code}1`, partner_id: client, receipt_date: day, bank_account_id: bank, reference: 'SBIN52611801', amount_paise: 15000000, status: 'APPROVED' }); } finally { db2.close(); }
  return { company, project, bank, imp, day, fin: `${low}-fin`, acc: `${low}-acc`, sacc: `${low}-sacc`, cfo: `${low}-cfo` };
}

test('AC-01 a statement imported and matched; an imprest voucher with its bill photo from the phone; the daily position', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'CBM' : 'CBD');
  const fin = await as(browser, info, { user: w.fin, roles: 'FINEX', company: w.company });
  await fin.page.goto('/finance/bank-reconciliation');
  await expect(fin.page.getByTestId('cb-import')).toBeVisible();
  const csv = `Txn Date,Value Date,Narration,Ref No,Cheque No,Withdrawal,Deposit,Balance\n${w.day},${w.day},CHQ 300010 SELF,,,20000.00,,480000.00\n${w.day},${w.day},NEFT CR TSHB SBIN52611801,SBIN52611801,,,150000.00,630000.00\n${w.day},${w.day},BANK CHARGES,,,295.00,,629705.00`;
  await fin.page.getByTestId('cb-file').setInputFiles({ name: 'hdfc-statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await fin.page.getByTestId('cb-import-go').click();
  await expect(fin.page.getByTestId('cb-matched')).toHaveText('2');
  if (phone) await noOverflow(fin.page);
  await shot(fin.page, info, 'import-bank-statement');
  await fin.page.getByTestId('cb-step-match').click();
  await expect(fin.page.getByTestId('cb-line')).toHaveCount(1);
  await fin.page.getByTestId('cb-step-brs').click();
  await expect(fin.page.getByTestId('cb-diff')).toContainText('0.00');

  // the custodian on the phone: a voucher with the photo of its bill
  const sacc = await as(browser, info, { user: w.sacc, roles: 'SACC', company: w.company });
  await sacc.page.goto('/finance/imprest');
  await expect(sacc.page.getByTestId('cb-balance')).toContainText('20,000');
  await sacc.page.getByTestId('cb-v-amount').fill('1850');
  await sacc.page.getByTestId('cb-v-payee').fill('Sri Rama Hardware');
  await sacc.page.getByTestId('cb-v-desc').fill('Binding wire and nails for the slab');
  await sacc.page.getByTestId('cb-photo').setInputFiles({ name: 'bill.png', mimeType: 'image/png', buffer: PNG });
  await expect(sacc.page.getByTestId('cb-photo-label')).toContainText('bill.png');
  if (phone) await noOverflow(sacc.page);
  await shot(sacc.page, info, 'imprest-voucher-with-bill-photo');
  await sacc.page.getByTestId('cb-v-save').click();
  await expect(sacc.page.getByTestId('cb-balance')).toContainText('18,150');
  await sacc.page.getByTestId('cb-tab-vouchers').click();
  await expect(sacc.page.getByTestId('cb-vouchers')).toContainText('1 photo');

  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.company });
  await cfo.page.goto('/finance/cash-position');
  await expect(cfo.page.getByTestId('cb-pos-bank')).toHaveCount(1);
  await expect(cfo.page.getByTestId('cb-pos-cash')).toContainText('18,150');
  if (phone) await noOverflow(cfo.page);
  if (phone) await cfo.page.getByTestId('cb-pos-bank').scrollIntoViewIfNeeded();
  await shot(cfo.page, info, 'daily-cash-bank-position');
  await fin.context.close(); await sacc.context.close(); await cfo.context.close();
});
