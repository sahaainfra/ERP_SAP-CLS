import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode (port 3100).
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
const open = async (browser, info, c, roles, user, path, extra = {}) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch, ...extra });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });


const OUT = 'docs/erp/screenshots/bd';
const W = '/workflow';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', `${W}/tasks?mine=assigned`);
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `${W}/tasks/${task.id}/act`, { action, comment: 'checked it' });
};
function seedBd(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['bd1', ['BD']], ['bd2', ['BD']], ['dir', ['DIR']], ['est', ['EST']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, n, JSON.stringify(roles), `${t}-${n}@example.com`);
  const partner = (code, name, status) => { const id = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, ?, ?, 'PRIVATE_LIMITED', ?, 'COMMGR', 'e2e', 'e2e')").run(c, code, name, name.toLowerCase(), status).lastInsertRowid); db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, 'CLIENT')").run(c, id); return id; };
  const nhai = partner(`${t.toUpperCase()}C1`, 'National Highways Authority', 'ACTIVE'); partner(`${t.toUpperCase()}C2`, 'State PWD Maharashtra', 'PROSPECT');
  db.close();
  return { nhai, u: (k) => `${t}-${k}` };
}
const pick = async (page, id, text, name) => { await page.locator(`#${id}`).click(); await page.locator(`#${id}`).fill(text); await page.getByRole('option', { name }).first().click(); };

