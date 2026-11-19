import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.13 in the browser (ff.fin.p2313 ON in test), desktop and 360 px phone:
//  AC-01 the treasury's cash position from the bank ledger; this week's 13-week forecast prepared from the source modules by the accounts manager, adjusted
//  with its reason, a scenario chosen, sent and published by the CFO; the published forecast on the treasury; the project cash curve; AC-07 no overflow at
//  360 px. Screenshots (docs/erp/screenshots/23.13).
const SHOTS = 'docs/erp/screenshots/23.13';
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
    fill(db, 'fin_bank_accounts', { company_id: company, code: `${code}B`, name: 'HDFC current', bank_name: 'HDFC Bank', ifsc: 'HDFC0000001', account_no_enc: 'x', account_last4: '4321', gl_account_id: acct('150002') });
    const jv = (date, lines) => { n += 1; const j = fill(db, 'fin_journals', { company_id: company, doc_no: `JV/${code}/${n}`, voucher_no: `JV/${code}/${n}`, voucher_type: 'JV', voucher_date: date, kind: 'MANUAL', narration: 'e2e', total_paise: lines.reduce((a, l) => a + l[1], 0), status: 'APPROVED' }); lines.forEach(([c, dr, cr, p], k) => fill(db, 'fin_journal_lines', { company_id: company, journal_id: j, line_no: k + 1, account_id: acct(c), debit_paise: dr, credit_paise: cr, project_id: p ?? null })); };
    jv('2026-10-01', [['150002', 100000000, 0], ['310001', 0, 100000000]]);
    jv('2026-10-20', [['150002', 30000000, 0, project], ['140001', 0, 30000000, project]]); jv('2026-10-25', [['510001', 12000000, 0, project], ['150002', 0, 12000000, project]]);
  } finally { db.close(); }
  return { company, project, acc: `${low}-acc`, cfo: `${low}-cfo` };
}

test('AC-01 the cash position, the forecast of this week adjusted and published by the CFO, the project cash curve on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'CFM' : 'CFD');
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.company });
  await acc.page.goto('/finance/treasury'); await expect(acc.page.getByTestId('tr-balance')).toContainText('11,80,000'); await expect(acc.page.getByTestId('tr-banks')).toContainText('HDFC current');
  await acc.page.getByTestId('cf-create').click(); await expect(acc.page.getByTestId('cf-forecast')).toHaveAttribute('data-status', 'DRAFT');
  await expect(acc.page.getByTestId('cf-weeks').locator('li')).toHaveCount(13);
  await acc.page.getByTestId('cf-adj-cat').selectOption('ADVANCE_IN'); await acc.page.getByTestId('cf-adj-amount').fill('250000'); await acc.page.getByTestId('cf-adj-reason').fill('Mobilisation advance agreed with the client');
  await acc.page.getByTestId('cf-adj-save').click(); await expect(acc.page.getByTestId('cf-closing')).toContainText('14,30,000');
  await acc.page.getByTestId('cf-scenario').selectOption('DELAYED_COLLECTIONS'); await expect(acc.page.getByTestId('cf-lowest')).toBeVisible();
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'cash-forecast-13-weeks');
  await acc.page.getByTestId('cf-submit').click(); await expect(acc.page.getByTestId('cf-forecast')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(acc.page.url()).searchParams.get('forecast');
  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.company }); await cfo.page.goto(`/finance/treasury?forecast=${id}`);
  await cfo.page.getByTestId('cf-decide-approve').click(); await expect(cfo.page.getByTestId('cf-forecast')).toHaveAttribute('data-status', 'APPROVED');
  await cfo.page.goto('/finance/treasury'); await expect(cfo.page.getByTestId('tr-forecast')).toContainText('14,30,000');
  if (phone) await noOverflow(cfo.page);
  await shot(cfo.page, info, 'treasury-cash-position');
  await cfo.page.goto(`/finance/cash-reports?projectId=${w.project}`); await expect(cfo.page.getByTestId('cr-peak')).toBeVisible();
  if (phone) await noOverflow(cfo.page);
  await shot(cfo.page, info, 'project-cash-curve');
  await acc.context.close(); await cfo.context.close();
});
