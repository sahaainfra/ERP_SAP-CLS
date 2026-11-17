import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { gstinCheckChar } from '../src/server/platform/mdm/index.js';
import { convertExact } from '../src/server/modules/mdm/common.js';
import { setupCompany, startApi } from './helpers.js';

// Part 06.02: the common masters. T-01 a transaction dated before a GST rate change uses the old rate; T-02 IFSC validation rejects invalid codes; T-03 lookup list Hindi labels appear when the person's language
// is Hindi. Also: a statutory change goes to an accounts manager and then the CFO (the proposer cannot approve; return and resubmit; reject), units convert exactly both ways (BR-02), a company's change of a
// system row stays its own, stewards per master, the partner form uses the states master (AC-01).
const M = '/api/v1/mdm';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'c') => ({ ...json, 'idempotency-key': `cm-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const acc = as('ACCMGR', 'acc1');
const acc2 = as('ACCMGR', 'acc2');
const cfo = as('CFO', 'cfo1');
const proc = as('PROCMGR', 'proc1');
const sys = as('SYSADM', 'sys1');
const se = as('SE', 'se1');
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const user = (api, name, roles, company = 1) => Number(api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (?, ?, ?, ?, ?)').run(company, name, `${name.toUpperCase()} Iyer`, JSON.stringify(roles), `${name}@example.com`).lastInsertRowid);
const act = async (api, who, instanceId, action = 'approve', comment = 'checked against the notification') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
  const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['acc1', ['ACCMGR']], ['acc2', ['ACCMGR']], ['cfo1', ['CFO']], ['proc1', ['PROCMGR']], ['sys1', ['SYSADM']], ['se1', ['SE']]]) user(api, n, r);
  const call = (who, method, path, body, k) => api.call(method, `${M}${path}`, { ...who, headers: key(k), body });
  const find = async (who, master, k, extra = '') => (await call(who, 'GET', `/common/${master}?q=${encodeURIComponent(k)}${extra}`)).json.data.rows.find((r) => Object.values(r).includes(k));
  return { api, call, find };
};

test('BR-02 units convert through their base as exact fractions: a conversion and its reverse give the quantity back', () => {
  for (const [q, a, b] of [['7', '0.09290304', '1'], ['3', '1000', '0.001'], ['12.5', '2.8316846592', '0.028316846592']]) {
    const there = convertExact(q, a, b, 12);
    assert.equal(convertExact(there, b, a, 12), q, `${q}: ${a} -> ${b} -> back`);
  }
  assert.equal(convertExact('1', '1000', '1', 3), '1000');
});

// part 166.8: cement's own change (28 % → 18 % from 22-09-2025) is now a seed row; the workflow is shown on another code
test('T-01 BR-01 a GST change from a date is approved by an accounts manager and the CFO; a transaction dated before it keeps the old rate', async () => {
  const t = await setup();
  const bricks = await t.find(acc, 'hsn-sac', '6904');
  assert.equal(bricks.defaultGstRate, 'GST12');
  const before = await t.call(acc, 'GET', `/tax/gst?hsn=6904&date=${day(0)}`);
  assert.equal(before.json.data.rate.igstPct, '12');
  // only the steward of taxes proposes; a reason is required
  assert.equal((await t.call(proc, 'PUT', `/common/hsn-sac/${bricks.id}`, { data: { defaultGstRate: 'GST5' }, effectiveFrom: day(5), justification: 'A test change of a rate', version: bricks.rowVersion })).status, 403);
  assert.equal((await t.call(acc, 'PUT', `/common/hsn-sac/${bricks.id}`, { data: { defaultGstRate: 'GST5' }, effectiveFrom: day(5), version: bricks.rowVersion })).status, 400);
  const p = await t.call(acc, 'PUT', `/common/hsn-sac/${bricks.id}`, { data: { defaultGstRate: 'GST5' }, effectiveFrom: day(5), justification: 'A test change of a rate: ceramic bricks from 12% to 5%', version: bricks.rowVersion });
  assert.equal(p.status, 202, JSON.stringify(p.json));
  assert.equal((await t.call(acc, 'GET', `/tax/gst?hsn=6904&date=${day(6)}`)).json.data.rate.igstPct, '12', 'nothing changes before approval');
  assert.equal((await t.call(acc, 'PUT', `/common/hsn-sac/${bricks.id}`, { data: { defaultGstRate: 'GST5' }, effectiveFrom: day(7), justification: 'Another change of bricks', version: bricks.rowVersion })).status, 409, 'one change of a code at a time');
  // the proposer cannot approve; another accounts manager and the CFO do
  const mine = (await t.api.call('GET', `${W}/tasks?mine=assigned`, acc)).json.data.rows.filter((x) => x.instance.id === p.json.data.workflow.id);
  assert.equal(mine.length, 0, 'the proposer has no task');
  await act(t.api, acc2, p.json.data.workflow.id);
  await act(t.api, cfo, p.json.data.workflow.id);
  const on = (d) => t.call(acc, 'GET', `/tax/gst?hsn=6904&date=${d}`);
  assert.equal((await on(day(4))).json.data.rate.igstPct, '12', 'a transaction dated before the change keeps the old rate');
  assert.equal((await on(day(5))).json.data.rate.igstPct, '5', 'from the date, the new rate');
  assert.equal((await on('2024-01-15')).json.data.rate.igstPct, '12');
  const hist = (await t.call(acc, 'GET', `/common/hsn-sac/${bricks.id}`)).json.data.history;
  assert.equal(hist.length, 2);
  assert.deepEqual(hist.map((h) => [h.effectiveFrom, h.effectiveTo, h.system]), [[day(5), null, false], ['2017-07-01', null, true]], 'the company row applies from its date; the system row stays for earlier dates');
  assert.equal((await t.call(acc, 'GET', `/common/hsn-sac?asOf=${day(5)}&q=6904`)).json.data.rows[0].defaultGstRate, 'GST5');
  // another company is not affected
  const other = await t.api.call('GET', `${M}/tax/gst?hsn=6904&date=${day(6)}`, as('ACCMGR', 'acc9', '2'));
  if (other.status === 200) assert.equal(other.json.data.rate.igstPct, '12');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'mdm.common.decided' AND user_ref = 'acc1'").get().n, 1, 'the proposer is told');
  // the change is in the 06.01 worklist with what changed
  const cr = (await t.call(acc, 'GET', `/change-requests/${p.json.data.changeRequestId}`)).json.data;
  assert.equal(cr.masterLabel, 'HSN/SAC codes');
  assert.equal(cr.fields[0].before, 'GST12');
  assert.equal(cr.fields[0].after, 'GST5');
});

test('statutory changes: IGST must be CGST plus SGST; return, resubmit and reject; a TDS section from a date', async () => {
  const t = await setup();
  assert.equal((await t.call(acc, 'POST', '/common/gst-rates', { data: { code: 'GST45', description: '45% (a test slab)', igstPct: '45', cgstPct: '22.5', sgstPct: '10' }, effectiveFrom: day(1), justification: 'New 40% slab announced' })).status, 400);
  const n = await t.call(acc, 'POST', '/common/gst-rates', { data: { code: 'GST45', description: '45% (a test slab)', igstPct: '45', cgstPct: '22.5', sgstPct: '22.5' }, effectiveFrom: day(1), justification: 'New 40% slab announced by the Council' });
  assert.equal(n.status, 202, JSON.stringify(n.json));
  await act(t.api, acc2, n.json.data.workflow.id, 'return', 'Give the notification number');
  assert.equal((await t.call(acc, 'GET', `/change-requests/${n.json.data.changeRequestId}`)).json.data.status, 'RETURNED');
  const again = await t.call(acc, 'POST', `/change-requests/${n.json.data.changeRequestId}/resubmit`, { justification: 'New 40% slab, notification 10/2025-Central Tax (Rate)' });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  await act(t.api, acc2, n.json.data.workflow.id);
  await act(t.api, cfo, n.json.data.workflow.id, 'reject', 'Not yet notified');
  assert.equal((await t.call(acc, 'GET', `/change-requests/${n.json.data.changeRequestId}`)).json.data.status, 'REJECTED');
  assert.equal((await t.call(acc, 'GET', `/tax/gst?code=GST45&date=${day(2)}`)).status, 404, 'a rejected rate never applies');
  const c = await t.find(acc, 'tds-sections', '194C');
  const p = await t.call(acc, 'PUT', `/common/tds-sections/${c.id}`, { data: { thresholdSingle: '50000' }, effectiveFrom: day(3), justification: 'Finance Act: single payment threshold raised' });
  assert.equal(p.status, 400, 'the row version is required');
  const p2 = await t.call(acc, 'PUT', `/common/tds-sections/${c.id}`, { data: { thresholdSingle: '50000' }, effectiveFrom: day(3), justification: 'Finance Act: single payment threshold raised', version: c.rowVersion });
  assert.equal(p2.status, 202, JSON.stringify(p2.json));
  await act(t.api, acc2, p2.json.data.workflow.id);
  await act(t.api, cfo, p2.json.data.workflow.id);
  assert.equal((await t.call(acc, 'GET', `/tax/tds?section=194C&date=${day(2)}`)).json.data.section.thresholdSingle, '30000');
  assert.equal((await t.call(acc, 'GET', `/tax/tds?section=194C&date=${day(3)}`)).json.data.section.thresholdSingle, '50000');
  assert.equal((await t.call(acc, 'POST', `/common/tds-sections/${c.id}/retire`, { reason: 'no longer used', version: c.rowVersion })).status, 422, 'a statutory row is ended by a newer one');
});

test('T-02 FR-06 IFSC validation rejects invalid codes; banks are kept by the accounts manager; an exchange rate applies until the next one', async () => {
  const t = await setup();
  for (const bad of ['SBIN001234', 'SBIN1001234', '1BIN0001234', 'SBIN0001234X']) {
    const r = await t.call(acc, 'POST', '/common/banks', { data: { ifsc: bad, bankName: 'State Bank of India', branch: 'Shivajinagar' } });
    assert.equal(r.status, 400, bad);
    assert.ok(r.json.error.details.some((d) => d.field === 'ifsc'), bad);
  }
  const ok = await t.call(acc, 'POST', '/common/banks', { data: { ifsc: 'sbin0001234', bankName: 'State Bank of India', branch: 'Shivajinagar', city: 'Pune', micr: '411002003' } });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.data.row.ifsc, 'SBIN0001234');
  assert.equal((await t.call(acc, 'POST', '/common/banks', { data: { ifsc: 'SBIN0001234', bankName: 'State Bank of India', branch: 'Other' } })).status, 409);
  assert.equal((await t.call(se, 'POST', '/common/banks', { data: { ifsc: 'HDFC0000001', bankName: 'HDFC Bank', branch: 'Fort' } })).status, 403);
  assert.equal((await t.call(se, 'GET', '/common/banks')).json.data.rows.length, 1, 'everyone reads');
  const look = await t.api.call('GET', `${M}/lookups/banks?q=Shivaji`, se);
  assert.equal(look.status, 200, JSON.stringify(look.json));
  assert.equal(look.json.data[0].code, 'SBIN0001234');
  assert.equal((await t.call(acc, 'POST', '/common/exchange-rates', { data: { currencyCode: 'USD', rateDate: day(-3), rateToInr: '83.25' } })).status, 201);
  assert.equal((await t.call(acc, 'POST', '/common/exchange-rates', { data: { currencyCode: 'USD', rateDate: day(-1), rateToInr: '83.5' } })).status, 201);
  assert.equal((await t.call(se, 'GET', `/exchange-rate?currency=USD&date=${day(-2)}`)).json.data.rateToInr, '83.25');
  assert.equal((await t.call(se, 'GET', `/exchange-rate?currency=USD&date=${day(0)}`)).json.data.rateToInr, '83.5');
  assert.equal((await t.call(se, 'GET', `/exchange-rate?currency=EUR&date=${day(0)}`)).status, 404);
  // payment terms: the advance and the milestones add up to 100%
  assert.equal((await t.call(acc, 'POST', '/common/payment-terms', { data: { code: 'MS-BAD', termKind: 'PAYMENT', description: 'Wrong split', advancePct: '10', milestones: [{ label: 'On delivery', pct: 80, days: 0 }] } })).status, 400);
  assert.equal((await t.call(acc, 'POST', '/common/payment-terms', { data: { code: 'MS-OK', termKind: 'PAYMENT', description: '20% advance, 80% on delivery', advancePct: '20', milestones: [{ label: 'On delivery', pct: 80, days: 15 }] } })).status, 201);
});

test('T-03 FR-08 lookup lists: labels in Hindi when the person works in Hindi; the Lookup List Manager adds, changes and inactivates values (never deletes)', async () => {
  const t = await setup();
  const en = await t.api.call('GET', `${M}/lookups/priority`, se);
  assert.equal(en.status, 200, JSON.stringify(en.json));
  assert.deepEqual(en.json.data.map((r) => r.name), ['Low', 'Medium', 'High', 'Urgent']);
  t.api.db.prepare("INSERT INTO ui_user_preferences (company_id, user_ref, language, created_by, source_type) VALUES (1, 'se1', 'hi', 't', 't')").run();
  const hi = await t.api.call('GET', `${M}/lookups/priority`, se);
  assert.deepEqual(hi.json.data.map((r) => r.name), ['निम्न', 'मध्यम', 'उच्च', 'अत्यावश्यक']);
  assert.equal((await t.call(se, 'GET', '/lookup-lists/DELAY_CAUSE')).json.data.rows[0].label, 'मौसम');
  assert.equal((await t.call(se, 'GET', '/lookup-lists/DELAY_CAUSE?lang=en')).json.data.rows[0].label, 'Weather');
  assert.equal((await t.api.call('GET', `${M}/lookups/no-such-list`, se)).status, 404);
  // the manager: only the system administrator
  const cur = (await t.call(sys, 'GET', '/lookup-lists/PRIORITY?all=true')).json.data.rows;
  const values = cur.filter((r) => r.code !== 'URGENT').map((r) => ({ code: r.code, labelEn: r.labelEn, labelHi: r.labelHi, sortOrder: r.sortOrder }));
  values.push({ code: 'CRITICAL', labelEn: 'Critical', labelHi: 'गंभीर', sortOrder: 50 });
  values[0].labelEn = 'Low priority';
  assert.equal((await t.call(acc, 'PUT', '/lookup-lists/PRIORITY', { values, reason: 'Critical replaces urgent' })).status, 403);
  const saved = await t.call(sys, 'PUT', '/lookup-lists/PRIORITY', { values, reason: 'Critical replaces urgent' });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual([saved.json.data.added, saved.json.data.changed, saved.json.data.inactivated], [1, 1, 1]);
  const after = await t.api.call('GET', `${M}/lookups/priority`, as('SE', 'se1'));
  assert.deepEqual(after.json.data.map((r) => r.code), ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
  assert.ok((await t.call(sys, 'GET', '/lookup-lists/PRIORITY?all=true')).json.data.rows.some((r) => r.code === 'URGENT' && r.active === false), 'kept, inactive');
  // the change is the company's own: another company still sees the system list
  const other = t.api.db.prepare("SELECT COUNT(*) AS n FROM mdm_lookups WHERE company_id IS NULL AND list_code = 'PRIORITY' AND code = 'URGENT' AND active = 1").get().n;
  assert.equal(other, 1);
});

test('FR-01 BR-02 units: the procurement manager keeps them, a unit converts only within its category, through its base unit; the calculation engine gets the unit', async () => {
  const t = await setup();
  const c = await t.call(se, 'GET', '/uoms/convert?quantity=2.5&from=MT&to=KG');
  assert.equal(c.json.data.result, '2500');
  // BR-02: the factor of a pair and of its reverse multiply to 1 within the precision shown (12 places); the quantity itself is rounded to the target unit's decimals
  const there = Number((await t.call(se, 'GET', '/uoms/convert?quantity=1&from=SQFT&to=SQM')).json.data.factor);
  const back = Number((await t.call(se, 'GET', '/uoms/convert?quantity=1&from=SQM&to=SQFT')).json.data.factor);
  assert.ok(Math.abs(there * back - 1) < 1e-9, `${there} x ${back}`);
  assert.equal((await t.call(se, 'GET', '/uoms/convert?quantity=7&from=SQFT&to=SQM')).json.data.result, '0.65');
  assert.equal((await t.call(se, 'GET', '/uoms/convert?quantity=1&from=KG&to=M')).status, 422);
  assert.equal((await t.call(acc, 'POST', '/common/uom', { data: { code: 'TRIP', name: 'Trip', category: 'COUNT', baseUom: 'NOS', factorToBase: '1', decimals: 0 } })).status, 403);
  assert.equal((await t.call(proc, 'POST', '/common/uom', { data: { code: 'GUNTHA', name: 'Guntha', category: 'AREA', baseUom: 'SQFT', factorToBase: '1089', decimals: 2 } })).status, 400, 'the base must be the base unit of the category');
  assert.equal((await t.call(proc, 'POST', '/common/uom', { data: { code: 'GUNTHA', name: 'Guntha', category: 'AREA', baseUom: 'KG', factorToBase: '101.17', decimals: 2 } })).status, 400, 'a base of another category');
  const g = await t.call(proc, 'POST', '/common/uom', { data: { code: 'GUNTHA', name: 'Guntha', nameHi: 'गुंठा', category: 'AREA', baseUom: 'SQM', factorToBase: '101.17141056', decimals: 2 } });
  assert.equal(g.status, 201, JSON.stringify(g.json));
  assert.equal((await t.call(se, 'GET', '/uoms/convert?quantity=1&from=GUNTHA&to=SQFT')).json.data.result, '1089');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_uoms WHERE code = 'GUNTHA'").get(), 'the calculation engine knows the unit (D-042)');
  // a change of a system row stays the company's own
  const mt = await t.find(proc, 'uom', 'MT');
  const up = await t.call(proc, 'PUT', `/common/uom/${mt.id}`, { data: { nameHi: 'टन' }, version: mt.rowVersion });
  assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal(up.json.data.row.system, false);
  assert.equal(t.api.db.prepare("SELECT name_hi FROM mdm_uoms WHERE company_id IS NULL AND code = 'MT'").get().name_hi, 'मीट्रिक टन', 'the system row is not changed for other companies');
  assert.equal((await t.call(proc, 'GET', '/common/uom?q=MT')).json.data.rows.filter((r) => r.code === 'MT').length, 1, 'the company sees its own row instead of the system row');
  assert.equal((await t.call(proc, 'PUT', `/common/uom/${mt.id}`, { data: { nameHi: 'टन' }, version: mt.rowVersion })).status, 409, 'the system row is replaced for this company; a second change goes to its own row');
});

test('AC-01 the partner form uses the states master: a state is stored by its name and the GSTIN must carry its GST state code', async () => {
  const t = await setup();
  const p = await t.call(as('PROCMGR', 'proc1'), 'POST', '/masters/PARTNER/check', { data: { name: 'Narmada Cement Depot', kind: 'VENDOR', state: 'gj' } });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  const pan = 'NARMA1234D'; const f = `27${pan}1Z`; const gstin = f + gstinCheckChar(f);
  const bad = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: { name: 'Narmada Cement Depot', kind: 'VENDOR', pan, gstin, state: 'GJ' }, justification: 'Cement depot near the Alpha site' });
  assert.equal(bad.status, 400);
  assert.match(JSON.stringify(bad.json.error.details), /GST state code 24/);
  assert.equal((await t.call(proc, 'POST', '/masters/PARTNER/records', { data: { name: 'Narmada Cement Depot', kind: 'VENDOR', state: 'Atlantis' }, justification: 'Cement depot near the Alpha site' })).status, 400);
  const good = await t.call(proc, 'POST', '/masters/PARTNER/records', { data: { name: 'Narmada Cement Depot', kind: 'VENDOR', pan, gstin, state: '27' }, justification: 'Cement depot near the Alpha site' });
  assert.equal(good.status, 202, JSON.stringify(good.json));
  assert.equal(good.json.data.record.data.state, 'Maharashtra');
  const st = await t.api.call('GET', `${M}/lookups/states?q=Maha`, se);
  assert.equal(st.json.data[0].extra.gstCode, '27');
});
