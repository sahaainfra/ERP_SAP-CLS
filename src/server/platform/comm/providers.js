import { ProviderError, httpJson } from '../integrations/providers.js';

// The channel providers of the communication gateway (part 04.07), registered with the integration hub (01.08): a sandbox for each channel that keeps what it was given in memory and can
// be told to fail (for set-up, training and the tests of failover), SendGrid for e-mail, a generic Indian text-message API that carries the DLT identities, and the WhatsApp Business
// Cloud API with approved templates and session messages. SMTP, SES, FCM and voice are later (D-212).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9]{10,15}$/;
const outbox = { EMAIL: [], SMS: [], WHATSAPP: [] };
/** What the sandboxes were given, newest last (up to 200 each). */
export const sandboxOutbox = (channel) => outbox[channel].slice();
export const clearSandboxOutbox = () => { for (const k of Object.keys(outbox)) outbox[k].length = 0; };

const bearer = (ctx) => (ctx.secrets.api_key ? { authorization: `Bearer ${ctx.secrets.api_key}` } : {});
const simulate = (ctx) => {
  const mode = ctx.config.simulate ?? 'ok';
  if (mode === 'down') throw new ProviderError('The sandbox provider is simulating an outage.', { retryable: true, httpStatus: 503 });
  if (mode === 'reject') throw new ProviderError('The sandbox provider is simulating a refusal of the message.', { retryable: false, httpStatus: 400 });
};
const keep = (channel, message) => { outbox[channel].push(message); if (outbox[channel].length > 200) outbox[channel].shift(); };
const simulateField = { name: 'simulate', label: 'Simulate (ok, down or reject)', help: 'For training and tests: down fails every call, reject refuses every message.' };

const phoneProblems = (p) => {
  const problems = [];
  if (!p || typeof p !== 'object') return [{ field: 'payload', message: 'Send an object with to and message.' }];
  if (typeof p.to !== 'string' || !PHONE.test(p.to)) problems.push({ field: 'to', message: 'Give the mobile number with country code, digits only.' });
  return problems;
};
const smsProblems = (p) => [...phoneProblems(p), ...(typeof p?.message === 'string' && p.message.trim() && p.message.length <= 1600 ? [] : [{ field: 'message', message: 'Give the message text (at most 1,600 characters).' }])];
const waProblems = (p) => {
  const problems = phoneProblems(p);
  const kinds = ['template', 'text', 'document'].filter((k) => p?.[k]);
  if (kinds.length !== 1) problems.push({ field: 'message', message: 'Send exactly one of a template, a text or a document.' });
  if (p?.template && !(typeof p.template.name === 'string' && Array.isArray(p.template.params ?? []))) problems.push({ field: 'template', message: 'A template needs a name and its parameters.' });
  return problems;
};
const idOf = (data) => data?.messageId ?? data?.id ?? data?.messages?.[0]?.id ?? data?.message_id ?? null;

