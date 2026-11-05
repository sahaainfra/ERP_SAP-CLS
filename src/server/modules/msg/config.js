import { z } from 'zod';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { badRequest, conflict, forbidden } from '../../platform/http/errors.js';
import { evidenceProviders, workflowTypes } from '../../platform/workflow/index.js';
import { parse } from '../../platform/validation/index.js';
import { todayIST } from '../../../shared/dates.js';

// The messaging settings of a company (part 05.02, section 7.3): the windows for editing and deleting, how long things are kept, the limits on files, the policy of read receipts and the call provider. A change is a
// new version that waits for a second person (the workflow type MSG_CONFIG) and is in force from the date chosen; the history of versions stays. Calls are never recorded here (BR-02): the recording setting is fixed at OFF.
export const MSG_CONFIG_DOC = 'MSG_CONFIG';
export const DEFAULTS = Object.freeze({
  editWindowMinutes: 15, deleteWindowMinutes: 15, deletedContentRetentionDays: 30, retentionDays: 0, maxFileMb: 25, maxVideoMb: 50, maxVoiceSeconds: 300,
  enforceReadReceipts: false, callsEnabled: true, callProvider: 'WEBRTC', providerBaseUrl: '', stunUrls: [], turnUrls: [], turnSecret: '', turnTtlSeconds: 3600, maxCallParticipants: 4, recording: 'OFF',
});
const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const url = z.string().trim().max(300).regex(/^(https?|stun|stuns|turn|turns):[^\s]+$/, 'Use a full address such as turn:turn.example.com:3478');
export const parseMsgConfig = (b) => parse(z.object({
  editWindowMinutes: z.number().int().min(0).max(1440), deleteWindowMinutes: z.number().int().min(0).max(1440), deletedContentRetentionDays: z.number().int().min(0).max(3650), retentionDays: z.number().int().min(0).max(36500),
  maxFileMb: z.number().int().min(1).max(100), maxVideoMb: z.number().int().min(1).max(500), maxVoiceSeconds: z.number().int().min(10).max(1800), enforceReadReceipts: z.boolean(), callsEnabled: z.boolean(),
  callProvider: z.enum(['WEBRTC', 'EXTERNAL']), providerBaseUrl: z.string().trim().max(300).regex(/^(https:\/\/[^\s]+)?$/, 'Use an https:// address').default(''), stunUrls: z.array(url).max(5).default([]), turnUrls: z.array(url).max(5).default([]),
  turnSecret: z.string().max(200).default(''), turnTtlSeconds: z.number().int().min(60).max(86_400).default(3600), maxCallParticipants: z.number().int().min(2).max(8), recording: z.literal('OFF', 'Calls are never recorded').default('OFF'),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date such as 2026-11-04'), reason: z.string().trim().min(5, 'Say why (at least 5 characters)').max(500),
}).strict().refine((o) => o.callProvider !== 'EXTERNAL' || o.providerBaseUrl, { message: 'An external provider needs its https:// address', path: ['providerBaseUrl'] }), b);

/** The settings in force for a company today. A change with a date in the future is made current when its day comes. */
export function activeConfig(db, companyId) {
  const today = todayIST();
  const due = db.prepare("SELECT * FROM msg_config WHERE company_id = ? AND status = 'SCHEDULED' AND is_active = 1 AND effective_from <= ? ORDER BY config_version").all(companyId, today);
  for (const r of due) {
    db.prepare("UPDATE msg_config SET status = 'RETIRED', updated_at = ?, version = version + 1 WHERE company_id = ? AND status = 'ACTIVE'").run(new Date().toISOString(), companyId);
    db.prepare("UPDATE msg_config SET status = 'ACTIVE', updated_at = ?, version = version + 1 WHERE id = ?").run(new Date().toISOString(), r.id);
  }
  const r = db.prepare("SELECT * FROM msg_config WHERE company_id = ? AND status = 'ACTIVE' AND is_active = 1").get(companyId);
  return r ? { ...DEFAULTS, ...JSON.parse(r.config_json), version: r.config_version, effectiveFrom: r.effective_from } : { ...DEFAULTS, version: 0, effectiveFrom: null };
}
const masked = (c) => ({ ...c, turnSecret: c.turnSecret ? '••••••' : '' });

