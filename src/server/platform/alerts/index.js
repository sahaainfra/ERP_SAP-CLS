import { inTransaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { publishEvent } from '../events/index.js';
import { badRequest } from '../http/errors.js';
import { notificationsOf, render } from '../notify/index.js';
import { tasksOf } from '../tasks/index.js';
import { runtimeOf } from '../runtime/index.js';
import { workflowOf } from '../workflow/index.js';

/**
 * The automation and alert rules engine (part 04.09).
 *
 *   alertDatasets.register({ code, label, ownerModule, entity, fields: [{ key, label, type }], query(db, { companyId, now }) -> [{ id, label, route, projectId, siteId, owners, fields }] })
 *   alertsOf(db).run(rule)      evaluate a rule now and raise its alerts and actions
 *   alertsOf(db).dryRun(rule)   the same evaluation without writing anything: what would happen
 *   alertsOf(db).handleEvent(e) the event rules that listen to the type of the event
 *   alertsOf(db).runDue()       the schedule rules whose time has come
 *
 * A rule is a trigger (a domain event, or a schedule over a dataset a module offers), conditions over the fields of the row, actions (notify, make a task, escalate, call a webhook, set a flag), a
 * throttle window and a severity. BR-01: the same alert for the same entity is not repeated within the window. BR-02: disabling a rule keeps its alerts. A dataset that no module offers yet
 * (stock, payments, incidents ...) keeps its rule from being enabled until the module is live.
 */
export const SEVERITIES = Object.freeze(['INFO', 'WARNING', 'CRITICAL']);
export const ACTION_TYPES = Object.freeze(['notify', 'task', 'escalate', 'webhook', 'flag']);
export const EXTERNAL_CHANNELS = Object.freeze(['EMAIL', 'SMS', 'WHATSAPP']);
export const OPS = Object.freeze(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'nin', 'contains', 'empty', 'notEmpty']);
const NOTIFY_PRIORITY = { INFO: 'LOW', WARNING: 'NORMAL', CRITICAL: 'URGENT' };
const MAX_ROWS = 20_000;

const datasets = new Map();
export const alertDatasets = {
  register(def) {
    if (datasets.has(def.code)) throw new Error(`Alert dataset ${def.code} is already registered`);
    datasets.set(def.code, { fields: [], ...def });
  },
  get: (code) => datasets.get(code),
  list: () => [...datasets.values()].sort((a, b) => a.code.localeCompare(b.code)),
};

const instances = new WeakMap();
export const alertsOf = (db) => {
  if (!instances.has(db)) instances.set(db, createAlerts(db));
  return instances.get(db);
};

/** Does a row satisfy the conditions? { all: [...], any: [...] }; a condition is { field, op, value }. */
export function matches(condition, fields) {
  const test = (c) => {
    const v = fields[c.field];
    const w = c.value;
    const num = (x) => (x === null || x === undefined || x === '' ? Number.NaN : Number(x));
    switch (c.op) {
      case 'eq': return v === w || (v !== null && v !== undefined && String(v) === String(w));
      case 'ne': return !(v === w || (v !== null && v !== undefined && String(v) === String(w)));
      case 'gt': return Number.isNaN(num(v)) ? String(v ?? '') > String(w) : num(v) > num(w);
      case 'gte': return Number.isNaN(num(v)) ? v !== null && v !== undefined && String(v) >= String(w) : num(v) >= num(w);
      case 'lt': return Number.isNaN(num(v)) ? v !== null && v !== undefined && String(v) < String(w) : num(v) < num(w);
      case 'lte': return Number.isNaN(num(v)) ? v !== null && v !== undefined && String(v) <= String(w) : num(v) <= num(w);
      case 'in': return Array.isArray(w) && w.map(String).includes(String(v));
      case 'nin': return Array.isArray(w) && !w.map(String).includes(String(v));
      case 'contains': return String(v ?? '').toLowerCase().includes(String(w ?? '').toLowerCase());
      case 'empty': return v === null || v === undefined || v === '';
      case 'notEmpty': return !(v === null || v === undefined || v === '');
      default: return false;
    }
  };
  const all = condition?.all ?? [];
  const any = condition?.any ?? [];
  return all.every(test) && (any.length === 0 || any.some(test));
}

