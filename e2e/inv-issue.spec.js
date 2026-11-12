import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
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
// Part 16.04 in the browser (development-header mode, port 3100): the storekeeper issues material against a work authorisation, the receiver acknowledges with a code and the stock goes out at the average rate; an issue beyond the authorisation is stopped;
// unused material comes back on a site return approved by the store manager; the quantity surveyor reconciles a subcontractor free issue against the norms and the certified quantity. Desktop and mobile.
const OUT = 'docs/erp/screenshots/inv-issue';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); const otpHash = (id, otp) => createHash('sha256').update(`${id}:${otp}`).digest('hex');

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['sk', ['SK']], ['mgr1', ['STOREMGR']], ['qs', ['QS']], ['pm', ['PM']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Issue tower', 'BUILDING', 'ACTIVE')").run(c, `${T}-I`).lastInsertRowid);
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (?, ?, ?, 'Issue site', 'ACTIVE')").run(c, pid, `${T}-IS`).lastInsertRowid);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'CEMENT', 'Cement', 'CEM', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status, stock_tracked) VALUES (?, ?, 'Cement OPC 53', 'MATERIAL', ?, 'bag', '2026-01-01', 'ACTIVE', 1)").run(c, `${T}-CEM`, cat).lastInsertRowid);
  const sub = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, ?, 'Shuttering', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'e2e')").run(c, `${T}-SUB`, `${T} Shuttering Ltd`).lastInsertRowid);
  const wbs = Number(db.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, weight, created_by) VALUES (?, ?, 'W1', 'Frame', 1, 0, 'e2e')").run(c, pid).lastInsertRowid);
  const cal = Number(db.prepare("INSERT INTO plan_calendars (company_id, code, name, status, created_by) VALUES (?, 'C1', 'Calendar', 'ACTIVE', 'e2e')").run(c).lastInsertRowid); const sch = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, calendar_id, start_date, status, created_by) VALUES (?, ?, ?, ?, 'Plan', ?, ?, 'APPROVED', 'e2e')").run(c, `SCH/${T}`, today, pid, cal, today).lastInsertRowid);
  const act = Number(db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, created_by) VALUES (?, ?, 'A1', 'Slab', 'e2e')").run(c, sch).lastInsertRowid);
  const wa = Number(db.prepare("INSERT INTO site_work_authorisations (company_id, wa_no, org_project_id, wa_site_id, plan_date, activity_id, wbs_id, planned_qty, start_time, end_time, supervisor, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, '08:00', '17:00', 'x', 'APPROVED', 'e2e')").run(c, `WA/${T}/1`, pid, site, today, act, wbs).lastInsertRowid);
  db.prepare("INSERT INTO site_wa_resources (company_id, wa_id, resource_type, item_id, res_key, label, uom, planned_qty) VALUES (?, ?, 'MATERIAL', ?, ?, 'Cement', 'bag', 100000)").run(c, wa, item, `item:${item}`);
  const st = Number(db.prepare("INSERT INTO inv_stores (company_id, code, name, store_type, org_project_id, org_site_id, keeper_ids_json, store_status, requested_by, created_by) VALUES (?, ?, 'Issue store', 'SITE_STORE', ?, ?, ?, 'ACTIVE', 'e2e', 'e2e')").run(c, `${T}-ST`, pid, site, JSON.stringify([`${t}-sk`])).lastInsertRowid);
  db.prepare("INSERT INTO inv_bins (company_id, store_id, code, is_default, created_by) VALUES (?, ?, 'MAIN', 1, 'e2e')").run(c, st);
  const ver = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, created_by) VALUES (?, ?, ?, 'CONTRACT', 1, 'Contract', 'e2e')").run(c, `BOQ/${T}`, pid).lastInsertRowid); const bl = Number(db.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, created_by) VALUES (?, ?, 'ITEM', '1.1', 'Plaster', 'm3', 100000, 'e2e')").run(c, ver).lastInsertRowid);
  db.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, resource_item_id, norm_type, description, uom, qty_per_unit, wastage_pct, created_by) VALUES (?, ?, ?, 'MATERIAL', 'Cement', 'bag', 8000, 50000, 'e2e')").run(c, bl, item);
  db.close(); return { u: (k) => `${t}-${k}`, T, pid, site, item, sub, st, bl, wa };
}

