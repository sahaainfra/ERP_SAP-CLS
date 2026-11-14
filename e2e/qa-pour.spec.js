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
// Part 18.05 in the browser (development-header mode, port 3100): a pour card is made on the phone layout, linked to three approved inspection requests and the pre-pour checks, approved by the quality engineer and the construction manager; the pour is recorded with a ticket and a
// cube sample with its QR label; a failing 28-day result is raised as an NCR; acceptance and traceability pages show it. Desktop and mobile.
const OUT = 'docs/erp/screenshots/qa-pour';
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
  for (const [n, roles] of [['se', ['SE']], ['qe', ['QCE']], ['cm', ['CM']], ['qm', ['QCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const A = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-A`, 'Tower A').lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Site 1', 'ACTIVE')").run(c, A, `${T}-S1`).lastInsertRowid);
  const sch = fill(db, 'plan_schedules', { company_id: c, org_project_id: A, status: 'APPROVED', doc_no: `SCH/${T}` }); const act = fill(db, 'plan_activities', { company_id: c, schedule_id: sch, code: `${T}-1`, name: 'Footing concrete', duration_days: 5 });
  db.close(); return { u: (k) => `${t}-${k}`, T, A, site, act };
}
const wfAct = async (request, c, role, user, instanceId, action = 'approve') => { const tasks = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H(role, c, user) })).json()).data.rows; const task = tasks.find((x) => x.instance.id === instanceId); expect(task, `${user} has the task`).toBeTruthy(); await api(request, c, role, user, 'post', `/workflow/tasks/${task.id}/act`, { action }); };
const decide = async (browser, info, c, role, user, url) => { const a = await open(browser, info, c, role, user, url); await expect(a.page.getByTestId('qa-decide')).toBeVisible(); await a.page.getByTestId('qa-approve').click(); await expect(a.page.getByTestId('qa-note')).toBeVisible(); await a.context.close(); };
test('Quality: pour card with approved inspections, pour and cubes, a failing result raised as an NCR, acceptance and traceability', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `c${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  for (let i = 0; i < 3; i += 1) { const ir = await api(request, c, 'SE', s.u('se'), 'post', '/qa/inspection-requests', { projectId: s.A, activityId: s.act, pointType: 'HOLD', description: `Pre-pour inspection ${i + 1}`, requestedFor: iso(1), submit: true }); await api(request, c, 'QCE', s.u('qe'), 'post', `/qa/inspection-requests/${ir.id}/assess`, {}); await wfAct(request, c, 'QCE', s.u('qe'), ir.workflowInstanceId); }
  const se = await open(browser, info, c, 'SE', s.u('se'), '/qa/pour-cards?new=1'); const p = se.page; const errors = watch(p);
  await expect(p.getByTestId('qa-pour-new')).toBeVisible(); await p.getByTestId('pcn-project').selectOption(String(s.A)); await p.getByTestId('pcn-element').fill('Footing F1'); await p.getByTestId('pcn-volume').fill('12.5'); await noOverflow(p); await p.getByTestId('pcn-save').click();
  await expect(p.getByTestId('qa-pour-object')).toHaveAttribute('data-status', 'DRAFT'); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  await expect(p.getByTestId('pc-edit')).toBeVisible(); for (const k of ['REINFORCEMENT', 'SHUTTERING', 'EMBEDMENT']) { const sel = p.getByTestId(`pc-ir-${k}`); const idx = { REINFORCEMENT: 1, SHUTTERING: 2, EMBEDMENT: 3 }[k]; await sel.selectOption({ index: idx }); }
  for (const k of ['REBAR', 'COVER', 'SHUTTERING', 'CLEANING', 'EMBEDMENTS', 'EQUIPMENT', 'CURING']) await p.getByTestId(`pc-check-${k}`).selectOption('YES'); await noOverflow(p); await shot(p, '1-card', info); await p.getByTestId('pc-save').click(); await expect(p.getByTestId('pc-note')).toBeVisible();
  await p.getByTestId('qa-submit').click(); await expect(p.getByTestId('qa-pour-object')).toHaveAttribute('data-status', 'SUBMITTED'); await decide(browser, info, c, 'QCE', s.u('qe'), url); await decide(browser, info, c, 'CM', s.u('cm'), url);
  await p.reload(); await expect(p.getByTestId('qa-pour-object')).toHaveAttribute('data-status', 'APPROVED'); await p.getByTestId('tk-no').fill('RMC-3001'); await p.getByTestId('tk-batch').fill('B-501'); await p.getByTestId('tk-truck').fill('RJ14-3333'); await p.getByTestId('tk-qty').fill('12.5'); await p.getByTestId('tk-slump').fill('105'); await p.getByTestId('tk-add').click(); await expect(p.getByTestId('pc-ticket')).toHaveCount(1);
  await p.getByTestId('cu-ticket').selectOption({ index: 1 }); await p.getByTestId('cu-add').click(); await expect(p.getByTestId('pc-sample')).toHaveCount(1); await p.getByTestId('pc-complete').click(); await expect(p.getByTestId('qa-pour-object')).toHaveAttribute('data-pour', 'COMPLETED'); await noOverflow(p); await shot(p, '2-poured', info);
  const qe = await open(browser, info, c, 'QCE', s.u('qe'), '/qa/cubes'); await expect(qe.page.getByTestId('qa-cubes')).toBeVisible(); await noOverflow(qe.page); await shot(qe.page, '3-register', info); await qe.page.getByRole('link', { name: /CUBE/ }).first().click(); await expect(qe.page.getByTestId('qa-cube-object')).toBeVisible(); await expect(qe.page.getByTestId('cube-qr')).toBeVisible();
  await qe.page.getByTestId('cube-age').selectOption('28'); await qe.page.getByTestId('cube-strengths').fill('19 20 21'); await qe.page.getByTestId('cube-save').click(); await expect(qe.page.locator('[data-testid="cube-result"][data-acceptance="FAIL"]')).toHaveCount(1); await noOverflow(qe.page); await shot(qe.page, '4-cube', info);
  await qe.page.getByTestId('cube-raise-ncr').click(); await expect(qe.page.getByTestId('qa-ncr-object')).toBeVisible();
  await qe.page.goto('/qa/concrete-acceptance'); await expect(qe.page.getByTestId('qa-acceptance')).toBeVisible(); await expect(qe.page.getByTestId('ca-group')).toHaveCount(1); await noOverflow(qe.page); await shot(qe.page, '5-acceptance', info);
  await qe.page.goto('/qa/concrete-traceability'); await qe.page.getByTestId('ct-q').fill('B-501'); await qe.page.getByTestId('ct-go').click(); await expect(qe.page.getByTestId('ct-pour')).toHaveCount(1); await expect(qe.page.getByTestId('ct-ticket').first()).toContainText('RJ14-3333'); await noOverflow(qe.page); await shot(qe.page, '6-trace', info);
  await p.goto('/qa/pour-cards'); await expect(p.getByTestId('qa-pours')).toBeVisible(); expect(errors, errors.join('\n')).toEqual([]);
});
