import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U, ready, fill } from './hse-helpers.js';
import { rateOf, pctOf } from '../src/server/modules/hse/kpi.js';
import { hseOf } from '../src/server/modules/hse/index.js';
import { project360Providers } from '../src/server/modules/proj/p360.js';

// Part 19.08: the safety KPIs reproduce worked examples (T-01): LTIFR = LTIs x base / man-hours, TRIR, severity rate, near-miss ratio, safe man-hours since the last lost-time injury; leading indicators; site comparison; trend; the monthly PDF; roles and scope; the Project 360 slot.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const local = (h = 0) => new Date(Date.now() + 5.5 * 3600_000 + h * 3_600_000).toISOString().slice(0, 16);
const plusDay = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const inc = (r, o = {}) => ({ projectId: r.A, siteId: r.site, incidentType: 'INJURY', occurredAt: local(-1), description: 'A worker slipped on the shuttering and hurt a wrist', persons: [{ kind: 'OTHER', name: 'Ramesh Kumar', role: 'INJURED', injury: 'Wrist sprain' }], immediateAction: 'First aid given', ...o });
const report = async (r, o) => { const c = await r.call(U.se, 'POST', '/incidents', inc(r, o)); assert.equal(c.status, 201, JSON.stringify(c.json)); return c.json.data; };
const hours = (r, day, h) => fill(r.d, 'att_daily', { company_id: 1, person_type: 'WORKER', person_id: 1, work_date: day, daily_site_id: r.site, status: 'PRESENT', worked_minutes: h * 60, computed_at: '2026-01-01T00:00:00Z' });

test('T-01 BR-01 the formulas: events x base / man-hours to two places, no rate without hours, the share of a whole', () => {
  assert.equal(rateOf(1, 500_000), 2, '1 LTI in 500,000 hours = 2.00 per million'); assert.equal(rateOf(2, 500_000), 4); assert.equal(rateOf(10, 500_000), 20); assert.equal(rateOf(3, 1_200_000), 2.5); assert.equal(rateOf(1, 7), 142857.14); assert.equal(rateOf(1, 500_000, 200_000), 0.4, 'a configurable base'); assert.equal(rateOf(5, 0), null, 'no hours, no rate');
  assert.equal(pctOf(9, 12), 75); assert.equal(pctOf(1, 3), 33.3); assert.equal(pctOf(0, 10), 0); assert.equal(pctOf(0, 0), null);
});

test('FR-01 BR-01 T-01 the dashboard computes LTIFR, TRIR, severity rate, near-miss ratio and the safe man-hours since the last lost-time injury from attendance and incidents', async () => {
  const r = await ready(opened); hours(r, plusDay(-20), 500_000); hours(r, plusDay(-1), 1000);
  await report(r, { classification: 'LTI', lostDays: 10, occurredAt: local(-48) }); await report(r, { classification: 'MEDICAL_TREATMENT', lostDays: 0, occurredAt: local(-30) }); await report(r, { incidentType: 'NEAR_MISS', persons: [], description: 'A load swung close to the crew' });
  const d = (await r.call(U.pm, 'GET', `/dashboard?projectId=${r.A}`)).json.data; const t = Object.fromEntries(d.tiles.map((k) => [k.key, k]));
  assert.equal(d.lagging.manHours, 501_000); assert.deepEqual([d.lagging.lti, d.lagging.recordable, d.lagging.lostDays], [1, 2, 10]); assert.equal(t.ltifr.value, 2, '1 x 1,000,000 / 501,000 = 1.996'); assert.equal(t.trir.value, 3.99); assert.equal(t.severityRate.value, 19.96); assert.equal(t.nearMissRatio.value, 0.5, '1 near miss per 2 recordable'); assert.equal(t.manHours.value, 501_000);
  assert.deepEqual([t.ltifr.target, t.ltifr.status], [1, 'red'], 'twice the target of 1'); assert.deepEqual([d.lagging.safe.lastLtiDate, d.lagging.safe.days, t.safeManHours.value], [plusDay(-2), 2, 1000], 'hours worked since the day after the injury'); assert.equal(d.rateBase, 1_000_000);
  r.setParam('hse.kpi.rate_base', '200000', 'integer'); const d2 = (await r.call(U.pm, 'GET', `/dashboard?projectId=${r.A}`)).json.data; assert.deepEqual([d2.tiles[0].value, d2.tiles[1].value], [0.4, 0.8], 'the base is configuration'); r.setParam('hse.kpi.rate_base', '1000000', 'integer');
  r.setParam('hse.kpi.target_ltifr', '3', 'decimal'); assert.equal((await r.call(U.pm, 'GET', `/dashboard?projectId=${r.A}`)).json.data.tiles[0].status, 'green', 'under the target'); r.setParam('hse.kpi.target_ltifr', '1.5', 'decimal'); assert.equal((await r.call(U.pm, 'GET', `/dashboard?projectId=${r.A}`)).json.data.tiles[0].status, 'amber', '1.996 is within one and a half times 1.5'); r.setParam('hse.kpi.target_ltifr', '1.2', 'decimal'); assert.equal((await r.call(U.pm, 'GET', `/dashboard?projectId=${r.A}`)).json.data.tiles[0].status, 'red', 'above one and a half times 1.2');
  assert.ok(d.exceptions.some((e) => e.key === 'ltifrOverTarget'), 'over the target is an exception'); assert.equal(d.period.days, 365);
  const none = (await r.call(U.pm, 'GET', '/dashboard?from=2020-01-01&to=2020-01-31')).json.data; assert.deepEqual([none.lagging.manHours, none.tiles[0].value, none.tiles[0].status], [0, null, 'neutral'], 'no hours, no rate, no colour');
  assert.equal((await r.call(U.pm, 'GET', '/dashboard?from=2026-02-01&to=2026-01-01')).status, 400, 'start after end');
});

