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
// Part 18.02 in the browser (development-header mode, port 3100): an ITP hold point is requested from the phone layout, approved by the quality engineer and released; a witness point is rejected with a reason and shows the re-inspection link;
// the rejection analysis counts it. Desktop and mobile.
const OUT = 'docs/erp/screenshots/qa-ir';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${Math.random().toString(36).slice(2, 8)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['se', ['SE']], ['qe', ['QCE']], ['qm', ['QCMGR']], ['q2', ['QCE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const A = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-A`, 'Tower A').lastInsertRowid);
  const sch = fill(db, 'plan_schedules', { company_id: c, org_project_id: A, status: 'APPROVED', doc_no: `SCH/${T}` }); const a1 = fill(db, 'plan_activities', { company_id: c, schedule_id: sch, code: `${T}-1`, name: 'Footing concrete', duration_days: 5 }); const a2 = fill(db, 'plan_activities', { company_id: c, schedule_id: sch, code: `${T}-2`, name: 'Column concrete', duration_days: 5 });
  fill(db, 'plan_dependencies', { company_id: c, schedule_id: sch, pred_id: a1, succ_id: a2 }); db.close(); return { u: (k) => `${t}-${k}`, T, A, a1, a2 };
}
const decide = async (browser, info, c, role, user, url, act, pick) => { const a = await open(browser, info, c, role, user, url); await expect(a.page.getByTestId('qa-ir-object')).toBeVisible(); if (pick) await a.page.getByTestId('ir-reason').selectOption(pick); await expect(a.page.getByTestId('qa-decide')).toBeVisible(); if (act !== 'qa-approve') await a.page.getByTestId('qa-comment').fill('Honeycombing at the corner'); await a.page.getByTestId(act).click(); await expect(a.page.getByTestId('qa-note')).toBeVisible(); await a.context.close(); };
test('Quality: an inspection request releases a hold point; a rejection keeps its reason and asks for a re-inspection', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `r${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const q = (path, method = 'get', data) => api(request, c, 'QCE', s.u('qe'), method, path, data); const qm = (path, method = 'get', data) => api(request, c, 'QCMGR', s.u('qm'), method, path, data);
  const itp = await q('/qa/itps', 'post', { code: 'ITP-RCC', title: 'RCC footing', activityType: 'RCC', steps: [{ code: 'S1', seq: 1, description: 'Check formwork and cover', pointType: 'HOLD' }, { code: 'S2', seq: 2, description: 'Witness slump', pointType: 'WITNESS' }] });
  await q(`/qa/itps/${itp.id}/submit`, 'post'); const inst = (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H('QCMGR', c, s.u('qm')) })).ok(); expect(inst).toBeTruthy();
  const tasks = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H('QCMGR', c, s.u('qm')) })).json()).data.rows; await api(request, c, 'QCMGR', s.u('qm'), 'post', `/workflow/tasks/${tasks[0].id}/act`, { action: 'approve' }); await q(`/qa/itps/${itp.id}/apply`, 'post', { projectId: s.A, activityIds: [s.a1] });
  const se = await open(browser, info, c, 'SE', s.u('se'), '/qa/inspection-requests/new'); const p = se.page; const errors = watch(p);
  await expect(p.getByTestId('qa-ir-raise')).toBeVisible(); await p.getByTestId('irr-project').selectOption(String(s.A)); await p.getByTestId('irr-point').selectOption({ index: 1 }); await noOverflow(p); await shot(p, '1-raise', info); await p.getByTestId('irr-send').click();
  await expect(p.getByTestId('qa-ir-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url1 = p.url().replace(/^https?:\/\/[^/]+/, '');
  const gate0 = await q(`/qa/hold-points/check?activityId=${s.a2}`); expect(gate0.eligible).toBe(false);
  await decide(browser, info, c, 'QCE', s.u('q2'), url1, 'qa-approve', null); await p.reload(); await expect(p.getByTestId('qa-ir-object')).toHaveAttribute('data-result', 'APPROVED'); await noOverflow(p); await shot(p, '2-approved', info);
  expect((await q(`/qa/hold-points/check?activityId=${s.a2}`)).eligible).toBe(true);
  await p.goto('/qa/inspection-requests/new'); await p.getByTestId('irr-project').selectOption(String(s.A)); await p.getByTestId('irr-point').selectOption({ index: 1 }); await p.getByTestId('irr-send').click(); await expect(p.getByTestId('qa-ir-object')).toHaveAttribute('data-status', 'SUBMITTED'); const url2 = p.url().replace(/^https?:\/\/[^/]+/, '');
  await decide(browser, info, c, 'QCE', s.u('q2'), url2, 'qa-reject', 'WORKMANSHIP'); await p.reload(); await expect(p.getByTestId('qa-ir-object')).toHaveAttribute('data-result', 'REJECTED'); await expect(p.getByTestId('ir-needs-reinspection')).toBeVisible(); await noOverflow(p); await shot(p, '3-rejected', info);
  await p.goto('/qa/inspection-requests'); await expect(p.getByTestId('qa-irs')).toBeVisible(); await noOverflow(p); await shot(p, '4-register', info);
  const qmPage = await open(browser, info, c, 'QCMGR', s.u('qm'), '/qa/ir-analysis'); await expect(qmPage.page.getByTestId('qa-ir-analysis')).toBeVisible(); await expect(qmPage.page.getByTestId('ira-reason-row').first()).toContainText('Workmanship'); await noOverflow(qmPage.page); await shot(qmPage.page, '5-analysis', info);
  expect(errors, errors.join('\n')).toEqual([]); void qm;
});
