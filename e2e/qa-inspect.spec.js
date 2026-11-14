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
// Part 18.01 in the browser (development-header mode, port 3100): a checklist template is designed with a numeric tolerance and a photo-required question, previewed, sent and approved; an ITP is made, approved and applied to an activity;
// an inspection is performed on the phone layout with an out-of-tolerance reading and a photograph, sent, and approved by the quality control manager. Desktop and mobile.
const OUT = 'docs/erp/screenshots/qa-inspect';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql; const names = []; const params = [];
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `x${Math.random().toString(36).slice(2, 8)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['qe', ['QCE']], ['qm', ['QCMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const A = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-A`, 'Tower A').lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (?, ?, ?, 'Site 1')").run(c, A, `${T}-S1`).lastInsertRowid);
  const sch = fill(db, 'plan_schedules', { company_id: c, org_project_id: A, status: 'APPROVED', doc_no: `SCH/${T}` }); fill(db, 'plan_activities', { company_id: c, schedule_id: sch, code: `${T}-1`, name: 'Footing concrete', duration_days: 5 });
  db.close(); return { u: (k) => `${t}-${k}`, T, A, site };
}
const decide = async (browser, info, c, user, url) => { const a = await open(browser, info, c, 'QCMGR', user, url); await expect(a.page.getByTestId('qa-decide')).toBeVisible(); await a.page.getByTestId('qa-approve').click(); await expect(a.page.getByTestId('qa-note')).toBeVisible(); await a.context.close(); };
test('Quality: template designer with preview, ITP applied to an activity, an inspection performed with a failing reading and approved', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `q${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const qe = await open(browser, info, c, 'QCE', s.u('qe'), '/qa/templates?new=1'); const p = qe.page; const errors = watch(p);
  await expect(p.getByTestId('qa-template-designer')).toBeVisible(); await p.getByTestId('tpl-code').fill('PRE-POUR'); await p.getByTestId('tpl-name').fill('Pre-pour check');
  await p.getByTestId('tpl-section-title').fill('Formwork and steel'); const q = p.getByTestId('tpl-question'); await p.getByTestId('tpl-add-question').click(); await p.getByTestId('tpl-add-question').click(); await expect(q).toHaveCount(3);
  await q.nth(0).getByTestId('q-text').fill('Cover blocks placed'); await q.nth(1).getByTestId('q-text').fill('Cover to steel'); await q.nth(1).getByTestId('q-type').selectOption('NUMERIC'); await q.nth(1).getByTestId('q-target').fill('40'); await q.nth(1).getByTestId('q-tolplus').fill('5'); await q.nth(1).getByTestId('q-tolminus').fill('0'); await q.nth(1).getByTestId('q-autofail').check();
  await q.nth(2).getByTestId('q-text').fill('Rebar condition'); await q.nth(2).getByTestId('q-photo').check();
  await p.getByTestId('pv-Q2').fill('48'); await p.getByTestId('pv-Q1').selectOption('YES'); await p.getByTestId('pv-Q3').selectOption('YES'); await p.getByTestId('pv-go').click(); await expect(p.getByTestId('pv-result')).toHaveAttribute('data-result', 'FAIL'); await expect(p.getByTestId('pv-failed')).toContainText('Q2'); await noOverflow(p); await shot(p, '1-designer', info);
  await p.getByTestId('tpl-save').click(); await expect(p.getByTestId('qa-template-object')).toHaveAttribute('data-status', 'DRAFT'); const tUrl = p.url().replace(/^https?:\/\/[^/]+/, ''); await p.getByTestId('qa-submit').click(); await expect(p.getByTestId('qa-template-object')).toHaveAttribute('data-status', 'SUBMITTED'); await decide(browser, info, c, s.u('qm'), tUrl);
  await p.goto('/qa/itps?new=1'); await p.getByTestId('itp-code').fill('ITP-RCC'); await p.getByTestId('itp-title').fill('RCC footing'); await p.getByTestId('itp-type').selectOption('RCC'); await p.getByTestId('step-desc').first().fill('Check formwork and cover'); await p.getByTestId('itp-add-step').click(); await p.getByTestId('step-desc').nth(1).fill('Witness slump'); await p.getByTestId('step-type').nth(1).selectOption('WITNESS'); await p.getByTestId('step-code').nth(1).fill('S2');
  await p.getByTestId('itp-save').click(); await expect(p.getByTestId('qa-itp-object')).toHaveAttribute('data-status', 'DRAFT'); const iUrl = p.url().replace(/^https?:\/\/[^/]+/, ''); await p.getByTestId('qa-submit').click(); await expect(p.getByTestId('qa-itp-object')).toHaveAttribute('data-status', 'SUBMITTED'); await decide(browser, info, c, s.u('qm'), iUrl);
  await p.goto(iUrl); await expect(p.getByTestId('qa-itp-object')).toHaveAttribute('data-status', 'APPROVED'); await p.getByTestId('apply-project').selectOption(String(s.A)); await p.getByTestId('apply-activity').first().check(); await p.getByTestId('apply-go').click(); await expect(p.getByTestId('apply-note')).toBeVisible(); await noOverflow(p); await shot(p, '2-itp', info);
  await p.goto('/qa/perform'); await expect(p.getByTestId('qa-perform')).toBeVisible(); await p.getByTestId('perf-template').selectOption({ index: 1 }); await p.getByTestId('perf-project').selectOption(String(s.A)); await p.getByTestId('perf-site').selectOption(String(s.site)); await p.getByTestId('perf-subject').fill('Footing F1');
  await p.getByTestId('perf-Q1-YES').click(); await p.getByTestId('perf-Q2').fill('48'); await expect(p.getByTestId('perf-Q2-out')).toBeVisible(); await p.getByTestId('perf-Q3-YES').click(); await p.getByTestId('perf-Q3-photo').setInputFiles({ name: 'rebar.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64') }); await expect(p.getByTestId('perf-Q3-photos')).toHaveText('1'); await p.getByTestId('perf-signer').fill('QC Engineer'); await noOverflow(p); await shot(p, '3-perform', info);
  await p.getByTestId('perf-send').click(); await expect(p.getByTestId('qa-inspection-object').or(p.getByTestId('qa-perform-sent'))).toBeVisible({ timeout: 30_000 });
  let iid = null; for (let i = 0; i < 40 && !iid; i += 1) { const res = await request.get('/api/v1/qa/inspections', { headers: H('QCE', c, s.u('qe')) }); iid = (await res.json()).data?.[0]?.id ?? null; if (!iid) await p.waitForTimeout(1000); }
  expect(iid).toBeTruthy(); const inUrl = `/qa/inspections?id=${iid}`; await p.goto(inUrl); await expect(p.getByTestId('qa-inspection-object')).toBeVisible();
  if ((await p.getByTestId('qa-inspection-object').getAttribute('data-status')) === 'DRAFT') { await p.getByTestId('qa-submit').click(); }
  await expect(p.getByTestId('qa-inspection-object')).toHaveAttribute('data-status', 'SUBMITTED', { timeout: 15_000 }); await expect(p.getByTestId('qa-inspection-object')).toHaveAttribute('data-result', 'FAIL'); await expect(p.getByTestId('ins-defects')).toContainText('Q2'); await noOverflow(p); await shot(p, '4-inspection', info);
  await decide(browser, info, c, s.u('qm'), inUrl); await p.reload(); await expect(p.getByTestId('qa-inspection-object')).toHaveAttribute('data-status', 'APPROVED');
  await p.goto('/qa/inspections'); await expect(p.getByTestId('qa-inspections')).toBeVisible(); await noOverflow(p); await shot(p, '5-register', info); await p.goto('/qa/itps'); await expect(p.getByTestId('qa-itps')).toBeVisible(); await p.goto('/qa/templates'); await expect(p.getByTestId('qa-templates')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
