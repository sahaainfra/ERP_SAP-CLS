import { inTransaction, transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { assertPermission } from '../../../platform/auth/index.js';
import { assertVersion } from '../../../platform/db/repository.js';
import { companyScope } from '../../../platform/db/scope.js';
import { HttpError, conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { pageResponse } from '../../../platform/pagination/index.js';
import { STATUTORY_MAX_LENGTH, formatNumber, formatProblems, periodKeyFor, tokensUsed } from '../../../../shared/numbering.js';
import { formatBusinessDate, todayIST } from '../../../../shared/dates.js';
import { findFinancialYear } from '../financial-years/service.js';
import { createNumberingRepository } from './repository.js';

const fail = (code, message) => new HttpError(422, code, message);

/** Work out which series, which counter and which values apply to a request for a number. No writes. */
function resolve(repo, db, ctx) {
  const date = ctx.date ?? todayIST();
  const dt = repo.docTypeByCode(ctx.docType);
  if (!dt || !dt.is_active) throw fail('DOCUMENT_TYPE_UNKNOWN', `"${ctx.docType}" is not an active document type. Register it under Document Types first.`);
  if (ctx.point && dt.assign_at !== ctx.point) {
    throw fail('NUMBERING_POINT_MISMATCH', `${dt.name} numbers are assigned at ${dt.assign_at}, not at ${ctx.point}. Ask for the number at the configured step.`);
  }
  const series = repo.findSeries(ctx.companyId, dt.id, ctx.branchCode ?? null, ctx.projectId ?? null);
  if (!series) {
    throw fail('NUMBER_SERIES_MISSING', `No numbering series is set up for ${dt.name} (company${ctx.branchCode ? `, branch ${ctx.branchCode}` : ''}${ctx.projectId ? `, project ${ctx.projectId}` : ''}). Ask the System Administrator to create one under Document Types & Numbering.`);
  }
  const used = tokensUsed(series.format);
  const fy = findFinancialYear(db, ctx.companyId, date);
  if (!fy && (series.reset_rule === 'financial_year' || used.has('FY') || used.has('FYS'))) {
    throw fail('FINANCIAL_YEAR_MISSING', `No financial year covers ${formatBusinessDate(date)}, so a number cannot be formed. Ask the System Administrator to create the financial year.`);
  }
  const values = {
    prefix: series.prefix,
    branch: series.branch_code ?? ctx.branchCode,
    project: ctx.projectCode ?? (ctx.projectId != null ? String(ctx.projectId) : undefined),
    fy: fy?.code,
    date,
  };
  return { dt, series, values, periodKey: periodKeyFor(series.reset_rule, { fy: fy?.code, date }) };
}

function build(r, seq) {
  let number;
  try {
    number = formatNumber(r.series.format, { ...r.values, seq });
  } catch (err) {
    throw fail('NUMBER_FORMAT_INCOMPLETE', `The number cannot be formed: ${err.message}. Supply it when asking for the number.`);
  }
  if ((r.dt.statutory || r.series.gap_free) && number.length > STATUTORY_MAX_LENGTH) {
    throw fail('NUMBER_TOO_LONG', `The number ${number} has ${number.length} characters; a statutory number may have at most ${STATUTORY_MAX_LENGTH}. Shorten the series format.`);
  }
  return number;
}

/** What the next number would be, without using it. */
export function previewNumber(db, ctx) {
  const repo = createNumberingRepository(db);
  const r = resolve(repo, db, ctx);
  const seq = repo.peek(r.series.id, r.periodKey) ?? r.series.seq_start;
  return { number: build(r, seq), seq, seriesId: r.series.id, periodKey: r.periodKey, gapFree: r.series.gap_free === 1, docType: r.dt.code };
}

/**
 * Issue the next number (FR-04, BR-01). Two requests can never get the same number: the counter moves in one SQL
 * statement inside a write transaction. A gap-free series must be issued inside the caller's own transaction,
 * the one that also saves the document, so a failure rolls the number back and nothing is skipped (T-02).
 * A cancelled document keeps its number: call cancelNumber, never delete.
 */
export function issueNumber(db, ctx) {
  const repo = createNumberingRepository(db);
  const outer = db.isTransaction;
  const r = resolve(repo, db, ctx);
  if (r.series.gap_free === 1 && !outer) {
    throw new Error('A gap-free number must be issued inside the transaction that saves the document, so it rolls back with it. Wrap the create or submit in transaction(db, ...).');
  }
  return inTransaction(db, () => {
    const seq = repo.take(r.series.id, r.periodKey, r.series.seq_start);
    const number = build(r, seq);
    repo.insertIssue(
      { companyId: ctx.companyId, seriesId: r.series.id, docTypeId: r.dt.id, periodKey: r.periodKey, seq, number, refType: ctx.refType ?? null, refId: ctx.refId == null ? null : String(ctx.refId), projectId: ctx.projectId ?? null },
      ctx.actor ?? 'system',
    );
    return { number, seq, seriesId: r.series.id, periodKey: r.periodKey, gapFree: r.series.gap_free === 1, docType: r.dt.code };
  });
}

/** A cancelled document keeps its number; the issue log records it as CANCELLED. */
export function cancelNumber(db, { companyId, docType, number, actor = 'system' }) {
  const repo = createNumberingRepository(db);
  const dt = repo.docTypeByCode(docType);
  if (!dt) throw fail('DOCUMENT_TYPE_UNKNOWN', `"${docType}" is not a document type.`);
  return repo.cancelIssue(companyId, dt.id, number, actor, new Date().toISOString());
}

const presentType = (t) => ({
  id: t.id,
  code: t.code,
  name: t.name,
  module: t.module,
  templateId: t.template_id,
  workflowCode: t.workflow_code,
  retentionClass: t.retention_class,
  statutory: t.statutory === 1,
  assignAt: t.assign_at,
  version: t.version,
});

const presentSeries = (s, extra = {}) => ({
  id: s.id,
  docType: s.doc_type_code,
  docTypeId: s.doc_type_id,
  name: s.name,
  prefix: s.prefix,
  format: s.format,
  gapFree: s.gap_free === 1,
  resetRule: s.reset_rule,
  seqStart: s.seq_start,
  branchCode: s.branch_code,
  projectId: s.project_id,
  isActive: s.is_active === 1,
  version: s.version,
  ...extra,
});

const SUBSTANTIVE = ['prefix', 'format', 'gapFree', 'resetRule', 'seqStart', 'branchCode', 'projectId'];

export function createNumberingService({ db, approvals }) {
  const repo = createNumberingRepository(db);
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const typeOrThrow = (code) => repo.docTypeByCode(code) ?? (() => { throw notFound(`"${code}" is not a document type.`); })();

  /** Validate a complete series definition against its document type. Throws 422 listing what is wrong. */
  function checkDefinition(dt, def) {
    const statutory = dt.statutory === 1 || def.gapFree;
    if (dt.statutory === 1 && !def.gapFree) throw unprocessable(`${dt.name} is a statutory document type, so its series must be gap-free.`);
    const problems = formatProblems(def.format, { resetRule: def.resetRule, statutory, sample: { prefix: def.prefix, branch: def.branchCode ?? 'XXXX' } });
    if (tokensUsed(def.format).has('PREFIX') && !def.prefix) problems.push('The format uses {PREFIX}, so the series needs a prefix');
    if (problems.length) throw unprocessable(`The number format is not valid: ${problems.join('; ')}.`);
  }

  function usageOf(series) {
    const used = repo.seriesUsed(series.id);
    let next = null;
    let previewNote = null;
    try {
      next = previewNumber(db, { companyId: series.company_id, docType: series.doc_type_code, branchCode: series.branch_code, projectId: series.project_id, date: todayIST() }).number;
    } catch (err) {
      previewNote = err.message;
    }
    return { used, issued: repo.issuedCount(series.id), nextNumber: next, previewNote };
  }

  return {
    // ---- document types ----
    listDocTypes(actor) {
      assertPermission(actor, 'core.numbering.view');
      return repo.docTypes().map(presentType);
    },

    createDocType(actor, v, correlationId) {
      assertPermission(actor, 'core.numbering.configure');
      return transaction(db, () => {
        if (repo.docTypeByCode(v.code)) throw conflict(`The document type ${v.code} already exists.`);
        if (v.statutory && v.retentionClass !== 'statutory') throw unprocessable('A statutory document type must have the statutory retention class.');
        const id = repo.insertDocType(v, actor.user);
        writeAudit(db, { entity: 'core_document_types', entityId: id, action: 'create', newValues: v, reason: v.reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.document_type.created', entity: 'document_type', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: v.code } });
        return presentType(repo.docTypeById(id));
      });
    },

    updateDocType(actor, id, v, correlationId) {
      assertPermission(actor, 'core.numbering.configure');
      return transaction(db, () => {
        const t = repo.docTypeById(id) ?? (() => { throw notFound('That document type does not exist.'); })();
        assertVersion(t.version, v.version, `The document type ${t.code}`, 'Refresh the page and try again.');
        const changesRule = (v.statutory ?? t.statutory === 1) !== (t.statutory === 1) || (v.assignAt ?? t.assign_at) !== t.assign_at;
        if (changesRule && repo.docTypeUsed(id)) throw unprocessable(`Numbers have already been issued for ${t.code}, so whether it is statutory and when it is numbered can no longer change. Create a new document type instead.`);
        const next = {
          name: v.name ?? t.name,
          templateId: v.templateId === undefined ? t.template_id : v.templateId,
          workflowCode: v.workflowCode === undefined ? t.workflow_code : v.workflowCode,
          retentionClass: v.retentionClass ?? t.retention_class,
          statutory: v.statutory ?? t.statutory === 1,
          assignAt: v.assignAt ?? t.assign_at,
          isActive: v.isActive ?? t.is_active === 1,
        };
        if (next.statutory && next.retentionClass !== 'statutory') throw unprocessable('A statutory document type must have the statutory retention class.');
        if (!repo.updateDocType(id, t.version, next, actor.user, new Date().toISOString())) throw conflict('The document type was changed by someone else. Refresh and try again.');
        writeAudit(db, { entity: 'core_document_types', entityId: id, action: 'update', oldValues: presentType(t), newValues: next, reason: v.reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.document_type.changed', entity: 'document_type', entityId: id, actorId: actor.user, companyId: actor.companyId, data: { code: t.code } });
        return presentType(repo.docTypeById(id));
      });
    },

    // ---- series ----
    listSeries(actor, { docType }) {
      assertPermission(actor, 'core.numbering.view');
      const companyId = companyOf(actor);
      const dt = docType ? typeOrThrow(docType) : null;
      return repo.seriesList(companyId, dt?.id).map((s) => presentSeries(s, usageOf(s)));
    },

    getSeries(actor, id) {
      assertPermission(actor, 'core.numbering.view');
      const s = repo.seriesById(id, companyOf(actor)) ?? (() => { throw notFound('That numbering series does not exist.'); })();
      return presentSeries(s, usageOf(s));
    },

    createSeries(actor, v, correlationId) {
      assertPermission(actor, 'core.numbering.configure');
      const companyId = companyOf(actor);
      const dt = typeOrThrow(v.docType);
      checkDefinition(dt, v);
      return transaction(db, () => {
        if (repo.seriesScopeTaken(companyId, dt.id, v.branchCode, v.projectId)) throw conflict(`A series for ${dt.name} with this branch and project already exists. Edit it instead.`);
        const id = repo.insertSeries(companyId, { ...v, docTypeId: dt.id }, actor.user);
        writeAudit(db, { entity: 'core_number_series', entityId: id, action: 'create', newValues: { docType: dt.code, format: v.format, gapFree: v.gapFree, resetRule: v.resetRule }, reason: v.reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.number_series.created', entity: 'number_series', entityId: id, actorId: actor.user, companyId, data: { docType: dt.code } });
        const s = repo.seriesById(id, companyId);
        return presentSeries(s, usageOf(s));
      });
    },

    /** Edit a series. Once a number has been issued, anything that could change the numbers needs a change request. */
    updateSeries(actor, id, v, correlationId) {
      assertPermission(actor, 'core.numbering.configure');
      const companyId = companyOf(actor);
      return transaction(db, () => {
        const s = repo.seriesById(id, companyId) ?? (() => { throw notFound('That numbering series does not exist.'); })();
        assertVersion(s.version, v.version, `The series ${s.name}`, 'Refresh the page and try again.');
        const dt = repo.docTypeById(s.doc_type_id);
        const next = mergeSeries(s, v);
        const changed = SUBSTANTIVE.filter((k) => !same(next[k], current(s)[k]));
        if (changed.length && repo.seriesUsed(id)) {
          throw new HttpError(422, 'CHANGE_REQUEST_REQUIRED', `Numbers have already been issued from ${s.name}, so ${changed.join(', ')} can only change through an approved change request. Use "Request change".`);
        }
        if (changed.length) {
          checkDefinition(dt, next);
          if (repo.seriesScopeTaken(companyId, s.doc_type_id, next.branchCode, next.projectId, id)) throw conflict('Another series already uses this branch and project for the document type.');
        }
        if (!repo.updateSeries(id, s.version, next, actor.user, new Date().toISOString())) throw conflict('The series was changed by someone else. Refresh and try again.');
        writeAudit(db, { entity: 'core_number_series', entityId: id, action: 'update', oldValues: current(s), newValues: next, reason: v.reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.number_series.changed', entity: 'number_series', entityId: id, actorId: actor.user, companyId, data: { docType: dt.code } });
        const fresh = repo.seriesById(id, companyId);
        return presentSeries(fresh, usageOf(fresh));
      });
    },

    /** Ask for a change to a series that has already issued numbers. Statutory series need two approvals. */
    requestSeriesChange(actor, id, { changes, reason }) {
      assertPermission(actor, 'core.numbering.configure');
      const companyId = companyOf(actor);
      const s = repo.seriesById(id, companyId) ?? (() => { throw notFound('That numbering series does not exist.'); })();
      const dt = repo.docTypeById(s.doc_type_id);
      const next = mergeSeries(s, changes);
      checkDefinition(dt, next);
      if (SUBSTANTIVE.every((k) => same(next[k], current(s)[k]))) throw unprocessable('Nothing would change: the requested values are the current ones.');
      if (approvals.hasOpen(companyId, 'number_series_change', 'number_series', id)) throw conflict('There is already an open change request for this series. Decide or withdraw it first.');
      const statutory = dt.statutory === 1 || s.gap_free === 1;
      return approvals.submit(actor, {
        type: 'number_series_change',
        title: `Change numbering series ${s.name}`,
        targetType: 'number_series',
        targetId: id,
        payload: { seriesId: id, changes: Object.fromEntries(SUBSTANTIVE.filter((k) => !same(next[k], current(s)[k])).map((k) => [k, next[k]])), from: current(s), statutory },
        reason,
        chain: statutory ? ['SYSADM', 'ACCMGR'] : ['SYSADM'],
      });
    },

    // ---- numbers ----
    preview(actor, q) {
      assertPermission(actor, 'core.numbering.preview');
      return previewNumber(db, { ...q, companyId: companyOf(actor) });
    },

    /** Issue a number over HTTP. Only series that are not gap-free: a gap-free number belongs inside its document's transaction. */
    next(actor, body) {
      assertPermission(actor, 'core.numbering.issue');
      const companyId = companyOf(actor);
      const p = previewNumber(db, { ...body, companyId });
      if (p.gapFree) throw fail('GAP_FREE_VIA_API', 'A gap-free number can only be issued by the module that saves the document, in the same transaction. Issuing it separately would leave a gap if the document is not saved.');
      return issueNumber(db, { ...body, companyId, actor: actor.user });
    },

    issues(actor, { seriesId, limit, offset }, query) {
      assertPermission(actor, 'core.numbering.view');
      const { rows, total } = repo.recentIssues(companyOf(actor), seriesId ?? null, limit, offset);
      return pageResponse(
        rows.map((r) => ({ id: r.id, seriesId: r.series_id, number: r.number, seq: r.seq, periodKey: r.period_key, status: r.status, refType: r.ref_type, refId: r.ref_id, issuedAt: r.created_at, issuedBy: r.created_by })),
        total,
        query,
      );
    },
  };
}

const current = (s) => ({ name: s.name, prefix: s.prefix, format: s.format, gapFree: s.gap_free === 1, resetRule: s.reset_rule, seqStart: s.seq_start, branchCode: s.branch_code, projectId: s.project_id, isActive: s.is_active === 1 });
const same = (a, b) => (a ?? null) === (b ?? null);
const mergeSeries = (s, v) => {
  const base = current(s);
  /** @type {Record<string, any>} */
  const out = { ...base };
  for (const k of Object.keys(base)) if (v[k] !== undefined) out[k] = v[k];
  out.docType = s.doc_type_code;
  return out;
};

/** Applied when a number-series change request has been fully approved. */
export const seriesChangeHandler = {
  apply(db, request, actor) {
    const repo = createNumberingRepository(db);
    const s = repo.seriesById(request.payload.seriesId, request.companyId);
    if (!s) throw unprocessable('The numbering series no longer exists.');
    const dt = repo.docTypeById(s.doc_type_id);
    const next = mergeSeries(s, request.payload.changes);
    const statutory = dt.statutory === 1 || next.gapFree;
    const problems = formatProblems(next.format, { resetRule: next.resetRule, statutory, sample: { prefix: next.prefix, branch: next.branchCode ?? 'XXXX' } });
    if (problems.length) throw unprocessable(`The requested format is no longer valid: ${problems.join('; ')}.`);
    if (!repo.updateSeries(s.id, s.version, next, actor.user, new Date().toISOString())) throw conflict('The series changed while the request was open. Withdraw it and raise a new one.');
    writeAudit(db, { entity: 'core_number_series', entityId: s.id, action: 'change_approved', oldValues: current(s), newValues: next, reason: request.reason, actor: actor.user });
    publishEvent(db, { type: 'core.number_series.changed', entity: 'number_series', entityId: s.id, actorId: actor.user, companyId: request.companyId, data: { docType: dt.code, requestId: request.id } });
  },
};

