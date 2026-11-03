import { inTransaction as transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { CATEGORIES, CHANNELS, DEFAULT_CHANNELS, MANDATORY, notificationsOf, render, variablesOf } from '../../platform/notify/index.js';
import { realtimeOf, realtimeRecords } from '../../platform/realtime/index.js';
import { unpackSteps, workflowOf, workflowTypes } from '../../platform/workflow/index.js';

// The notification engine's module side (part 04.06): what turns events into notifications, what the notification centre, the preferences, the templates and the delivery log
// do, and what lets a screen follow a record in real time. The sending itself is platform/notify; the sockets are platform/realtime.
export const TEMPLATE_DOC = 'NTF_TEMPLATE';
const iso = () => new Date().toISOString();
const SAMPLE = { docLabel: 'Purchase order', docRef: 'PO-0001', docTitle: 'Cement for the podium', step: 'Project manager', actor: 'anil.pd', dueAt: '05-Nov-2026 15:00', comment: 'Please check the rate.', link: '/approvals/task?id=1', level: '1', control: 'CP-ENG-01', count: '3', items: '- Approval needed: PO-0001\n- Reminder: PO-0002\n- Approved: PO-0003', title: 'A short title', message: 'The message of the notification.' };
const istText = (isoText) => { if (!isoText) return ''; const d = new Date(Date.parse(isoText) + 5.5 * 3_600_000); return `${String(d.getUTCDate()).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]}-${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const maskAddress = (a, channel) => (!a ? null : channel === 'EMAIL' ? a.replace(/^(.).*(@.*)$/, '$1***$2') : channel === 'IN_APP' || channel === 'PUSH' ? a : `******${a.slice(-4)}`);

// ---- the records a screen may follow in real time ----
export function registerRealtimeRecords(db) {
  const authz = authzOf(db);
  const engine = workflowOf(db);
  realtimeRecords.register('sample_doc', {
    resolve: (d, id) => { const r = d.prepare('SELECT company_id, project_id, site_id FROM eng_sample_docs WHERE id = ?').get(Number(id)); return r && { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id }; },
    check: (d, actor, id) => { const r = d.prepare('SELECT company_id, project_id, site_id FROM eng_sample_docs WHERE id = ?').get(Number(id)); return Boolean(r) && authz.check(actor, 'eng.sample.use', { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id }).allowed; },
  });
  realtimeRecords.register('workflow_instance', {
    resolve: (d, id) => { const r = d.prepare('SELECT company_id, project_id, site_id FROM wf_instances WHERE id = ?').get(Number(id)); return r && { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id }; },
    check: (_d, actor, id) => { try { engine.get(actor, Number(id)); return true; } catch { return false; } },
  });
  realtimeRecords.register('pcs_exception', {
    resolve: (d, id) => { const r = d.prepare('SELECT company_id, project_id, site_id FROM pcs_exceptions WHERE id = ?').get(Number(id)); return r && { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id }; },
    check: (d, actor, id) => { const r = d.prepare('SELECT company_id, project_id, site_id, raised_by FROM pcs_exceptions WHERE id = ?').get(Number(id)); return Boolean(r) && (r.raised_by === actor.user || authz.check(actor, 'eng.pcs.view', { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id }).allowed); },
  });
}

/** The events whose change a screen follows: each is told, by its ids only, to the record's room and to the room of its project and site. */
export const REALTIME_PATTERNS = ['workflow.instance.*', 'workflow.task.*', 'eng.sample_doc.*', 'pcs.exception.*', 'acc.raci.*'];
export function realtimeConsumer(db) {
  const hub = realtimeOf(db);
  const ENTITY = { sample_doc: 'sample_doc', workflow_instance: 'workflow_instance', pcs_exception: 'pcs_exception' };
  return (event) => {
    if (!event.companyId || !event.entity || !ENTITY[event.entity]) return;
    const rooms = [`record:${event.entity}:${event.entityId}`];
    if (event.projectId) rooms.push(`project:${event.projectId}`);
    if (event.siteId) rooms.push(`site:${event.siteId}`);
    hub.publish({ companyId: event.companyId, rooms, type: event.type, entity: event.entity, entityId: event.entityId, data: { eventId: event.eventId }, projectId: event.projectId ?? null, siteId: event.siteId ?? null });
  };
}

/** What the workflow tells (a task for you, a reminder, an escalation, a decision) becomes notifications with a link to the work. */
export function workflowNotificationConsumer(db) {
  const n = notificationsOf(db);
  return (event) => {
    const inst = db.prepare('SELECT * FROM wf_instances WHERE id = ?').get(Number(event.data.instanceId));
    if (!inst) return;
    let template = event.data.template;
    let recipients = event.data.recipients ?? [];
    if (event.type === 'workflow.instance.approved' || event.type === 'workflow.instance.rejected') { template = event.type; recipients = [`user:${inst.submitted_by}`]; }
    if (!template) return;
    const task = event.data.taskId ? db.prepare('SELECT * FROM wf_tasks WHERE id = ?').get(Number(event.data.taskId)) : null;
    const stepCode = task?.step_code ?? inst.current_step;
    const step = unpackSteps(inst.steps_json).steps.find((s) => s.code === stepCode)?.name ?? stepCode ?? '';
    const comment = event.data.comment ?? db.prepare('SELECT comment FROM wf_history WHERE instance_id = ? AND comment IS NOT NULL ORDER BY id DESC LIMIT 1').get(inst.id)?.comment ?? '';
    const control = inst.doc_type === 'PCS_EXCEPTION' ? db.prepare('SELECT control_code FROM pcs_exceptions WHERE id = ?').get(Number(inst.doc_id))?.control_code ?? '' : '';
    const data = { docLabel: workflowTypes.get(inst.doc_type)?.label ?? inst.doc_type, docRef: inst.doc_ref ?? inst.doc_id, docTitle: inst.title ?? '', step, actor: event.actorId === 'system' || !event.actorId ? 'The system' : event.actorId, dueAt: istText(task?.due_at), comment, level: event.data.level ?? '', control };
    const link = task && /task\.(assigned|reminder|escalated)$/.test(template) ? `/approvals/task?id=${task.id}` : `/workflow/instance?id=${inst.id}`;
    n.notify({ companyId: event.companyId ?? inst.company_id, templateCode: template, recipients, data, link, priority: /escalated|unassigned/.test(template) ? 'HIGH' : 'NORMAL', projectId: inst.project_id, siteId: inst.site_id, sourceType: 'event', sourceId: event.eventId, actor: event.actorId ?? 'system', refs: { instanceId: inst.id } });
  };
}

// ---- the approval of a template change ----
const stepOf = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
function activateTemplates(db, batch, actor) {
  const rows = db.prepare("SELECT * FROM ntf_templates WHERE source_type = 'template_change' AND source_id = ? AND status = 'PENDING'").all(String(batch));
  for (const r of rows) {
    db.prepare("UPDATE ntf_templates SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id IS ? AND code = ? AND channel = ? AND lang = ? AND status = 'ACTIVE'").run(actor.user, iso(), r.company_id, r.code, r.channel, r.lang);
    db.prepare("UPDATE ntf_templates SET status = 'ACTIVE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, iso(), r.id);
  }
  if (rows[0]) {
    writeAudit(db, { entity: 'ntf_templates', entityId: batch, action: 'activate', newValues: { code: rows[0].code, versions: rows.map((r) => `${r.channel}/${r.lang} v${r.template_version}`) }, actor: actor.user, companyId: rows[0].company_id, reason: rows[0].reason });
    publishEvent(db, { type: 'ntf.template.changed', entity: 'ntf_template', entityId: batch, actorId: actor.user, companyId: rows[0].company_id, data: { code: rows[0].code, versions: rows.length } });
  }
}
const rejectTemplates = (db, batch, actor) => db.prepare("UPDATE ntf_templates SET status = 'REJECTED', updated_by = ?, updated_at = ?, version = version + 1 WHERE source_type = 'template_change' AND source_id = ? AND status = 'PENDING'").run(actor.user, iso(), String(batch));
workflowTypes.register({
  docType: TEMPLATE_DOC,
  label: 'Notification template change',
  processOwner: 'ITADM',
  route: () => '/admin/notification-templates',
  describe(db, companyId, id) {
    const r = db.prepare("SELECT * FROM ntf_templates WHERE source_type = 'template_change' AND source_id = ? AND company_id = ? LIMIT 1").get(String(id), companyId);
    return r ? { ref: `${r.code} v${r.template_version}`, title: `Change of the words of ${r.code}`, originator: r.created_by } : null;
  },
  summarise(db, actor, id) {
    const rows = db.prepare("SELECT * FROM ntf_templates WHERE source_type = 'template_change' AND source_id = ? ORDER BY channel, lang").all(String(id));
    if (!rows.length) return null;
    return {
      fields: [{ label: 'Template', value: rows[0].code }, { label: 'Version', value: rows[0].template_version }, { label: 'Changed texts', value: rows.length }, { label: 'Reason', value: rows[0].reason ?? '' }, { label: 'Proposed by', value: rows[0].created_by }],
      lines: { columns: [{ key: 'channel', label: 'Channel' }, { key: 'lang', label: 'Language' }, { key: 'subject', label: 'Subject' }, { key: 'body', label: 'Text' }], rows: rows.map((r) => ({ channel: r.channel, lang: r.lang, subject: r.subject, body: r.body })) },
    };
  },
  defaultDefinition: { name: 'Notification template approval', settings: { resubmit: 'first', distinctApprovers: true }, steps: [stepOf('ITADM', 'IT administrator', 'ITADM')] },
  hooks: {
    onApproved: (db, { instance, actor }) => activateTemplates(db, instance.docId, actor),
    onRejected: (db, { instance, actor }) => rejectTemplates(db, instance.docId, actor),
    onReturned: (db, { instance, actor }) => rejectTemplates(db, instance.docId, actor),
    onCancelled: (db, { instance, actor }) => rejectTemplates(db, instance.docId, actor),
  },
});

export function createNotificationService({ db, engine }) {
  const authz = authzOf(db);
  const n = notificationsOf(db);
  const hub = realtimeOf(db);
  const may = (actor, key) => authz.check(actor, key, { companyId: actor.companyId }).allowed;
  const need = (actor, key, what) => { if (!may(actor, key)) throw forbidden(`You may not ${what} (permission ${key}).`); };

  // ---- the centre ----
  const present = (r) => ({ id: r.id, title: r.title, body: r.body, link: r.link, category: r.category, priority: r.priority, read: r.read_at != null, archived: r.archived_at != null, at: r.created_at, templateCode: r.template_code });
  const mine = (actor, id) => {
    const r = db.prepare('SELECT * FROM ntf_notifications WHERE id = ? AND company_id = ? AND user_ref = ? AND in_app = 1 AND is_active = 1').get(id, actor.companyId, actor.user);
    if (!r) throw notFound('That notification does not exist.');
    return r;
  };
  const centre = {
    list(actor, q = {}) {
      const p = { c: actor.companyId, u: actor.user, limit: q.limit ?? 25, offset: q.offset ?? 0 };
      const where = ['company_id = :c', 'user_ref = :u', 'in_app = 1', 'is_active = 1'];
      const state = q.state ?? 'inbox';
      if (state === 'archived') where.push('archived_at IS NOT NULL'); else where.push('archived_at IS NULL');
      if (state === 'unread') where.push('read_at IS NULL');
      if (q.category) { where.push('category = :cat'); p.cat = q.category; }
      if (q.q) { where.push('(title LIKE :q OR body LIKE :q)'); p.q = `%${q.q}%`; }
      const pc = { ...p }; delete pc.limit; delete pc.offset;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM ntf_notifications WHERE ${where.join(' AND ')}`).get(pc).n;
      const rows = db.prepare(`SELECT * FROM ntf_notifications WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all(p).map(present);
      return { rows, total, counts: centre.counts(actor) };
    },
    counts(actor) {
      const by = db.prepare('SELECT category, COUNT(*) AS n FROM ntf_notifications WHERE company_id = ? AND user_ref = ? AND in_app = 1 AND is_active = 1 AND read_at IS NULL AND archived_at IS NULL GROUP BY category').all(actor.companyId, actor.user);
      return { unread: by.reduce((t, r) => t + r.n, 0), byCategory: Object.fromEntries(by.map((r) => [r.category, r.n])) };
    },
    mark(actor, id, read) {
      const r = mine(actor, id);
      db.prepare('UPDATE ntf_notifications SET read_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(read ? iso() : null, actor.user, iso(), r.id);
      hub.publish({ companyId: actor.companyId, rooms: [`user:${actor.user}`], type: 'notification.changed', entity: 'notification', entityId: r.id, data: {} });
      return present(db.prepare('SELECT * FROM ntf_notifications WHERE id = ?').get(r.id));
    },
    archive(actor, id, archived) {
      const r = mine(actor, id);
      db.prepare('UPDATE ntf_notifications SET archived_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(archived ? iso() : null, actor.user, iso(), r.id);
      hub.publish({ companyId: actor.companyId, rooms: [`user:${actor.user}`], type: 'notification.changed', entity: 'notification', entityId: r.id, data: {} });
      return present(db.prepare('SELECT * FROM ntf_notifications WHERE id = ?').get(r.id));
    },
    readAll(actor, /** @type {any} */ { category } = {}) {
      return transaction(db, () => {
        const res = db.prepare(`UPDATE ntf_notifications SET read_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND user_ref = ? AND in_app = 1 AND read_at IS NULL AND archived_at IS NULL ${category ? 'AND category = ?' : ''}`).run(iso(), actor.user, iso(), actor.companyId, actor.user, ...(category ? [category] : []));
        if (Number(res.changes)) hub.publish({ companyId: actor.companyId, rooms: [`user:${actor.user}`], type: 'notification.changed', entity: 'notification', entityId: 0, data: {} });
        return { marked: Number(res.changes), counts: centre.counts(actor) };
      });
    },
    /** A test to the person's own channels: what they would get, in their language, through their choices. */
    test(actor) {
      return n.notify({ companyId: actor.companyId, templateCode: 'ntf.test', recipients: [`user:${actor.user}`], data: {}, link: '/notifications/preferences', eventKey: `test:${actor.user}:${Date.now()}`, actor: actor.user, priority: 'NORMAL' });
    },
  };

  // ---- preferences (FR-05) ----
  const preferences = {
    get(actor) {
      const p = n.preferencesOf(actor.companyId, actor.user);
      return { categories: p.categories, defaults: DEFAULT_CHANNELS, mandatory: MANDATORY, digest: p.digest, quietHours: p.quietHours, language: n.languageOf(actor.companyId, actor.user), version: p.version, channels: CHANNELS, categoryList: CATEGORIES };
    },
    save(actor, b) {
      return transaction(db, () => {
        const cur = n.preferencesOf(actor.companyId, actor.user);
        if (b.version !== undefined && cur.version !== null && b.version !== cur.version) throw conflict('Your preferences were changed on another screen. Reload them and try again.');
        const problems = [];
        for (const [cat, ch] of Object.entries(b.categories ?? {})) {
          if (MANDATORY.includes(cat) && (ch.IN_APP === false || ch.EMAIL === false)) problems.push({ field: `categories.${cat}`, message: `${cat[0].toUpperCase()}${cat.slice(1)} notifications always reach you in the centre and by e-mail; they cannot be turned off.` });
        }
        if (problems.length) throw unprocessable('Some choices cannot be made.', problems);
        const put = (category, channels, digest, quiet) => {
          const row = db.prepare('SELECT id FROM ntf_preferences WHERE company_id = ? AND user_ref = ? AND category = ?').get(actor.companyId, actor.user, category);
          if (row) db.prepare('UPDATE ntf_preferences SET channels_json = ?, digest = ?, quiet_hours_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(channels), digest, quiet ? JSON.stringify(quiet) : null, actor.user, iso(), row.id);
          else db.prepare("INSERT INTO ntf_preferences (company_id, user_ref, category, channels_json, digest, quiet_hours_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'preferences')").run(actor.companyId, actor.user, category, JSON.stringify(channels), digest, quiet ? JSON.stringify(quiet) : null, actor.user);
        };
        for (const [cat, ch] of Object.entries(b.categories ?? {})) put(cat, ch, 'INSTANT', null);
        put('ALL', {}, b.digest ?? cur.digest, b.quietHours === undefined ? cur.quietHours : b.quietHours);
        writeAudit(db, { entity: 'ntf_preferences', entityId: actor.user, action: 'update', oldValues: { digest: cur.digest, quietHours: cur.quietHours }, newValues: { digest: b.digest ?? cur.digest, quietHours: b.quietHours === undefined ? cur.quietHours : b.quietHours, categories: Object.keys(b.categories ?? {}) }, actor: actor.user, companyId: actor.companyId });
        return preferences.get(actor);
      });
    },
  };

  // ---- templates (FR-03, AC-05) ----
  const entry = (r) => ({ id: r.id, channel: r.channel, lang: r.lang, subject: r.subject, body: r.body, version: r.template_version, status: r.status, scope: r.company_id == null ? 'shared' : 'company', variables: JSON.parse(r.variables_json || '[]'), reason: r.reason, by: r.created_by });
  const templates = {
    list(actor, /** @type {any} */ q = {}) {
      need(actor, 'ntf.template.view', 'see the notification templates');
      const rows = db.prepare("SELECT code, category, MAX(template_version) AS v, COUNT(*) AS n, SUM(CASE WHEN company_id IS NOT NULL THEN 1 ELSE 0 END) AS own FROM ntf_templates WHERE status = 'ACTIVE' AND (company_id IS NULL OR company_id = ?) AND is_active = 1 GROUP BY code, category ORDER BY code").all(actor.companyId)
        .filter((r) => (!q.category || r.category === q.category) && (!q.q || r.code.includes(q.q)));
      const pending = new Set(db.prepare("SELECT DISTINCT code FROM ntf_templates WHERE status = 'PENDING' AND company_id = ?").all(actor.companyId).map((r) => r.code));
      return { rows: rows.map((r) => ({ code: r.code, category: r.category, version: r.v, texts: r.n, changedHere: r.own > 0, pending: pending.has(r.code) })), total: rows.length };
    },
    get(actor, code) {
      need(actor, 'ntf.template.view', 'see the notification templates');
      const all = db.prepare("SELECT * FROM ntf_templates WHERE code = ? AND (company_id IS NULL OR company_id = ?) AND is_active = 1 ORDER BY company_id IS NULL, template_version DESC, channel, lang").all(code, actor.companyId);
      if (!all.length) throw notFound('That template does not exist.');
      const seen = new Set();
      const active = all.filter((r) => r.status === 'ACTIVE').filter((r) => { const k = `${r.channel}|${r.lang}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return { code, category: all[0].category, variables: JSON.parse(all[0].variables_json || '[]'), entries: active.map(entry), pending: all.filter((r) => r.status === 'PENDING' && r.company_id === actor.companyId).map(entry), history: all.filter((r) => ['RETIRED', 'REJECTED'].includes(r.status)).slice(0, 30).map(entry), sample: SAMPLE };
    },
    /** What the words come to for sample facts, in a language and channel; names a fact the template does not declare. */
    preview(actor, b) {
      need(actor, 'ntf.template.view', 'preview notification templates');
      const declared = new Set(b.variables ?? JSON.parse(db.prepare("SELECT variables_json FROM ntf_templates WHERE code = ? LIMIT 1").get(b.code)?.variables_json ?? '[]'));
      const unknown = [...new Set([...variablesOf(b.subject ?? ''), ...variablesOf(b.body)])].filter((v) => !declared.has(v));
      const data = Object.fromEntries([...declared].map((k) => [k, SAMPLE[k] ?? '']));
      return { subject: render(b.subject ?? '', data), body: render(b.body, data), unknownVariables: unknown, lang: b.lang, channel: b.channel, characters: render(b.body, data).length };
    },
    /** A new version of some texts of a template. It waits for the IT administrator; the version in force is unchanged until then. */
    propose(actor, b) {
      need(actor, 'ntf.template.edit', 'change notification templates');
      const base = db.prepare("SELECT * FROM ntf_templates WHERE code = ? AND status = 'ACTIVE' ORDER BY company_id IS NULL LIMIT 1").get(b.code);
      if (!base) throw notFound('That template does not exist.');
      const declared = new Set(JSON.parse(base.variables_json || '[]'));
      const problems = [];
      b.changes.forEach((c, i) => {
        const unknown = [...new Set([...variablesOf(c.subject ?? ''), ...variablesOf(c.body)])].filter((v) => !declared.has(v));
        if (unknown.length) problems.push({ field: `changes.${i}.body`, message: `${unknown.map((u) => `{{${u}}}`).join(', ')} is not a fact this template carries. It carries: ${[...declared].join(', ')}.` });
        if (c.channel === 'SMS' && c.body.length > 320) problems.push({ field: `changes.${i}.body`, message: 'A text message of more than 320 characters is sent as several messages; shorten it.' });
        if (!['EMAIL', 'IN_APP', 'PUSH'].includes(c.channel) && c.subject) problems.push({ field: `changes.${i}.subject`, message: `${c.channel} has no subject line.` });
      });
      if (new Set(b.changes.map((c) => `${c.channel}|${c.lang}`)).size !== b.changes.length) problems.push({ field: 'changes', message: 'A channel and language is named twice.' });
      if (problems.length) throw badRequest('The template is not valid.', problems);
      return transaction(db, () => {
        if (db.prepare("SELECT 1 FROM ntf_templates WHERE code = ? AND company_id = ? AND status = 'PENDING' LIMIT 1").get(b.code, actor.companyId)) throw conflict('A change of this template is already waiting for approval.');
        const batch = Number(db.prepare("SELECT COALESCE(MAX(CAST(source_id AS INTEGER)), 0) + 1 AS n FROM ntf_templates WHERE source_type = 'template_change'").get().n);
        for (const c of b.changes) {
          const cur = db.prepare("SELECT MAX(template_version) AS v FROM ntf_templates WHERE code = ? AND channel = ? AND lang = ? AND (company_id IS NULL OR company_id = ?)").get(b.code, c.channel, c.lang, actor.companyId).v ?? 0;
          if (!db.prepare("SELECT 1 FROM ntf_templates WHERE code = ? AND channel = ? AND lang = ? AND status = 'ACTIVE' LIMIT 1").get(b.code, c.channel, c.lang)) throw unprocessable(`${b.code} has no ${c.channel} text in ${c.lang === 'hi' ? 'Hindi' : 'English'} to change.`);
          db.prepare(`INSERT INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, reason, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, 'template_change', ?)`)
            .run(actor.companyId, b.code, base.category, c.channel, c.lang, c.subject ?? '', c.body, base.variables_json, cur + 1, b.reason, actor.user, String(batch));
        }
        writeAudit(db, { entity: 'ntf_templates', entityId: batch, action: 'propose', newValues: { code: b.code, texts: b.changes.map((c) => `${c.channel}/${c.lang}`) }, actor: actor.user, companyId: actor.companyId, reason: b.reason });
        const instance = engine.submit(actor, { docType: TEMPLATE_DOC, docId: batch, comment: b.reason, context: { code: b.code } });
        db.prepare("UPDATE ntf_templates SET instance_id = ? WHERE source_type = 'template_change' AND source_id = ?").run(instance.id, String(batch));
        return { batch, workflow: instance };
      });
    },
  };

  // ---- the delivery log (FR-06) ----
  const deliveryRow = (r) => ({ id: r.id, notificationId: r.notification_id, user: r.user_ref, channel: r.channel, address: maskAddress(r.address, r.channel), status: r.status, attempts: r.attempts, lastError: r.last_error, providerMsgId: r.provider_msg_id, deliveredAt: r.delivered_at, nextAttemptAt: r.next_attempt_at, deliverAfter: r.deliver_after, digestId: r.digest_id, title: r.title, template: r.template_code, at: r.created_at });
  const deliveries = {
    list(actor, q = {}) {
      need(actor, 'ntf.delivery.view', 'see the delivery log');
      const p = { c: actor.companyId, limit: q.limit ?? 25, offset: q.offset ?? 0 };
      const where = ['d.company_id = :c'];
      if (q.channel) { where.push('d.channel = :ch'); p.ch = q.channel; }
      if (q.status) { where.push('d.status = :st'); p.st = q.status; }
      if (q.user) { where.push('d.user_ref = :u'); p.u = q.user; }
      if (q.from) { where.push('d.created_at >= :from'); p.from = `${q.from}T00:00:00.000Z`; }
      if (q.to) { where.push('d.created_at <= :to'); p.to = `${q.to}T23:59:59.999Z`; }
      if (q.q) { where.push('(n.title LIKE :q OR n.template_code LIKE :q OR d.last_error LIKE :q)'); p.q = `%${q.q}%`; }
      const pc = { ...p }; delete pc.limit; delete pc.offset;
      const total = db.prepare(`SELECT COUNT(*) AS n FROM ntf_deliveries d JOIN ntf_notifications n ON n.id = d.notification_id WHERE ${where.join(' AND ')}`).get(pc).n;
      const rows = db.prepare(`SELECT d.*, n.title, n.template_code FROM ntf_deliveries d JOIN ntf_notifications n ON n.id = d.notification_id WHERE ${where.join(' AND ')} ORDER BY d.id DESC LIMIT :limit OFFSET :offset`).all(p).map(deliveryRow);
      return { rows, total };
    },
    summary(actor, q = {}) {
      need(actor, 'ntf.delivery.view', 'see the delivery log');
      const p = { c: actor.companyId, from: q.from ? `${q.from}T00:00:00.000Z` : '0000', to: q.to ? `${q.to}T23:59:59.999Z` : '9999' };
      const rows = db.prepare('SELECT channel, status, COUNT(*) AS n FROM ntf_deliveries WHERE company_id = :c AND created_at >= :from AND created_at <= :to GROUP BY channel, status').all(p);
      const grid = {};
      for (const ch of CHANNELS) grid[ch] = { PENDING: 0, DEFERRED: 0, SENT: 0, DELIVERED: 0, FAILED: 0, SKIPPED: 0, total: 0 };
      for (const r of rows) { grid[r.channel][r.status] = r.n; grid[r.channel].total += r.n; }
      const totals = { total: 0, failed: 0, pending: 0 };
      for (const g of Object.values(grid)) { totals.total += g.total; totals.failed += g.FAILED; totals.pending += g.PENDING + g.DEFERRED; }
      return { grid, totals };
    },
    retry(actor, id) {
      need(actor, 'ntf.delivery.retry', 'retry deliveries');
      return transaction(db, () => {
        const d = db.prepare('SELECT * FROM ntf_deliveries WHERE id = ? AND company_id = ?').get(id, actor.companyId);
        if (!d) throw notFound('That delivery does not exist.');
        if (!['FAILED', 'SKIPPED'].includes(d.status)) throw unprocessable(`This delivery is ${d.status.toLowerCase()}, so it is not retried.`);
        db.prepare("UPDATE ntf_deliveries SET status = 'PENDING', attempts = 0, last_error = NULL, next_attempt_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(iso(), actor.user, iso(), id);
        writeAudit(db, { entity: 'ntf_deliveries', entityId: id, action: 'retry', oldValues: { status: d.status, error: d.last_error }, newValues: { status: 'PENDING' }, actor: actor.user, companyId: actor.companyId });
        return deliveryRow({ ...db.prepare('SELECT d.*, n.title, n.template_code FROM ntf_deliveries d JOIN ntf_notifications n ON n.id = d.notification_id WHERE d.id = ?').get(id) });
      });
    },
  };
  return { centre, preferences, templates, deliveries, realtime: { status: (actor) => ({ attached: hub.attached(), rooms: ['user', 'project', 'site', 'dept', 'record'], company: actor.companyId }) } };
}
