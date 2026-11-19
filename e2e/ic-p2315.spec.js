import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 23.15 in the browser (ff.fin.p2315 ON in test), desktop and 360 px phone:
//  AC-01 a charge raised by the parent's accounts manager, approved by a second accounts manager, accepted by the subsidiary's accounts manager with the account
//  and cost centre of its side (the mirror posted in both companies), reconciled, and eliminated in the consolidated statements; AC-07 no overflow at 360 px.
//  Screenshots (docs/erp/screenshots/23.15).
const SHOTS = 'docs/erp/screenshots/23.15';
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
  const mk = async (c) => { const id = (await post('/iam/org/companies', 'SYSADM', 1, { code: c, legalName: `${c} Infra Pvt Ltd`, shortName: c })).id; const fy = await request.post('/api/v1/core/financial-years', { headers: H('SYSADM', id, 'e2e-setup'), data: { startDate: '2026-04-01' } }); expect(fy.status(), await fy.text()).toBeLessThan(300);
    const opt = await request.get('/api/v1/fin/journals/options', { headers: H('FINEX', id, 'e2e-fin') }); expect(opt.status()).toBe(200); return id; };
  const parent = await mk(code); const sub = await mk(`${code}S`); const low = code.toLowerCase();
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF'); let cc;
  try {
    for (const [c, u, r] of [[parent, `${low}-acc`, 'ACCMGR'], [parent, `${low}-acc2`, 'ACCMGR'], [parent, `${low}-cfo`, 'CFO'], [sub, `${low}-sacc`, 'ACCMGR']]) fill(db, 'iam_users', { company_id: c, username: u, display_name: u, roles_json: JSON.stringify([r]), email: `${u}@example.com`, status: 'ACTIVE' });
    cc = fill(db, 'org_cost_centres', { company_id: sub, code: `${code}CC`, name: 'Head office', type: 'COST', status: 'ACTIVE' });
  } finally { db.close(); }
  await post('/fin/ic-relationships', 'CFO', parent, { counterpartCompanyId: sub, type: 'SUBSIDIARY', holdingPct: 100 }, `${low}-cfo`);
  return { parent, sub, cc, acc: `${low}-acc`, acc2: `${low}-acc2`, cfo: `${low}-cfo`, sacc: `${low}-sacc` };
}

test('AC-01 a charge mirrored in both companies, reconciled and eliminated in the consolidated statements on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'ICM' : 'ICD');
  const acc = await as(browser, info, { user: w.acc, roles: 'ACCMGR', company: w.parent });
  await acc.page.goto('/finance/inter-company'); await acc.page.getByTestId('ic-new-btn').click();
  await acc.page.getByTestId('ic-new-cp').selectOption(String(w.sub)); await acc.page.getByTestId('ic-new-amount').fill('125000');
  await acc.page.getByTestId('ic-new-account').selectOption({ label: '420001 Interest income' }).catch(async () => { const o = await acc.page.getByTestId('ic-new-account').locator('option', { hasText: '420001' }).first().getAttribute('value'); await acc.page.getByTestId('ic-new-account').selectOption(o); });
  await acc.page.getByTestId('ic-new-desc').fill('Head office services for October'); await acc.page.getByTestId('ic-new-save').click();
  await expect(acc.page.getByTestId('ic-txn')).toHaveAttribute('data-status', 'DRAFT'); await acc.page.getByTestId('ic-submit').click(); await expect(acc.page.getByTestId('ic-txn')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(acc.page.url()).searchParams.get('id');
  const acc2 = await as(browser, info, { user: w.acc2, roles: 'ACCMGR', company: w.parent }); await acc2.page.goto(`/finance/inter-company?id=${id}`); await acc2.page.getByTestId('ic-decide-approve').click();
  await expect(acc2.page.getByTestId('ic-txn')).toHaveAttribute('data-state', 'AWAITING_COUNTERPART');
  const sacc = await as(browser, info, { user: w.sacc, roles: 'ACCMGR', company: w.sub }); await sacc.page.goto('/finance/inter-company'); await sacc.page.getByTestId('ic-side-in').click(); await expect(sacc.page.getByTestId('ic-list')).toContainText('1,25,000');
  if (phone) await noOverflow(sacc.page);
  await shot(sacc.page, info, 'inter-company-transactions');
  await sacc.page.goto(`/finance/inter-company?id=${id}`); const o = await sacc.page.getByTestId('ic-accept-account').locator('option', { hasText: '560005' }).first().getAttribute('value'); await sacc.page.getByTestId('ic-accept-account').selectOption(o);
  await sacc.page.getByTestId('ic-accept-cc').selectOption(String(w.cc)); await sacc.page.getByTestId('ic-accept-save').click(); await expect(sacc.page.getByTestId('ic-txn')).toHaveAttribute('data-state', 'POSTED'); await expect(sacc.page.getByTestId('ic-mirror')).toContainText('230090');
  await acc.page.goto('/finance/ic-reconciliation'); await expect(acc.page.getByTestId('icr-pairs')).toContainText('Matched');
  const cfo = await as(browser, info, { user: w.cfo, roles: 'CFO', company: w.parent }); await cfo.page.goto('/finance/consolidation'); await cfo.page.getByTestId('con-period').fill(new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7));
  await expect(cfo.page.getByTestId('con-check')).toContainText('net to zero'); await expect(cfo.page.getByTestId('con-elim')).toContainText('2,50,000');
  if (phone) await noOverflow(cfo.page);
  await shot(cfo.page, info, 'consolidated-statements');
  await acc.context.close(); await acc2.context.close(); await sacc.context.close(); await cfo.context.close();
});