test('FR-01 with no lost-time injury the counter runs from the first attendance; a fatality also restarts it', async () => {
  const r = await ready(opened); hours(r, plusDay(-10), 800); hours(r, plusDay(-2), 200);
  const a = (await r.call(U.pm, 'GET', `/dashboard?projectId=${r.A}`)).json.data; assert.deepEqual([a.lagging.safe.lastLtiDate, a.lagging.safe.since, a.lagging.safe.manHours], [null, plusDay(-10), 1000], 'no LTI on record'); assert.equal(a.tiles.find((k) => k.key === 'safeManHours').status, 'green');
  await report(r, { classification: 'FATALITY', lostDays: 0, occurredAt: local(-24 * 3) }); const b = (await r.call(U.pm, 'GET', `/dashboard?projectId=${r.A}`)).json.data; assert.deepEqual([b.lagging.safe.lastLtiDate, b.lagging.safe.manHours], [plusDay(-3), 200], 'a fatality counts as a lost-time event: only the hours after it');
});

test('FR-02 FR-03 leading indicators, the trend by month and the comparison of sites', async () => {
  const r = await ready(opened); hours(r, plusDay(-5), 1000);
  const o1 = await r.call(U.hsee, 'POST', '/observations', { projectId: r.A, siteId: r.site, obsType: 'UNSAFE_CONDITION', description: 'Open edge on the third floor slab without a guard rail', severity: 'HIGH', responsibleType: 'OWN_CREW' }); assert.equal(o1.status, 201, JSON.stringify(o1.json));
  const o2 = await r.call(U.hsee, 'POST', '/observations', { projectId: r.A, siteId: r.site, obsType: 'UNSAFE_ACT', description: 'A worker without a helmet near the hoist', severity: 'LOW', responsibleType: 'OWN_CREW' }); assert.equal(o2.status, 201);
  r.d.prepare("UPDATE hse_observations SET obs_status = 'CLOSED', closed_on = ? WHERE id = ?").run(plusDay(0), o2.json.data.id);
  const d = (await r.call(U.hseo, 'GET', `/dashboard?projectId=${r.A}`)).json.data; const L = d.leading; assert.deepEqual([L.observations.raised, L.observations.closedOfRaised, L.observations.open, L.observations.closurePct], [2, 1, 1, 50], 'one of two closed');
  const t = Object.fromEntries(d.tiles.map((k) => [k.key, k])); assert.deepEqual([t.observationClosure.value, t.observationClosure.target, t.observationClosure.status], [50, 80, 'red']); assert.equal(t.talks.value, 0); assert.ok(L.talks.expected >= 52, 'a talk a week for a year at one site');
  assert.equal(d.trend.length, 12); assert.equal(d.trend.at(-1).month, plusDay(0).slice(0, 7)); assert.ok(d.trend.every((m) => m.ltifr === null || typeof m.ltifr === 'number'));
  const s2 = Number(r.d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'S2-KPI', 'Second site')").run(r.A).lastInsertRowid); hours({ ...r, site: s2 }, plusDay(-4), 4000); fill(r.d, 'hse_incidents', { company_id: 1, doc_no: 'INC-K1', org_project_id: r.A, org_site_id: s2, incident_type: 'INJURY', classification: 'LTI', severity: 'HIGH', occurred_at: local(-48), description: 'Hand injury', lost_days: 3, incident_status: 'REPORTED', status: 'DRAFT', reported_by: 'se1', created_by: 'test' });
  const c = (await r.call(U.hseo, 'GET', `/dashboard?projectId=${r.A}`)).json.data; assert.equal(c.sites.length, 2); assert.equal(c.sites[0].siteId, s2, 'the site with the worse rate comes first'); assert.deepEqual([c.sites[0].manHours, c.sites[0].lti, c.sites[0].ltifr], [4000, 1, 250], '1 x 1,000,000 / 4,000'); assert.equal(c.sites[1].ltifr, 0);
  const one = (await r.call(U.hseo, 'GET', `/dashboard?siteId=${s2}`)).json.data; assert.equal(one.sites.length, 1);
});

