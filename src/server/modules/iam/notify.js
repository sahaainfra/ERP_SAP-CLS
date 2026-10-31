import { log } from '../../platform/http/logger.js';

/**
 * Sign-in codes, reset codes and alerts leave through the integration hub (part 01.08): an email connector for email, and
 * connectors of type sms and whatsapp for one-time codes. A connector that does not exist or is switched off means "not
 * delivered" and the caller says so; it never blocks the sign-in flow itself.
 */
export function createNotifier({ identity, integrations }) {
  const system = { user: 'system', roles: [], companyId: null };

  async function call(companyId, code, operation, payload) {
    try {
      const out = await integrations.hub.call(code, operation, payload, { companyId, actor: system });
      return { delivered: true, logId: out.logId };
    } catch (err) {
      log.warn({ msg: 'sign-in message not delivered', connector: code, reason: err.code ?? err.message });
      return { delivered: false, reason: err.code ?? 'ERROR' };
    }
  }

  return {
    email: (companyId, to, subject, text) => call(companyId, identity.policies.for(companyId).notify.connector, 'send', { to: [to], subject, text }),
    /** @param {'sms' | 'whatsapp'} channel */
    phone: (companyId, channel, to, text) => {
      const n = identity.policies.for(companyId).notify;
      return call(companyId, channel === 'sms' ? n.smsConnector : n.whatsappConnector, 'request', { method: 'POST', path: '/send', body: { to, message: text } });
    },
  };
}