export function registerCommProviders(registry) {
  registry.register({
    type: 'email', provider: 'sendgrid', label: 'SendGrid', description: 'Sends e-mail through the SendGrid v3 API.',
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true, help: 'https://api.sendgrid.com' }, { name: 'fromAddress', label: 'From address', required: true }, { name: 'fromName', label: 'From name' }],
    secrets: [{ name: 'api_key', label: 'API key', required: true }],
    validateConfig: (c) => (EMAIL.test(String(c.fromAddress ?? '')) ? [] : ['fromAddress must be a valid email address.']),
    operations: {
      send: {
        validate: (p) => (Array.isArray(p?.to) && p.to.length && p.to.every((a) => EMAIL.test(a)) && p.subject && p.text ? [] : [{ field: 'to', message: 'Give valid addresses, a subject and the text.' }]),
        async run(ctx, p) {
          const out = await httpJson(ctx, { path: '/v3/mail/send', headers: bearer(ctx), body: { personalizations: [{ to: p.to.map((email) => ({ email })) }], from: { email: ctx.config.fromAddress, ...(ctx.config.fromName ? { name: ctx.config.fromName } : {}) }, subject: p.subject, content: [{ type: 'text/plain', value: p.text }, ...(p.html ? [{ type: 'text/html', value: p.html }] : [])], ...(p.replyTo ? { reply_to: { email: p.replyTo } } : {}) } });
          return { ...out, data: { messageId: out.data?.id ?? `sg-${Date.now().toString(36)}`, accepted: p.to.length } };
        },
      },
    },
    health: async (ctx) => ({ message: `SendGrid configured to send as ${ctx.config.fromAddress}.` }),
    sample: null,
  });
  registry.register({
    type: 'sms', provider: 'sandbox', label: 'Sandbox (no message leaves the system)', description: 'Keeps text messages in memory; can simulate an outage or a refusal.',
    configFields: [simulateField], secrets: [], validateConfig: () => [],
    operations: { send: { validate: smsProblems, async run(ctx, p) { simulate(ctx); const id = `sbx-sms-${outbox.SMS.length + 1}-${Date.now().toString(36)}`; keep('SMS', { id, connector: ctx.connector.code, ...p, at: new Date().toISOString() }); return { httpStatus: 200, data: { messageId: id } }; } } },
    health: async () => ({ message: 'Sandbox ready.' }), sample: null,
  });
  registry.register({
    type: 'sms', provider: 'http_sms', label: 'Text-message API (DLT)', description: 'Posts JSON to an Indian text-message provider with the sender ID and the DLT entity and template identities.',
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true }, { name: 'sendPath', label: 'Send path', help: 'Default /send' }, { name: 'healthPath', label: 'Health path' }, simulateField],
    secrets: [{ name: 'api_key', label: 'API key', required: true }],
    validateConfig: () => [],
    operations: { send: { validate: smsProblems, async run(ctx, p) { simulate(ctx); const out = await httpJson(ctx, { path: ctx.config.sendPath || '/send', headers: bearer(ctx), body: { to: p.to, message: p.message, sender_id: p.senderId, dlt_entity_id: p.dltEntityId, dlt_template_id: p.dltTemplateId } }); return { ...out, data: { ...out.data, messageId: idOf(out.data) } }; } } },
    health: async (ctx) => { const out = await httpJson(ctx, { method: 'GET', path: ctx.config.healthPath || '/health', headers: bearer(ctx) }); return { message: `Provider answered HTTP ${out.httpStatus}.` }; },
    sample: null,
  });
  registry.register({
    type: 'whatsapp', provider: 'sandbox', label: 'Sandbox (no message leaves the system)', description: 'Keeps WhatsApp messages in memory, offers a few approved templates, and can simulate an outage.',
    configFields: [simulateField], secrets: [], validateConfig: () => [],
    operations: {
      send: { validate: waProblems, async run(ctx, p) { simulate(ctx); const id = `sbx-wa-${outbox.WHATSAPP.length + 1}-${Date.now().toString(36)}`; keep('WHATSAPP', { id, connector: ctx.connector.code, ...p, at: new Date().toISOString() }); return { httpStatus: 200, data: { messageId: id } }; } },
      templates: { validate: () => [], async run() { return { httpStatus: 200, data: { templates: [{ name: 'workflow_task_assigned', language: 'en', status: 'APPROVED', category: 'UTILITY', params: 6 }, { name: 'otp_code', language: 'en', status: 'APPROVED', category: 'AUTHENTICATION', params: 2 }, { name: 'ntf_test', language: 'en', status: 'APPROVED', category: 'UTILITY', params: 1 }, { name: 'rfq_invitation', language: 'en', status: 'PENDING', category: 'UTILITY', params: 3 }] } }; } },
    },
    health: async () => ({ message: 'Sandbox ready.' }), sample: null,
  });
  registry.register({
    type: 'whatsapp', provider: 'cloud_api', label: 'WhatsApp Business Cloud API', description: 'Sends approved templates and session messages through the Meta Cloud API; the status and the replies come back by webhook.',
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true, help: 'https://graph.facebook.com/v19.0' }, { name: 'phoneNumberId', label: 'Phone number ID', required: true }, { name: 'businessAccountId', label: 'Business account ID', required: true }, simulateField],
    secrets: [{ name: 'api_key', label: 'Access token', required: true }],
    validateConfig: () => [],
    operations: {
      send: {
        validate: waProblems,
        async run(ctx, p) {
          simulate(ctx);
          const body = { messaging_product: 'whatsapp', to: p.to.replace(/^\+/, ''), ...(p.template ? { type: 'template', template: { name: p.template.name, language: { code: p.template.language ?? 'en' }, components: [{ type: 'body', parameters: p.template.params.map((t) => ({ type: 'text', text: String(t) })) }] } } : p.document ? { type: 'document', document: { link: p.document.link, filename: p.document.filename } } : { type: 'text', text: { body: p.text } }) };
          const out = await httpJson(ctx, { path: `/${ctx.config.phoneNumberId}/messages`, headers: bearer(ctx), body });
          return { ...out, data: { messageId: idOf(out.data) } };
        },
      },
      templates: {
        validate: () => [],
        async run(ctx) {
          const out = await httpJson(ctx, { method: 'GET', path: `/${ctx.config.businessAccountId}/message_templates`, headers: bearer(ctx) });
          return { ...out, data: { templates: (out.data?.data ?? []).map((t) => ({ name: t.name, language: t.language, status: t.status, category: t.category, params: 0 })) } };
        },
      },
    },
    health: async (ctx) => { const out = await httpJson(ctx, { method: 'GET', path: `/${ctx.config.phoneNumberId}`, headers: bearer(ctx) }); return { message: `Provider answered HTTP ${out.httpStatus}.` }; },
    sample: null,
  });
}

