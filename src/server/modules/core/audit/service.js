import { assertPermission, hasPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { forbidden, notFound } from '../../../platform/http/errors.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';
import { createParameterStore } from '../../../platform/parameters/index.js';
import { maskForView, recordSecurityEvent, sealSegments, verifyChain, writeAudit } from '../../../platform/audit/index.js';

/** Who may see the history of a record: the right to view that kind of record (the auditor sees every kind). */
const HISTORY_PERMISSION = {
  iam_users: 'iam.user.view', iam_user_profiles: 'iam.user.view', iam_roles: 'iam.role.view', iam_assignments: 'iam.assignment.view',
  org_companies: 'org.view', org_branches: 'org.view', org_departments: 'org.view', org_designations: 'org.view', org_projects: 'org.view', org_sites: 'org.view', org_locations: 'org.view', org_cost_centres: 'org.view',
  iam_sod_rules: 'iam.sod.view', iam_sod_violations: 'iam.sod.view', iam_elevations: 'iam.elevation.view', iam_access_campaigns: 'iam.review.view',
  core_change_requests: 'core.requests.view', core_security_settings: 'core.routes.view', core_feature_flags: 'core.flag.view', core_connectors: 'core.connectors.view', core_formulas: 'core.calc.view', core_number_series: 'core.numbering.view',
};

const present = (r) => ({
  id: r.audit_id, seq: r.seq, at: r.occurred_at, actor: r.actor, entity: r.entity, entityId: r.entity_id, action: r.action, reason: r.reason,
  changes: JSON.parse(r.changes_json || '{}'), ip: r.ip, device: r.device, correlationId: r.correlation_id, hash: r.hash, prevHash: r.prev_hash,
});

/** The audit explorer, record history, chain verification, sealed segments, security events and the export log (part 02.06). */
export function createAuditService({ db, now = () => Date.now() }) {
  const cid = (actor) => companyScope(actor).params._company_scope;
  const params = () => createParameterStore(db);
  const FROM = 'FROM core_audit_chain c JOIN core_audit_log a ON a.id = c.audit_id';
  const COLS = 'c.audit_id, c.seq, c.occurred_at, c.ip, c.device, c.changes_json, c.hash, c.prev_hash, a.actor, a.entity, a.entity_id, a.action, a.reason, a.correlation_id';

  const service = {
    /** The audit trail of the company: filters by person, entity, record, action, date and free text. */
    list(actor, query) {
      assertPermission(actor, 'core.audit.view');
      const where = ['c.company_id = :c', "(a.actor LIKE :q ESCAPE '\\' OR a.entity LIKE :q ESCAPE '\\' OR a.entity_id LIKE :q ESCAPE '\\' OR a.action LIKE :q ESCAPE '\\' OR COALESCE(a.reason, '') LIKE :q ESCAPE '\\')"];
      const p = { c: cid(actor), q: likePattern(query.q) };
      for (const [name, col] of [['entity', 'a.entity'], ['entityId', 'a.entity_id'], ['action', 'a.action'], ['correlationId', 'a.correlation_id']]) {
        if (query.filters[name]) { where.push(`${col} = :f_${name}`); p[`f_${name}`] = query.filters[name]; }
      }
      if (query.filters.user) { where.push("a.actor LIKE :f_user ESCAPE '\\'"); p.f_user = likePattern(query.filters.user); }
      if (query.from) { where.push('c.occurred_at >= :from'); p.from = `${query.from}T00:00:00.000Z`; }
      if (query.to) { where.push('c.occurred_at <= :to'); p.to = `${query.to}T23:59:59.999Z`; }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n ${FROM} WHERE ${w}`).get(p).n;
      const order = orderBySql(query.sort, { at: 'c.seq' }, 'c.seq DESC');
      const rows = db.prepare(`SELECT ${COLS} ${FROM} WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...p, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map(present), total, query);
    },

    /** Distinct kinds of record in the trail, for the filter. */
    entities(actor) {
      assertPermission(actor, 'core.audit.view');
      return db.prepare('SELECT a.entity, COUNT(*) AS n FROM core_audit_chain c JOIN core_audit_log a ON a.id = c.audit_id WHERE c.company_id = ? GROUP BY a.entity ORDER BY a.entity').all(cid(actor)).map((r) => ({ entity: r.entity, entries: r.n }));
    },

    /** The History tab of a record: its entries newest first, for anyone who may view that kind of record. Values are masked. */
    history(actor, { entity, id, limit }) {
      const needed = HISTORY_PERMISSION[entity];
      if (!(hasPermission(actor, 'core.audit.view') || (needed && hasPermission(actor, needed)))) throw forbidden(needed ? `Your role does not include ${needed}, which is needed to see the history of this record.` : 'Your role does not include core.audit.view, which is needed to see the history of this record.');
      const rows = db.prepare(`SELECT ${COLS} ${FROM} WHERE c.company_id = ? AND a.entity = ? AND a.entity_id = ? ORDER BY c.seq DESC LIMIT ?`).all(cid(actor), entity, id, limit);
      return rows.map((r) => maskForView(present(r)));
    },

    // ---- chain verification and sealing ----
    verification(actor) {
      assertPermission(actor, 'core.audit.view');
      const runs = db.prepare('SELECT * FROM core_audit_verifications ORDER BY id DESC LIMIT 10').all().map((r) => ({ id: r.id, startedAt: r.started_at, finishedAt: r.finished_at, trigger: r.trigger, checked: r.checked, ok: Boolean(r.ok), brokenSeq: r.broken_seq, problem: r.problem }));
      const head = db.prepare('SELECT seq, hash FROM core_audit_chain ORDER BY seq DESC LIMIT 1').get();
      return { entries: head?.seq ?? 0, headHash: head?.hash ?? null, last: runs[0] ?? null, runs, healthy: runs[0] ? runs[0].ok : null };
    },

    /** Walk the whole chain and record the result. A failure is a critical security event, once for each new break. */
    runVerification(trigger, actorName = 'system') {
      const started = new Date(now()).toISOString();
      const r = verifyChain(db);
      return transaction(db, () => {
        db.prepare('INSERT INTO core_audit_verifications (started_at, finished_at, trigger, checked, ok, broken_seq, problem, head_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(started, new Date(now()).toISOString(), trigger, r.checked, r.ok ? 1 : 0, r.brokenSeq, r.problem, r.headHash);
        if (!r.ok) {
          const prior = db.prepare('SELECT broken_seq, problem FROM core_audit_verifications WHERE ok = 0 ORDER BY id DESC LIMIT 1 OFFSET 1').get();
          if (!(prior && prior.broken_seq === r.brokenSeq && prior.problem === r.problem)) {
            // the event is also written to the security log, as critical, in this transaction (platform/audit/security.js)
            publishEvent(db, { type: 'core.audit.tamper_detected', entity: 'audit_chain', entityId: String(r.brokenSeq ?? 0), actorId: actorName, data: { brokenSeq: r.brokenSeq ?? 0, problem: r.problem ?? '', checked: r.checked } });
          }
        }
        return { ok: r.ok, checked: r.checked, brokenSeq: r.brokenSeq, problem: r.problem };
      });
    },

    verifyNow(actor) {
      assertPermission(actor, 'core.audit.verify');
      return service.runVerification('manual', actor.user);
    },

    /** The monthly job: seal each finished month. Sealed segments are listed and can be exported; nothing is deleted (FR-07). */
    sealDue() {
      return transaction(db, () => ({ sealed: sealSegments(db, now()) }));
    },
    segments(actor) {
      assertPermission(actor, 'core.audit.view');
      const months = Number(params().get('core.audit.retention_months', { companyId: cid(actor), date: new Date(now() + 19_800_000).toISOString().slice(0, 10) }));
      const cut = new Date(now());
      cut.setUTCMonth(cut.getUTCMonth() - months);
      const cutPeriod = cut.toISOString().slice(0, 7);
      return { retentionMonths: months, segments: db.prepare('SELECT * FROM core_audit_segments ORDER BY period DESC').all().map((s) => ({ period: s.period, firstSeq: s.first_seq, lastSeq: s.last_seq, entries: s.entry_count, headHash: s.head_hash, sealedAt: s.sealed_at, pastRetention: s.period < cutPeriod })) };
    },
    /** One sealed month as newline-delimited JSON, checked against its seal before it leaves. */
    exportSegment(actor, period) {
      assertPermission(actor, 'core.audit.view');
      const s = db.prepare('SELECT * FROM core_audit_segments WHERE period = ?').get(period);
      if (!s) throw notFound('That month has not been sealed.');
      const rows = db.prepare(`SELECT ${COLS} ${FROM} WHERE c.seq BETWEEN ? AND ? AND c.company_id = ? ORDER BY c.seq`).all(s.first_seq, s.last_seq, cid(actor));
      return { head: s.head_hash, lines: rows.map((r) => JSON.stringify(maskForView(present(r)))) };
    },

    // ---- security events ----
    securityEvents(actor, query) {
      assertPermission(actor, 'core.security.view');
      const c = cid(actor);
      // events that belong to no one company (an unknown user's sign-in, a broken chain) are shown to every administrator
      const where = ['(e.company_id = :c OR e.company_id IS NULL)', "(COALESCE(e.username, '') LIKE :q ESCAPE '\\' OR e.type LIKE :q ESCAPE '\\' OR COALESCE(e.ip, '') LIKE :q ESCAPE '\\')"];
      const p = { c, q: likePattern(query.q) };
      for (const [name, col] of [['severity', 'e.severity'], ['type', 'e.type']]) {
        if (query.filters[name]) { where.push(`${col} = :f_${name}`); p[`f_${name}`] = query.filters[name]; }
      }
      if (query.filters.user) { where.push("e.username LIKE :f_user ESCAPE '\\'"); p.f_user = likePattern(query.filters.user); }
      if (query.from) { where.push('e.occurred_at >= :from'); p.from = `${query.from}T00:00:00.000Z`; }
      if (query.to) { where.push('e.occurred_at <= :to'); p.to = `${query.to}T23:59:59.999Z`; }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_security_events e WHERE ${w}`).get(p).n;
      const order = orderBySql(query.sort, { at: 'e.id', severity: 'e.severity' }, 'e.id DESC');
      const rows = db.prepare(`SELECT e.* FROM core_security_events e WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...p, limit: query.limit, offset: query.offset });
      const since = new Date(now() - 86_400_000).toISOString();
      const sum = db.prepare("SELECT COUNT(*) AS total, SUM(severity = 'CRITICAL') AS critical, SUM(severity = 'HIGH') AS high, SUM(severity = 'WARNING') AS warning FROM core_security_events e WHERE (e.company_id = ? OR e.company_id IS NULL) AND e.occurred_at >= ?").get(c, since);
      const types = db.prepare('SELECT DISTINCT type FROM core_security_events WHERE company_id = ? OR company_id IS NULL ORDER BY type').all(c).map((t) => t.type);
      return {
        ...pageResponse(rows.map((e) => ({ id: e.id, at: e.occurred_at, username: e.username, type: e.type, severity: e.severity, details: maskForView(JSON.parse(e.details_json)), ip: e.ip, correlationId: e.correlation_id })), total, query),
        summary: { last24h: sum.total, critical: sum.critical ?? 0, high: sum.high ?? 0, warning: sum.warning ?? 0 }, types,
      };
    },

    // ---- export and print log (FR-05) ----
    /** Record that a person exported or printed something: what, in which format, how many rows and with which filters. */
    logExport(actor, { report, format, rows, filters, sensitive }) {
      const action = format === 'print' ? 'print' : 'export';
      return transaction(db, () => {
        writeAudit(db, { entity: 'report', entityId: report, action, newValues: { format, rows, filters }, actor: actor.user, companyId: actor.companyId });
        if (sensitive) recordSecurityEvent(db, { companyId: actor.companyId, userId: actor.userId ?? null, username: actor.user, type: 'export.sensitive', severity: 'WARNING', details: { report, format, rows, filters } });
        return { logged: true };
      });
    },
  };
  return service;
}

/** Copy sign-in failures recorded before this part into the security event log, once each (FR-08). Read-only history. */
export function importLegacyLoginEvents(db) {
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  if (!has('core_security_events') || !has('iam_login_events')) return { imported: 0 };
  const map = { failure: 'login.failure', mfa_failed: 'mfa.failed', pin_failed: 'pin.failed' };
  let imported = 0;
  for (const e of db.prepare("SELECT * FROM iam_login_events WHERE result IN ('failure', 'mfa_failed', 'pin_failed') ORDER BY id").all()) {
    const id = recordSecurityEvent(db, { companyId: e.company_id, userId: e.user_id, username: e.username_attempted, type: map[e.result], severity: 'WARNING', details: { reason: e.reason, imported: true }, ip: e.ip, sourceType: 'iam_login_events', sourceId: e.id, occurredAt: e.at });
    if (id) imported += 1;
  }
  return { imported };
}
