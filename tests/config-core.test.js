import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createParameterRegistry, createParameterStore, coerce, typed } from '../src/server/platform/parameters/index.js';
import { isHoliday, isWorkingDay, holidaysOn } from '../src/server/modules/core/holidays/service.js';
import { GST_STATES, gstinCheckChar, gstinProblem, isCin, isPan, isStateCode, stateName } from '../src/shared/gst.js';
import { todayIST } from '../src/shared/dates.js';
import { admin, startApi } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `cfg-${n}-${Math.random().toString(36).slice(2, 10)}` });
const sys = admin();
const itadm = { roles: 'ITADM', user: 'ishaan', company: '1' };
const pm = { roles: 'PM', user: 'pooja', company: '1' };
const acc = { roles: 'ACCMGR', user: 'asha', company: '1' };
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** A real GSTIN: the state code, a PAN, the entity digit, Z and the computed check character. */
const makeGstin = (state, pan, entity = '1') => {
  const base = `${state}${pan}${entity}Z`;
  return base + gstinCheckChar(base);
};
const PAN = 'AAPCS1234F';

// ---- Indian tax identity ----
test('GST states, PAN, CIN and the GSTIN check character', () => {
  assert.equal(GST_STATES.length, 38);
  assert.equal(stateName('27'), 'Maharashtra');
  assert.equal(stateName('99'), 'Centre Jurisdiction');
  assert.equal(isStateCode('25'), false, 'code 25 was merged into 26');
  assert.ok(isPan('AAPCS1234F') && !isPan('aapcs1234f') && !isPan('AAPC1234F5'));
  assert.ok(isCin('U45200MH2010PTC123456') && !isCin('U45200MH2010XYZ12345'));
  const g = makeGstin('27', PAN);
  assert.equal(gstinProblem(g, { pan: PAN }), null);
  assert.equal(gstinProblem('27AAPFU0939F1ZV'), null, 'a widely published sample GSTIN is accepted');
  assert.match(gstinProblem(g.slice(0, 14) + (g[14] === 'A' ? 'B' : 'A')), /check character/);
  assert.match(gstinProblem(makeGstin('27', PAN), { pan: 'ZZZZZ9999Z' }), /not the company PAN/);
  assert.match(gstinProblem('27AAPCS1234F1Z'), /15 characters/);
  assert.match(gstinProblem(makeGstin('00', PAN)), /not a GST state code/);
});

// ---- company settings ----
const settings = (extra = {}) => ({ legalName: 'Sahaa Infra Pvt Ltd', reason: 'initial set-up', ...extra });
const put = (api, body, who = sys) => api.call('PUT', `${C}/company-settings`, { ...who, headers: key('p'), body });

test('FR-01 company settings are saved with their tax identity, audited, and read back', async () => {
  const api = await startApi();
  const empty = await api.call('GET', `${C}/company-settings`, sys);
  assert.deepEqual([empty.json.data.persisted, empty.json.data.currency, empty.json.data.timezone, empty.json.data.fyStartMonth, empty.json.data.numberFormat], [false, 'INR', 'Asia/Kolkata', 4, 'indian']);
  const body = settings({
    tradeName: 'Sahaa Infra',
    address: { line1: '12 Mill Road', city: 'Mumbai', stateCode: '27', pincode: '400001' },
    pan: PAN,
    cin: 'U45200MH2010PTC123456',
    gstins: [{ stateCode: '27', gstin: makeGstin('27', PAN) }, { stateCode: '29', gstin: makeGstin('29', PAN), tradeName: 'Bengaluru unit' }],
    dateFormat: 'DD/MM/YYYY',
    numberFormat: 'international',
  });
  const saved = await put(api, body);
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.json.data.persisted, saved.json.data.version, saved.json.data.gstins.length, saved.json.data.numberFormat], [true, 1, 2, 'international']);
  const again = await api.call('GET', `${C}/company-settings`, acc);
  assert.equal(again.json.data.pan, PAN);
  const audit = api.db.prepare("SELECT * FROM core_audit_log WHERE entity = 'core_company_settings'").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].reason, 'initial set-up');
  assert.ok(!audit[0].new_values.includes(PAN), 'the audit row records that a PAN exists, not the number');
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.company_settings.changed'").get().n, 1);
  await api.close();
});