test('FR-03 the monthly report is a PDF, the export is CSV, both audited; the figures stay in the data scope; the roles and the flag', async () => {
  const r = await ready(opened); hours(r, plusDay(-2), 2000);
  const m = plusDay(0).slice(0, 7); const pdf = await r.api.raw('GET', `/api/v1/hse/dashboard/report?month=${m}`, { ...U.pm }); assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /pdf/); assert.match(pdf.headers.get('content-disposition'), new RegExp(`hse-report-${m}`));
  assert.equal((await r.call(U.pm, 'GET', '/dashboard/report?month=2026-13x')).status, 400); assert.equal((await r.call(U.dir, 'GET', `/dashboard/report?month=${m}`)).status, 403, 'the director sees but does not make the report');
  const csv = await r.api.raw('GET', '/api/v1/hse/dashboard/export?kind=sites', { ...U.hseo }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /Site,Project,Man-hours/); assert.equal((await r.call(U.hsee, 'GET', '/dashboard/export')).status, 403, 'the engineer cannot export');
  assert.ok(r.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'hse_dashboard'").get().n >= 2);
  for (const [who, want] of [[U.hseo, 200], [U.pm, 200], [U.pd, 200], [U.dir, 200], [U.hsee, 200], [U.aud, 200], [U.prm, 403], [U.sk, 403], [U.xcli, 403], [U.hrm, 403]]) assert.equal((await r.call(who, 'GET', '/dashboard')).status, want, `${who.roles} /dashboard`);
  assert.deepEqual((await r.call(U.hseoX, 'GET', '/dashboard')).json.data.sites, [], 'another company sees none of these sites');
  r.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.hse.p1908'").run(); assert.equal((await r.call(U.pm, 'GET', '/dashboard')).status, 404);
});

test('integration the nightly check tells the HSE head once when the rate is over target; the Project 360 slot and the widgets read the same figures', async () => {
  const r = await ready(opened); hours(r, plusDay(-2), 100_000); await report(r, { classification: 'LTI', lostDays: 2, occurredAt: local(-24) });
  const k = hseOf(r.d).svc.kpi; const pm = { ...U.pm, user: 'pm1', companyId: 1, roles: ['PM'] }; const a = k.breachCheck(1); assert.equal(a.told, 1); assert.equal(a.ltifr, 10, '1 x 1,000,000 / 100,000'); await r.drain(); const ev = r.events('hse.kpi.breached'); assert.deepEqual([ev.length, ev[0].metric, ev[0].value, ev[0].target], [1, 'ltifr', 10, 1]);
  const n0 = r.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'hse.kpi.alert'").get().n; k.breachCheck(1); assert.equal(r.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'hse.kpi.alert'").get().n, n0, 'once a month');
  r.setParam('hse.kpi.target_ltifr', '50', 'decimal'); assert.equal(k.breachCheck(1).told, 0, 'under the target');
  const w = (await r.call(U.pm, 'GET', `/dashboard?projectId=${r.A}`)).json.data; const pw = k.projectWidget(pm, r.A); assert.equal(pw.figures[0].label, 'LTIFR'); assert.equal(pw.figures[0].value, String(w.tiles[0].value)); assert.equal(pw.figures.length, 4);
  const lw = k.widget(pm, 'hse.ltifr'); assert.equal(lw.value, w.tiles[0].value); const slot = project360Providers.get('hse')({ db: r.d, actor: pm, project: { project_id: r.A } }); assert.equal(slot.figures.length, 4);
});