export function createMsgConfigService({ db, engine }) {
  const authz = authzOf(db);
  const may = (actor, key) => authz.check(actor, key, { companyId: actor.companyId }).allowed;
  const anywhere = (actor, key) => authz.check(actor, key).allowed;
  const rowView = (r) => ({ id: r.id, version: r.config_version, status: r.status, effectiveFrom: r.effective_from, reason: r.reason, by: r.created_by, at: r.created_at, instanceId: r.instance_id, config: masked({ ...DEFAULTS, ...JSON.parse(r.config_json) }) });
  return {
    get(actor) {
      if (!anywhere(actor, 'msg.settings.view')) throw forbidden('You may not see the messaging settings (permission msg.settings.view).');
      const history = db.prepare('SELECT * FROM msg_config WHERE company_id = ? AND is_active = 1 ORDER BY config_version DESC LIMIT 50').all(actor.companyId).map(rowView);
      return { config: masked(activeConfig(db, actor.companyId)), pending: history.find((h) => h.status === 'PENDING') ?? null, history, canEdit: may(actor, 'msg.settings.edit'), defaults: masked({ ...DEFAULTS }) };
    },
    propose(actor, b) {
      if (!may(actor, 'msg.settings.edit')) throw forbidden('You may not change the messaging settings (permission msg.settings.edit).');
      if (b.effectiveFrom < todayIST()) throw badRequest('The date cannot be in the past.', [{ field: 'effectiveFrom', message: 'choose today or a later date' }]);
      const { reason, effectiveFrom, ...value } = b;
      const current = activeConfig(db, actor.companyId);
      if (value.turnSecret === '••••••' || (value.turnSecret === '' && current.turnSecret)) value.turnSecret = current.turnSecret; // an unchanged secret is kept, never shown
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM msg_config WHERE company_id = ? AND status = 'PENDING' AND is_active = 1").get(actor.companyId)) throw conflict('A change of the messaging settings is already waiting for approval. It must be decided first.');
        const v = (db.prepare('SELECT MAX(config_version) AS v FROM msg_config WHERE company_id = ?').get(actor.companyId).v ?? 0) + 1;
        const id = Number(db.prepare("INSERT INTO msg_config (company_id, config_json, config_version, status, effective_from, reason, created_by, source_type) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, 'config_change')").run(actor.companyId, JSON.stringify(value), v, effectiveFrom, reason, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'msg_config', entityId: id, action: 'propose', oldValues: masked(current), newValues: masked({ ...DEFAULTS, ...value }), actor: actor.user, companyId: actor.companyId, reason });
        const instance = engine.submit(actor, { docType: MSG_CONFIG_DOC, docId: id, comment: reason, context: {} });
        db.prepare('UPDATE msg_config SET instance_id = ? WHERE id = ?').run(instance.id, id);
        return { id, version: v, workflow: instance };
      });
    },
    activate(instance, actor) {
      const r = db.prepare('SELECT * FROM msg_config WHERE id = ?').get(Number(instance.docId));
      if (!r) return;
      const now = new Date().toISOString();
      if (r.effective_from <= todayIST()) {
        db.prepare("UPDATE msg_config SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND status = 'ACTIVE'").run(actor.user, now, r.company_id);
        db.prepare("UPDATE msg_config SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
      } else db.prepare("UPDATE msg_config SET status = 'SCHEDULED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
      writeAudit(db, { entity: 'msg_config', entityId: r.id, action: 'approve', newValues: { version: r.config_version, effectiveFrom: r.effective_from }, actor: actor.user, companyId: r.company_id });
    },
    reject(instance, actor) { db.prepare("UPDATE msg_config SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'PENDING'").run(actor.user, new Date().toISOString(), Number(instance.docId)); },
    /** The settings as a file to keep or to compare (secrets are not in it). */
    export(actor) {
      if (!anywhere(actor, 'msg.settings.view')) throw forbidden('You may not see the messaging settings (permission msg.settings.view).');
      return { fileName: 'messaging-settings.json', text: JSON.stringify({ exportedAt: new Date().toISOString(), config: masked(activeConfig(db, actor.companyId)) }, null, 2) };
    },
  };
}

const services = new WeakMap();
export const bindConfig = (db, s) => services.set(db, s);
const bound = (db) => services.get(db);
workflowTypes.register({
  docType: MSG_CONFIG_DOC,
  label: 'Messaging settings change',
  processOwner: 'SYSADM',
  route: () => '/admin/messaging',
  describe(db, companyId, id) {
    const r = db.prepare('SELECT * FROM msg_config WHERE id = ? AND company_id = ?').get(Number(id), companyId);
    return r ? { ref: `Messaging settings version ${r.config_version}`, title: 'Change of the messaging windows, limits, retention and call provider', originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const r = db.prepare('SELECT * FROM msg_config WHERE id = ?').get(Number(id));
    if (!r) return null;
    const c = { ...DEFAULTS, ...JSON.parse(r.config_json) };
    return { fields: [{ label: 'Edit window (minutes)', value: c.editWindowMinutes }, { label: 'Delete for everyone window (minutes)', value: c.deleteWindowMinutes }, { label: 'Retention of messages (days, 0 = keep)', value: c.retentionDays }, { label: 'Call provider', value: c.callProvider }, { label: 'In force from', value: r.effective_from }, { label: 'Reason', value: r.reason ?? '' }] };
  },
  defaultDefinition: { name: 'Messaging settings approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('CHECK', 'System administrator or director', 'SYSADM|DIR')] },
  hooks: {
    onApproved: (db, { instance, actor }) => bound(db)?.activate(instance, actor),
    onRejected: (db, { instance, actor }) => bound(db)?.reject(instance, actor),
    onReturned: (db, { instance, actor }) => bound(db)?.reject(instance, actor),
    onCancelled: (db, { instance, actor }) => bound(db)?.reject(instance, actor),
  },
});
evidenceProviders.register(MSG_CONFIG_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM msg_config WHERE id = ?').get(Number(instance.docId));
  if (!r) return { sections: [] };
  const was = activeConfig(db, r.company_id);
  const now = { ...DEFAULTS, ...JSON.parse(r.config_json) };
  const changed = Object.keys(DEFAULTS).filter((k) => JSON.stringify(was[k]) !== JSON.stringify(now[k]) && k !== 'turnSecret');
  return { sections: [{ code: 'config', title: 'What changes', kind: 'metrics', items: [{ label: 'Settings changed', value: changed.join(', ') || 'none', format: 'text' }, { label: 'Read receipts enforced', value: now.enforceReadReceipts ? 'Yes' : 'No', format: 'text', tone: now.enforceReadReceipts && !was.enforceReadReceipts ? 'warn' : undefined }, { label: 'Retention (days)', value: now.retentionDays === 0 ? 'keep' : now.retentionDays, format: 'text' }] }], flags: [] };
});
