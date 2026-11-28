import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// PACK-20 (flag ff.plan.pack20): the Gantt on a tablet (768 x 1024 portrait and 1024 x 768 landscape, touch). The page does not scroll sideways (the chart scrolls
// inside its own box), the row targets are at least 44 px, a tap selects an activity and its panel edits it, and the server recalculates (A40 made longer than the 10-day footing path moves the finish).
// Dragging a bar by touch is NOT VERIFIED here (Playwright has no touch drag); the panel is the touch path. Screenshots go to pack-reports/.
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
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });
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
const OUT = 'pack-reports/screens/pack20';

for (const [label, viewport] of [['tablet-portrait', { width: 768, height: 1024 }], ['tablet-landscape', { width: 1024, height: 768 }]]) {
  test(`PACK-20 the Gantt on a ${label}: no sideways page scroll, 44 px targets, tap to select and edit, the server recalculates`, async ({ browser, request }, info) => {
    test.skip(info.project.name !== 'desktop', 'one run is enough: the viewport is set here');
    test.setTimeout(180_000);
    const t = `gt${label[7]}${Date.now().toString(36).slice(-5)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t); const planner = s.u('plan');
    const f = await request.patch('/api/v1/core/feature-flags/ff.plan.pack20', { headers: H('SYSADM', c, 'e2e-setup'), data: { scope: { level: 'company', companyId: c }, enabled: true, reason: 'e2e: PACK-20' } }); expect(f.status(), await f.text()).toBeLessThan(300);
    const cal = await api(request, c, 'PLAN', planner, 'post', '/plan/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' });
    await api(request, c, 'PCMGR', s.u('pcm'), 'post', `/plan/calendars/${cal.id}/activate`, {});
    const sch = await api(request, c, 'PLAN', planner, 'post', '/plan/schedules', { projectId: s.pid, name: 'Tower G working schedule', calendarId: cal.id, startDate: '2026-04-06' });
    await api(request, c, 'PLAN', planner, 'post', `/plan/schedules/${sch.id}/import`, { rows: [
      { code: 'A10', name: 'Excavation', wbsCode: '1.1', duration: 5 }, { code: 'A20', name: 'PCC under footings', wbsCode: '1.1', duration: 3, predecessors: 'A10' },
      { code: 'A30', name: 'Footing concrete', wbsCode: '1.1', duration: 2, predecessors: 'A20' }, { code: 'A40', name: 'Ground floor columns', wbsCode: '2', duration: 4 }, { code: 'M50', name: 'Plinth complete', wbsCode: '2', type: 'MILESTONE', duration: 0, predecessors: 'A30' }] });
    await api(request, c, 'PLAN', planner, 'post', `/plan/schedules/${sch.id}/calculate`, {});
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport, hasTouch: true, isMobile: false }); const page = await context.newPage();
    await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user: planner, roles: 'PLAN', company: String(c) });
    const errors = watch(page); await page.goto(`/plan/gantt?scheduleId=${sch.id}`);
    await expect(page.getByTestId('pgt-bar')).toHaveCount(4); await noOverflow(page);
    const chart = await page.getByTestId('pgt-chart').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, ox: getComputedStyle(el).overflowX }));
    expect(['auto', 'scroll']).toContain(chart.ox);
    const sel = page.locator('[data-testid="pgt-row"][data-code="A40"] [data-testid="pgt-select"]'); const box = await sel.boundingBox(); expect(box.height, 'row select target').toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${OUT}/${label}-1-gantt.png`, fullPage: true });
    const f0 = await finish(page); await sel.tap(); await expect(page.getByTestId('pgt-panel')).toBeVisible();
    await page.getByTestId('pgt-edit-duration').fill('14'); await page.getByTestId('pgt-edit-save').tap(); await expect(page.getByTestId('pgt-note')).toContainText('A40: 14 days');
    await expect.poll(() => finish(page)).not.toBe(f0); await noOverflow(page); await page.screenshot({ path: `${OUT}/${label}-2-edited.png`, fullPage: true });
    expect(errors, errors.join('\n')).toEqual([]); await context.close();
  });
}