test('settings are validated field by field with messages a person can act on', async () => {
  const api = await startApi();
  const r = await put(api, settings({ currency: 'rupee', timezone: 'Mars/Base', dateFormat: 'MM-DD', fyStartMonth: 13 }));
  assert.equal(r.status, 400);
  const fields = r.json.error.details.map((d) => d.field);
  for (const f of ['currency', 'timezone', 'dateFormat', 'fyStartMonth']) assert.ok(fields.includes(f), `${f} should be reported: ${fields.join(', ')}`);
  const r2 = await put(api, settings({ pan: 'BADPAN', cin: 'X1', gstins: [{ stateCode: '27', gstin: '27AAAAA0000A1Z5' }, { stateCode: '29', gstin: makeGstin('27', PAN) }] }));
  assert.equal(r2.status, 400);
  const fields2 = r2.json.error.details.map((d) => d.field);
  for (const f of ['pan', 'cin', 'gstins.0.gstin', 'gstins.1.gstin']) assert.ok(fields2.includes(f), `${f} should be reported: ${fields2.join(', ')}`);
  const mismatch = await put(api, settings({ pan: PAN, gstins: [{ stateCode: '27', gstin: makeGstin('27', 'BBBPB9999B') }] }));
  assert.match(mismatch.json.error.details[0].message, /not the company PAN/);
  const twice = await put(api, settings({ gstins: [{ stateCode: '27', gstin: makeGstin('27', PAN) }, { stateCode: '27', gstin: makeGstin('27', PAN) }] }));
  assert.match(twice.json.error.details[0].message, /listed twice/);
  assert.equal((await put(api, { legalName: 'x', reason: 'initial set-up' })).status, 400, 'a legal name needs at least 2 characters');
  assert.equal((await put(api, { legalName: 'Sahaa', reason: 'abc' })).status, 400, 'a reason is required');
  assert.equal((await put(api, settings({ address: { pincode: '12345' } }))).status, 400);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_company_settings').get().n, 0, 'nothing invalid was saved');
  await api.close();
});

test('settings use optimistic locking, and a second save needs the current version', async () => {
  const api = await startApi();
  const first = await put(api, settings());
  assert.equal((await put(api, settings({ legalName: 'Renamed Pvt Ltd' }))).status, 409, 'no version sent for an existing row');
  const ok = await put(api, settings({ legalName: 'Renamed Pvt Ltd', version: first.json.data.version, reason: 'renamed after merger' }));
  assert.equal(ok.json.data.version, 2);
  const stale = await put(api, settings({ legalName: 'Third Name Ltd', version: first.json.data.version, reason: 'a stale edit' }));
  assert.equal(stale.status, 409);
  assert.match(stale.json.error.message, /changed by someone else/);
  assert.equal((await api.call('GET', `${C}/company-settings`, sys)).json.data.legalName, 'Renamed Pvt Ltd');
  await api.close();
});

test('AC-05 who can read and change the settings: the Accounts Manager reads, only the System Administrator changes', async () => {
  const api = await startApi();
  await put(api, settings({ pan: PAN }));
  assert.equal((await api.call('GET', `${C}/company-settings`, acc)).status, 200);
  assert.equal((await api.call('GET', `${C}/company-settings`, pm)).status, 403);
  assert.equal((await api.call('GET', `${C}/company-settings`, itadm)).status, 403);
  assert.equal((await put(api, settings(), acc)).status, 403);
  assert.equal((await put(api, settings(), pm)).status, 403);
  const other = await api.call('GET', `${C}/company-settings`, { ...sys, company: '2' });
  assert.deepEqual([other.json.data.persisted, other.json.data.legalName], [false, ''], 'another company never sees these');
  await api.close();
});

