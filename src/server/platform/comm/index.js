import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { inTransaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { publishEvent } from '../events/index.js';
import { identityOf } from '../identity/index.js';
import { IntegrationError, integrationsOf } from '../integrations/index.js';
import { createParameterStore } from '../parameters/index.js';
import { notificationsOf, render } from '../notify/index.js';
import { workflowOf } from '../workflow/index.js';
import { parseWebhook } from './providers.js';

/**
 * The communication gateway (part 04.07): the one way a message leaves for, or arrives from, the outside.
 *
 *   commOf(db).send({ companyId, channel: 'SMS', to, templateCode, data, purpose, priority, attachments, related: { entity, id }, contact: { type, id }, actor })
 *   commOf(db).otp.send({ companyId, purpose: 'APPROVAL_LINK', channel: 'SMS', address, userRef, subjectRef }) / .verify({ ... code })
 *
 * A message is checked (the channel is on, the person has not opted out, a commercial one has an opt-in, an SMS matches a registered DLT template, a WhatsApp message is an approved template or
 * inside the 24-hour session), written to the queue, and sent in order of priority through the primary connector of its channel, failing over to the secondary. What the provider says later
 * (delivered, read, failed, a reply) arrives by webhook and is written back to the same message.
 */
export const CHANNELS = Object.freeze(['EMAIL', 'SMS', 'WHATSAPP', 'PUSH']);
export const PURPOSES = Object.freeze(['TRANSACTIONAL', 'COMMERCIAL', 'OTP']);
export const OTP_PURPOSES = Object.freeze(['LOGIN_MFA', 'MFA_ENROL', 'APPROVAL_LINK', 'PORTAL_SIGNUP', 'PAYMENT_CONFIRM', 'OTHER']);
const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|opt\s*out|band|रोकें|बंद)\s*[.!]*\s*$/i;
const START = /^\s*(start|unstop|subscribe|yes|opt\s*in|शुरू)\s*[.!]*\s*$/i;
const RANK = { QUEUED: 0, SENDING: 1, SENT: 2, DELIVERED: 3, READ: 4 };
const BACKOFF_MIN = [1, 5, 30, 120];
const iso = (d) => d.toISOString();

const instances = new WeakMap();
export function commOf(db) {
  let c = instances.get(db);
  if (!c) { c = createComm(db); instances.set(db, c); }
  return c;
}

/** An address as it is kept: e-mail in lower case, a phone number with its country code (a ten-digit Indian number gets +91). */
export function normaliseAddress(channel, raw) {
  const a = String(raw ?? '').trim();
  if (channel === 'EMAIL') return a.toLowerCase();
  if (channel === 'PUSH') return a;
  const d = a.replace(/[\s()-]/g, '');
  if (/^\+[0-9]{10,15}$/.test(d)) return d;
  if (/^[0-9]{10}$/.test(d)) return `+91${d}`;
  if (/^91[0-9]{10}$/.test(d)) return `+${d}`;
  return d;
}
/** What may be kept of a message: the code of a one-time password and a token in a link are never written down. */
export const redact = (text, purpose) => String(text ?? '').replace(/(token|code|otp|key)=([A-Za-z0-9_-]{6,})/gi, '$1=••••').replace(purpose === 'OTP' ? /\b\d{4,8}\b/g : /(?!)/g, '••••••');
/** A DLT template as the operator registers it: the fixed words and `{#var#}` where a fact goes. Does the message match it? */
export function dltMatches(pattern, body) {
  const re = new RegExp(`^${pattern.split(/\{#var#\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.{1,200}?')}$`, 's');
  return re.test(String(body).trim());
}

