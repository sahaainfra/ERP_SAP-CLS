import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { gstinCheckChar } from '../src/shared/gst.js';

// Development-header mode. Part 23.07 in the browser (ff.fin.p2307 ON in test), desktop and 360 px phone:
//  AC-01 the settings approved by the CFO, an IRN generated from the IRN-due worklist through the GSP sandbox with its signed QR, an e-way bill generated for the
//  invoice; AC-07 the e-invoice register and the GST settings without overflow at 360 px. Screenshots (docs/erp/screenshots/23.07).
const SHOTS = 'docs/erp/screenshots/23.07';
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
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Housing Blocks Phase 2', type: 'BUILDING' })).id;
  const low = code.toLowerCase(); const own = g('36AAACM1234F1Z'); const client = g('27AAAGT1234F1Z'); const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  let invoice;
  try {
    for (const [u, r] of [[`${low}-acc`, 'ACCMGR'], [`${low}-cfo`, 'CFO']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    db.prepare("INSERT INTO core_company_settings (company_id, legal_name, address_json, gstins_json) VALUES (?, ?, ?, ?) ON CONFLICT(company_id) DO UPDATE SET legal_name = excluded.legal_name, address_json = excluded.address_json, gstins_json = excluded.gstins_json")
      .run(company, `${code} Infra Pvt Ltd`, JSON.stringify({ line1: 'Plot 12, Hitech City', line2: '', city: 'Hyderabad', stateCode: '36', pincode: '500081' }), JSON.stringify([{ gstin: own, stateCode: '36' }]));
    const partner = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, pan, partner_status, steward_role, created_by) VALUES (?, ?, 'Maharashtra Housing Board', 'MHADA', 'GOVERNMENT', 'AAAGT1234F', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}C`).lastInsertRowid);
    fill(db, 'mdm_partner_addresses', { company_id: company, partner_id: partner, address_type: 'BILLING', address: 'Griha Nirman Bhavan, Bandra East', city: 'Mumbai', state_code: '27', pin: '400051', is_default: 1 });
    const contract = fill(db, 'ctr_contracts', { company_id: company, org_project_id: project, client_partner_id: partner, status: 'APPROVED' });
    db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, max_retries) VALUES (?, ?, 'GST sandbox', 'gsp', 'sandbox', 'development', '{}', 'ENABLED', 0)").run(company, `GSP-${code}`);
    invoice = fill(db, 'bill_tax_invoices', { company_id: company, org_project_id: project, contract_id: contract, bill_id: 7000 + company, invoice_no: `36/26-27/${code}01`, invoice_date: day, sac_code: '9954', description: 'Construction of housing blocks, RA bill 4', gst_pct_bp: 1800, taxable_paise: 125000000, cgst_paise: 0, sgst_paise: 0, igst_paise: 22500000, total_paise: 147500000, supply: 'inter', gstin_from: own, gstin_to: client, place_state: '27', due_date: day, status: 'APPROVED', irn_state: 'PENDING', ar_state: 'HANDED' });
  } finally { db.close(); }
  // the settings: proposed by the accounts manager, approved by the CFO
  const s = await post('/fin/gst/settings', 'ACCMGR', company, { aato: '1200000000', einvoiceEnabled: true, ewayEnabled: true, gspConnector: `GSP-${code}`, gspMode: 'SANDBOX', changeNote: 'Turnover above ₹10 crore: e-invoicing and e-way bills' }, `${low}-acc`);
  await post(`/fin/gst/settings/${s.id}/submit`, 'ACCMGR', company, {}, `${low}-acc`);
  const tasks = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H('CFO', company, `${low}-cfo`) })).json()).data.rows;
  const task = tasks.find((x) => x.instance?.docType === 'FIN_GST_SETTINGS'); expect(task).toBeTruthy();
  const a = await request.post(`/api/v1/workflow/tasks/${task.id}/act`, { headers: H('CFO', company, `${low}-cfo`), data: { action: 'approve' } }); expect(a.status(), await a.text()).toBe(200);
  return { company, invoice, acc: `${low}-acc`, cfo: `${low}-cfo` };
}

test('AC-01 an IRN from the worklist through the sandbox with its QR; an e-way bill for the invoice; the register and the settings on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'GSM' : 'GSD');
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.company });
  await acc.page.goto('/finance/e-invoices?tab=due');
  await expect(acc.page.getByTestId('gst-due-row')).toHaveCount(1);
  await acc.page.getByTestId(`gst-gen-${w.invoice}`).click();
  await expect(acc.page.getByTestId('gst-due')).toContainText('Every document has its IRN');
  await acc.page.getByTestId('gst-tab-einv').click();
  await expect(acc.page.getByText(`36/26-27/${phone ? 'GSM' : 'GSD'}01`).first()).toBeVisible();
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'e-invoice-register');
  const list = await (await request.get('/api/v1/fin/einvoices', { headers: H('ACCMGR', w.company, w.acc) })).json(); expect(list.data[0].status).toBe('GENERATED');
  await acc.page.goto(`/finance/e-invoices?id=${list.data[0].id}`);
  await expect(acc.page.getByTestId('gst-einvoice')).toHaveAttribute('data-status', 'GENERATED');
  await expect(acc.page.getByTestId('gst-qr')).toBeVisible();
  if (phone) await noOverflow(acc.page);
  // the e-way bill of the invoice: 720 km, a truck
  await acc.page.goto('/finance/e-invoices?tab=ewb');
  await acc.page.getByRole('button', { name: 'New e-way bill' }).first().click();
  await acc.page.getByTestId('gst-ewb-doc').selectOption(`bill_tax_invoices:${w.invoice}`);
  await acc.page.getByTestId('gst-ewb-distance').fill('720');
  await acc.page.getByTestId('gst-ewb-vehicle').fill('TS09EA1234');
  if (phone) await noOverflow(acc.page);
  await acc.page.getByTestId('gst-ewb-go').click();
  await expect(acc.page.getByTestId('gst-ewb')).toHaveAttribute('data-status', 'ACTIVE');
  await expect(acc.page.getByTestId('gst-ewb-valid')).not.toHaveText('—');
  // the settings: what is in force, the GSTIN checked, the versions
  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.company });
  await cfo.page.goto('/finance/gst-settings');
  await expect(cfo.page.getByTestId('gst-set-einv')).toHaveText('On');
  await expect(cfo.page.getByTestId('gst-gstins')).toContainText('36AAACM1234F1Z');
  if (phone) await noOverflow(cfo.page);
  await shot(cfo.page, info, 'gst-settings');
  await acc.context.close(); await cfo.context.close();
});
