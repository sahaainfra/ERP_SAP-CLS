import { ident } from '../db/schema.js';

/** The workflow states of standards section 7; the default list of allowed `status` values. */
export const STANDARD_STATES = ['DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'CLOSED', 'REVERSED', 'SUPERSEDED'];

/** Tables that are plumbing, not business records: exempt from the business-table rules. */
export const BUILT_IN_TECHNICAL_TABLES = ['core_outbox', 'core_audit_log', 'core_idempotency_keys'];

/**
 * What the integrity checks and the schema lint need to know that the schema cannot say: which tables are
 * technical, where company_id may be empty, which status values are allowed, which headers must equal the sum of
 * their lines, which journals must balance. Each module registers its own tables when it is built; anything that
 * follows the standard column names is also found automatically.
 */
export function createIntegrityRegistry() {
  const rules = {
    technicalTables: new Set(BUILT_IN_TECHNICAL_TABLES),
    companyOptional: new Set(),
    statuses: new Map(),
    allowNegative: new Set(),
    headerLines: [],
    journals: [],
    uniqueKeys: [],
    sequences: [],
  };
  return {
    rules,
    register(meta) {
      const m = meta ?? {};
      for (const t of m.technicalTables ?? []) rules.technicalTables.add(ident(t));
      for (const t of m.companyOptional ?? []) rules.companyOptional.add(ident(t));
      for (const [table, list] of Object.entries(m.statuses ?? {})) rules.statuses.set(ident(table), [...list]);
      for (const tc of m.allowNegative ?? []) {
        const [t, c] = tc.split('.');
        rules.allowNegative.add(`${ident(t)}.${ident(c)}`);
      }
      for (const h of m.headerLines ?? []) {
        rules.headerLines.push({
          header: ident(h.header),
          line: ident(h.line),
          headerKey: ident(h.headerKey ?? 'id'),
          lineKey: ident(h.lineKey),
          headerTotal: ident(h.headerTotal),
          lineAmount: ident(h.lineAmount),
        });
      }
      for (const j of m.journals ?? []) rules.journals.push({ table: ident(j.table), group: ident(j.group), debit: ident(j.debit), credit: ident(j.credit) });
      // sequences: numbers that must run without gaps within a group, for example the issued numbers of a gap-free series.
      // `where` is SQL written by the module (never user input) that picks the rows the rule applies to.
      for (const q of m.sequences ?? []) rules.sequences.push({ table: ident(q.table), groupBy: q.groupBy.map(ident), seq: ident(q.seq), where: q.where ?? '' });
      for (const u of m.uniqueKeys ?? []) rules.uniqueKeys.push({ table: ident(u.table), columns: u.columns.map(ident) });
    },
  };
}

/** The registry the application uses; modules register into it when they are loaded. */
export const integrityRegistry = createIntegrityRegistry();
