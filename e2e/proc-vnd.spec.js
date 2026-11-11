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
// Part 15.08 in the browser (development-header mode, port 3100): a vendor is prequalified (scored, approved by the procurement and quality managers) and is on the approved vendor list; a safety input and the scorecard with its evidence and trend;
// the ranking of the category; a suspension is proposed by procurement and approved by the procurement manager and the direction.
const OUT = 'docs/erp/screenshots/proc-vnd';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['ic', ['PROCIC']], ['mgr', ['PROCMGR']], ['qcm', ['QCMGR']], ['dir', ['DIR']], ['hse', ['HSEO']], ['pm', ['PM']], ['sk', ['SK']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase();
  for (const [code, name] of [['CEMENT', 'Cement'], ['STEEL', 'Steel']]) db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, ?, ?, ?, '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c, code, name, code.slice(0, 3));
  const vid = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Ambuja Traders Pvt Ltd', 'Ambuja Traders', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-V1`).lastInsertRowid);
  db.prepare("INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role, categories_json, regions_json, created_by) VALUES (?, ?, 'VENDOR', '[]', '[]', 'e2e')").run(c, vid);
  db.close(); return { u: (k) => `${t}-${k}`, T, vid };
}
const approve = async (browser, info, c, roles, user, url, prefix) => { const x = await open(browser, info, c, roles, user, url); await expect(x.page.getByTestId(`${prefix}-decide`)).toBeVisible(); await x.page.getByTestId(`${prefix}-approve`).click(); await expect(x.page.getByTestId(`${prefix}-note`)).toBeVisible(); await x.context.close(); };
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');

test('Vendor list: prequalified and approved, scored with evidence, ranked, then suspended by approval', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = `v${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const ic = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/prequalifications?new=1'); const p = ic.page; const errors = watch(p);
  await expect(p.getByTestId('proc-pq-form')).toBeVisible(); await p.getByTestId('pqn-vendor').selectOption({ index: 1 }); await p.getByTestId('pqn-cat-CEMENT').check(); await p.getByTestId('pqn-regions').fill('WEST');
  const until = new Date(Date.now() + 19_800_000 + 365 * 86_400_000).toISOString().slice(0, 10); await p.getByTestId('pqn-valid').fill(until);
  for (const sec of ['FINANCIALS', 'EXPERIENCE', 'CAPACITY', 'CERTIFICATIONS', 'REFERENCES']) await p.getByTestId(`pqn-score-${sec}`).fill('80');
  await noOverflow(p); await shot(p, '1-preq-new', info); await p.getByTestId('pqn-send').click();
  await expect(p.getByTestId('pq-object')).toHaveAttribute('data-status', 'SUBMITTED'); await expect(p.getByTestId('pq-score')).toHaveText('80%'); const url = here(p);
  await approve(browser, info, c, 'PROCMGR', s.u('mgr'), url, 'pq'); await approve(browser, info, c, 'QCMGR', s.u('qcm'), url, 'pq');
  await p.reload(); await expect(p.getByTestId('pq-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('pq-avl')).toBeVisible(); await noOverflow(p); await shot(p, '2-preq-approved', info);
  // the list
  await p.goto('/proc/avl'); await expect(p.getByTestId('proc-avl')).toBeVisible(); await expect(p.getByText('Ambuja Traders').first()).toBeVisible(); await noOverflow(p); await shot(p, '3-avl', info);
  // safety input by the safety officer, then the scorecard
  const h = await open(browser, info, c, 'HSEO', s.u('hse'), `/proc/vendor-scorecards?partner=${s.vid}`); await expect(h.page.getByTestId('vs-input')).toBeVisible(); await h.page.getByTestId('vs-in-value').fill('90'); await h.page.getByTestId('vs-in-save').click(); await expect(h.page.getByTestId('vs-note')).toBeVisible(); await h.context.close();
  const m = await open(browser, info, c, 'PROCMGR', s.u('mgr'), `/proc/vendor-scorecards?partner=${s.vid}`); const mp = m.page; await mp.getByTestId('vs-compute-go').click(); await expect(mp.getByTestId('vs-metric')).toHaveCount(6); await expect(mp.getByTestId('vs-total')).toContainText('90%'); await expect(mp.getByTestId('vs-evidence')).toBeVisible(); await expect(mp.getByTestId('vs-trend')).toBeVisible(); await noOverflow(mp); await shot(mp, '4-scorecard', info);
  // an action
  await mp.getByTestId('vs-act-title').fill('Improve dispatch planning'); await mp.getByTestId('vs-act-due').fill(until); await mp.getByTestId('vs-act-save').click(); await expect(mp.getByTestId('vs-action')).toHaveCount(1);
  // the ranking
  await mp.goto('/proc/vendor-ranking'); await expect(mp.getByTestId('vr-pick')).toBeVisible(); await mp.getByTestId('vr-category').selectOption({ label: 'Cement' }); await expect(mp.getByTestId('vr-row')).toHaveCount(1); await noOverflow(mp); await shot(mp, '5-ranking', info);
  // a suspension: proposed by procurement, approved by the procurement manager and the direction
  await p.goto(`/proc/vendor-scorecards?partner=${s.vid}`); p.once('dialog', (d) => d.accept('Repeated quality failures at the works')); await p.getByTestId('vs-propose').click(); await expect(p.getByTestId('su-object')).toHaveAttribute('data-status', 'DRAFT'); const su = here(p);
  await p.getByTestId('su-submit').click(); await expect(p.getByTestId('su-object')).toHaveAttribute('data-status', 'SUBMITTED'); await approve(browser, info, c, 'PROCMGR', s.u('mgr'), su, 'su'); await approve(browser, info, c, 'DIR', s.u('dir'), su, 'su');
  await p.reload(); await expect(p.getByTestId('su-object')).toHaveAttribute('data-status', 'APPROVED'); await noOverflow(p); await shot(p, '6-suspension', info);
  await p.goto(`/proc/vendor-scorecards?partner=${s.vid}`); await expect(p.getByTestId('vs-avl')).toContainText('Suspended'); await m.context.close();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Vendor list: a storekeeper has no access; a project manager reads the list and the scorecards only', async ({ browser, request }, info) => {
  const t = `v${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}z`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/proc/avl'); await expect(sk.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible().catch(async () => { await expect(sk.page.getByTestId('proc-avl')).toHaveCount(0); });
  const pm = await open(browser, info, c, 'PM', s.u('pm'), '/proc/avl'); await expect(pm.page.getByTestId('proc-avl')).toBeVisible(); await noOverflow(pm.page);
  await pm.page.goto('/proc/prequalifications?new=1'); await expect(pm.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
});
