import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Part 13.02 in the browser (development-header mode, port 3100): the planner moves a bar on the Gantt and the successors follow (server recalculation), undoes it, links two bars by dragging, meets a
// conflict that is shown before anything is saved, edits an activity from the panel, assigns resources; the histogram shows the masons over-allocated against the deployments and opens the activities
// behind a bar; availability is drafted by the planner and put in force by the project controls manager; the programme previews and downloads as a PDF; the site engineer sees the Gantt read-only.
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
const OUT = 'docs/erp/screenshots/plan-gantt';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['plan', ['PLAN']], ['pcm', ['PCMGR']], ['se', ['SE']], ['emp', ['EMP']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower G', 'BUILDING', 'ACTIVE')").run(c, `${t.toUpperCase()}-G`).lastInsertRowid);
  const w1 = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '1', 'Substructure', 1, 'e2e')").run(c, pid).lastInsertRowid);
  db.prepare("INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (?, ?, ?, '1.1', 'Footings', 2, 'e2e')").run(c, pid, w1);
  db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (?, ?, '2', 'Superstructure', 1, 'e2e')").run(c, pid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, steward_role) VALUES (?, ?, 'Plant', 'PL', 'PLANTMGR')").run(c, `${t.toUpperCase()}-PL`).lastInsertRowid);
  const crane = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (?, ?, 'Tower crane', 'EQUIPMENT', ?, 'hour', '2026-01-01', 'ACTIVE')").run(c, `${t.toUpperCase()}-CRANE`, cat).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (?, ?, ?, 'Site 1')").run(c, pid, `${t.toUpperCase()}-S1`).lastInsertRowid);
  const crew = Number(db.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (?, ?, ?, 'Masons gang', 'Mason')").run(c, site, `${t.toUpperCase()}-CRM`).lastInsertRowid);
  for (let i = 1; i <= 3; i += 1) db.prepare("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, crew_id, from_date, status) VALUES (?, ?, '2026-04-01', 'WORKER', ?, ?, ?, '2026-04-01', 'APPROVED')").run(c, `${t.toUpperCase()}-DEP/${i}`, 9000 + i, pid, crew);
  db.close();
  return { u: (k) => `${t}-${k}`, pid, crane };
}
const finish = async (page) => (await page.getByTestId('pgt-finish').textContent()).trim();

