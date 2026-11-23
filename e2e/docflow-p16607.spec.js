import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 166.7 in the browser (ff.ui.p16607 is ON in test):
//  T-02 the document flow of a purchase order: MR, PR, PO, GRN and vendor invoice in the order of the chain, with their statuses, each a link;
//  FR-01 a list's title with its count, and group-by; FR-04 the filters of a list in a sheet on a phone.
const SHOTS = 'docs/erp/screenshots/166.7';
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
let seq = 0;
/** A row with the given values; a required column without a default gets the first value its CHECK allows (as tests/qa-helpers.js fill). */
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

async function chain(request, code) {
  const post = async (path, roles, company, data) => {
    const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, 'e2e-setup'), data });
    expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300);
    return (await res.json()).data;
  };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Flow Bridge', type: 'BRIDGE' })).id;
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF'); // this connection only, as tests/qa-helpers.js: filler values of required columns
  try {
    const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Flow Cement Ltd', 'Flow', 'PUBLIC_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}V`).lastInsertRowid);
    const item = fill(db, 'mdm_items', { company_id: company, code: `${code}I`, name: 'Cement 53 grade' });
    const mr = fill(db, 'proc_material_requests', { company_id: company, org_project_id: project, doc_no: `MR/${code}/1`, doc_date: '2026-11-01', status: 'APPROVED' });
    const mrl = fill(db, 'proc_mr_lines', { company_id: company, mr_id: mr, line_no: 1, item_id: item, qty: 100_000 });
    const pr = fill(db, 'proc_requisitions', { company_id: company, org_project_id: project, doc_no: `PR/${code}/1`, doc_date: '2026-11-02', status: 'APPROVED', total_amount: 4_000_000 });
    const prl = fill(db, 'proc_pr_lines', { company_id: company, pr_id: pr, line_no: 1, item_id: item, qty: 100_000 });
    fill(db, 'proc_pr_sources', { company_id: company, pr_line_id: prl, mr_line_id: mrl, qty: 100_000 });
    const po = fill(db, 'proc_purchase_orders', { company_id: company, org_project_id: project, vendor_id: vendor, doc_no: `PO/${code}/1`, doc_date: '2026-11-05', status: 'APPROVED', total_amount: 4_720_000 });
    fill(db, 'proc_po_lines', { company_id: company, po_id: po, line_no: 1, pr_line_id: prl, item_id: item, qty: 100_000, uom: 'bag', rate: 40_000 });
    fill(db, 'inv_grns', { company_id: company, org_project_id: project, po_id: po, vendor_id: vendor, doc_no: `GRN/${code}/1`, received_date: '2026-11-08', status: 'APPROVED', total_value: 4_000_000 });
    fill(db, 'bill_vendor_invoices', { company_id: company, org_project_id: project, vendor_id: vendor, po_id: po, doc_no: `VI/${code}/1`, invoice_no: 'FC/889', invoice_date: '2026-11-10', status: 'SUBMITTED', total_paise: 4_720_000 });
    return { company, po };
  } finally {
    db.close();
  }
}

test('T-02 the document flow of a purchase order: MR, PR, PO, GRN and vendor invoice in order with their statuses; no step listed as not yet available (30.01)', async ({ page, request }, info) => {
  const { company, po } = await chain(request, info.project.name === 'desktop' ? 'DFD7' : 'DFM7');
  await open(page, { user: `e2e-flow-${info.project.name}`, roles: 'PROCMGR,ACCMGR', company, path: `/proc/purchase-orders?id=${po}` });
  const flow = page.getByTestId('doc-flow');
  await expect(flow.getByRole('heading', { name: 'Document flow' })).toBeVisible();
  const nodes = flow.getByTestId('doc-flow-node');
  await expect(nodes).toHaveCount(5);
  expect(await nodes.evaluateAll((els) => els.map((e) => e.dataset.type))).toEqual(['MR', 'PR', 'PO', 'GRN', 'VINV']);
  await expect(nodes.nth(2)).toHaveAttribute('aria-current', 'step');
  await expect(nodes.nth(0)).toContainText('Approved');
  await expect(nodes.nth(4)).toContainText('Submitted');
  // part 30.01: payments and receipts now exist (23.04, 23.05), so no step of the chain is shown as not yet available
  await expect(flow.getByTestId('doc-flow-later')).toHaveCount(0);
  await flow.scrollIntoViewIfNeeded();
  await shot(page, info, 'po-document-flow');
  // each document of the flow opens its page
  await nodes.nth(3).getByRole('link').click();
  await expect(page).toHaveURL(/\/inv\/grns\?id=\d+/);
  await expect(page.getByTestId('doc-flow').getByTestId('doc-flow-node').nth(3)).toHaveAttribute('aria-current', 'step');
});

test('FR-01 a list shows its title with the count and groups its rows; FR-04 on a phone its filters open in a sheet', async ({ page, request }, info) => {
  const { company } = await chain(request, info.project.name === 'desktop' ? 'LGD7' : 'LGM7');
  await open(page, { user: `e2e-list-${info.project.name}`, roles: 'PROCMGR', company, path: '/proc/purchase-orders' });
  await expect(page.getByTestId('list-title')).toContainText('(1)');
  if (info.project.name === 'desktop') {
    await page.getByTestId('list-group-by').selectOption({ label: 'Status' });
    await expect(page.getByTestId('list-group').first()).toContainText('Status:');
    await shot(page, info, 'list-group-by');
  } else {
    await expect(page.getByTestId('filter-sheet')).toBeHidden();
    await page.getByTestId('filter-sheet-open').click();
    const sheet = page.getByRole('dialog', { name: /Filters of/ });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('group', { name: 'Quick filters' })).toBeVisible();
    await shot(page, info, 'list-filter-sheet');
    await sheet.getByTestId('filter-sheet-close').click();
    await expect(page.getByTestId('filter-sheet')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});