/** The problems with a rule's definition, as [{ field, message }]. `knownFields` is null for event rules, whose fields come from the event. */
export function checkRule(rule, { knownFields = null, roles = null } = {}) {
  const problems = [];
  if (rule.triggerType === 'EVENT' && !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(rule.eventType ?? '')) problems.push({ field: 'eventType', message: 'Name the event as module.entity.verb, for example hse.incident.reported.' });
  if (rule.triggerType === 'SCHEDULE') {
    if (!/^(HOURLY|DAILY@([01]\d|2[0-3])|WEEKLY@[0-6])$/.test(rule.schedule ?? '')) problems.push({ field: 'schedule', message: 'Choose hourly, daily at an hour, or weekly on a day.' });
    if (!rule.dataset) problems.push({ field: 'dataset', message: 'Choose what the rule looks at.' });
  }
  const conds = [...(rule.condition?.all ?? []), ...(rule.condition?.any ?? [])];
  conds.forEach((c, i) => {
    if (!OPS.includes(c.op)) problems.push({ field: `condition.${i}.op`, message: `${c.op} is not a comparison the engine knows.` });
    if (!c.field || (knownFields && !knownFields.includes(c.field))) problems.push({ field: `condition.${i}.field`, message: `${c.field ?? 'A field'} is not a field of what the rule looks at.` });
    if (['in', 'nin'].includes(c.op) && !Array.isArray(c.value)) problems.push({ field: `condition.${i}.value`, message: 'Give a list of values.' });
  });
  if (!rule.actions?.length) problems.push({ field: 'actions', message: 'A rule needs at least one action.' });
  (rule.actions ?? []).forEach((a, i) => {
    if (!ACTION_TYPES.includes(a.type)) problems.push({ field: `actions.${i}.type`, message: `${a.type} is not an action.` });
    if (a.type === 'notify') {
      if (!a.to?.length) problems.push({ field: `actions.${i}.to`, message: 'Say who is told.' });
      for (const ch of a.channels ?? []) if (!EXTERNAL_CHANNELS.includes(ch)) problems.push({ field: `actions.${i}.channels`, message: `${ch} is not an external channel (use e-mail, text message or WhatsApp).` });
    }
    if (a.type === 'task' && !String(a.title ?? '').trim()) problems.push({ field: `actions.${i}.title`, message: 'Give the task a title.' });
    if (a.type === 'task' && !a.assignee) problems.push({ field: `actions.${i}.assignee`, message: 'Say who does the task.' });
    if (a.type === 'escalate' && !a.role) problems.push({ field: `actions.${i}.role`, message: 'Say which role it is escalated to.' });
    if (['notify', 'escalate'].includes(a.type) && roles) for (const t of [...(a.to ?? []), a.role ? `role:${a.role}` : null].filter(Boolean)) if (t.startsWith('role:') && !roles.has(t.slice(5))) problems.push({ field: `actions.${i}.to`, message: `${t.slice(5)} is not a role of the catalogue.` });
    if (a.type === 'webhook' && (!a.connector || !String(a.path ?? '').startsWith('/'))) problems.push({ field: `actions.${i}.connector`, message: 'Name the connector and a path that starts with /.' });
    if (a.type === 'flag' && !/^[a-z][a-z0-9_.]{1,40}$/.test(a.flag ?? '')) problems.push({ field: `actions.${i}.flag`, message: 'Name the flag in lower case, for example needs_attention.' });
  });
  if (!SEVERITIES.includes(rule.severity)) problems.push({ field: 'severity', message: 'Choose information, warning or critical.' });
  if (!String(rule.messageTemplate ?? '').trim()) problems.push({ field: 'messageTemplate', message: 'Write the message of the alert.' });
  return problems;
}
/** A rule that sends something out of the system needs approval (section 9 of the prompt). */
export const isExternal = (actions) => (actions ?? []).some((a) => a.type === 'webhook' || (a.type === 'notify' && (a.channels ?? []).length > 0));

