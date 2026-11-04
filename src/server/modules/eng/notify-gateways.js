import { join } from 'node:path';
import { identityOf } from '../../platform/identity/index.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { SkipDelivery, gateways } from '../../platform/notify/index.js';
import { loadVapid, sendPush } from '../../platform/push/index.js';
import { ROOT } from '../../platform/db/index.js';
import { createNotifier } from '../iam/notify.js';
import { commOf } from '../../platform/comm/index.js';

/**
 * The stand-in gateways (part 04.06) until the communication gateway of part 04.07 takes the channels over: e-mail, text message and WhatsApp go through the connectors of the
 * integration hub, as the sign-in messages do; a push goes to the devices the person subscribed. A channel nobody has set up is skipped with the reason, not retried for hours.
 */
/** The push sender: every device the person subscribed, an unreachable one is forgotten. */
export function createPushSender({ db, config, storagePath = null }) {
  const vapid = loadVapid({ config, dir: storagePath ?? config.storagePath ?? join(ROOT, 'data') });
  return async (companyId, userRef, message) => {
    if (!vapid) return { count: 0, reason: 'Push is not set up on this installation' };
    const subs = db.prepare('SELECT * FROM ui_push_subscriptions WHERE company_id = ? AND user_ref = ? AND is_active = 1').all(companyId, userRef);
    if (!subs.length) return { count: 0, reason: 'The person has no subscribed device' };
    let count = 0;
    for (const s of subs) {
      const r = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, message, { vapid });
      if (r.ok) count += 1; else if (r.gone) db.prepare('UPDATE ui_push_subscriptions SET is_active = 0 WHERE id = ?').run(s.id);
    }
    return { count, reason: count ? null : 'No device accepted the push' };
  };
}

/**
 * @param {{db: any, config: any, storagePath?: string|null, commOn?: (companyId: number) => boolean}} opts
 */
export function registerDefaultGateways({ db, config, storagePath = null, commOn = () => false }) {
  const comm = commOf(db);
  const identity = identityOf(db);
  const integrations = integrationsOf(db, { vaultKey: config.vaultKey ?? undefined });
  const notifier = createNotifier({ identity, integrations });
  const settle = (out, what) => {
    if (out.delivered) return { providerMsgId: out.logId ? String(out.logId) : null };
    if (/NOT_FOUND|NOT_CONFIGURED|DISABLED|INACTIVE|UNKNOWN|NO_CONNECTOR/i.test(String(out.reason))) throw new SkipDelivery(`No ${what} connector is set up (${out.reason})`);
    throw new Error(`${what} could not be sent (${out.reason})`);
  };
  /** With the communication gateway on (part 04.07) a notification leaves through it: consent, DLT, failover, the log and the receipts come with it. */
  const viaComm = async (channel, { delivery, notification }) => {
    const data = JSON.parse(notification?.data_json ?? '{}');
    const mandatory = ['security', 'statutory'].includes(notification?.category);
    const r = await comm.sendNow({ companyId: delivery.company_id, channel, to: delivery.address, templateCode: notification?.template_code, data: data.vars ?? {}, body: delivery.body, subject: delivery.subject, purpose: 'TRANSACTIONAL', essential: mandatory, priority: notification?.priority === 'URGENT' ? 1 : 2, noRetry: true, related: data.instanceId ? { entity: 'workflow_instance', id: data.instanceId } : null, source: { type: 'ntf_delivery', id: delivery.id }, projectId: notification?.project_id ?? null, actor: 'system' });
    if (['SENT', 'DELIVERED', 'READ'].includes(r.status)) return { providerMsgId: r.row?.provider_msg_id ?? String(r.id) };
    if (r.status === 'BLOCKED') throw new SkipDelivery(r.message ?? r.row?.last_error ?? r.row?.block_reason ?? 'Blocked by the communication gateway');
    throw new Error(r.row?.last_error ?? 'The communication gateway could not send it');
  };
  const gate = (channel, old) => async (ctx) => (commOn(ctx.delivery.company_id) ? viaComm(channel, ctx) : old(ctx));
  const oldEmail = async ({ delivery }) => settle(await notifier.email(delivery.company_id, delivery.address, delivery.subject, delivery.body), 'e-mail');
  const oldSms = async ({ delivery }) => settle(await notifier.phone(delivery.company_id, 'sms', delivery.address, delivery.body), 'text message');
  const oldWa = async ({ delivery }) => settle(await notifier.phone(delivery.company_id, 'whatsapp', delivery.address, delivery.body), 'WhatsApp');
  if (!gateways.get('EMAIL')) gateways.register('EMAIL', gate('EMAIL', oldEmail));
  if (!gateways.get('SMS')) gateways.register('SMS', gate('SMS', oldSms));
  if (!gateways.get('WHATSAPP')) gateways.register('WHATSAPP', gate('WHATSAPP', oldWa));
  if (!gateways.get('PUSH')) {
    const send = createPushSender({ db, config, storagePath });
    const old = async ({ delivery, notification }) => {
      const r = await send(delivery.company_id, delivery.user_ref, { title: delivery.subject || notification?.title, body: delivery.body, url: notification?.link ?? '/notifications', tag: `ntf-${delivery.notification_id}` });
      if (!r.count) { if (/not set up|no subscribed/i.test(r.reason ?? '')) throw new SkipDelivery(r.reason); throw new Error(r.reason); }
      return { providerMsgId: `push:${r.count}` };
    };
    gateways.register('PUSH', gate('PUSH', old));
  }
}
