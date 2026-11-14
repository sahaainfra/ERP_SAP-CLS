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
// Part 17.08 in the browser (development-header mode, port 3100): the capacity heat-map shows a shortage of masons in one project and a surplus in another, the shortage report points to the surplus, a plan that moves masons is evaluated,
// saved, sent and approved by the project controls manager, the project directors and the director, and raises its requests. Desktop and mobile.
const OUT = 'docs/erp/screenshots/plant-capacity';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const plus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const monday = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10); }; const W0 = monday(today); const wk = (n) => new Date(Date.parse(`${W0}T00:00:00Z`) + n * 7 * 86_400_000).toISOString().slice(0, 10);
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${Math.random().toString(36).slice(2, 8)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}





async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['pc', ['PCMGR']], ['pl', ['PLANTMGR']], ['d1', ['PD']], ['d2', ['PD']], ['di', ['DIR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const proj = (code) => Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-${code}`, `Tower ${code}`).lastInsertRowid); const A = proj('A'); const B = proj('B');
  const sch = fill(db, 'plan_schedules', { company_id: c, org_project_id: A, status: 'APPROVED', doc_no: `SCH/${T}` }); const act = fill(db, 'plan_activities', { company_id: c, schedule_id: sch, code: `${T}-1`, name: 'Frame', es: W0, ef: wk(10), duration_days: 70 });
  fill(db, 'plan_activity_resources', { company_id: c, schedule_id: sch, activity_id: act, resource_type: 'LABOUR', trade: 'MASON', res_key: 'labour:mason', label: 'Mason', uom: 'nos', basis: 'PER_DAY', qty_per_day: 10000, qty_total: 0 });
  for (let i = 0; i < 4; i += 1) fill(db, 'hr_deployments', { company_id: c, person_type: 'WORKER', person_id: fill(db, 'lab_workers', { company_id: c, worker_code: `${T}A${i}`, name: `A${i}`, trade_code: 'MASON', worker_status: 'ACTIVE' }), dep_project_id: A, from_date: plus(-30), to_date: null, status: 'APPROVED' });
  for (let i = 0; i < 12; i += 1) fill(db, 'hr_deployments', { company_id: c, person_type: 'WORKER', person_id: fill(db, 'lab_workers', { company_id: c, worker_code: `${T}B${i}`, name: `B${i}`, trade_code: 'MASON', worker_status: 'ACTIVE' }), dep_project_id: B, from_date: plus(-30), to_date: null, status: 'APPROVED' });
  db.close(); return { u: (k) => `${t}-${k}`, T, A, B };
}
test('Plant capacity: the heat-map, the shortage and surplus report, a move plan evaluated and approved by four levels, and its requests', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `n${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const pl = await open(browser, info, c, 'PLANTMGR', s.u('pl'), '/plant/capacity'); const p = pl.page; const errors = watch(p);
  await expect(p.getByTestId('plant-capacity')).toBeVisible(); const rowA = p.locator(`[data-testid="cp-row"][data-project="${s.T}-A"]`); await expect(rowA).toHaveCount(1); await expect(rowA.getByTestId('cp-cell').first()).toHaveAttribute('data-gap', '-6'); const rowB = p.locator(`[data-testid="cp-row"][data-project="${s.T}-B"]`); await expect(rowB.getByTestId('cp-cell').first()).toHaveAttribute('data-gap', '12'); await expect(p.getByTestId('cp-tile-shortage')).toContainText('48'); await noOverflow(p); await shot(p, '1-heatmap', info);
  await p.goto('/plant/shortage-surplus'); await expect(p.getByTestId('sh-row').first()).toContainText(`${s.T}-B`); await noOverflow(p); await shot(p, '2-shortage', info); const dl = p.waitForEvent('download'); await p.getByTestId('sh-export').click(); expect((await dl).suggestedFilename()).toMatch(/shortages/);
  await p.goto('/plant/resource-plans?new=1'); await p.getByTestId('rn-name').fill('Masons to tower A'); await p.getByTestId('rn-key').selectOption('MASON'); await p.getByTestId('rn-qty').fill('6'); await p.getByTestId('rn-from').selectOption(String(s.B)); await p.getByTestId('rn-to').selectOption(String(s.A)); await p.getByTestId('rn-add').click(); await expect(p.getByTestId('rn-actions')).toBeVisible(); await p.getByTestId('rn-evaluate').click(); await expect(p.getByTestId('rp-after')).toHaveText('0'); await expect(p.getByTestId('rp-before')).not.toHaveText('0'); await noOverflow(p); await shot(p, '3-plan-effect', info);
  await p.getByTestId('rn-save').click(); await expect(p.getByTestId('rpl-object')).toHaveAttribute('data-status', 'DRAFT'); const url = p.url().replace(/^https?:\/\/[^/]+/, ''); await p.getByTestId('rpl-submit').click(); await expect(p.getByTestId('rpl-object')).toHaveAttribute('data-status', 'SUBMITTED');
  for (const [role, user] of [['PCMGR', s.u('pc')], ['PD', s.u('d1')], ['PD', s.u('d2')], ['DIR', s.u('di')]]) { const a = await open(browser, info, c, role, user, url); await expect(a.page.getByTestId('rpl-decide')).toBeVisible(); await a.page.getByTestId('rpl-approve').click(); await expect(a.page.getByTestId('rpl-note')).toBeVisible(); await a.context.close(); }
  await p.goto(url); await expect(p.getByTestId('rpl-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('rpl-requests')).toContainText('07.03'); await noOverflow(p); await shot(p, '4-approved', info); await p.goto('/plant/resource-plans'); await expect(p.getByTestId('plant-resource-plans')).toBeVisible(); await noOverflow(p); await shot(p, '5-list', info); await pl.context.close();
  const none = await open(browser, info, c, 'SK', 'nobody', '/plant/capacity'); await expect(none.page.getByText('plant.capacity.view')).toBeVisible(); await none.context.close();
  expect(errors).toEqual([]);
});
