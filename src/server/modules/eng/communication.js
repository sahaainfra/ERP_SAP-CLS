import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { commOf, normaliseAddress } from '../../platform/comm/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';

// The communication gateway's module side (part 04.07): the log, the consent register, Channel Settings (a change is approved by someone else), the WhatsApp template sync, the
// receipts and replies that arrive by webhook, and the one-time codes a person asks for. The sending itself is platform/comm.
export const COMM_DOC = 'COMM_CONFIG';
const iso = () => new Date().toISOString();
const CHANNEL_TYPE = { EMAIL: 'email', SMS: 'sms', WHATSAPP: 'whatsapp' };
const mask = (a, channel) => (!a ? null : channel === 'EMAIL' ? a.replace(/^(.).*(@.*)$/, '$1***$2') : channel === 'PUSH' ? a : `${a.slice(0, 3)}•••••${a.slice(-3)}`);

// ---- the approval of a change of the channels ----
const step = { code: 'CHECK', name: 'System administrator or director', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'SYSADM|DIR' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null };
function activate(db, batch, actor) {
  const ch = db.prepare("SELECT * FROM comm_channels WHERE batch_id = ? AND status = 'PENDING'").all(batch);
  for (const r of ch) {
    db.prepare("UPDATE comm_channels SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND channel = ? AND status = 'ACTIVE'").run(actor.user, iso(), r.company_id, r.channel);
    db.prepare("UPDATE comm_channels SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), r.id);
  }
  const dlt = db.prepare("SELECT * FROM comm_dlt_templates WHERE batch_id = ? AND status = 'PENDING'").all(batch);
  for (const r of dlt) {
    db.prepare("UPDATE comm_dlt_templates SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND template_code = ? AND status = 'ACTIVE'").run(actor.user, iso(), r.company_id, r.template_code);
    db.prepare("UPDATE comm_dlt_templates SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), r.id);
  }
  const company = (ch[0] ?? dlt[0])?.company_id;
  if (company) {
    writeAudit(db, { entity: 'comm_channels', entityId: batch, action: 'activate', newValues: { channels: ch.map((r) => r.channel), dltTemplates: dlt.map((r) => r.template_code) }, actor: actor.user, companyId: company });
    publishEvent(db, { type: 'comm.channel.changed', entity: 'comm_channel', entityId: batch, actorId: actor.user, companyId: company, data: { channels: ch.length, dltTemplates: dlt.length } });
  }
}
const reject = (db, batch, actor) => { for (const t of ['comm_channels', 'comm_dlt_templates']) db.prepare(`UPDATE ${t} SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE batch_id = ? AND status = 'PENDING'`).run(actor.user, iso(), batch); };
workflowTypes.register({
  docType: COMM_DOC,
  label: 'Communication channel settings change',
  processOwner: 'SYSADM',
  route: () => '/admin/communication-channels',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM comm_channels WHERE batch_id = ? AND company_id = ? LIMIT 1').get(Number(id), companyId) ?? db.prepare('SELECT * FROM comm_dlt_templates WHERE batch_id = ? AND company_id = ? LIMIT 1').get(Number(id), companyId);
    return r ? { ref: `Channels #${id}`, title: 'Change of channel settings', originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const ch = db.prepare('SELECT * FROM comm_channels WHERE batch_id = ? ORDER BY channel').all(Number(id));
    const dlt = db.prepare('SELECT * FROM comm_dlt_templates WHERE batch_id = ? ORDER BY template_code').all(Number(id));
    if (!ch.length && !dlt.length) return null;
    return {
      fields: [{ label: 'Channels changed', value: ch.map((r) => r.channel).join(', ') || 'none' }, { label: 'DLT templates', value: dlt.length }, { label: 'Reason', value: (ch[0] ?? dlt[0]).reason ?? '' }, { label: 'Proposed by', value: (ch[0] ?? dlt[0]).created_by }],
      lines: { columns: [{ key: 'what', label: 'What' }, { key: 'first', label: 'First' }, { key: 'then', label: 'Then' }, { key: 'detail', label: 'Detail' }], rows: [...ch.map((r) => ({ what: r.channel, first: r.primary_connector ?? 'device push', then: r.secondary_connector ?? '', detail: `${r.enabled ? 'on' : 'off'}, ${r.rate_per_minute} a minute${r.sender_id ? `, sender ${r.sender_id}` : ''}` })), ...dlt.map((r) => ({ what: `DLT ${r.template_code}`, first: r.dlt_template_id, then: '', detail: r.body_pattern }))] },
    };
  },
  defaultDefinition: { name: 'Channel settings approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step] },
  hooks: {
    onApproved: (db, { instance, actor }) => activate(db, Number(instance.docId), actor),
    onRejected: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
    onReturned: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
    onCancelled: (db, { instance, actor }) => reject(db, Number(instance.docId), actor),
  },
});

export function createCommunicationService({ db, engine }) {
  const authz = authzOf(db);
  const comm = commOf(db);
  const may = (actor, key) => authz.check(actor, key, { companyId: actor.companyId }).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };

  // ---- the log (FR-08) ----
  const msg = (r, full) => ({ id: r.id, at: r.created_at, channel: r.channel, direction: r.direction, purpose: r.purpose, priority: r.priority, to: mask(r.to_address, r.channel), toFull: full ? r.to_address : undefined, template: r.template_code, providerTemplate: r.provider_template_id, subject: r.subject, body: r.body_redacted, status: r.status, blockReason: r.block_reason, connector: r.connector_code, providerMsgId: r.provider_msg_id, attempts: r.attempts, error: r.last_error, route: JSON.parse(r.route_json || '[]'), relatedEntity: r.related_entity, relatedId: r.related_id, conversation: r.conversation_key, contactType: r.contact_type, contactId: r.contact_id, sentAt: r.sent_at, deliveredAt: r.delivered_at, readAt: r.read_at, sourceType: r.source_type, sourceId: r.source_id });
  const messages = {
    list(actor, q = {}) {
      need(actor, 'comm.log.view', 'see the communication log');
      const p = { c: actor.companyId, limit: q.limit ?? 25, offset: q.offset ?? 0 };
      const where = ['company_id = :c', 'is_active = 1'];
      for (const [k, col] of [['channel', 'channel'], ['status', 'status'], ['direction', 'direction'], ['purpose', 'purpose'], ['entity', 'related_entity'], ['id', 'related_id'], ['contactType', 'contact_type'], ['contactId', 'contact_id']]) if (q[k] != null && q[k] !== '') { where.push(`${col} = :${k}`); p[k] = String(q[k]); }
      if (q.from) { where.push('created_at >= :from'); p.from = `${q.from}T00:00:00.000Z`; }
      if (q.to) { where.push('created_at <= :to'); p.to = `${q.to}T23:59:59.999Z`; }
      if (q.address) { where.push('to_address = :addr'); p.addr = normaliseAddress(q.channel ?? (q.address.includes('@') ? 'EMAIL' : 'SMS'), q.address); }
      if (q.q) { where.push('(to_address LIKE :q OR template_code LIKE :q OR subject LIKE :q OR related_id LIKE :q OR last_error LIKE :q)'); p.q = `%${q.q}%`; }
      const pc = { ...p }; delete pc.limit; delete pc.offset;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM comm_messages WHERE ${where.join(' AND ')}`).get(pc).n;
      return { rows: db.prepare(`SELECT * FROM comm_messages WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all(p).map((r) => msg(r)), total };
    },
    get(actor, id) {
      need(actor, 'comm.log.view', 'see the communication log');
      const r = db.prepare('SELECT * FROM comm_messages WHERE id = ? AND company_id = ?').get(id, actor.companyId);
      if (!r) throw notFound('That message does not exist.');
      const thread = r.conversation_key ? db.prepare('SELECT * FROM comm_messages WHERE company_id = ? AND conversation_key = ? ORDER BY id LIMIT 50').all(actor.companyId, r.conversation_key).map((x) => msg(x)) : [];
      return { ...msg(r), thread };
    },
    summary(actor, q = {}) {
      need(actor, 'comm.log.view', 'see the communication log');
      const p = { c: actor.companyId, from: q.from ? `${q.from}T00:00:00.000Z` : '0000', to: q.to ? `${q.to}T23:59:59.999Z` : '9999' };
      const grid = {};
      for (const ch of ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH']) grid[ch] = { QUEUED: 0, SENDING: 0, SENT: 0, DELIVERED: 0, READ: 0, FAILED: 0, BLOCKED: 0, RECEIVED: 0, CANCELLED: 0, total: 0 };
      for (const r of db.prepare('SELECT channel, status, COUNT(*) AS n FROM comm_messages WHERE company_id = :c AND created_at >= :from AND created_at <= :to GROUP BY channel, status').all(p)) { grid[r.channel][r.status] = r.n; grid[r.channel].total += r.n; }
      const t = { total: 0, failed: 0, blocked: 0, waiting: 0, received: 0 };
      for (const g of Object.values(grid)) { t.total += g.total; t.failed += g.FAILED; t.blocked += g.BLOCKED; t.waiting += g.QUEUED + g.SENDING; t.received += g.RECEIVED; }
      return { grid, totals: t };
    },
    retry(actor, id) {
      need(actor, 'comm.channel.edit', 'send a message again');
      return transaction(db, () => {
        const r = db.prepare('SELECT * FROM comm_messages WHERE id = ? AND company_id = ?').get(id, actor.companyId);
        if (!r) throw notFound('That message does not exist.');
        if (r.status !== 'FAILED') throw unprocessable(`This message is ${r.status.toLowerCase()}, so it is not sent again.`);
        if (!r.payload_json) throw unprocessable('The text of a failed message is not kept; the module that sent it sends it again.');
        db.prepare("UPDATE comm_messages SET status = 'QUEUED', attempts = 0, last_error = NULL, next_attempt_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), actor.user, iso(), id);
        writeAudit(db, { entity: 'comm_messages', entityId: id, action: 'retry', actor: actor.user, companyId: actor.companyId });
        return msg(db.prepare('SELECT * FROM comm_messages WHERE id = ?').get(id));
      });
    },
  };

  // ---- consent (FR-06) ----
  const consent = (r) => ({ id: r.id, contactType: r.contact_type, contactId: r.contact_id, contactName: r.contact_name, address: r.address, channel: r.channel, status: r.status, source: r.source, changedAt: r.changed_at, changedBy: r.changed_by, version: r.version });
  const consents = {
    list(actor, q = {}) {
      need(actor, 'comm.consent.view', 'see the consent register');
      const p = { c: actor.companyId, limit: q.limit ?? 25, offset: q.offset ?? 0 };
      const where = ['company_id = :c', 'is_active = 1'];
      for (const [k, col] of [['channel', 'channel'], ['status', 'status'], ['contactType', 'contact_type'], ['source', 'source']]) if (q[k]) { where.push(`${col} = :${k}`); p[k] = q[k]; }
      if (q.q) { where.push('(address LIKE :q OR contact_name LIKE :q OR contact_id LIKE :q)'); p.q = `%${q.q}%`; }
      const pc = { ...p }; delete pc.limit; delete pc.offset;
      return { rows: db.prepare(`SELECT * FROM comm_consents WHERE ${where.join(' AND ')} ORDER BY changed_at DESC, id DESC LIMIT :limit OFFSET :offset`).all(p).map(consent), total: db.prepare(`SELECT COUNT(*) AS n FROM comm_consents WHERE ${where.join(' AND ')}`).get(pc).n };
    },
    set(actor, b) {
      need(actor, 'comm.consent.edit', 'change consent');
      return consent(comm.setConsent({ companyId: actor.companyId, ...b, source: b.source ?? 'ADMIN', actor: actor.user }));
    },
    import(actor, rows) {
      need(actor, 'comm.consent.edit', 'change consent');
      return transaction(db, () => { for (const r of rows) comm.setConsent({ companyId: actor.companyId, ...r, source: 'IMPORT', actor: actor.user }); return { imported: rows.length }; });
    },
    history(actor, id) {
      need(actor, 'comm.consent.view', 'see the consent register');
      const r = db.prepare('SELECT * FROM comm_consents WHERE id = ? AND company_id = ?').get(id, actor.companyId);
      if (!r) throw notFound('That consent does not exist.');
      return db.prepare("SELECT action, old_values, new_values, actor, created_at FROM core_audit_log WHERE entity = 'comm_consents' AND entity_id = ? ORDER BY id").all(String(id)).map((a) => ({ action: a.action, from: a.old_values ? JSON.parse(a.old_values) : null, to: JSON.parse(a.new_values ?? '{}'), by: a.actor, at: a.created_at }));
    },
  };

  // ---- channel settings (FR-01, FR-02; AC-05) ----
  const presentChannel = (r) => (r ? { id: r.id, channel: r.channel, primaryConnector: r.primary_connector, secondaryConnector: r.secondary_connector, senderId: r.sender_id, dltEntityId: r.dlt_entity_id, ratePerMinute: r.rate_per_minute, enabled: r.enabled === 1, version: r.channel_version, status: r.status, by: r.created_by, reason: r.reason, instanceId: r.instance_id } : null);
  const channels = {
    get(actor) {
      need(actor, 'comm.channel.view', 'see the channel settings');
      const pending = db.prepare("SELECT * FROM comm_channels WHERE company_id = ? AND status = 'PENDING' ORDER BY id").all(actor.companyId);
      const pendingDlt = db.prepare("SELECT * FROM comm_dlt_templates WHERE company_id = ? AND status = 'PENDING' ORDER BY id").all(actor.companyId);
      const connectors = db.prepare("SELECT code, name, type, provider, status, last_health_status AS health FROM core_connectors WHERE company_id = ? AND type IN ('email', 'sms', 'whatsapp') AND is_active = 1 AND deleted_at IS NULL ORDER BY type, code").all(actor.companyId);
      const usage = (ch) => { const r = comm.routeFor(actor.companyId, ch); return { configured: Boolean(r.cfg), connectors: r.connectors }; };
      return {
        channels: ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH'].map((ch) => ({ channel: ch, active: presentChannel(db.prepare("SELECT * FROM comm_channels WHERE company_id = ? AND channel = ? AND status = 'ACTIVE' ORDER BY channel_version DESC LIMIT 1").get(actor.companyId, ch)), pending: presentChannel(pending.find((p) => p.channel === ch)), effective: usage(ch), last24h: db.prepare("SELECT COUNT(*) AS n FROM comm_messages WHERE company_id = ? AND channel = ? AND direction = 'OUT' AND created_at >= ?").get(actor.companyId, ch, iso0(1)).n })),
        connectors,
        dlt: db.prepare("SELECT * FROM comm_dlt_templates WHERE company_id = ? AND status = 'ACTIVE' ORDER BY template_code").all(actor.companyId).map((r) => ({ id: r.id, templateCode: r.template_code, dltTemplateId: r.dlt_template_id, senderId: r.sender_id, bodyPattern: r.body_pattern, version: r.dlt_version })),
        pendingDlt: pendingDlt.map((r) => ({ templateCode: r.template_code, dltTemplateId: r.dlt_template_id, bodyPattern: r.body_pattern })),
        whatsapp: db.prepare('SELECT * FROM comm_wa_templates WHERE company_id = ? AND is_active = 1 ORDER BY name').all(actor.companyId).map((r) => ({ id: r.id, name: r.name, language: r.language, category: r.category, status: r.provider_status, templateCode: r.template_code, syncedAt: r.synced_at })),
        pendingBatch: pending[0] ?? pendingDlt[0] ? { batchId: (pending[0] ?? pendingDlt[0]).batch_id, instanceId: (pending[0] ?? pendingDlt[0]).instance_id, by: (pending[0] ?? pendingDlt[0]).created_by, reason: (pending[0] ?? pendingDlt[0]).reason } : null,
        smsTemplates: db.prepare("SELECT DISTINCT code FROM ntf_templates WHERE channel = 'SMS' AND status = 'ACTIVE' ORDER BY code").all().map((r) => r.code),
        canEdit: may(actor, 'comm.channel.edit'),
      };
    },
    /** A change of the channels or of the DLT templates. It waits for the approval of the system administrator or a director; what is in force is unchanged until then. */
    propose(actor, b) {
      need(actor, 'comm.channel.edit', 'change the channel settings');
      const problems = [];
      const seen = new Set();
      b.channels.forEach((c, i) => {
        const at = `channels.${i}`;
        if (seen.has(c.channel)) problems.push({ field: `${at}.channel`, message: `${c.channel} is given twice.` });
        seen.add(c.channel);
        if (c.channel === 'PUSH' && (c.primaryConnector || c.secondaryConnector)) problems.push({ field: `${at}.primaryConnector`, message: 'Device push does not use a connector.' });
        if (c.primaryConnector && c.primaryConnector === c.secondaryConnector) problems.push({ field: `${at}.secondaryConnector`, message: 'The second connector must be a different one, or the failover would try the same service twice.' });
        if (c.enabled && c.channel !== 'PUSH' && !c.primaryConnector) problems.push({ field: `${at}.primaryConnector`, message: `Choose the connector that sends ${c.channel} first, or switch the channel off.` });
        for (const [f, code] of [['primaryConnector', c.primaryConnector], ['secondaryConnector', c.secondaryConnector]]) {
          if (!code) continue;
          const row = db.prepare('SELECT type FROM core_connectors WHERE company_id = ? AND code = ? AND is_active = 1 AND deleted_at IS NULL').get(actor.companyId, code);
          if (!row) problems.push({ field: `${at}.${f}`, message: `There is no connector "${code}". Set it up under Connectors first.` });
          else if (row.type !== CHANNEL_TYPE[c.channel]) problems.push({ field: `${at}.${f}`, message: `"${code}" is a ${row.type} connector, not a ${CHANNEL_TYPE[c.channel] ?? 'push'} one.` });
        }
        if (c.channel === 'SMS' && c.enabled && !c.senderId) problems.push({ field: `${at}.senderId`, message: 'A text-message channel needs its registered sender ID (the header, six letters).' });
      });
      b.dltTemplates.forEach((t, i) => {
        if (!db.prepare("SELECT 1 FROM ntf_templates WHERE code = ? AND channel = 'SMS' AND status = 'ACTIVE' LIMIT 1").get(t.templateCode)) problems.push({ field: `dltTemplates.${i}.templateCode`, message: `${t.templateCode} has no text-message template to register.` });
      });
      if (problems.length) throw badRequest('The channel settings are not valid.', problems);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM comm_channels WHERE company_id = ? AND status = 'PENDING' UNION SELECT 1 FROM comm_dlt_templates WHERE company_id = ? AND status = 'PENDING' LIMIT 1").get(actor.companyId, actor.companyId)) throw conflict('A change of the channel settings is already waiting for approval. It must be decided first.');
        const batch = Number(db.prepare('SELECT MAX(b) + 1 AS n FROM (SELECT COALESCE(MAX(batch_id), 0) AS b FROM comm_channels UNION ALL SELECT COALESCE(MAX(batch_id), 0) FROM comm_dlt_templates)').get().n);
        for (const c of b.channels) {
          const v = (db.prepare('SELECT MAX(channel_version) AS v FROM comm_channels WHERE company_id = ? AND channel = ?').get(actor.companyId, c.channel).v ?? 0) + 1;
          db.prepare(`INSERT INTO comm_channels (company_id, channel, primary_connector, secondary_connector, sender_id, dlt_entity_id, rate_per_minute, enabled, channel_version, status, batch_id, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'channel_change')`)
            .run(actor.companyId, c.channel, c.primaryConnector ?? null, c.secondaryConnector ?? null, c.senderId ?? null, c.dltEntityId ?? null, c.ratePerMinute, c.enabled ? 1 : 0, v, batch, b.reason, actor.user);
        }
        for (const t of b.dltTemplates) {
          const v = (db.prepare('SELECT MAX(dlt_version) AS v FROM comm_dlt_templates WHERE company_id = ? AND template_code = ?').get(actor.companyId, t.templateCode).v ?? 0) + 1;
          db.prepare(`INSERT INTO comm_dlt_templates (company_id, template_code, dlt_template_id, sender_id, body_pattern, dlt_version, status, batch_id, reason, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, 'channel_change')`)
            .run(actor.companyId, t.templateCode, t.dltTemplateId, t.senderId ?? null, t.bodyPattern, v, batch, b.reason, actor.user);
        }
        writeAudit(db, { entity: 'comm_channels', entityId: batch, action: 'propose', newValues: { channels: b.channels.map((c) => c.channel), dltTemplates: b.dltTemplates.map((t) => t.templateCode) }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        const instance = engine.submit(actor, { docType: COMM_DOC, docId: batch, comment: b.reason, context: {} });
        db.prepare('UPDATE comm_channels SET instance_id = ? WHERE batch_id = ?').run(instance.id, batch);
        db.prepare('UPDATE comm_dlt_templates SET reason = reason WHERE batch_id = ?').run(batch);
        return { batch, workflow: instance };
      });
    },
    /** A sample message to an address the administrator names, through the route of the channel (first connector, then the second): status tracking starts at once. */
    async sample(actor, { channel, to }) {
      need(actor, 'comm.channel.edit', 'send a sample message');
      const r = await comm.sendNow({ companyId: actor.companyId, channel, to, templateCode: 'ntf.test', data: { link: '/notifications' }, purpose: 'TRANSACTIONAL', essential: true, priority: 2, actor: actor.user, related: { entity: 'channel_sample', id: channel }, source: { type: 'sample', id: actor.user } });
      return msg(r.row ?? db.prepare('SELECT * FROM comm_messages WHERE id = ?').get(r.id));
    },
    /** The WhatsApp templates the provider has approved, read through the first WhatsApp connector, and matched to the notification templates by name. */
    async syncWhatsapp(actor) {
      need(actor, 'comm.channel.edit', 'sync the WhatsApp templates');
      const route = comm.routeFor(actor.companyId, 'WHATSAPP');
      if (!route.connectors.length) throw unprocessable('No WhatsApp connector is set up. Choose one in Channel Settings first.');
      const out = await integrationsOf(db).hub.call(route.connectors[0], 'templates', {}, { companyId: actor.companyId, actor });
      const known = new Set(db.prepare("SELECT DISTINCT code FROM ntf_templates WHERE channel = 'WHATSAPP' AND status = 'ACTIVE'").all().map((r) => r.code));
      return transaction(db, () => {
        let n = 0;
        for (const t of out.data?.templates ?? []) {
          const code = [...known].find((k) => k.replace(/\./g, '_') === t.name) ?? null;
          const vars = code ? JSON.parse(db.prepare("SELECT variables_json FROM ntf_templates WHERE code = ? AND channel = 'WHATSAPP' LIMIT 1").get(code).variables_json) : [];
          const status = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED'].includes(String(t.status).toUpperCase()) ? String(t.status).toUpperCase() : 'PENDING';
          const old = db.prepare('SELECT id FROM comm_wa_templates WHERE company_id = ? AND name = ? AND language = ?').get(actor.companyId, t.name, t.language ?? 'en');
          if (old) db.prepare('UPDATE comm_wa_templates SET provider_status = ?, category = ?, template_code = ?, variables_json = ?, synced_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, t.category ?? 'UTILITY', code, JSON.stringify(vars), iso(), actor.user, iso(), old.id);
          else db.prepare("INSERT INTO comm_wa_templates (company_id, name, language, category, provider_status, template_code, variables_json, synced_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sync')").run(actor.companyId, t.name, t.language ?? 'en', t.category ?? 'UTILITY', status, code, JSON.stringify(vars), iso(), actor.user);
          n += 1;
        }
        writeAudit(db, { entity: 'comm_wa_templates', entityId: 'sync', action: 'sync', newValues: { templates: n, connector: route.connectors[0] }, actor: actor.user, companyId: actor.companyId });
        return { synced: n };
      });
    },
  };
  function iso0(days) { return new Date(engine.clock().getTime() - days * 86_400_000).toISOString(); }

  // ---- one-time codes for the signed-in person (FR-03) ----
  const ownAddress = (actor, channel) => {
    const u = db.prepare('SELECT email, mobile FROM iam_users WHERE username = ? AND is_active = 1').get(actor.user);
    return channel === 'EMAIL' ? u?.email : u?.mobile;
  };
  const otps = {
    async send(actor, { purpose, channel }) {
      const address = ownAddress(actor, channel);
      if (!address) throw unprocessable(`Your account has no ${channel === 'EMAIL' ? 'e-mail address' : 'mobile number'} to send a code to. Add it to your profile first.`);
      const r = await comm.otp.send({ companyId: actor.companyId, purpose, channel, address, userRef: actor.user, subjectRef: `${purpose}:${actor.user}`, actor: actor.user });
      if (r.ok === false && r.reason === 'TOO_SOON') throw new HttpError(429, 'RATE_LIMITED', r.message);
      if (r.ok === false && r.reason === 'LIMIT') throw new HttpError(429, 'RATE_LIMITED', r.message);
      return { otpId: r.otpId, expiresAt: r.expiresAt, sent: r.delivered, ...(r.delivered ? {} : { message: r.message }) };
    },
    verify(actor, { otpId, code }) {
      const row = db.prepare('SELECT * FROM comm_otps WHERE id = ? AND company_id = ? AND user_ref = ?').get(otpId, actor.companyId, actor.user);
      if (!row) throw notFound('That code was not sent to you.');
      return comm.otp.verify({ companyId: actor.companyId, otpId, code, actor: actor.user });
    },
  };

  return { messages, consents, channels, otps, comm };
}

/** What the providers tell us by webhook, and the receipts for the notification engine's own deliveries. */
export function webhookConsumer(db) {
  const comm = commOf(db);
  return (event) => {
    const t = event.data.type;
    if (!['email', 'sms', 'whatsapp'].includes(t) || !event.companyId) return;
    comm.handleWebhook({ companyId: event.companyId, connectorCode: event.data.connector, type: t, payload: event.data.payload });
  };
}
/** The notification engine's delivery log follows what the gateway learns about its messages (each module writes only its own table). */
export function deliveryReceiptConsumer(db) {
  return (event) => {
    if (event.data.sourceType !== 'ntf_delivery' || !event.data.sourceId) return;
    const status = event.type === 'comm.message.failed' ? 'FAILED' : 'DELIVERED';
    db.prepare(`UPDATE ntf_deliveries SET status = ?, ${status === 'DELIVERED' ? 'delivered_at = ?, last_error = NULL' : 'last_error = ?'}, updated_at = ?, version = version + 1 WHERE id = ? AND company_id = ? AND status IN ('SENT', 'DELIVERED', 'PENDING')`)
      .run(status, status === 'DELIVERED' ? iso() : (event.data.error ?? 'The provider reported a failure'), iso(), Number(event.data.sourceId), event.companyId);
  };
}
