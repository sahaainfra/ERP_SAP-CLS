import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { conflict, forbidden, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, pageResponse } from '../../../platform/pagination/index.js';
import { coerce } from '../../../platform/parameters/index.js';
import { formatBusinessDate, todayIST } from '../../../../shared/dates.js';
import { createParameterRepository } from './repository.js';

const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const presentRow = (r, today) => ({
  id: r.id,
  key: r.key,
  value: r.value,
  dataType: r.data_type,
  scopeType: r.scope_type,
  scopeId: r.scope_id,
  effectiveFrom: r.effective_from,
  effectiveTo: r.effective_to,
  state: r.effective_from > today ? 'future' : r.effective_to && r.effective_to < today ? 'past' : 'current',
  changedBy: r.created_by,
  changedAt: r.created_at,
  reason: r.remarks,
});

export function createParameterService({ db, store, registry }) {
  const repo = createParameterRepository(db);
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const defOrThrow = (key) => registry.get(key) ?? (() => { throw notFound(`"${key}" is not a defined parameter.`); })();

  return {
    definitions(actor) {
      assertPermission(actor, 'core.param.view');
      return registry.list().map((d) => ({ key: d.key, dataType: d.dataType, default: d.default, description: d.description, scopes: d.scopes, min: d.min ?? null, max: d.max ?? null, allowed: d.allowed ?? null }));
    },

    list(actor, query) {
      assertPermission(actor, 'core.param.view');
      const today = todayIST();
      const { rows, total } = repo.list({ companyId: companyOf(actor), q: likePattern(query.q), key: query.filters.key, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((r) => presentRow(r, today)), total, query);
    },

    /** The value in force for the caller's company on a date, and which scope supplied it. */
    resolve(actor, { key, date, projectId, siteId }) {
      assertPermission(actor, 'core.param.view');
      defOrThrow(key);
      const r = store.resolve(key, { companyId: companyOf(actor), projectId: projectId ?? null, siteId: siteId ?? null, date: date ?? todayIST() });
      return { key, value: r.text, source: r.source, effectiveFrom: r.effectiveFrom };
    },

    /**
     * Set a value from a date onward (BR-03). History is kept: the row in force on the previous day is closed and
     * a new row starts on the effective date; a later row, if any, limits the new one. Past dates are refused, so
     * what applied yesterday is never rewritten.
     */
    set(actor, { key, value, scopeType, scopeId, effectiveFrom, reason }, correlationId) {
      const def = defOrThrow(key);
      assertPermission(actor, scopeType === 'system' ? 'core.param.configure_system' : 'core.param.configure');
      const companyId = companyOf(actor);
      // part 29.01, BR-01: with the control center on, a company value changes only by an approved change request (which applies it here)
      if (scopeType !== 'system' && !actor.viaChangeRequest && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'adm_controls'").get()
        && db.prepare("SELECT enabled FROM core_feature_flags WHERE key = 'ff.admin.p2901' AND company_id = ? AND project_id IS NULL AND deleted_at IS NULL ORDER BY id DESC LIMIT 1").get(companyId)?.enabled === 1) {
        throw unprocessable('Parameters of this company are changed through the Enterprise Control Center: raise a change request there for a checker to approve.');
      }
      if (!def.scopes.includes(scopeType)) throw unprocessable(`${key} can be set at ${def.scopes.join(' or ')} level, not ${scopeType}.`);
      if (scopeType === 'company' && scopeId !== companyId) throw forbidden('You can only set parameters for your own company.');
      if (scopeType === 'system' && scopeId != null) throw unprocessable('A system-level value has no scope id.');
      const today = todayIST();
      if (effectiveFrom < today) throw unprocessable(`A value cannot start in the past (${formatBusinessDate(effectiveFrom)}): that would rewrite what already applied. Choose today or a later date.`);
      const canonical = coerce(def, value);
      return transaction(db, () => {
        const rows = repo.forScope(key, scopeType, scopeId);
        if (rows.some((r) => r.effective_from === effectiveFrom)) throw conflict(`${key} already has a value starting on ${formatBusinessDate(effectiveFrom)} at this level. Choose a different date.`);
        const prev = rows.filter((r) => r.effective_from < effectiveFrom).at(-1);
        const next = rows.find((r) => r.effective_from > effectiveFrom);
        const now = new Date().toISOString();
        if (prev && (prev.effective_to === null || prev.effective_to >= effectiveFrom)) repo.closeRow(prev.id, addDays(effectiveFrom, -1), actor.user, now);
        const id = repo.insert(
          { key, value: canonical, dataType: def.dataType, scopeType, scopeId: scopeType === 'system' ? null : scopeId, effectiveFrom, effectiveTo: next ? addDays(next.effective_from, -1) : null, companyId: scopeType === 'system' ? null : companyId, reason },
          actor.user,
        );
        writeAudit(db, { entity: 'core_parameters', entityId: id, action: 'set', oldValues: prev ? { value: prev.value, effectiveFrom: prev.effective_from } : null, newValues: { key, value: canonical, scopeType, scopeId, effectiveFrom }, reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.parameter.changed', entity: 'parameter', entityId: id, actorId: actor.user, companyId, data: { key, scopeType, scopeId, effectiveFrom } });
        store.invalidate();
        return presentRow(db.prepare('SELECT * FROM core_parameters WHERE id = ?').get(id), today);
      });
    },
  };
}