test('every signed-in user can read the display formats, and nothing else about the company', async () => {
  const api = await startApi();
  await put(api, settings({ pan: PAN, dateFormat: 'YYYY-MM-DD', numberFormat: 'international' }));
  const r = await api.call('GET', `${C}/display-settings`, pm);
  assert.deepEqual(r.json.data, { companyId: 1, legalName: 'Sahaa Infra Pvt Ltd', currency: 'INR', timezone: 'Asia/Kolkata', dateFormat: 'YYYY-MM-DD', numberFormat: 'international', fyStartMonth: 4 });
  assert.ok(!JSON.stringify(r.json).includes(PAN));
  assert.equal((await api.call('GET', `${C}/display-settings`, { user: null })).status, 401);
  const none = await api.call('GET', `${C}/display-settings`, { ...pm, company: '' });
  assert.equal(none.status, 200, 'a user with no company still gets the defaults');
  await api.close();
});

// ---- parameters ----
test('FR-05 parameter values are checked against their type and limits', () => {
  const def = (o) => ({ key: 'x.y.z', dataType: 'integer', default: 5, ...o });
  assert.equal(coerce(def({ min: 1, max: 10 }), ' 7 '), '7');
  assert.throws(() => coerce(def({ min: 1, max: 10 }), '11'), /at most 10/);
  assert.throws(() => coerce(def({}), '1.5'), /whole number/);
  assert.equal(coerce(def({ dataType: 'decimal' }), '12.50'), '12.50');
  assert.throws(() => coerce(def({ dataType: 'decimal' }), '1e3'), /decimal/);
  assert.equal(coerce(def({ dataType: 'boolean' }), true), 'true');
  assert.throws(() => coerce(def({ dataType: 'boolean' }), 'yes'), /true or false/);
  assert.equal(coerce(def({ dataType: 'date' }), '2026-02-28'), '2026-02-28');
  assert.throws(() => coerce(def({ dataType: 'date' }), '2026-02-30'), /real date/);
  assert.equal(coerce(def({ dataType: 'json' }), [0, 6]), '[0,6]');
  assert.throws(() => coerce(def({ dataType: 'json' }), '{bad'), /valid JSON/);
  assert.throws(() => coerce(def({ dataType: 'string', allowed: ['a', 'b'] }), 'c'), /one of a, b/);
  assert.equal(typed('integer', '7'), 7);
  assert.equal(typed('decimal', '12.50').toString(), '12.50');
  assert.deepEqual(typed('json', '[0,6]'), [0, 6]);
  assert.throws(() => createParameterRegistry().define({ key: 'bad key', dataType: 'string', default: 'a' }), /module.area.name/);
  assert.throws(() => createParameterRegistry().define({ key: 'a.b.c', dataType: 'integer', default: 'x' }), /whole number/, 'a default must itself be valid');
});

const setParam = (api, body, who = sys) => api.call('POST', `${C}/parameters`, { ...who, headers: key('p'), body: { reason: 'tuning for this company', ...body } });
const resolveParam = (api, q, who = sys) => api.call('GET', `${C}/parameters/resolve?${q}`, who).then((r) => r.json.data);

