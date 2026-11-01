import { z } from 'zod';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { endpointProblem } from '../../platform/push/index.js';
import { qrRegistry } from '../../platform/qr/index.js';
import { parse } from '../../platform/validation/index.js';
import { todayIST } from '../../../shared/dates.js';

// Part 03.06: what a phone or tablet needs from the server: the settings of the camera (maximum size and quality of a photo, smaller on a slow
// connection), the person's push subscriptions, a test notification to their own devices, and the resolver that turns a scanned code into the
// record it names.

const MAX_SUBSCRIPTIONS = 10; // devices per person
const nowIso = () => new Date().toISOString();

const base64url = (min, max) => z.string().min(min).max(max).regex(/^[A-Za-z0-9_-]+$/, 'must be base64url');
export const parseSubscription = (b) => parse(z.object({
  endpoint: z.string().trim().min(10).max(600),
  keys: z.object({ p256dh: base64url(80, 100), auth: base64url(20, 30) }).strict(),
  expirationTime: z.number().nullable().optional(),
  deviceLabel: z.string().trim().max(80).optional(),
}).strict(), b);
export const parseUnsubscribe = (b) => parse(z.object({ endpoint: z.string().trim().min(10).max(600) }).strict(), b);
export const parseQr = (q) => parse(z.object({ code: z.string().min(1, 'Scan or type a code').max(200) }).strict(), q);

/**
 * `push` is { vapid, send(subscription, message) } or null when this installation offers no push (no key pair); `allowHosts` adds push
 * hosts that are not a browser vendor's (a test server, never configured in production).
 */
