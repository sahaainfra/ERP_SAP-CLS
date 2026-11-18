import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.14 in the browser (ff.fin.p2314 ON in test), desktop and 360 px phone:
//  AC-01 the close of a month: the board of its checklist (a column at a time on the phone), the other modules locked, the tasks done with their evidence, sent
//  by the accounts manager (GL soft-closed) and closed by the CFO (every module closed); the statements balanced and tied to the ledger; the finance dashboard
//  reconciled; AC-07 no overflow at 360 px. Screenshots (docs/erp/screenshots/23.14).
const SHOTS = 'docs/erp/screenshots/23.14';
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
  const low = code.toLowerCase(); const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  try {
    for (const [u, r] of [[`${low}-acc`, 'ACCMGR'], [`${low}-cfo`, 'CFO']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    const acct = (c) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ?').get(company, c).id; let n = 0;
    const jv = (date, lines) => { n += 1; const j = fill(db, 'fin_journals', { company_id: company, doc_no: `JV/${code}/${n}`, voucher_no: `JV/${code}/${n}`, voucher_type: 'JV', voucher_date: date, kind: 'MANUAL', narration: 'e2e', total_paise: lines.reduce((a, l) => a + l[1], 0), status: 'APPROVED' }); lines.forEach(([c, dr, cr, p], k) => fill(db, 'fin_journal_lines', { company_id: company, journal_id: j, line_no: k + 1, account_id: acct(c), debit_paise: dr, credit_paise: cr, project_id: p ?? null })); };
    jv('2026-09-01', [['150002', 100000000, 0], ['310001', 0, 100000000]]);
    jv('2026-10-12', [['150002', 50000000, 0, project], ['410001', 0, 50000000, project]]); jv('2026-10-20', [['510001', 20000000, 0, project], ['150002', 0, 20000000, project]]);
  } finally { db.close(); }
  return { company, project, acc: `${low}-acc`, cfo: `${low}-cfo` };
}

test('AC-01 the month closed through its checklist and locks, the statements and the dashboard on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'CLM' : 'CLD');
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.company });
  await acc.page.goto('/finance/close'); await acc.page.getByTestId('pc-period').fill('2026-10'); await acc.page.getByTestId('pc-create').click();
  await expect(acc.page.getByTestId('pc-close')).toHaveAttribute('data-status', 'DRAFT'); await expect(acc.page.getByTestId('pc-tb')).toContainText('Balanced');
  await acc.page.getByTestId('pc-lock').click(); await expect(acc.page.getByTestId('pc-modules')).toContainText('Stores: Soft-closed');
  const id = new URL(acc.page.url()).searchParams.get('id');
  // the first task through the page (on the phone, its column is the one shown), the rest through the API with their evidence
  await acc.page.getByTestId('pc-done-STORES').click(); await acc.page.getByTestId('pc-save-STORES').click(); await expect(acc.page.getByTestId('pc-task-STORES')).toHaveAttribute('data-status', 'DONE', { timeout: 10_000 }).catch(async () => { if (phone) { await acc.page.getByTestId('pc-pill-DONE').click(); await expect(acc.page.getByTestId('pc-task-STORES')).toHaveAttribute('data-status', 'DONE'); } else throw new Error('not done'); });
  const get = async () => (await (await request.get(`/api/v1/fin/periods/${id}`, { headers: H('ACCMGR', w.company, w.acc) })).json()).data;
  for (const code of ['PAYROLL', 'DEPRECIATION', 'REVREC', 'ACCRUALS', 'BANK_RECON', 'GST_RECON', 'SUBLEDGER', 'MODULE_LOCKS', 'TB_REVIEW']) {
    const t = (await get()).tasks.find((x) => x.code === code); const res = await request.post(`/api/v1/fin/periods/${id}/tasks/${t.id}/complete`, { headers: H('ACCMGR', w.company, w.acc), data: { note: `Reviewed for October: ${code.toLowerCase()} in order` } }); expect(res.status(), `${code}: ${await res.text()}`).toBe(200);
  }
  await acc.page.reload(); if (phone) await acc.page.getByTestId('pc-pill-DONE').click(); await expect(acc.page.getByTestId('pc-col-DONE')).toContainText('Trial balance balanced');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'close-checklist-with-dependencies');
  await acc.page.getByTestId('pc-submit').click(); await expect(acc.page.getByTestId('pc-close')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(acc.page.getByTestId('pc-close')).toHaveAttribute('data-state', 'SOFT_CLOSED');
  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.company }); await cfo.page.goto(`/finance/close?id=${id}`);
  await cfo.page.getByTestId('pc-decide-approve').click(); await expect(cfo.page.getByTestId('pc-close')).toHaveAttribute('data-state', 'CLOSED'); await expect(cfo.page.getByTestId('pc-modules')).toContainText('Finance (GL): Closed');
  await cfo.page.goto('/finance/statements?period=2026-10'); await expect(cfo.page.getByTestId('st-balanced')).toContainText('Balanced'); await expect(cfo.page.getByTestId('st-assets')).toContainText('13');
  await cfo.page.getByTestId('st-tab-PL').click(); await expect(cfo.page.getByTestId('st-PL')).toContainText('Revenue from operations');
  if (phone) await noOverflow(cfo.page);
  await shot(cfo.page, info, 'financial-statements');
  await cfo.page.goto('/finance/dashboard'); await cfo.page.getByTestId('db-period').fill('2026-10'); await expect(cfo.page.getByTestId('db-revenue')).toContainText('5'); await expect(cfo.page.getByTestId('db-reconciled')).toContainText('Reconciled');
  if (phone) await noOverflow(cfo.page);
  await shot(cfo.page, info, 'finance-dashboard');
  await cfo.page.goto('/finance/year-end'); await expect(cfo.page.getByTestId('ye-steps')).toContainText('Every month closed');
  if (phone) await noOverflow(cfo.page);
  await acc.context.close(); await cfo.context.close();
});