/** Is a schedule rule due? Hourly after 59 minutes; daily from its hour (India time) once a day; weekly the same on its day. */
export function isDue(schedule, lastRunAt, now) {
  const last = lastRunAt ? new Date(lastRunAt) : null;
  const ist = (d) => new Date(d.getTime() + 5.5 * 3_600_000);
  if (schedule === 'HOURLY') return !last || now.getTime() - last.getTime() >= 59 * 60_000;
  const [kind, at] = schedule.split('@');
  const n = ist(now);
  const day = n.toISOString().slice(0, 10);
  const doneToday = last && ist(last).toISOString().slice(0, 10) === day;
  if (kind === 'DAILY') return n.getUTCHours() >= Number(at) && !doneToday;
  if (kind === 'WEEKLY') return n.getUTCDay() === Number(at) && !doneToday;
  return false;
}

function createAlerts(db) {
  const engine = workflowOf(db);
  const notif = notificationsOf(db);
  const core = tasksOf(db);
  const clock = () => engine.clock();
  const nowIso = () => clock().toISOString();
  const today = () => core.today();
  const ruleOf = (r) => ({
    id: r.id, companyId: r.company_id, code: r.code, name: r.name, description: r.description, triggerType: r.trigger_type, eventType: r.event_type, schedule: r.schedule, dataset: r.dataset,
    condition: JSON.parse(r.condition_json || '{}'), actions: JSON.parse(r.actions_json || '[]'), messageTemplate: r.message_template, throttleMinutes: r.throttle_minutes, severity: r.severity,
    ownerModule: r.owner_module, ownerRole: r.owner_role, external: r.external === 1, enabled: r.enabled === 1, version: r.rule_version, status: r.status, lastRunAt: r.last_run_at,
  });
  const iso = (ms) => new Date(ms).toISOString();

  /** Who the tokens of an action name, for this row: usernames (and the roles left to the notification engine). */
  function people(rule, row, tokens) {
    const users = new Set();
    const rest = [];
    for (const t of tokens ?? []) {
      if (t === 'owner') for (const u of row.owners ?? []) users.add(u);
      else if (t === 'assignee') for (const u of (row.fields.assignees ? String(row.fields.assignees).split(', ') : row.owners ?? [])) users.add(u);
      else if (t === 'assigner') { if (row.fields.assigner) users.add(String(row.fields.assigner)); }
      else if (t === 'role') { if (row.fields.role) { for (const r of String(row.fields.role).split('|')) rest.push(`role:${r}`); } else rest.push(`role:${rule.ownerRole}`); }
      else if (t.startsWith('user:')) users.add(t.slice(5));
      else rest.push(t);
    }
    const holders = rest.filter((t) => t.startsWith('role:')).flatMap((t) => core.holders(rule.companyId, [t.slice(5)]));
    return { users: [...users].filter((u) => core.userRow(rule.companyId, u)), rest, visible: [...new Set([...users, ...holders])] };
  }

  /** Evaluate a rule over its rows. Returns { rows: [{ ...row, message }], total, error }. */
  function evaluate(rule, { since = null } = {}) {
    const found = [];
    try {
      if (rule.triggerType === 'SCHEDULE') {
        const ds = alertDatasets.get(rule.dataset);
        if (!ds) return { rows: [], total: 0, error: `Nothing offers "${rule.dataset}" yet: the module that owns it (${rule.ownerModule}) is not live.`, missing: true };
        const rows = ds.query(db, { companyId: rule.companyId, now: clock(), today: today() }).slice(0, MAX_ROWS);
        for (const r of rows) if (matches(rule.condition, r.fields)) found.push({ ...r, entity: ds.entity });
        return { rows: found.map((r) => ({ ...r, message: render(rule.messageTemplate, r.fields) })), total: rows.length, error: null };
      }
      const events = db.prepare("SELECT * FROM core_outbox WHERE event_type = ? AND json_extract(payload, '$.companyId') = ? AND created_at >= ? ORDER BY id DESC LIMIT 200").all(rule.eventType, rule.companyId, since ?? iso(clock().getTime() - 7 * 86_400_000));
      for (const e of events) {
        const r = rowOfEvent(JSON.parse(e.payload), e);
        if (matches(rule.condition, r.fields)) found.push(r);
      }
      return { rows: found.map((r) => ({ ...r, message: render(rule.messageTemplate, r.fields) })), total: events.length, error: null };
    } catch (err) {
      return { rows: [], total: 0, error: String(err?.message ?? err).slice(0, 500) };
    }
  }
  function rowOfEvent(env, outboxRow) {
    const data = env.data ?? {};
    const flat = { type: env.type ?? outboxRow?.event_type, entity: env.entity, entityId: env.entityId, projectId: env.projectId ?? null, siteId: env.siteId ?? null, actor: env.actorId ?? null };
    for (const [k, v] of Object.entries(data)) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) flat[k] = v;
    const owners = [data.owner, data.assignee, env.actorId].filter((u) => u && u !== 'system' && typeof u === 'string');
    return { id: String(env.entityId ?? outboxRow?.id ?? env.eventId), entity: env.entity ?? 'event', label: `${env.entity ?? 'event'} ${env.entityId ?? ''}`.trim(), route: data.route ?? null, projectId: env.projectId ?? null, siteId: env.siteId ?? null, owners: [...new Set(owners)], fields: flat };
  }

  /** What would happen to a match: a new alert, a repeat of an open one after the window, or nothing (throttled). */
  function outcomeOf(rule, row) {
    const last = db.prepare('SELECT * FROM alr_alerts WHERE company_id = ? AND rule_code = ? AND entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 1').get(rule.companyId, rule.code, row.entity, String(row.id));
    const within = (a) => a.last_notified_at && clock().getTime() - Date.parse(a.last_notified_at) < rule.throttleMinutes * 60_000;
    if (!last) return { kind: 'NEW', last: null };
    if (within(last)) return { kind: 'THROTTLED', last };
    return { kind: last.status === 'RESOLVED' ? 'NEW' : 'REPEAT', last };
  }

  function actionSummary(rule, row, a) {
    const who = (t) => people(rule, row, t);
    if (a.type === 'notify') { const p = who(a.to); return `tell ${[...p.users, ...p.rest].join(', ') || 'nobody'}${a.channels?.length ? ` by ${a.channels.join(', ').toLowerCase()}` : ''}`; }
    if (a.type === 'task') return `make the task "${render(a.title, row.fields)}" for ${who([a.assignee]).users.join(', ') || 'nobody'}`;
    if (a.type === 'escalate') return `escalate to ${a.role}`;
    if (a.type === 'webhook') return `call ${a.connector} ${a.path}`;
    return `set the flag ${a.flag}`;
  }

  /** FR-05: what a rule would do now, with nothing written. */
  function dryRun(rule) {
    const t0 = Date.now();
    const ev = evaluate(rule);
    const items = ev.rows.map((row) => {
      const o = outcomeOf(rule, row);
      return { entity: row.entity, entityId: String(row.id), label: row.label, projectId: row.projectId, severity: rule.severity, message: row.message, outcome: o.kind, actions: o.kind === 'THROTTLED' ? [] : rule.actions.map((a) => actionSummary(rule, row, a)) };
    });
    return { looked: ev.total, matched: items.length, wouldCreate: items.filter((i) => i.outcome === 'NEW').length, wouldRepeat: items.filter((i) => i.outcome === 'REPEAT').length, throttled: items.filter((i) => i.outcome === 'THROTTLED').length, items: items.slice(0, 200), error: ev.error, durationMs: Date.now() - t0 };
  }

  function perform(rule, row, alert, a) {
    if (a.type === 'notify') {
      const p = people(rule, row, a.to);
      const recipients = [...p.users.map((u) => `user:${u}`), ...p.rest];
      if (recipients.length) notif.notify({ companyId: rule.companyId, templateCode: 'alr.alert', recipients, data: { severity: rule.severity.toLowerCase(), title: rule.name, message: row.message }, priority: NOTIFY_PRIORITY[rule.severity], category: 'alerts', projectId: row.projectId, siteId: row.siteId, link: row.route ?? '/alerts', sourceType: 'alert', sourceId: alert.id, eventKey: `alert:${alert.id}:${nowIso()}:${recipients.join(',')}`, ...(a.channels?.length ? { channels: ['IN_APP', ...a.channels] } : {}) });
      return { type: 'notify', to: recipients };
    }
    if (a.type === 'task') {
      const who = people(rule, row, [a.assignee]).users;
      const made = core.create({ companyId: rule.companyId, title: render(a.title, row.fields).slice(0, 200), description: row.message, entity: row.entity, entityId: row.id, entityLabel: row.label, projectId: row.projectId, siteId: row.siteId, priority: a.priority ?? 'MEDIUM', dueDate: new Date(Date.parse(today()) + (a.dueDays ?? 7) * 86_400_000).toISOString().slice(0, 10), assignees: who, origin: 'auto', assigner: 'system', actor: 'system', source: { type: 'alert_rule', id: `${rule.code}:${row.entity}:${row.id}` } });
      return { type: 'task', taskId: made.id, existing: made.existing };
    }
    if (a.type === 'escalate') {
      notif.notify({ companyId: rule.companyId, templateCode: 'alr.alert', recipients: [`role:${a.role}`], data: { severity: 'critical', title: `Escalated: ${rule.name}`, message: row.message }, priority: 'URGENT', category: 'alerts', projectId: row.projectId, siteId: row.siteId, link: '/alerts', sourceType: 'alert', sourceId: alert.id, eventKey: `alert:${alert.id}:escalated:${nowIso()}` });
      db.prepare('UPDATE alr_alerts SET escalated_at = ? WHERE id = ?').run(nowIso(), alert.id);
      return { type: 'escalate', role: a.role };
    }
    if (a.type === 'webhook') {
      runtimeOf(db).jobs.enqueue('alr.webhook', { companyId: rule.companyId, alertId: alert.id, connector: a.connector, path: a.path, method: a.method ?? 'POST', body: { rule: rule.code, severity: rule.severity, message: row.message, entity: row.entity, entityId: String(row.id), alertId: alert.id } }, { createdBy: 'system', companyId: rule.companyId });
      return { type: 'webhook', connector: a.connector, queued: true };
    }
    publishEvent(db, { type: 'alr.flag.set', entity: row.entity, entityId: String(row.id), actorId: 'system', companyId: rule.companyId, projectId: row.projectId, data: { flag: a.flag, rule: rule.code, alertId: alert.id } });
    return { type: 'flag', flag: a.flag };
  }

  /** Raise (or refresh) the alerts of the matches of a rule and do the actions; every outcome is counted in the run log. */
  function apply(rule, ev, trigger) {
    const t0 = Date.now();
    const started = nowIso();
    const out = { matched: ev.rows.length, created: 0, repeated: 0, throttled: 0, actions: 0, errors: 0, errorText: ev.error, items: [] };
    if (ev.error) out.errors += 1;
    for (const row of ev.rows) {
      try {
        const res = inTransaction(db, () => {
          const o = outcomeOf(rule, row);
          if (o.kind === 'THROTTLED') return { kind: 'THROTTLED', done: 0 };
          const p = rule.actions.filter((a) => a.type === 'notify').flatMap((a) => people(rule, row, a.to).visible);
          const owners = row.owners ?? [];
          let alert;
          const stamp = nowIso();
          if (o.kind === 'REPEAT') {
            db.prepare('UPDATE alr_alerts SET occurrences = occurrences + 1, last_seen_at = ?, last_notified_at = ?, message = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(stamp, stamp, row.message, 'system', stamp, o.last.id);
            alert = db.prepare('SELECT * FROM alr_alerts WHERE id = ?').get(o.last.id);
          } else {
            const id = Number(db.prepare(`INSERT INTO alr_alerts (company_id, rule_code, rule_version, entity, entity_id, entity_label, route, severity, message, owner_user_ref, recipients_json, first_seen_at, last_seen_at, last_notified_at, project_id, site_id, created_by, source_type, source_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'alert_rule', ?)`).run(rule.companyId, rule.code, rule.version, row.entity, String(row.id), row.label ?? null, row.route ?? null, rule.severity, row.message, owners[0] ?? null, JSON.stringify([...new Set([...owners, ...p])]), stamp, stamp, stamp, row.projectId ?? null, row.siteId ?? null, `${rule.code}:${row.entity}:${row.id}`).lastInsertRowid);
            alert = db.prepare('SELECT * FROM alr_alerts WHERE id = ?').get(id);
            publishEvent(db, { type: 'alr.alert.raised', entity: 'alert', entityId: String(id), actorId: 'system', companyId: rule.companyId, projectId: row.projectId ?? null, data: { rule: rule.code, severity: rule.severity, entity: row.entity, entityId: String(row.id) } });
          }
          const done = [];
          for (const a of rule.actions) done.push(perform(rule, row, alert, a));
          db.prepare('UPDATE alr_alerts SET deliveries_json = ? WHERE id = ?').run(JSON.stringify(done), alert.id);
          return { kind: o.kind, done: done.length };
        });
        if (res.kind === 'THROTTLED') out.throttled += 1; else { if (res.kind === 'NEW') out.created += 1; else out.repeated += 1; out.actions += res.done; }
        out.items.push({ entityId: String(row.id), outcome: res.kind });
      } catch (err) {
        out.errors += 1;
        out.errorText = String(err?.message ?? err).slice(0, 500);
      }
    }
    const finished = nowIso();
    db.prepare('INSERT INTO alr_rule_runs (company_id, rule_code, rule_version, trigger, started_at, finished_at, matched, created, throttled, actions_done, errors, error_text, duration_ms, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'system\', \'alert_run\')')
      .run(rule.companyId, rule.code, rule.version, trigger, started, finished, out.matched, out.created, out.throttled, out.actions, out.errors, out.errorText ?? null, Date.now() - t0);
    db.prepare('UPDATE alr_rules SET last_run_at = ? WHERE id = ?').run(finished, rule.id);
    return out;
  }
  const run = (rule, trigger = 'manual') => apply(rule, evaluate(rule), trigger);

  const activeRules = (companyId = null) => db.prepare(`SELECT * FROM alr_rules WHERE company_id ${companyId === null ? 'IS NOT NULL' : '= ?'} AND status = 'ACTIVE' AND enabled = 1 AND is_active = 1`).all(...(companyId === null ? [] : [companyId])).map(ruleOf);

  /** The schedule rules whose time has come. Returns the number run. */
  function runDue() {
    let n = 0;
    for (const rule of activeRules().filter((r) => r.triggerType === 'SCHEDULE')) {
      if (!alertDatasets.get(rule.dataset)) continue;
      if (!isDue(rule.schedule, rule.lastRunAt, clock())) continue;
      run(rule, 'schedule');
      n += 1;
    }
    return n;
  }
  /** An event of the bus: the event rules of its company that listen to its type (consumers are idempotent: the throttle window sees to it). */
  function handleEvent(event) {
    if (!event.companyId || String(event.type).startsWith('alr.')) return 0;
    const rules = db.prepare("SELECT * FROM alr_rules WHERE company_id = ? AND trigger_type = 'EVENT' AND event_type = ? AND status = 'ACTIVE' AND enabled = 1 AND is_active = 1").all(event.companyId, event.type).map(ruleOf);
    for (const rule of rules) {
      const row = rowOfEvent({ type: event.type, entity: event.entity, entityId: event.entityId, projectId: event.projectId, siteId: event.siteId, actorId: event.actorId, data: event.data, eventId: event.eventId }, null);
      const ev = matches(rule.condition, row.fields) ? { rows: [{ ...row, message: render(rule.messageTemplate, row.fields) }], total: 1, error: null } : { rows: [], total: 1, error: null };
      if (ev.rows.length) apply(rule, ev, 'event');
    }
    return rules.length;
  }
  /** Is there a rule listening to this type? (the bus consumer asks before it does any work) */
  const listens = (type) => Boolean(db.prepare("SELECT 1 FROM alr_rules WHERE trigger_type = 'EVENT' AND event_type = ? AND status = 'ACTIVE' AND enabled = 1 AND is_active = 1 LIMIT 1").get(type));

  function requireDataset(rule) {
    if (rule.triggerType === 'SCHEDULE' && !alertDatasets.get(rule.dataset)) throw badRequest(`This rule looks at "${rule.dataset}", which no module offers yet. It can be switched on when ${rule.ownerModule} is live.`, [{ field: 'dataset', message: 'The module that owns it is not live yet.' }]);
  }

  return { ruleOf, evaluate, dryRun, run, apply, runDue, handleEvent, listens, requireDataset, writeAudit, today, nowIso };
}
