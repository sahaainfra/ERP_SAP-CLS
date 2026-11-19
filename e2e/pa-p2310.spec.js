import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.10 in the browser (ff.fin.p2310 ON in test), desktop and 360 px phone:
//  AC-01 a month's revenue recognised on the page by the project controls manager, approved by the accounts manager and the CFO, posted; the project trial
//  balance and WIP; AC-07 the pages without overflow at 360 px. Screenshots (docs/erp/screenshots/23.10).
const SHOTS = 'docs/erp/screenshots/23.10';
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
    for (const [u, r] of [[`${low}-pcm`, 'PCMGR'], [`${low}-acc`, 'ACCMGR'], [`${low}-cfo`, 'CFO']]) fill(db, 'iam_users', { company_id: company, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    fill(db, 'ctr_contracts', { company_id: company, org_project_id: project, doc_no: `K/${code}`, contract_no: `K-${code}`, title: 'Main works', contract_type: 'ITEM_RATE', original_paise: 100000000, revised_paise: 100000000, status: 'APPROVED', contract_state: 'ACTIVE' });
    fill(db, 'bud_budgets', { company_id: company, doc_no: `BUD/${code}`, org_project_id: project, version_no: 1, status: 'APPROVED', total_amount: 80000000, direct_total: 80000000 });
    const acct = (c) => db.prepare('SELECT id FROM fin_accounts WHERE company_id = ? AND code = ?').get(company, c).id; let n = 0;
    const jv = (date, lines) => { n += 1; const j = fill(db, 'fin_journals', { company_id: company, doc_no: `JV/${code}/${n}`, voucher_no: `JV/${code}/${n}`, voucher_type: 'JV', voucher_date: date, kind: 'MANUAL', narration: 'e2e', total_paise: lines[0][1], status: 'APPROVED' }); lines.forEach(([c, dr, cr], k) => fill(db, 'fin_journal_lines', { company_id: company, journal_id: j, line_no: k + 1, account_id: acct(c), debit_paise: dr, credit_paise: cr, project_id: project })); };
    jv('2026-10-10', [['510001', 20000000, 0], ['220001', 0, 20000000]]); jv('2026-10-20', [['140001', 30000000, 0], ['410001', 0, 30000000]]);
  } finally { db.close(); }
  return { company, project, pcm: `${low}-pcm`, acc: `${low}-acc`, cfo: `${low}-cfo` };
}

test('AC-01 a month recognised by the project controls manager, approved by the accounts manager and the CFO; project trial balance and WIP on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'RRM' : 'RRD');
  const pcm = await as(browser, info, { user: w.pcm, roles: 'PCMGR', company: w.company });
  await pcm.page.goto('/finance/revenue-recognition');
  await pcm.page.getByTestId('rr-period-input').fill('2026-10');
  await pcm.page.getByRole('radio').first().check();
  if (phone) await noOverflow(pcm.page);
  await shot(pcm.page, info, 'revenue-recognition-run-for-period');
  await pcm.page.getByTestId('rr-preview').click();
  await expect(pcm.page.getByTestId('rr-poc')).toContainText('25');
  await expect(pcm.page.getByTestId('rr-journal')).toContainText('230020');
  await pcm.page.getByTestId('rr-send').click();
  await expect(pcm.page.getByTestId('rr-record')).toBeVisible(); const id = new URL(pcm.page.url()).searchParams.get('id');
  for (const [u, r] of [[w.acc, 'ACCMGR'], [w.cfo, 'CFO']]) {
    const s = await as(browser, info, { user: u, roles: r, company: w.company }); await s.page.goto(`/finance/revenue-recognition?id=${id}`);
    await s.page.getByTestId('rr-approve').click(); await expect(s.page.getByTestId('rr-decide')).toHaveCount(0);
    if (r === 'CFO') { await expect(s.page.getByTestId('rr-journal')).toContainText('410090'); if (phone) await noOverflow(s.page); }
    await s.context.close();
  }
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.company });
  await acc.page.goto('/finance/project-accounts');
  await acc.page.getByTestId('pa-tb-project').selectOption(String(w.project));
  await expect(acc.page.getByTestId('pa-revenue')).toContainText('2,50,000');
  if (phone) await noOverflow(acc.page);
  await shot(acc.page, info, 'project-trial-balance');
  await acc.page.getByTestId('pa-tab-wip').click(); await acc.page.locator('input[type="month"]').fill('2026-10');
  await expect(acc.page.getByTestId('pa-wip')).toContainText('Billing in excess');
  if (phone) await noOverflow(acc.page);
  await pcm.context.close(); await acc.context.close();
});