test('parameters resolve default, then system, company, project and site, the most specific winning', async () => {
  const api = await startApi();
  const today = todayIST();
  const k = 'core.ui.default_page_size';
  assert.deepEqual(await resolveParam(api, `key=${k}`), { key: k, value: '25', source: 'default', effectiveFrom: null });
  assert.equal((await setParam(api, { key: k, value: 50, scopeType: 'system', effectiveFrom: today }, itadm)).status, 201);
  assert.deepEqual(await resolveParam(api, `key=${k}`).then((r) => [r.value, r.source]), ['50', 'system']);
  await setParam(api, { key: k, value: 100, scopeType: 'company', scopeId: 1, effectiveFrom: today });
  assert.deepEqual(await resolveParam(api, `key=${k}`).then((r) => [r.value, r.source]), ['100', 'company']);
  assert.deepEqual(await resolveParam(api, `key=${k}`, { ...sys, company: '2' }).then((r) => [r.value, r.source]), ['50', 'system'], 'another company still sees the system value');
  await api.call('POST', `${C}/parameters`, { ...sys, headers: key('x'), body: { key: 'core.calendar.week_off_days', value: [0], scopeType: 'company', scopeId: 1, effectiveFrom: today, reason: 'company default week' } });
  await api.call('POST', `${C}/parameters`, { ...sys, headers: key('y'), body: { key: 'core.calendar.week_off_days', value: [0, 6], scopeType: 'site', scopeId: 9, effectiveFrom: today, reason: 'site works a five-day week' } });
  assert.equal(await resolveParam(api, 'key=core.calendar.week_off_days&siteId=9').then((r) => r.value), '[0,6]');
  assert.equal(await resolveParam(api, 'key=core.calendar.week_off_days&siteId=10').then((r) => r.value), '[0]');
  await api.close();
});

test('BR-03 a new value starts on its effective date and the old one is kept as history', async () => {
  const api = await startApi();
  const today = todayIST();
  const tomorrow = addDays(today, 1);
  const k = 'core.session.timeout_minutes';
  await setParam(api, { key: k, value: 30, scopeType: 'company', scopeId: 1, effectiveFrom: today });
  const future = await setParam(api, { key: k, value: 45, scopeType: 'company', scopeId: 1, effectiveFrom: tomorrow });
  assert.equal(future.json.data.state, 'future');
  assert.equal(await resolveParam(api, `key=${k}`).then((r) => r.value), '30', 'today the old value still applies');
  assert.equal(await resolveParam(api, `key=${k}&date=${tomorrow}`).then((r) => r.value), '45', 'from the effective date the new value applies');
  const rows = (await api.call('GET', `${C}/parameters?filter[key]=${k}`, sys)).json.data;
  assert.equal(rows.length, 2, 'both rows are kept');
  const old = rows.find((r) => r.value === '30');
  assert.equal(old.effectiveTo, today, 'the old row ends the day before the new one starts');
  assert.deepEqual(rows.map((r) => r.state).sort(), ['current', 'future']);
  // a value inserted between two others is limited by the later one
  const between = await setParam(api, { key: k, value: 40, scopeType: 'company', scopeId: 1, effectiveFrom: addDays(today, 0) === today ? addDays(today, 0) : today }).catch(() => null);
  assert.equal(between.status, 409, 'a value already starts on that date');
  assert.equal((await setParam(api, { key: k, value: 60, scopeType: 'company', scopeId: 1, effectiveFrom: addDays(today, -1) })).status, 422, 'the past is never rewritten');
  const history = api.db.prepare("SELECT action FROM core_audit_log WHERE entity = 'core_parameters'").all();
  assert.equal(history.length, 2);
  await api.close();
});

test('a value inserted between two later ones is closed by the next one', async () => {
  const api = await startApi();
  const today = todayIST();
  const k = 'core.export.max_rows';
  await setParam(api, { key: k, value: 60000, scopeType: 'system', effectiveFrom: addDays(today, 10) }, itadm);
  const mid = await setParam(api, { key: k, value: 70000, scopeType: 'system', effectiveFrom: addDays(today, 3) }, itadm);
  assert.equal(mid.json.data.effectiveTo, addDays(today, 9), 'ends the day before the later value starts');
  assert.equal(await resolveParam(api, `key=${k}&date=${addDays(today, 5)}`).then((r) => r.value), '70000');
  assert.equal(await resolveParam(api, `key=${k}&date=${addDays(today, 12)}`).then((r) => r.value), '60000');
  await api.close();
});