export function createDeviceService({ db, push = null, allowHosts = [] }) {
  // read afresh: a changed value applies at once (a store of our own would not hear that the core service changed it)
  const params = { get: (key, ctx) => createParameterStore(db).get(key, ctx) };
  const user = (actor) => actor.user;
  // the business date in India decides which value applies (a value that starts today applies from midnight IST, not from 05:30)
  const param = (actor, key) => Number(params.get(key, { companyId: actor.companyId, date: todayIST() }));

  /** The camera's limits for this person's company: a photo is made smaller before it leaves the device (BR-02). */
  function settings(actor) {
    return {
      image: { maxPx: param(actor, 'ui.device.image_max_px'), quality: param(actor, 'ui.device.image_quality') / 100 },
      lowBandwidth: { maxPx: param(actor, 'ui.device.low_bandwidth_image_px'), quality: param(actor, 'ui.device.low_bandwidth_quality') / 100 },
      push: { available: Boolean(push), publicKey: push?.vapid.publicKey ?? null },
    };
  }

  const presentSub = (r) => ({ id: r.id, deviceLabel: r.device_label, userAgent: r.user_agent, createdAt: r.created_at, lastUsedAt: r.last_used_at, host: new URL(r.endpoint).host });
  const mine = (actor) => db.prepare('SELECT * FROM ui_push_subscriptions WHERE company_id = ? AND user_ref = ? AND is_active = 1 AND deleted_at IS NULL ORDER BY id').all(actor.companyId, user(actor));

  const subscriptions = (actor) => mine(actor).map(presentSub);

  /** Remember a browser's push subscription for the person. A browser that changes hands (same address, another person) is moved to the new person. */
  function subscribe(actor, body, userAgent = '') {
    if (!push) throw unprocessable('Push notifications are not set up on this installation yet. Ask a system administrator.');
    const problem = endpointProblem(body.endpoint, { allowHosts });
    if (problem) throw badRequest('Some fields are invalid.', [{ field: 'endpoint', message: problem }]);
    return transaction(db, () => {
      const existing = db.prepare('SELECT * FROM ui_push_subscriptions WHERE endpoint = ?').get(body.endpoint);
      const own = mine(actor);
      if (!existing && own.length >= MAX_SUBSCRIPTIONS) throw unprocessable(`You can keep ${MAX_SUBSCRIPTIONS} devices for notifications. Remove one first.`);
      const at = nowIso();
      let id;
      if (existing) {
        id = existing.id;
        db.prepare('UPDATE ui_push_subscriptions SET company_id = ?, user_ref = ?, p256dh = ?, auth = ?, user_agent = ?, device_label = ?, expires_at = ?, failure_count = 0, is_active = 1, deleted_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(actor.companyId, user(actor), body.keys.p256dh, body.keys.auth, userAgent.slice(0, 300), body.deviceLabel ?? existing.device_label, body.expirationTime ? new Date(body.expirationTime).toISOString() : null, user(actor), at, id);
      } else {
        id = Number(db.prepare("INSERT INTO ui_push_subscriptions (company_id, user_ref, endpoint, p256dh, auth, user_agent, device_label, expires_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'push_subscription')")
          .run(actor.companyId, user(actor), body.endpoint, body.keys.p256dh, body.keys.auth, userAgent.slice(0, 300), body.deviceLabel ?? null, body.expirationTime ? new Date(body.expirationTime).toISOString() : null, user(actor)).lastInsertRowid);
      }
      writeAudit(db, { entity: 'ui_push_subscriptions', entityId: id, action: existing ? 'resubscribe' : 'subscribe', newValues: { host: new URL(body.endpoint).host, deviceLabel: body.deviceLabel ?? null }, actor: user(actor), companyId: actor.companyId });
      publishEvent(db, { type: 'ui.push_subscription.changed', entity: 'push_subscription', entityId: id, actorId: user(actor), companyId: actor.companyId, data: { change: 'subscribed' } });
      return presentSub(db.prepare('SELECT * FROM ui_push_subscriptions WHERE id = ?').get(id));
    });
  }

  /** Stop notifications to one of the person's browsers (by its address or by the row). */
  function unsubscribe(actor, { endpoint, id }) {
    return transaction(db, () => {
      const row = endpoint
        ? db.prepare('SELECT * FROM ui_push_subscriptions WHERE endpoint = ? AND company_id = ? AND user_ref = ? AND is_active = 1').get(endpoint, actor.companyId, user(actor))
        : db.prepare('SELECT * FROM ui_push_subscriptions WHERE id = ? AND company_id = ? AND user_ref = ? AND is_active = 1').get(id, actor.companyId, user(actor));
      if (!row) throw notFound('That device is not subscribed for you.');
      db.prepare('UPDATE ui_push_subscriptions SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), user(actor), user(actor), nowIso(), row.id);
      writeAudit(db, { entity: 'ui_push_subscriptions', entityId: row.id, action: 'unsubscribe', oldValues: { host: new URL(row.endpoint).host }, actor: user(actor), companyId: actor.companyId });
      publishEvent(db, { type: 'ui.push_subscription.changed', entity: 'push_subscription', entityId: row.id, actorId: user(actor), companyId: actor.companyId, data: { change: 'unsubscribed' } });
      return { id: row.id };
    });
  }

  /** A test notification to the person's own devices. A device the push service reports as gone is forgotten. */
  async function sendTest(actor) {
    if (!push) throw unprocessable('Push notifications are not set up on this installation yet. Ask a system administrator.');
    const subs = mine(actor);
    if (subs.length === 0) throw conflict('None of your devices is subscribed. Allow notifications on this device first.');
    const message = { title: 'Construction ERP', body: 'Notifications work on this device.', url: '/field', tag: 'test' };
    const results = [];
    for (const s of subs) {
      const r = await push.send({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, message);
      if (r.gone) {
        db.prepare('UPDATE ui_push_subscriptions SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), 'system', nowIso(), s.id);
      } else if (r.ok) {
        db.prepare('UPDATE ui_push_subscriptions SET last_used_at = ?, failure_count = 0 WHERE id = ?').run(nowIso(), s.id);
      } else {
        db.prepare('UPDATE ui_push_subscriptions SET failure_count = failure_count + 1 WHERE id = ?').run(s.id);
      }
      results.push({ id: s.id, delivered: r.ok, gone: r.gone, status: r.status });
    }
    writeAudit(db, { entity: 'ui_push_subscriptions', entityId: user(actor), action: 'test_notification', newValues: { devices: subs.length, delivered: results.filter((r) => r.delivered).length }, actor: user(actor), companyId: actor.companyId });
    return { results };
  }

  /** The record a scanned code names, if the person may open it. */
  function qrResolve(actor, code) {
    const found = qrRegistry.resolve(db, actor, code);
    if (found.status === 'unknown') throw notFound('That code is not one this application knows, or it names something you cannot open.');
    return found;
  }

  return { settings, subscriptions, subscribe, unsubscribe, sendTest, qrResolve };
}
