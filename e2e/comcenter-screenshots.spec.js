import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 05.01: the Messages app: a direct conversation started from the New page, messages with a file and a record card, the other person's list with an unread count, a reply
// that arrives without a reload, the three-pane layout on a computer and the single pane on a phone, the pop-out window and the dock over another page.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
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
  await api(request, id, 'SYSADM', 'e2e-setup', 'post', '/core/number-series', { docType: 'SAMPLE_DOC', name: 'Sample documents', prefix: 'SMP', format: '{PREFIX}/{FY}/{SEQ:4}', resetRule: 'financial_year', reason: 'initial set-up' });
  return id;
}
// the people of the company: written straight into the throw-away database of the run (the dev-header mode has no sign-in to make them)
function people(c, list) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [name, roles, display] of list) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, name, display, JSON.stringify(roles), `${name}@example.com`);
  db.close();
}
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

// Screenshots of the 05.04 pages for docs/erp/screenshots/comcenter. Only with SHOTS=1; the normal run skips it.
test.skip(!process.env.SHOTS, 'screenshots are taken on request only');
const OUT = 'docs/erp/screenshots/comcenter';
const act = async (request, c, roles, user, instanceId) => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked and fine' });
};


test('screenshots of the Communication Center pages', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, `CS${tag}`);
  const [sys, it, pm, s1, s2] = [`shot-csys${t}`, `shot-cit${t}`, `shot-cpm${t}`, `shot-cse${t}`, `shot-cse2${t}`];
  people(c, [[sys, ['SYSADM'], 'Sam Admin'], [it, ['ITADM'], 'Ira IT'], [pm, ['PM'], 'Meera Manager'], [s1, ['SE'], 'Sanjay Engineer'], [s2, ['SE'], 'Sunil Engineer']]);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, ?, 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')").run(c, `RR${tag}`).lastInsertRowid);
  for (const u of [s1, s2]) { const uid = Number(db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(c, u).id); db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, reason, created_by, source_type) VALUES (?, ?, (SELECT id FROM iam_roles WHERE code = 'SE' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'e2e', 'e2e', 'e2e')").run(c, uid, JSON.stringify([project])); }
  db.close();
  const rules = await api(request, c, 'SYSADM', sys, 'post', '/msg/auto-group-rules/changes', { rules: [{ groupType: 'PROJECT', scopeType: 'COMPANY' }, { groupType: 'SITE', scopeType: 'COMPANY' }, { groupType: 'DEPARTMENT', scopeType: 'COMPANY' }, { groupType: 'DISCIPLINE', scopeType: 'COMPANY', title: 'Civil', roleFilter: ['SE'] }], reason: 'Civil engineers need their own group' });
  await act(request, c, 'ITADM', it, rules.workflow.id);
  const conv = (await api(request, c, 'PM', pm, 'post', '/msg/conversations', { type: 'GROUP', title: 'Pier 4 crew', members: [s1, s2] })).id;
  const m1 = await api(request, c, 'PM', pm, 'post', `/msg/conversations/${conv}/messages`, { body: 'Stop all concreting on pier 4 until the pump is re-calibrated' });
  await api(request, c, 'PM', pm, 'post', `/msg/messages/${m1.id}/instruction`, { priority: 'URGENT', dueAt: new Date(Date.now() + 86_400_000).toISOString(), title: 'Stop concreting on pier 4' });
  const m2 = await api(request, c, 'PM', pm, 'post', `/msg/conversations/${conv}/messages`, { body: 'Daily progress report by 6 pm' });
  await api(request, c, 'PM', pm, 'post', `/msg/messages/${m2.id}/instruction`, { priority: 'NORMAL', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), title: 'Daily progress report' });
  await api(request, c, 'SE', s2, 'post', `/msg/instructions/${(await api(request, c, 'SE', s2, 'get', '/msg/acknowledgements/pending')).rows[0].id}/ack`, { response: 'Pump isolated' });
  const ann = await api(request, c, 'PM', pm, 'post', '/msg/announcements', { title: 'Monsoon safety briefing', body: 'Work at height stops when the wind passes 40 km/h. Anchor all loose material before 5 pm.', audience: { roles: ['SE'] }, requireConfirmation: true, quiz: [{ q: 'At what wind speed does work at height stop?', options: ['20 km/h', '40 km/h', '60 km/h'], correct: 1 }] });
  await api(request, c, 'PM', pm, 'post', `/msg/announcements/${ann.id}/publish`, {});
  const shot = async (page, name, full = false) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: full }); };
  const a = await open(browser, info, c, 'SE', s1, '/collab/center');
  await expect(a.page.getByTestId('tile-acks')).toContainText('2');
  await shot(a.page, '01-communication-center', true);
  await a.page.goto('/collab/acknowledgements');
  await expect(a.page.getByTestId('pa-row')).toHaveCount(2);
  await shot(a.page, '02-pending-acknowledgements');
  await a.page.goto(`/collab/messages?c=${conv}`);
  await expect(a.page.getByTestId('instruction-badge').first()).toBeVisible();
  await a.page.getByTestId('msg').filter({ hasText: 'Stop all concreting' }).getByTestId('msg-more').click();
  await a.page.getByTestId('msg-to-action').click();
  await expect(a.page.getByTestId('action-title')).toBeVisible();
  await shot(a.page, '03-message-to-action');
  const r = await open(browser, info, c, 'PM', pm, '/collab/instructions');
  await expect(r.page.getByTestId('ir-row')).toHaveCount(2);
  await r.page.getByTestId('ir-open').first().click();
  await expect(r.page.getByTestId('ir-recipient')).toHaveCount(2);
  await shot(r.page, '04-instruction-register', true);
  const n = await open(browser, info, c, 'PM', pm, '/collab/announcements/new');
  await n.page.getByTestId('na-title-input').fill('Diesel delivery on Friday');
  await n.page.getByTestId('na-body').fill('The diesel tanker arrives at the yard on Friday morning. Keep the bay clear.');
  await n.page.getByTestId('na-role-SE').check();
  await n.page.getByTestId('na-confirm').check();
  await expect(n.page.getByTestId('na-count')).toContainText('2 people', { timeout: 15_000 });
  await shot(n.page, '05-new-announcement', true);
  const l = await open(browser, info, c, 'SE', s1, `/collab/announcements?a=${ann.id}`);
  await expect(l.page.getByTestId('an-confirm')).toBeVisible();
  await shot(l.page, '06-announcement-quiz', true);
  const g = await open(browser, info, c, 'SYSADM', sys, '/admin/auto-groups');
  await expect(g.page.getByTestId('ag-group').first()).toBeVisible();
  await shot(g.page, '07-auto-groups', true);
  const t2 = await open(browser, info, c, 'SE', s1, '/collab/messages?view=TEAM');
  await expect(t2.page.getByTestId('msg-list')).toContainText('Civil');
  await shot(t2.page, '08-teams-view');
});