// Part 08.01: CRM. A business development executive records a lead on the form (BANT-like qualification), a colleague qualifies it, it is converted to an opportunity; the go-ahead for tendering (a colleague, then the director for ₹12 crore) is given;
// the opportunity moves on the pipeline board (drag or the move list) and by the pipeline tab, with a probability that needs a reason; competitors; an interaction with a next action; the client page with the influence map; the dashboard with the weighted
// forecast; Hindi. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 a lead is qualified and converted, the opportunity gets the go-ahead, moves on the pipeline, with interactions, competitors, the influence map, the forecast and Hindi, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(540_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'BDM' : 'BDD');
  const t = phone ? 'bdm' : 'bdd';
  const g = seedBd(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  // the lead on the form
  const bd1 = await open(browser, info, c, 'BD', g.u('bd1'), '/bd/lead/new');
  const errors = watch(bd1.page);
  await expect(bd1.page.getByTestId('lead-new')).toBeVisible();
  await bd1.page.getByTestId('ld-title').fill('Godavari bridge at Nashik'); await bd1.page.getByTestId('ld-source').selectOption('TENDER_PORTAL'); await bd1.page.getByTestId('ld-source-ref').fill('GEM-2027-4471');
  await pick(bd1.page, 'ld-client', 'National', /National Highways/);
  await bd1.page.getByTestId('ld-contact').fill('R. Deshmukh'); await bd1.page.getByTestId('ld-phone').fill('+91 98220 12345'); await bd1.page.getByTestId('ld-sector').selectOption('BRIDGES'); await bd1.page.getByTestId('ld-location').fill('Nashik'); await bd1.page.getByTestId('ld-region').selectOption('WEST'); await bd1.page.getByTestId('ld-value').fill('120000000');
  for (const k of ['budget', 'authority', 'need']) await bd1.page.getByTestId(`ld-${k}`).selectOption('YES');
  await bd1.page.getByTestId('ld-timeline').selectOption('PARTIAL');
  if (phone) await noOverflow(bd1.page);
  await shot(bd1.page, '01-new-lead');
  await bd1.page.getByTestId('ld-save-send').click();
  await expect(bd1.page.getByTestId('lead')).toHaveAttribute('data-status', 'SUBMITTED');
  await expect(bd1.page.getByTestId('ld-fig-score')).toContainText('83/100');
  const leadId = Number(new URL(bd1.page.url()).searchParams.get('id'));
  const lead = await api(request, c, 'BD', g.u('bd1'), 'get', `/bd/leads/${leadId}`);
  await decide(request, c, 'BD', g.u('bd2'), lead.workflowInstanceId);
  await bd1.page.reload();
  await expect(bd1.page.getByTestId('lead')).toHaveAttribute('data-status', 'APPROVED');
  if (phone) await noOverflow(bd1.page);
  await shot(bd1.page, '02-lead-qualified');
  // interaction on the lead, then the conversion
  await bd1.page.getByTestId('tab-interactions').click();
  await bd1.page.getByTestId('int-type').selectOption('MEETING'); await bd1.page.getByTestId('int-participants').fill('R. Deshmukh, S. Rao'); await bd1.page.getByTestId('int-notes').fill('Site visit with the chief engineer; the bridge is funded.');
  await bd1.page.getByTestId('int-next').fill('Send the company credentials'); await bd1.page.getByTestId('int-next-date').fill(new Date(Date.now() + 5.5 * 3_600_000 + 3 * 86_400_000).toISOString().slice(0, 10));
  await bd1.page.getByTestId('int-save').click();
  await expect(bd1.page.getByTestId('int-note')).toContainText('logged');
  await expect(bd1.page.getByTestId('int-row')).toHaveCount(1);
  await shot(bd1.page, '03-lead-interaction');
  await bd1.page.getByTestId('tab-details').click();
  await bd1.page.getByTestId('ld-convert').click();
  await expect(bd1.page.getByTestId('opportunity')).toBeVisible();
  await expect(bd1.page.getByTestId('opportunity')).toHaveAttribute('data-stage', 'QUALIFIED');
  await expect(bd1.page.getByTestId('op-fig-prob')).toContainText('15%');
  const oppId = Number(new URL(bd1.page.url()).searchParams.get('id'));
  // a stage that pursues a tender is refused until the go-ahead
  await bd1.page.getByTestId('tab-pipeline').click();
  await bd1.page.getByTestId('op-track-stage').selectOption('PRE_BID'); await bd1.page.getByTestId('op-track-save').click();
  await expect(bd1.page.getByTestId('op-error')).toContainText('go-ahead');
  // the go-ahead: a colleague, then the director because the value is above ₹10 crore
  await bd1.page.getByTestId('op-submit').click();
  await expect(bd1.page.getByTestId('opportunity')).toHaveAttribute('data-status', 'SUBMITTED');
  const opp = await api(request, c, 'BD', g.u('bd1'), 'get', `/bd/opportunities/${oppId}`);
  await decide(request, c, 'BD', g.u('bd2'), opp.workflowInstanceId); await decide(request, c, 'DIR', g.u('dir'), opp.workflowInstanceId);
  await bd1.page.reload();
  await expect(bd1.page.getByTestId('opportunity')).toHaveAttribute('data-status', 'APPROVED');
  await bd1.page.getByTestId('tab-pipeline').click();
  await bd1.page.getByTestId('op-track-stage').selectOption('PRE_BID');
  await bd1.page.getByTestId('op-track-prob').fill('40'); await bd1.page.getByTestId('op-track-save').click();
  await expect(bd1.page.getByTestId('op-error')).toContainText('why');
  await bd1.page.getByTestId('op-track-prob-reason').fill('The client asked us to present'); await bd1.page.getByTestId('op-track-save').click();
  await expect(bd1.page.getByTestId('op-fig-prob')).toContainText('40%');
  await expect(bd1.page.getByTestId('opportunity')).toHaveAttribute('data-stage', 'PRE_BID');
  await expect(bd1.page.getByTestId('op-fig-weighted')).toContainText('4,80,00,000');
  await bd1.page.getByTestId('tab-competitors').click();
  await bd1.page.getByTestId('comp-add').click(); await bd1.page.getByTestId('comp-name').first().fill('L&T Construction'); await bd1.page.getByTestId('comp-strength').first().selectOption('STRONG'); await bd1.page.getByTestId('comp-save').click();
  await expect(bd1.page.getByTestId('op-note')).toContainText('saved');
  if (phone) await noOverflow(bd1.page);
  await shot(bd1.page, '04-opportunity');
  // the pipeline board: the card sits in Pre-bid; moving it with the list
  await bd1.page.goto('/bd/pipeline');
  await expect(bd1.page.getByTestId('pipeline')).toBeVisible();
  await expect(bd1.page.locator('[data-testid="pp-col"][data-stage="PRE_BID"] [data-testid="pp-card"]')).toHaveCount(1);
  if (phone) await noOverflow(bd1.page);
  await shot(bd1.page, '05-pipeline');
  await bd1.page.locator('[data-testid="pp-col"][data-stage="PRE_BID"] [data-testid="pp-move"]').selectOption('TENDER_EXPECTED');
  await expect(bd1.page.getByTestId('pp-error')).toContainText('expected award');
  await api(request, c, 'BD', g.u('bd1'), 'post', `/bd/opportunities/${oppId}/track`, { expectedAwardDate: '2027-09-30', version: (await api(request, c, 'BD', g.u('bd1'), 'get', `/bd/opportunities/${oppId}`)).rowVersion });
  await bd1.page.reload();
  await bd1.page.locator('[data-testid="pp-col"][data-stage="PRE_BID"] [data-testid="pp-move"]').selectOption('TENDER_EXPECTED');
  await expect(bd1.page.locator('[data-testid="pp-col"][data-stage="TENDER_EXPECTED"] [data-testid="pp-card"]')).toHaveCount(1);
  // the client: contacts with the influence map
  await bd1.page.goto(`/bd/client?id=${g.nhai}`);
  await expect(bd1.page.getByTestId('client360')).toBeVisible();
  await expect(bd1.page.getByTestId('c360-open')).toHaveText('1');
  await bd1.page.getByTestId('tab-contacts').click();
  await bd1.page.getByTestId('ct-name').fill('S. Rao'); await bd1.page.getByTestId('ct-designation').fill('Member (Projects)'); await bd1.page.getByTestId('ct-role').selectOption('DECISION_MAKER'); await bd1.page.getByTestId('ct-level').fill('5'); await bd1.page.getByTestId('ct-stance').selectOption('NEUTRAL'); await bd1.page.getByTestId('ct-save').click();
  await expect(bd1.page.getByTestId('contact')).toHaveCount(1);
  await expect(bd1.page.getByTestId('map-warnings')).toContainText('not yet a supporter');
  if (phone) await noOverflow(bd1.page);
  await shot(bd1.page, '06-client-360');
  await bd1.page.getByTestId('tab-interactions').click();
  await expect(bd1.page.getByTestId('int-row').first()).toBeVisible();
  // the dashboard: the weighted forecast
  await bd1.page.goto('/bd');
  await expect(bd1.page.getByTestId('bd-dashboard')).toBeVisible();
  await expect(bd1.page.getByTestId('tile-open')).toHaveText('1');
  await expect(bd1.page.getByTestId('tile-weighted')).toContainText('4.20 Cr');
  await expect(bd1.page.getByTestId('bd-by-stage')).toContainText('Tender expected');
  await expect(bd1.page.getByTestId('bd-followups')).toContainText('Send the company credentials');
  if (phone) await noOverflow(bd1.page);
  await shot(bd1.page, '07-dashboard');
  // lists; the estimation manager reads only
  await bd1.page.goto('/bd/leads'); await expect(bd1.page.getByTestId('leads')).toBeVisible(); if (phone) await noOverflow(bd1.page); await shot(bd1.page, '08-leads');
  const est = await open(browser, info, c, 'EST', g.u('est'), '/bd/opportunities');
  const eErrors = watch(est.page);
  await expect(est.page.getByTestId('opportunities')).toBeVisible();
  await est.page.goto(`/bd/opportunity?id=${oppId}`);
  await expect(est.page.getByTestId('opportunity')).toBeVisible();
  await expect(est.page.getByTestId('op-actions').getByRole('button')).toHaveCount(0);
  // Hindi
  const hi = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch });
  const hp = await hi.newPage();
  const hiErrors = watch(hp);
  await hp.addInitScript((v) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'hi' })); }, { user: g.u('bd1'), roles: 'BD', company: String(c) });
  await hp.goto('/bd');
  await expect(hp.getByRole('heading', { level: 1 })).toHaveText('व्यवसाय विकास डैशबोर्ड');
  if (phone) await noOverflow(hp);
  await shot(hp, '09-hindi');
  expect([...errors, ...eErrors, ...hiErrors]).toEqual([]);
});
