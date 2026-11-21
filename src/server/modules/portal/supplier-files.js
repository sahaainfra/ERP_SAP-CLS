import { rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileEntities } from '../../platform/files/entities.js';
import { filesOf } from '../../platform/files/registry.js';
import { notFound } from '../../platform/http/errors.js';
import { receiveMultipart } from '../core/files/multipart.js';

const staged = 'ptl_supplier_upload';
const grant = Symbol('supplier file grant');

fileEntities.register({
  entity: staged,
  label: 'Supplier upload awaiting submission',
  resolve(_db, actor, id) {
    const scope = actor[grant];
    if (!scope || Number(id) !== scope.accountId) return null;
    return { ...scope, canView: true, canEdit: true, locked: false };
  },
});

export function supplierFileScope(actor) {
  return actor[grant];
}

const fileView = (file) => ({ id: Number(file.id), name: file.name ?? file.original_name, scanStatus: file.scanStatus ?? file.scan_status });
const actorFor = (actor, scope) => ({ ...actor, [grant]: scope });
const inScope = (row, scope) => (scope.projectId === null || row.project_id === null || row.project_id === scope.projectId)
  && (scope.siteId === null || row.site_id === null || row.site_id === scope.siteId);

/** Attach clean, single-use uploads to a domain record inside its transaction. */
export function attachSupplierFiles(db, scope, actor, ids, target, { pdf = false } = {}) {
  const files = filesOf(db);
  if (!files) throw notFound('Supplier uploads are unavailable.');
  for (const id of ids) files.adoptStaged(actorFor(actor, scope), id, {
    stagingEntity: staged, stagingId: scope.accountId, target, extension: pdf ? 'pdf' : undefined,
  });
}

export function createSupplierFiles(db) {
  return {
    async upload(req, scope, revalidate) {
      const files = filesOf(db);
      if (!files) throw notFound('Supplier uploads are unavailable.');
      const actor = actorFor(req.actor, scope);
      const { file } = await receiveMultipart(req, { tmpRoot: files.tmpRoot, maxBytes: files.maxUploadBytes(actor) });
      try {
        revalidate();
        return fileView(await files.ingestUpload(actor, {
          tempPath: file.path, fileName: file.name, entity: staged, entityId: String(scope.accountId), stripExif: true,
        }, req.correlationId));
      } finally {
        await rm(file.path, { force: true });
      }
    },
    status(actor, scope, id) {
      const files = filesOf(db);
      const row = db.prepare(`SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = ?
        AND linked_id = ? AND created_by = ? AND deleted_at IS NULL`).get(id, scope.companyId, staged, String(scope.accountId), actor.user);
      if (!row || !files) throw notFound('That supplier upload is unavailable.');
      return fileView(files.get(actorFor(actor, scope), id));
    },
    discard(actor, scope, id, correlationId) {
      this.status(actor, scope, id);
      return filesOf(db).remove(actorFor(actor, scope), id, { reason: 'Supplier discarded a staged upload' }, correlationId);
    },
    rfqFiles(scope, rfqId) {
      return db.prepare(`SELECT id, original_name, scan_status, project_id, site_id FROM core_files WHERE company_id = ?
        AND linked_entity = 'proc_rfq' AND EXISTS (SELECT 1 FROM ptl_rfq_files s WHERE s.file_id = core_files.id) AND linked_id = ? AND scan_status = 'CLEAN' AND deleted_at IS NULL AND is_active = 1
        AND NOT EXISTS (SELECT 1 FROM core_files newer WHERE newer.supersedes_id = core_files.id AND newer.deleted_at IS NULL
          AND newer.scan_status = 'CLEAN') ORDER BY id`).all(scope.companyId, String(rfqId)).filter((row) => inScope(row, scope)).map(fileView);
    },
    async downloadRfq(req, res, scope, rfqId, fileId) {
      if (!this.rfqFiles(scope, rfqId).some((file) => file.id === fileId)) throw notFound('That RFQ attachment is unavailable.');
      const files = filesOf(db);
      if (!files) throw notFound('That RFQ attachment is unavailable.');
      const { url } = files.signedUrl(actorFor(req.actor, scope), fileId, { variant: 'file', download: true }, req.correlationId);
      const query = Object.fromEntries(new URL(url, 'http://localhost').searchParams);
      const out = await files.openContent(fileId, query);
      res.status(out.status).set(out.headers).set('Cache-Control', 'private, no-store');
      await pipeline(out.stream, res);
    },
  };
}
