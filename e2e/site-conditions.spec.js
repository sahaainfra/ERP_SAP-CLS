import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Part 14.03 in the browser (development-header mode, port 3100): the site engineer records a weather shutdown (the page says concrete is not to be poured and that a delay draft was made, and the rainfall chart and
// table show the month); raises a hindrance, sends it, the construction manager and the project manager approve it from the page; it cannot be closed without evidence, and is closed with an end date once a file is
// attached; the diary entry is signed off by the construction manager and then locked; a visit is recorded and listed. Desktop and phone, no console errors, no sideways scroll.
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
const OUT = 'docs/erp/screenshots/site-conditions';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const ist = (n) => new Date(Date.now() + 19_800_000 - n * 86_400_000).toISOString().slice(0, 10);
const Y = ist(1);

function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['se', ['SE']], ['cm', ['CM']], ['pm', ['PM']], ['plan', ['PLAN']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower C', 'BUILDING', 'ACTIVE')").run(c, `${T}-C`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Tower C site', 'ACTIVE')").run(c, pid, `${T}-S1`).lastInsertRowid);
  db.close(); return { u: (k) => `${t}-${k}`, pid, site, T };
}

test('weather, hindrance, diary and visitors work end to end', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const t = `c${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = seed(c, t);

  // ---- the weather: a shutdown of a day -> heavy rain, no pour, a delay draft; the rainfall by month
  const se = await open(browser, info, c, 'SE', s.u('se'), '/site/weather'); const errors = watch(se.page); const p = se.page;
  await expect(p.getByTestId('site-weather')).toBeVisible(); await expect(p.getByTestId('wx-chart-empty')).toBeVisible();
  await p.getByTestId('wx-site').selectOption({ index: 1 }); await p.getByTestId('wx-date').fill(Y); await p.getByTestId('wx-rain').fill('80'); await p.getByTestId('wx-tmin').fill('22'); await p.getByTestId('wx-tmax').fill('27'); await p.getByTestId('wx-hours').fill('8');
  await p.getByTestId('wx-shutdown').check(); await p.getByTestId('wx-save').click(); await expect(p.getByTestId('wx-error')).toBeVisible(); await expect(p.getByText(/at least 5 characters/i).first()).toBeVisible();
  await p.getByTestId('wx-reason').fill('The pits are flooded and the roads are cut'); await p.getByTestId('wx-save').click();
  await expect(p.getByTestId('wx-note')).toContainText(/Heavy rain/); await expect(p.getByTestId('wx-note')).toContainText(/Do not pour concrete/); await expect(p.getByTestId('wx-note')).toContainText(/delay draft/i);
  await p.getByTestId('wx-year').fill(String(Y.slice(0, 4))); await expect(p.getByTestId('wx-total-rain')).toContainText('80'); await expect(p.getByTestId('wx-total-shut')).toContainText('1');
  await expect(p.getByTestId('wx-month-row').filter({ hasText: Y.slice(0, 7) })).toContainText('80'); await noOverflow(p); await shot(p, 'weather', info);
  expect(errors).toEqual([]);

  // ---- the hindrance: raise and send it; the construction manager and the project manager approve it from the page
  await p.goto('/site/hindrances?new=1'); await p.getByTestId('hin-site').selectOption({ index: 1 }); await p.getByTestId('hin-title').fill('East plot not handed over'); await p.getByTestId('hin-desc').fill('The east plot is occupied by the client\'s other contractor');
  await p.getByTestId('hin-start').fill(ist(3)); await p.getByTestId('hin-party').selectOption('CLIENT'); await p.getByTestId('hin-save').click();
  await expect(p.getByTestId('hin-object')).toBeVisible(); await expect(p.getByTestId('hin-object')).toHaveAttribute('data-status', 'DRAFT'); const hid = Number(new URL(p.url()).searchParams.get('id'));
  await p.getByTestId('hin-submit').click(); await expect(p.getByTestId('hin-object')).toHaveAttribute('data-status', 'SUBMITTED'); await noOverflow(p);
  for (const [roles, user] of [['CM', s.u('cm')], ['PM', s.u('pm')]]) {
    const who = await open(browser, info, c, roles, user, `/site/hindrances?id=${hid}`); await who.page.getByTestId('hin-comment').fill('checked'); await who.page.getByTestId('hin-approve').click();
    await expect(who.page.getByTestId('hin-decide')).toHaveCount(0, { timeout: 10_000 }); await who.context.close();
  }
  await p.reload(); await expect(p.getByTestId('hin-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('hin-locked')).toBeVisible(); await shot(p, 'hindrance', info);
  // closing needs evidence: refused with a message; then a file is attached and it closes with its end date
  await p.getByTestId('hin-close-open').click(); await p.getByTestId('hin-close-end').fill(Y); await p.getByTestId('hin-close-notes').fill('The plot was handed over on site and minuted'); await p.getByTestId('hin-close-go').click();
  await expect(p.getByTestId('hin-obj-error')).toContainText(/evidence/i);
  const up = await request.post('/api/v1/core/files', { headers: { 'x-erp-user': s.u('se'), 'x-erp-roles': 'SE', 'x-erp-company': String(c) }, multipart: { file: { name: 'handover.png', mimeType: 'image/png', buffer: PNG }, entity: 'site_hindrance', entityId: String(hid) } });
  expect(up.status(), await up.text()).toBe(201); await p.reload(); await p.getByTestId('hin-close-open').click(); await p.getByTestId('hin-close-end').fill(Y); await p.getByTestId('hin-close-notes').fill('The plot was handed over on site and minuted'); await p.getByTestId('hin-close-go').click();
  await expect(p.getByTestId('hin-object')).toHaveAttribute('data-status', 'CLOSED'); await expect(p.getByTestId('hin-days')).toHaveText('3'); await expect(p.getByTestId('hin-closure')).toContainText('handed over');
  await p.goto('/site/hindrances'); await expect(p.getByText('East plot not handed over').locator('visible=true').first()).toBeVisible(); await noOverflow(p); await shot(p, 'hindrances-list', info);
  expect(errors).toEqual([]);

  // ---- the diary: written by the site engineer, signed off by the construction manager, then locked
  await p.goto('/site/diary'); await p.getByTestId('diary-site').selectOption({ index: 1 }); await p.getByTestId('diary-category').selectOption('INSTRUCTION'); await p.getByTestId('diary-text-input').fill('The consultant told us to hold the east footing until the drawing is reissued'); await p.getByTestId('diary-save').click();
  await expect(p.locator('a[href^="/site/diary?id="]').locator('visible=true').first()).toBeVisible({ timeout: 10_000 }); await noOverflow(p);
  await p.locator('a[href^="/site/diary?id="]').locator('visible=true').first().click(); await expect(p.getByTestId('diary-object')).toHaveAttribute('data-signed', '0'); const did = Number(new URL(p.url()).searchParams.get('id'));
  const cm = await open(browser, info, c, 'CM', s.u('cm'), `/site/diary?id=${did}`); await cm.page.getByTestId('diary-sign').click(); await expect(cm.page.getByTestId('diary-object')).toHaveAttribute('data-signed', '1'); await expect(cm.page.getByTestId('diary-locked')).toBeVisible(); await shot(cm.page, 'diary', info); await cm.context.close();
  await p.reload(); await expect(p.getByTestId('diary-locked')).toBeVisible(); await expect(p.getByTestId('diary-edit-save')).toHaveCount(0);

  // ---- the visitors
  await p.goto('/site/visitors'); await p.getByTestId('vis-site').selectOption({ index: 1 }); await p.getByTestId('vis-date').fill(Y); await p.getByTestId('vis-name').fill('R. Deshmukh'); await p.getByTestId('vis-org').fill('Mehta Associates'); await p.getByTestId('vis-type').selectOption('CONSULTANT');
  await p.getByTestId('vis-purpose').fill('Inspection of the east footing'); await p.getByTestId('vis-instructions').fill('Hold the footing until the drawing is reissued'); await p.getByTestId('vis-save').click();
  await expect(p.getByText('R. Deshmukh').locator('visible=true').first()).toBeVisible({ timeout: 10_000 }); await noOverflow(p); await shot(p, 'visitors', info);
  // a planner reads but cannot record
  const plan = await open(browser, info, c, 'PLAN', s.u('plan'), '/site/visitors'); await expect(plan.page.getByTestId('site-visitors')).toBeVisible(); await expect(plan.page.getByTestId('vis-form')).toHaveCount(0); await expect(plan.page.getByText('R. Deshmukh').locator('visible=true').first()).toBeVisible();
  expect(errors).toEqual([]);
});
