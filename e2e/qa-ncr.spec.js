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
// Part 18.04 in the browser (development-header mode, port 3100): an NCR is raised on the phone layout, given a disposition and root cause, an action is added and completed, the responsible engineer reports the rectification,
// a passed inspection verifies it, and the closure is approved by the quality engineer and the quality control manager (a major); the analysis counts it. Desktop and mobile.
const OUT = 'docs/erp/screenshots/qa-ncr';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['qe', ['QCE']], ['q2', ['QCE']], ['qm', ['QCMGR']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const A = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-A`, 'Tower A').lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Site 1', 'ACTIVE')").run(c, A, `${T}-S1`).lastInsertRowid);
  const partner = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Sub Builders', 'Sub Builders', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run(c, `P-${T}`).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, T, A, site, partner };
}
const wfAct = async (request, c, role, user, instanceId, action = 'approve') => { const tasks = (await (await request.get('/api/v1/workflow/tasks?mine=assigned', { headers: H(role, c, user) })).json()).data.rows; const task = tasks.find((x) => x.instance.id === instanceId); expect(task, `${user} has the task`).toBeTruthy(); await api(request, c, role, user, 'post', `/workflow/tasks/${task.id}/act`, { action }); };
const decide = async (browser, info, c, role, user, url) => { const a = await open(browser, info, c, role, user, url); await expect(a.page.getByTestId('qa-decide')).toBeVisible(); await a.page.getByTestId('qa-approve').click(); await expect(a.page.getByTestId('qa-note')).toBeVisible(); await a.context.close(); };
test('Quality: raise an NCR, action, rectification, re-inspection and closure by severity', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `n${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const qe = await open(browser, info, c, 'QCE', s.u('qe'), '/qa/ncrs/new'); const p = qe.page; const errors = watch(p);
  await expect(p.getByTestId('qa-ncr-raise')).toBeVisible(); await p.getByTestId('ncrn-project').selectOption(String(s.A)); await p.getByTestId('ncrn-severity').selectOption('MAJOR'); await p.getByTestId('ncrn-resp').selectOption('SUBCONTRACTOR'); await p.getByTestId('ncrn-party').selectOption(String(s.partner)); await p.getByTestId('ncrn-description').fill('Honeycombing on the footing F1 after de-shuttering');
  await p.getByTestId('ncrn-photo').setInputFiles({ name: 'defect.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64') }); await expect(p.getByTestId('ncrn-photos')).toHaveText('1'); await noOverflow(p); await shot(p, '1-raise', info); await p.getByTestId('ncrn-send').click();
  await expect(p.getByTestId('qa-ncr-object')).toHaveAttribute('data-status', 'OPEN'); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  await p.getByTestId('ncr-disposition').selectOption('REWORK'); await p.getByTestId('ncr-rootcause').fill('Pour without supervision'); await p.getByTestId('ncr-whys').fill('Vibrator not used\nNo supervisor at the pour'); await p.getByTestId('ncr-cost').fill('12000'); await p.getByTestId('ncr-backcharge').fill('8000'); await p.getByTestId('ncr-save').click(); await expect(p.getByTestId('ncr-note')).toBeVisible();
  await p.getByTestId('capa-description').fill('Chip out and repair the honeycomb with polymer mortar'); await p.getByTestId('capa-owner').fill(s.u('se')); await p.getByTestId('capa-add').click(); await expect(p.getByTestId('ncr-capa-row')).toHaveCount(1); await shot(p, '2-ncr', info);
  const se = await open(browser, info, c, 'SE', s.u('se'), url); await expect(se.page.getByTestId('ncr-rectify')).toBeVisible(); await se.page.getByTestId('ncr-rect-note').fill('Repaired with polymer mortar and cured'); await se.page.getByTestId('ncr-rectify-go').click(); await expect(se.page.getByTestId('qa-ncr-object')).toHaveAttribute('data-status', 'RECTIFIED'); await se.page.getByTestId('ncr-capa-done').click(); await expect(se.page.locator('[data-testid="ncr-capa-row"][data-status="DONE"]')).toHaveCount(1); await noOverflow(se.page); await shot(se.page, '3-rectified', info);
  const tpl = await api(request, c, 'QCE', s.u('qe'), 'post', '/qa/templates', { code: 'CHK-1', name: 'Surface check', module: 'QUALITY', sections: [{ code: 'S', title: 'Check', questions: [{ code: 'A', text: 'Surface is sound', type: 'YESNO', critical: true }] }] }); const ts = await api(request, c, 'QCE', s.u('qe'), 'post', `/qa/templates/${tpl.id}/submit`); await wfAct(request, c, 'QCMGR', s.u('qm'), ts.workflowInstanceId);
  const ins = await api(request, c, 'QCE', s.u('q2'), 'post', '/qa/inspections', { templateId: tpl.id, projectId: s.A, siteId: s.site, answers: [{ questionCode: 'A', answer: 'YES' }], signatures: [{ role: 'INSPECTOR', name: 'QC Engineer' }] }); const is = await api(request, c, 'QCE', s.u('q2'), 'post', `/qa/inspections/${ins.id}/submit`); await wfAct(request, c, 'QCMGR', s.u('qm'), is.workflowInstanceId);
  await p.reload(); await expect(p.getByTestId('ncr-reinspect')).toBeVisible(); await p.getByTestId('ncr-ins').selectOption(String(ins.id)); await p.getByTestId('ncr-link').click(); await expect(p.getByTestId('ncr-note')).toBeVisible(); await p.getByTestId('ncr-closure').click(); await expect(p.getByTestId('qa-ncr-object')).toHaveAttribute('data-status', 'CLOSURE_REVIEW');
  await decide(browser, info, c, 'QCE', s.u('q2'), url); await decide(browser, info, c, 'QCMGR', s.u('qm'), url); await p.reload(); await expect(p.getByTestId('qa-ncr-object')).toHaveAttribute('data-status', 'CLOSED'); await noOverflow(p); await shot(p, '4-closed', info);
  await p.goto('/qa/ncrs'); await expect(p.getByTestId('qa-ncrs')).toBeVisible(); await noOverflow(p); await shot(p, '5-register', info);
  const qm = await open(browser, info, c, 'QCMGR', s.u('qm'), '/qa/ncr-analysis'); await expect(qm.page.getByTestId('qa-ncr-analysis')).toBeVisible(); await expect(qm.page.getByTestId('nca-type-row').first()).toContainText('Workmanship'); await noOverflow(qm.page); await shot(qm.page, '6-analysis', info);
  expect(errors, errors.join('\n')).toEqual([]); void iso;
});
