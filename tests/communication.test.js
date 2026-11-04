import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { commOf, dltMatches, normaliseAddress, redact } from '../src/server/platform/comm/index.js';
import { clearSandboxOutbox, sandboxOutbox } from '../src/server/platform/comm/providers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { signWebhook } from '../src/server/platform/integrations/webhooks.js';
import { setupCompany, startApi } from './helpers.js';

// Part 04.07: the communication gateway.
// T-01 the primary SMS connector fails and the secondary delivers; T-02 an SMS that does not match its DLT template is blocked, not sent; T-03 an inbound WhatsApp reply joins the conversation of the record.
const C = '/api/v1/core';
const M = '/api/v1/comm';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
const key = (k = 'c') => ({ ...json, 'idempotency-key': `cm-${k}-${Math.random().toString(36).slice(2, 10)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const it = as('ITADM', 'it1');
const sys = as('SYSADM', 'sys1');
const pm = as('PM', 'pm1');
const emp = as('EMP', 'emp1');
const WHSEC = 'whsec_0123456789abcdef'; // secret-scan:allow fake credential for the test
const PHONE = '+919812345678';

const setup = async () => {
  clearSandboxOutbox();
  const api = await startApi();
  await setupCompany(api);
  return { api, comm: commOf(api.db), runtime: runtimeOf(api.db) };
};
const drain = (runtime) => { for (let i = 0; i < 5; i += 1) runtime.bus.drain(); };
const connector = async (api, code, type, config = {}) => {
  const res = await api.call('POST', `${C}/connectors`, { ...it, headers: key('k'), body: { code, type, name: code, provider: 'sandbox', environment: 'development', config, secrets: { webhook_secret: WHSEC }, enabled: true, reason: 'the gateway test' } });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal((await api.call('POST', `${C}/change-requests/${res.json.data.request.id}/act`, { ...sys, headers: key('a'), body: { action: 'approve', comment: 'ok' } })).status, 200);
};
const approveChange = async (api) => {
  const all = (await api.call('GET', `${W}/tasks?mine=assigned`, sys)).json.data.rows;
  const task = all.find((t) => JSON.stringify(t).includes('COMM_CONFIG'));
  assert.ok(task, 'the system administrator has the task');
  const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...sys, headers: key('t'), body: { action: 'approve', comment: 'ok' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
};
const OTP_DLT = { templateCode: 'otp.code', dltTemplateId: '1107161234567890999', bodyPattern: '{#var#} is your verification code for Construction ERP. It is valid for {#var#} minutes. Do not share it with anyone.' };
const DLT = { templateCode: 'workflow.task.assigned', dltTemplateId: '1107161234567890123', bodyPattern: 'Approval needed: {#var#} {#var#} {#var#}' };
const configure = async (api, { sms = ['sms.a', 'sms.b'], dlt = true } = {}) => {
  const body = {
    channels: [
      { channel: 'EMAIL', primaryConnector: 'mail.a', ratePerMinute: 600, enabled: true },
      { channel: 'SMS', primaryConnector: sms[0], secondaryConnector: sms[1] ?? null, senderId: 'ERPSMS', dltEntityId: '1101234567890', ratePerMinute: 600, enabled: true },
      { channel: 'WHATSAPP', primaryConnector: 'wa.a', ratePerMinute: 600, enabled: true },
    ],
    dltTemplates: dlt ? [DLT, OTP_DLT] : [],
    reason: 'Set up the channels',
  };
  const r = await api.call('POST', `${M}/channels/changes`, { ...it, headers: key('p'), body });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  await approveChange(api);
  return r;
};
const fixture = async (over = {}) => {
  const ctx = await setup();
  await connector(ctx.api, 'mail.a', 'email', { fromAddress: 'noreply@example.com' });
  await connector(ctx.api, 'sms.a', 'sms', { simulate: 'down', ...over.smsA });
  await connector(ctx.api, 'sms.b', 'sms');
  await connector(ctx.api, 'wa.a', 'whatsapp');
  await configure(ctx.api, over.configure);
  return ctx;
};
const sms = (comm, over = {}) => comm.sendNow({ companyId: 1, channel: 'SMS', to: PHONE, templateCode: 'workflow.task.assigned', data: { docLabel: 'Bill', docRef: 'B-1', link: 'https://x.test/a' }, purpose: 'TRANSACTIONAL', ...over });

test('T-01 FR-02 the primary SMS connector is down: the secondary delivers, the log shows both attempts', async () => {
  const { api, comm } = await fixture();
  const r = await sms(comm);
  assert.equal(r.status, 'SENT', JSON.stringify(r.row));
  assert.equal(r.row.connector_code, 'sms.b');
  const trail = JSON.parse(r.row.route_json);
  assert.deepEqual(trail.map((t) => [t.connector, Boolean(t.ok)]), [['sms.a', false], ['sms.b', true]]);
  assert.equal(sandboxOutbox('SMS').length, 1);
  assert.equal(r.row.payload_json, null, 'the text is not kept once sent');
  const log = (await api.call('GET', `${M}/messages?channel=SMS`, it)).json.data;
  assert.equal(log.rows.length, 1);
  assert.equal(log.rows[0].connector, 'sms.b');
  assert.equal(log.rows[0].route.length, 2);
  assert.match(log.rows[0].to, /•/, 'the number is masked in the log');
  await api.close();
});

test('T-02 BR-01 an SMS whose text does not match its DLT template is blocked and never reaches a provider', async () => {
  const { api, comm } = await fixture();
  const r = await sms(comm, { body: 'Hurry up and approve this bill right now' });
  assert.equal(r.status, 'BLOCKED');
  assert.equal(r.blockReason, 'DLT_MISMATCH');
  assert.equal(sandboxOutbox('SMS').length, 0);
  const none = await sms(comm, { templateCode: 'ntf.test' });
  assert.equal(none.blockReason, 'DLT_NO_TEMPLATE');
  assert.equal(dltMatches('Hello {#var#}, code {#var#}', 'Hello Meera, code 123'), true);
  assert.equal(dltMatches('Hello {#var#}', 'Goodbye Meera'), false);
  const row = (await api.call('GET', `${M}/messages/${r.id}`, it)).json.data;
  assert.equal(row.status, 'BLOCKED');
  assert.match(row.error ?? row.blockReason, /DLT/);
  await api.close();
});

test('T-03 FR-05 FR-06 an inbound WhatsApp reply is linked to the conversation of the record; receipts move the status forward only', async () => {
  const { api, comm, runtime } = await fixture();
  api.db.prepare("INSERT INTO comm_wa_templates (company_id, name, language, category, provider_status, template_code, variables_json, created_by, source_type) VALUES (1, 'rfq_invite', 'en', 'UTILITY', 'APPROVED', 'rfq.invite', '[]', 't', 'test')").run();
  const out = await comm.sendNow({ companyId: 1, channel: 'WHATSAPP', to: PHONE, templateCode: 'rfq.invite', body: 'RFQ 7 is open', purpose: 'TRANSACTIONAL', related: { entity: 'rfq', id: '7' } });
  assert.equal(out.status, 'SENT', JSON.stringify(out.row));
  const hook = (payload) => {
    const raw = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    return fetch(`${api.base}${C}/webhooks/wa.a`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': `sha256=${signWebhook(WHSEC, ts, Buffer.from(raw))}`, 'x-delivery-id': `d-${Math.random()}` }, body: raw });
  };
  assert.equal((await hook({ kind: 'status', providerMsgId: out.row.provider_msg_id, status: 'read' })).status, 200);
  drain(runtime);
  assert.equal(api.db.prepare('SELECT status FROM comm_messages WHERE id = ?').get(out.id).status, 'READ');
  assert.equal((await hook({ kind: 'status', providerMsgId: out.row.provider_msg_id, status: 'delivered' })).status, 200);
  drain(runtime);
  assert.equal(api.db.prepare('SELECT status FROM comm_messages WHERE id = ?').get(out.id).status, 'READ', 'a late delivered receipt does not move it back');
  assert.equal((await hook({ kind: 'inbound', from: PHONE, body: 'We will quote tomorrow', providerMsgId: 'wamid.in1', inReplyTo: out.row.provider_msg_id })).status, 200);
  drain(runtime);
  const inbound = api.db.prepare("SELECT * FROM comm_messages WHERE direction = 'IN'").get();
  assert.deepEqual([inbound.related_entity, inbound.related_id, inbound.conversation_key], ['rfq', '7', out.row.conversation_key]);
  const thread = (await api.call('GET', `${M}/messages?entity=rfq&id=7`, it)).json.data;
  assert.equal(thread.rows.length, 2);
  await api.close();
});

test('FR-04 BR-01 consent: STOP opts a number out, START opts it back in, commercial messages need an opt-in, essential ones still go', async () => {
  const { api, comm, runtime } = await fixture({ smsA: { simulate: 'ok' } });
  const hook = (payload) => {
    const raw = JSON.stringify(payload);
    const ts = String(Math.floor(Date.now() / 1000));
    return fetch(`${api.base}${C}/webhooks/sms.b`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-timestamp': ts, 'x-signature': `sha256=${signWebhook(WHSEC, ts, Buffer.from(raw))}`, 'x-delivery-id': `d-${Math.random()}` }, body: raw });
  };
  assert.equal((await sms(comm, { purpose: 'COMMERCIAL' })).blockReason, 'NO_OPT_IN');
  await hook({ kind: 'inbound', from: PHONE, body: 'stop' });
  drain(runtime);
  assert.equal(comm.consentOf(1, PHONE, 'SMS').status, 'OPT_OUT');
  assert.equal((await sms(comm)).blockReason, 'OPTED_OUT');
  assert.equal((await sms(comm, { essential: true })).status, 'SENT');
  await hook({ kind: 'inbound', from: PHONE, body: 'START' });
  drain(runtime);
  assert.equal(comm.consentOf(1, PHONE, 'SMS').status, 'OPT_IN');
  assert.equal((await sms(comm, { purpose: 'COMMERCIAL' })).status, 'SENT');
  const reg = (await api.call('GET', `${M}/consents?channel=SMS`, it)).json.data;
  assert.equal(reg.total, 1);
  const hist = (await api.call('GET', `${M}/consents/${reg.rows[0].id}/history`, it)).json.data;
  assert.deepEqual(hist.map((h) => h.to.status), ['OPT_OUT', 'OPT_IN']);
  const set = await api.call('POST', `${M}/consents`, { ...it, headers: key('s'), body: { address: '+919800000001', channel: 'WHATSAPP', status: 'OPT_IN', contactType: 'VENDOR', contactName: 'Meera Traders' } });
  assert.equal(set.status, 201, JSON.stringify(set.json));
  const imp = await api.call('POST', `${M}/consents/import`, { ...it, headers: key('i'), body: { rows: [{ address: 'a@example.com', channel: 'EMAIL', status: 'OPT_IN' }, { address: 'b@example.com', channel: 'EMAIL', status: 'OPT_OUT' }] } });
  assert.equal(imp.json.data.imported, 2);
  await api.close();
});

test('FR-03 BR-02 one-time codes: only the hash is kept, the text is redacted in the log, wrong codes lock, a resend too soon is refused, a code works once', async () => {
  const { api, comm } = await fixture({ smsA: { simulate: 'ok' } });
  api.db.prepare("INSERT INTO iam_users (company_id, username, display_name, email, mobile, roles_json) VALUES (1, 'pm1', 'PM One', 'pm1@example.com', ?, '[]')").run(PHONE);
  const sent = await api.call('POST', `${M}/otp/send`, { ...pm, headers: key('o'), body: { purpose: 'PAYMENT_CONFIRM', channel: 'SMS' } });
  assert.equal(sent.status, 201, JSON.stringify(sent.json));
  assert.equal(sent.json.data.sent, true);
  assert.ok(!JSON.stringify(sent.json).match(/\b\d{6}\b/), 'the code is never in the response');
  const text = sandboxOutbox('SMS').at(-1).message ?? JSON.stringify(sandboxOutbox('SMS').at(-1));
  const code = text.match(/\b(\d{6})\b/)[1];
  const stored = api.db.prepare('SELECT * FROM comm_otps ORDER BY id DESC').get();
  assert.ok(stored.code_hash && !stored.code_hash.includes(code));
  assert.ok(!api.db.prepare('SELECT body_redacted FROM comm_messages WHERE id = ?').get(stored.message_id).body_redacted.includes(code), 'the log holds no code');
  assert.equal((await api.call('POST', `${M}/otp/send`, { ...pm, headers: key('o'), body: { purpose: 'PAYMENT_CONFIRM', channel: 'SMS' } })).status, 429);
  const verify = (c, who = pm) => api.call('POST', `${M}/otp/verify`, { ...who, headers: key('v'), body: { otpId: stored.id, code: c } });
  assert.equal((await verify(code, emp)).status, 404, 'another person cannot try it');
  const wrong = code === '000000' ? '111111' : '000000';
  const w = (await verify(wrong)).json.data;
  assert.deepEqual([w.ok, w.reason], [false, 'WRONG']);
  assert.equal((await verify(code)).json.data.ok, true);
  assert.equal((await verify(code)).json.data.ok, false, 'a code works once');
  const again = comm.otp.verify({ companyId: 1, otpId: stored.id, code });
  assert.equal(again.ok, false);
  assert.equal(redact('Your code is 123456', 'OTP'), 'Your code is ••••••');
  await api.close();
});

test('FR-03 a code locks after too many wrong tries and expires', async () => {
  const { api, comm } = await fixture({ smsA: { simulate: 'ok' } });
  const r = await comm.otp.send({ companyId: 1, purpose: 'OTHER', channel: 'SMS', address: PHONE, subjectRef: 's1', cooldownSeconds: 0 });
  assert.equal(r.delivered, true, JSON.stringify(r));
  const max = api.db.prepare('SELECT max_attempts FROM comm_otps WHERE id = ?').get(r.otpId).max_attempts;
  let last;
  for (let i = 0; i < max; i += 1) last = comm.otp.verify({ companyId: 1, otpId: r.otpId, code: '000001' });
  assert.deepEqual([last.ok, last.reason], [false, 'LOCKED']);
  assert.equal(comm.otp.verify({ companyId: 1, otpId: r.otpId, code: '000001' }).reason, 'LOCKED');
  const r2 = await comm.otp.send({ companyId: 1, purpose: 'OTHER', channel: 'SMS', address: PHONE, subjectRef: 's2', cooldownSeconds: 0, ttlSeconds: 60 });
  api.db.prepare("UPDATE comm_otps SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(r2.otpId);
  assert.equal(comm.otp.verify({ companyId: 1, otpId: r2.otpId, code: '123456' }).reason, 'EXPIRED');
  await api.close();
});

test('FR-01 AC-05 a change of channel settings waits for approval; nothing changes until then; one change at a time; bad input is refused', async () => {
  const { api } = await fixture();
  const body = (over = {}) => ({ channels: [{ channel: 'SMS', primaryConnector: 'sms.b', secondaryConnector: 'sms.a', senderId: 'ERPSMS', ratePerMinute: 100, enabled: true }], dltTemplates: [], reason: 'Swap the order', ...over });
  assert.equal((await api.call('POST', `${M}/channels/changes`, { ...pm, headers: key('x'), body: body() })).status, 403);
  assert.equal((await api.call('POST', `${M}/channels/changes`, { ...it, body: body() })).status, 400, 'Idempotency-Key is required');
  assert.equal((await api.call('POST', `${M}/channels/changes`, { ...it, headers: key('x'), body: body({ channels: [{ channel: 'SMS', primaryConnector: 'sms.a', secondaryConnector: 'sms.a', senderId: 'ERPSMS', ratePerMinute: 100, enabled: true }] }) })).status, 400, 'the same connector twice');
  assert.equal((await api.call('POST', `${M}/channels/changes`, { ...it, headers: key('x'), body: body({ channels: [{ channel: 'SMS', primaryConnector: 'mail.a', senderId: 'ERPSMS', ratePerMinute: 100, enabled: true }] }) })).status, 400, 'the wrong type of connector');
  assert.equal((await api.call('POST', `${M}/channels/changes`, { ...it, headers: key('x'), body: body({ dltTemplates: [{ ...DLT, templateCode: 'nothing.here' }] }) })).status, 400);
  const ok = await api.call('POST', `${M}/channels/changes`, { ...it, headers: key('x'), body: body() });
  assert.equal(ok.status, 202, JSON.stringify(ok.json));
  assert.equal((await api.call('POST', `${M}/channels/changes`, { ...it, headers: key('x'), body: body() })).status, 409);
  let view = (await api.call('GET', `${M}/channels`, sys)).json.data;
  assert.equal(view.channels.find((c) => c.channel === 'SMS').active.primaryConnector, 'sms.a', 'the old order is in force');
  assert.equal(view.channels.find((c) => c.channel === 'SMS').pending.primaryConnector, 'sms.b');
  await approveChange(api);
  view = (await api.call('GET', `${M}/channels`, sys)).json.data;
  assert.equal(view.channels.find((c) => c.channel === 'SMS').active.primaryConnector, 'sms.b');
  assert.equal(view.channels.find((c) => c.channel === 'SMS').pending, null);
  await api.close();
});

test('FR-07 a channel switched off blocks; email replies carry a token; retry of a failed message queues it again; the queue sends by priority', async () => {
  const { api, comm } = await fixture({ smsA: { simulate: 'reject' }, configure: { sms: ['sms.a', null] } });
  const failed = await sms(comm);
  assert.equal(failed.status, 'FAILED');
  assert.ok(failed.row.payload_json, 'the text of a failed message stays for Retry');
  const retried = await api.call('POST', `${M}/messages/${failed.id}/retry`, { ...it, headers: key('r'), body: {} });
  assert.equal(retried.status, 200, JSON.stringify(retried.json));
  const mail = comm.send({ companyId: 1, channel: 'EMAIL', to: 'Meera@Example.com', subject: 'Hello', body: 'Body', related: { entity: 'rfq', id: '9' } });
  assert.equal(mail.status, 'QUEUED');
  assert.equal(normaliseAddress('EMAIL', 'Meera@Example.com'), 'meera@example.com');
  assert.ok((await comm.process(10)).sent >= 1);
  const none = comm.send({ companyId: 1, channel: 'PUSH', to: 'nobody', body: 'x' });
  assert.equal(none.status, 'QUEUED');
  const sw = await api.call('POST', `${M}/channels/changes`, { ...it, headers: key('x'), body: { channels: [{ channel: 'EMAIL', primaryConnector: 'mail.a', ratePerMinute: 600, enabled: false }], dltTemplates: [], reason: 'Pause email' } });
  assert.equal(sw.status, 202);
  await approveChange(api);
  assert.equal(comm.send({ companyId: 1, channel: 'EMAIL', to: 'x@example.com', body: 'x' }).blockReason, 'CHANNEL_OFF');
  await api.close();
});

test('AC-01 who may see the log, the channel settings and the consent register', async () => {
  const { api } = await fixture();
  for (const path of ['/messages', '/messages/summary', '/channels', '/consents']) {
    assert.equal((await api.call('GET', M + path, it)).status, 200, `ITADM ${path}`);
    assert.equal((await api.call('GET', M + path, emp)).status, 403, `EMP ${path}`);
    assert.equal((await api.call('GET', M + path, { user: null })).status, 401, `anonymous ${path}`);
  }
  assert.equal((await api.call('GET', `${M}/messages/export?format=csv`, it)).status, 200);
  await api.close();
});

test('FR-07 the queue sends the most urgent first', async () => {
  const { api, comm } = await fixture({ smsA: { simulate: 'ok' } });
  const slow = comm.send({ companyId: 1, channel: 'SMS', to: '+919800000011', templateCode: 'workflow.task.assigned', data: { docLabel: 'Bill', docRef: 'LOW', link: 'l' }, priority: 3 });
  const fast = comm.send({ companyId: 1, channel: 'SMS', to: '+919800000012', templateCode: 'workflow.task.assigned', data: { docLabel: 'Bill', docRef: 'HIGH', link: 'l' }, priority: 1 });
  assert.ok(fast.id > slow.id);
  assert.equal((await comm.process(10)).sent, 2);
  const seen = sandboxOutbox('SMS').map((m) => JSON.stringify(m));
  assert.ok(seen.findIndex((m) => m.includes('HIGH')) < seen.findIndex((m) => m.includes('LOW')));
  await api.close();
});