/**
 * What a provider's webhook says, in one shape. Understands the normalised form ({ kind: 'status', providerMsgId, status } and { kind: 'inbound', from, body }), the WhatsApp Cloud API
 * form (entry[].changes[].value.statuses and .messages) and an inbound e-mail ({ from, subject, text, inReplyTo }).
 */
export function parseWebhook(type, payload) {
  const events = [];
  const p = payload ?? {};
  if (p.kind === 'status') events.push({ kind: 'status', providerMsgId: String(p.providerMsgId), status: String(p.status).toLowerCase(), at: p.at ?? null, error: p.error ?? null });
  else if (p.kind === 'inbound') events.push({ kind: 'inbound', from: String(p.from ?? ''), body: String(p.body ?? ''), subject: p.subject ?? null, providerMsgId: p.providerMsgId ?? null, at: p.at ?? null, inReplyTo: p.inReplyTo ?? null, replyToken: p.replyToken ?? null });
  for (const e of p.entry ?? []) for (const c of e.changes ?? []) {
    const v = c.value ?? {};
    for (const s of v.statuses ?? []) events.push({ kind: 'status', providerMsgId: String(s.id), status: String(s.status).toLowerCase(), at: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : null, error: s.errors?.[0]?.title ?? null });
    for (const m of v.messages ?? []) events.push({ kind: 'inbound', from: `+${m.from}`, body: m.text?.body ?? m.button?.text ?? '', subject: null, providerMsgId: m.id, at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null, inReplyTo: m.context?.id ?? null, replyToken: null });
  }
  if (type === 'email' && !p.kind && p.from && (p.text || p.body)) events.push({ kind: 'inbound', from: String(p.from).replace(/^.*<([^>]+)>.*$/, '$1').toLowerCase(), body: String(p.text ?? p.body), subject: p.subject ?? null, providerMsgId: p.messageId ?? null, at: p.at ?? null, inReplyTo: p.inReplyTo ?? p.headers?.['In-Reply-To'] ?? null, replyToken: (String(p.to ?? '').match(/\+([a-z0-9]{8,16})@/i) ?? [])[1] ?? null });
  return events.filter((e) => (e.kind === 'status' ? e.providerMsgId : e.from));
}
