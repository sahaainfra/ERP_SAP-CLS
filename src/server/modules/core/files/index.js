import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { hasPermission } from '../../../platform/auth/index.js';
import { eventTypes } from '../../../platform/events/index.js';
import { fileEntities } from '../../../platform/files/entities.js';
import { createClamdScanner, createBuiltinScanner } from '../../../platform/files/scan.js';
import { createSigner } from '../../../platform/files/signing.js';
import { bindFiles } from '../../../platform/files/registry.js';
import { createLocalStorage } from '../../../platform/files/storage.js';
import { notFound } from '../../../platform/http/errors.js';
import { fileContentRoutes, fileRoutes } from './routes.js';
import { SCAN_ATTEMPTS, createFileService } from './service.js';
import { join } from 'node:path';

// Part 01.05: file storage and attachments. Events this module publishes:
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
/** @type {[string, string, any][]} */
const FILE_EVENTS = [
  ['core.file.uploaded', 'A file was stored and queued for the virus scan.', obj({ linkedEntity: str, category: str }, ['linkedEntity', 'category'])],
  ['core.file.available', 'A file passed the virus scan and can be opened.', obj({ linkedEntity: str }, ['linkedEntity'])],
  ['core.file.quarantined', 'A file failed the virus scan and was quarantined.', obj({ linkedEntity: str, detail: str }, ['linkedEntity'])],
  ['core.file.deleted', 'A file was removed from a record (soft delete).', obj({ linkedEntity: str }, ['linkedEntity'])],
  ['core.file_settings.changed', 'The file storage settings were changed after approval.', obj()],
];
for (const [type, description, schema] of FILE_EVENTS) eventTypes.define({ type, version: 1, schema, owner: 'core', description });

// The one record type that takes attachments so far: the sample document of part 01.03. A real module registers its own
// (see platform/files/entities.js); its permissions decide who may attach, open and remove files.
fileEntities.register({
  entity: 'sample_document',
  label: 'Sample document',
  resolve(db, actor, id) {
    const d = db.prepare('SELECT id, company_id, project_id, status FROM core_sample_documents WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!d) return null;
    const allowed = hasPermission(actor, 'core.sample.use');
    return { companyId: d.company_id, projectId: d.project_id ?? null, siteId: null, canView: allowed, canEdit: allowed && d.status !== 'CANCELLED', locked: d.status !== 'DRAFT' };
  },
});

/** Build the file service for a database and mount its routes (behind ff.core.p0105) and its signed download route. */
export function mountFiles({ api, publicApi, db, config, runtime, approvals, opts, isFlagOn, storagePath, persist = true }) {
  const storage = createLocalStorage({ root: join(storagePath, 'files') });
  const scanners = [createBuiltinScanner()];
  if (config.clamav) scanners.push(createClamdScanner(config.clamav));
  const signer = createSigner(config.fileUrlSecret ?? randomBytes(32).toString('hex'));
  const service = createFileService({ db, storage, scanners, jobs: runtime.jobs, signer, approvals });
  bindFiles(db, service);

  runtime.jobs.register('core.file_scan', (ctx) => service.scanFile({ fileId: ctx.params.fileId, attempt: ctx.attempt }), {
    maxAttempts: SCAN_ATTEMPTS,
    description: 'Scans an uploaded file for viruses, quarantines it if infected, otherwise makes it available and builds its thumbnail.',
  });
  runtime.jobs.register('core.file_upload_cleanup', async (ctx) => {
    const out = await service.cleanupUploads();
    ctx.log(`${out.aborted} expired upload sessions removed`);
    return out;
  }, { maxAttempts: 2, description: 'Removes expired resumable-upload sessions and their temporary files.' });
  if (persist) runtime.scheduler.define({ code: 'core.file_upload_cleanup', cron: '15 * * * *', jobType: 'core.file_upload_cleanup', description: 'Hourly removal of abandoned uploads' });

  const gate = (req, res, next) => {
    const mine = req.path === '/files' || req.path.startsWith('/files/');
    if (!mine || isFlagOn(req.actor, 'ff.core.p0105')) return next();
    return next(notFound('Files are not enabled for your company yet (feature flag ff.core.p0105 is OFF).'));
  };
  const router = Router();
  router.use(gate);
  router.use(fileRoutes(service, opts, { tmpRoot: join(storage.root, '_uploads') }));
  api.use('/core', router);
  publicApi.use(fileContentRoutes(service));
  return service;
}