test('Material issue: issued against a work authorisation with the receiver code, stopped beyond it, returned at the issue rate, and a subcontractor free issue reconciled against the norms', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const t = `s${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  await api(request, c, 'STOREMGR', s.u('mgr1'), 'post', '/inv/movements', { storeId: s.st, itemId: s.item, type: 'RECEIPT', qty: 300, rate: 40, date: today, reason: 'Opening for the test' });
  const k = await open(browser, info, c, 'SK', s.u('sk'), '/inv/issue-new'); const p = k.page; const errors = watch(p);
  await expect(p.getByTestId('issue-new')).toBeVisible(); await p.getByTestId('is-wa').selectOption({ index: 1 }); await expect(p.getByTestId('is-line-0')).toContainText('100'); await p.getByTestId('is-store').selectOption({ index: 1 }); await p.getByTestId('is-name').fill('Mason gang A'); await p.getByTestId('is-receiver').fill(s.u('sk')); await p.getByTestId('is-qty-0').fill('60');
  await p.getByTestId('is-scan-code').fill('cement'); await p.getByTestId('is-find').click(); await noOverflow(p); await shot(p, '1-issue-new', info); await p.getByTestId('is-send').click(); await expect(p.getByTestId('issue-object')).toHaveAttribute('data-status', 'APPROVED'); const url = here(p); await expect(p.getByTestId('issue-ack-panel')).toBeVisible();
  await p.getByTestId('issue-code').click(); await expect(p.getByTestId('issue-note')).toBeVisible(); const id = Number(new URL(p.url()).searchParams.get('id')); const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;'); db.prepare('UPDATE inv_issues SET ack_hash = ? WHERE id = ?').run(otpHash(id, '135790'), id);
  await p.getByTestId('issue-otp').fill('000000'); await p.getByTestId('issue-ack-otp').click(); await expect(p.getByTestId('issue-error')).toBeVisible(); await p.getByTestId('issue-otp').fill('135790'); await p.getByTestId('issue-ack-otp').click(); await expect(p.getByTestId('issue-object')).toHaveAttribute('data-status', 'POSTED'); await expect(p.getByTestId('issue-ack')).toBeVisible(); await expect(p.getByTestId('issue-postings')).toBeVisible(); await expect(p.getByTestId('issue-value')).toHaveCount(0); await noOverflow(p); await shot(p, '2-issued', info);
  // beyond the authorisation: 40 left, 60 asked for
  await p.goto('/inv/issue-new'); await p.getByTestId('is-wa').selectOption({ index: 1 }); await p.getByTestId('is-store').selectOption({ index: 1 }); await p.getByTestId('is-name').fill('Mason gang B'); await p.getByTestId('is-qty-0').fill('60'); await expect(p.getByTestId('is-over-0')).toBeVisible(); await p.getByTestId('is-send').click(); await expect(p.getByTestId('is-error')).toBeVisible(); await shot(p, '3-stopped', info);
  // return 20 at the issue rate; the store manager approves
  await p.goto(url); await p.getByTestId('issue-return').click(); await expect(p.getByTestId('return-form')).toBeVisible(); await p.getByTestId('sr-qty-1').fill('20'); await p.getByTestId('sr-reason').fill('Not needed after the design change'); await noOverflow(p); await shot(p, '4-return-new', info); await p.getByTestId('sr-send').click(); await expect(p.getByTestId('return-object')).toHaveAttribute('data-status', 'SUBMITTED'); const rurl = here(p);
  const m = await open(browser, info, c, 'STOREMGR', s.u('mgr1'), rurl); await expect(m.page.getByTestId('return-decide')).toBeVisible(); await m.page.getByTestId('return-approve').click(); await expect(m.page.getByTestId('return-note')).toBeVisible(); await expect(m.page.getByTestId('return-value')).toContainText('800'); await m.context.close();
  await p.reload(); await expect(p.getByTestId('return-object')).toHaveAttribute('data-status', 'APPROVED'); await p.goto(url); await expect(p.getByTestId('issue-returns')).toBeVisible(); await p.goto('/inv/site-returns'); await expect(p.getByText(/SRT\//).first()).toBeVisible(); await noOverflow(p);
  await p.goto('/inv/issues'); await expect(p.getByTestId('issue-kpis')).toBeVisible(); await expect(p.getByText(/ISS\//).first()).toBeVisible(); await noOverflow(p); await shot(p, '5-list', info);
  // a free issue to a subcontractor, reconciled by the surveyor
  const fid = (await api(request, c, 'SK', s.u('sk'), 'post', '/inv/issues', { storeId: s.st, waId: s.wa, type: 'SUBCO_FREE', issuedTo: { type: 'SUBCONTRACTOR', id: s.sub }, lines: [{ itemId: s.item, qty: 30 }] })).id; await api(request, c, 'SK', s.u('sk'), 'post', `/inv/issues/${fid}/submit`); await api(request, c, 'SK', s.u('sk'), 'post', `/inv/issues/${fid}/ack-code`); db.prepare('UPDATE inv_issues SET ack_hash = ? WHERE id = ?').run(otpHash(fid, '246801'), fid); await api(request, c, 'SK', s.u('sk'), 'post', `/inv/issues/${fid}/acknowledge`, { method: 'OTP', otp: '246801' }); db.close();
  const period = today.slice(0, 7); await api(request, c, 'QS', s.u('qs'), 'post', '/inv/free-issue/certified', { rows: [{ projectId: s.pid, subcontractorId: s.sub, boqLineId: s.bl, period, certifiedQty: 2, certificateRef: 'RA-1' }] });
  const q = await open(browser, info, c, 'QS', s.u('qs'), '/inv/free-issue'); await expect(q.page.getByTestId('free-issue')).toBeVisible(); await q.page.getByTestId('fi-project').selectOption({ index: 1 }); await q.page.getByTestId('fi-run').click(); await expect(q.page.getByTestId('fi-note')).toBeVisible();
  await expect(q.page.getByTestId('fi-table')).toBeVisible(); await expect(q.page.getByTestId('fi-excess')).toHaveText('13.2'); await expect(q.page.getByTestId('fi-recovery')).toContainText('528'); await noOverflow(q.page); await shot(q.page, '6-free-issue', info); await q.page.getByTestId(/fi-drill-/).first().click(); await expect(q.page.getByTestId('fi-drilldown')).toContainText('ISS/'); await q.context.close();
  expect(errors).toEqual([]);
});
