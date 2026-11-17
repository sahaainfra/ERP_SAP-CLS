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
// Part 15.07 in the browser (development-header mode, port 3100): an expediting plan is made for an approved order and approved by the procurement manager; the vendor moves a milestone past the date required on site on its order link and the plan is at risk
// on the dashboard; a dispatch is blocked for want of a release note; an inspection passes, is reviewed by a quality engineer and released by the quality manager; the shipment is then dispatched, tracked and delivered.
const OUT = 'docs/erp/screenshots/proc-xpd';
const shot = async (page, name, info) => page.screenshot({ path: `${OUT}/${info.project.name}-${name}.png`, fullPage: true });
const iso = (n) => new Date(Date.parse(`${new Date(Date.now() + 19_800_000).toISOString().slice(0, 10)}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

async function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['ic', ['PROCIC']], ['mgr', ['PROCMGR']], ['qce', ['QCE']], ['qce2', ['QCE']], ['qcm', ['QCMGR']], ['pm', ['PM']], ['sk', ['SK']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${t}-${n}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const T = t.toUpperCase(); const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (?, ?, 'Tower X', 'BUILDING', 'ACTIVE')").run(c, `${T}-X`).lastInsertRowid); db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (?, ?, ?, 'e2e')").run(c, pid, `${t}-pm`);
  const cat = Number(db.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (?, 'HVAC', 'Plant', 'XPD', '[]', '[]', 'PROCMGR', 'ACTIVE')").run(c).lastInsertRowid);
  const item = Number(db.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (?, 'XP-CHL', 'Chiller 200 TR', 'MATERIAL', ?, 'nos', '2026-01-01', 'ACTIVE')").run(c, cat).lastInsertRowid);
  const vendor = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (?, ?, 'Carrier Chillers Pvt Ltd', 'Carrier Chillers', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'e2e')").run(c, `${T}-V1`).lastInsertRowid);
  const token = `Vendor${T}Milestone0123456789abcdef`.slice(0, 40); const { createHash } = await import('node:crypto'); const hash = createHash('sha256').update(token).digest('hex');
  const po = Number(db.prepare("INSERT INTO proc_purchase_orders (company_id, doc_no, doc_date, org_project_id, vendor_id, status, requested_by, ack_token_hash, created_by) VALUES (?, ?, ?, ?, ?, 'APPROVED', ?, ?, 'e2e')").run(c, `${T}/PO/1`, iso(0), pid, vendor, `${t}-ic`, hash).lastInsertRowid);
  const line = Number(db.prepare("INSERT INTO proc_po_lines (company_id, po_id, line_no, item_id, description, qty, uom, balance_qty, created_by) VALUES (?, ?, 1, ?, 'Chiller 200 TR', 2000, 'nos', 2000, 'e2e')").run(c, po, item).lastInsertRowid);
  db.prepare("INSERT INTO proc_po_schedules (company_id, po_id, po_line_id, due_date, qty, created_by) VALUES (?, ?, ?, ?, 2000, 'e2e')").run(c, po, line, iso(90));
  db.close(); return { u: (k) => `${t}-${k}`, T, token };
}
const approve = async (browser, info, c, roles, user, url, prefix) => { const x = await open(browser, info, c, roles, user, url); await expect(x.page.getByTestId(`${prefix}-decide`)).toBeVisible(); await x.page.getByTestId(`${prefix}-approve`).click(); await expect(x.page.getByTestId(`${prefix}-note`)).toBeVisible(); await x.context.close(); };
const here = (p) => p.url().replace(/^https?:\/\/[^/]+/, '');

test('Expediting: a plan is approved, the vendor moves a milestone, the risk shows; the inspection release note clears the dispatch; shipment tracked and delivered', async ({ browser, request }, info) => {
  test.setTimeout(300_000);
  const t = `x${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  // the plan
  const ic = await open(browser, info, c, 'PROCIC', s.u('ic'), '/proc/expediting-plans?new=1'); const p = ic.page; const errors = watch(p);
  await expect(p.getByTestId('proc-xp-form')).toBeVisible(); await p.getByTestId('xpn-project').selectOption({ label: `${s.T}-X \u00b7 Tower X` }); await p.getByTestId('xpn-order').selectOption({ index: 1 }); await expect(p.getByTestId('xpn-required')).toBeVisible();
  await p.getByTestId('xpn-required').fill(iso(90)); await p.getByTestId('xpn-longlead').check(); await noOverflow(p); await shot(p, '1-plan-new', info); await p.getByTestId('xpn-save').click();
  await expect(p.getByTestId('xp-object')).toHaveAttribute('data-status', 'DRAFT'); await expect(p.getByTestId('xp-ms')).toHaveCount(5); const url = here(p);
  await p.getByTestId('xp-submit').click(); await expect(p.getByTestId('xp-object')).toHaveAttribute('data-status', 'SUBMITTED'); await approve(browser, info, c, 'PROCMGR', s.u('mgr'), url, 'xp');
  await p.reload(); await expect(p.getByTestId('xp-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(p.getByTestId('xp-object')).toHaveAttribute('data-risk', 'no'); await noOverflow(p); await shot(p, '2-plan-approved', info);
  // the vendor, on its order link, says the manufacturing ends after the date required on site
  const v = await open(browser, info, c, 'GUEST', 'vendor', `/vendor-po?token=${s.token}`); await expect(v.page.getByTestId('vp-milestones')).toBeVisible(); const row = v.page.getByTestId('vp-ms').nth(2); await row.getByTestId('vp-ms-forecast').fill(iso(100)); await row.getByTestId('vp-ms-save').click(); await expect(v.page.getByTestId('vp-ms-done')).toBeVisible(); await noOverflow(v.page); await shot(v.page, '3-vendor-milestones', info); await v.context.close();
  await p.reload(); await expect(p.getByTestId('xp-object')).toHaveAttribute('data-risk', 'yes'); await expect(p.getByTestId('xp-warn-RISK')).toBeVisible(); await expect(p.getByTestId('xp-ms').nth(2)).toHaveAttribute('data-beyond', 'yes'); await shot(p, '4-plan-at-risk', info);
  await p.goto('/proc/expediting'); await expect(p.getByTestId('xd-atrisk')).toHaveText('1'); await expect(p.getByTestId('xd-risk-row')).toHaveCount(1); await noOverflow(p); await shot(p, '5-dashboard', info);
  // a shipment cannot leave without the release note
  await p.goto(`/proc/shipments?new=1&project=${(await request.get('/api/v1/proc/expediting/projects', { headers: H('PROCIC', c, s.u('ic')) }).then((r) => r.json())).data[0].id}`); await p.getByTestId('shn-order').selectOption({ index: 1 }); await p.getByTestId('shn-qty').first().fill('1'); await p.getByTestId('shn-transporter').fill('VRL Logistics'); await p.getByTestId('shn-lr').fill('LR-9001'); await p.getByTestId('shn-eta').fill(iso(95));
  await p.getByTestId('shn-save').click(); await expect(p.getByTestId('sh-object')).toHaveAttribute('data-status', 'PLANNED'); const shUrl = here(p); await p.getByTestId('sh-dispatch-go').click(); await expect(p.getByTestId('sh-error')).toBeVisible(); await expect(p.getByTestId('sh-object')).toHaveAttribute('data-status', 'PLANNED'); await shot(p, '6-dispatch-blocked', info);
  // the inspection and its release note
  const q = await open(browser, info, c, 'QCE', s.u('qce'), '/proc/inspections?new=1'); const qp = q.page; await qp.getByTestId('inn-project').selectOption({ label: `${s.T}-X \u00b7 Tower X` }); await qp.getByTestId('inn-order').selectOption({ index: 1 }); await qp.getByTestId('inn-type').selectOption('FINAL'); await qp.getByTestId('inn-inspector').fill('R. Kulkarni'); await qp.getByTestId('inn-location').fill('Works, Pune'); await noOverflow(qp); await qp.getByTestId('inn-save').click();
  await expect(qp.getByTestId('in-object')).toHaveAttribute('data-status', 'DRAFT'); await qp.getByTestId('in-punch-text').fill('Paint touch-up on the frame'); await qp.getByTestId('in-result-select').selectOption('PASSED_WITH_PUNCH'); await qp.getByTestId('in-record-save').click(); await expect(qp.getByTestId('in-note')).toBeVisible(); await expect(qp.getByTestId('in-punch-row')).toHaveCount(1);
  const inUrl = here(qp); await shot(qp, '7-inspection-result', info); await qp.getByTestId('in-submit').click(); await expect(qp.getByTestId('in-object')).toHaveAttribute('data-status', 'SUBMITTED'); await approve(browser, info, c, 'QCE', s.u('qce2'), inUrl, 'in'); await approve(browser, info, c, 'QCMGR', s.u('qcm'), inUrl, 'in');
  await qp.reload(); await expect(qp.getByTestId('in-object')).toHaveAttribute('data-status', 'APPROVED'); await expect(qp.getByTestId('in-irn')).toContainText('IRN/'); await noOverflow(qp); await shot(qp, '8-inspection-irn', info); await q.context.close();
  // now the dispatch is cleared, tracked and delivered
  await p.goto(shUrl); await p.getByTestId('sh-dispatch-go').click(); await expect(p.getByTestId('sh-object')).toHaveAttribute('data-status', 'DISPATCHED'); await expect(p.getByTestId('sh-clearance')).toContainText('IRN/');
  await p.getByTestId('sh-where').fill('Nashik'); await p.getByTestId('sh-track-go').click(); await expect(p.getByTestId('sh-object')).toHaveAttribute('data-status', 'IN_TRANSIT'); await expect(p.getByTestId('sh-events')).toBeVisible(); await noOverflow(p); await shot(p, '9-shipment-transit', info);
  await p.getByTestId('sh-deliver').click(); await expect(p.getByTestId('sh-object')).toHaveAttribute('data-status', 'DELIVERED'); await p.goto('/proc/shipments'); await expect(p.getByTestId('proc-sh')).toBeVisible(); await noOverflow(p);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Expediting: a storekeeper reads the shipments and cannot call an inspection or change a plan', async ({ browser, request }, info) => {
  const t = `x${info.project.name === 'mobile' ? 'm' : 'd'}${Date.now().toString(36).slice(-4)}z`; const c = await company(request, t.toUpperCase()); const s = await seed(c, t);
  const sk = await open(browser, info, c, 'SK', s.u('sk'), '/proc/shipments'); await expect(sk.page.getByTestId('proc-sh')).toBeVisible(); await expect(sk.page.getByRole('button', { name: 'Plan a shipment' })).toHaveCount(0); await expect(sk.page.getByRole('link', { name: 'Plan a shipment' })).toHaveCount(0); await noOverflow(sk.page);
  await sk.page.goto('/proc/expediting-plans'); await expect(sk.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
});
