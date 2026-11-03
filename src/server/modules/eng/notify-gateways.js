import { join } from 'node:path';
import { identityOf } from '../../platform/identity/index.js';
import { integrationsOf } from '../../platform/integrations/index.js';
import { SkipDelivery, gateways } from '../../platform/notify/index.js';
import { loadVapid, sendPush } from '../../platform/push/index.js';
import { ROOT } from '../../platform/db/index.js';
import { createNotifier } from '../iam/notify.js';

/**
 * The stand-in gateways (part 04.06) until the communication gateway of part 04.07 takes the channels over: e-mail, text message and WhatsApp go through the connectors of the
 * integration hub, as the sign-in messages do; a push goes to the devices the person subscribed. A channel nobody has set up is skipped with the reason, not retried for hours.
 */
export function registerDefaultGateways({ db, config, storagePath = null }) {
  const identity = identityOf(db);
  const integrations = integrationsOf(db, { vaultKey: config.vaultKey ?? undefined });
  const notifier = createNotifier({ identity, integrations });
  const settle = (out, what) => {
    if (out.delivered) return { providerMsgId: out.logId ? String(out.logId) : null };
    if (/NOT_FOUND|NOT_CONFIGURED|DISABLED|INACTIVE|UNKNOWN|NO_CONNECTOR/i.test(String(out.reason))) throw new SkipDelivery(`No ${what} connector is set up (${out.reason})`);
    throw new Error(`${what} could not be sent (${out.reason})`);
  };
  if (!gateways.get('EMAIL')) gateways.register('EMAIL', async ({ delivery }) => settle(await notifier.email(delivery.company_id, delivery.address, delivery.subject, delivery.body), 'e-mail'));
  if (!gateways.get('SMS')) gateways.register('SMS', async ({ delivery }) => settle(await notifier.phone(delivery.company_id, 'sms', delivery.address, delivery.body), 'text message'));
  if (!gateways.get('WHATSAPP')) gateways.register('WHATSAPP', async ({ delivery }) => settle(await notifier.phone(delivery.company_id, 'whatsapp', delivery.address, delivery.body), 'WhatsApp'));
  if (!gateways.get('PUSH')) {
    const vapid = loadVapid({ config, dir: storagePath ?? config.storagePath ?? join(ROOT, 'data') });
    gateways.register('PUSH', async ({ delivery, notification }) => {
      if (!vapid) throw new SkipDelivery('Push is not set up on this installation');
      const subs = db.prepare('SELECT * FROM ui_push_subscriptions WHERE company_id = ? AND user_ref = ? AND is_active = 1').all(delivery.company_id, delivery.user_ref);
      if (!subs.length) throw new SkipDelivery('The person has no subscribed device');
      let ok = 0;
      for (const s of subs) {
        const r = await sendPush({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth }, { title: delivery.subject || notification?.title, body: delivery.body, url: notification?.link ?? '/notifications', tag: `ntf-${delivery.notification_id}` }, { vapid });
        if (r.ok) ok += 1;
        else if (r.gone) db.prepare('UPDATE ui_push_subscriptions SET is_active = 0 WHERE id = ?').run(s.id);
      }
      if (!ok) throw new Error('No device accepted the push');
      return { providerMsgId: `push:${ok}` };
    });
  }
}
