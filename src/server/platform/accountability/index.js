import { inTransaction } from '../db/index.js';
import { envelopeOf } from '../events/bus.js';
import { log } from '../http/logger.js';

/**
 * Accountability (part 04.05): the action ledger and the resolution of who is accountable.
 *
 * The ledger is an append-only record of what people did to business objects (created, submitted, verified, approved, rejected, modified, executed, recorded, reconciled,
 * cancelled, reversed, closed). A module feeds it in one of three ways: by an event (`ledgerSources.onEvent('inv.grn.received', (db, event) => entry)`), by the audit trail of
 * its table (`ledgerSources.onAudit('inv_grn', (db, row) => entry)`), or directly (`accountabilityOf(db).record(entry)`). `sync()` reads each feed from where it stopped; an entry is
 * written once per source row and action, so a replay changes nothing. An entry is { companyId, actor, roleCode?, action, entity, entityId, entityRef?, processCode?, projectId?,
 * siteId?, outcome?, dueAt?, onTime?, affectedUser?, occurredAt, details? }.
 */
export const LEDGER_ACTIONS = Object.freeze(['created', 'submitted', 'verified', 'approved', 'rejected', 'modified', 'executed', 'recorded', 'reconciled', 'cancelled', 'reversed', 'closed']);
export const RACI_LETTERS = Object.freeze(['R', 'A', 'C', 'I']);
export const SCOPE_TYPES = Object.freeze(['COMPANY', 'DEPARTMENT', 'PROJECT', 'SITE', 'WBS']);

const eventSources = new Map();
const auditSources = new Map();
export const ledgerSources = {
  onEvent(type, fn) { eventSources.set(type, fn); },
  onAudit(entity, fn) { auditSources.set(entity, fn); },
  eventTypes: () => [...eventSources.keys()],
  auditEntities: () => [...auditSources.keys()],
};

const accountabilities = new WeakMap();
export function accountabilityOf(db) {
  let a = accountabilities.get(db);
  if (!a) { a = createAccountability(db); accountabilities.set(db, a); }
  return a;
}

