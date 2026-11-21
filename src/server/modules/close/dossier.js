import { z } from 'zod';
import { authzOf } from '../../platform/authz/index.js';
import { notFound } from '../../platform/http/errors.js';
import { parse } from '../../platform/validation/index.js';
import { documentOpsOf } from '../eng/documents-ops.js';
import { gatesOf } from '../hr/gates.js';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const selection = z.strictObject({
  projectId: id,
  siteId: id.nullable().default(null),
  revisionIds: z.array(id).min(1),
});

/** Read candidates for a client dossier. The owning services decide document access and share eligibility. */
export function readHandoverDocumentEvidence({ db, flags }, actor, input) {
  const companyId = actor?.companyId;
  const gates = gatesOf(db);
  const documents = documentOpsOf(db);
  if (!Number.isSafeInteger(companyId) || companyId < 1 || !flags.isOn(actor, 'ff.close.p2602')
    || !gates?.hasPassed(companyId, 'G1') || !gates.hasPassed(companyId, 'G2')
    || !documents || !flags.isOn(actor, 'ff.eng.p0410')) {
    throw notFound('Handover document evidence is unavailable.');
  }

  const { projectId, siteId, revisionIds } = parse(selection, input);
  const scope = { companyId, projectId, siteId };
  const project = db.prepare(`SELECT 1 FROM org_projects p
    WHERE p.id = ? AND p.company_id = ? AND p.is_active = 1 AND p.deleted_at IS NULL
      AND (? IS NULL OR EXISTS (
        SELECT 1 FROM org_sites s WHERE s.id = ? AND s.org_project_id = p.id
          AND s.company_id = p.company_id AND s.is_active = 1 AND s.deleted_at IS NULL
      ))`).get(projectId, companyId, siteId, siteId);
  if (!project || !authzOf(db)?.check(actor, 'doc.document.view', scope).allowed) {
    throw notFound('That handover document scope is unavailable.');
  }

  return [...new Set(revisionIds)].map((revisionId) => {
    const { documentId, title, revision, extension, size } = documents.portalShare(actor, scope, revisionId);
    return { documentId, revisionId, title, revision, extension, size };
  });
}
