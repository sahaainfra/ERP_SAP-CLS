import { writeAudit } from '../audit/index.js';
import { publishEvent } from '../events/index.js';
import { unprocessable } from '../http/errors.js';
import { securitySettingsOf, settingsSchema } from './settings.js';

/** What approved requests of part 02.07 change: the security settings, and the right to run one bulk personal-data export. */
export const securityHandlers = {
  security_settings_change: {
    apply(db, request, actor) {
      const next = settingsSchema.safeParse(request.payload.settings);
      if (!next.success) throw unprocessable('The requested settings are no longer valid, so they cannot be applied.');
      const store = securitySettingsOf(db);
      const before = store.get();
      store.write(next.data, actor.user);
      writeAudit(db, { entity: 'core_security_settings', entityId: 1, action: 'change_approved', oldValues: flat(before.settings), newValues: flat(next.data), reason: request.reason, actor: actor.user, companyId: request.companyId });
      publishEvent(db, { type: 'core.security.settings_changed', entity: 'security_settings', entityId: 1, actorId: actor.user, companyId: request.companyId, data: { version: before.version + 1, requestId: request.id } });
    },
  },
  bulk_personal_export: {
    apply(db, request, actor) {
      writeAudit(db, { entity: 'export_grant', entityId: request.id, action: 'approved', newValues: { report: request.payload.report, rows: request.payload.rows }, reason: request.reason, actor: actor.user, companyId: request.companyId });
    },
  },
};

/** One level of keys, with nested objects as text, so the audit diff shows which setting changed. */
function flat(o, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    const name = k === 'rateLimits' ? 'limits' : k; // the word "rate" would make the audit mask the figures
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flat(v, `${prefix}${name}.`));
    else out[`${prefix}${name}`] = v;
  }
  return out;
}
