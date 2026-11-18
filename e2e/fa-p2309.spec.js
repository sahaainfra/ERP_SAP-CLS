import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.09 in the browser (ff.fin.p2309 ON in test), desktop and 360 px phone:
//  AC-01 an asset capitalised from a capex bill on the page and approved by the CFO, last month's depreciation run and posted, the register and the asset with its
//  depreciation schedule; AC-07 the pages without overflow at 360 px. Screenshots (docs/erp/screenshots/23.09).
const SHOTS = 'docs/erp/screenshots/23.09';
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
  const project = (await post('/iam/org/projects', 'PM', company, { code: `${code}P`, name: 'Outer Ring Road Package 3', type: 'BUILDING' })).id;
  const opt = await request.get('/api/v1/fin/journals/options', { headers: H('FINEX', company, 'e2e-fin') }); expect(opt.status()).toBe(200);
  const low = code.toLowerCase(); const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF'); let bill;
  try {
    for (const [u, r] of [[`${low}-acc`, 'ACCMGR'], [`${low}-cfo`, 'CFO']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    const pm = db.prepare("SELECT id FROM fin_accounts WHERE company_id = ? AND code = '110001'").get(company).id;
    const v = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, constitution, pan, partner_status, steward_role, created_by) VALUES (?, ?, 'Deccan Earthmovers', 'PRIVATE_LIMITED', 'AABCD1111A', 'ACTIVE', 'PROCMGR', 'e2e')").run(company, `${code}V`).lastInsertRowid);
    bill = fill(db, 'ap_bills', { company_id: company, doc_no: `AP/${code}1`, bill_source: 'DIRECT', partner_id: v, payee_name: 'Deccan Earthmovers', bill_no: 'DE-4471', bill_date: '2026-06-01', due_date: '2026-07-01', org_project_id: project, expense_account_id: pm, description: 'Excavator Tata Hitachi EX200 with breaker', gross_paise: 420000000, gst_input_paise: 75600000, total_paise: 495600000, net_payable_paise: 495600000, status: 'APPROVED' });
  } finally { db.close(); }
  return { company, project, bill, acc: `${low}-acc`, cfo: `${low}-cfo`, H };
}

test('AC-01 an asset capitalised from a capex bill and approved; depreciation run; the register and the schedule on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'FAM' : 'FAD');
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.company });
  await acc.page.goto('/finance/asset-accounting?step=capitalise');
  await acc.page.getByTestId('fa-src').selectOption(`AP_BILL:${w.bill}`);
  await acc.page.getByTestId('fa-class').selectOption('EARTHMOVING');
  if (phone) { await noOverflow(acc.page); await acc.page.getByTestId('fa-src').scrollIntoViewIfNeeded(); }
  await shot(acc.page, info, 'capitalise-from-bill-cwip');
  await acc.page.getByTestId('fa-cap-go').click();
  await expect(acc.page.getByTestId('fa-asset')).toHaveAttribute('data-status', 'SUBMITTED');
  // the CFO approves on the asset page
  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.company });
  const id = new URL(acc.page.url()).searchParams.get('id');
  await cfo.page.goto(`/finance/assets?id=${id}`);
  await cfo.page.getByTestId('fa-decide-approve').click();
  await expect(cfo.page.getByTestId('fa-asset')).toHaveAttribute('data-state', 'IN_USE');
  if (phone) await noOverflow(cfo.page);
  // last month's depreciation, run once
  await acc.page.goto('/finance/asset-accounting?step=depreciation');
  await acc.page.getByTestId('fa-dep-run').click();
  await expect(acc.page.getByTestId('fa-dep-done')).toBeVisible();
  if (phone) await noOverflow(acc.page);
  await acc.page.goto('/finance/assets');
  await expect(acc.page.getByText('Excavator Tata Hitachi EX200').first()).toBeVisible();
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'asset-register');
  await acc.page.goto(`/finance/assets?id=${id}`);
  await expect(acc.page.getByTestId('fa-schedule')).toContainText('Posted');
  if (phone) await noOverflow(acc.page);
  await acc.context.close(); await cfo.context.close();
});