test('parameter writes are refused for unknown keys, wrong scopes, bad values, and people without the right', async () => {
  const api = await startApi();
  const today = todayIST();
  const base = { key: 'core.session.timeout_minutes', value: 20, scopeType: 'company', scopeId: 1, effectiveFrom: today };
  assert.equal((await setParam(api, { ...base, key: 'core.nope.nothing' })).status, 404);
  assert.equal((await setParam(api, { ...base, scopeType: 'site', scopeId: 4 })).status, 422, 'this parameter is not set per site');
  const range = await setParam(api, { ...base, value: 2 });
  assert.equal(range.status, 400);
  assert.match(range.json.error.details[0].message, /at least 5/);
  assert.equal((await setParam(api, { ...base, scopeId: 2 })).status, 403, 'only your own company');
  assert.equal((await setParam(api, { ...base, scopeType: 'system', scopeId: null })).status, 403, 'the System Administrator cannot change the whole installation');
  assert.equal((await setParam(api, base, itadm)).status, 403, 'the IT Administrator does not change company values');
  assert.equal((await setParam(api, base, pm)).status, 403);
  assert.equal((await api.call('GET', `${C}/parameters`, pm)).status, 403);
  assert.equal((await api.call('GET', `${C}/parameters/definitions`, acc)).status, 200);
  const defs = (await api.call('GET', `${C}/parameters/definitions`, sys)).json.data;
  assert.deepEqual(defs.map((d) => d.key), ['core.audit.retention_months', 'core.calendar.week_off_days', 'core.export.max_rows', 'core.session.timeout_minutes', 'core.ui.default_page_size', 'eng.workflow.default_sla_hours', 'eng.workflow.escalation_hours', 'iam.dormant.action', 'iam.dormant.days', 'iam.elevation.max_hours', 'ui.approval.sla_hours', 'ui.device.image_max_px', 'ui.device.image_quality', 'ui.device.low_bandwidth_image_px', 'ui.device.low_bandwidth_quality', 'ui.locale.number_style', 'ui.locale.time_format', 'ui.search.min_query_length', 'ui.search.results_per_group', 'ui.search.retention_days', 'ui.widget.timeliness_target']);
  await api.close();
});

test('the parameter store caches resolved values and drops the cache the moment a value is set', async () => {
  const api = await startApi();
  const reg = createParameterRegistry();
  reg.define({ key: 'test.area.limit', dataType: 'integer', default: 1 });
  const store = createParameterStore(api.db, reg);
  const ctx = { companyId: 1, date: '2026-10-15' };
  assert.equal(store.get('test.area.limit', ctx), 1);
  assert.equal(store.get('test.area.limit', ctx), 1);
  assert.equal(store.cacheSize(), 1, 'the second read came from the cache');
  api.db.prepare("INSERT INTO core_parameters (key, value, data_type, scope_type, scope_id, effective_from, company_id) VALUES ('test.area.limit', '9', 'integer', 'company', 1, '2026-01-01', 1)").run();
  assert.equal(store.get('test.area.limit', ctx), 1, 'still cached until invalidated');
  store.invalidate();
  assert.equal(store.get('test.area.limit', ctx), 9);
  assert.throws(() => store.get('test.area.unknown', ctx), /Unknown parameter/);
  await api.close();
});

// ---- holidays ----
const mkCal = (api, body, who = sys) => api.call('POST', `${C}/holiday-calendars`, { ...who, headers: key('c'), body: { reason: 'set up the calendar', ...body } });
const addHol = (api, calId, body, who = sys) => api.call('POST', `${C}/holiday-calendars/${calId}/holidays`, { ...who, headers: key('h'), body });

