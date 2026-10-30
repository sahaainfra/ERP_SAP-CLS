import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { assertVersion } from '../../../platform/db/repository.js';
import { conflict, unprocessable } from '../../../platform/http/errors.js';
import { createSettingsRepository } from './repository.js';

export const DEFAULTS = Object.freeze({
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  dateFormat: 'DD-MMM-YYYY',
  numberFormat: 'indian',
  fyStartMonth: 4,
});

const present = (r) => ({
  persisted: true,
  id: r.id,
  companyId: r.company_id,
  legalName: r.legal_name,
  tradeName: r.trade_name,
  address: JSON.parse(r.address_json),
  gstins: JSON.parse(r.gstins_json),
  pan: r.pan,
  cin: r.cin,
  logoFileId: r.logo_file_id,
  currency: r.currency,
  timezone: r.timezone,
  dateFormat: r.date_format,
  numberFormat: r.number_format,
  fyStartMonth: r.fy_start_month,
  version: r.version,
  updatedBy: r.updated_by ?? r.created_by,
  updatedAt: r.updated_at ?? r.created_at,
  lastReason: r.remarks,
});

/** The company's settings when none were saved yet: the India defaults, flagged as not persisted. */
const empty = (companyId) => ({
  persisted: false,
  id: null,
  companyId,
  legalName: '',
  tradeName: null,
  address: { line1: '', line2: '', city: '', stateCode: '', pincode: '' },
  gstins: [],
  pan: null,
  cin: null,
  logoFileId: null,
  ...DEFAULTS,
  version: 0,
});

export function createSettingsService({ db }) {
  const repo = createSettingsRepository(db);
  return {
    /** The month the company's financial year starts (April when nothing is saved). For other core services. */
    fyStartMonthOf: (companyId) => repo.find(companyId)?.fy_start_month ?? DEFAULTS.fyStartMonth,

    /** Full settings including tax identity: for roles that may see it. */
    get(actor) {
      assertPermission(actor, 'core.settings.view');
      const companyId = actor.companyId;
      companyScope(actor);
      const row = repo.find(companyId);
      return row ? present(row) : empty(companyId);
    },

    /** Only what every screen needs to display numbers and dates (all signed-in users). No tax identity. */
    display(actor) {
      const row = actor.companyId == null ? null : repo.find(actor.companyId);
      const s = row ? present(row) : empty(actor.companyId);
      return { companyId: s.companyId, legalName: s.legalName || null, currency: s.currency, timezone: s.timezone, dateFormat: s.dateFormat, numberFormat: s.numberFormat, fyStartMonth: s.fyStartMonth };
    },

    save(actor, v, correlationId) {
      assertPermission(actor, 'core.settings.configure');
      const scope = companyScope(actor);
      const companyId = scope.params._company_scope;
      return transaction(db, () => {
        const existing = repo.find(companyId);
        const now = new Date().toISOString();
        const before = existing ? present(existing) : null;
        if (existing) {
          assertVersion(existing.version, v.version, 'The company settings', 'Refresh the page and try again.');
          if (existing.fy_start_month !== v.fyStartMonth && repo.financialYearCount(companyId) > 0) {
            throw unprocessable('The financial year start month cannot change once financial years exist, because their dates would no longer match. Close and archive them first (part 23.14) or keep the current month.');
          }
          if (!repo.update(existing.id, existing.version, v, actor.user, now)) throw conflict('The company settings were changed by someone else. Refresh the page and try again.');
        } else {
          if (v.version !== undefined && v.version !== 0) throw conflict('These settings do not exist yet; start from an empty form.');
          repo.insert(companyId, v, actor.user, now);
        }
        const saved = present(repo.find(companyId));
        writeAudit(db, { entity: 'core_company_settings', entityId: saved.id, action: existing ? 'update' : 'create', oldValues: before && summary(before), newValues: summary(saved), reason: v.reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.company_settings.changed', entity: 'company_settings', entityId: saved.id, version: saved.version, actorId: actor.user, companyId, data: { fyStartMonth: saved.fyStartMonth, currency: saved.currency } });
        return saved;
      });
    },
  };
}

// Audit rows keep what changed, without repeating the whole tax identity into the log.
const summary = (s) => ({ legalName: s.legalName, gstinCount: s.gstins.length, pan: Boolean(s.pan), cin: Boolean(s.cin), currency: s.currency, timezone: s.timezone, dateFormat: s.dateFormat, numberFormat: s.numberFormat, fyStartMonth: s.fyStartMonth, version: s.version });
