import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 14.01 in the browser (development-header mode, port 3100): the site engineer builds the daily plan of 7 April from the approved weekly plan and issues it, which raises a work authorisation;
// sends it; the construction manager approves it on the phone screen; the stores and the DPR book against it; the board shows it on its front; the site engineer closes it with the DPR quantity and
// the cement used (beyond the tolerance, so with the reason); the work supervisor reads the list and raises nothing.
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
const OUT = 'docs/erp/screenshots/site-wa';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const DAY = '2026-04-07';
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['pcm', ['PCMGR']], ['se', ['SE']], ['cm', ['CM']], ['sk', ['SK']], ['wsup', ['WSUP']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower W', 'BUILDING', 'ACTIVE')").run(c, `${T}-W`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower W site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const zone = Number(db.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (?, ?, 'ZONE', 'ZA', 'Zone A', 'e2e')").run(c, pid).lastInsertRowid);
  const crew = Number(db.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (?, ?, ?, 'Masons', 'Mason')").run(c, site, `${T}-M1`).lastInsertRowid);
  for (const p of [1, 2, 3]) db.prepare("INSERT INTO hr_crew_members (company_id, crew_id, person_type, person_id, from_date) VALUES (?, ?, 'WORKER', ?, '2026-01-01')").run(c, crew, p);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, ?, 'WA e2e', ?, '[]', '[]', 'EST', 'ACTIVE')").run(c, `${T}C`, `W${T.slice(-4)}`).lastInsertRowid);
  const cement = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (?, ?, 'Cement', 'MATERIAL', ?, 'BAG', '2026-01-01', 'ACTIVE')").run(c, `${T}-CEM`, cat).lastInsertRowid);
  db.prepare("INSERT INTO site_work_fronts (company_id, org_project_id, wf_site_id, location_id, code, name, project_id, site_id, created_by) VALUES (?, ?, ?, ?, 'FA', 'Zone A pit', ?, ?, 'e2e')").run(c, pid, site, zone, pid, site);
  db.close(); return { u: (k) => `${t}-${k}`, pid, site, zone, crew, cement, T };
}
function plan(s, sid, c) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  const a10 = db.prepare("SELECT id FROM plan_activities WHERE schedule_id = ? AND code = 'A10'").get(sid).id;
  db.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3', location_id = ? WHERE id = ?").run(s.zone, a10);
  db.prepare("INSERT INTO plan_activity_resources (company_id, schedule_id, activity_id, resource_type, item_id, res_key, label, uom, basis, qty_total, qty_per_day) VALUES (?, ?, ?, 'MATERIAL', ?, ?, 'Cement', 'BAG', 'TOTAL', 200000, 40000)").run(c, sid, a10, s.cement, `item:${s.cement}`);
  const wp = Number(db.prepare("INSERT INTO plan_weekly_plans (company_id, doc_no, doc_date, org_project_id, schedule_id, wp_site_id, week_start, status, items_count) VALUES (?, ?, '2026-04-01', ?, ?, ?, '2026-04-06', 'APPROVED', 1)").run(c, `${s.T}-WP1`, s.pid, sid, s.site).lastInsertRowid);
  db.prepare("INSERT INTO plan_weekly_items (company_id, plan_id, activity_id, crew_id, committed_qty, uom) VALUES (?, ?, ?, ?, 50000, 'm3')").run(c, wp, a10, s.crew);
  db.close(); return a10;
}