test('FR-06 holiday calendars per company, state and site, with holidays added, edited and deleted', async () => {
  const api = await startApi();
  const all = (await mkCal(api, { code: 'IN-ALL', name: 'Company holidays' })).json.data;
  const mh = (await mkCal(api, { code: 'MH', name: 'Maharashtra', stateCode: '27' })).json.data;
  assert.equal((await mkCal(api, { code: 'MH', name: 'Again' })).status, 409);
  assert.equal((await mkCal(api, { code: 'XX', name: 'Bad state', stateCode: '25' })).status, 422);
  const h = await addHol(api, all.id, { date: '2026-01-26', name: 'Republic Day', type: 'national' });
  assert.equal(h.status, 201);
  assert.equal((await addHol(api, all.id, { date: '2026-01-26', name: 'Duplicate' })).status, 409);
  assert.equal((await addHol(api, all.id, { date: '2026-02-30', name: 'Not a day' })).status, 400);
  const edit = await api.call('PATCH', `${C}/holidays/${h.json.data.id}`, { ...sys, headers: key(1), body: { name: 'Republic Day (India)', version: h.json.data.version } });
  assert.equal(edit.json.data.name, 'Republic Day (India)');
  assert.equal((await api.call('PATCH', `${C}/holidays/${h.json.data.id}`, { ...sys, headers: key(2), body: { name: 'Stale', version: h.json.data.version } })).status, 409);
  const list = await api.call('GET', `${C}/holiday-calendars`, pm);
  assert.deepEqual(list.json.data.map((c) => [c.code, c.holidayCount]), [['IN-ALL', 1], ['MH', 0]], 'anyone signed in can read the calendars');
  assert.equal((await api.call('DELETE', `${C}/holidays/${h.json.data.id}`, sys)).status, 200);
  assert.equal((await addHol(api, all.id, { date: '2026-01-26', name: 'Republic Day again' })).status, 201, 'a deleted holiday frees its date');
  assert.equal((await api.call('GET', `${C}/holiday-calendars/${all.id}?from=2026-01-01&to=2026-12-31`, pm)).json.data.holidays.length, 1);
  assert.equal(mh.stateCode, '27');
  assert.equal((await mkCal(api, { code: 'NOPE', name: 'Not allowed' }, pm)).status, 403);
  assert.equal((await addHol(api, all.id, { date: '2026-03-01', name: 'Nope' }, pm)).status, 403);
  await api.close();
});

test('a date is a holiday if a company-wide calendar, its state calendar or its site calendar says so', async () => {
  const api = await startApi();
  const company = (await mkCal(api, { code: 'IN-ALL', name: 'Company' })).json.data;
  const mh = (await mkCal(api, { code: 'MH', name: 'Maharashtra', stateCode: '27' })).json.data;
  const site = (await mkCal(api, { code: 'SITE-9', name: 'Site 9', siteId: 9 })).json.data;
  await addHol(api, company.id, { date: '2026-08-15', name: 'Independence Day', type: 'national' });
  await addHol(api, mh.id, { date: '2026-05-01', name: 'Maharashtra Day', type: 'state' });
  await addHol(api, site.id, { date: '2026-06-10', name: 'Site shutdown', type: 'site' });
  const check = (q) => api.call('GET', `${C}/holidays/check?${q}`, pm).then((r) => r.json.data);
  assert.equal((await check('date=2026-08-15')).isHoliday, true, 'company-wide applies everywhere');
  assert.equal((await check('date=2026-05-01')).isHoliday, false, 'a state holiday needs the state');
  assert.deepEqual((await check('date=2026-05-01&stateCode=27')).matches.map((m) => m.name), ['Maharashtra Day']);
  assert.equal((await check('date=2026-05-01&stateCode=29')).isHoliday, false);
  assert.equal((await check('date=2026-06-10&siteId=9')).isHoliday, true);
  assert.equal((await check('date=2026-06-10&siteId=8')).isHoliday, false);
  assert.equal(isHoliday(api.db, { companyId: 1, date: '2026-08-15' }), true);
  assert.equal(holidaysOn(api.db, { companyId: 2, date: '2026-08-15' }).length, 0, 'another company has none');
  await api.close();
});

