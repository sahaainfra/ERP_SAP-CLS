import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|ERR_INTERNET_DISCONNECTED|Cannot reach the server|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => { const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data }); expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') }); const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' }); return id;
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use; const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true }); const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) }); await page.goto(path); return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
// Part 18.07 in the browser (development-header mode, port 3100): the quality dashboard shows live KPI tiles with targets and exceptions, the control charts draw the X-bar and R limits of six concrete samples with the failing one flagged,
// and the ratings rank subcontractors and suppliers. Desktop and mobile.
const OUT = 'docs/erp/screenshots/qa-dash';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${Math.random().toString(36).slice(2, 8)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['qm', ['QCMGR']], ['pm', ['PM']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const A = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-A`, 'Tower A').lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Site 1', 'ACTIVE')").run(c, A, `${T}-S1`).lastInsertRowid);
  const partner = (n) => Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run(c, `P-${T}-${n}`, n, n).lastInsertRowid);
  const sub = partner('Alpha Finishers'); const supX = partner('Xcel Ready-Mix'); const supY = partner('Yash Concrete');
  for (const [status, result] of [['APPROVED', 'APPROVED'], ['APPROVED', 'APPROVED'], ['REJECTED', 'REJECTED']]) fill(db, 'qa_inspection_requests', { company_id: c, org_project_id: A, org_site_id: site, description: 'IR', requested_for: iso(-3), status, result });
  fill(db, 'qa_ncrs', { company_id: c, org_project_id: A, org_site_id: site, description: 'NCR', status: 'OPEN', severity: 'CRITICAL', responsible_type: 'SUBCONTRACTOR', responsible_id: sub });
  fill(db, 'qa_snags', { company_id: c, org_project_id: A, org_site_id: site, category: 'FINISHING', description: 'Snag', raised_by: 'x', status: 'CLOSED' }); fill(db, 'qa_snags', { company_id: c, org_project_id: A, org_site_id: site, category: 'FINISHING', description: 'Snag', raised_by: 'x', status: 'OPEN', due_date: iso(-2) });
  const card = fill(db, 'qa_pour_cards', { company_id: c, org_project_id: A, org_site_id: site, element: 'Footing', grade: 'M25', fck_mpa: 25, status: 'APPROVED' }); const tk = (v, n) => fill(db, 'qa_pour_tickets', { company_id: c, pour_card_id: card, ticket_no: `T-${T}-${n}`, vendor_id: v, qty: 5000, delivered_at: new Date().toISOString() });
  const tx = tk(supX, 1); const ty = tk(supY, 2); const data = [[28, 29, 30, tx], [29, 30, 31, tx], [30, 31, 32, tx], [27, 28, 29, ty], [28, 29, 30, ty], [19, 20, 21, ty]];
  data.forEach(([a, b, d, tt], i) => { const sample = fill(db, 'qa_cube_samples', { company_id: c, doc_no: `CUBE/${T}/${i}`, pour_card_id: card, ticket_id: tt, cubes_count: 3, cast_date: iso(-40 + i), due_7: iso(-33 + i), due_28: iso(-12 + i), qr_code: `ERP:CUBE:${T}${i}` }); const m = (a + b + d) / 3; fill(db, 'qa_cube_results', { company_id: c, sample_id: sample, age_days: 28, strengths_json: JSON.stringify([a, b, d]), mean_e3: Math.round(m * 1000), min_e3: Math.min(a, b, d) * 1000, tested_on: iso(-10 + i), acceptance: m >= 22 ? 'PASS' : 'FAIL' }); });
  db.close(); return { u: (k) => `${t}-${k}`, T, A };
}
test('Quality: dashboard KPIs and exceptions, control charts with limits and a flagged sample, ratings', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `q${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/qa/dashboard'); const p = pm.page; const errors = watch(p);
  await expect(p.getByTestId('qa-dashboard')).toBeVisible(); await expect(p.getByTestId('kpi-firstTimeIr-value')).toHaveText('66.7%'); await expect(p.getByTestId('kpi-firstTimeIr')).toHaveAttribute('data-status', 'red'); await expect(p.getByTestId('kpi-openNcr-value')).toHaveText('1'); await expect(p.getByTestId('kpi-cubeFail-value')).toHaveText('16.7%'); await expect(p.getByTestId('kpi-snagClosure-value')).toHaveText('50%');
  await expect(p.getByTestId('dash-exception').first()).toBeVisible(); await noOverflow(p); await shot(p, '1-dashboard', info); const dl = p.waitForEvent('download'); await p.getByTestId('dash-export').click(); expect((await dl).suggestedFilename()).toMatch(/quality-kpis/);
  await p.getByTestId('dash-project').selectOption(String(s.A)); await expect(p.getByTestId('kpi-openNcr-value')).toHaveText('1');
  const qm = await open(browser, info, c, 'QCMGR', s.u('qm'), '/qa/control-charts'); const q = qm.page; await expect(q.getByTestId('qa-control-charts')).toBeVisible(); await expect(q.getByTestId('cc-xbar')).toBeVisible(); await expect(q.getByTestId('cc-range')).toBeVisible(); await expect(q.getByTestId('cc-row')).toHaveCount(6); await expect(q.getByTestId('cc-summary')).toContainText('M25');
  await expect(q.locator('[data-testid="cc-row"][data-out="true"]')).toHaveCount(1); await noOverflow(q); await shot(q, '2-charts', info); await q.getByTestId('cc-supplier').selectOption({ index: 2 }); await expect(q.getByTestId('cc-row')).toHaveCount(3); await shot(q, '3-charts-supplier', info);
  await q.goto('/qa/ratings'); await expect(q.getByTestId('qa-ratings')).toBeVisible(); await expect(q.getByTestId('rt-row')).toHaveCount(1); await expect(q.getByTestId('rt-row')).toHaveAttribute('data-score', '90'); await q.getByTestId('rt-by-supplier').click(); await expect(q.getByTestId('rt-row')).toHaveCount(2); await expect(q.getByTestId('rt-row').first()).toContainText('Yash'); await noOverflow(q); await shot(q, '4-ratings', info);
  expect(errors, errors.join('\n')).toEqual([]);
});
