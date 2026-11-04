import { createNumberingRepository } from '../core/numbering/repository.js';

/** The numbering series of the controlled documents of a company, made the first time one is needed: DOC-00001, DOC-00002 ... (the company may change it later under Numbering). */
export function createNumberSeries(db, companyId, actor) {
  const repo = createNumberingRepository(db);
  const dt = repo.docTypeByCode('DMS_DOC');
  if (!dt) throw new Error('The document type DMS_DOC is not registered');
  return repo.insertSeries(companyId, { docTypeId: dt.id, branchCode: null, projectId: null, name: 'Controlled documents', prefix: 'DOC', format: '{PREFIX}-{SEQ:5}', gapFree: false, resetRule: 'never', seqStart: 1 }, actor);
}