test('a working day is neither a weekly off nor a holiday, with the week-off parameter per company and site', async () => {
  const api = await startApi();
  const reg = createParameterRegistry();
  reg.define({ key: 'core.calendar.week_off_days', dataType: 'json', default: [0], scopes: ['system', 'company', 'site'] });
  const store = createParameterStore(api.db, reg);
  const company = (await mkCal(api, { code: 'IN-ALL', name: 'Company' })).json.data;
  await addHol(api, company.id, { date: '2026-10-21', name: 'A Wednesday holiday' });
  const wd = (date, siteId) => isWorkingDay(api.db, store, { companyId: 1, date, siteId });
  assert.equal(wd('2026-10-19'), true, 'Monday');
  assert.equal(wd('2026-10-18'), false, 'Sunday is the default weekly off');
  assert.equal(wd('2026-10-24'), true, 'Saturday works by default');
  assert.equal(wd('2026-10-21'), false, 'a holiday');
  api.db.prepare("INSERT INTO core_parameters (key, value, data_type, scope_type, scope_id, effective_from, company_id) VALUES ('core.calendar.week_off_days', '[0,6]', 'json', 'site', 9, '2026-01-01', 1)").run();
  store.invalidate();
  assert.equal(wd('2026-10-24', 9), false, 'this site is off on Saturdays');
  assert.equal(wd('2026-10-24', 10), true);
  await api.close();
});

test('FR-06 import is all or nothing: every bad row is listed and nothing is saved; a good file adds and updates', async () => {
  const api = await startApi();
  const cal = (await mkCal(api, { code: 'IN-ALL', name: 'Company' })).json.data;
  const imp = (rows, who = sys) => api.call('POST', `${C}/holiday-calendars/${cal.id}/import`, { ...who, headers: key('i'), body: { rows } });
  const bad = await imp([
    { date: '2026-01-26', name: 'Republic Day', type: 'national' },
    { date: '26/01/2026', name: 'Wrong format', type: 'national' },
    { date: '2026-03-04', name: '', type: 'company' },
    { date: '2026-04-14', name: 'Ambedkar Jayanti', type: 'festival' },
    { date: '2026-01-26', name: 'Same day twice', type: 'national' },
  ]);
  assert.equal(bad.status, 400);
  assert.match(bad.json.error.message, /4 problem\(s\); nothing was imported/);
  assert.deepEqual(bad.json.error.details.map((d) => d.field), ['rows.1', 'rows.2', 'rows.3', 'rows.4']);
  assert.match(bad.json.error.details[0].message, /^Row 2: /);
  assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM core_holidays').get().n, 0);
  const good = await imp([
    { date: '2026-01-26', name: 'Republic Day', type: 'national' },
    { date: '2026-08-15', name: 'Independence Day', type: 'national' },
    { date: '2026-10-02', name: 'Gandhi Jayanti', type: 'national' },
  ]);
  assert.deepEqual(good.json.data, { added: 3, updated: 0, unchanged: 0 });
  const second = await imp([
    { date: '2026-01-26', name: 'Republic Day', type: 'national' },
    { date: '2026-08-15', name: 'Independence Day (India)', type: 'national' },
    { date: '2026-11-08', name: 'Diwali', type: 'optional' },
  ]);
  assert.deepEqual(second.json.data, { added: 1, updated: 1, unchanged: 1 });
  assert.equal((await imp([])).status, 400);
  assert.equal((await imp(Array.from({ length: 401 }, (_, i) => ({ date: '2026-01-01', name: `n${i}`, type: 'company' })))).status, 400);
  assert.equal((await imp([{ date: '2026-01-26', name: 'x y', type: 'company' }], pm)).status, 403);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE action = 'import'").get().n, 2);
  await api.close();
});

// ---- the module's public API ----
test('the core module exposes period control, numbering, holidays and parameters to other modules', async () => {
  const api = await import('../src/server/modules/core/api.js');
  for (const name of ['assertPeriodOpen', 'findFinancialYear', 'issueNumber', 'previewNumber', 'cancelNumber', 'holidaysOn', 'isHoliday', 'isWorkingDay', 'createParameterStore', 'defineParameter', 'parameterRegistry']) {
    assert.ok(api[name], `${name} is exported`);
  }
  assert.deepEqual([...api.PERIOD_MODULES], ['finance', 'payroll', 'procurement', 'inventory', 'plant', 'projects']);
});
