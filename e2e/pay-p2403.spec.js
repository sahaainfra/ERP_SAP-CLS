import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';

// Development-header mode. Part 24.03 in the browser (ff.pay.p2403 ON in test), desktop and 360 px phone:
//  AC-01 a week's labour wages computed from the workers' punches, a worker's allowance entered, sent by the site engineer, approved by the site accountant,
//  the project manager and the HR manager; the workers paid in cash and the acknowledgement taken on the phone by the worker's card; the wage register;
//  a contractor's wage sheet with variances on the verification worklist, held from the card's detail; AC-07 no overflow at 360 px.
//  Screenshots (docs/erp/screenshots/24.03).
const SHOTS = 'docs/erp/screenshots/24.03';
const shot = (page, info, name) => page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png`, fullPage: false });
const H = (roles, company, user) => ({ 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': String(company), 'content-type': 'application/json', 'idempotency-key': `e2e-${Math.random().toString(36).slice(2, 12)}` });
const as = async (browser, info, { user, roles, company }) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, hasTouch: info.project.use.hasTouch, reducedMotion: 'reduce' });
  await context.addInitScript(([v]) => { localStorage.setItem('erp.dev.identity', JSON.stringify(v)); localStorage.setItem('erp.appearance', JSON.stringify({ theme: 'light', density: 'comfortable', language: 'en' })); }, [{ user, roles, company: String(company) }]);
  return { context, page: await context.newPage() };
};
let seq = 0;
function fill(db, table, vals) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all(); const sql = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table).sql;
  const first = (name) => { const m = new RegExp(`CHECK \\(${name} IN \\(([^)]*)\\)\\)`).exec(sql); return m ? m[1].split(',')[0].trim().replace(/^'|'$/g, '') : null; };
  const names = []; const params = [];
  for (const c of cols) { if (c.name === 'id') continue; if (c.name in vals) { names.push(c.name); params.push(vals[c.name]); } else if (c.notnull && c.dflt_value == null) { names.push(c.name); params.push(first(c.name) ?? (/INT|REAL|NUM/i.test(c.type) ? 1 : `e2e${(seq += 1)}`)); } }
  return Number(db.prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...params).lastInsertRowid);
}
const noOverflow = async (page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

async function world(request, code) {
  const post = async (path, roles, company, data, user = 'e2e-setup') => { const res = await request.post(`/api/v1${path}`, { headers: H(roles, company, user), data }); expect(res.status(), `${path}: ${await res.text()}`).toBeLessThan(300); return (await res.json()).data; };
  const company = (await post('/iam/org/companies', 'SYSADM', 1, { code, legalName: `${code} Infra Pvt Ltd`, shortName: code })).id; const low = code.toLowerCase();
  const db = new DatabaseSync('data/e2e.sqlite'); db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF'); const ids = {};
  try {
    for (const r of ['SE', 'SACC', 'PM', 'HRMGR', 'SUBCO']) fill(db, 'iam_users', { company_id: company, username: `${low}-${r.toLowerCase()}`, display_name: `${low}-${r}`, roles_json: JSON.stringify([r]), email: `${low}-${r.toLowerCase()}@example.com`, status: 'ACTIVE', is_active: 1 });
    const br = fill(db, 'org_branches', { company_id: company, code: `${code}B`, name: 'Telangana', state_code: 'TS', kind: 'BRANCH', status: 'ACTIVE' });
    ids.project = fill(db, 'org_projects', { company_id: company, code: `${code}P`, name: `${code} Tower`, type: 'BUILDING', status: 'ACTIVE', branch_id: br });
    ids.site = fill(db, 'org_sites', { company_id: company, org_project_id: ids.project, code: `${code}S`, name: `${code} Site`, status: 'ACTIVE', site_type: 'SITE', geofence_type: 'NONE', timezone: 'Asia/Kolkata' });
    const partner = (name) => fill(db, 'mdm_partners', { company_id: company, code: `${code}-${(seq += 1)}`, legal_name: name, trade_name: name, constitution: 'PRIVATE_LIMITED', partner_status: 'ACTIVE', steward_role: 'PROCMGR', created_by: 'e2e' });
    ids.dept = partner(`${code} Departmental Gang`); ids.sub = partner(`${code} Shree Labour`);
    const rate = (o) => fill(db, 'lab_wage_rates', { company_id: company, doc_date: '2026-04-01', status: 'APPROVED', state_code: 'TS', pay_basis: 'DAILY', effective_from: '2026-04-01', ...o });
    rate({ kind: 'MINIMUM', skill_category: 'SKILLED', rate_minor: 70000 }); rate({ kind: 'MINIMUM', skill_category: 'UNSKILLED', rate_minor: 50000 }); rate({ kind: 'CONTRACT', contractor_id: ids.dept, skill_category: 'SKILLED', trade_code: 'MASON', rate_minor: 80000 });
    const worker = (wc, contractor, o = {}) => { const id = fill(db, 'lab_workers', { company_id: company, doc_date: '2026-04-01', status: 'APPROVED', worker_code: wc, name: `Worker ${wc}`, dob: '1990-01-01', gender: 'MALE', home_state: 'TS', trade_code: 'MASON', skill_category: 'SKILLED', contractor_id: contractor, worker_status: 'ACTIVE', ...o }); db.prepare('UPDATE lab_workers SET root_id = id WHERE id = ?').run(id); return id; };
    const punch = (w, date, type, hhmm) => fill(db, 'att_punches', { company_id: company, person_type: 'WORKER', person_id: w, punch_site_id: ids.site, punch_type: type, work_date: date, device_time: `${date}T${hhmm}:00+05:30`, server_time: `${date}T${hhmm}:00+05:30`, effective_time: `${date}T${hhmm}:00+05:30`, method: 'MOBILE', recorded_by: 'e2e', client_uuid: `${code}${w}${date}${type}`, result: 'ACCEPTED', project_id: ids.project, site_id: ids.site });
    const day = (w, date, i, o) => { punch(w, date, 'IN', i); if (o) punch(w, date, 'OUT', o); };
    const w1 = worker(`${code}W1`, ids.dept, { uan: '100200300400' }); const w2 = worker(`${code}W2`, ids.dept, { trade_code: 'HELPER', skill_category: 'UNSKILLED' }); ids.w1 = `${code}W1`;
    for (const dt of ['2026-11-02', '2026-11-03', '2026-11-04']) { day(w1, dt, '08:00', dt === '2026-11-02' ? '19:00' : '17:00'); day(w2, dt, '08:00', '17:00'); }
    const s1 = worker(`${code}S1`, ids.sub); const s2 = worker(`${code}S2`, ids.sub);
    for (const dt of ['2026-10-05', '2026-10-06', '2026-10-07']) { day(s1, dt, '08:00', '17:00'); day(s2, dt, '08:00', '17:00'); }
    ids.s1 = `${code}S1`;
  } finally { db.close(); }
  const u = (r) => `${low}-${r.toLowerCase()}`;
  // the contractor's wage sheet of October, compiled by the subcontractor coordinator and sent for verification (S2 missing, S1 short)
  const ck = await post('/pay/wage-checks', 'SUBCO', company, { contractorId: ids.sub, projectId: ids.project, siteId: ids.site, period: '2026-10' }, u('SUBCO'));
  const res = await request.put(`/api/v1/pay/wage-checks/${ck.id}/sheet`, { headers: H('SUBCO', company, u('SUBCO')), data: { lines: [{ workerCode: ids.s1, days: 2, gross: 1400, net: 1400, paidOn: '2026-11-05' }] } }); expect(res.status()).toBe(200);
  const db2 = new DatabaseSync('data/e2e.sqlite'); db2.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = OFF');
  try { for (const n of ['sheet.pdf', 'proof.pdf']) { const f = fill(db2, 'core_files', { company_id: company, storage_key: `e2e-${code}-${n}-${Date.now()}`, original_name: n, extension: 'pdf', mime: 'application/pdf', category: 'document', size_bytes: 10, sha256: `h${code}${n}${Date.now()}`, scan_status: 'CLEAN', linked_entity: 'pay_contractor_wage_checks', linked_id: ck.id, version_no: 1, retention_class: 'standard', created_by: 'e2e', source_type: 'e2e' }); await post(`/pay/wage-checks/${ck.id}/attach`, 'SUBCO', company, { kind: n.startsWith('sheet') ? 'SHEET' : 'PROOF', fileId: f }, u('SUBCO')); } } finally { db2.close(); }
  await post(`/pay/wage-checks/${ck.id}/submit`, 'SUBCO', company, {}, u('SUBCO'));
  return { company, ...ids, check: ck.id, u };
}

test('AC-01 labour wages from the punches approved SACC → PM → HRMGR, paid and acknowledged on the phone; the register; a contractor\'s wage sheet held for variances, on desktop and phone', async ({ browser, request }, info) => {
  test.setTimeout(240_000);
  const phone = info.project.name === 'mobile'; const w = await world(request, phone ? 'WRM' : 'WRD');
  const se = await as(browser, info, { user: w.u('SE'), roles: 'SE', company: w.company });
  await se.page.goto('/payroll/wage-runs'); await se.page.getByTestId('wr-site').selectOption(String(w.site)); await se.page.getByTestId('wr-contractor').selectOption(String(w.dept));
  await se.page.getByTestId('wr-from').fill('2026-11-02'); await se.page.getByTestId('wr-create').click();
  await expect(se.page.getByTestId('wr-run')).toHaveAttribute('data-status', 'DRAFT'); await expect(se.page.getByTestId('wr-lines').locator(':scope > li')).toHaveCount(2);
  await se.page.getByTestId(`wr-line-${w.w1}`).locator('button.btn-link').click(); await se.page.getByTestId('wr-edit-allowances').fill('150'); await se.page.getByTestId('wr-edit-save').click();
  await expect(se.page.getByTestId('wr-edit')).toHaveCount(0); await expect(se.page.getByTestId('wr-total')).toBeVisible(); await expect(se.page.getByTestId(`wr-line-${w.w1}`)).toContainText('2,662'); if (phone) await noOverflow(se.page);
  await se.page.getByTestId('wr-step-muster').scrollIntoViewIfNeeded(); await shot(se.page, info, 'wage-run');
  await se.page.getByTestId('wr-submit').click(); await expect(se.page.getByTestId('wr-run')).toHaveAttribute('data-status', 'SUBMITTED');
  const id = new URL(se.page.url()).searchParams.get('id');
  for (const r of ['SACC', 'PM', 'HRMGR']) { const s = await as(browser, info, { user: w.u(r), roles: r, company: w.company }); await s.page.goto(`/payroll/wage-runs?id=${id}`); await s.page.getByTestId('wr-decide-approve').click(); await expect(s.page.getByTestId('wr-decide')).toHaveCount(0); await s.context.close(); }
  // payment by the site accountant, the acknowledgement on the site engineer's phone by the worker's card
  const sacc = await as(browser, info, { user: w.u('SACC'), roles: 'SACC', company: w.company }); await sacc.page.goto(`/payroll/wage-runs?id=${id}`);
  await expect(sacc.page.getByTestId('wr-run')).toHaveAttribute('data-status', 'APPROVED'); await sacc.page.getByRole('button', { name: /Choose all unpaid/ }).click(); await sacc.page.getByTestId('wr-pay-go').click();
  await expect(sacc.page.getByTestId('wr-paid')).toContainText('2 / 2'); await sacc.context.close();
  await se.page.goto(`/payroll/wage-runs?id=${id}`); await se.page.getByTestId(`wr-ack-${w.w1}`).click(); await se.page.getByTestId('scan-typed').fill(w.w1); await se.page.getByTestId('scan-typed').press('Enter');
  await expect(se.page.getByTestId(`wr-line-${w.w1}`)).toHaveAttribute('data-ack', 'ACKNOWLEDGED'); await expect(se.page.getByTestId('wr-acked')).toContainText('1 / 2'); if (phone) await noOverflow(se.page);
  await shot(se.page, info, 'wage-disbursement-acknowledgement');
  const pm = await as(browser, info, { user: w.u('PM'), roles: 'PM', company: w.company }); await pm.page.goto('/payroll/wage-register'); await pm.page.getByTestId('wg-from').fill('2026-11-01');
  await expect(pm.page.getByTestId('wg-rows')).toContainText(w.w1); if (phone) await noOverflow(pm.page); await shot(pm.page, info, 'wage-register'); await pm.context.close();
  // the contractor wage verification worklist: the card with its SLA chip; the detail shows the variances; the HR manager holds the contractor's payments
  const hr = await as(browser, info, { user: w.u('HRMGR'), roles: 'HRMGR', company: w.company }); await hr.page.goto('/payroll/contractor-wages');
  await expect(hr.page.getByTestId(`wc-card-${w.check}`)).toContainText('blocking'); await expect(hr.page.getByTestId(`wc-approve-${w.check}`)).toBeDisabled(); if (phone) await noOverflow(hr.page);
  await hr.page.getByTestId(`wc-card-${w.check}`).evaluate((el) => el.scrollIntoView({ block: 'center' })); await shot(hr.page, info, 'contractor-wage-verification');
  await hr.page.getByTestId(`wc-card-${w.check}`).locator('a').click(); await expect(hr.page.getByTestId('wc-list')).toContainText('not on the sheet');
  await hr.page.getByTestId('wc-decide').locator('textarea').fill('Short-paid and a worker missing'); await hr.page.getByTestId('wc-hold').click(); await expect(hr.page.getByTestId('wc-detail')).toHaveAttribute('data-status', 'VARIANCE');
  await hr.context.close(); await se.context.close();
});
