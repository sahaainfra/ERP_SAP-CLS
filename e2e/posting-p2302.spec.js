import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

// Development-header mode. Part 23.02 in the browser (ff.fin.p2302 is ON in test), on the desktop and on a 360 px phone:
//  AC-01 / FR-03 history before the engine (two goods receipts and a vendor invoice, already in the outbox) replayed: the dry run (3 events, 2 would post, 1 would not),
//  sent by IT administration, approved by the accounts manager and the CFO, posted; FR-04 the one that could not post waits in Failed Postings and is closed with a
//  reason; FR-05 the sub-ledgers agree with the ledger; FR-01 the GRN rule tested against a sample event. Screenshots (docs/erp/screenshots/23.02).
const SHOTS = 'docs/erp/screenshots/23.02';
const shot = (page, info, name) => page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png`, fullPage: false });
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const as = async (browser, info, { user, roles, company }) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch, reducedMotion: 'reduce' });
  await context.addInitScript(([v]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })); }, [{ user, roles, company: String(company) }]);
  return { context, page: await context.newPage() };
};
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
let seq = 0;
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql;
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  const names = []; const params = [];
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `e2e${(seq += 1)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}

async function world(request, code) {
  const post = async (path, roles, company, data) => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, 'e2e-setup'), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const fy = await request.post('/api/v1/core/financial-years', { headers: H('SYSADM', company, 'e2e-setup'), data: { startDate: '2026-04-01' } }); expect(fy.status(), await fy.text()).toBeLessThan(300);
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Posting Viaduct', type: 'BRIDGE' })).id;
  expect((await request.get('/api/v1/fin/journals/options', { headers: H('ACCMGR', company, 'e2e-acc') })).status()).toBe(200); // the company's chart
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  try {
    const site = fill(db, 'org_sites', { company_id: company, org_project_id: project, code: `${code}S`, name: 'Pier site' });
    const store = fill(db, 'inv_stores', { company_id: company, code: `${code}-ST`, name: 'Pier store', store_type: 'SITE_STORE', org_project_id: project, org_site_id: site, requested_by: 'e2e', store_status: 'ACTIVE' });
    const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Godavari Steel Ltd', 'Godavari', 'PUBLIC_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}V`).lastInsertRowid);
    const outbox = (type, entity, entityId, data) => db.prepare("INSERT INTO core_outbox (event_type, aggregate_id, payload, published_at) VALUES (?, ?, ?, '2026-05-31T00:00:00Z')").run(type, String(entityId), JSON.stringify({ eventId: randomUUID(), type, version: 1, occurredAt: '2026-05-20T10:00:00Z', companyId: company, entity, entityId: String(entityId), actorId: 'e2e', data }));
    for (const [i, [date, rupees]] of [['2026-05-06', 42000], ['2026-05-18', 18500.5]].entries()) {
      const g = fill(db, 'inv_grns', { company_id: company, doc_no: `GRN/${code}/${i + 1}`, received_date: date, org_project_id: project, store_id: store, vendor_id: vendor, total_value: Math.round(rupees * 100), status: 'APPROVED', emergency: 1, emergency_why: 'e2e', requested_by: 'e2e' });
      fill(db, 'inv_stock_ledger', { company_id: company, doc_no: `GRN/${code}/${i + 1}`, store_id: store, item_id: 1, txn_type: 'RECEIPT', txn_date: date, qty_in: 1000, qty_out: 0, rate: Math.round(rupees * 100), value: Math.round(rupees * 100), balance_qty: 1000, balance_value: Math.round(rupees * 100) });
      outbox('inv.grn.posted', 'inv_grns', g, { grnId: g, docNo: `GRN/${code}/${i + 1}`, receivedOn: date, storeId: store, storeCode: `${code}-ST`, vendorId: vendor, totalValue: Math.round(rupees * 100), lines: [] });
    }
    outbox('ap.invoice.matched', 'bill_vendor_invoices', 900000 + company, { invoiceId: 900000 + company, invoiceNo: `GS/${code}/77`, invoiceDate: '2026-05-25', kind: 'PO', projectId: project, vendorId: vendor, vendorGstin: null, taxable: 10000, tax: 1800, total: 11800, debit: 0, payable: 11800, matchStatus: 'MATCHED', itc: [] });
    return { company, project };
  } finally { db.close(); }
}

test('AC-01 FR-03 FR-04 FR-05 FR-01 history replayed after a dry run and its approval; the failed posting closed; the sub-ledgers agree; a rule tested', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'PEM' : 'PED');
  const it = await as(browser, info, { user: 'e2e-it', roles: 'ITADM', company: w.company });
  await it.page.goto('/finance/posting-replay');
  await expect(it.page.getByTestId('pe-replay')).toBeVisible();
  await it.page.getByTestId('pe-type-inv.grn.posted').check(); await it.page.getByTestId('pe-type-ap.invoice.matched').check();
  await it.page.getByTestId('pe-from-date').fill('2026-04-01');
  await it.page.getByTestId('pe-dry-run').click();
  await expect(it.page.getByTestId('pe-run')).toHaveAttribute('data-status', 'DRAFT');
  await expect(it.page.getByTestId('pe-run-events')).toHaveText('3'); await expect(it.page.getByTestId('pe-run-post')).toHaveText('2');
  if (phone) await noOverflow(it.page);
  await shot(it.page, info, 'replay-events');
  await it.page.getByTestId('pe-run-submit').click();
  await expect(it.page.getByTestId('pe-run')).toHaveAttribute('data-status', 'SUBMITTED');
  const runUrl = it.page.url();

  const acc = await as(browser, info, { user: 'e2e-acc', roles: 'ACCMGR', company: w.company });
  await acc.page.goto(new URL(runUrl).pathname + new URL(runUrl).search);
  await acc.page.getByTestId('pe-approve').click();
  await expect(acc.page.getByTestId('pe-decide')).toHaveCount(0);
  const cfo = await as(browser, info, { user: 'e2e-cfo', roles: 'CFO', company: w.company });
  await cfo.page.goto(new URL(runUrl).pathname + new URL(runUrl).search);
  await cfo.page.getByTestId('pe-approve').click();
  await expect(cfo.page.getByTestId('pe-run')).toHaveAttribute('data-status', 'APPROVED');
  await expect(cfo.page.getByTestId('pe-run-result')).toContainText('2');

  await acc.page.goto('/finance/failed-postings');
  await expect(acc.page.getByTestId('pe-failed-count')).toHaveText('1');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'failed-postings');
  await acc.page.getByText(`GS/${phone ? 'PEM' : 'PED'}/77`).first().click();
  await expect(acc.page.getByTestId('pe-error')).toContainText('SUPPLY_UNKNOWN');
  await acc.page.getByTestId('pe-note-input').fill('Unregistered supplier: booked by a manual journal');
  await acc.page.getByTestId('pe-ignore').click();
  await expect(acc.page.getByTestId('pe-posting')).toHaveAttribute('data-status', 'IGNORED');

  await acc.page.goto('/finance/reconciliation');
  await acc.page.getByTestId('pe-recon-asof').fill('2026-05-31'); await acc.page.getByTestId('pe-recon-show').click();
  await expect(acc.page.getByTestId('pe-recon-state')).toHaveAttribute('data-clean', 'yes');
  await expect(acc.page.getByTestId('pe-recon-GRNI')).toHaveAttribute('data-diff', '0');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'sub-ledger-vs-gl-reconciliation');

  await acc.page.goto('/finance/posting-rules');
  await expect(acc.page.getByText('Goods receipt: inventory against goods received not invoiced').first()).toBeVisible();
  const rules = await (await request.get('/api/v1/fin/posting-rules?pageSize=50', { headers: H('ACCMGR', w.company, 'e2e-acc') })).json();
  await acc.page.goto(`/finance/posting-rules?id=${rules.data.find((r) => r.ruleCode === 'GRN').id}`);
  await expect(acc.page.getByTestId('pe-rule')).toHaveAttribute('data-status', 'APPROVED');
  await acc.page.getByTestId('pe-sample').selectOption({ index: 1 });
  await acc.page.getByTestId('pe-test-run').click();
  await expect(acc.page.getByTestId('pe-test-result')).toHaveAttribute('data-ok', 'yes');
  if (phone) await noOverflow(acc.page);
  await acc.page.getByTestId('pe-test').scrollIntoViewIfNeeded();
  await shot(acc.page, info, 'posting-rule-matrix-editor-with-test-aga');
  await it.context.close(); await acc.context.close(); await cfo.context.close();
});