function createAccountability(db) {
  const iso = () => new Date().toISOString();
  const day = () => iso().slice(0, 10);

  /** The process a document type belongs to, from the templates (a company's own template overrides the shared one). */
  function processOf(companyId, docType) {
    const rows = db.prepare('SELECT company_id, process_code, doc_types_json FROM acc_raci_templates WHERE (company_id IS NULL OR company_id = ?) AND is_active = 1 AND deleted_at IS NULL ORDER BY company_id IS NULL').all(companyId);
    for (const r of rows) if (JSON.parse(r.doc_types_json).includes(docType)) return r.process_code;
    return null;
  }

  /** Write one entry. Returns false when the same source row and action is already there. */
  function record(e, source = {}) {
    if (!LEDGER_ACTIONS.includes(e.action)) throw new Error(`Unknown ledger action ${e.action}`);
    const res = db.prepare(`INSERT OR IGNORE INTO acc_action_ledger (company_id, occurred_at, actor_id, role_code, action, entity, entity_id, entity_ref, process_code, outcome, due_at, on_time, affected_user, details_json, project_id, site_id, created_by, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', ?, ?)`)
      .run(e.companyId, e.occurredAt ?? iso(), e.actor, e.roleCode ?? null, e.action, e.entity, String(e.entityId), e.entityRef ?? null, e.processCode ?? processOf(e.companyId, e.entity), e.outcome ?? 'OK', e.dueAt ?? null,
        e.onTime == null ? null : e.onTime ? 1 : 0, e.affectedUser ?? null, JSON.stringify(e.details ?? {}), e.projectId ?? null, e.siteId ?? null, source.type ?? 'direct', source.id == null ? null : String(source.id));
    return Number(res.changes) > 0;
  }

  const cursor = (t) => db.prepare('SELECT last_id FROM acc_ledger_cursors WHERE source_type = ?').get(t)?.last_id ?? 0;
  const moveCursor = (t, id) => db.prepare('INSERT INTO acc_ledger_cursors (source_type, last_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (source_type) DO UPDATE SET last_id = excluded.last_id, updated_at = excluded.updated_at').run(t, id, iso());

  /** Read the feeds from where they stopped (events of the outbox, rows of the audit trail) and write what they say. Returns the number of entries written. */
  function sync() {
    return inTransaction(db, () => {
      let written = 0;
      const types = [...eventSources.keys()];
      if (types.length) {
        for (;;) {
          const from = cursor('event');
          const rows = db.prepare(`SELECT id, event_type, payload, aggregate_id FROM core_outbox WHERE id > ? AND event_type IN (${types.map(() => '?').join(',')}) ORDER BY id LIMIT 500`).all(from, ...types);
          if (!rows.length) break;
          for (const row of rows) {
            try {
              const event = envelopeOf(row);
              const entry = eventSources.get(row.event_type)(db, event);
              for (const e of [].concat(entry ?? [])) if (e && e.companyId) written += record({ occurredAt: event.occurredAt, ...e }, { type: 'event', id: row.id }) ? 1 : 0;
            } catch (err) { log.warn({ msg: 'ledger: an event could not be read', eventType: row.event_type, outboxId: row.id, error: String(err?.message ?? err) }); }
          }
          moveCursor('event', rows[rows.length - 1].id);
          if (rows.length < 500) break;
        }
        const max = db.prepare('SELECT MAX(id) AS m FROM core_outbox').get().m ?? 0;
        if (max > cursor('event') && !db.prepare(`SELECT 1 FROM core_outbox WHERE id > ? AND event_type IN (${types.map(() => '?').join(',')}) LIMIT 1`).get(cursor('event'), ...types)) moveCursor('event', max);
      }
      const entities = [...auditSources.keys()];
      if (entities.length) {
        for (;;) {
          const from = cursor('audit');
          const rows = db.prepare(`SELECT * FROM core_audit_log WHERE id > ? AND entity IN (${entities.map(() => '?').join(',')}) ORDER BY id LIMIT 500`).all(from, ...entities);
          if (!rows.length) break;
          for (const row of rows) {
            try {
              const entry = auditSources.get(row.entity)(db, row);
              for (const e of [].concat(entry ?? [])) if (e && e.companyId) written += record({ occurredAt: row.created_at, ...e }, { type: 'audit', id: row.id }) ? 1 : 0;
            } catch (err) { log.warn({ msg: 'ledger: an audit row could not be read', entity: row.entity, auditId: row.id, error: String(err?.message ?? err) }); }
          }
          moveCursor('audit', rows[rows.length - 1].id);
          if (rows.length < 500) break;
        }
        const max = db.prepare('SELECT MAX(id) AS m FROM core_audit_log').get().m ?? 0;
        if (max > cursor('audit') && !db.prepare(`SELECT 1 FROM core_audit_log WHERE id > ? AND entity IN (${entities.map(() => '?').join(',')}) LIMIT 1`).get(cursor('audit'), ...entities)) moveCursor('audit', max);
      }
      return written;
    });
  }

  /**
   * Who is accountable for a process here. The most specific scope that has an answer decides: the site, then the project, then the department, then the company.
   * Returns { scope: { type, id }, accountable, responsible: [{ user?, role? }], consulted, informed } or null when nobody is accountable (a gap, FR-06).
   */
  function resolve({ companyId, processCode, projectId = null, siteId = null, departmentId = null, date = day() }) {
    let project = projectId;
    if (!project && siteId) project = db.prepare('SELECT org_project_id AS p FROM org_sites WHERE id = ? AND company_id = ?').get(siteId, companyId)?.p ?? null;
    const scopes = [...(siteId ? [['SITE', siteId]] : []), ...(project ? [['PROJECT', project]] : []), ...(departmentId ? [['DEPARTMENT', departmentId]] : []), ['COMPANY', 0]];
    for (const [type, id] of scopes) {
      const rows = db.prepare(`SELECT user_id, role_code, raci FROM acc_raci_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND process_code = ? AND status = 'ACTIVE' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?) AND is_active = 1 ORDER BY id`).all(companyId, type, id, processCode, date, date);
      const a = rows.find((r) => r.raci === 'A');
      if (!a) continue;
      const of = (l) => rows.filter((r) => r.raci === l).map((r) => (r.user_id ? { user: r.user_id } : { role: r.role_code }));
      return { scope: { type, id }, accountable: a.user_id, responsible: of('R'), consulted: of('C'), informed: of('I') };
    }
    return null;
  }

  return { record, sync, resolve, processOf };
}
