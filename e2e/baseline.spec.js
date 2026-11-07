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
const open = async (browser, info, c, roles, user, path) => {
  const { baseURL, viewport, hasTouch } = info.project.use;
  const context = await browser.newContext({ baseURL, viewport, hasTouch });
  const page = await context.newPage();
  await page.addInitScript((v) => localStorage.setItem('erp.dev.identity', JSON.stringify(v)), { user, roles, company: String(c) });
  await page.goto(path);
  return { page, context };
};
test.afterEach(async ({ browser }) => { for (const c of browser.contexts()) await c.close(); });

const OUT = 'docs/erp/screenshots/baseline';
const decide = async (request, c, roles, user, instanceId, action = 'approve') => {
  const tasks = await api(request, c, roles, user, 'get', '/workflow/tasks?mine=assigned');
  const task = tasks.rows.find((x) => x.instance.id === instanceId);
  expect(task, `the task waits for ${user}`).toBeTruthy();
  await api(request, c, roles, user, 'post', `/workflow/tasks/${task.id}/act`, { action, comment: 'checked against the estimate' });
};
/** The users, a client, and an awarded tender with its approved award and approved estimate (the figures of 08.03 and 09.03 in their tables). */
function seed(c, t) {
  const db = new DatabaseSync('data/e2e.sqlite');
  db.exec('PRAGMA busy_timeout = 8000;');
  for (const [n, roles] of [['pcm', ['PCMGR']], ['est', ['EST']], ['est2', ['EST']], ['com', ['COMMGR']], ['pd', ['PD']], ['pm', ['PM']], ['dir', ['DIR']]]) db.prepare('INSERT OR IGNORE INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(c, `${t}-${n}`, `${n} ${t}`, JSON.stringify(roles), `${t}-${n}@example.com`);
  const client = Number(db.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (?, ?, 'Public Works Department', ?, 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 'e2e', 'e2e')").run(c, `${t.toUpperCase()}C2`, `public works department ${t}`).lastInsertRowid);
  db.prepare('INSERT INTO mdm_partner_roles (company_id, partner_id, partner_role) VALUES (?, ?, ?)').run(c, client, 'CLIENT');
  const value = 97_200_000_00;
  const tid = Number(db.prepare("INSERT INTO tdr_tenders (company_id, doc_no, doc_date, client_partner_id, name_of_work, location, est_cost_minor, bid_type, period_months, owner, stage, status, created_by) VALUES (?, ?, '2026-06-01', ?, 'Four-laning of NH-48, package 3', 'Pune', ?, 'ITEM_RATE', 24, ?, 'AWARDED', 'APPROVED', 'e2e')").run(c, `${t.toUpperCase()}-TDR-1`, client, value, `${t}-est`).lastInsertRowid);
  db.prepare("INSERT INTO tdr_awards (company_id, doc_no, doc_date, tender_id, outcome, loa_no, loa_date, awarded_value_minor, status, created_by) VALUES (?, ?, '2026-10-20', ?, 'WON', ?, '2026-10-25', ?, 'APPROVED', 'e2e')").run(c, `${t.toUpperCase()}-AW-1`, tid, `LOA/${t.toUpperCase()}/1`, value);
  const eid = Number(db.prepare("INSERT INTO est_estimates (company_id, doc_no, version_no, title, tender_id, basis_date, region_code, ho_overhead_pct, contingency_pct, escalation_pct, gst_pct, direct_cost, indirect_cost, overhead_amount, risk_amount, contingency_amount, escalation_amount, total_cost, total_selling, margin_amount, margin_pct, gst_amount, bid_value, status, approved_at, created_by) VALUES (?, ?, 1, 'NH-48 package 3 estimate', ?, '2026-09-01', 'MH', 70000, 20000, 30000, 180000, 80000000000, 6000000000, 4000000000, 1000000000, 500000000, 700000000, 92200000000, 100800000000, 8600000000, 85000, 18000000000, ?, 'APPROVED', '2026-10-10T10:00:00.000Z', 'e2e')").run(c, `${t.toUpperCase()}-EST-1`, tid, value).lastInsertRowid);
  const item = (sec, secName, no, d, uom, qty, rate, cost, order) => Number(db.prepare("INSERT INTO est_estimate_items (company_id, estimate_id, section_code, section_name, item_no, sort_order, description, uom, qty, client_rate, build_mode, cost_rate, markup_pct, selling_rate, cost_amount, amount, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, 200000, ?, ?, ?, 'e2e')").run(c, eid, sec, secName, no, order, d, uom, Math.round(qty * 1000), Math.round(rate * 10000), Math.round(cost * 10000), Math.round(rate * 100), Math.round(qty * cost * 100), Math.round(qty * rate * 100)).lastInsertRowid);
  const i1 = item('A', 'Earthwork', 'A.1', 'Excavation in soil', 'CUM', 120000, 185.5, 150, 1); item('A', 'Earthwork', 'A.2', 'Embankment with approved material', 'CUM', 85000, 310.25, 260, 2); item('B', 'Pavement', 'B.1', 'Dense bituminous macadam 50 mm', 'CUM', 9500, 9250.75, 7800, 3);
  db.prepare("INSERT INTO est_item_components (company_id, estimate_item_id, line_no, component_type, description, uom, qty_per_unit, rate, amount, line_origin, created_by) VALUES (?, ?, 1, 'EQUIPMENT', 'Excavator 1.0 cum', 'HR', 20, 1400000, 28000, 'MANUAL', 'e2e')").run(c, i1);
  db.prepare("INSERT INTO est_item_components (company_id, estimate_item_id, line_no, component_type, description, uom, qty_per_unit, rate, amount, line_origin, created_by) VALUES (?, ?, 2, 'SUBCONTRACT', 'Haulage by subcontractor', 'CUM', 10000, 900000, 90000, 'MANUAL', 'e2e')").run(c, i1);
  db.prepare("INSERT INTO est_risks (company_id, estimate_id, sort_order, description, impact, probability_pct, exposure, created_by) VALUES (?, ?, 1, 'Rock in cutting', 5000000000, 200000, 1000000000, 'e2e')").run(c, eid);
  for (const [k, tx] of [['ASSUMPTION', 'Bitumen at the IOCL rate of September 2026'], ['EXCLUSION', 'Utility shifting by the owners']]) db.prepare("INSERT INTO est_assumptions (company_id, estimate_id, kind, sort_order, text, created_by) VALUES (?, ?, ?, 1, ?, 'e2e')").run(c, eid, k, tx);
  db.close();
  return { u: (k) => `${t}-${k}`, tid };
}
const pick = async (page, id, text, name) => { await page.locator(`#${id}`).click(); await page.locator(`#${id}`).fill(text); await page.getByRole('option', { name }).first().click(); };

// Part 10.02: the project controls manager creates a project from an awarded tender (the preview of what will be copied, the client, place, value and period from the tender and the award, the BOQ of the approved estimate), adds only the code, the
// start, the team, a site and a key clause; the pack opens with the BOQ identical to the estimate and no costs for them. The project manager records the handover meeting (attendees, a question, an action that becomes a task). The pack is sent for sign-off;
// estimation, the commercial manager and the project director sign it; the signed pack is intact and offers "Correct this baseline"; the Baseline vs Current report shows the baseline alone with its reason. On a computer and a phone, no console errors, no horizontal scroll.
test('AC-01 award to project to a signed-off baseline pack, with links to the tender and the estimate, in the browser', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile';
  const sfx = phone ? '-mobile' : '';
  const c = await company(request, phone ? 'BLM' : 'BLD');
  const t = phone ? 'blm' : 'bld';
  const g = seed(c, t);
  const shot = async (page, name) => { await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${name}${sfx}.png`, fullPage: true }); };
  const code = phone ? 'NH48-BM' : 'NH48-BD';
  const pcm = await open(browser, info, c, 'PCMGR', g.u('pcm'), '/proj/from-award');
  const errors = watch(pcm.page);
  await expect(pcm.page.getByTestId('from-award')).toBeVisible();
  await pcm.page.getByTestId('fa-tender').selectOption(String(g.tid));
  // the preview: what will be copied
  await expect(pcm.page.getByTestId('fa-preview')).toBeVisible();
  await expect(pcm.page.getByTestId('fa-value')).toContainText('9,72,00,000.00');
  await expect(pcm.page.getByTestId('fa-copy')).toContainText('BOQ items with their quantities and rates: 3');
  await expect(pcm.page.getByTestId('fa-code')).toHaveValue(new RegExp(`${t.toUpperCase()}-TDR-1`, 'i'));
  if (phone) await noOverflow(pcm.page);
  await shot(pcm.page, '01-from-award');
  // only what the award cannot hold
  await pcm.page.getByTestId('fa-code').fill(code); await pcm.page.getByTestId('fa-type').selectOption('ROAD'); await pcm.page.getByTestId('fa-start').fill('2026-12-01');
  await pick(pcm.page, 'fa-pm', `pm ${t}`, new RegExp(`pm ${t}`)); await pick(pcm.page, 'fa-director', `pd ${t}`, new RegExp(`pd ${t}`));
  await pcm.page.getByTestId('fa-site-code').fill(`${code}-S1`);
  await pcm.page.getByTestId('bl-add-clause').click(); await pcm.page.getByTestId('bl-clause-title-0').fill('Liquidated damages'); await pcm.page.getByTestId('bl-clause-summary-0').fill('0.05 % of the contract value per day, capped at 10 %');
  await pcm.page.getByTestId('fa-create').click();
  // the pack: draft, the sources, the sign-off chain, no costs for the project controller
  await expect(pcm.page.getByTestId('baseline-pack')).toBeVisible({ timeout: 20_000 });
  await expect(pcm.page.getByTestId('baseline-pack')).toHaveAttribute('data-status', 'DRAFT');
  await expect(pcm.page.getByTestId('pack-note')).toBeVisible();
  await expect(pcm.page.getByTestId('pack-value')).toContainText('9,72,00,000.00');
  await expect(pcm.page.getByTestId('pack-cost')).toHaveCount(0);
  await expect(pcm.page.getByTestId('pack-chain').locator('li')).toHaveCount(3);
  await shot(pcm.page, '02-pack-draft');
  const packId = Number(new URL(pcm.page.url()).searchParams.get('id'));
  await pcm.page.getByRole('tab', { name: /Priced BOQ/i }).first().click();
  await expect(pcm.page.getByTestId('pack-boq-row')).toHaveCount(3);
  await expect(pcm.page.getByTestId('pack-boq')).toContainText('Dense bituminous macadam 50 mm');
  await expect(pcm.page.getByTestId('pack-boq')).toContainText('185.50');
  await shot(pcm.page, '03-pack-boq');
  // the project and its BOQ are in the project master
  const boq = await api(request, c, 'PCMGR', g.u('pcm'), 'get', `/proj/boq?projectId=${(await api(request, c, 'PCMGR', g.u('pcm'), 'get', `/proj/baseline-packs/${packId}`)).projectId}`);
  expect(boq.items).toHaveLength(3); expect(boq.items[0].qty).toBe('120000'); expect(boq.items[0].sellingRate).toBe('185.50'); expect(boq.costsVisible).toBe(false);
  // the handover meeting by the project manager
  const pm = await open(browser, info, c, 'PM', g.u('pm'), `/proj/baseline-pack?id=${packId}`);
  const pmErrors = watch(pm.page);
  await pm.page.getByRole('tab', { name: /Handover/i }).click();
  await expect(pm.page.getByTestId('pack-no-meetings')).toBeVisible();
  await pm.page.getByTestId('pack-add-meeting').click();
  await pm.page.getByTestId('att-name-0').fill('Estimation head'); await pm.page.getByTestId('att-name-1').fill('Project manager');
  await pm.page.getByTestId('add-question').click(); await pm.page.getByTestId('q-text-0').fill('Is the rock allowance enough for the cutting at km 14?');
  await pm.page.getByTestId('meeting-minutes').fill('Estimate and assumptions handed over.');
  await pm.page.getByTestId('add-action').click(); await pm.page.getByTestId('act-title-0').fill('Hand over the quotations file'); await pick(pm.page, 'act-owner-0', `est ${t}`, new RegExp(`est ${t}`));
  if (phone) await noOverflow(pm.page);
  await shot(pm.page, '04-handover-form');
  await pm.page.getByTestId('meeting-save').click();
  await expect(pm.page.getByTestId('pack-meeting')).toBeVisible();
  await expect(pm.page.getByTestId('pack-actions-list')).toContainText('Hand over the quotations file');
  await shot(pm.page, '05-handover');
  // the project manager sees no costs and cannot send the pack
  await pm.page.getByRole('tab', { name: /Basis and assumptions/i }).first().click();
  await expect(pm.page.getByTestId('pack-masked')).toBeVisible();
  await expect(pm.page.getByTestId('pack-submit')).toHaveCount(0);
  // sent for sign-off by the project controller; estimation, the commercial manager and the project director sign it
  await pcm.page.reload(); await pcm.page.getByTestId('pack-submit').click();
  await expect(pcm.page.getByTestId('baseline-pack')).toHaveAttribute('data-status', 'SUBMITTED', { timeout: 15_000 });
  const inst = (await api(request, c, 'PCMGR', g.u('pcm'), 'get', `/proj/baseline-packs/${packId}`)).workflowInstanceId;
  await decide(request, c, 'EST', g.u('est'), inst); await decide(request, c, 'COMMGR', g.u('com'), inst); await decide(request, c, 'PD', g.u('pd'), inst);
  // the signed-off pack with costs, intact, immutable; the correction offered to those who may
  const est = await open(browser, info, c, 'PD', g.u('pd'), `/proj/baseline-pack?id=${packId}`);
  const estErrors = watch(est.page);
  await expect(est.page.getByTestId('baseline-pack')).toHaveAttribute('data-status', 'APPROVED');
  await expect(est.page.getByTestId('pack-cost')).toContainText('92,20,00,000.00');
  await expect(est.page.getByTestId('pack-signed')).toBeVisible();
  await expect(est.page.getByTestId('pack-integrity')).toContainText(/intact/i);
  await expect(est.page.getByTestId('pack-amend')).toBeVisible();
  await expect(est.page.getByTestId('pack-submit')).toHaveCount(0); await expect(est.page.getByTestId('pack-edit')).toHaveCount(0);
  if (phone) await noOverflow(est.page);
  await shot(est.page, '06-pack-signed');
  await est.page.getByRole('tab', { name: /Basis and assumptions/i }).first().click();
  await expect(est.page.getByTestId('pack-quoted')).toContainText('Haulage by subcontractor');
  await expect(est.page.getByTestId('pack-risks')).toContainText('Rock in cutting');
  await shot(est.page, '07-pack-basis');
  await est.page.getByRole('tab', { name: /Approvals/i }).click();
  await expect(est.page.getByTestId('pack-approvals')).toContainText('COMMGR');
  // the project page links to the pack; the list; the report
  await est.page.goto('/proj/baseline-packs'); await expect(est.page.getByText(code).first()).toBeVisible(); await shot(est.page, '08-packs');
  await est.page.goto(`/proj/baseline-compare?projectId=${(await api(request, c, 'PD', g.u('pd'), 'get', `/proj/baseline-packs/${packId}`)).projectId}`);
  await expect(est.page.getByTestId('cmp-table')).toBeVisible();
  await expect(est.page.getByTestId('cmp-reason')).toBeVisible();
  await expect(est.page.getByTestId('cmp-sections').locator('li')).toHaveCount(2);
  if (phone) await noOverflow(est.page);
  await shot(est.page, '09-compare');
  // a person without the right sees the no-permission state
  const qs = await open(browser, info, c, 'QS', g.u('pm'), `/proj/baseline-pack?id=${packId}`);
  await expect(qs.page.getByText(/permission|not allowed|may not/i).first()).toBeVisible();
  expect([...errors, ...pmErrors, ...estErrors]).toEqual([]);
});
