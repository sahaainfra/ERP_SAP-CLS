import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 14.04 in the browser (development-header mode, port 3100): the construction manager registers an engineer's instruction with a cost implication on the phone (notice due, variation pending), cannot close it
// until the commercial manager records the variation decision; issues an internal instruction to a subcontractor; the subcontractor coordinator acknowledges it and records compliance with a photograph; it closes.
// An instruction with a back-charge goes to the second construction manager and the project manager before it is issued. Desktop and phone, no console errors, no sideways scroll.
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}` });
function watch(page) {
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|status of (400|401|403|404|409|410|422|429)|WebSocket|socket\.io|ERR_INTERNET_DISCONNECTED|Cannot reach the server|net::ERR/.test(m.text()) && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
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
const OUT = 'docs/erp/screenshots/site-instructions';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const ist = (n) => new Date(Date.now() + 19_800_000 - n * 86_400_000).toISOString().slice(0, 10);

function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['cm', ['CM']], ['cm2', ['CM']], ['pm', ['PM']], ['subco', ['SUBCO']], ['com', ['COMMGR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower I', 'BUILDING', 'ACTIVE')").run(c, `${T}-I`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower I site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  const sub = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, 'Shree Shuttering', ?, 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'e2e', 'e2e')").run(c, `${T}-SUB`, `shree ${T}`).lastInsertRowid);
  db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, created_by, source_type) VALUES (?, ?, 'SUBCONTRACTOR', 'e2e', 'e2e')").run(c, sub);
  db.close(); return { u: (k) => `${t}-${k}`, pid, site, sub };
}

test('instructions are registered, issued, acknowledged, complied with and closed', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `i${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t);
  const cm = await open(browser, info, c, 'CM', s.u('cm'), '/site/instruction-issue'); const p = cm.page; const errors = watch(p);
  // received, with a cost implication
  await expect(p.getByTestId('ins-form')).toBeVisible(); await p.getByTestId('ins-site').selectOption({ index: 1 }); await p.getByTestId('ins-type').selectOption('EI'); await p.getByTestId('ins-date').fill(ist(1)); await p.getByTestId('ins-ref').fill('EI/12'); await p.getByTestId('ins-from').fill('Engineer: Mehta Associates');
  await p.getByTestId('ins-subject').fill('Increase the raft thickness to 900 mm'); await p.getByTestId('ins-desc').fill('Raft thickness increased from 800 to 900 mm on the east side'); await p.getByTestId('ins-cost').check(); await expect(p.getByTestId('ins-notice-help')).toBeVisible(); await noOverflow(p); await shot(p, 'issue-form', info);
  await p.getByTestId('ins-send').click(); await expect(p.getByTestId('ins-object')).toHaveAttribute('data-status', 'OPEN'); await expect(p.getByTestId('ins-variation-pending')).toBeVisible(); await expect(p.getByTestId('ins-notice')).toBeVisible(); const rid = Number(new URL(p.url()).searchParams.get('id'));
  await p.getByTestId('ins-close-open').click(); await p.getByTestId('ins-close-notes').fill('Work completed on site'); await p.getByTestId('ins-close-go').click(); await expect(p.getByTestId('ins-obj-error')).toContainText(/variation/i);
  const com = await open(browser, info, c, 'COMMGR', s.u('com'), `/site/instructions?id=${rid}`); await com.page.getByTestId('ins-vd-ref').fill('VO-014'); await com.page.getByTestId('ins-vd-go').click(); await expect(com.page.getByTestId('ins-variation-done')).toContainText('VO-014'); await com.context.close();
  await p.reload(); await p.getByTestId('ins-close-open').click(); await p.getByTestId('ins-close-notes').fill('Work completed on site and measured'); await p.getByTestId('ins-close-go').click(); await expect(p.getByTestId('ins-object')).toHaveAttribute('data-status', 'CLOSED'); await shot(p, 'received', info);
  // issued to a subcontractor, acknowledged and complied with
  await p.goto('/site/instruction-issue'); await p.getByTestId('ins-site').selectOption({ index: 1 }); await p.getByTestId('ins-type').selectOption('ISI'); await p.getByTestId('ins-from').fill('Construction manager'); await p.getByTestId('ins-to').fill('Shree Shuttering');
  await p.getByTestId('ins-subject').fill('Re-fix the shuttering of the east raft'); await p.getByTestId('ins-desc').fill('The shuttering is out of line by 20 mm; re-fix before the pour'); await p.getByTestId('ins-due').fill(ist(-2)); await p.getByTestId(`ins-sub-${s.sub}`).check();
  await p.getByTestId('ins-send').click(); await expect(p.getByTestId('ins-object')).toHaveAttribute('data-status', 'OPEN'); await expect(p.getByTestId('ins-ack')).toHaveAttribute('data-state', 'PENDING'); const iid = Number(new URL(p.url()).searchParams.get('id')); await noOverflow(p);
  const sc = await open(browser, info, c, 'SUBCO', s.u('subco'), `/site/instructions?id=${iid}`); await sc.page.getByTestId('ins-ack-go').click(); await expect(sc.page.getByTestId('ins-ack')).toHaveAttribute('data-state', 'ACKNOWLEDGED');
  const ackId = (await api(request, c, 'SUBCO', s.u('subco'), 'get', `/site/instructions/${iid}`)).acks[0].id;
  await sc.page.getByTestId('ins-comply-note').fill('Re-fixed and checked with the level'); await sc.page.getByTestId('ins-comply-go').click(); await expect(sc.page.getByTestId('ins-obj-error')).toContainText(/evidence/i);
  const up = await request.post('/api/v1/core/files', { headers: { 'x-erp-user': s.u('subco'), 'x-erp-roles': 'SUBCO', 'x-erp-company': String(c) }, multipart: { file: { name: 'refixed.png', mimeType: 'image/png', buffer: PNG }, entity: 'site_instruction_ack', entityId: String(ackId) } }); expect(up.status(), await up.text()).toBe(201);
  await sc.page.reload(); await sc.page.getByTestId('ins-comply-note').fill('Re-fixed and checked with the level'); await sc.page.getByTestId('ins-comply-go').click(); await expect(sc.page.getByTestId('ins-ack')).toHaveAttribute('data-state', 'COMPLIED'); await shot(sc.page, 'recipients', info); await sc.context.close();
  await p.reload(); await p.getByTestId('ins-close-open').click(); await p.getByTestId('ins-close-notes').fill('The recipient has complied'); await p.getByTestId('ins-close-go').click(); await expect(p.getByTestId('ins-object')).toHaveAttribute('data-status', 'CLOSED');
  // a back-charge goes for approval, CM2 then PM
  await p.goto('/site/instruction-issue'); await p.getByTestId('ins-site').selectOption({ index: 1 }); await p.getByTestId('ins-from').fill('Construction manager'); await p.getByTestId('ins-subject').fill('Damage to the neighbour wall'); await p.getByTestId('ins-desc').fill('The subcontractor damaged the neighbour wall and is to repair it'); await p.getByTestId('ins-due').fill(ist(-5));
  await p.getByTestId(`ins-sub-${s.sub}`).check(); await p.getByTestId('ins-bc').check(); await p.getByTestId('ins-bc-partner').selectOption(String(s.sub)); await p.getByTestId('ins-bc-amount').fill('25000.50'); await p.getByTestId('ins-send').click();
  await expect(p.getByTestId('ins-object')).toHaveAttribute('data-status', 'SUBMITTED'); const bid = Number(new URL(p.url()).searchParams.get('id'));
  for (const [roles, user] of [['CM', s.u('cm2')], ['PM', s.u('pm')]]) { const w = await open(browser, info, c, roles, user, `/site/instructions?id=${bid}`); await w.page.getByTestId('ins-comment').fill('checked'); await w.page.getByTestId('ins-approve').click(); await expect(w.page.getByTestId('ins-decide')).toHaveCount(0, { timeout: 10_000 }); await w.context.close(); }
  await p.reload(); await expect(p.getByTestId('ins-object')).toHaveAttribute('data-status', 'OPEN'); await expect(p.getByTestId('ins-backcharge')).toContainText('25,000.50'); await expect(p.getByTestId('ins-locked')).toBeVisible(); await shot(p, 'backcharge', info);
  // the register and the tracker
  await p.goto('/site/instructions?filter[direction]=ISSUED'); await expect(p.getByTestId('ins-tracker')).toBeVisible(); await expect(p.getByTestId('ins-t-ack')).toContainText('1'); await expect(p.getByText('Damage to the neighbour wall').locator('visible=true').first()).toBeVisible(); await noOverflow(p); await shot(p, 'register', info);
  expect(errors).toEqual([]);
});
