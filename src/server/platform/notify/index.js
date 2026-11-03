import { inTransaction } from '../db/index.js';
import { isSensitiveKey } from '../events/mask.js';
import { log } from '../http/logger.js';
import { createParameterStore } from '../parameters/index.js';
import { TEMPLATE_PERMISSIONS } from '../authz/templates.js';
import { authzOf } from '../authz/index.js';
import { workflowOf } from '../workflow/index.js';
import { realtimeOf } from '../realtime/index.js';

/**
 * The notification engine (part 04.06). A module says what happened and to whom, with a template code and the facts; the engine finds the people, picks the words in their language,
 * hides what they may not see, respects their channels, quiet hours and digest, writes the notification they see in the centre, queues each channel's message in the delivery log and
 * tells their open screens in real time.
 *
 *   notificationsOf(db).notify({ companyId, templateCode, recipients: ['user:anil', 'role:PM', 'permission:eng.workflow.admin'], data: { docRef: 'WSD-1' }, priority, channels, link,
 *                                category, projectId, siteId, sourceType, sourceId, eventKey, sensitive: { amount: 'eng.workflow.view' } })
 *
 * A message leaves through a gateway (`gateways.register('EMAIL', async ({ delivery }) => ({ providerMsgId }))`); the communication gateway of part 04.07 replaces the stand-ins.
 */
