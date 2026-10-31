import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { assertPermission, assertPermissionAnywhere } from '../../../platform/auth/index.js';
import { authzOf } from '../../../platform/authz/index.js';
import { assertVersion } from '../../../platform/db/repository.js';
import { companyScope } from '../../../platform/db/scope.js';
import { conflict, forbidden, notFound, unprocessable } from '../../../platform/http/errors.js';
import { pageResponse } from '../../../platform/pagination/index.js';
import { assertPeriodOpen } from '../financial-years/service.js';
import { cancelNumber, issueNumber, previewNumber } from '../numbering/service.js';
import { createSampleDocumentRepository } from './repository.js';

const DOC_TYPE = 'SAMPLE_DOC';
const MODULE = 'finance'; // the sample document posts into the finance period, like a voucher would

const present = (d) => ({ id: d.id, docNo: d.doc_no, docDate: d.doc_date, status: d.status, title: d.title, projectId: d.project_id, version: d.version, createdBy: d.created_by });

/**
 * A small numbered, dated document that follows every convention, so numbering and period control can be shown
 * working end to end. It is what a real module (a voucher, a PO) looks like to this part: the period is checked on
 * the document date at every posting step, the number is issued at the step the document type is configured for
 * (create or submit), inside the same transaction as the document, and a cancelled document keeps its number.
 */
export function createSampleDocumentService({ db }) {
  const repo = createSampleDocumentRepository(db);
  const authz = authzOf(db);
  /** The document is inside the projects the actor's assignments cover (part 02.04); outside it the document does not exist for them. */
  const visible = (actor, d) => authz.check(actor, 'core.sample.use', { companyId: d.company_id, projectId: d.project_id ?? undefined }).allowed;
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const docOrThrow = (id, companyId, actor) => {
    const d = repo.find(id, companyId);
    if (!d || (actor && !visible(actor, d))) throw notFound('That sample document does not exist.');
    return d;
  };
  const numbering = (actor, d, point, projectCode) => ({ companyId: d.company_id, docType: DOC_TYPE, date: d.doc_date, projectId: d.project_id ?? undefined, projectCode, point, refType: 'sample_document', refId: d.id, actor: actor.user });

  /** Assign the number when the document type says this is the step. */
  function assignIfDue(actor, d, point, projectCode) {
    if (d.doc_no) return d.doc_no;
    const ctx = numbering(actor, d, point, projectCode);
    if (repo.assignPoint(DOC_TYPE) !== point) return null;
    const issued = issueNumber(db, ctx);
    repo.setNumber(d.id, issued.number);
    return issued.number;
  }

  return {
    list(actor, query) {
      assertPermissionAnywhere(actor, 'core.sample.use');
      const { rows, total } = repo.list(companyOf(actor), query.limit, query.offset, authz.scopeFilter(actor, 'core.sample.use', { project: 'project_id' }).sql);
      return pageResponse(rows.map(present), total, query);
    },

    create(actor, { title, docDate, projectId, projectCode }, correlationId) {
      assertPermissionAnywhere(actor, 'core.sample.use');
      const companyId = companyOf(actor);
      if (!authz.check(actor, 'core.sample.use', { companyId, projectId: projectId ?? undefined }).allowed) throw forbidden('Your role includes core.sample.use only for some projects. Choose one of them, or ask a system administrator.');
      assertPeriodOpen(db, { companyId, module: MODULE, date: docDate, actor });
      return transaction(db, () => {
        const id = repo.insert(companyId, { title, docDate, projectId }, actor.user);
        assignIfDue(actor, repo.find(id, companyId), 'create', projectCode);
        const d = repo.find(id, companyId);
        writeAudit(db, { entity: 'core_sample_documents', entityId: id, action: 'create', newValues: { docNo: d.doc_no, docDate }, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.sample_document.created', entity: 'sample_document', entityId: id, actorId: actor.user, companyId, data: { docNo: d.doc_no } });
        return present(d);
      });
    },

    submit(actor, id, { version, projectCode }, correlationId) {
      assertPermissionAnywhere(actor, 'core.sample.use');
      const companyId = companyOf(actor);
      return transaction(db, () => {
        const d = docOrThrow(id, companyId, actor);
        if (d.status !== 'DRAFT') throw unprocessable(`Only a draft can be submitted; this document is ${d.status.toLowerCase()}.`);
        assertVersion(d.version, version, 'The document', 'Refresh the page and try again.');
        assertPeriodOpen(db, { companyId, module: MODULE, date: d.doc_date, actor });
        assignIfDue(actor, d, 'submit', projectCode);
        if (!repo.transition(id, d.version, 'SUBMITTED', actor.user, new Date().toISOString())) throw conflict('The document was changed by someone else. Refresh and try again.');
        const fresh = repo.find(id, companyId);
        writeAudit(db, { entity: 'core_sample_documents', entityId: id, action: 'submit', newValues: { docNo: fresh.doc_no }, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.sample_document.submitted', entity: 'sample_document', entityId: id, actorId: actor.user, companyId, data: { docNo: fresh.doc_no } });
        return present(fresh);
      });
    },

    /** Cancel a document. It keeps its number: the issue log marks it CANCELLED and nothing is renumbered. */
    cancel(actor, id, { version, reason }, correlationId) {
      assertPermissionAnywhere(actor, 'core.sample.use');
      const companyId = companyOf(actor);
      return transaction(db, () => {
        const d = docOrThrow(id, companyId, actor);
        if (d.status === 'CANCELLED') throw unprocessable('This document is already cancelled.');
        assertVersion(d.version, version, 'The document', 'Refresh the page and try again.');
        assertPeriodOpen(db, { companyId, module: MODULE, date: d.doc_date, actor });
        if (!repo.transition(id, d.version, 'CANCELLED', actor.user, new Date().toISOString())) throw conflict('The document was changed by someone else. Refresh and try again.');
        if (d.doc_no) cancelNumber(db, { companyId, docType: DOC_TYPE, number: d.doc_no, actor: actor.user });
        writeAudit(db, { entity: 'core_sample_documents', entityId: id, action: 'cancel', newValues: { docNo: d.doc_no }, reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.sample_document.cancelled', entity: 'sample_document', entityId: id, actorId: actor.user, companyId, data: { docNo: d.doc_no } });
        return present(repo.find(id, companyId));
      });
    },

    /** What number a new document dated `docDate` would get (so the form can show it before saving). */
    previewNumber(actor, { docDate, projectId, projectCode }) {
      assertPermission(actor, 'core.sample.use');
      return previewNumber(db, { companyId: companyOf(actor), docType: DOC_TYPE, date: docDate, projectId, projectCode });
    },
  };
}