function createComm(db) {
  const engine = workflowOf(db);
  const params = createParameterStore(db);
  const now = () => engine.clock();
  const param = (key, companyId) => params.get(key, { companyId, date: now().toISOString().slice(0, 10) });
  const hubOf = () => integrationsOf(db);
  const notif = notificationsOf(db);
  let pushSender = null;
  let pepper = 'dev-otp-pepper';
  const sentTimes = new Map(); // channel key -> [ms] for the pace of a channel

  // ---- routing ----
  const activeChannel = (companyId, channel) => db.prepare("SELECT * FROM comm_channels WHERE company_id = ? AND channel = ? AND status = 'ACTIVE' AND is_active = 1 ORDER BY channel_version DESC LIMIT 1").get(companyId, channel);
  /** The connectors a channel tries, in order: the ones set in Channel Settings, else the one the sign-in policy names (the way things worked before this part). */
  function routeFor(companyId, channel) {
    const cfg = activeChannel(companyId, channel);
    if (cfg) return { cfg, enabled: cfg.enabled === 1, connectors: [cfg.primary_connector, cfg.secondary_connector].filter(Boolean) };
    if (channel === 'PUSH') return { cfg: null, enabled: true, connectors: [] };
    let code = null;
    try { const n = identityOf(db).policies.for(companyId).notify; code = channel === 'EMAIL' ? n.connector : channel === 'SMS' ? n.smsConnector : n.whatsappConnector; } catch { /* no policy */ }
    return { cfg: null, enabled: true, connectors: code ? [code] : [] };
  }
  const connectorRow = (companyId, code) => db.prepare('SELECT * FROM core_connectors WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL').get(companyId, code);

  // ---- consent ----
  const consentOf = (companyId, address, channel) => db.prepare('SELECT * FROM comm_consents WHERE company_id = ? AND address = ? AND channel = ? AND is_active = 1').get(companyId, address, channel);
  function setConsent({ companyId, contactType = 'OTHER', contactId = null, contactName = null, address, channel, status, source, actor = 'system' }) {
    const a = normaliseAddress(channel, address);
    return inTransaction(db, () => {
      const old = consentOf(companyId, a, channel);
      const stamp = iso(now());
      if (old) db.prepare('UPDATE comm_consents SET status = ?, source = ?, changed_at = ?, changed_by = ?, contact_type = ?, contact_id = COALESCE(?, contact_id), contact_name = COALESCE(?, contact_name), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, source, stamp, actor, contactType, contactId, contactName, actor, stamp, old.id);
      else db.prepare("INSERT INTO comm_consents (company_id, contact_type, contact_id, contact_name, address, channel, status, source, changed_at, changed_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'consent')").run(companyId, contactType, contactId, contactName, a, channel, status, source, stamp, actor, actor);
      const row = consentOf(companyId, a, channel);
      if (!old || old.status !== status) {
        writeAudit(db, { entity: 'comm_consents', entityId: row.id, action: old ? 'update' : 'create', oldValues: old ? { status: old.status, source: old.source } : undefined, newValues: { address: a, channel, status, source }, actor, companyId });
        publishEvent(db, { type: 'comm.consent.changed', entity: 'consent', entityId: row.id, actorId: actor, companyId, data: { channel, status, source } });
      }
      return row;
    });
  }

  // ---- sending ----
  const blocked = (m, reason, why) => {
    const res = db.prepare(`INSERT INTO comm_messages (company_id, channel, direction, purpose, priority, to_address, template_code, subject, body_redacted, related_entity, related_id, conversation_key, contact_type, contact_id, status, block_reason, last_error, created_by, source_type, source_id)
      VALUES (?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'BLOCKED', ?, ?, ?, ?, ?)`).run(m.companyId, m.channel, m.purpose, m.priority, m.to, m.templateCode ?? null, m.subject ?? null, redact(m.body ?? '', m.purpose), m.related?.entity ?? null, m.related?.id == null ? null : String(m.related.id), m.conversationKey, m.contact?.type ?? null, m.contact?.id == null ? null : String(m.contact.id), reason, why, m.actor ?? 'system', m.source?.type ?? null, m.source?.id == null ? null : String(m.source.id));
    return { id: Number(res.lastInsertRowid), status: 'BLOCKED', blockReason: reason, message: why };
  };

  /** Check a message and put it in the queue, or write it down as blocked with the reason. Returns { id, status, blockReason?, message? }. */
  function send(input) {
    const m = { purpose: 'TRANSACTIONAL', priority: 2, ...input, channel: input.channel };
    m.to = normaliseAddress(m.channel, input.to);
    m.conversationKey = m.related?.entity ? `${m.channel}:${m.to}:${m.related.entity}:${m.related.id}` : `${m.channel}:${m.to}`;
    return inTransaction(db, () => {
      if (!CHANNELS.includes(m.channel)) return blocked(m, 'CHANNEL_UNKNOWN', `${m.channel} is not a channel of the gateway.`);
      const route = routeFor(m.companyId, m.channel);
      if (!route.enabled) return blocked(m, 'CHANNEL_OFF', `The ${m.channel} channel is switched off in Channel Settings.`);
      if (m.channel !== 'PUSH' && route.connectors.length === 0) return blocked(m, 'NO_CONNECTOR', `No connector is set up for ${m.channel}. Ask the IT administrator to set the channel up in Channel Settings.`);
      if (!m.to) return blocked(m, 'NO_ADDRESS', 'There is nobody to send it to: the address is empty.');
      if (m.channel === 'EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.to)) return blocked(m, 'BAD_ADDRESS', `${m.to} is not an e-mail address.`);
      if ((m.channel === 'SMS' || m.channel === 'WHATSAPP') && !/^\+[0-9]{10,15}$/.test(m.to)) return blocked(m, 'BAD_ADDRESS', `${m.to} is not a mobile number with its country code.`);
      // the words
      const lang = m.lang ?? 'en';
      if (m.templateCode && m.body == null) {
        const t = notif.templateFor(m.companyId, m.templateCode, m.channel === 'PUSH' ? 'PUSH' : m.channel, lang);
        if (!t) return blocked(m, 'NO_TEMPLATE', `There is no ${m.channel} text for ${m.templateCode}.`);
        m.body = render(t.body, m.data ?? {});
        m.subject ??= render(t.subject, m.data ?? {});
      }
      if (!m.body) return blocked(m, 'NO_BODY', 'The message has no text.');
      // consent (BR-01)
      const consent = m.channel === 'PUSH' ? null : consentOf(m.companyId, m.to, m.channel);
      if (m.purpose === 'COMMERCIAL' && consent?.status !== 'OPT_IN') return blocked(m, 'NO_OPT_IN', `${m.to} has not agreed to commercial messages on ${m.channel}. Commercial messages go only to people who opted in.`);
      if (consent?.status === 'OPT_OUT' && m.purpose !== 'OTP' && !m.essential) return blocked(m, 'OPTED_OUT', `${m.to} opted out of ${m.channel} messages (${consent.source.replace('_', ' ').toLowerCase()}, ${consent.changed_at.slice(0, 10)}).`);
      // SMS: the registered DLT template must match (BR-01)
      let dlt = null;
      if (m.channel === 'SMS') {
        dlt = m.templateCode ? db.prepare("SELECT * FROM comm_dlt_templates WHERE company_id = ? AND template_code = ? AND status = 'ACTIVE' AND is_active = 1 ORDER BY dlt_version DESC LIMIT 1").get(m.companyId, m.templateCode) : null;
        if (!dlt) return blocked(m, 'DLT_NO_TEMPLATE', `A text message needs a registered DLT template. ${m.templateCode ? `None is registered for ${m.templateCode}` : 'This message names no template'}; register it in Channel Settings (DLT templates).`);
        if (!dltMatches(dlt.body_pattern, m.body)) return blocked(m, 'DLT_MISMATCH', `The text does not match the DLT template ${dlt.dlt_template_id} registered for ${m.templateCode}. The operator would refuse it. Registered: "${dlt.body_pattern}".`);
      }
      // WhatsApp: an approved template, or a session message within 24 hours of the person's last reply
      let wa = null;
      if (m.channel === 'WHATSAPP') {
        wa = m.templateCode ? db.prepare("SELECT * FROM comm_wa_templates WHERE company_id = ? AND template_code = ? AND provider_status = 'APPROVED' AND is_active = 1 AND language = ? LIMIT 1").get(m.companyId, m.templateCode, lang) ?? db.prepare("SELECT * FROM comm_wa_templates WHERE company_id = ? AND template_code = ? AND provider_status = 'APPROVED' AND is_active = 1 LIMIT 1").get(m.companyId, m.templateCode) : null;
        const session = db.prepare("SELECT 1 FROM comm_messages WHERE company_id = ? AND channel = 'WHATSAPP' AND direction = 'IN' AND to_address = ? AND created_at >= ? LIMIT 1").get(m.companyId, m.to, iso(new Date(now().getTime() - 24 * 3_600_000)));
        if (!wa && !session) return blocked(m, 'WA_NO_TEMPLATE', `WhatsApp allows a business to start a conversation only with an approved template${m.templateCode ? `, and none is approved for ${m.templateCode}` : ''}. Sync the templates in Channel Settings, or wait for ${m.to} to write first (a reply is allowed for 24 hours).`);
      }
      // attachments: a signed link, never the file's own address
      const links = (m.attachments ?? []).map((a) => ({ name: a.name ?? 'Document', url: a.url }));
      if (m.attachments?.some((a) => !a.url)) return blocked(m, 'BAD_ATTACHMENT', 'An attachment needs a download link from the file service.');
      let body = m.body;
      if (links.length && m.channel !== 'WHATSAPP') body += `\n\n${links.map((l) => `${l.name}: ${l.url}`).join('\n')}`;
      const token = m.channel === 'EMAIL' ? randomBytes(6).toString('hex') : null;
      const payload = { subject: m.subject ?? null, body, ...(dlt ? { dlt: { id: dlt.dlt_template_id, sender: dlt.sender_id ?? route.cfg?.sender_id ?? null, entity: route.cfg?.dlt_entity_id ?? null } } : {}), ...(wa ? { wa: { name: wa.name, language: wa.language, params: JSON.parse(wa.variables_json || '[]').map((k) => String(m.data?.[k] ?? '')) } } : {}), links, replyToken: token, ...(m.noRetry ? { noRetry: true } : {}) };
      const res = db.prepare(`INSERT INTO comm_messages (company_id, channel, direction, purpose, priority, to_address, from_address, template_code, provider_template_id, subject, body_redacted, payload_json, attachments_json, related_entity, related_id, conversation_key, contact_type, contact_id, status, reply_token, next_attempt_at, project_id, site_id, created_by, source_type, source_id)
        VALUES (?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?, ?, ?, ?)`)
        .run(m.companyId, m.channel, m.purpose, m.priority, m.to, route.cfg?.sender_id ?? null, m.templateCode ?? null, dlt?.dlt_template_id ?? wa?.name ?? null, m.subject ?? null, redact(body, m.purpose), JSON.stringify(payload), JSON.stringify(links), m.related?.entity ?? null, m.related?.id == null ? null : String(m.related.id), m.conversationKey, m.contact?.type ?? null, m.contact?.id == null ? null : String(m.contact.id), token, iso(now()), m.projectId ?? null, m.siteId ?? null, m.actor ?? 'system', m.source?.type ?? null, m.source?.id == null ? null : String(m.source.id));
      return { id: Number(res.lastInsertRowid), status: 'QUEUED' };
    });
  }

  async function deliverVia(row, code, payload) {
    const c = connectorRow(row.company_id, code);
    if (!c) throw new IntegrationError('CONNECTOR_NOT_FOUND', `There is no connector "${code}" for this company.`);
    const provider = hubOf().providers.get(c.type, c.provider);
    const opts = { companyId: row.company_id, actor: { user: 'system' }, idempotencyKey: `comm-${row.id}-${row.attempts + 1}-${code}` };
    const hub = hubOf().hub;
    let out;
    if (row.channel === 'EMAIL') out = await hub.call(code, 'send', { to: [row.to_address], subject: payload.subject ?? '(no subject)', text: payload.body, ...(payload.replyToken ? { replyTo: `reply+${payload.replyToken}@${(JSON.parse(c.config_json).fromAddress ?? 'localhost').split('@')[1] ?? 'localhost'}` } : {}) }, opts);
    else if (row.channel === 'SMS') {
      out = provider?.operations.send
        ? await hub.call(code, 'send', { to: row.to_address, message: payload.body, senderId: payload.dlt?.sender ?? undefined, dltTemplateId: payload.dlt?.id, dltEntityId: payload.dlt?.entity ?? undefined }, opts)
        : await hub.call(code, 'request', { method: 'POST', path: '/send', body: { to: row.to_address, message: payload.body } }, opts);
    } else if (row.channel === 'WHATSAPP') {
      const body = payload.wa ? { template: { name: payload.wa.name, language: payload.wa.language, params: payload.wa.params } } : payload.links?.[0] ? { document: { link: payload.links[0].url, filename: payload.links[0].name } } : { text: payload.body };
      out = provider?.operations.send
        ? await hub.call(code, 'send', { to: row.to_address, ...body }, opts)
        : await hub.call(code, 'request', { method: 'POST', path: '/send', body: { to: row.to_address, message: payload.body } }, opts);
    }
    const d = out?.data ?? {};
    return { providerMsgId: String(d.messageId ?? d.id ?? d.messages?.[0]?.id ?? `log-${out?.logId ?? row.id}`), logId: out?.logId ?? null };
  }

  const event = (type, row, extra = {}) => publishEvent(db, { type, entity: 'comm_message', entityId: row.id, actorId: 'system', companyId: row.company_id, data: { channel: row.channel, to: row.to_address, template: row.template_code, relatedEntity: row.related_entity, relatedId: row.related_id, sourceType: row.source_type, sourceId: row.source_id, ...extra } });
  const paceOk = (companyId, channel, rate) => {
    const k = `${companyId}:${channel}`;
    const t = (sentTimes.get(k) ?? []).filter((x) => x > Date.now() - 60_000);
    sentTimes.set(k, t);
    return t.length < rate;
  };

  /** Send what is queued and due, most urgent first. Returns { sent, failed, retrying, deferred }. */
  async function process(limit = 50, onlyId = null) {
    const due = onlyId ? db.prepare("SELECT * FROM comm_messages WHERE id = ? AND status = 'QUEUED'").all(onlyId) : db.prepare("SELECT * FROM comm_messages WHERE status = 'QUEUED' AND direction = 'OUT' AND next_attempt_at <= ? ORDER BY priority, id LIMIT ?").all(iso(now()), limit);
    const result = { sent: 0, failed: 0, retrying: 0, deferred: 0 };
    for (const row0 of due) {
      const claimed = db.prepare("UPDATE comm_messages SET status = 'SENDING', updated_at = ?, version = version + 1 WHERE id = ? AND status = 'QUEUED'").run(iso(now()), row0.id);
      if (!Number(claimed.changes)) continue;
      const row = { ...row0, status: 'SENDING' };
      const payload = JSON.parse(row.payload_json ?? '{}');
      const route = routeFor(row.company_id, row.channel);
      const stamp = iso(now());
      const back = (to, error, attempts, status = 'QUEUED') => db.prepare('UPDATE comm_messages SET status = ?, attempts = ?, last_error = ?, next_attempt_at = ?, route_json = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, attempts, error, to, JSON.stringify(trail), stamp, row.id);
      const trail = JSON.parse(row.route_json ?? '[]');
      if (!paceOk(row.company_id, row.channel, route.cfg?.rate_per_minute ?? 600)) { back(iso(new Date(now().getTime() + 30_000)), null, row.attempts); result.deferred += 1; continue; }
      let done = null;
      if (row.channel === 'PUSH') {
        try {
          if (!pushSender) throw new Error('Push is not set up on this installation');
          const r = await pushSender(row.company_id, row.to_address, { title: payload.subject ?? 'Construction ERP', body: payload.body, url: payload.links?.[0]?.url ?? '/notifications', tag: `comm-${row.id}` });
          if (!r.count) throw new Error(r.reason ?? 'No device accepted the push');
          done = { providerMsgId: `push:${row.id}`, connector: 'web-push' };
        } catch (err) { trail.push({ connector: 'web-push', error: String(err.message).slice(0, 200), retryable: true }); }
      } else {
        for (const code of route.connectors) {
          try {
            const r = await deliverVia(row, code, payload);
            done = { ...r, connector: code };
            trail.push({ connector: code, ok: true });
            break;
          } catch (err) {
            const rateLimited = err instanceof IntegrationError && err.code === 'RATE_LIMITED';
            trail.push({ connector: code, error: String(err.message).slice(0, 200), code: err.code ?? null, retryable: err.retryable ?? false });
            if (rateLimited) { back(iso(new Date(now().getTime() + (err.retryAfterMs ?? 30_000))), null, row.attempts); result.deferred += 1; done = 'deferred'; break; }
          }
        }
      }
      if (done === 'deferred') continue;
      if (done) {
        const t = sentTimes.get(`${row.company_id}:${row.channel}`) ?? [];
        t.push(Date.now());
        sentTimes.set(`${row.company_id}:${row.channel}`, t);
        db.prepare("UPDATE comm_messages SET status = 'SENT', connector_code = ?, provider_msg_id = ?, attempts = ?, last_error = NULL, payload_json = NULL, route_json = ?, sent_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(done.connector, done.providerMsgId, row.attempts + 1, JSON.stringify(trail), stamp, stamp, row.id);
        event('comm.message.sent', { ...row, connector_code: done.connector }, { connector: done.connector, failover: trail.length > 1 });
        result.sent += 1;
        continue;
      }
      const attempts = row.attempts + 1;
      const last = trail.at(-1);
      const permanent = payload.noRetry || trail.slice(-Math.max(route.connectors.length, 1)).every((t) => t.retryable === false);
      if (permanent || attempts >= param('comm.max_attempts', row.company_id)) {
        back(null, last?.error ?? 'Not sent', attempts, 'FAILED');
        if (row.purpose === 'OTP') db.prepare('UPDATE comm_messages SET payload_json = NULL WHERE id = ?').run(row.id); // a code is never kept; other failed text stays for Retry until the retention purge
        event('comm.message.failed', row, { error: last?.error ?? null });
        result.failed += 1;
      } else {
        back(iso(new Date(now().getTime() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000)), last?.error ?? 'Not sent', attempts);
        result.retrying += 1;
      }
    }
    return result;
  }
  /** Send one message now (a verification code, or a notification the engine is already retrying): the queue's checks and its failover, without waiting for the next round. */
  async function sendNow(input) {
    const q = send(input);
    if (q.status !== 'QUEUED') return { ...q, row: db.prepare('SELECT * FROM comm_messages WHERE id = ?').get(q.id) };
    await process(1, q.id);
    return { id: q.id, row: db.prepare('SELECT * FROM comm_messages WHERE id = ?').get(q.id), status: db.prepare('SELECT status FROM comm_messages WHERE id = ?').get(q.id).status };
  }
  /** A message that left some other way (the old sign-in path) still belongs in the log; its text is redacted. */
  function logExternal({ companyId, channel, to, purpose = 'OTP', templateCode = null, body, delivered, error = null, source = null, actor = 'system' }) {
    const stamp = iso(now());
    const res = db.prepare(`INSERT INTO comm_messages (company_id, channel, direction, purpose, to_address, template_code, body_redacted, conversation_key, status, last_error, attempts, sent_at, created_by, source_type, source_id)
      VALUES (?, ?, 'OUT', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`).run(companyId, channel, purpose, normaliseAddress(channel, to), templateCode, redact(body, purpose), `${channel}:${normaliseAddress(channel, to)}`, delivered ? 'SENT' : 'FAILED', error, delivered ? stamp : null, actor, source?.type ?? null, source?.id == null ? null : String(source.id));
    return Number(res.lastInsertRowid);
  }

  // ---- what comes back: receipts and replies (FR-04, FR-05, FR-06) ----
  function setStatus(row, status, at, error = null) {
    if (status === 'FAILED' ? ['DELIVERED', 'READ'].includes(row.status) : RANK[status] <= (RANK[row.status] ?? 0)) return false;
    const stamp = at ?? iso(now());
    if (status === 'DELIVERED') db.prepare('UPDATE comm_messages SET status = ?, delivered_at = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, stamp, stamp, row.id);
    else if (status === 'READ') db.prepare('UPDATE comm_messages SET status = ?, read_at = ?, delivered_at = COALESCE(delivered_at, ?), updated_at = ?, version = version + 1 WHERE id = ?').run(status, stamp, stamp, stamp, row.id);
    else db.prepare('UPDATE comm_messages SET status = ?, last_error = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, error ?? 'The provider reported a failure', stamp, row.id);
    event(status === 'DELIVERED' ? 'comm.message.delivered' : status === 'READ' ? 'comm.message.read' : 'comm.message.failed', row, { error });
    return true;
  }
  /** The webhook of a connector (already verified by the hub, 01.08): update the messages it names and take in what the person wrote back. */
  function handleWebhook({ companyId, connectorCode, type, payload }) {
    const out = { updated: 0, received: 0, consents: 0, ignored: 0 };
    const channel = type === 'email' ? 'EMAIL' : type === 'sms' ? 'SMS' : type === 'whatsapp' ? 'WHATSAPP' : null;
    if (!channel) return out;
    inTransaction(db, () => {
      for (const ev of parseWebhook(type, payload)) {
        if (ev.kind === 'status') {
          const row = db.prepare('SELECT * FROM comm_messages WHERE company_id = ? AND provider_msg_id = ? AND direction = \'OUT\'').get(companyId, ev.providerMsgId);
          if (!row) { out.ignored += 1; continue; }
          const status = { delivered: 'DELIVERED', read: 'READ', failed: 'FAILED', undelivered: 'FAILED', rejected: 'FAILED' }[ev.status];
          if (status && setStatus(row, status, ev.at, ev.error)) out.updated += 1; else out.ignored += 1;
          continue;
        }
        const from = normaliseAddress(channel, ev.from);
        const text = ev.body.trim();
        if (channel !== 'EMAIL' && STOP.test(text)) { setConsent({ companyId, address: from, channel, status: 'OPT_OUT', source: 'STOP_KEYWORD', actor: `webhook:${connectorCode}` }); out.consents += 1; }
        else if (channel !== 'EMAIL' && START.test(text)) { setConsent({ companyId, address: from, channel, status: 'OPT_IN', source: 'START_KEYWORD', actor: `webhook:${connectorCode}` }); out.consents += 1; }
        // the conversation it belongs to: the e-mail reply token or the message it answers, else the last thing we sent to that address
        const prior = (ev.replyToken && db.prepare("SELECT * FROM comm_messages WHERE company_id = ? AND reply_token = ? AND direction = 'OUT'").get(companyId, ev.replyToken))
          || (ev.inReplyTo && db.prepare("SELECT * FROM comm_messages WHERE company_id = ? AND provider_msg_id = ? AND direction = 'OUT'").get(companyId, ev.inReplyTo))
          || db.prepare("SELECT * FROM comm_messages WHERE company_id = ? AND channel = ? AND direction = 'OUT' AND to_address = ? AND related_entity IS NOT NULL AND status IN ('SENT', 'DELIVERED', 'READ') ORDER BY id DESC LIMIT 1").get(companyId, channel, from);
        const res = db.prepare(`INSERT INTO comm_messages (company_id, channel, direction, purpose, to_address, from_address, template_code, subject, body_redacted, related_entity, related_id, conversation_key, contact_type, contact_id, status, connector_code, provider_msg_id, sent_at, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, 'IN', 'TRANSACTIONAL', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?, ?, ?, 'webhook', ?)`)
          .run(companyId, channel, from, from, ev.subject, redact(text.slice(0, 4000), 'TRANSACTIONAL'), prior?.related_entity ?? null, prior?.related_id ?? null, prior?.conversation_key ?? `${channel}:${from}`, prior?.contact_type ?? null, prior?.contact_id ?? null, connectorCode, ev.providerMsgId, ev.at ?? iso(now()), prior?.project_id ?? null, prior?.site_id ?? null, `webhook:${connectorCode}`, ev.providerMsgId);
        const id = Number(res.lastInsertRowid);
        publishEvent(db, { type: 'comm.message.received', entity: 'comm_message', entityId: id, actorId: `webhook:${connectorCode}`, companyId, projectId: prior?.project_id ?? null, data: { channel, from, relatedEntity: prior?.related_entity ?? null, relatedId: prior?.related_id ?? null, conversationKey: prior?.conversation_key ?? `${channel}:${from}`, replyTo: prior?.id ?? null } });
        out.received += 1;
      }
    });
    return out;
  }

  // ---- one-time codes (FR-03, BR-02) ----
  const hashOf = (id, code) => createHmac('sha256', pepper).update(`${id}:${code}`).digest('hex');
  const otp = {
    /**
     * Make a code, keep only its hash, and send it. `render(code)` gives the text (default: the verification-code template); `deliver(text)` sends it some other way and answers
     * { delivered, reason } (the sign-in path of part 02.01 keeps its connectors). Returns { otpId, expiresAt, delivered, reason } and never the code.
     */
    async send({ companyId, purpose, channel, address, userRef = null, subjectRef = '', ttlSeconds = 300, render: renderText = null, deliver = null, actor = 'system', lang = 'en', cooldownSeconds = null, maxPerHour = null }) {
      if (!OTP_PURPOSES.includes(purpose)) throw new Error(`Unknown code purpose ${purpose}`);
      const a = normaliseAddress(channel, address);
      const code = String(randomInt(100000, 1000000));
      const minutes = Math.max(1, Math.round(ttlSeconds / 60));
      const created = inTransaction(db, () => {
        const recent = db.prepare("SELECT sent_at FROM comm_otps WHERE company_id = ? AND purpose = ? AND subject_ref = ? AND address = ? AND status = 'PENDING' ORDER BY id DESC LIMIT 1").get(companyId, purpose, subjectRef, a);
        const wait = cooldownSeconds ?? param('comm.otp.resend_seconds', companyId);
        if (recent?.sent_at && now().getTime() - Date.parse(recent.sent_at) < wait * 1000) return { tooSoon: Math.ceil(wait - (now().getTime() - Date.parse(recent.sent_at)) / 1000) };
        const hour = db.prepare('SELECT COUNT(*) AS n FROM comm_otps WHERE company_id = ? AND purpose = ? AND address = ? AND created_at >= ?').get(companyId, purpose, a, iso(new Date(now().getTime() - 3_600_000))).n;
        if (hour >= (maxPerHour ?? param('comm.otp.max_per_hour', companyId))) return { limited: true };
        db.prepare("UPDATE comm_otps SET status = 'REPLACED', updated_at = ?, version = version + 1 WHERE company_id = ? AND purpose = ? AND subject_ref = ? AND status = 'PENDING'").run(iso(now()), companyId, purpose, subjectRef);
        const res = db.prepare(`INSERT INTO comm_otps (company_id, purpose, channel, address, user_ref, subject_ref, code_hash, expires_at, max_attempts, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 'otp')`)
          .run(companyId, purpose, channel, a, userRef, subjectRef, iso(new Date(now().getTime() + ttlSeconds * 1000)), param('comm.otp.max_attempts', companyId), actor);
        const id = Number(res.lastInsertRowid);
        db.prepare('UPDATE comm_otps SET code_hash = ? WHERE id = ?').run(hashOf(id, code), id);
        return { id };
      });
      if (created.tooSoon) return { ok: false, reason: 'TOO_SOON', message: `A code was sent a moment ago. Wait ${created.tooSoon} seconds before asking for another.`, retryAfterSeconds: created.tooSoon };
      if (created.limited) return { ok: false, reason: 'LIMIT', message: 'Too many codes were asked for this address in the last hour. Try again later.' };
      const text = renderText ? renderText(code) : (() => { const t = notif.templateFor(companyId, 'otp.code', channel, lang); return t ? render(t.body, { code, minutes }) : `${code} is your verification code. It is valid for ${minutes} minutes.`; })();
      let delivered;
      let reason;
      let messageId;
      if (deliver) {
        const r = await deliver(text);
        delivered = Boolean(r?.delivered);
        reason = r?.reason ?? null;
        messageId = logExternal({ companyId, channel, to: a, purpose: 'OTP', templateCode: 'otp.code', body: text, delivered, error: reason, source: { type: 'otp', id: created.id }, actor });
      } else {
        const r = await sendNow({ companyId, channel, to: a, templateCode: 'otp.code', body: text, purpose: 'OTP', priority: 1, essential: true, actor, source: { type: 'otp', id: created.id }, lang });
        delivered = ['SENT', 'DELIVERED', 'READ'].includes(r.status);
        reason = delivered ? null : (r.row?.block_reason ?? r.row?.last_error ?? 'NOT_SENT');
        messageId = r.id;
      }
      const stamp = iso(now());
      db.prepare('UPDATE comm_otps SET message_id = ?, sent_at = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(messageId, delivered ? stamp : null, delivered ? 'PENDING' : 'UNDELIVERED', stamp, created.id);
      writeAudit(db, { entity: 'comm_otps', entityId: created.id, action: delivered ? 'send' : 'send_failed', newValues: { purpose, channel, address: a.replace(/.(?=.{3})/g, '•'), subjectRef }, actor, companyId });
      return { ok: delivered, otpId: created.id, expiresAt: iso(new Date(now().getTime() + ttlSeconds * 1000)), delivered, reason, ...(delivered ? {} : { message: `The code could not be sent (${reason}).` }) };
    },
    /** Check a code: right and in time and within the attempts, once. Returns { ok, reason?, attemptsLeft? }. */
    verify({ companyId, otpId = null, purposes = null, subjectRef = null, code, actor = 'system' }) {
      return inTransaction(db, () => {
        const where = otpId ? 'id = ?' : `purpose IN (${(purposes ?? OTP_PURPOSES).map(() => '?').join(',')}) AND subject_ref = ?`;
        const args = otpId ? [otpId] : [...(purposes ?? OTP_PURPOSES), subjectRef ?? ''];
        const row = db.prepare(`SELECT * FROM comm_otps WHERE company_id = ? AND ${where} AND status IN ('PENDING', 'LOCKED') ORDER BY id DESC LIMIT 1`).get(companyId, ...args);
        if (!row) return { ok: false, reason: 'NONE', attemptsLeft: 0 };
        const stamp = iso(now());
        if (row.status === 'LOCKED' || row.attempts >= row.max_attempts) { db.prepare("UPDATE comm_otps SET status = 'LOCKED', updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, row.id); return { ok: false, reason: 'LOCKED', attemptsLeft: 0 }; }
        if (row.expires_at <= stamp) { db.prepare("UPDATE comm_otps SET status = 'EXPIRED', updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, row.id); return { ok: false, reason: 'EXPIRED', attemptsLeft: 0 }; }
        const a = Buffer.from(hashOf(row.id, String(code ?? '').trim()));
        const b = Buffer.from(row.code_hash);
        const ok = a.length === b.length && timingSafeEqual(a, b);
        const attempts = row.attempts + 1;
        if (ok) {
          db.prepare("UPDATE comm_otps SET attempts = ?, status = 'VERIFIED', verified_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(attempts, stamp, stamp, row.id);
          writeAudit(db, { entity: 'comm_otps', entityId: row.id, action: 'verify', newValues: { purpose: row.purpose }, actor, companyId });
          return { ok: true, purpose: row.purpose, subjectRef: row.subject_ref };
        }
        const locked = attempts >= row.max_attempts;
        db.prepare('UPDATE comm_otps SET attempts = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(attempts, locked ? 'LOCKED' : 'PENDING', stamp, row.id);
        if (locked) writeAudit(db, { entity: 'comm_otps', entityId: row.id, action: 'lock', newValues: { purpose: row.purpose, attempts }, actor, companyId });
        return { ok: false, reason: locked ? 'LOCKED' : 'WRONG', attemptsLeft: Math.max(0, row.max_attempts - attempts) };
      });
    },
  };

  /** The log for a contact or a record (FR-08). */
  const history = (companyId, { entity, id, contactType, contactId, limit = 50 }) => db.prepare(`SELECT * FROM comm_messages WHERE company_id = ? AND ${entity ? 'related_entity = ? AND related_id = ?' : 'contact_type = ? AND contact_id = ?'} ORDER BY id DESC LIMIT ?`).all(companyId, ...(entity ? [entity, String(id)] : [contactType, String(contactId)]), limit);

  return { send, sendNow, process, logExternal, handleWebhook, setConsent, consentOf, otp, history, routeFor, setPushSender(fn) { pushSender = fn; }, setPepper(p) { pepper = p; }, param, now };
}