export const CATEGORIES = Object.freeze(['approvals', 'tasks', 'alerts', 'mentions', 'system', 'security', 'statutory']);
export const MANDATORY = Object.freeze(['security', 'statutory']);
export const CHANNELS = Object.freeze(['IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH']);
export const PRIORITIES = Object.freeze(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
/** What a person gets when they have chosen nothing: the centre always, e-mail for what needs an answer or care. */
export const DEFAULT_CHANNELS = Object.freeze({
  approvals: { IN_APP: true, EMAIL: true, SMS: false, WHATSAPP: false, PUSH: true }, tasks: { IN_APP: true, EMAIL: false, SMS: false, WHATSAPP: false, PUSH: false },
  alerts: { IN_APP: true, EMAIL: true, SMS: false, WHATSAPP: false, PUSH: true }, mentions: { IN_APP: true, EMAIL: false, SMS: false, WHATSAPP: false, PUSH: true },
  system: { IN_APP: true, EMAIL: false, SMS: false, WHATSAPP: false, PUSH: false }, security: { IN_APP: true, EMAIL: true, SMS: false, WHATSAPP: false, PUSH: true },
  statutory: { IN_APP: true, EMAIL: true, SMS: false, WHATSAPP: false, PUSH: false },
});
const VAR = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
export const variablesOf = (text) => [...new Set([...String(text).matchAll(VAR)].map((m) => m[1]))];
/** Put the facts into the words. A fact that is missing becomes nothing; the facts are plain text, never markup. */
export const render = (text, data) => String(text).replace(VAR, (_m, k) => (data[k] == null ? '' : String(data[k]))).replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').trim();

const gatewayMap = new Map();
export const gateways = { register(channel, fn) { gatewayMap.set(channel, fn); }, get: (channel) => gatewayMap.get(channel) ?? null, remove(channel) { gatewayMap.delete(channel); } };
/** A gateway throws this when a message cannot be sent and trying again will not help (no connector, no address). */
export class SkipDelivery extends Error {}

const instances = new WeakMap();
export function notificationsOf(db) {
  let n = instances.get(db);
  if (!n) { n = createNotifications(db); instances.set(db, n); }
  return n;
}

const iso = (d) => d.toISOString();
const IST = 5.5 * 3_600_000;
const istParts = (d) => { const x = new Date(d.getTime() + IST); return { h: x.getUTCHours(), m: x.getUTCMinutes(), date: x.toISOString().slice(0, 10) }; };
const fromIst = (date, minutes) => new Date(Date.parse(`${date}T00:00:00Z`) + minutes * 60_000 - IST);
const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function createNotifications(db) {
  const engine = workflowOf(db);
  const authz = authzOf(db);
  const params = createParameterStore(db);
  const now = () => engine.clock();
  const param = (key, companyId) => params.get(key, { companyId, date: now().toISOString().slice(0, 10) });

  // ---- templates ----
  function templateFor(companyId, code, channel, lang) {
    const pick = (l) => db.prepare(`SELECT * FROM ntf_templates WHERE code = ? AND channel = ? AND lang = ? AND status = 'ACTIVE' AND is_active = 1 AND (company_id = ? OR company_id IS NULL) ORDER BY company_id IS NULL, template_version DESC LIMIT 1`).get(code, channel, l, companyId);
    return pick(lang) ?? (lang === 'en' ? null : pick('en'));
  }
  const categoryOf = (code) => db.prepare("SELECT category FROM ntf_templates WHERE code = ? AND status = 'ACTIVE' LIMIT 1").get(code)?.category ?? null;

  // ---- people ----
  const iamUser = (companyId, user) => db.prepare("SELECT id, username, email, mobile, roles_json FROM iam_users WHERE username = ? AND (company_id = ? OR company_id IS NULL) AND is_active = 1").get(user, companyId);
  function rolesOf(companyId, user) {
    const u = iamUser(companyId, user);
    const set = new Set(u ? JSON.parse(u.roles_json || '[]') : []);
    if (u) for (const r of db.prepare("SELECT DISTINCT r.code FROM iam_assignments a JOIN iam_roles r ON r.id = a.role_id WHERE a.user_id = ? AND a.company_id = ? AND a.status = 'ACTIVE' AND a.is_active = 1").all(u.id, companyId)) set.add(r.code);
    return [...set];
  }
  /** user:<name>, role:<code> (those who hold it for the project or site), permission:<key> (those whose roles carry it). */
  function resolveRecipients(companyId, recipients, scope = {}) {
    const out = new Set();
    for (const r of recipients) {
      const [kind, ...rest] = String(r).split(':');
      const ref = rest.join(':');
      if (kind === 'user' && ref) out.add(ref);
      else if (kind === 'role' && ref) for (const role of ref.split('|')) for (const u of engine.holders(companyId, role, scope)) out.add(u);
      else if (kind === 'permission' && ref) for (const [role, perms] of Object.entries(TEMPLATE_PERMISSIONS)) if (perms.includes(ref)) for (const u of engine.holders(companyId, role, scope)) out.add(u);
    }
    return [...out];
  }

  /** The facts as one person may see them: a fact the module marked sensitive needs the permission named; a fact whose name looks like a rate, cost, salary or bank number is always hidden. */
  function visibleData(companyId, user, data, sensitive, scope) {
    const out = { ...data };
    let actor = null;
    for (const k of Object.keys(out)) {
      const perm = sensitive[k];
      if (perm) {
        actor ??= authz.enrich({ user, roles: rolesOf(companyId, user), companyId });
        const ok = authz.check(actor, perm, { companyId, projectId: scope.projectId ?? null, siteId: scope.siteId ?? null }).allowed;
        if (!ok) out[k] = '—';
      } else if (isSensitiveKey(k)) out[k] = '—';
    }
    return out;
  }

  // ---- preferences ----
  function preferencesOf(companyId, user) {
    const rows = db.prepare('SELECT * FROM ntf_preferences WHERE company_id = ? AND user_ref = ? AND is_active = 1').all(companyId, user);
    const all = rows.find((r) => r.category === 'ALL');
    const categories = {};
    for (const c of CATEGORIES) {
      const r = rows.find((x) => x.category === c);
      categories[c] = { ...DEFAULT_CHANNELS[c], ...(r ? JSON.parse(r.channels_json || '{}') : {}) };
      if (MANDATORY.includes(c)) { categories[c].IN_APP = true; categories[c].EMAIL = true; }
    }
    return { categories, digest: all?.digest ?? 'INSTANT', quietHours: all?.quiet_hours_json ? JSON.parse(all.quiet_hours_json) : null, version: all?.version ?? null, categoryVersions: Object.fromEntries(rows.map((r) => [r.category, r.version])) };
  }
  const languageOf = (companyId, user) => db.prepare('SELECT language FROM ui_user_preferences WHERE company_id = ? AND user_ref = ? AND is_active = 1').get(companyId, user)?.language ?? 'en';
  function inQuiet(q, at) {
    const s = hm(q?.start); const e = hm(q?.end);
    if (s == null || e == null || s === e) return null;
    const p = istParts(at);
    const m = p.h * 60 + p.m;
    const inside = s < e ? m >= s && m < e : m >= s || m < e;
    if (!inside) return null;
    // the end of the quiet time: today if it is still ahead, else tomorrow
    let end = fromIst(p.date, e);
    if (end <= at) end = new Date(end.getTime() + 86_400_000);
    return end;
  }
  function nextDigest(prefs, at, companyId) {
    if (prefs.digest === 'HOURLY') return new Date(Math.floor(at.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
    const hour = param('ntf.digest.daily_hour', companyId);
    const p = istParts(at);
    let t = fromIst(p.date, hour * 60);
    if (t <= at) t = new Date(t.getTime() + 86_400_000);
    return t;
  }
  const addressOf = (companyId, user, channel) => {
    if (channel === 'IN_APP') return user;
    if (channel === 'PUSH') return db.prepare('SELECT COUNT(*) AS n FROM ui_push_subscriptions WHERE company_id = ? AND user_ref = ? AND is_active = 1').get(companyId, user).n > 0 ? 'push' : null;
    const u = iamUser(companyId, user);
    return channel === 'EMAIL' ? u?.email ?? null : u?.mobile ?? null;
  };

  /** Write the notification and the delivery rows for every person. Returns { created, skipped, ids }. */
  function notify(n) {
    const priority = n.priority ?? 'NORMAL';
    const scope = { projectId: n.projectId ?? null, siteId: n.siteId ?? null };
    const users = resolveRecipients(n.companyId, n.recipients ?? [], scope);
    const category = n.category ?? categoryOf(n.templateCode);
    if (!category) { log.warn({ msg: 'notify: the template has no category', code: n.templateCode }); return { created: 0, skipped: users.length, ids: [] }; }
    const at = now();
    const key = n.eventKey ?? (n.sourceType && n.sourceId != null ? `${n.sourceType}:${n.sourceId}:${n.templateCode}` : null);
    const mandatory = MANDATORY.includes(category);
    const out = { created: 0, skipped: 0, ids: [] };
    return inTransaction(db, () => {
      for (const user of users) {
        if (key && db.prepare('SELECT 1 FROM ntf_notifications WHERE company_id = ? AND user_ref = ? AND event_key = ?').get(n.companyId, user, key)) { out.skipped += 1; continue; }
        const lang = languageOf(n.companyId, user);
        const prefs = preferencesOf(n.companyId, user);
        const want = { ...prefs.categories[category] };
        if (n.channels) for (const c of CHANNELS) if (!n.channels.includes(c) && !(mandatory && (c === 'IN_APP' || c === 'EMAIL'))) want[c] = false;
        const data = { ...visibleData(n.companyId, user, n.data ?? {}, n.sensitive ?? {}, scope), link: n.link ?? '' };
        const inApp = templateFor(n.companyId, n.templateCode, 'IN_APP', lang);
        if (!inApp) { log.warn({ msg: 'notify: no in-app template', code: n.templateCode, lang }); out.skipped += 1; continue; }
        const title = render(inApp.subject, data);
        const body = render(inApp.body, data);
        const res = db.prepare(`INSERT INTO ntf_notifications (company_id, user_ref, template_code, title, body, link, category, priority, in_app, event_key, data_json, project_id, site_id, created_by, source_type, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(n.companyId, user, n.templateCode, title, body, n.link ?? null, category, priority, want.IN_APP ? 1 : 0, key, JSON.stringify({ category, ...(n.refs ?? {}) }), scope.projectId, scope.siteId, n.actor ?? 'system', n.sourceType ?? 'notify', n.sourceId == null ? null : String(n.sourceId));
        const id = Number(res.lastInsertRowid);
        out.ids.push(id);
        out.created += 1;
        const quietEnd = !mandatory && priority !== 'URGENT' ? inQuiet(prefs.quietHours, at) : null;
        const digestAt = !mandatory && priority !== 'URGENT' && prefs.digest !== 'INSTANT' ? nextDigest(prefs, at, n.companyId) : null;
        const deferTo = [quietEnd, digestAt].filter(Boolean).sort((a, b) => Number(b) - Number(a))[0] ?? null;
        for (const channel of CHANNELS) {
          if (!want[channel]) continue;
          const t = channel === 'IN_APP' ? inApp : templateFor(n.companyId, n.templateCode, channel, lang);
          if (!t) continue;
          const subject = render(t.subject, data);
          const text = render(t.body, data);
          const ins = db.prepare(`INSERT INTO ntf_deliveries (company_id, notification_id, user_ref, channel, address, subject, body, status, next_attempt_at, deliver_after, delivered_at, created_by, source_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'notify')`);
          if (channel === 'IN_APP') { ins.run(n.companyId, id, user, channel, user, subject, text, 'DELIVERED', null, null, iso(at)); continue; }
          const address = addressOf(n.companyId, user, channel);
          if (!address) { ins.run(n.companyId, id, user, channel, null, subject, text, 'SKIPPED', null, null, null); db.prepare("UPDATE ntf_deliveries SET last_error = ? WHERE id = last_insert_rowid()").run(`${user} has no ${channel === 'EMAIL' ? 'e-mail address' : channel === 'PUSH' ? 'subscribed device' : 'mobile number'}`); continue; }
          if (deferTo) ins.run(n.companyId, id, user, channel, address, subject, text, 'DEFERRED', null, iso(deferTo), null);
          else ins.run(n.companyId, id, user, channel, address, subject, text, 'PENDING', iso(at), null, null);
        }
        if (want.IN_APP) realtimeOf(db).publish({ companyId: n.companyId, rooms: [`user:${user}`], type: 'notification', entity: 'notification', entityId: id, data: { category, priority } });
      }
      return out;
    });
  }

  // ---- sending ----
  const BACKOFF_MIN = [1, 5, 30, 120];
  /** Send what is due through the gateways. A failure is tried again with back-off, and after the attempts allowed it is FAILED and shows in the delivery log. */
  async function dispatchDue(limit = 100) {
    const due = db.prepare("SELECT * FROM ntf_deliveries WHERE status = 'PENDING' AND channel != 'IN_APP' AND next_attempt_at <= ? ORDER BY id LIMIT ?").all(iso(now()), limit);
    const result = { sent: 0, failed: 0, retrying: 0, skipped: 0 };
    for (const d of due) {
      const gw = gateways.get(d.channel);
      const stamp = iso(now());
      if (!gw) { db.prepare("UPDATE ntf_deliveries SET status = 'SKIPPED', last_error = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(`No gateway is set up for ${d.channel}`, stamp, d.id); result.skipped += 1; continue; }
      try {
        const r = await gw({ delivery: d, notification: db.prepare('SELECT * FROM ntf_notifications WHERE id = ?').get(d.notification_id) });
        db.prepare("UPDATE ntf_deliveries SET status = 'SENT', provider_msg_id = ?, attempts = attempts + 1, last_error = NULL, delivered_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(r?.providerMsgId ?? null, stamp, stamp, d.id);
        result.sent += 1;
      } catch (err) {
        const message = String(err?.message ?? err).slice(0, 500);
        if (err instanceof SkipDelivery) { db.prepare("UPDATE ntf_deliveries SET status = 'SKIPPED', attempts = attempts + 1, last_error = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(message, stamp, d.id); result.skipped += 1; continue; }
        const attempts = d.attempts + 1;
        const max = param('ntf.delivery.max_attempts', d.company_id);
        if (attempts >= max) { db.prepare("UPDATE ntf_deliveries SET status = 'FAILED', attempts = ?, last_error = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(attempts, message, stamp, d.id); result.failed += 1; }
        else { db.prepare("UPDATE ntf_deliveries SET attempts = ?, last_error = ?, next_attempt_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(attempts, message, iso(new Date(now().getTime() + (BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)]) * 60_000)), stamp, d.id); result.retrying += 1; }
      }
    }
    return result;
  }

  /** The digest (FR-06): what was held back for a person (quiet hours, an hourly or a daily digest) becomes one message per channel, once its time has come. */
  function buildDigests() {
    const due = db.prepare("SELECT * FROM ntf_deliveries WHERE status = 'DEFERRED' AND deliver_after <= ? ORDER BY id").all(iso(now()));
    const groups = new Map();
    for (const d of due) { const k = `${d.company_id}|${d.user_ref}|${d.channel}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(d); }
    let digests = 0;
    for (const items of groups.values()) {
      inTransaction(db, () => {
        const first = items[0];
        const lang = languageOf(first.company_id, first.user_ref);
        const lines = items.map((d) => `- ${db.prepare('SELECT title FROM ntf_notifications WHERE id = ?').get(d.notification_id)?.title ?? ''}`).join('\n');
        const t = templateFor(first.company_id, 'ntf.digest', first.channel, lang);
        if (!t) { db.prepare("UPDATE ntf_deliveries SET status = 'SKIPPED', last_error = 'No digest template', updated_at = ?, version = version + 1 WHERE id IN (" + items.map(() => '?').join(',') + ')').run(iso(now()), ...items.map((d) => d.id)); return; }
        const data = { count: items.length, items: lines, link: '/notifications' };
        const note = Number(db.prepare(`INSERT INTO ntf_notifications (company_id, user_ref, template_code, title, body, link, category, priority, in_app, created_by, source_type)
          VALUES (?, ?, 'ntf.digest', ?, ?, '/notifications', 'system', 'LOW', 0, 'system', 'digest')`).run(first.company_id, first.user_ref, render(t.subject, data), render(t.body, data)).lastInsertRowid);
        db.prepare(`INSERT INTO ntf_deliveries (company_id, notification_id, user_ref, channel, address, subject, body, status, next_attempt_at, created_by, source_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 'system', 'digest')`).run(first.company_id, note, first.user_ref, first.channel, first.address, render(t.subject, data), render(t.body, data), iso(now()));
        db.prepare(`UPDATE ntf_deliveries SET status = 'SENT', digest_id = ?, delivered_at = ?, last_error = 'Sent in a digest', updated_at = ?, version = version + 1 WHERE id IN (${items.map(() => '?').join(',')})`).run(note, iso(now()), iso(now()), ...items.map((d) => d.id));
        digests += 1;
      });
    }
    return { digests, held: due.length };
  }

  const unread = (companyId, user) => db.prepare('SELECT COUNT(*) AS n FROM ntf_notifications WHERE company_id = ? AND user_ref = ? AND in_app = 1 AND read_at IS NULL AND archived_at IS NULL AND is_active = 1').get(companyId, user).n;
  return { notify, dispatchDue, buildDigests, preferencesOf, languageOf, templateFor, unread, resolveRecipients, rolesOf, param, now };
}