test('AC-01 a daily plan raises a WA, approved on the phone; stores and DPR book against it; it is closed and reconciled', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `w${info.project.name[0]}${Date.now().toString(36).slice(-5)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t);
  const P = (m, path, data) => api(request, c, 'PLAN', s.u('plan'), m, path, data);
  const cal = await P('post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); await api(request, c, 'PCMGR', s.u('pcm'), 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await P('post', '/plan/schedules', { projectId: s.pid, name: 'Tower W schedule', calendarId: cal.id, startDate: '2026-04-06' });
  await P('post', `/plan/schedules/${sch.id}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 5 }, { code: 'A20', name: 'Raft concrete', duration: 3, predecessors: 'A10' }] }); await P('post', `/plan/schedules/${sch.id}/calculate`, {});
  plan(s, sch.id, c);

  // ---- the daily plan of 7 April from the weekly plan, issued ----
  const r = await open(browser, info, c, 'SE', s.u('se'), '/site/daily-plans'); const errors = watch(r.page); const page = r.page;
  await expect(page.getByTestId('dp-new-form')).toBeVisible(); await expect(page.getByTestId('dp-site')).toHaveValue(String(s.site));
  await page.getByTestId('dp-date').fill(DAY); await page.getByTestId('dp-from-WEEKLY').check(); await page.getByTestId('dp-create').click();
  await expect(page.getByTestId('dp-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(page.getByTestId('dp-line')).toHaveCount(1); await expect(page.getByTestId('dp-qty')).toHaveValue('10');
  await shot(page, '01-daily-plan', info);
  page.once('dialog', (d) => d.accept()); await page.getByTestId('dp-issue').click();
  await expect(page.getByTestId('dp-object')).toHaveAttribute('data-status', 'ISSUED'); const waLink = page.getByTestId('dp-line').getByRole('link'); await expect(waLink).toHaveText(/^WA/);
  await waLink.click(); await expect(page.getByTestId('wa-object')).toHaveAttribute('data-status', 'DRAFT');
  await expect(page.locator('[data-testid="wa-check"][data-code="PLAN"]')).toHaveAttribute('data-result', 'PASS'); await expect(page.getByTestId('wa-resource')).toHaveCount(2);
  await page.getByTestId('wa-submit').click(); await expect(page.getByTestId('wa-object')).toHaveAttribute('data-status', 'SUBMITTED');
  const waId = Number(new URL(page.url()).searchParams.get('id')); await shot(page, '02-wa-submitted', info); await noOverflow(page);
  expect(errors, errors.join('\n')).toEqual([]);

  // ---- the construction manager approves on the phone screen ----
  const m = await open(browser, info, c, 'CM', s.u('cm'), '/site/wa-mobile'); const me = watch(m.page);
  await m.page.getByTestId('mb-date').fill(DAY); const card = m.page.getByTestId('mb-approve'); await expect(card).toHaveCount(1);
  await shot(m.page, '03-mobile-approve', info); await card.getByTestId('mb-approve-btn').click();
  await expect(m.page.getByTestId('mb-note')).toContainText('approved'); await expect(m.page.getByTestId('mb-none-approve')).toBeVisible(); await noOverflow(m.page);
  expect(me, me.join('\n')).toEqual([]);

  // ---- the stores issue 24 bags against it; the DPR reports 9 m3 ----
  await api(request, c, 'SK', s.u('sk'), 'post', '/site/wa-uses', { projectId: s.pid, waId, kind: 'MATERIAL_ISSUE', srcEntity: 'inv_issue', srcId: `${t}-MI1`, itemId: s.cement, qty: 20, date: DAY });
  await api(request, c, 'SE', s.u('se'), 'post', '/site/wa-uses', { projectId: s.pid, waId, kind: 'DPR', srcEntity: 'site_dpr', srcId: `${t}-DPR1`, qty: 9, date: DAY });

  // ---- the board shows it on its front ----
  await page.goto(`/site/board?siteId=${s.site}&date=${DAY}`); await expect(page.getByTestId('bd-lane')).toHaveCount(1);
  await expect(page.locator('[data-testid="bd-card"][data-status="APPROVED"]')).toHaveCount(1); await shot(page, '04-board', info); await noOverflow(page);

  // ---- closed on the phone with the DPR quantity; 24 bags against 20 needs the reason ----
  const cl = await open(browser, info, c, 'SE', s.u('se'), '/site/wa-mobile'); await cl.page.getByTestId('mb-date').fill(DAY);
  const close = cl.page.getByTestId('mb-close'); await expect(close).toHaveCount(1); await close.getByTestId('mb-close-btn').click();
  await expect(cl.page.getByTestId('wa-actual')).toHaveValue('9'); await cl.page.locator('[data-testid="wa-res-actual"][data-type="MATERIAL"]').fill('24');
  await cl.page.getByTestId('wa-variance').fill('Over-excavation filled with lean concrete'); await shot(cl.page, '05-mobile-close', info);
  await cl.page.getByTestId('wa-close-save').click(); await expect(cl.page.getByTestId('mb-note')).toContainText('closed');
  await page.goto(`/site/work-authorisations?id=${waId}`); await expect(page.getByTestId('wa-object')).toHaveAttribute('data-status', 'CLOSED'); await expect(page.getByTestId('wa-actual-v')).toContainText('9');
  await expect(page.getByTestId('wa-uses')).toContainText('inv_issue'); await shot(page, '06-wa-closed', info);
  expect(errors, errors.join('\n')).toEqual([]);

  // ---- the work supervisor reads and raises nothing ----
  const w = await open(browser, info, c, 'WSUP', s.u('wsup'), '/site/work-authorisations'); const we = watch(w.page);
  if (info.project.name === 'desktop') await expect(w.page.getByTestId('list-site.work_authorisations')).toContainText('A10 Excavation'); else await expect(w.page.getByTestId('list-card')).toHaveCount(1); await expect(w.page.getByTestId('wa-new')).toHaveCount(0); await shot(w.page, '07-list-wsup', info); await noOverflow(w.page);
  expect(we, we.join('\n')).toEqual([]);
});
