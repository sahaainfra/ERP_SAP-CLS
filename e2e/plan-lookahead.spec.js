import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 13.04 in the browser (development-header mode, port 3100): the planner opens the look-ahead board and the constraints found in engineering appear on the cards (an open RFI, a drawing with no IFC
// revision); the RFI is closed and the card is ready; a constraint is logged by hand, followed in the Constraint Log and cleared; a ready card is taken into a weekly plan, which is sent, approved by the
// construction manager and then the project manager, recorded by the site engineer with the reason for what was not done and closed with its PPC, which the report shows; a card is moved to another
// week through the server check and the move is undone; the site engineer reads the board and cannot move a card.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const api = async (request, c, roles, user, method, path, data) => {
  const res = await request[method](`/api/v1${path}`, { headers: H(roles, c, user), data });
  expect(res.status(), `${method} ${path}: ${await res.text()}`).toBeLessThan(300);
  return (await res.json()).data;
};
async function company(request, code) {
  const id = (await api(request, 1, 'SYSADM', 'e2e-setup', 'post', '/iam/org/companies', { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id;
  const get = await request.get('/api/v1/core/company-settings', { headers: H('SYSADM', id, 'e2e-setup') });
  const version = get.ok() ? (await get.json()).data?.version : undefined;
  await api(request, id, 'SYSADM', 'e2e-setup', 'put', '/core/company-settings', { legalName: `${code} Infra Pvt Ltd`, reason: 'initial set-up', ...(version ? { version } : {}) });
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/financial-years', { startDate: '2026-04-01' });
  return id;
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, acceptDownloads: true });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
const OUT = 'docs/erp/screenshots/plan-lookahead';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (d) => d.toISOString().slice(0, 10);
const monday = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return iso(d); })();
const nextMonday = (() => { const d = new Date(`${monday}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); return iso(d); })();
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['cm1', ['CM']], ['cm2', ['CM']], ['pm', ['PM']], ['pcm', ['PCMGR']], ['se', ['SE']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower L', 'BUILDING', 'ACTIVE')").run(c, `${T}-L`).lastInsertRowid);
  const w1 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '1', 'Substructure', 1, 'e2e')").run(c, pid).lastInsertRowid);
  const w11 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (?, ?, ?, '1.1', 'Footings', 2, 'e2e')").run(c, pid, w1).lastInsertRowid);
  const w2 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '2', 'Superstructure', 1, 'e2e')").run(c, pid).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (?, ?, ?, 'Site 1')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const crew = Number(db.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (?, ?, ?, 'Masons gang', 'Mason')").run(c, site, `${T}-M1`).lastInsertRowid);
  db.prepare("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, crew_id, from_date, status) VALUES (?, ?, '2026-01-01', 'WORKER', ?, ?, ?, '2026-01-01', 'APPROVED')").run(c, `${T}-DEP/1`, 7001, pid, crew);
  const d1 = Number(db.prepare("INSERT INTO engg_drawings (company_id, org_project_id, drawing_no, title, discipline, wbs_id) VALUES (?, ?, 'STR-101', 'Footing layout', 'STRUCTURAL', ?)").run(c, pid, w11).lastInsertRowid);
  db.prepare("INSERT INTO engg_drawings (company_id, org_project_id, drawing_no, title, discipline, wbs_id) VALUES (?, ?, 'STR-201', 'Column layout', 'STRUCTURAL', ?)").run(c, pid, w2);
  const rfi = Number(db.prepare("INSERT INTO engg_rfis (company_id, rfi_no, org_project_id, subject, question, discipline, wbs_id, drawing_id, required_by, status) VALUES (?, ?, ?, 'Footing level', 'What is the footing level?', 'STRUCTURAL', ?, ?, ?, 'ISSUED')").run(c, `${T}-RFI/1`, pid, w11, d1, nextMonday).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, pid, rfi, site, crew, d1 };
}
async function approve(request, c, roles, user, instanceId) {
  const task = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows.find((x) => x.instance.id === instanceId); expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked' });
}

test('AC-01 the look-ahead board shows the constraints found in engineering; a ready card is planned, approved, recorded and closed; PPC is reported', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `l${info.project.name[0]}${Date.now().toString(36).slice(-5)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t); const planner = s.u('plan'); const P = (m, path, data) => api(request, c, 'PLAN', planner, m, path, data);
  const cal = await P('post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); await api(request, c, 'PCMGR', s.u('pcm'), 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await P('post', '/plan/schedules', { projectId: s.pid, name: 'Tower L working schedule', calendarId: cal.id, startDate: monday });
  await P('post', `/plan/schedules/${sch.id}/import`, { rows: [{ code: 'A10', name: 'Excavation', wbsCode: '1.1', duration: 5 }, { code: 'A20', name: 'PCC under footings', wbsCode: '1.1', duration: 3, predecessors: 'A10' }, { code: 'A30', name: 'Ground floor columns', wbsCode: '2', duration: 4 }] });
  await P('post', `/plan/schedules/${sch.id}/calculate`, {}); const desktop = info.project.name === 'desktop';

  // ---- the board: the constraints appear when the planner looks for them ----
  const r = await open(browser, info, c, 'PLAN', planner, `/plan/lookahead?scheduleId=${sch.id}`); const errors = watch(r.page); const page = r.page;
  await expect(page.getByRole('heading', { name: 'Look-ahead Board', level: 1 })).toBeVisible(); await expect(page.getByTestId('la-card')).toHaveCount(3); await expect(page.getByTestId('la-n-blocked')).toHaveText('0');
  await page.getByTestId('la-detect').click(); await expect(page.getByTestId('la-note')).toContainText('3 found'); await expect(page.getByTestId('la-n-blocked')).toHaveText('3'); await expect(page.getByTestId('la-n-ready')).toContainText('0');
  const card = (code) => page.locator(`[data-testid="la-card"][data-code="${code}"]`);
  await expect(card('A10')).toHaveAttribute('data-ready', '0'); await expect(card('A10').getByTestId('la-constraint')).toContainText('Open RFI'); await expect(card('A30').getByTestId('la-constraint')).toContainText('No IFC revision');
  await shot(page, 'board', info); await noOverflow(page);
  // the RFI is closed in engineering: the next look finds the constraint resolved
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.prepare("UPDATE engg_rfis SET status = 'CLOSED' WHERE id = ?").run(s.rfi); db.prepare("UPDATE engg_drawings SET register_status = 'CANCELLED' WHERE company_id = ?").run(c); db.close();
  await page.getByTestId('la-detect').click(); await expect(page.getByTestId('la-note')).toContainText('3 cleared'); await expect(page.getByTestId('la-n-ready')).toContainText('3'); await expect(card('A10')).toHaveAttribute('data-ready', '1');
  await page.getByTestId('la-only-blocked').check(); await expect(page.getByTestId('la-card')).toHaveCount(0); await expect(page.getByTestId('la-empty')).toBeVisible(); await page.getByTestId('la-only-blocked').uncheck();
  // a constraint logged by hand on a card, then the log
  await card('A30').getByTestId('la-add-constraint').click(); await page.getByTestId('la-ctype').selectOption('PERMIT'); await page.getByTestId('la-cdesc').fill('Hot work permit for the cutting'); await page.getByTestId('la-cowner').fill(s.u('se')); await page.getByTestId('la-cdue').fill(nextMonday); await page.getByTestId('la-csave').click();
  await expect(card('A30')).toHaveAttribute('data-ready', '0'); await expect(card('A30').getByTestId('la-constraint')).toContainText('Hot work permit'); await shot(page, 'board-blocked', info);
  await page.goto(`/plan/constraints?scheduleId=${sch.id}`); await expect(page.getByTestId('plan-constraints')).toBeVisible(); await page.getByText('Hot work permit for the cutting').first().click();
  await expect(page.getByTestId('con-detail')).toHaveAttribute('data-status', 'OPEN'); await shot(page, 'constraints', info); await noOverflow(page);
  page.once('dialog', (d) => d.accept('Permit received')); await page.getByTestId('con-clear').click(); await expect(page.getByTestId('con-detail')).toHaveAttribute('data-status', 'CLEARED');

  // ---- a ready card is planned for the week; the form is filled from the board ----
  await page.goto(`/plan/lookahead?scheduleId=${sch.id}`); await expect(card('A30')).toHaveAttribute('data-ready', '1'); await card('A10').getByTestId('la-pick').check(); await card('A30').getByTestId('la-pick').check(); await page.getByTestId('la-plan').click();
  await expect(page.getByTestId('wp-form')).toBeVisible(); await expect(page.getByTestId('wp-new-line')).toHaveCount(2); await expect(page.getByTestId('wp-week')).toHaveValue(monday);
  const lines = page.getByTestId('wp-new-line'); await lines.nth(0).getByTestId('wp-new-crew').selectOption({ index: 1 }); await lines.nth(0).getByTestId('wp-new-qty').fill('50'); await lines.nth(1).getByTestId('wp-new-qty').fill('20'); await shot(page, 'weekly-new', info);
  await page.getByTestId('wp-create').click(); await expect(page.getByTestId('wp-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(page.getByTestId('wp-line')).toHaveCount(2); await expect(page.getByTestId('wp-daily')).toBeVisible();
  const id = Number(new URL(page.url()).searchParams.get('id')); await page.getByTestId('wp-submit').click(); await expect(page.getByTestId('wp-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(page.getByTestId('wp-edit')).toHaveCount(0);
  const plan = await P('get', `/plan/weekly-plans/${id}`); await approve(request, c, 'CM', s.u('cm2'), plan.workflowInstanceId); await approve(request, c, 'PM', s.u('pm'), plan.workflowInstanceId);
  await page.reload(); await expect(page.getByTestId('wp-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(page.getByTestId('wp-locked')).toBeVisible(); await expect(page.getByTestId('wp-record')).toHaveCount(0); await shot(page, 'weekly-approved', info); await noOverflow(page);
  expect(errors, errors.join('\n')).toEqual([]);

  // ---- the site engineer records the week: one done, one not, with its reason; closes it ----
  const v = await open(browser, info, c, 'SE', s.u('se'), `/plan/weekly?id=${id}`); const e2 = watch(v.page); const sp = v.page;
  await expect(sp.getByTestId('wp-record')).toBeVisible(); await expect(sp.getByTestId('wp-amend')).toHaveCount(0); await sp.getByTestId('wp-record').click();
  const q = sp.getByTestId('wp-rec-qty'); await q.nth(0).fill('50'); await q.nth(1).fill('5'); await sp.getByTestId('wp-rec-code').selectOption('LABOUR'); await sp.getByTestId('wp-rec-save').click();
  await expect(sp.getByTestId('wp-completed')).toHaveText('1'); await expect(sp.getByTestId('wp-ppc')).toContainText('50 %'); await shot(sp, 'weekly-recorded', info);
  await sp.getByTestId('wp-close').click(); await expect(sp.getByTestId('wp-object')).toHaveAttribute('data-status', 'CLOSED'); await expect(sp.getByTestId('wp-ppc')).toHaveText('50 %'); await expect(sp.getByTestId('wp-variance')).toContainText('Labour 1');
  // the report: PPC of the closed week and the reasons
  await sp.goto(`/plan/weekly?tab=report&projectId=${s.pid}`); await expect(sp.getByTestId('ppc-total')).toHaveText('50 %'); await expect(sp.getByTestId('ppc-bar')).toHaveCount(1); await expect(sp.getByTestId('ppc-reason')).toHaveCount(1); await expect(sp.getByTestId('ppc-reason')).toContainText('Labour');
  await expect(sp.getByTestId('ppc-export-xlsx')).toHaveCount(0); await shot(sp, 'ppc-report', info); await noOverflow(sp);

  // ---- a card is moved to another week: checked on the server first, applied, undone ----
  await page.goto(`/plan/lookahead?scheduleId=${sch.id}`); await expect(card('A20')).toBeVisible();
  await card('A20').getByTestId('la-move').selectOption({ index: 1 }); await expect(page.getByTestId('la-move-panel')).toBeVisible(); await expect(page.getByTestId('la-move-panel')).toContainText('A20'); await shot(page, 'board-move', info);
  await page.getByTestId('la-move-apply').click(); await expect(page.getByTestId('la-note')).toContainText('A20 is moved'); await expect(page.getByTestId('la-undo')).toBeVisible();
  await page.getByTestId('la-undo').click(); await expect(page.getByTestId('la-note')).toContainText('undone');
  if (desktop) { await card('A20').dragTo(page.locator('[data-testid="la-col"]').nth(1)); await expect(page.getByTestId('la-move-panel')).toBeVisible(); await page.getByTestId('la-move-cancel').click(); }
  expect(errors, errors.join('\n')).toEqual([]);
  // the site engineer reads the board and cannot move a card
  await v.page.goto(`/plan/lookahead?scheduleId=${sch.id}`); await expect(v.page.getByTestId('la-card').first()).toBeVisible(); await expect(v.page.getByTestId('la-move')).toHaveCount(0); await expect(v.page.getByTestId('la-save')).toHaveCount(0);
  expect(e2, e2.join('\n')).toEqual([]);
});
