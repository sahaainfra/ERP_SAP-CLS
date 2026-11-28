import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { gstinCheckChar } from '../src/server/platform/mdm/index.js';
import { partnersOf } from '../src/server/modules/mdm/partners.js';
import { setupCompany, startApi } from './helpers.js';

// Part 06.04: the business partner master. T-01 invalid GSTIN and PAN are refused, a duplicate PAN is blocked; T-02 a bank change puts payments on hold and bank numbers are masked for roles outside
// finance; T-03 an expired compliance document is reported and, when the company sets it, stops the partner from being chosen for a new PO. Also: activation by the steward and then the accounts manager
// (never the requester), bank change confirmed by the partner and approved by the accounts manager and the CFO, blacklisting approved by the director, holds, the register and isolation.
const M = '/api/v1/mdm';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'p') => ({ ...json, 'idempotency-key': `pt-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const proc = as('PROCMGR', 'proc1');
const proc2 = as('PROCMGR', 'proc2');
const com = as('COMMGR', 'com1');
const com2 = as('COMMGR', 'com2');
const acc = as('ACCMGR', 'acc1');
const acc2 = as('ACCMGR', 'acc2');
const cfo = as('CFO', 'cfo1');
const dir = as('DIR', 'dir1');
const bd = as('BD', 'bd1');
const se = as('SE', 'se1');
const day = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const gstin = (pan, state = '27') => { const f = `${state}${pan}1Z`; return f + gstinCheckChar(f); };
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const user = (api, name, roles) => api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(name, `${name.toUpperCase()} Shah`, JSON.stringify(roles), `${name}@example.com`);
const act = async (api, who, instanceId, action = 'approve', comment = 'checked the documents and the portal') => {
  const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
  const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key('a'), body: { action, comment } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const vendor = (over = {}) => ({ ...base(), ...over, ...(over.constitution && !['PRIVATE_LIMITED', 'PUBLIC_LIMITED'].includes(over.constitution) ? { cin: null } : {}) });
const base = () => ({
  legalName: 'Shree Ganesh Steel Traders Private Limited', tradeName: 'Ganesh Steel', constitution: 'PRIVATE_LIMITED', pan: 'AABCS1234C', msmeNo: 'UDYAM-MH-26-0012345', msmeCategory: 'SMALL', cin: 'U27100MH2010PTC123456',
  roles: ['VENDOR'], categories: ['STEEL'], regions: ['MH', 'GJ'], gstins: [{ stateCode: 'MH', gstin: gstin('AABCS1234C') }],
  addresses: [{ addressType: 'REGISTERED', address: 'Plot 12, MIDC Bhosari', city: 'Pune', stateCode: 'MH', pin: '411026' }],
  contacts: [{ name: 'Suresh Patil', designation: 'Accounts', email: 'accounts@ganeshsteel.example', mobile: '9876500011', isPrimary: true }],
  bank: { accountNo: '123456789012', ifsc: 'SBIN0001234', accountName: 'Shree Ganesh Steel Traders Pvt Ltd' }, tds: [{ section: '194Q' }],
});
const setup = async () => {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['proc1', ['PROCMGR']], ['proc2', ['PROCMGR']], ['com1', ['COMMGR']], ['com2', ['COMMGR']], ['acc1', ['ACCMGR']], ['acc2', ['ACCMGR']], ['cfo1', ['CFO']], ['dir1', ['DIR']], ['bd1', ['BD']], ['se1', ['SE']]]) user(api, n, r);
  const call = (who, method, path, body, k) => api.call(method, `${M}${path}`, { ...who, headers: key(k), body });
  const codes = [];
  partnersOf(api.db).banks.setDeliver(async (text) => { codes.push(/(\d{6})/.exec(text)[1]); return { delivered: true }; });
  /** A partner through its activation: the steward who did not register it, then the accounts manager. */
  const active = async (body = vendor(), who = proc, steward = proc2) => {
    const r = await call(who, 'POST', '/partners', { ...body, submit: true });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    await act(api, steward, r.json.data.workflow.id);
    await act(api, acc, r.json.data.workflow.id);
    return r.json.data;
  };
  return { api, call, codes, active };
};

test('T-01 FR-01 FR-07 invalid PAN and GSTIN are refused, a duplicate PAN or GSTIN is blocked, a similar name or the same mobile warns', async () => {
  const t = await setup();
  const bad = async (over, field) => { const r = await t.call(proc, 'POST', '/partners', vendor(over)); assert.equal(r.status, 400, `${field}: ${JSON.stringify(r.json)}`); assert.ok(r.json.error.details.some((d) => d.field.startsWith(field)), `${field}: ${JSON.stringify(r.json.error.details)}`); };
  await bad({ pan: 'ABC1234' }, 'pan');
  await bad({ pan: 'AABPS1234C', gstins: [{ stateCode: 'MH', gstin: gstin('AABPS1234C') }] }, 'pan'); // a person's PAN for a private limited company
  await bad({ gstins: [{ stateCode: 'MH', gstin: `${gstin('AABCS1234C').slice(0, 14)}${gstin('AABCS1234C')[14] === 'A' ? 'B' : 'A'}` }] }, 'gstins.0.gstin');
  await bad({ gstins: [{ stateCode: 'GJ', gstin: gstin('AABCS1234C', '27') }] }, 'gstins.0.gstin'); // a Maharashtra GSTIN for Gujarat
  await bad({ gstins: [{ stateCode: 'MH', gstin: gstin('AABCT9999C') }] }, 'gstins.0.gstin'); // another PAN inside the GSTIN
  await bad({ bank: { accountNo: '1234', ifsc: 'SBIN001234', accountName: 'X' } }, 'bank');
  await bad({ msmeNo: 'UDYAM-12345' }, 'msmeNo');
  const first = await t.call(proc, 'POST', '/partners', vendor());
  assert.equal(first.status, 201, JSON.stringify(first.json));
  assert.equal(first.json.data.status, 'PROSPECT');
  assert.equal(first.json.data.code, 'BP-00001');
  const dup = await t.call(proc, 'POST', '/partners', vendor({ legalName: 'Totally Different Traders', gstins: [], bank: null, contacts: [{ name: 'Someone', mobile: '9811122233' }] }));
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'DUPLICATE');
  assert.match(dup.json.error.message, /same PAN/);
  const warn = await t.call(proc, 'POST', '/partners', vendor({ legalName: 'Shree Ganesh Steel Trader Pvt Ltd', pan: 'AABCG7777D', gstins: [], bank: null }));
  assert.equal(warn.status, 409);
  assert.equal(warn.json.error.code, 'DUPLICATE_WARNING');
  assert.match(warn.json.error.message, /similar name|same mobile/);
  const chk = (await t.call(proc, 'POST', '/partners/check', { pan: 'AABCS1234C', legalName: 'X', roles: ['VENDOR'] })).json.data;
  assert.equal(chk.duplicates[0].code, 'BP-00001');
  // who registers what: procurement vendors, commercial subcontractors and clients, business development client prospects only
  const sub = await t.call(proc, 'POST', '/partners', vendor({ roles: ['SUBCONTRACTOR'], pan: 'AABCK5555K', gstins: [], bank: null, contacts: [{ name: 'Kishore', mobile: '9822200011' }] }));
  assert.equal(sub.status, 403, JSON.stringify(sub.json));
  const bdv = await t.call(bd, 'POST', '/partners', vendor({ roles: ['VENDOR'], pan: 'AABCK5555K', gstins: [], bank: null, contacts: [{ name: 'Kishore', mobile: '9822200011' }] }));
  assert.equal(bdv.status, 403, JSON.stringify(bdv.json));
  const client = await t.call(bd, 'POST', '/partners', { legalName: 'Maharashtra State Road Development Corporation', constitution: 'GOVERNMENT', roles: ['CLIENT'], addresses: [{ addressType: 'REGISTERED', address: 'Nepean Sea Road, Mumbai', stateCode: 'MH' }], contacts: [{ name: 'Executive Engineer', email: 'ee@msrdc.example' }] });
  assert.equal(client.status, 201, JSON.stringify(client.json));
  assert.equal(client.json.data.stewardRole, 'COMMGR');
  assert.equal((await t.call(se, 'POST', '/partners', vendor({ pan: 'AABCK5555K' }))).status, 403);
});

test('AC-01 activation: the steward who did not register it, then the accounts manager; the requester never approves; the bank is stored encrypted', async () => {
  const t = await setup();
  const r = await t.call(proc, 'POST', '/partners', { ...vendor(), submit: true });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const inst = r.json.data.workflow.id;
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, proc)).json.data.rows.filter((x) => x.instance.id === inst).length, 0, 'not the requester');
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, com)).json.data.rows.filter((x) => x.instance.id === inst).length, 0, 'a vendor goes to procurement');
  await act(t.api, proc2, inst);
  assert.equal((await t.call(proc, 'GET', `/partners/${r.json.data.id}`)).json.data.status, 'PENDING');
  await act(t.api, acc, inst);
  const p = (await t.call(acc, 'GET', `/partners/${r.json.data.id}`)).json.data;
  assert.equal(p.status, 'ACTIVE');
  assert.equal(p.banks[0].status, 'ACTIVE');
  assert.equal(p.pan, 'AABCS1234C', 'the accounts manager sees the PAN');
  const row = t.api.db.prepare('SELECT account_no_encrypted, account_last4 FROM mdm_partner_banks WHERE partner_id = ?').get(p.id);
  assert.doesNotMatch(row.account_no_encrypted, /123456789012/, 'BR-01 encrypted');
  assert.equal(row.account_last4, '9012');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'mdm.partner.decided' AND user_ref = 'proc1'").get().n, 1);
  // returned for correction, corrected, approved
  const c = await t.call(com, 'POST', '/partners', { ...vendor({ legalName: 'Kaveri Infra Subcontractors LLP', constitution: 'LLP', pan: 'AAKFK1234K', roles: ['SUBCONTRACTOR'], gstins: [{ stateCode: 'KA', gstin: gstin('AAKFK1234K', '29') }], addresses: [{ addressType: 'REGISTERED', address: 'Peenya Industrial Area', stateCode: 'KA', pin: '560058' }], contacts: [{ name: 'Kiran', mobile: '9845000011' }], bank: null, tds: [{ section: '194C' }] }), submit: true });
  assert.equal(c.status, 201, JSON.stringify(c.json));
  await act(t.api, com2, c.json.data.workflow.id, 'return', 'Add the labour licence');
  const cur = (await t.call(com, 'GET', `/partners/${c.json.data.id}`)).json.data;
  const fix = await t.call(com, 'PUT', `/partners/${c.json.data.id}`, { ...vendor({ legalName: 'Kaveri Infra Subcontractors LLP', constitution: 'LLP', pan: 'AAKFK1234K', roles: ['SUBCONTRACTOR'], gstins: [{ stateCode: 'KA', gstin: gstin('AAKFK1234K', '29') }], addresses: [{ addressType: 'REGISTERED', address: 'Peenya Industrial Area, Bengaluru', stateCode: 'KA', pin: '560058' }], contacts: [{ name: 'Kiran', mobile: '9845000011' }], bank: null, tds: [{ section: '194C' }] }), version: cur.rowVersion, comment: 'Address completed' });
  assert.equal(fix.status, 200, JSON.stringify(fix.json));
  await act(t.api, com2, c.json.data.workflow.id);
  await act(t.api, acc, c.json.data.workflow.id);
  assert.equal((await t.call(com, 'GET', `/partners/${c.json.data.id}`)).json.data.status, 'ACTIVE');
});

test('T-02 FR-02 BR-01 BR-03 a bank change holds payments, is confirmed by the partner, approved by the accounts manager and the CFO, and the number is masked outside finance', async () => {
  const t = await setup();
  const p = await t.active();
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}/payment-status`)).json.data.held, false);
  // masked for everyone, full only for finance, and each view logged
  const seen = (await t.call(se, 'GET', `/partners/${p.id}`)).json.data;
  assert.equal(seen.banks[0].account, '••••••9012');
  assert.equal(seen.pan, '••••••234C');
  assert.equal((await t.call(se, 'GET', `/partners/${p.id}/banks/${seen.banks[0].id}/reveal`)).status, 403);
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}/banks/${seen.banks[0].id}/reveal`)).status, 403);
  const full = await t.call(acc, 'GET', `/partners/${p.id}/banks/${seen.banks[0].id}/reveal`);
  assert.equal(full.json.data.accountNo, '123456789012');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'mdm_partner_banks' AND action = 'view_bank'").get().n, 1);
  // the change: payments held at once
  const ch = await t.call(proc, 'POST', `/partners/${p.id}/banks`, { accountNo: '9988776655', ifsc: 'HDFC0000240', accountName: 'Shree Ganesh Steel Traders Pvt Ltd', reason: 'The partner moved its account to HDFC' });
  assert.equal(ch.status, 202, JSON.stringify(ch.json));
  assert.equal(ch.json.data.confirmation.sent, true);
  assert.equal(ch.json.data.payment.held, true);
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}/selectable?purpose=PAYMENT`)).json.data.selectable, false);
  assert.equal((await t.call(proc, 'POST', `/partners/${p.id}/banks`, { accountNo: '1111222233', ifsc: 'HDFC0000240', accountName: 'Xavier Traders', reason: 'A second change at once' })).status, 409);
  // confirmation: a wrong code, then the code the partner received
  assert.equal((await t.call(proc, 'POST', `/partners/${p.id}/banks/${ch.json.data.bankId}/confirm`, { code: '000000' === t.codes[0] ? '111111' : '000000' })).status, 422);
  const ok = await t.call(proc, 'POST', `/partners/${p.id}/banks/${ch.json.data.bankId}/confirm`, { code: t.codes[0] });
  assert.equal(ok.status, 202, JSON.stringify(ok.json));
  assert.equal(ok.json.data.bank.verifyMethod, 'OTP');
  await act(t.api, acc, ok.json.data.workflow.id);
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, acc2)).json.data.rows.filter((x) => x.instance.id === ok.json.data.workflow.id).length, 0, 'the second step is the CFO');
  await act(t.api, cfo, ok.json.data.workflow.id);
  const after = (await t.call(acc, 'GET', `/partners/${p.id}`)).json.data;
  assert.deepEqual(after.banks.map((b) => [b.last4, b.status]), [['6655', 'ACTIVE'], ['9012', 'REPLACED']]);
  const hold = (await t.call(proc, 'GET', `/partners/${p.id}/payment-status`)).json.data;
  assert.equal(hold.held, true, 'still held during the cooling-off period');
  assert.ok(hold.until > new Date().toISOString());
  // a call-back to a number given with the change is refused
  const ch2 = await t.call(acc, 'POST', `/partners/${p.id}/banks`, { accountNo: '5555666677', ifsc: 'ICIC0000104', accountName: 'Shree Ganesh Steel', reason: 'Second account for the Gujarat branch' });
  assert.equal(ch2.status, 202);
  assert.equal((await t.call(acc, 'POST', `/partners/${p.id}/banks/${ch2.json.data.bankId}/confirm`, { callback: { spokeTo: 'Someone', number: '9000000000', note: 'Called them' } })).status, 422);
  const cb = await t.call(acc, 'POST', `/partners/${p.id}/banks/${ch2.json.data.bankId}/confirm`, { callback: { spokeTo: 'Suresh Patil', number: '9876500011', note: 'Confirmed the HDFC to ICICI change on a recorded call' } });
  assert.equal(cb.status, 202, JSON.stringify(cb.json));
  assert.equal((await t.api.call('GET', `${W}/tasks?mine=assigned`, acc)).json.data.rows.filter((x) => x.instance.id === cb.json.data.workflow.id).length, 0, 'SoD-02: the requester does not approve it');
  await act(t.api, acc2, cb.json.data.workflow.id, 'reject', 'Not on the partner letterhead');
  assert.equal((await t.call(acc, 'GET', `/partners/${p.id}`)).json.data.banks.find((b) => b.last4 === '6677').status, 'REJECTED');
  // a bank account of another partner is refused
  const other = await t.active(vendor({ legalName: 'Patel Cement Depot', pan: 'AAFCP4321P', gstins: [{ stateCode: 'GJ', gstin: gstin('AAFCP4321P', '24') }], addresses: [{ addressType: 'REGISTERED', address: 'GIDC Vatva, Ahmedabad', stateCode: 'GJ' }], contacts: [{ name: 'Patel', mobile: '9898000011' }], bank: null, msmeNo: null, msmeCategory: null, cin: null }));
  const same = await t.call(proc, 'POST', `/partners/${other.id}/banks`, { accountNo: '9988776655', ifsc: 'HDFC0000240', accountName: 'Patel', reason: 'Same account as another partner' });
  assert.equal(same.status, 409, JSON.stringify(same.json));
});

