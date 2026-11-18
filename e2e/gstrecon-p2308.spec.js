import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { gstinCheckChar } from '../src/shared/gst.js';

// Development-header mode. Part 23.08 in the browser (ff.fin.p2307 and ff.fin.p2308 ON in test), desktop and 360 px phone:
//  AC-01 GSTR-2B imported on the page and matched into its categories, the ITC review of the month made by the accounts manager and approved by the CFO on the phone,
//  GSTR-1/3B prepared from it; AC-07 the worklist and the returns report without overflow at 360 px. Screenshots (docs/erp/screenshots/23.08).
const SHOTS = 'docs/erp/screenshots/23.08';
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
const g = (first14) => `${first14}${gstinCheckChar(first14)}`;

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const opt = await request.get('/api/v1/fin/journals/options', { headers: H('FINEX', company, 'e2e-fin') }); expect(opt.status()).toBe(200);
  const low = code.toLowerCase(); const own = g('36AAACM1234F1Z'); const v1 = g('36AABCD1111A1Z'); const v2 = g('27AABCE2222B1Z');
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  try {
    for (const [u, r] of [[`${low}-acc`, 'ACCMGR'], [`${low}-cfo`, 'CFO']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    db.prepare("INSERT INTO core_company_settings (company_id, legal_name, gstins_json) VALUES (?, ?, ?) ON CONFLICT(company_id) DO UPDATE SET legal_name = excluded.legal_name, gstins_json = excluded.gstins_json").run(company, `${code} Infra Pvt Ltd`, JSON.stringify([{ gstin: own, stateCode: '36' }]));
    const exp = db.prepare("SELECT id FROM fin_accounts WHERE company_id = ? AND code = '510001'").get(company).id;
    const vendor = (c, name, gstin) => { const p = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, constitution, pan, partner_status, steward_role, created_by) VALUES (?, ?, ?, 'PRIVATE_LIMITED', ?, 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}${c}`, name, gstin.slice(2, 12)).lastInsertRowid); fill(db, 'mdm_partner_gstins', { company_id: company, partner_id: p, gstin, state_code: gstin.slice(0, 2), gstin_status: 'ACTIVE' }); return p; };
    const p1 = vendor('V1', 'Deccan Cement Traders', v1); const p2 = vendor('V2', 'Pune Steel Rolling', v2);
    let n = 0; const bill = (p, no, date, taxable, gst) => { n += 1; fill(db, 'ap_bills', { company_id: company, doc_no: `AP/${code}${n}`, bill_source: 'DIRECT', partner_id: p, payee_name: 'Vendor', bill_no: no, bill_date: date, due_date: date, expense_account_id: exp, gross_paise: taxable * 100, gst_input_paise: gst * 100, total_paise: (taxable + gst) * 100, net_payable_paise: (taxable + gst) * 100, status: 'APPROVED' }); };
    bill(p1, 'INV/101', '2026-10-05', 100000, 18000); bill(p1, 'INV/102', '2026-10-08', 100000, 18000); bill(p2, 'B-77', '2026-10-10', 200000, 36000); bill(p2, 'B-78', '2026-10-21', 50000, 9000);
  } finally { db.close(); }
  const csv = ['GSTIN of supplier,Trade name,Type,Invoice number,Invoice date,Place of supply,Reverse charge,Rate (%),Taxable value,Integrated tax,Central tax,State/UT tax,Cess,ITC availability',
    `${v1},Deccan Cement Traders,Invoice,INV/101,05-10-2026,36,N,18,100000,0,9000,9000,0,Yes`, `${v1},Deccan Cement Traders,Invoice,INV/102,08-10-2026,36,N,12,100000,0,6000,6000,0,Yes`, `${v2},Pune Steel Rolling,Invoice,B-77,12-10-2026,36,N,18,200000,36000,0,0,0,Yes`, `${g('29AABCG4444D1Z')},Bengaluru Tiles,Invoice,Z-9,22-10-2026,36,N,18,30000,5400,0,0,0,Yes`].join('\n');
  return { company, csv, acc: `${low}-acc`, cfo: `${low}-cfo` };
}

test('AC-01 GSTR-2B imported and matched; the ITC review approved by the CFO; GSTR-1/3B; desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'GRM' : 'GRD');
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.company });
  await acc.page.goto('/finance/gst-reconciliation?period=2026-10');
  await acc.page.getByTestId('rec-file').setInputFiles({ name: 'GSTR2B_102026.csv', mimeType: 'text/csv', buffer: Buffer.from(w.csv) });
  await acc.page.getByTestId('rec-import').click();
  await expect(acc.page.getByTestId('rec-matched')).toHaveText('1');
  await expect(acc.page.getByTestId('rec-mismatch')).toHaveText('2');
  await expect(acc.page.getByTestId('rec-line')).toHaveCount(2);
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'gstr-2b-reconciliation-with-categories');
  await acc.page.getByTestId('rec-cat-MISSING_IN_2B').click();
  await expect(acc.page.getByTestId('rec-missing2b')).toHaveCount(1);
  // the ITC review of October: made and sent by the accounts manager
  await acc.page.getByTestId('rec-tab-itc').click();
  await acc.page.getByTestId('itc-create').click();
  await expect(acc.page.getByTestId('itc-review')).toHaveAttribute('data-status', 'DRAFT');
  await expect(acc.page.getByTestId('itc-claimable')).toContainText('18,000');
  await acc.page.getByTestId('itc-submit').click();
  await expect(acc.page.getByTestId('itc-review')).toHaveAttribute('data-status', 'SUBMITTED');
  // the CFO approves on the phone or the desktop
  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.company });
  await cfo.page.goto('/finance/gst-reconciliation?period=2026-10&tab=itc');
  await cfo.page.getByRole('button', { name: /ITC\/.*2026-10/ }).first().click();
  await cfo.page.getByTestId('itc-approve').click();
  await expect(cfo.page.getByTestId('itc-review')).toHaveAttribute('data-status', 'APPROVED');
  if (phone) await noOverflow(cfo.page);
  // the returns: GSTR-3B takes the approved ITC
  await acc.page.goto('/finance/gst-returns?period=2026-10');
  await acc.page.getByTestId('ret-prepare-GSTR3B').click();
  await expect(acc.page.getByTestId('ret-GSTR3B')).toContainText('Prepared');
  await expect(acc.page.getByTestId('ret-totals')).toContainText('18,000');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'gstr-1-3b-summary');
  await acc.page.getByTestId('ret-tab-calendar').click();
  await expect(acc.page.getByTestId('cal-row').first()).toBeVisible();
  if (phone) await noOverflow(acc.page);
  await acc.context.close(); await cfo.context.close();
});
