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
// Part 15.09 in the browser (development-header mode, port 3100): the rate history holds observations; the dashboard shows the benchmark, trend and volatility; the procurement manager enters a market survey (an outlier is flagged), corrects an observation
// and uploads price indices; the exposure of a project is worked out from the MRP run; the direction reads and the storekeeper has no access.
const OUT = 'docs/erp/screenshots/proc-rti';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.parse(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['mgr', ['PROCMGR']], ['dir', ['DIR']], ['sk', ['SK']], ['est', ['EST']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower R', 'BUILDING', 'ACTIVE')").run(c, `${T}-R`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, standard_amount) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 38000)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  [[390, 40], [395, 30], [400, 20], [405, 12], [410, 6]].forEach(([rate, day], i) => db.prepare("INSERT INTO rti_observations (company_id, item_id, region_code, obs_date, rate, uom, landed_rate, base_uom, base_landed_rate, basis, created_by, source_type, source_id) VALUES (?, ?, 'ALL', ?, ?, 'bag', ?, 'bag', ?, 'LANDED', 'e2e', 'SURVEY', ?)").run(c, item, iso(-day), rate * 100, rate * 100, rate * 100, `E2E-${i}`));
  const run = Number(db.prepare("INSERT INTO proc_mrp_runs (company_id, doc_no, doc_date, org_project_id, status, run_at) VALUES (?, ?, ?, ?, 'COMPLETED', ?)").run(c, `${T}/MRP/1`, iso(0), pid, `${iso(0)}T01:00:00.000Z`).lastInsertRowid);
  db.prepare('INSERT INTO proc_mrp_lines (company_id, run_id, item_id, week_start, net_req, created_by) VALUES (?, ?, ?, ?, 10000000, ?)').run(c, run, item, iso(7), 'e2e');
  db.close(); return { u: (k) => `${t}-${k}`, T, item, pid };
}

test('Rate intelligence: benchmark and trend, a survey with an outlier, a correction, index upload and the project exposure', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = `r${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const m = await open(browser, info, c, 'PROCMGR', s.u('mgr'), '/proc/rate-intelligence'); const p = m.page; const errors = watch(p);
  await expect(p.getByTestId('proc-ri')).toBeVisible(); await expect(p.getByTestId('ri-item')).toHaveCount(1); await expect(p.getByTestId('ri-benchmark')).toContainText('400'); await expect(p.getByTestId('ri-trend')).toBeVisible(); await expect(p.getByTestId('ri-month').first()).toBeVisible(); await noOverflow(p); await shot(p, '1-dashboard', info);
  // a survey: an outlier is flagged and left out
  await p.goto('/proc/rate-survey'); await expect(p.getByTestId('rs-survey')).toBeVisible(); await p.getByTestId('rs-item').selectOption({ index: 1 }); await expect(p.getByTestId('rs-uom')).toHaveValue('bag'); await p.getByTestId('rs-rate').fill('900'); await p.getByTestId('rs-date').fill(iso(-1)); await noOverflow(p); await shot(p, '2-survey', info); await p.getByTestId('rs-save').click();
  await expect(p.getByTestId('ri-obs')).toBeVisible(); await expect(p.getByTestId('ri-obs-outlier')).toBeVisible(); await expect(p.getByTestId('ri-obs-landed')).toContainText('900'); const obsUrl = p.url().replace(/^https?:\/\/[^/]+/, '');
  // a correction replaces it
  await p.getByTestId('ri-correct-rate').fill('399'); await p.getByTestId('ri-correct-reason').fill('Keyed the price of a different grade'); await p.getByTestId('ri-correct-go').click(); await expect(p.getByTestId('ri-obs-landed')).toContainText('399'); await shot(p, '3-correction', info);
  await p.goto(obsUrl); await expect(p.getByText('Replaced by a correction')).toBeVisible(); await expect(p.getByTestId('ri-correct')).toHaveCount(0);
  // an index and an upload
  await p.goto('/proc/rate-survey'); await p.getByTestId('rs-group').fill('CEMENT'); await p.getByTestId('rs-value').fill('118.5'); await p.getByTestId('rs-index-save').click(); await expect(p.getByTestId('rs-index-note')).toBeVisible();
  await p.getByTestId('rs-paste').fill(`STEEL, WEST, ${iso(0).slice(0, 7)}, 103.5`); await p.getByTestId('rs-paste-go').click(); await expect(p.getByTestId('rs-index-note')).toBeVisible();
  await p.goto('/proc/rate-intelligence'); await expect(p.getByTestId('ri-indices')).toBeVisible(); await expect(p.getByTestId('ri-benchmark')).toContainText(/₹ (39|40)\d/); await shot(p, '4-dashboard-indices', info);
  // the exposure
  await p.goto('/proc/rate-exposure'); await expect(p.getByTestId('re-pick')).toBeVisible(); await p.getByTestId('re-project').selectOption({ index: 1 }); await expect(p.getByTestId('re-row')).toHaveCount(1); await expect(p.getByTestId('re-total')).toContainText('2,00,000'); await noOverflow(p); await shot(p, '5-exposure', info);
  const dl = p.waitForEvent('download'); await p.getByTestId('re-export').click(); expect((await dl).suggestedFilename()).toContain('rate-exposure');
  expect(errors, errors.join('\n')).toEqual([]); await m.context.close();
});

test('Rate intelligence: the direction reads without entry rights; a storekeeper has no access', async ({ browser, request }, info) => {
  const t = `r${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}z`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const d = await open(browser, info, c, 'DIR', s.u('dir'), '/proc/rate-intelligence'); await expect(d.page.getByTestId('ri-item')).toHaveCount(1); await expect(d.page.getByText('Market Survey and Index Upload')).toHaveCount(0); await noOverflow(d.page);
  await d.page.goto('/proc/rate-survey'); await expect(d.page.getByTestId('rs-survey')).toHaveCount(0);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/proc/rate-intelligence'); await expect(sk.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
});
