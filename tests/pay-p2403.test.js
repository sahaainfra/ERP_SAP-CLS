import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, attachFile, fill, key, partnerOf, U as QU } from './qa-helpers.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { payOf } from '../src/server/modules/pay/index.js';
import { compareSheet, cycleOf, dayOf, wageOf } from '../src/server/modules/pay/wages.js';
import { todayIST } from '../src/shared/dates.js';

// 30.04 D-806: the week still running, worked out from today (the fixed 16-Nov week was over by 23-Nov)
const thisMonday = () => { const d = new Date(`${todayIST()}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

// Part 24.03: labour wages and contract labour payroll.
//  T-01 overtime at the statutory multiplier and minimum-wage enforcement (BR-01); contractor variance detection.
//  and: days and overtime from the labour punches; piece work from a measurement with the minimum guaranteed; PF/ESI; weekly/fortnightly/monthly cycles;
//  SACC → PM → HRMGR (the SACC step skipped when the SACC prepared it); payment, late payment and the worker's acknowledgement by card or photograph;
//  slips in Hindi, the muster roll and the wage register; the contractor's wage sheet verified, returned or held and the hold of 21.04; rights and scope.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, se: as('SE', 'se1'), sacc: as('SACC', 'sacc1'), pm: as('PM', 'pm1'), hr: as('HRMGR', 'hr1'), subco: as('SUBCO', 'subco1'), aud: as('AUD', 'aud1') };
const P = '/api/v1/pay';
const RULES = { dayHours: 8, restMinutes: 60, halfDayHours: 4, otBlockMinutes: 30 };

test('T-01 a worker\'s day from the punches: full, half, overtime in blocks beyond the day and the rest interval; no OUT is a flagged full day', () => {
  const p = (inT, outT) => [{ type: 'IN', at: `2026-11-02T${inT}:00+05:30` }, ...(outT ? [{ type: 'OUT', at: `2026-11-02T${outT}:00+05:30` }] : [])];
  assert.deepEqual([dayOf(p('08:00', '19:00'), RULES).day, dayOf(p('08:00', '19:00'), RULES).otMinutes], [1, 120], '11 hours less the hour of rest: a day and 2 hours of overtime');
  assert.deepEqual([dayOf(p('08:00', '19:20'), RULES).otMinutes], [120], 'overtime in whole blocks of 30 minutes');
  assert.equal(dayOf(p('08:00', '12:30'), RULES).day, 0.5); assert.equal(dayOf(p('08:00', '10:00'), RULES).day, 0);
  const x = dayOf(p('08:00', null), RULES); assert.deepEqual([x.day, x.missingOut, x.otMinutes], [1, true, 0]);
  assert.deepEqual(cycleOf('WEEKLY', '2026-11-02'), { from: '2026-11-02', to: '2026-11-08' }); assert.deepEqual(cycleOf('FORTNIGHTLY', '2026-11-16'), { from: '2026-11-16', to: '2026-11-30' });
  assert.ok(cycleOf('FORTNIGHTLY', '2026-11-05').error); assert.deepEqual(cycleOf('MONTHLY', '2026-02-01'), { from: '2026-02-01', to: '2026-02-28' }); assert.ok(cycleOf('MONTHLY', '2026-02-02').error);
});

test('T-01 wages: overtime at twice the ordinary hourly rate, PF to the ceiling of the period, ESI, piece work topped up to the minimum, a rate below the minimum and deductions above the cap block', () => {
  const pf = { employeeRate: 12, employerEpfRate: 3.67, epsRate: 8.33, edliRate: 0.5, adminRate: 0.5, wageCeiling: 15000, restrictToCeiling: true }; const esi = { employeeRate: 0.75, employerRate: 3.25, wageCeiling: 21000 };
  const w = wageOf({ basis: 'DAILY', days: 3.5, otHours: 2, rate: 80000, minRate: 70000, dayHours: 8, otMultiplier: 2, pf, esi: null, periodDays: 7, capPct: 50 });
  assert.deepEqual([w.basic, w.otRate, w.ot, w.gross, w.pf, w.net], [280000, 20000, 40000, 320000, 33600, 286400], 'by hand: 3½ × ₹800; OT ₹800 ÷ 8 × 2 = ₹200 an hour; PF 12 % of ₹2,800 (under the ceiling of ₹3,500 for 7 days)');
  assert.equal(w.flags.length, 0);
  const capped = wageOf({ basis: 'DAILY', days: 20, otHours: 0, rate: 80000, minRate: 70000, dayHours: 8, otMultiplier: 2, pf, esi: null, periodDays: 30, capPct: 50 }); assert.equal(capped.pf, 180000, 'PF on the ₹15,000 ceiling of a month');
  const e = wageOf({ basis: 'DAILY', days: 2, otHours: 0, rate: 50000, minRate: 50000, dayHours: 8, otMultiplier: 2, pf: null, esi, periodDays: 7, capPct: 50 }); assert.deepEqual([e.esiCovered, e.esi, e.esiEr], [true, 800, 3300], 'ESI rounded up to the rupee');
  const below = wageOf({ basis: 'DAILY', days: 1, otHours: 0, rate: 60000, minRate: 70000, dayHours: 8, otMultiplier: 2, periodDays: 7, capPct: 50 }); assert.ok(below.flags.some((f) => f.code === 'BELOW_MINIMUM' && f.severity === 'BLOCK'), 'BR-01');
  const piece = wageOf({ basis: 'PIECE', days: 2, otHours: 1, rate: 0, minRate: 50000, pieceQty: 30, pieceRate: 2000, dayHours: 8, otMultiplier: 2, periodDays: 7, capPct: 50 });
  assert.deepEqual([piece.piece, piece.topup, piece.ot, piece.gross], [60000, 40000, 12500, 112500], 'piece ₹600, topped up to 2 days × ₹500, OT at the minimum ÷ 8 × 2');
  const cap = wageOf({ basis: 'DAILY', days: 1, otHours: 0, rate: 70000, minRate: 70000, dayHours: 8, otMultiplier: 2, advance: 40000, periodDays: 7, capPct: 50 }); assert.ok(cap.flags.some((f) => f.code === 'DEDUCTION_CAP'));
});

test('T-01 contractor variance detection: missing, short days, below minimum, late or unpaid are blocking; extra days and unknown workers warn', () => {
  const attendance = [{ code: 'W3', name: 'A', days: 3, otHours: 0, minRate: 70000 }, { code: 'W4', name: 'B', days: 2, otHours: 0, minRate: 70000 }, { code: 'W6', name: 'C', days: 1, otHours: 0, minRate: 70000 }];
  const sheet = [{ workerCode: 'W3', days: 2, otHours: 0, gross: 1000, deductions: 0, net: 1000, paidOn: '2026-11-05' }, { workerCode: 'W6', days: 2, otHours: 0, gross: 1400, deductions: 0, net: 1400, paidOn: '2026-11-09' }, { workerCode: 'X9', days: 1, gross: 700, deductions: 0, net: 700, paidOn: '2026-11-05', known: false }];
  const r = compareSheet({ attendance, sheet, dueOn: '2026-11-07', dayHours: 8, otMultiplier: 2, capPct: 50 }); const codes = r.variances.map((v) => `${v.workerCode}:${v.code}`).sort();
  assert.deepEqual(codes, ['W3:BELOW_MINIMUM', 'W3:DAYS_SHORT', 'W4:MISSING_FROM_SHEET', 'W6:DAYS_EXCESS', 'W6:LATE_PAYMENT', 'X9:UNKNOWN_WORKER']); assert.equal(r.blocking, 4);
});

test('AC-01 labour wages computed from the punches, approved SACC → PM → HRMGR, paid with acknowledgement; slips, muster and register; BR-01 below-minimum refused', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const br = fill(d, 'org_branches', { company_id: 1, code: 'TSB', name: 'Telangana', state_code: 'TS', kind: 'BRANCH' }); d.prepare('UPDATE org_projects SET branch_id = ? WHERE id = ?').run(br, r.A);
  const dept = partnerOf(r, 'Departmental Labour'); const rate = (o) => fill(d, 'lab_wage_rates', { company_id: 1, doc_date: '2026-04-01', status: 'APPROVED', state_code: 'TS', pay_basis: 'DAILY', effective_from: '2026-04-01', ...o });
  rate({ kind: 'MINIMUM', skill_category: 'SKILLED', rate_minor: 70000, min_wage_ref: 'G.O. TS 2026' }); rate({ kind: 'MINIMUM', skill_category: 'UNSKILLED', rate_minor: 50000 }); rate({ kind: 'CONTRACT', contractor_id: dept, skill_category: 'SKILLED', trade_code: 'MASON', rate_minor: 80000 });
  const worker = (code, o = {}) => { const id = fill(d, 'lab_workers', { company_id: 1, doc_date: '2026-04-01', status: 'APPROVED', worker_code: code, name: `Worker ${code}`, dob: '1990-01-01', gender: 'MALE', home_state: 'TS', trade_code: 'MASON', skill_category: 'SKILLED', contractor_id: dept, worker_status: 'ACTIVE', qr_token: `tok${code}`, ...o }); d.prepare('UPDATE lab_workers SET root_id = id WHERE id = ?').run(id); return id; };
  const w1 = worker('W1', { uan: '100200300400', bank_last4: '4321' }); const w2 = worker('W2', { trade_code: 'HELPER', skill_category: 'UNSKILLED', esic_ip: '3100200300' });
  const punch = (w, date, type, hhmm) => d.prepare("INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, method, recorded_by, client_uuid, result, project_id, site_id, created_by, source_type) VALUES (1, 'WORKER', ?, ?, ?, ?, ?, ?, ?, 'MOBILE', 't', ?, 'ACCEPTED', ?, ?, 't', 'test')").run(w, r.site, type, date, `${date}T${hhmm}:00+05:30`, `${date}T${hhmm}:00+05:30`, `${date}T${hhmm}:00+05:30`, `u${w}${date}${type}${Math.random()}`, r.A, r.site);
  const day = (w, date, i, o) => { punch(w, date, 'IN', i); if (o) punch(w, date, 'OUT', o); };
  day(w1, '2026-11-02', '08:00', '19:00'); day(w1, '2026-11-03', '08:00', '17:00'); day(w1, '2026-11-04', '08:00', '12:30'); day(w1, '2026-11-05', '08:00', null);
  day(w2, '2026-11-02', '08:00', '17:00'); day(w2, '2026-11-03', '08:00', '17:00'); day(w2, '2026-11-12', '08:00', '17:00');

  assert.equal((await call(U.aud, 'POST', '/wage-runs', { siteId: r.site, contractorId: dept, cycle: 'WEEKLY', periodFrom: '2026-11-02' })).status, 403, 'the auditor reads only');
  assert.equal((await call(U.se, 'POST', '/wage-runs', { siteId: r.site, contractorId: dept, cycle: 'WEEKLY', periodFrom: thisMonday() })).status, 422, 'a period not yet over (this week)');
  assert.equal((await call(U.se, 'POST', '/wage-runs', { siteId: r.site, contractorId: dept, cycle: 'FORTNIGHTLY', periodFrom: '2026-11-03' })).status, 400, 'a fortnight starts on the 1st or the 16th');
  const c = await call(U.se, 'POST', '/wage-runs', { siteId: r.site, contractorId: dept, cycle: 'WEEKLY', periodFrom: '2026-11-02' }); assert.equal(c.status, 201, JSON.stringify(c.json)); let run = c.json.data;
  assert.equal((await call(U.se, 'POST', '/wage-runs', { siteId: r.site, contractorId: dept, cycle: 'MONTHLY', periodFrom: '2026-11-01' })).status, 422, 'November is not over');
  assert.equal((await call(U.se, 'POST', '/wage-runs', { siteId: r.site, contractorId: dept, cycle: 'WEEKLY', periodFrom: '2026-10-31' })).status, 409, 'overlaps the run of the week');
  assert.deepEqual([run.workers, run.payDueOn, run.state], [2, '2026-11-08', 'TS'], 'the week\'s workers; weekly wages due on the last day (Code on Wages s.17)');
  const L = (x, w) => x.lines.find((l) => l.workerId === w); assert.equal(L(run, w1).rate, null, 'the site engineer does not see rates'); assert.equal(L(run, w1).net, 2864);
  run = (await call(U.sacc, 'GET', `/wage-runs/${run.id}`)).json.data; let l1 = L(run, w1); let l2 = L(run, w2);
  // by hand: W1 3½ days (the 4th a half day, the 5th without OUT counted and flagged), 2 h overtime, ₹800 contract rate above the ₹700 minimum; PF 12 % of ₹2,800
  assert.deepEqual([l1.days, l1.otHours, l1.rate, l1.minRate, l1.rateSource, l1.basic, l1.ot, l1.gross, l1.pf, l1.net], [3.5, 2, 800, 700, 'CONTRACT', 2800, 400, 3200, 336, 2864]);
  assert.ok(l1.flags.some((f) => f.code === 'MISSING_OUT')); assert.equal(l1.dayLog.length, 4);
  assert.deepEqual([l2.days, l2.rate, l2.rateSource, l2.gross, l2.esi, l2.net], [2, 500, 'MINIMUM', 1000, 8, 992], 'W2 at the minimum (no contract rate for helpers); ESI 0.75 % rounded up; the 12th is outside the week');
  // BR-01: a rate below the minimum is refused; piece work from an approved measurement with the minimum guaranteed
  const bad = await call(U.sacc, 'PATCH', `/wage-runs/${run.id}/lines/${l1.id}`, { rateOverride: 600 }); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /minimum wage/);
  const mb = fill(d, 'bill_mb_entries', { company_id: 1, org_project_id: r.A, boq_line_id: 1, description: 'Plaster', template: 'QTY', qty_th: 50000, uom: 'sqm', measured_by: 't', measured_on: '2026-11-03', status: 'APPROVED' }); const mbB = fill(d, 'bill_mb_entries', { company_id: 1, org_project_id: r.B, boq_line_id: 1, description: 'Other', template: 'QTY', qty_th: 50000, measured_by: 't', measured_on: '2026-11-03', status: 'APPROVED' });
  assert.equal((await call(U.sacc, 'PATCH', `/wage-runs/${run.id}/lines/${l2.id}`, { basis: 'PIECE', pieceRate: 20, pieceSources: [{ mbId: mbB, qty: 10 }] })).status, 400, 'a measurement of another project');
  let u = await call(U.sacc, 'PATCH', `/wage-runs/${run.id}/lines/${l2.id}`, { basis: 'PIECE', pieceRate: 20, pieceSources: [{ mbId: mb, qty: 30 }], canteen: 50 }); assert.equal(u.status, 200, JSON.stringify(u.json)); l2 = L(u.json.data, w2);
  assert.deepEqual([l2.basis, l2.pieceQty, l2.pieceUom, l2.piece, l2.topup, l2.gross, l2.canteen], ['PIECE', 30, 'sqm', 600, 400, 1000, 50], 'piece ₹600 topped up to the minimum of 2 days');
  u = await call(U.sacc, 'PATCH', `/wage-runs/${run.id}/lines/${l1.id}`, { adjust: { days: 0.5, reason: 'Muster: worked the full day on the 4th' }, allowances: 100 }); assert.equal(u.status, 200); l1 = L(u.json.data, w1);
  assert.deepEqual([l1.days, l1.basic, l1.allowances, l1.gross], [4, 3200, 100, 3700]); assert.equal((await call(U.sacc, 'PATCH', `/wage-runs/${run.id}/lines/${l1.id}`, { adjust: { days: 1, reason: 'no' } })).status, 400, 'a reason is needed');
  assert.equal((await call(U.sacc, 'PATCH', `/wage-runs/${run.id}/lines/${l1.id}`, { allowances: 0, version: 1 })).status, 409, 'a stale version');
  // approval SE → SACC → PM → HRMGR; the maker cannot approve
  assert.equal((await call(U.se, 'POST', `/wage-runs/${run.id}/submit`)).status, 202); const inst = r.wf('pay_wage_runs', run.id);
  run = (await call(U.se, 'GET', `/wage-runs/${run.id}`)).json.data; assert.equal(run.status, 'SUBMITTED'); assert.equal(run.can.approve, false);
  assert.equal((await r.act(U.sacc, inst)).status, 200); assert.equal((await r.act(U.pm, inst)).status, 200); assert.equal((await r.act(U.hr, inst)).status, 200);
  run = (await call(U.sacc, 'GET', `/wage-runs/${run.id}`)).json.data; assert.equal(run.status, 'APPROVED'); assert.ok(run.lockedAt);
  assert.equal((await call(U.sacc, 'PATCH', `/wage-runs/${run.id}/lines/${l1.id}`, { allowances: 0 })).status, 409, 'an approved run is locked');
  const ev = r.events('pay.wage_run.approved'); assert.equal(ev.length, 1); assert.deepEqual([ev[0].workers, ev[0].net, ev[0].contractorId], [2, run.net, dept]);
  // payment: a bank transfer needs the worker's account; a late payment is recorded as late; the acknowledgement by the worker's card or a photograph
  assert.equal((await call(U.se, 'POST', `/wage-runs/${run.id}/pay`, { lineIds: [l1.id], mode: 'BANK', paidOn: '2026-11-08', reference: 'UTR1' })).status, 403, 'the site engineer does not pay');
  assert.equal((await call(U.sacc, 'POST', `/wage-runs/${run.id}/pay`, { lineIds: [l2.id], mode: 'BANK', paidOn: '2026-11-08', reference: 'UTR1' })).status, 422, 'W2 has no bank account');
  assert.equal((await call(U.sacc, 'POST', `/wage-runs/${run.id}/pay`, { lineIds: [l1.id], mode: 'BANK', paidOn: '2026-11-08', reference: 'UTR1' })).status, 200);
  assert.equal((await call(U.sacc, 'POST', `/wage-runs/${run.id}/lines/${l2.id}/acknowledge`, { method: 'CARD', badge: 'LAB:tokW2' })).status, 422, 'not paid yet');
  run = (await call(U.sacc, 'POST', `/wage-runs/${run.id}/pay`, { lineIds: [l2.id], mode: 'CASH', paidOn: '2026-11-10' })).json.data; assert.ok(run.disbursedAt); assert.equal(L(run, w2).late, true); assert.equal(L(run, w1).late, false);
  assert.equal((await call(U.se, 'POST', `/wage-runs/${run.id}/lines/${l1.id}/acknowledge`, { method: 'CARD', badge: 'LAB:tokW2' })).status, 422, 'the card of another worker');
  assert.equal((await call(U.se, 'POST', `/wage-runs/${run.id}/lines/${l1.id}/acknowledge`, { method: 'CARD', badge: 'LAB:tokW1' })).status, 200);
  const photo = attachFile(r, 'pay_wage_lines', l2.id); run = (await call(U.se, 'POST', `/wage-runs/${run.id}/lines/${l2.id}/acknowledge`, { method: 'PHOTO', fileId: photo })).json.data;
  assert.deepEqual([run.paid, run.acknowledged, L(run, w1).ack, L(run, w2).ackMethod], [2, 2, 'ACKNOWLEDGED', 'PHOTO']);
  // slips in Hindi, the muster roll and the register (24.04)
  const slip = await r.api.raw('GET', `${P}/wage-runs/${run.id}/slips?lang=hi`, U.sacc); assert.equal(slip.status, 200); assert.match(slip.buffer.toString('utf8'), /मज़दूरी पर्ची/); assert.match(slip.buffer.toString('utf8'), /W1 Worker W1/);
  const must = await r.api.raw('GET', `${P}/wage-runs/${run.id}/muster`, U.sacc); assert.equal(must.status, 200); assert.match(must.buffer.toString('utf8'), /W1,Worker W1,MASON,P,P,½,P,A,A,A,4,2/);
  const reg = (await call(U.pm, 'GET', '/wage-register?from=2026-11-01&to=2026-11-30')).json.data; assert.deepEqual([reg.runs, reg.rows.length, reg.totals.late, reg.totals.acknowledged], [1, 2, 1, 2]);
  assert.equal((await r.api.raw('GET', `${P}/wage-register/export?from=2026-11-01&to=2026-11-30`, U.pm)).status, 200); assert.equal((await r.api.raw('GET', `${P}/wage-runs/${run.id}/muster?format=pdf`, U.sacc)).status, 200);
  // scope: a project manager of the other project sees nothing
  const svc = payOf(d).wages; authzOf(d).seed(); const role = d.prepare("SELECT id FROM iam_roles WHERE code = 'PM'").get(); const uid = Number(d.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'pmb', 'PM B', '[]', 'pmb@example.com')").run().lastInsertRowid);
  d.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, effective_from, status, is_active, created_by, source_type) VALUES (1, ?, ?, 'PROJECT', ?, '2026-01-01', 'ACTIVE', 1, 't', 'test')").run(uid, role.id, JSON.stringify([r.B])); authzOf(d).invalidate();
  const pmb = { user: 'pmb', userId: uid, companyId: 1, roles: [] }; assert.throws(() => svc.runs.get(pmb, run.id), /does not exist/); assert.equal(svc.runs.list(pmb, {}).data.length, 0);
});

test('AC-01 contractor wage compliance: the sheet against the attendance, held for variances (21.04 hold), corrected and verified (hold lifted); the compiler cannot verify', async () => {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d; const call = (who, method, path, body, k = key()) => r.api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const br = fill(d, 'org_branches', { company_id: 1, code: 'TSB', name: 'Telangana', state_code: 'TS', kind: 'BRANCH' }); d.prepare('UPDATE org_projects SET branch_id = ? WHERE id = ?').run(br, r.A);
  const k = partnerOf(r, 'Shree Labour'); fill(d, 'lab_wage_rates', { company_id: 1, doc_date: '2026-04-01', status: 'APPROVED', state_code: 'TS', pay_basis: 'DAILY', effective_from: '2026-04-01', kind: 'MINIMUM', skill_category: 'SKILLED', rate_minor: 70000 });
  const worker = (code) => { const id = fill(d, 'lab_workers', { company_id: 1, doc_date: '2026-04-01', status: 'APPROVED', worker_code: code, name: `Worker ${code}`, dob: '1990-01-01', gender: 'MALE', trade_code: 'MASON', skill_category: 'SKILLED', contractor_id: k, worker_status: 'ACTIVE' }); d.prepare('UPDATE lab_workers SET root_id = id WHERE id = ?').run(id); return id; };
  const w3 = worker('W3'); const w4 = worker('W4');
  const punch = (w, date, type, hhmm) => d.prepare("INSERT INTO att_punches (company_id, person_type, person_id, punch_site_id, punch_type, work_date, device_time, server_time, effective_time, method, recorded_by, client_uuid, result, project_id, site_id, created_by, source_type) VALUES (1, 'WORKER', ?, ?, ?, ?, ?, ?, ?, 'MOBILE', 't', ?, 'ACCEPTED', ?, ?, 't', 'test')").run(w, r.site, type, date, `${date}T${hhmm}:00+05:30`, `${date}T${hhmm}:00+05:30`, `${date}T${hhmm}:00+05:30`, `c${w}${date}${type}`, r.A, r.site);
  for (const dt of ['2026-10-05', '2026-10-06', '2026-10-07']) { punch(w3, dt, 'IN', '08:00'); punch(w3, dt, 'OUT', '17:00'); } for (const dt of ['2026-10-05', '2026-10-06']) { punch(w4, dt, 'IN', '08:00'); punch(w4, dt, 'OUT', '17:00'); }
  assert.equal((await call(U.pm, 'POST', '/wage-checks', { contractorId: k, projectId: r.A, period: '2026-10' })).status, 403, 'the PM does not compile');
  const c = await call(U.subco, 'POST', '/wage-checks', { contractorId: k, projectId: r.A, period: '2026-10' }); assert.equal(c.status, 201, JSON.stringify(c.json)); let ck = c.json.data;
  assert.deepEqual([ck.payDueOn, ck.verifyDueOn, ck.workers, ck.attendanceDays], ['2026-11-07', '2026-11-10', 2, 5], 'monthly wages due in 7 days (CLRA r.63)');
  assert.equal((await call(U.subco, 'POST', '/wage-checks', { contractorId: k, projectId: r.A, period: '2026-10' })).status, 409);
  const bad = await call(U.subco, 'PUT', `/wage-checks/${ck.id}/sheet`, { csv: 'worker code,days,gross,net\nW3,two,1000,1000\n' }); assert.equal(bad.status, 400, 'rows are checked');
  ck = (await call(U.subco, 'PUT', `/wage-checks/${ck.id}/sheet`, { csv: 'Worker code,Days,OT hours,Gross,Deductions,Net,Paid on\nW3,2,0,1000,0,1000,2026-11-05\nX999,1,0,700,0,700,2026-11-05\n' })).json.data;
  assert.deepEqual(ck.varianceList.map((v) => `${v.workerCode}:${v.code}`).sort(), ['W3:BELOW_MINIMUM', 'W3:DAYS_SHORT', 'W4:MISSING_FROM_SHEET', 'X999:UNKNOWN_WORKER'], 'T-01 contractor variances'); assert.equal(ck.blocking, 3);
  const sub = await call(U.subco, 'POST', `/wage-checks/${ck.id}/submit`); assert.equal(sub.status, 400, 'the signed sheet and the proof of payment are needed');
  for (const kind of ['SHEET', 'PROOF']) assert.equal((await call(U.subco, 'POST', `/wage-checks/${ck.id}/attach`, { kind, fileId: attachFile(r, 'pay_contractor_wage_checks', ck.id, `${kind}.pdf`) })).status, 200);
  assert.equal((await call(U.subco, 'POST', `/wage-checks/${ck.id}/submit`)).status, 202);
  const wl = (await call(U.hr, 'GET', '/wage-checks/worklist')).json.data; assert.equal(wl.counts.toVerify, 1); assert.equal(wl.rows[0].can.verify, true);
  assert.equal((await call(U.subco, 'POST', `/wage-checks/${ck.id}/decide`, { decision: 'VERIFY' })).status, 403, 'the compiler does not verify');
  assert.equal((await call(U.hr, 'POST', `/wage-checks/${ck.id}/decide`, { decision: 'VERIFY' })).status, 422, 'blocking variances are not verified');
  ck = (await call(U.hr, 'POST', `/wage-checks/${ck.id}/decide`, { decision: 'HOLD', note: 'Short-paid and missing workers' })).json.data; assert.deepEqual([ck.status, ck.hold], ['VARIANCE', true]);
  // BR-01: the contractor's payments on the project are held in the subcontractor workspace (21.04)
  let h = d.prepare('SELECT * FROM ctr_sub_holds WHERE subcontractor_id = ? AND org_project_id = ?').get(k, r.A); assert.equal(h?.hold, 1); assert.match(h.reasons_json, /wage sheet/);
  assert.equal(r.events('ctr.sub.hold_changed').at(-1).hold, true); assert.equal(r.events('pay.contractor_wage.variance').length, 1);
  // corrected and verified: the hold is lifted
  ck = (await call(U.subco, 'PUT', `/wage-checks/${ck.id}/sheet`, { lines: [{ workerCode: 'W3', days: 3, gross: 2400, net: 2400, paidOn: '2026-11-05' }, { workerCode: 'W4', days: 2, gross: 1500, deductions: 100, net: 1400, paidOn: '2026-11-06' }] })).json.data; assert.equal(ck.variances, 0);
  assert.equal((await call(U.subco, 'POST', `/wage-checks/${ck.id}/submit`)).status, 202); ck = (await call(U.hr, 'POST', `/wage-checks/${ck.id}/decide`, { decision: 'VERIFY' })).json.data; assert.deepEqual([ck.status, ck.hold], ['VERIFIED', false]);
  h = d.prepare('SELECT * FROM ctr_sub_holds WHERE subcontractor_id = ? AND org_project_id = ?').get(k, r.A); assert.equal(h.hold, 0); assert.equal(r.events('ctr.sub.hold_changed').at(-1).hold, false);
  assert.equal((await call(U.aud, 'GET', `/wage-checks/${ck.id}`)).status, 200); assert.equal((await call(U.aud, 'PUT', `/wage-checks/${ck.id}/sheet`, { lines: [] })).status, 403);
});
