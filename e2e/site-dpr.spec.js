import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 14.02 in the browser (development-header mode, port 3100): the site engineer fills the daily progress report on the phone step by step (prefilled from the work authorisation, the attendance, the stores and the
// plant log; the masons reported above the attendance need a reason; a photo from the camera), sends it, and it reaches the server with its photo; the construction manager approves it from the report; the register
// shows the day with no report; the report of the day adds it up and exports; the compliance page shows the missing day; and a report of yesterday made with no signal waits on the phone and goes when it returns.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|ERR_INTERNET_DISCONNECTED|Cannot reach the server|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
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
const OUT = 'docs/erp/screenshots/site-dpr';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const ist = (n) => new Date(Date.now() + 19_800_000 - n * 86_400_000).toISOString().slice(0, 10);
const TODAY = ist(0); const Y = ist(1);

function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['pcm', ['PCMGR']], ['se', ['SE']], ['cm', ['CM']], ['pm', ['PM']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower R', 'BUILDING', 'ACTIVE')").run(c, `${T}-R`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower R site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const zone = Number(db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (?, ?, 'ZONE', 'ZA', 'Zone A', 'e2e')").run(c, pid).lastInsertRowid);
  const crew = Number(db.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (?, ?, ?, 'Masons', 'Mason')").run(c, site, `${T}-M1`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, ?, 'DPR e2e', ?, '[]', '[]', 'EST', 'ACTIVE')").run(c, `${T}C`, `R${T.slice(-4)}`).lastInsertRowid);
  const cement = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (?, ?, 'Cement', 'MATERIAL', ?, 'BAG', '2026-01-01', 'ACTIVE')").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const contractor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, 'Ace Labour', ?, 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'e2e', 'e2e')").run(c, `${T}-ACE`, `ace labour ${T}`).lastInsertRowid);
  const workers = [1, 2, 3, 4].map((i) => { const id = Number(db.prepare("INSERT INTO lab_workers (company_id, doc_no, doc_date, worker_code, name, dob, gender, trade_code, skill_category, contractor_id, status, created_by, source_type) VALUES (?, ?, '2026-01-01', ?, ?, '1990-01-01', 'MALE', 'Mason', 'SKILLED', ?, 'APPROVED', 'e2e', 'e2e')").run(c, `LW/${T}${i}`, `${T}W${i}`, `Worker ${i}`, contractor).lastInsertRowid); db.prepare('UPDATE lab_workers SET root_id = id WHERE id = ?').run(id); return id; });
  const desig = Number(db.prepare("INSERT INTO org_designations (company_id, code, name) VALUES (?, ?, 'Site Engineer')").run(c, `${T}D`).lastInsertRowid);
  const emp = Number(db.prepare("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, employment_type, doj, designation_id, created_by, source_type) VALUES (?, ?, 'Ravi', 'Ravi Kumar', ?, 'MALE', '1990-01-01', ?, 'PERMANENT', '2026-01-01', ?, 'e2e', 'e2e')").run(c, `${T}E1`, `ravi ${T}`, `9${String(c).padStart(9, '0')}`, desig).lastInsertRowid);
  const att = (type, id, date, status) => db.prepare("INSERT INTO att_daily (company_id, person_type, person_id, work_date, daily_site_id, status, worked_minutes, paid_day, computed_at, period_start, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 480, 1, ?, ?, 'e2e', 'e2e')").run(c, type, id, date, site, status, new Date().toISOString(), `${date.slice(0, 8)}01`);
  for (const date of [TODAY, Y]) { for (const w of workers.slice(0, 3)) att('WORKER', w, date, 'PRESENT'); att('WORKER', workers[3], date, 'HALF_DAY'); att('EMPLOYEE', emp, date, 'PRESENT'); }
  db.close(); return { u: (k) => `${t}-${k}`, pid, site, zone, crew, cement, T };
}
function plan(s, sid, c) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  const a10 = db.prepare("SELECT id FROM plan_activities WHERE schedule_id = ? AND code = 'A10'").get(sid).id;
  db.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3', location_id = ? WHERE id = ?").run(s.zone, a10);
  db.prepare("INSERT INTO plan_activity_resources (company_id, schedule_id, activity_id, resource_type, item_id, res_key, label, uom, basis, qty_total, qty_per_day) VALUES (?, ?, ?, 'MATERIAL', ?, ?, 'Cement', 'BAG', 'TOTAL', 200000, 40000)").run(c, sid, a10, s.cement, `item:${s.cement}`);
  db.close(); return a10;
}
async function approveWa(request, c, s, id) {
  const sub = await api(request, c, 'SE', s.u('se'), 'post', `/site/work-authorisations/${id}/submit`, {}); const inst = sub.workflowInstanceId;
  for (const [roles, user] of [['CM', s.u('cm')], ['PM', s.u('pm')]]) { const task = (await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned')).rows.find((x) => x.instance.id === inst); expect(task, `${user} has the task`).toBeTruthy(); await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked' }); }
}

