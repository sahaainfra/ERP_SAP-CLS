import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.12 in the browser (ff.fin.p2312 ON in test), desktop and 360 px phone:
//  AC-01 the project P&L of a month equal to the ledger, a line opened to its journal lines, the month's snapshot made by the accounts manager and frozen by the
//  CFO; the profitability overview; AC-07 the pages without overflow at 360 px. Screenshots (docs/erp/screenshots/23.12).
const SHOTS = 'docs/erp/screenshots/23.12';
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
    const jv = (date, lines) => { n += 1; const j = fill(db, 'fin_journals', { company_id: company, doc_no: `JV/${code}/${n}`, voucher_no: `JV/${code}/${n}`, voucher_type: 'JV', voucher_date: date, kind: 'MANUAL', narration: 'e2e', total_paise: lines.reduce((a, l) => a + l[1], 0), status: 'APPROVED' }); lines.forEach(([c, dr, cr], k) => fill(db, 'fin_journal_lines', { company_id: company, journal_id: j, line_no: k + 1, account_id: acct(c), debit_paise: dr, credit_paise: cr, project_id: project })); };
    jv('2026-10-05', [['140001', 50000000, 0], ['410001', 0, 50000000]]); jv('2026-10-06', [['510001', 20000000, 0], ['560001', 10000000, 0], ['560004', 2000000, 0], ['220001', 0, 32000000]]);
  } finally { db.close(); }
  return { company, project, acc: `${low}-acc`, cfo: `${low}-cfo` };
}

test('AC-01 the project P&L equal to the ledger, drilled to its journal lines, its snapshot frozen; the profitability overview on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'PLM' : 'PLD');
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.company });
  await acc.page.goto('/finance/project-pl'); await acc.page.getByTestId('pl-project').selectOption(String(w.project)); await acc.page.getByTestId('pl-period').fill('2026-10');
  await expect(acc.page.getByTestId('pl-revenue')).toContainText('5,00,000'); await expect(acc.page.getByTestId('pl-recon')).toContainText('Yes');
  await acc.page.getByTestId('pl-lines').getByRole('button', { name: /Material/ }).click(); await expect(acc.page.getByTestId('pl-drill')).toContainText('2,00,000');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'project-p-l');
  await acc.page.getByTestId('pl-snap').click(); await expect(acc.page.getByTestId('pl-snapshot')).toHaveAttribute('data-status', 'DRAFT');
  await acc.page.getByTestId('pl-submit').click(); await expect(acc.page.getByTestId('pl-snapshot')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(acc.page.url()).searchParams.get('snapshot');
  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.company }); await cfo.page.goto(`/finance/project-pl?snapshot=${id}`);
  await cfo.page.getByTestId('pl-decide-approve').click(); await expect(cfo.page.getByTestId('pl-snapshot')).toHaveAttribute('data-status', 'APPROVED');
  await expect(cfo.page.getByTestId('pl-snap-recon')).toContainText('Yes');
  await cfo.page.goto('/finance/profitability'); await cfo.page.locator('input[type="date"]').first().fill('2026-10-01');
  await expect(cfo.page.getByTestId('pf-revenue')).toContainText('5,00,000'); await expect(cfo.page.getByTestId('pf-segments')).toContainText('BUILDING');
  if (phone) await noOverflow(cfo.page);
  await shot(cfo.page, info, 'profitability-overview-by-project-segmen');
  await acc.context.close(); await cfo.context.close();
});