test('AC-01 planners edit the schedule on the Gantt, histograms show the resource loading, the programme exports as PDF', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `g${info.project.name[0]}${Date.now().toString(36).slice(-5)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t); const planner = s.u('plan');
  const cal = await api(request, c, 'PLAN', planner, 'post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' });
  await api(request, c, 'PCMGR', s.u('pcm'), 'post', `/plan/calendars/${cal.id}/activate`, {});
  const sch = await api(request, c, 'PLAN', planner, 'post', '/plan/schedules', { projectId: s.pid, name: 'Tower G working schedule', calendarId: cal.id, startDate: '2026-04-06' });
  await api(request, c, 'PLAN', planner, 'post', `/plan/schedules/${sch.id}/import`, { rows: [
    { code: 'A10', name: 'Excavation', wbsCode: '1.1', duration: 5 }, { code: 'A20', name: 'PCC under footings', wbsCode: '1.1', duration: 3, predecessors: 'A10' },
    { code: 'A30', name: 'Footing concrete', wbsCode: '1.1', duration: 2, predecessors: 'A20' }, { code: 'A40', name: 'Ground floor columns', wbsCode: '2', duration: 4 }, { code: 'M50', name: 'Plinth complete', wbsCode: '2', type: 'MILESTONE', duration: 0, predecessors: 'A30' }] });
  await api(request, c, 'PLAN', planner, 'post', `/plan/schedules/${sch.id}/calculate`, {});
  const desktop = info.project.name === 'desktop';

  // ---- the Gantt ----
  const r = await open(browser, info, c, 'PLAN', planner, `/plan/gantt?scheduleId=${sch.id}`); const errors = watch(r.page); const page = r.page;
  await expect(page.getByRole('heading', { name: 'Gantt Planner', level: 1 })).toBeVisible();
  await expect(page.getByTestId('pgt-bar')).toHaveCount(4); await expect(page.getByTestId('pgt-wbs').first()).toBeVisible();
  const f0 = await finish(page); expect(f0).toContain('2026');
  await shot(page, 'gantt', info); await noOverflow(page);
  if (desktop) {
    // drag A10 three days to the right: the server recalculates and the successors follow
    await page.evaluate(() => document.querySelector('[data-testid="pgt-chart"]').scrollIntoView({ block: 'end' }));
    const bar = page.locator('[data-testid="pgt-bar"][data-code="A10"] rect').first(); const box = await bar.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 9 * 3 + 2, box.y + box.height / 2, { steps: 6 }); await page.mouse.up();
    await expect(page.getByTestId('pgt-note')).toContainText('Moved A10'); await expect.poll(() => finish(page)).not.toBe(f0);
    await shot(page, 'gantt-moved', info);
    // undo restores the finish
    await page.getByTestId('pgt-note-undo').click(); await expect(page.getByTestId('pgt-note')).toContainText('Undone'); await expect.poll(() => finish(page)).toBe(f0);
    // link A30 to A40 by dragging the end dot of A30 onto A40
    await page.evaluate(() => document.querySelector('[data-testid="pgt-chart"]').scrollIntoView({ block: 'end' }));
    const dot = page.locator('[data-testid="pgt-bar"][data-code="A30"] [data-testid="pgt-linkdot"]'); const d = await dot.boundingBox(); const target = await page.locator('[data-testid="pgt-bar"][data-code="A40"] rect').first().boundingBox();
    await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2); await page.mouse.down(); await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 }); await page.mouse.up();
    await expect(page.getByTestId('pgt-note')).toContainText('Linked A30 FS A40');
    // a drag earlier than the logic allows: the conflict is shown before anything is saved
    await page.evaluate(() => document.querySelector('[data-testid="pgt-chart"]').scrollIntoView({ block: 'end' }));
    const b20 = await page.locator('[data-testid="pgt-bar"][data-code="A20"] rect').first().boundingBox();
    await page.mouse.move(b20.x + b20.width / 2, b20.y + b20.height / 2); await page.mouse.down(); await page.mouse.move(b20.x + b20.width / 2 - 9 * 6, b20.y + b20.height / 2, { steps: 6 }); await page.mouse.up();
    await expect(page.getByTestId('confirm-dialog')).toContainText('cannot start before'); await shot(page, 'gantt-conflict', info);
    await page.getByRole('button', { name: 'Keep as it is' }).click(); await expect(page.getByTestId('confirm-dialog')).not.toBeVisible();
  }
  // the panel: the keyboard way of the same edits
  await page.locator('[data-testid="pgt-row"][data-code="A40"] [data-testid="pgt-select"]').click(); await expect(page.getByTestId('pgt-panel')).toBeVisible();
  await page.getByTestId('pgt-edit-duration').fill('6'); await page.getByTestId('pgt-edit-save').click(); await expect(page.getByTestId('pgt-note')).toContainText('A40: 6 days');
  // resources of A10: four masons a day and the crane, 40 hours
  await page.locator('[data-testid="pgt-row"][data-code="A10"] [data-testid="pgt-select"]').click(); await expect(page.getByTestId('pres-panel')).toContainText('A10');
  await page.getByTestId('pres-edit').click(); await page.getByTestId('pres-add').click();
  const row1 = page.getByTestId('pres-edit-row').nth(0); await row1.getByTestId('pres-type').selectOption('LABOUR'); await row1.getByTestId('pres-trade').fill('Mason'); await row1.getByTestId('pres-basis').selectOption('PER_DAY'); await row1.getByTestId('pres-qty').fill('4');
  await page.getByTestId('pres-add').click(); const row2 = page.getByTestId('pres-edit-row').nth(1); await row2.getByTestId('pres-type').selectOption('PLANT');
  await row2.getByTestId('pres-item').selectOption(String(s.crane)); await row2.getByTestId('pres-qty').fill('40');
  await page.getByTestId('pres-save').click(); await expect(page.getByTestId('pres-row')).toHaveCount(2); await expect(page.getByTestId('pres-table')).toContainText('Mason');
  await shot(page, 'gantt-resources', info); await noOverflow(page);
  expect(errors, errors.join('\n')).toEqual([]);

  // ---- availability: drafted by the planner, put in force by the project controls manager ----
  const h = await open(browser, info, c, 'PLAN', planner, `/plan/histogram?scheduleId=${sch.id}`); const herr = watch(h.page);
  await expect(h.page.getByRole('heading', { name: 'Resource Histogram', level: 1 })).toBeVisible(); await expect(h.page.getByTestId('ph-res-row')).toHaveCount(2);
  await h.page.getByTestId('ph-cap-type').selectOption('PLANT'); await h.page.getByTestId('ph-cap-item').selectOption(String(s.crane));
  await h.page.getByTestId('ph-cap-qty').fill('6'); await h.page.getByTestId('ph-cap-from').fill('2026-04-01'); await h.page.getByTestId('ph-cap-to').fill('2026-06-30'); await h.page.getByTestId('ph-cap-reason').fill('One tower crane on hire, one shift');
  await h.page.getByTestId('ph-cap-save').click(); await expect(h.page.getByTestId('ph-cap-row')).toHaveAttribute('data-status', 'DRAFT'); await expect(h.page.getByTestId('ph-cap-activate')).toHaveCount(0);
  const m = await open(browser, info, c, 'PCMGR', s.u('pcm'), `/plan/histogram?scheduleId=${sch.id}`);
  await m.page.getByTestId('ph-cap-activate').click(); await expect(m.page.getByTestId('ph-cap-row')).toHaveAttribute('data-status', 'ACTIVE');
  // the histogram by day: the masons (4 a day against 3 deployed) are over-allocated; a bar opens its activities
  await h.page.reload(); await h.page.getByTestId('ph-bucket').selectOption('day');
  const mason = h.page.locator('[data-testid="ph-res-row"]', { hasText: 'Mason' }); await expect(mason).toHaveAttribute('data-over', '1'); await mason.getByTestId('ph-res-pick').click();
  await expect(h.page.locator('[data-testid="ph-bar"][data-over="1"]').first()).toBeVisible();
  await h.page.getByTestId('ph-drill').first().click(); await expect(h.page.getByTestId('ph-drill-row')).toContainText('A10');
  await shot(h.page, 'histogram', info); await noOverflow(h.page);
  expect(herr, herr.join('\n')).toEqual([]);

  // ---- the programme: preview, table by WBS node with totals, PDF ----
  const p = await open(browser, info, c, 'PLAN', planner, `/plan/programme?scheduleId=${sch.id}`); const perr = watch(p.page);
  await expect(p.page.getByRole('heading', { name: 'Printable Programme', level: 1 })).toBeVisible(); await expect(p.page.getByTestId('pr-preview').locator('img')).toBeVisible();
  await expect(p.page.getByTestId('pr-row')).toHaveCount(2); await expect(p.page.getByTestId('pr-table').locator('tfoot')).toContainText('5');
  const [dl] = await Promise.all([p.page.waitForEvent('download'), p.page.getByTestId('pr-pdf').click()]); const file = await dl.path(); expect(readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-');
  await shot(p.page, 'programme', info); await noOverflow(p.page);
  expect(perr, perr.join('\n')).toEqual([]);

  // ---- the site engineer sees the Gantt read-only; an employee has no right ----
  const v = await open(browser, info, c, 'SE', s.u('se'), `/plan/gantt?scheduleId=${sch.id}`);
  await expect(v.page.getByTestId('pgt-readonly')).toBeVisible(); await expect(v.page.getByTestId('pgt-undo')).toHaveCount(0); await expect(v.page.getByTestId('pgt-linkdot')).toHaveCount(0); await noOverflow(v.page);
  await shot(v.page, 'gantt-readonly', info);
  const n = await open(browser, info, c, 'EMP', s.u('emp'), '/plan/gantt'); await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible(); await shot(n.page, 'no-permission', info);
});
