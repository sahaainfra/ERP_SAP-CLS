import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100). Part 05.01: the Messages app: a direct conversation started from the New page, messages with a file and a record card, the other person's list with an unread count, a reply
// that arrives without a reload, the three-pane layout on a computer and the single pane on a phone, the pop-out window and the dock over another page.
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

// Part 05.04: the Communication Center. A manager makes a message an instruction; the people it is for see it on the Center and acknowledge it; the register shows the percentage; a message becomes a task; an announcement with a quiz
// is read and confirmed; the auto group rules change only after approval and then keep a discipline group of the people assigned to a project.
const act = async (request, c, roles, user, instanceId) => {
  const rows = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = rows.rows.find((x) => x.instance.id === instanceId);
  expect(task, `${user} has the task`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action: 'approve', comment: 'checked and fine' });
};

test('AC-01 AC-02 FR-02 FR-03 FR-05 the Center, an instruction with acknowledgement and register, a message turned into a task', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const c = await company(request, `CC${tag}`);
  const [pm, s1, s2] = [`e2e-kpm${t}`, `e2e-kse${t}`, `e2e-kse2${t}`];
  people(c, [[pm, ['PM'], 'Meera Manager'], [s1, ['SE'], 'Sanjay Engineer'], [s2, ['SE'], 'Sunil Engineer']]);
  const conv = (await api(request, c, 'PM', pm, 'post', '/msg/conversations', { type: 'GROUP', title: 'Pier 4 crew', members: [s1, s2] })).id;
  await api(request, c, 'PM', pm, 'post', `/msg/conversations/${conv}/messages`, { body: 'Stop all concreting on pier 4 until the pump is re-calibrated' });
  const errors = [];
  // the manager marks the message as an instruction
  const a = await open(browser, info, c, 'PM', pm, `/collab/messages?c=${conv}`);
  errors.push(...watch(a.page));
  const bubble = a.page.getByTestId('msg').filter({ hasText: 'Stop all concreting' });
  await expect(bubble).toBeVisible();
  await bubble.getByTestId('msg-more').click();
  await a.page.getByTestId('msg-instruction').click();
  await a.page.getByTestId('instr-priority').selectOption('HIGH');
  await a.page.getByTestId('instr-send').click();
  await expect(a.page.getByTestId('instruction-badge')).toContainText('0 of 2 acknowledged');
  await noOverflow(a.page);
  // a person it is for: the Center shows it, the worklist lets them acknowledge it
  const b = await open(browser, info, c, 'SE', s1, '/collab/center');
  errors.push(...watch(b.page));
  await expect(b.page.getByRole('heading', { name: 'Communication Center', level: 1 })).toBeVisible();
  await expect(b.page.getByTestId('tile-acks')).toContainText('1');
  await expect(b.page.getByTestId('cc-pending-row')).toContainText('Stop all concreting');
  await noOverflow(b.page);
  await b.page.getByTestId('tile-acks').click();
  await expect(b.page.getByRole('heading', { name: 'Pending Acknowledgements', level: 1 })).toBeVisible();
  await expect(b.page.getByTestId('pa-row')).toHaveCount(1);
  await b.page.getByTestId('pa-ack').click();
  await expect(b.page.getByTestId('pa-notice')).toContainText('acknowledged');
  await expect(b.page.getByText('Nothing to acknowledge')).toBeVisible();
  // a message becomes a task: a record that is not live is refused, the task is made and linked back
  await b.page.goto(`/collab/messages?c=${conv}`);
  const bb = b.page.getByTestId('msg').filter({ hasText: 'Stop all concreting' });
  await bb.getByTestId('msg-more').click();
  await b.page.getByTestId('msg-to-action').click();
  await b.page.getByTestId('action-type').selectOption('NCR');
  await expect(b.page.getByTestId('action-unavailable')).toContainText('18.04');
  await expect(b.page.getByTestId('action-go')).toBeDisabled();
  await b.page.getByTestId('action-type').selectOption('TASK');
  await expect(b.page.getByTestId('action-title')).toHaveValue(/Stop all concreting/);
  await b.page.getByTestId('action-go').click();
  await expect(b.page.getByTestId('action-made')).toContainText('was made');
  await expect(b.page.getByTestId('action-link')).toBeVisible();
  await b.page.getByRole('button', { name: 'Close' }).click();
  await expect(b.page.getByTestId('action-chips').first()).toContainText('Task');
  // the register: 1 of 2 acknowledged, the recipients, the export
  const r = await open(browser, info, c, 'PM', pm, '/collab/instructions');
  errors.push(...watch(r.page));
  await expect(r.page.getByRole('heading', { name: 'Instruction Register', level: 1 })).toBeVisible();
  await expect(r.page.getByTestId('ir-row')).toContainText('1 of 2 (50%)');
  await r.page.getByTestId('ir-open').click();
  await expect(r.page.getByTestId('ir-recipient')).toHaveCount(2);
  await expect(r.page.getByTestId('ir-recipient').filter({ hasText: 'Sanjay' })).not.toContainText('Not yet');
  const dl = r.page.waitForEvent('download');
  await r.page.getByTestId('ir-export').click();
  expect((await dl).suggestedFilename()).toBe('instruction-register.csv');
  await noOverflow(r.page);
  // a person without the right does not get the register
  const n = await open(browser, info, c, 'SE', s1, '/collab/instructions');
  await expect(n.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('AC-01 AC-02 FR-04 an announcement with a quiz: written, counted, published, read, confirmed, tracked', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const c = await company(request, `CA${tag}`);
  const [pm, s1, s2] = [`e2e-apm${t}`, `e2e-ase${t}`, `e2e-ase2${t}`];
  people(c, [[pm, ['PM'], 'Meera Manager'], [s1, ['SE'], 'Sanjay Engineer'], [s2, ['SE'], 'Sunil Engineer']]);
  const a = await open(browser, info, c, 'PM', pm, '/collab/announcements/new');
  const errors = watch(a.page);
  await expect(a.page.getByRole('heading', { name: 'New Announcement', level: 1 })).toBeVisible();
  await expect(a.page.getByTestId('na-count')).toContainText('Choose who');
  await a.page.getByTestId('na-title-input').fill('Monsoon safety briefing');
  await a.page.getByTestId('na-body').fill('Work at height stops when the wind passes 40 km/h.');
  await a.page.getByTestId('na-role-SE').check();
  await expect(a.page.getByTestId('na-count')).toContainText('2 people', { timeout: 15_000 });
  await a.page.getByTestId('na-add-q').click();
  await a.page.getByTestId('na-q-0').fill('At what wind speed does work at height stop?');
  await a.page.getByTestId('na-q-0-o-0').fill('20 km/h');
  await a.page.getByTestId('na-q-0-o-1').fill('40 km/h');
  await a.page.getByTestId('na-q-0-c-1').check();
  await a.page.getByTestId('na-publish').click();
  await expect(a.page.getByTestId('announcement')).toBeVisible({ timeout: 20_000 });
  await expect(a.page.getByTestId('an-stats')).toContainText('2 recipients');
  await noOverflow(a.page);
  // the recipient reads it and answers the quiz: wrong first, then right
  const b = await open(browser, info, c, 'SE', s1, '/collab/announcements');
  errors.push(...watch(b.page));
  await expect(b.page.getByTestId('an-row')).toContainText('Monsoon safety briefing');
  await b.page.getByTestId('an-open').click();
  await expect(b.page.getByTestId('an-body')).toContainText('40 km/h');
  await b.page.getByTestId('an-q0-0').check();
  await b.page.getByTestId('an-confirm-go').click();
  await expect(b.page.getByTestId('an-wrong')).toBeVisible();
  await b.page.getByTestId('an-q0-1').check();
  await b.page.getByTestId('an-confirm-go').click();
  await expect(b.page.getByTestId('an-confirmed')).toContainText('quiz 1 of 1');
  await noOverflow(b.page);
  // the author sees who read and confirmed it
  await a.page.reload();
  await expect(a.page.getByTestId('an-stats')).toContainText('confirmed 1 (50%)');
  await expect(a.page.getByTestId('an-recipient').filter({ hasText: 'Sunil' })).toContainText('Not yet');
  expect(errors).toEqual([]);
});

test('AC-04 FR-01 auto group rules: changed only after approval, then the discipline group has the people assigned to the project', async ({ browser, request }, info) => {
  test.setTimeout(180_000);
  const phone = info.project.name === 'mobile';
  const tag = phone ? 'M' : 'D';
  const t = tag.toLowerCase();
  const c = await company(request, `CG${tag}`);
  const [sys, it, se] = [`e2e-gsys${t}`, `e2e-git${t}`, `e2e-gse${t}`];
  people(c, [[sys, ['SYSADM'], 'Sam Admin'], [it, ['ITADM'], 'Ira IT'], [se, ['SE'], 'Sanjay Engineer']]);
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (?, ?, 'Ring Road', 'ROAD', 'ACTIVE', 'e2e', 'e2e')").run(c, `RR${tag}`).lastInsertRowid);
  const uid = Number(db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND username = ?').get(c, se).id);
  db.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, reason, created_by, source_type) VALUES (?, ?, (SELECT id FROM iam_roles WHERE code = 'SE' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'e2e', 'e2e', 'e2e')").run(c, uid, JSON.stringify([project]));
  db.close();
  const a = await open(browser, info, c, 'SYSADM', sys, '/admin/auto-groups');
  const errors = watch(a.page);
  await expect(a.page.getByRole('heading', { name: 'Auto Groups', level: 1 })).toBeVisible();
  await expect(a.page.getByTestId('ag-rule')).toHaveCount(3);
  await a.page.getByTestId('ag-add').click();
  await a.page.getByTestId('ag-title-3').fill('Civil');
  await a.page.getByTestId('ag-roles-3').fill('SE');
  await a.page.getByTestId('ag-reason').fill('Civil engineers need their own group');
  await a.page.getByTestId('ag-submit').click();
  await expect(a.page.getByTestId('ag-notice')).toContainText('sent for approval');
  await expect(a.page.getByTestId('ag-pending')).toBeVisible();
  const inst = (await api(request, c, 'SYSADM', sys, 'get', '/msg/auto-group-rules')).pending[0].instanceId;
  await act(request, c, 'ITADM', it, inst);
  await a.page.reload();
  await expect(a.page.getByTestId('ag-rule')).toHaveCount(4);
  await expect(a.page.getByTestId('ag-group').filter({ hasText: 'Civil' })).toContainText('1');
  await expect(a.page.getByTestId('ag-history-row').first()).toContainText('In force');
  await noOverflow(a.page);
  // the person is in the group in Messages, under Teams, with the system message
  const m = await open(browser, info, c, 'SE', se, '/collab/messages?view=TEAM');
  errors.push(...watch(m.page));
  await expect(m.page.getByTestId('msg-list')).toContainText('Civil');
  await m.page.locator('[data-testid^="conv-"]').first().click();
  await expect(m.page.getByTestId('msg-system').filter({ hasText: 'joined' })).toBeVisible();
  expect(errors).toEqual([]);
});