test('AC-01 a DPR is made on the phone from the day\'s work and attendance, sent with a photo, approved, reported on; a report made offline waits and goes when the signal returns', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = `r${info.project.name[0]}${Date.now().toString(36).slice(-5)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t);
  const P = (m, path, data) => api(request, c, 'PLAN', s.u('plan'), m, path, data);
  const cal = await P('post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); await api(request, c, 'PCMGR', s.u('pcm'), 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await P('post', '/plan/schedules', { projectId: s.pid, name: 'Tower R schedule', calendarId: cal.id, startDate: '2026-04-06' });
  await P('post', `/plan/schedules/${sch.id}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 5 }, { code: 'A20', name: 'Raft concrete', duration: 3, predecessors: 'A10' }] }); await P('post', `/plan/schedules/${sch.id}/calculate`, {}); const a10 = plan(s, sch.id, c);
  const SE = (m, path, data) => api(request, c, 'SE', s.u('se'), m, path, data);
  // today's work: an emergency WA (usable at once); yesterday's: a WA approved by the construction manager and the project manager, with no report yet
  const waBody = (date, extra = {}) => ({ siteId: s.site, planDate: date, activityId: a10, plannedQty: 10, startTime: '08:00', endTime: '17:00', ...extra });
  const wt = await SE('post', '/site/work-authorisations', waBody(TODAY, { emergency: true, emergencyReason: 'The pump failed and the pit floods' }));
  const wy = await SE('post', '/site/work-authorisations', waBody(Y, { crews: [{ crewId: s.crew }] })); await approveWa(request, c, s, wy.id);
  await SE('post', '/site/wa-uses', { projectId: s.pid, waId: wt.id, kind: 'MATERIAL_ISSUE', srcEntity: 'inv_issue', srcId: `${t}-MI1`, itemId: s.cement, qty: 12, date: TODAY });
  const dbw = new DatabaseSync('data/e2e.sqlite'); dbw.exec('PRAGMA busy_timeout = 8000;'); dbw.prepare("UPDATE pcs_control_points SET mode = 'WARN' WHERE company_id = ? AND code = 'CP-SITE-02'").run(c); dbw.close();
  await SE('post', '/site/wa-uses', { projectId: s.pid, waId: wt.id, kind: 'PLANT_LOG', srcEntity: 'plant_log', srcId: `${t}-PL1`, trade: 'Tower crane', qty: 8, date: TODAY });

  // ---- the phone: step by step ----
  const r = await open(browser, info, c, 'SE', s.u('se'), '/site/dpr-entry'); const errors = watch(r.page); const page = r.page;
  await expect(page.getByTestId('site-dpr-entry')).toBeVisible(); await expect(page.getByTestId('dpr-site')).toHaveValue(String(s.site)); await expect(page.getByTestId('dpr-net')).toContainText('Online');
  await shot(page, '01-entry-day', info); await noOverflow(page); await page.getByTestId('dpr-start').click();
  await expect(page.getByTestId('dpr-work-line')).toHaveCount(1); await expect(page.getByTestId('dpr-work-qty')).toHaveValue('10'); await shot(page, '02-entry-work', info); await noOverflow(page); await page.getByTestId('dpr-next').click();
  const labour = page.getByTestId('dpr-labour-line'); await expect(labour).toHaveCount(2); const masons = labour.filter({ hasText: 'Mason' }); await expect(masons.getByTestId('dpr-labour-md')).toHaveValue('3.5');
  await masons.getByTestId('dpr-labour-md').fill('5'); await expect(masons.getByTestId('dpr-reason-labour')).toBeVisible(); await masons.getByTestId('dpr-reason-labour').fill('Two masons worked a long day to finish the pit'); await shot(page, '03-entry-labour', info); await noOverflow(page); await page.getByTestId('dpr-next').click();
  await expect(page.getByTestId('dpr-material-line')).toHaveCount(1); await expect(page.getByTestId('dpr-equipment-line')).toHaveCount(1); await page.getByTestId('dpr-next').click();
  await page.getByTestId('dpr-weather').selectOption('RAIN'); await page.getByTestId('dpr-note-kind').selectOption('HINDRANCE'); await page.getByTestId('dpr-add-note').click(); await page.getByTestId('dpr-note-line').locator('textarea').fill('Rain stopped the pour for two hours'); await page.getByTestId('dpr-nextday').fill('Raft concrete on zone A'); await shot(page, '04-entry-notes', info); await page.getByTestId('dpr-next').click();
  await page.getByTestId('dpr-photo-input').setInputFiles([{ name: 'pit.png', mimeType: 'image/png', buffer: PNG }]); await expect(page.getByTestId('dpr-photo-line')).toHaveCount(1); await page.getByTestId('dpr-next').click();
  await expect(page.getByTestId('dpr-summary')).toContainText('6 man-days'); await shot(page, '05-entry-send', info); await noOverflow(page); await page.getByTestId('dpr-submit').click();
  await expect(page.getByTestId('dpr-queued')).toHaveAttribute('data-state', 'sent', { timeout: 40_000 });
  const list = (await api(request, c, 'SE', s.u('se'), 'get', '/site/dprs')); expect(list.length).toBe(1); const dprId = list[0].id; expect(list[0].status).toBe('SUBMITTED');
  const det = await api(request, c, 'SE', s.u('se'), 'get', `/site/dprs/${dprId}`); expect(det.photos.length).toBe(1); expect(det.labour.find((l) => l.trade === 'Mason').flagged).toBe(true); expect(det.work[0].qty).toBe(10);
  expect(errors, errors.join('\n')).toEqual([]);

  // ---- the register shows yesterday as missing; the construction manager approves the report from the report ----
  const sr = await open(browser, info, c, 'SE', s.u('se'), '/site/dprs'); const sre = watch(sr.page); await expect(sr.page.getByTestId('dpr-missing')).toBeVisible(); await expect(sr.page.getByTestId('dpr-missing-row').first()).toContainText(Y.slice(0, 4)); await shot(sr.page, '06-register', info); await noOverflow(sr.page); expect(sre, sre.join('\n')).toEqual([]);
  const m = await open(browser, info, c, 'CM', s.u('cm'), `/site/dprs?id=${dprId}`); const me = watch(m.page);
  await expect(m.page.getByTestId('dpr-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(m.page.getByTestId('dpr-flags')).toBeVisible(); await expect(m.page.getByTestId('dpr-labour-row').filter({ hasText: 'Mason' })).toHaveAttribute('data-flagged', '1');
  await expect(m.page.getByTestId('dpr-photo')).toHaveCount(1); await expect(m.page.getByTestId('dpr-decide')).toBeVisible(); await shot(m.page, '07-report-submitted', info); await noOverflow(m.page);
  await m.page.getByTestId('dpr-approve').click(); await expect(m.page.getByTestId('dpr-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(m.page.getByTestId('dpr-locked')).toBeVisible(); await shot(m.page, '08-report-approved', info);
  await m.page.getByTestId('dpr-photo').getByRole('button').first().click(); await expect(m.page.getByTestId('dpr-photo-open')).toBeVisible(); expect(me, me.join('\n')).toEqual([]);

  // ---- the report of the day and the compliance dashboard ----
  const rp = await open(browser, info, c, 'PM', s.u('pm'), '/site/dpr-report'); const rpe = watch(rp.page);
  await expect(rp.page.getByTestId('dr-count')).toHaveText('1'); await expect(rp.page.getByTestId('dr-mandays')).toHaveText('6'); await expect(rp.page.getByTestId('dr-work-row')).toHaveCount(1); await shot(rp.page, '09-report', info); await noOverflow(rp.page);
  const dl = rp.page.waitForEvent('download'); await rp.page.getByTestId('dr-export-csv').click(); expect((await dl).suggestedFilename()).toMatch(/\.csv$/); expect(rpe, rpe.join('\n')).toEqual([]);
  const co = await open(browser, info, c, 'PLAN', s.u('plan'), '/site/dpr-compliance'); const coe = watch(co.page);
  await expect(co.page.getByTestId('dc-tiles')).toBeVisible(); await expect(co.page.getByTestId('dc-missing')).toHaveText('1'); await expect(co.page.getByTestId('dc-site-row')).toHaveAttribute('data-missing', '1'); await shot(co.page, '10-compliance', info); await noOverflow(co.page); expect(coe, coe.join('\n')).toEqual([]);

  // ---- yesterday's report with no signal: it waits on the phone and goes when the signal returns ----
  await page.goto('/site/dprs'); await expect(page.getByTestId('dpr-missing')).toBeVisible(); await page.waitForTimeout(1500);
  await r.context.setOffline(true); await page.getByRole('link', { name: 'New daily progress report' }).click(); await expect(page.getByTestId('dpr-net')).toContainText('Offline');
  await page.getByTestId('dpr-date').fill(Y); await page.getByTestId('dpr-start').click(); await expect(page.getByTestId('dpr-work-line')).toHaveCount(1); await expect(page.getByTestId('dpr-note')).toBeVisible();
  await page.getByTestId('dpr-next').click(); await expect(page.getByTestId('dpr-labour-line')).toHaveCount(2); await page.getByTestId('dpr-next').click(); await page.getByTestId('dpr-next').click();
  await page.getByTestId('dpr-note-kind').selectOption('HINDRANCE'); await page.getByTestId('dpr-add-note').click(); await page.getByTestId('dpr-note-line').locator('textarea').fill('Wet ground slowed the excavation'); await page.getByTestId('dpr-next').click();
  await page.getByTestId('dpr-photo-input').setInputFiles([{ name: 'wet.png', mimeType: 'image/png', buffer: PNG }]); await page.getByTestId('dpr-next').click(); await expect(page.getByTestId('dpr-offline-help')).toBeVisible(); await shot(page, '11-entry-offline', info);
  await page.getByTestId('dpr-submit').click(); await expect(page.getByTestId('dpr-queued')).toHaveAttribute('data-state', /PENDING/); await noOverflow(page);
  expect((await api(request, c, 'SE', s.u('se'), 'get', '/site/dprs')).length, 'nothing reached the server while offline').toBe(1);
  await r.context.setOffline(false); await expect(page.getByTestId('dpr-queued')).toHaveAttribute('data-state', 'sent', { timeout: 40_000 });
  const after = await api(request, c, 'SE', s.u('se'), 'get', '/site/dprs'); expect(after.length).toBe(2); const yd = after.find((x) => x.dprDate === Y); expect(yd.status).toBe('SUBMITTED'); expect(yd.late).toBe('Late');
  const yDet = await api(request, c, 'SE', s.u('se'), 'get', `/site/dprs/${yd.id}`); expect(yDet.submittedVia).toBe('OFFLINE'); expect(yDet.photos.length).toBe(1);
  expect(errors, errors.join('\n')).toEqual([]);
});