test('T-03 FR-04 an expired compliance document is reported, and stops a new PO when the company sets it', async () => {
  const t = await setup();
  const p = await t.active();
  const d = await t.call(proc, 'POST', `/partners/${p.id}/documents`, { docType: 'INSURANCE', docNo: 'POL-778899', validFrom: day(-400), validUntil: day(-1) });
  assert.equal(d.status, 201, JSON.stringify(d.json));
  await t.call(proc, 'POST', `/partners/${p.id}/documents`, { docType: 'GST_CERTIFICATE', docNo: 'REG-06', validFrom: day(-900) });
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}/selectable?purpose=PO`)).json.data.selectable, true, 'not configured: expiry only warns');
  t.api.db.prepare("INSERT INTO core_parameters (key, value, data_type, scope_type, scope_id, effective_from, company_id) VALUES ('mdm.partner.blocking_documents', '[\"INSURANCE\",\"CLRA_LICENCE\"]', 'json', 'company', 1, '2020-01-01', 1)").run();
  const sel = (await t.call(proc, 'GET', `/partners/${p.id}/selectable?purpose=PO`)).json.data;
  assert.equal(sel.selectable, false);
  assert.match(sel.reasons[0], /insurance expired/);
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}/selectable?purpose=OTHER`)).json.data.selectable, true, 'only new POs, work orders and RFQs');
  const out = partnersOf(t.api.db).compliance(1);
  assert.equal(out.expired, 1);
  const notes = t.api.db.prepare("SELECT user_ref FROM ntf_notifications WHERE template_code = 'mdm.partner.document_expiry' ORDER BY user_ref").all().map((r) => r.user_ref);
  assert.ok(notes.includes('proc1') && notes.includes('acc1'), notes.join(','));
  assert.equal(partnersOf(t.api.db).compliance(1).expired, 0, 'told once');
  const q = (await t.call(acc, 'GET', '/partners/queue?kind=DOCUMENT')).json.data.rows;
  assert.equal(q[0].expired, true);
  // a new valid insurance lifts the block
  await t.call(proc, 'POST', `/partners/${p.id}/documents`, { docType: 'INSURANCE', docNo: 'POL-990011', validFrom: day(0), validUntil: day(365) });
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}/selectable?purpose=PO`)).json.data.selectable, true);
  // verification by an accounts manager other than the person who added it
  assert.equal((await t.call(acc, 'POST', `/partners/${p.id}/documents/${d.json.data[0].id}/verify`, {})).status, 200);
});

test('FR-06 BR-02 blacklisting approved by the director; a held or blacklisted partner cannot be chosen; the lookups offer active partners only', async () => {
  const t = await setup();
  const p = await t.active();
  assert.equal((await t.api.call('GET', `${M}/lookups/vendors?q=Ganesh`, se)).json.data.length, 1);
  const h = await t.call(acc, 'POST', `/partners/${p.id}/status`, { action: 'HOLD', reason: 'Disputed invoices under review', version: (await t.call(acc, 'GET', `/partners/${p.id}`)).json.data.rowVersion });
  assert.equal(h.status, 200, JSON.stringify(h.json));
  assert.equal(h.json.data.status, 'ON_HOLD');
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}/selectable`)).json.data.selectable, false);
  assert.equal((await t.api.call('GET', `${M}/lookups/vendors?q=Ganesh`, se)).json.data.length, 0);
  await t.call(acc, 'POST', `/partners/${p.id}/status`, { action: 'RELEASE', reason: 'Invoices settled', version: h.json.data.rowVersion });
  assert.equal((await t.call(se, 'POST', `/partners/${p.id}/blacklist`, { reason: 'Supplied substandard steel twice' })).status, 403);
  const b = await t.call(proc, 'POST', `/partners/${p.id}/blacklist`, { reason: 'Supplied substandard steel twice, test reports attached', until: day(180) });
  assert.equal(b.status, 202, JSON.stringify(b.json));
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}`)).json.data.status, 'ACTIVE', 'nothing before the director approves');
  await act(t.api, dir, b.json.data.workflow.id);
  const bl = (await t.call(proc, 'GET', `/partners/${p.id}`)).json.data;
  assert.equal(bl.status, 'BLACKLISTED');
  assert.equal(bl.blacklistUntil, day(180));
  const s = (await t.call(proc, 'GET', `/partners/${p.id}/selectable?purpose=RFQ`)).json.data;
  assert.equal(s.selectable, false);
  assert.match(s.reasons[0], /blacklisted/);
  const lift = await t.call(proc, 'POST', `/partners/${p.id}/blacklist`, { action: 'LIFT_BLACKLIST', reason: 'Corrective action accepted by quality' });
  await act(t.api, dir, lift.json.data.workflow.id);
  assert.equal((await t.call(proc, 'GET', `/partners/${p.id}`)).json.data.status, 'ACTIVE');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'mdm.partner.status_changed'").get().n >= 4, true);
});

test('the register (List Report) with the PAN hidden outside finance, Partner 360, the worklist, idempotent replay and another company', async () => {
  const t = await setup();
  const p = await t.active();
  await t.call(com, 'POST', '/partners', { ...vendor({ legalName: 'Kaveri Infra Subcontractors LLP', constitution: 'LLP', pan: 'AAKFK1234K', roles: ['SUBCONTRACTOR'], gstins: [], addresses: [{ addressType: 'REGISTERED', address: 'Peenya, Bengaluru', stateCode: 'KA' }], contacts: [{ name: 'Kiran', mobile: '9845000011' }], bank: null }), submit: true });
  const reg = await t.api.call('GET', `${M}/partners/register?filter[status]=ACTIVE&sort=code`, se);
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  assert.equal(reg.json.data.length, 1);
  assert.equal(reg.json.data[0].pan, undefined);
  assert.match(reg.json.data[0].roles, /VENDOR/);
  assert.equal((await t.api.call('GET', `${M}/partners/register?filter[roles][contains]=SUBCONTRACTOR`, se)).json.data[0].status, 'PENDING');
  assert.equal((await t.api.call('GET', '/api/v1/ui/lists/mdm.partners', se)).json.data.columns.find((c) => c.key === 'pan').masked, true);
  const csv = (await t.api.raw('GET', `${M}/partners/register/export?format=csv`, acc)).buffer.toString('utf8');
  assert.match(csv, /AABCS1234C/);
  assert.doesNotMatch((await t.api.raw('GET', `${M}/partners/register/export?format=csv`, se)).buffer.toString('utf8'), /AABCS1234C/);
  const sum = (await t.call(se, 'GET', `/partners/${p.id}/summary`)).json.data;
  assert.equal(sum.selectable.selectable, true);
  assert.ok(sum.tiles.length >= 5);
  const q = (await t.call(com2, 'GET', '/partners/queue')).json.data;
  assert.equal(q.counts.REGISTRATION, 1);
  assert.equal(q.rows[0].mine, true, 'what waits for me comes first');
  assert.equal((await t.call(se, 'GET', '/partners/queue')).status, 403);
  // idempotent replay of a registration
  const k = { ...json, 'idempotency-key': 'pt-replay-1' };
  const body = vendor({ legalName: 'Narmada Transport Company', constitution: 'PARTNERSHIP', pan: 'AAAFN1111N', roles: ['TRANSPORTER'], gstins: [], bank: null, contacts: [{ name: 'Narmada', mobile: '9822211100' }] });
  const r1 = await t.api.call('POST', `${M}/partners`, { ...proc, headers: k, body });
  const r2 = await t.api.call('POST', `${M}/partners`, { ...proc, headers: k, body });
  assert.equal(r1.status, 201);
  assert.equal(r2.json.data.id, r1.json.data.id);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM mdm_partners WHERE pan = 'AAAFN1111N'").get().n, 1);
  // a stale version is refused
  assert.equal((await t.call(proc, 'PUT', `/partners/${p.id}/details`, { tradeName: 'Ganesh', version: 1 })).status, 409);
  // another company sees nothing
  assert.equal((await t.api.call('GET', `${M}/partners/${p.id}`, as('PROCMGR', 'p9', '2'))).status, 404);
});

test('PACK-24 verification hooks: with a GSTIN provider registered (and the flag) a GSTIN the network does not know or names differently is refused, a verified one is stored as verified by the API; no provider, no call', async () => {
  const { partnerVerifiers } = await import('../src/server/modules/mdm/partners.js');
  const t = await setup(); const d = t.api.db; const calls = [];
  partnerVerifiers.register('GSTIN', ({ gstin: g }) => { calls.push(g); return g.startsWith('27AABCV') ? { status: 'NOT_FOUND' } : { status: 'VERIFIED', source: 'TEST' }; });
  try {
    const flagOff = await t.call(proc, 'POST', '/partners', vendor({ legalName: 'Hook Off Pvt Ltd', pan: 'AABCV1234C', gstins: [{ stateCode: 'MH', gstin: gstin('AABCV1234C') }], cin: null, bank: null, contacts: [{ name: 'Hook 1', mobile: '9876500001' }] }));
    assert.equal(calls.length, 0, 'flag off: the provider is not asked'); assert.notEqual(flagOff.status, 500);
    d.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.mdm.pack24', 1, 'test', 0, 1)").run();
    const refused = await t.call(proc, 'POST', '/partners', vendor({ legalName: 'Hook Unknown Pvt Ltd', pan: 'AABCV5678C', gstins: [{ stateCode: 'MH', gstin: gstin('AABCV5678C') }], cin: null, bank: null, contacts: [{ name: 'Hook 2', mobile: '9876500002' }] }));
    assert.equal(refused.status, 400, JSON.stringify(refused.json)); assert.match(JSON.stringify(refused.json.error.details), /does not know this GSTIN/);
    const ok = await t.call(proc, 'POST', '/partners', vendor({ legalName: 'Hook Known Pvt Ltd', pan: 'AABCK1234C', gstins: [{ stateCode: 'MH', gstin: gstin('AABCK1234C') }], cin: null, bank: null, contacts: [{ name: 'Hook 3', mobile: '9876500003' }] }));
    assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.equal(d.prepare('SELECT verify_source FROM mdm_partner_gstins WHERE partner_id = ?').get(ok.json.data.id).verify_source, 'API');
    assert.ok(calls.length >= 2, 'the provider is asked with the flag on');
  } finally { partnerVerifiers.remove('GSTIN'); }
  const none = await t.call(proc, 'POST', '/partners', vendor({ legalName: 'Hook None Pvt Ltd', pan: 'AABCN1234C', gstins: [{ stateCode: 'MH', gstin: gstin('AABCN1234C') }], cin: null, bank: null, contacts: [{ name: 'Hook 4', mobile: '9876500004' }] })); assert.equal(none.status, 201, JSON.stringify(none.json));
  assert.equal(d.prepare('SELECT verify_source FROM mdm_partner_gstins WHERE partner_id = ?').get(none.json.data.id).verify_source, 'FORMAT', 'no provider: the format check only, and nothing leaves the application');
});
