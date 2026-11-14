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
// Part 18.06 in the browser (development-header mode, port 3100): a snag walk on the phone layout pins two defects on a plan with a photograph; the site engineer rectifies one with an after-photograph and the quality engineer closes it;
// status by area and party and the unit report (with its PDF) show them. Desktop and mobile.
const OUT = 'docs/erp/screenshots/qa-snags';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.exec('PRAGMA foreign_keys = OFF;');
  for (const [n, roles] of [['se', ['SE']], ['qe', ['QCE']], ['qm', ['QCMGR']], ['pm', ['PM']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const A = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, ?, 'BUILDING', 'ACTIVE')").run(c, `${T}-A`, 'Tower A').lastInsertRowid);
  const flat = Number(db.prepare("INSERT INTO proj_locations (company_id, project_id, code, name, loc_type, loc_status) VALUES (?, ?, 'F402', 'Flat 402', 'ZONE', 'ACTIVE')").run(c, A).lastInsertRowid);
  const room = Number(db.prepare("INSERT INTO proj_locations (company_id, project_id, parent_id, code, name, loc_type, loc_status) VALUES (?, ?, ?, 'F402-BR1', 'Bedroom 1', 'ROOM', 'ACTIVE')").run(c, A, flat).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, T, A, flat, room };
}
test('Quality: snag walk with plan pins, rectification with an after-photograph, closure by another person, status and the unit report', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `s${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const qe = await open(browser, info, c, 'QCE', s.u('qe'), '/qa/snag-walk'); const p = qe.page; const errors = watch(p);
  await expect(p.getByTestId('qa-snag-walk')).toBeVisible(); await p.getByTestId('walk-project').selectOption(String(s.A)); await p.getByTestId('walk-location').selectOption(String(s.room)); await p.getByTestId('walk-unit').fill('Flat 402 / Bedroom 1'); await p.getByTestId('walk-due').fill(iso(7));
  await p.getByTestId('snag-plan').click({ position: { x: 120, y: 90 } }); await expect(p.getByTestId('plan-draft')).toHaveCount(1); await p.getByTestId('walk-class').selectOption('A'); await p.getByTestId('walk-description').fill('Socket cover missing on the east wall'); await p.getByTestId('walk-photo').setInputFiles({ name: 'before.jpg', mimeType: 'image/jpeg', buffer: JPEG }); await noOverflow(p); await shot(p, '1-walk', info); await p.getByTestId('walk-save').click(); await expect(p.getByTestId('walk-done-row')).toHaveCount(1);
  await p.getByTestId('snag-plan').click({ position: { x: 200, y: 140 } }); await p.getByTestId('walk-description').fill('Paint touch-up behind the door'); await p.getByTestId('walk-class').selectOption('C'); await p.getByTestId('walk-save').click(); await expect(p.getByTestId('walk-done-row')).toHaveCount(2); await expect(p.getByTestId('plan-pin')).toHaveCount(2); await noOverflow(p); await shot(p, '2-walk-done', info);
  await p.getByTestId('walk-done-row').first().getByRole('link').click(); await expect(p.getByTestId('qa-snag-object')).toHaveAttribute('data-status', 'OPEN'); await expect(p.getByTestId('plan-pin')).toHaveCount(1); const url = p.url().replace(/^https?:\/\/[^/]+/, '');
  const se = await open(browser, info, c, 'SE', s.u('se'), url); await expect(se.page.getByTestId('qa-snag-object')).toBeVisible(); await expect(se.page.getByTestId('sn-rectify-go')).toBeDisabled(); await se.page.getByTestId('sn-after').setInputFiles({ name: 'after.jpg', mimeType: 'image/jpeg', buffer: JPEG }); await expect(se.page.getByTestId('sn-rectify-go')).toBeEnabled(); await se.page.getByTestId('sn-rectify-go').click(); await expect(se.page.getByTestId('qa-snag-object')).toHaveAttribute('data-status', 'RECTIFIED'); await noOverflow(se.page); await shot(se.page, '3-rectified', info);
  await p.reload(); await expect(p.getByTestId('sn-close')).toBeVisible(); await p.getByTestId('sn-close').click(); await expect(p.getByTestId('qa-snag-object')).toHaveAttribute('data-status', 'CLOSED'); await expect(p.getByTestId('sn-closed-view')).toBeVisible(); await noOverflow(p); await shot(p, '4-closed', info);
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/qa/snag-status'); await expect(pm.page.getByTestId('qa-snag-status')).toBeVisible(); await expect(pm.page.getByTestId('ss-area-row')).toHaveCount(1); await expect(pm.page.getByTestId('ss-total')).toContainText('2'); await noOverflow(pm.page); await shot(pm.page, '5-status', info);
  await pm.page.goto('/qa/snag-report'); await pm.page.getByTestId('sr-project').selectOption(String(s.A)); await pm.page.getByTestId('sr-location').selectOption(String(s.flat)); await expect(pm.page.getByTestId('sr-row')).toHaveCount(2); await noOverflow(pm.page); await shot(pm.page, '6-report', info); const dl = pm.page.waitForEvent('download'); await pm.page.getByTestId('sr-pdf').click(); expect((await dl).suggestedFilename()).toMatch(/\.pdf$/);
  await p.goto('/qa/snags'); await expect(p.getByTestId('qa-snags')).toBeVisible(); expect(errors, errors.join('\n')).toEqual([]);
});
