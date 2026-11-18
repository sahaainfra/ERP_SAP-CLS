import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.05 in the browser (ff.fin.p2305 ON in test), desktop and 360 px phone:
//  AC-01 the receivables with their ageing; a receipt with TDS, GST-TDS and retention set against the oldest invoices and posted; the collections worklist, where the
//  project manager logs a call with a promise. Screenshots (docs/erp/screenshots/23.05).
const SHOTS = 'docs/erp/screenshots/23.05';
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
  const fy = await request.post('/api/v1/core/financial-years', { headers: H('SYSADM', company, 'e2e-setup'), data: { startDate: '2026-04-01' } }); expect(fy.status(), await fy.text()).toBeLessThan(300);
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Receivables Residency', type: 'BUILDING' })).id;
  const opt = await request.get('/api/v1/fin/journals/options', { headers: H('FINEX', company, 'e2e-fin') }); expect(opt.status()).toBe(200);
  const bankGl = (await opt.json()).data.accounts.find((a) => a.code === '150002').id;
  const low = code.toLowerCase();
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  let client; const inv = [];
  try {
    db.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (?, ?, ?) ON CONFLICT(company_id) DO UPDATE SET gstins_json = excluded.gstins_json").run(company, `${code} Infra Pvt Ltd`, JSON.stringify([{ gstin: '36AAACM1234F1Z5', stateCode: '36' }]));
    for (const [u, r] of [[`${low}-fin`, 'FINEX'], [`${low}-pm`, 'PM'], [`${low}-acc`, 'ACCMGR']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    client = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, partner_status, steward_role, created_by) VALUES (?, ?, 'Telangana Housing Board', 'TSHB', 'GOVERNMENT', 'AAAGT1234F', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}C`).lastInsertRowid);
    db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, created_by) VALUES (?, ?, 'CLIENT', 'e2e')").run(company, client);
    db.prepare("INSERT INTO mdm_partner_gstins (company_id, partner_id, gstin, state_code, gstin_status, created_by) VALUES (?, ?, '36AAAGT1234F1Z1', '36', 'ACTIVE', 'e2e')").run(company, client);
    // three receivables of tax invoices (23.05 makes them from 22.04's event; here they are the fixture): two overdue, one not yet due
    for (const [no, date, due, amt] of [['36/2026-27/00011', '2026-07-01', '2026-07-31', 11800000], ['36/2026-27/00012', '2026-08-15', '2026-09-14', 5900000], ['36/2026-27/00013', '2026-11-10', '2026-12-10', 2360000]]) inv.push(fill(db, 'ar_invoices', { company_id: company, doc_no: `AR/${code}${inv.length + 1}`, inv_source: 'TAX_INVOICE', source_ref: `${code}${no}`, org_project_id: project, partner_id: client, invoice_no: no, invoice_date: date, due_date: due, taxable_paise: Math.round(amt / 1.18), gst_paise: amt - Math.round(amt / 1.18), amount_paise: amt, interest_bp: 1200, status: 'APPROVED', approved_by: 'e2e' }));
  } finally { db.close(); }
  const bank = await post('/fin/bank-accounts', 'CFO', company, { code: 'SBI-CA', name: 'SBI collections', bankName: 'State Bank of India', ifsc: 'SBIN0000001', accountNo: '30200012345678', glAccountId: bankGl, fileFormat: 'GENERIC_CSV' }, `${low}-cfo`);
  return { company, project, client, inv, bank: bank.id, fin: `${low}-fin`, pm: `${low}-pm` };
}

test('AC-01 receivables with ageing; a receipt with deductions set against the oldest invoices; the collections worklist and a follow-up with a promise', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'ARM' : 'ARD');
  const fin = await as(browser, info, { user: w.fin, roles: 'FINEX', company: w.company });
  await fin.page.goto('/finance/receivables');
  await expect(fin.page.getByTestId('ar-total-open')).toContainText('2,00,600');
  await expect(fin.page.getByText('36/2026-27/00011').first()).toBeVisible();
  if (phone) await noOverflow(fin.page);
  await shot(fin.page, info, 'receivables-with-ageing');
  // ₹1,50,000 received; TDS ₹2,000, GST-TDS ₹2,000, retention ₹5,000: ₹1,59,000 settles the first invoice (₹1,18,000) and ₹41,000 of the second
  await fin.page.getByTestId('ar-new-receipt').click();
  await expect(fin.page.getByTestId('ar-receipt-form')).toBeVisible();
  await fin.page.getByTestId('ar-client').selectOption(String(w.client));
  await fin.page.getByTestId('ar-bank').selectOption(String(w.bank));
  await fin.page.getByTestId('ar-ref').fill('UTR SBIN526118');
  await fin.page.getByTestId('ar-amount').fill('150000'); await fin.page.getByTestId('ar-tds').fill('2000'); await fin.page.getByTestId('ar-gsttds').fill('2000'); await fin.page.getByTestId('ar-retention').fill('5000');
  await expect(fin.page.getByTestId('ar-alloc-row')).toHaveCount(3);
  await expect(fin.page.getByTestId(`ar-take-${w.inv[0]}`)).toContainText('1,18,000.00');
  await expect(fin.page.getByTestId(`ar-take-${w.inv[1]}`)).toContainText('41,000.00');
  await expect(fin.page.getByTestId('ar-onaccount')).toContainText('0.00');
  if (phone) await noOverflow(fin.page);
  await fin.page.getByTestId('ar-post').click();
  await expect(fin.page.getByTestId('ar-receipt')).toHaveAttribute('data-status', 'APPROVED');
  await fin.page.goto(`/finance/receivables?id=${w.inv[1]}`);
  await expect(fin.page.getByTestId('ar-balance')).toContainText('18,000');

  // the project manager follows the second invoice up from the worklist
  const pm = await as(browser, info, { user: w.pm, roles: 'PM', company: w.company });
  await pm.page.goto('/finance/collections');
  await expect(pm.page.getByTestId('ar-work-card').first()).toBeVisible();
  if (phone) await noOverflow(pm.page);
  if (phone) await pm.page.getByTestId('ar-work-card').first().scrollIntoViewIfNeeded();
  await shot(pm.page, info, 'collections-follow-up');
  await pm.page.getByTestId(`ar-follow-${w.inv[1]}`).click();
  await pm.page.getByTestId('ar-fu-notes').fill('Spoke to the Executive Engineer; the balance is in the next cheque run');
  await pm.page.getByTestId('ar-fu-promise').fill('2026-12-15');
  await pm.page.getByTestId('ar-fu-save').click();
  await expect(pm.page.getByTestId('ar-followups')).toContainText('2026-12-15');
  if (phone) await noOverflow(pm.page);
  await pm.page.goto('/finance/collections?tab=ageing');
  await expect(pm.page.getByTestId('ar-ageing-row').first()).toBeVisible();
  await fin.context.close(); await pm.context.close();
});
