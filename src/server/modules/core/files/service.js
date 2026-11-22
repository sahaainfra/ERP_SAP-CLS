import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { assertPermission } from '../../../platform/auth/index.js';
import { companyScope } from '../../../platform/db/scope.js';
import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { fileEntities } from '../../../platform/files/entities.js';
import { readJpegExif, stripMetadata } from '../../../platform/files/exif.js';
import { runScanners } from '../../../platform/files/scan.js';
import { FILE_TYPES, checkType, extensionOf } from '../../../platform/files/types.js';
import { HttpError, conflict, forbidden, notFound, unprocessable } from '../../../platform/http/errors.js';
import { likePattern, pageResponse } from '../../../platform/pagination/index.js';
import { DEFAULT_SETTINGS, mergeSettings, settingsProblems } from './settings.js';

const MB = 1024 * 1024;
const HEAD_BYTES = 256 * 1024;
const MAX_CHUNK = 16 * MB;
export const CHUNK_SIZE = 4 * MB;
const SESSION_HOURS = 24;
export const SCAN_ATTEMPTS = 5;
const rejected = (message, field = 'file') => new HttpError(422, 'FILE_REJECTED', message, [{ field, message }]);
const iso = (ms) => new Date(ms).toISOString();
const readAll = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
};

/** The approved change to a company's file settings is applied in the approver's transaction (maker-checker). */
export const fileSettingsChangeHandler = {
  apply(db, request, actor) {
    const row = db.prepare('SELECT * FROM core_file_settings WHERE company_id = ? AND is_active = 1').get(request.companyId);
    const merged = mergeSettings(row ? JSON.parse(row.settings_json) : null, request.payload.changes);
    const problems = settingsProblems(merged);
    if (problems.length) throw unprocessable(`The requested settings are no longer valid: ${problems.join(' ')}`);
    const stamp = new Date().toISOString();
    if (row) {
      db.prepare('UPDATE core_file_settings SET settings_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(merged), actor.user, stamp, row.id);
    } else {
      db.prepare("INSERT INTO core_file_settings (company_id, settings_json, created_by, source_type) VALUES (?, ?, ?, 'file_settings')").run(request.companyId, JSON.stringify(merged), actor.user);
    }
    writeAudit(db, { entity: 'core_file_settings', entityId: request.companyId, action: 'change_approved', oldValues: row ? JSON.parse(row.settings_json) : DEFAULT_SETTINGS, newValues: merged, reason: request.reason, actor: actor.user });
    publishEvent(db, { type: 'core.file_settings.changed', entity: 'file_settings', entityId: request.companyId, actorId: actor.user, companyId: request.companyId, data: { requestId: request.id } });
  },
};

/**
 * The attachment service: resumable and multipart uploads, type and content checks, scan jobs, thumbnails, signed links
 * and permission-checked access. Access to a file is always access to the record it is attached to (BR-02).
 */
export function createFileService({ db, storage, scanners, jobs, signer, approvals, tmpRoot = join(storage.root ?? tmpdir(), '_uploads'), now = () => Date.now() }) {
  const companyOf = (actor) => companyScope(actor).params._company_scope;

  const settingsFor = (companyId) => {
    const row = db.prepare('SELECT settings_json, version FROM core_file_settings WHERE company_id = ? AND is_active = 1').get(companyId);
    return { settings: mergeSettings(row ? JSON.parse(row.settings_json) : null), version: row?.version ?? 0, custom: Boolean(row) };
  };

  /** The linked record, checked for the caller (company, view or edit permission). */
  function access(actor, entity, id, need) {
    const company = companyOf(actor);
    const def = fileEntities.get(entity);
    if (!def) throw unprocessable(`Files cannot be attached to "${entity}".`);
    const record = def.resolve(db, actor, id);
    if (!record || record.companyId !== company) throw notFound('That record does not exist.');
    if (need === 'view' && !record.canView) throw forbidden('You may not view this record, so you may not open its files.');
    if (need === 'edit' && !record.canEdit) throw forbidden('You may not edit this record, so you may not attach files to it.');
    return record;
  }

  const present = (r, { locked = null } = {}) => ({
    id: r.id,
    name: r.original_name,
    extension: r.extension,
    mime: r.mime,
    category: r.category,
    sizeBytes: r.size_bytes,
    sha256: r.sha256,
    scanStatus: r.scan_status,
    scanDetail: r.scan_status === 'CLEAN' ? null : r.scan_detail,
    linkedEntity: r.linked_entity,
    linkedId: r.linked_id,
    ...(r.linked_entity === 'proc_rfq' ? { supplierShared: r.supplier_shared === 1 } : {}),
    versionNo: r.version_no,
    supersedesId: r.supersedes_id,
    retentionClass: r.retention_class,
    exif: r.exif_json ? JSON.parse(r.exif_json) : null,
    exifStripped: r.exif_stripped === 1,
    hasThumbnail: Boolean(r.thumbnail_key),
    uploadedBy: r.created_by,
    uploadedAt: r.created_at,
    scannedAt: r.scanned_at,
    ...(locked === null ? {} : { locked }),
  });

  const fileOrThrow = (actor, id) => {
    const r = db.prepare('SELECT * FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyOf(actor));
    if (!r) throw notFound('That file does not exist.');
    return r;
  };

  async function readHead(path) {
    const fh = await open(path, 'r');
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const { bytesRead } = await fh.read(buf, 0, HEAD_BYTES, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  async function sha256Of(path) {
    const hash = createHash('sha256');
    const fh = await open(path, 'r');
    try {
      for await (const chunk of fh.createReadStream()) hash.update(chunk);
    } finally {
      await fh.close();
    }
    return hash.digest('hex');
  }

  /** Validate a received temporary file, store it, record it and queue its scan. Consumes `tempPath` either way. */
  async function ingest(actor, { tempPath, fileName, entity, entityId, supersedesId = null, stripExif = false }, correlationId = null) {
    try {
      const record = access(actor, entity, entityId, 'edit');
      const { settings } = settingsFor(record.companyId);
      const head = await readHead(tempPath);
      const check = checkType(fileName, head, settings.allowedExtensions);
      if (!check.ok) throw rejected(check.problem);
      let size = (await stat(tempPath)).size;
      if (size === 0) throw rejected('The file is empty.');
      const limit = settings.maxSizeMb[check.category] * MB;
      if (size > limit) throw rejected(`This ${check.category} file is ${(size / MB).toFixed(1)} MB; the limit for ${check.category} files is ${settings.maxSizeMb[check.category]} MB.`);

      let previous = null;
      if (supersedesId !== null) {
        previous = db.prepare('SELECT * FROM core_files WHERE id = ? AND company_id = ? AND linked_entity = ? AND linked_id = ? AND deleted_at IS NULL').get(supersedesId, record.companyId, entity, entityId);
        if (!previous) throw unprocessable('The file to replace does not belong to this record.');
        if (db.prepare('SELECT 1 FROM core_files WHERE supersedes_id = ? AND deleted_at IS NULL').get(previous.id)) throw conflict('That file has already been replaced by a newer version. Replace the newest version.');
      }

      let exif = null;
      if (['jpg', 'jpeg'].includes(check.extension)) exif = readJpegExif(head);
      let stripped = false;
      if (stripExif && ['jpg', 'jpeg', 'png'].includes(check.extension)) {
        const original = await readFile(tempPath);
        const clean = stripMetadata(original, check.extension);
        stripped = clean.length !== original.length;
        if (stripped) {
          await writeFile(tempPath, clean);
          size = clean.length;
        }
      }
      const sha256 = await sha256Of(tempPath);
      const twin = db.prepare('SELECT id, original_name FROM core_files WHERE company_id = ? AND linked_entity = ? AND linked_id = ? AND sha256 = ? AND deleted_at IS NULL').get(record.companyId, entity, entityId, sha256);
      if (twin) throw new HttpError(409, 'DUPLICATE_FILE', `This file is already attached to the record as "${twin.original_name}" (file ${twin.id}).`, [{ field: 'file', message: `Same content as file ${twin.id}` }]);

      const day = new Date(now());
      const key = `c${record.companyId}/${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
      await storage.put(key, tempPath);
      try {
        return transaction(db, () => {
          const res = db
            .prepare(
              `INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, linked_entity, linked_id, supersedes_id, version_no,
                                      retention_class, exif_json, exif_stripped, project_id, site_id, created_by, source_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upload')`,
            )
            .run(record.companyId, key, fileName, check.extension, check.mime, check.category, size, sha256, entity, entityId, previous?.id ?? null, (previous?.version_no ?? 0) + 1,
              settings.retention[check.category], exif ? JSON.stringify(exif) : null, stripped ? 1 : 0, record.projectId ?? null, record.siteId ?? null, actor.user);
          const id = Number(res.lastInsertRowid);
          writeAudit(db, { entity: 'core_files', entityId: id, action: previous ? 'supersede' : 'upload', newValues: { name: fileName, size, sha256, entity, entityId, supersedes: previous?.id ?? null }, actor: actor.user, correlationId });
          publishEvent(db, { type: 'core.file.uploaded', entity: 'file', entityId: id, actorId: actor.user, companyId: record.companyId, projectId: record.projectId ?? null, siteId: record.siteId ?? null, correlationId, data: { linkedEntity: entity, linkedId: entityId, category: check.category, sizeBytes: size } });
          jobs.enqueue('core.file_scan', { fileId: id }, { createdBy: actor.user, companyId: record.companyId });
          return present(db.prepare('SELECT * FROM core_files WHERE id = ?').get(id));
        });
      } catch (err) {
        await storage.remove(key);
        throw err;
      }
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  const sessionOf = (actor, uploadId) => {
    const s = db.prepare('SELECT * FROM core_file_uploads WHERE upload_id = ?').get(uploadId);
    if (!s || s.company_id !== companyOf(actor) || s.user_id !== actor.user) throw notFound('That upload does not exist.');
    return s;
  };
  const presentSession = (s) => ({ uploadId: s.upload_id, fileName: s.file_name, size: s.declared_size, received: s.received, status: s.status, chunkSize: CHUNK_SIZE, expiresAt: s.expires_at, fileId: s.file_id });
  const tempOf = (uploadId) => join(tmpRoot, uploadId);

  return {
    tmpRoot,
    present,
    settingsFor,

    // ---- uploads ----
    /** Start a resumable upload. Fails at once if the type or the declared size is not allowed. */
    async beginUpload(actor, { fileName, size, entity, entityId, supersedesId, stripExif }) {
      const record = access(actor, entity, entityId, 'edit');
      const { settings } = settingsFor(record.companyId);
      const ext = extensionOf(fileName);
      const type = FILE_TYPES[ext];
      if (!type || !settings.allowedExtensions.includes(ext)) throw rejected(`Files of type .${ext || '(none)'} are not allowed.`);
      if (size > settings.maxSizeMb[type.category] * MB) throw rejected(`This ${type.category} file is ${(size / MB).toFixed(1)} MB; the limit for ${type.category} files is ${settings.maxSizeMb[type.category]} MB.`);
      const uploadId = randomUUID();
      await mkdir(tmpRoot, { recursive: true });
      await writeFile(tempOf(uploadId), '');
      db.prepare('INSERT INTO core_file_uploads (upload_id, company_id, user_id, file_name, declared_size, meta_json, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        uploadId, record.companyId, actor.user, fileName, size, JSON.stringify({ entity, entityId, supersedesId: supersedesId ?? null, stripExif }), iso(now() + SESSION_HOURS * 3_600_000));
      return presentSession(db.prepare('SELECT * FROM core_file_uploads WHERE upload_id = ?').get(uploadId));
    },

    getUpload(actor, uploadId) {
      return presentSession(sessionOf(actor, uploadId));
    },

    /** Append a chunk at `offset`. A chunk that stops half way (the connection dropped) counts for nothing; ask again where to resume. */
    async appendChunk(actor, uploadId, offset, stream) {
      const s = sessionOf(actor, uploadId);
      if (s.status !== 'OPEN') throw unprocessable(`This upload is ${s.status.toLowerCase()}.`);
      if (Date.parse(s.expires_at) < now()) throw unprocessable('This upload has expired. Start again.');
      if (offset !== s.received) throw new HttpError(409, 'VERSION_CONFLICT', `The server has ${s.received} bytes of this upload, not ${offset}. Resume from ${s.received}.`, [{ field: 'offset', message: `Resume from ${s.received}` }]);
      const path = tempOf(uploadId);
      await truncate(path, s.received); // drop bytes of an earlier chunk that did not finish
      const room = Math.min(MAX_CHUNK, s.declared_size - s.received);
      let got = 0;
      const out = createWriteStream(path, { flags: 'a' });
      try {
        await pipeline(
          stream,
          async function* limit(source) {
            for await (const chunk of source) {
              got += chunk.length;
              if (got > room) throw rejected(`This chunk is larger than the ${room} bytes the upload can still take.`, 'offset');
              yield chunk;
            }
          },
          out,
        );
      } catch (err) {
        await truncate(path, s.received).catch(() => {});
        throw err;
      }
      const moved = db.prepare("UPDATE core_file_uploads SET received = ?, updated_at = ? WHERE upload_id = ? AND received = ? AND status = 'OPEN'").run(s.received + got, iso(now()), uploadId, s.received);
      if (moved.changes !== 1) throw conflict('Another request changed this upload at the same time. Ask where to resume.');
      return presentSession(db.prepare('SELECT * FROM core_file_uploads WHERE upload_id = ?').get(uploadId));
    },

    /** Finish a resumable upload: runs the same checks as a one-request upload. Completing twice returns the same file. */
    async completeUpload(actor, uploadId, correlationId) {
      const s = sessionOf(actor, uploadId);
      if (s.status === 'COMPLETED') return present(db.prepare('SELECT * FROM core_files WHERE id = ?').get(s.file_id));
      if (s.status !== 'OPEN') throw unprocessable(`This upload is ${s.status.toLowerCase()}.`);
      if (s.received !== s.declared_size) throw new HttpError(409, 'VERSION_CONFLICT', `Only ${s.received} of ${s.declared_size} bytes have arrived. Resume from ${s.received}.`, [{ field: 'offset', message: `Resume from ${s.received}` }]);
      const meta = JSON.parse(s.meta_json);
      try {
        const file = await ingest(actor, { tempPath: tempOf(uploadId), fileName: s.file_name, ...meta }, correlationId);
        db.prepare("UPDATE core_file_uploads SET status = 'COMPLETED', file_id = ?, updated_at = ? WHERE upload_id = ?").run(file.id, iso(now()), uploadId);
        return file;
      } catch (err) {
        db.prepare("UPDATE core_file_uploads SET status = 'ABORTED', updated_at = ? WHERE upload_id = ?").run(iso(now()), uploadId);
        throw err;
      }
    },

    /** A file that arrived in one request (multipart). `tempPath` is consumed. */
    ingestUpload: ingest,

    maxUploadBytes(actor) {
      const { settings } = settingsFor(companyOf(actor));
      return Math.max(...Object.values(settings.maxSizeMb)) * MB;
    },

    // ---- reading ----
    /**
     * A copy of a stored file linked to another record (message to task, 05.04): the bytes are copied under a new key, so removing or superseding one file never touches the other. Only a clean file is copied.
     * The caller has already checked that the person may use the target record; the source must be a live file of the same company.
     */
    /** The bytes of a clean file, for server-side processing such as text extraction (part 28.04). Not routed: callers check the person's rights first. */
    async bytesOf(fileId) {
      const r = db.prepare('SELECT * FROM core_files WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(Number(fileId));
      if (!r) throw notFound('That file does not exist.');
      if (r.scan_status !== 'CLEAN') throw unprocessable(`The file ${r.original_name} has not been cleared by the virus scan.`);
      return { file: present(r), companyId: r.company_id, projectId: r.project_id, siteId: r.site_id, buffer: await readAll(storage.createReadStream(r.storage_key)) };
    },
    async copyTo(actor, { fileId, entity, entityId, projectId = null, siteId = null }) {
      const r = db.prepare('SELECT * FROM core_files WHERE id = ? AND company_id = ? AND is_active = 1 AND deleted_at IS NULL').get(Number(fileId), actor.companyId);
      if (!r) throw notFound('That file does not exist.');
      if (r.scan_status !== 'CLEAN') throw unprocessable(`The file ${r.original_name} has not been cleared by the virus scan, so it cannot be copied.`);
      const day = new Date();
      const key = `c${r.company_id}/${day.getUTCFullYear()}/${String(day.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
      await storage.putBuffer(key, await readAll(storage.createReadStream(r.storage_key)));
      const res = db.prepare(`INSERT INTO core_files (company_id, storage_key, original_name, extension, mime, category, size_bytes, sha256, scan_status, scanned_at, linked_entity, linked_id, retention_class, exif_json, exif_stripped, project_id, site_id, created_by, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CLEAN', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'file_copy', ?)`)
        .run(r.company_id, key, r.original_name, r.extension, r.mime, r.category, r.size_bytes, r.sha256, r.scanned_at, entity, Number(entityId), r.retention_class, r.exif_json, r.exif_stripped, projectId, siteId, actor.user, String(r.id));
      return { id: Number(res.lastInsertRowid), name: r.original_name };
    },
    /** Consume a clean staged file in the transaction that created its authorised business record. */
    adoptStaged(actor, id, { stagingEntity, stagingId, target, extension }) {
      return transaction(db, () => {
        const file = fileOrThrow(actor, id);
        if (file.linked_entity !== stagingEntity || file.linked_id !== stagingId || file.created_by !== actor.user || !file.is_active) {
          throw notFound('That staged upload is unavailable.');
        }
        access(actor, stagingEntity, stagingId, 'edit');
        if (file.scan_status !== 'CLEAN') throw conflict('The attachment must pass its scan before submission.');
        if (extension && file.extension !== extension) throw rejected(`Attach a file in ${extension.toUpperCase()} format.`);
        if (db.prepare(`SELECT 1 FROM core_files WHERE company_id = ? AND linked_entity = ? AND linked_id = ?
          AND sha256 = ? AND deleted_at IS NULL`).get(file.company_id, target.entity, target.id, file.sha256)) {
          throw conflict('The same file is already attached to this record.');
        }
        db.prepare(`UPDATE core_files SET linked_entity = ?, linked_id = ?, project_id = ?, site_id = ?,
          updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
          .run(target.entity, target.id, target.projectId ?? null, target.siteId ?? null, actor.user, iso(now()), id);
        writeAudit(db, { entity: 'core_files', entityId: id, action: 'adopt_staged', companyId: file.company_id,
          actor: actor.user, oldValues: { linkedEntity: stagingEntity, linkedId: stagingId },
          newValues: { linkedEntity: target.entity, linkedId: target.id } });
        return id;
      });
    },
    list(actor, { entity, entityId }) {
      const record = access(actor, entity, entityId, 'view');
      const rows = db.prepare(`SELECT f.*, CASE WHEN f.linked_entity = 'proc_rfq' THEN
        EXISTS (SELECT 1 FROM ptl_rfq_files s WHERE s.file_id = f.id) ELSE 0 END AS supplier_shared
        FROM core_files f WHERE company_id = ? AND linked_entity = ? AND linked_id = ? AND deleted_at IS NULL ORDER BY id DESC`)
        .all(record.companyId, entity, entityId);
      const replaced = new Set(rows.map((r) => r.supersedes_id).filter(Boolean));
      return rows.map((r) => ({ ...present(r, { locked: record.locked }), current: !replaced.has(r.id) }));
    },

    get(actor, id) {
      const r = fileOrThrow(actor, id);
      const record = access(actor, r.linked_entity, r.linked_id, 'view');
      return present(r, { locked: record.locked });
    },

    /** A short-lived link to the file or its thumbnail. Only a CLEAN file has one (BR-01). */
    signedUrl(actor, id, { variant, download }, correlationId) {
      const r = fileOrThrow(actor, id);
      access(actor, r.linked_entity, r.linked_id, 'view');
      if (r.scan_status !== 'CLEAN') {
        const why = { PENDING: 'is still being scanned for viruses', INFECTED: 'was quarantined by the virus scan', ERROR: 'could not be scanned' }[r.scan_status];
        throw new HttpError(409, 'FILE_NOT_AVAILABLE', `This file ${why}, so it cannot be opened.`);
      }
      if (variant === 'thumbnail' && !r.thumbnail_key) throw notFound('This file has no thumbnail.');
      const { settings } = settingsFor(r.company_id);
      const type = FILE_TYPES[r.extension];
      const disposition = !download && type?.inline ? 'inline' : 'attachment';
      const link = signer.sign({ id: r.id, ttlSeconds: settings.urlTtlSeconds, variant, disposition });
      writeAudit(db, { entity: 'core_files', entityId: r.id, action: 'download_link', newValues: { variant, expiresInSeconds: settings.urlTtlSeconds }, actor: actor.user, correlationId });
      return { url: `/api/v1/core/files/${r.id}/content?exp=${link.exp}&v=${link.v}&d=${link.d}&sig=${link.sig}`, expiresAt: iso(link.exp * 1000), disposition };
    },

    /** Serve a file for a signed link (no sign-in: the link is the proof). Returns { status, headers, stream }. */
    openContent(id, query, rangeHeader) {
      const bad = signer.check({ id, ...query });
      if (bad === 'expired') throw new HttpError(410, 'LINK_EXPIRED', 'This download link has expired. Open the file again from the record.');
      if (bad) throw forbidden('This download link is not valid.');
      const r = db.prepare('SELECT * FROM core_files WHERE id = ? AND deleted_at IS NULL').get(id);
      if (!r || r.scan_status !== 'CLEAN') throw new HttpError(409, 'FILE_NOT_AVAILABLE', 'This file is not available.');
      const thumb = query.v === 'thumbnail';
      const key = thumb ? r.thumbnail_key : r.storage_key;
      if (!key) throw notFound('This file has no thumbnail.');
      return (async () => {
        const total = await storage.size(key);
        if (total === null) throw notFound('The stored file is missing. Tell an administrator.');
        const type = thumb ? { mime: 'image/webp' } : FILE_TYPES[r.extension];
        const name = thumb ? `thumbnail-${r.id}.webp` : r.original_name;
        const safe = name.replace(/[^\w.\- ]+/g, '_');
        const headers = {
          'content-type': type.mime,
          'content-disposition': `${query.d}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(name)}`,
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'SAMEORIGIN',
          'content-security-policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
          'cache-control': 'private, no-store',
          'accept-ranges': 'bytes',
        };
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader ?? '');
        if (m && (m[1] || m[2])) {
          const start = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]);
          const end = m[1] === '' || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
          if (start > end || start >= total) return { status: 416, headers: { ...headers, 'content-range': `bytes */${total}` }, stream: null };
          return { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': String(end - start + 1) }, stream: storage.createReadStream(key, { start, end }) };
        }
        return { status: 200, headers: { ...headers, 'content-length': String(total) }, stream: storage.createReadStream(key) };
      })();
    },

    // ---- removing ----
    /** Soft delete (BR-03). Files of a locked (approved) record cannot be removed, only superseded by a new version. */
    remove(actor, id, { reason }, correlationId) {
      const r = fileOrThrow(actor, id);
      const record = access(actor, r.linked_entity, r.linked_id, 'edit');
      if (record.locked) throw unprocessable('This record is approved, so its files cannot be removed. Upload a new version to replace the file instead.');
      return transaction(db, () => {
        const stamp = iso(now());
        db.prepare('UPDATE core_files SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(stamp, actor.user, actor.user, stamp, id);
        writeAudit(db, { entity: 'core_files', entityId: id, action: 'delete', oldValues: { name: r.original_name }, reason: reason ?? null, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.file.deleted', entity: 'file', entityId: id, actorId: actor.user, companyId: r.company_id, correlationId, data: { linkedEntity: r.linked_entity, linkedId: r.linked_id } });
        return { id, deleted: true };
      });
    },

    // ---- scan job ----
    /** Scan a stored file, quarantine it if infected, otherwise make it available and build its thumbnail. */
    async scanFile({ fileId, attempt = 1, force = false }) {
      const r = db.prepare('SELECT * FROM core_files WHERE id = ?').get(fileId);
      if (!r || r.deleted_at || (r.scan_status !== 'PENDING' && !force)) return { skipped: true };
      let verdict;
      try {
        verdict = await runScanners(scanners, () => storage.createReadStream(r.storage_key));
      } catch (err) {
        if (attempt >= SCAN_ATTEMPTS) {
          db.prepare("UPDATE core_files SET scan_status = 'ERROR', scan_detail = ?, scanned_at = ?, updated_at = ? WHERE id = ?").run(String(err.message).slice(0, 500), iso(now()), iso(now()), fileId);
        }
        throw err;
      }
      const stamp = iso(now());
      if (verdict.status === 'INFECTED') {
        const quarantineKey = `quarantine/${r.storage_key}`;
        await storage.move(r.storage_key, quarantineKey);
        transaction(db, () => {
          db.prepare("UPDATE core_files SET scan_status = 'INFECTED', scan_detail = ?, scanned_at = ?, storage_key = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(verdict.detail, stamp, quarantineKey, stamp, fileId);
          writeAudit(db, { entity: 'core_files', entityId: fileId, action: 'quarantine', newValues: { detail: verdict.detail, scanners: verdict.scanners }, actor: 'virus-scan' });
          publishEvent(db, { type: 'core.file.quarantined', entity: 'file', entityId: fileId, actorId: 'virus-scan', companyId: r.company_id, data: { linkedEntity: r.linked_entity, linkedId: r.linked_id, detail: verdict.detail } });
        });
        return { status: 'INFECTED', detail: verdict.detail };
      }
      let thumbnailKey = null;
      if (r.category === 'image') {
        try {
          const source = await readAll(storage.createReadStream(r.storage_key));
          const thumb = await sharp(source, { failOn: 'none' }).rotate().resize(256, 256, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 }).toBuffer();
          thumbnailKey = `${r.storage_key}.thumb.webp`;
          await storage.putBuffer(thumbnailKey, thumb);
        } catch {
          thumbnailKey = null; // an unreadable picture still passes the scan; it just has no thumbnail
        }
      }
      transaction(db, () => {
        db.prepare("UPDATE core_files SET scan_status = 'CLEAN', scan_detail = NULL, scanned_at = ?, thumbnail_key = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, thumbnailKey, stamp, fileId);
        publishEvent(db, { type: 'core.file.available', entity: 'file', entityId: fileId, actorId: 'virus-scan', companyId: r.company_id, data: { linkedEntity: r.linked_entity, linkedId: r.linked_id, hasThumbnail: Boolean(thumbnailKey) } });
      });
      return { status: 'CLEAN', scanners: verdict.scanners, thumbnail: Boolean(thumbnailKey) };
    },

    /** Put a file whose scan failed (or never ran) back in the queue. */
    rescan(actor, id, correlationId) {
      assertPermission(actor, 'core.files.admin');
      const r = db.prepare('SELECT * FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, companyOf(actor));
      if (!r) throw notFound('That file does not exist.');
      if (!['PENDING', 'ERROR'].includes(r.scan_status)) throw unprocessable(`This file is ${r.scan_status === 'CLEAN' ? 'clean' : 'quarantined'}; only files waiting for a scan or whose scan failed can be scanned again.`);
      return transaction(db, () => {
        db.prepare("UPDATE core_files SET scan_status = 'PENDING', scan_detail = NULL, updated_at = ? WHERE id = ?").run(iso(now()), id);
        jobs.enqueue('core.file_scan', { fileId: id }, { createdBy: actor.user, companyId: r.company_id });
        writeAudit(db, { entity: 'core_files', entityId: id, action: 'rescan', actor: actor.user, correlationId });
        return present(db.prepare('SELECT * FROM core_files WHERE id = ?').get(id));
      });
    },

    /** Expired upload sessions and their temporary files (an hourly job). */
    async cleanupUploads() {
      const expired = db.prepare("SELECT upload_id FROM core_file_uploads WHERE status = 'OPEN' AND expires_at < ?").all(iso(now()));
      for (const { upload_id: u } of expired) {
        await rm(tempOf(u), { force: true });
        db.prepare("UPDATE core_file_uploads SET status = 'ABORTED', updated_at = ? WHERE upload_id = ?").run(iso(now()), u);
      }
      return { aborted: expired.length };
    },

    // ---- administration ----
    getSettings(actor) {
      assertPermission(actor, 'core.files.admin');
      const { settings, version, custom } = settingsFor(companyOf(actor));
      return { settings, version, custom, hardCeilingMb: 2048, types: Object.entries(FILE_TYPES).map(([ext, t]) => ({ extension: ext, mime: t.mime, category: t.category })) };
    },

    /** Changing the file settings is maker-checker: the System Administrator asks, the IT Administrator decides. */
    requestSettingsChange(actor, { changes, reason }) {
      assertPermission(actor, 'core.files.configure');
      const companyId = companyOf(actor);
      const { settings } = settingsFor(companyId);
      const merged = mergeSettings(settings, changes);
      const problems = settingsProblems(merged);
      if (problems.length) throw new HttpError(400, 'VALIDATION_ERROR', problems[0], problems.map((message) => ({ field: 'changes', message })));
      if (JSON.stringify(merged) === JSON.stringify(settings)) throw unprocessable('Nothing would change: the requested values are the current ones.');
      if (approvals.hasOpen(companyId, 'file_settings_change', 'file_settings', companyId)) throw conflict('There is already an open change request for the file settings. Decide or withdraw it first.');
      return approvals.submit(actor, { type: 'file_settings_change', title: 'Change file storage settings', targetType: 'file_settings', targetId: companyId, payload: { changes, from: settings }, reason, chain: ['ITADM'] });
    },

    overview(actor) {
      assertPermission(actor, 'core.files.admin');
      const company = companyOf(actor);
      const byStatus = Object.fromEntries(db.prepare("SELECT scan_status AS s, COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS b FROM core_files WHERE company_id = ? AND deleted_at IS NULL GROUP BY scan_status").all(company).map((r) => [r.s, { files: r.n, bytes: r.b }]));
      const byCategory = db.prepare('SELECT category, COUNT(*) AS files, COALESCE(SUM(size_bytes), 0) AS bytes FROM core_files WHERE company_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY category').all(company).map((r) => ({ ...r }));
      const attention = db
        .prepare("SELECT * FROM core_files WHERE company_id = ? AND deleted_at IS NULL AND (scan_status IN ('INFECTED', 'ERROR') OR (scan_status = 'PENDING' AND created_at < ?)) ORDER BY id DESC LIMIT 20")
        .all(company, iso(now() - 5 * 60_000))
        .map((r) => ({ ...present(r), canRescan: ['PENDING', 'ERROR'].includes(r.scan_status) }));
      return {
        storage: storage.name,
        scanners: scanners.map((s) => s.name),
        clamAvConnected: scanners.some((s) => s.name === 'clamd'),
        statuses: Object.fromEntries(['PENDING', 'CLEAN', 'INFECTED', 'ERROR'].map((s) => [s, byStatus[s] ?? { files: 0, bytes: 0 }])),
        byCategory,
        openUploads: db.prepare("SELECT COUNT(*) AS n FROM core_file_uploads WHERE company_id = ? AND status = 'OPEN'").get(company).n,
        attention,
      };
    },

    listAdmin(actor, query) {
      assertPermission(actor, 'core.files.admin');
      const params = { c: companyOf(actor), status: query.filters.scan_status ?? null, q: likePattern(query.q) };
      const where = "company_id = :c AND deleted_at IS NULL AND (:status IS NULL OR scan_status = :status) AND original_name LIKE :q ESCAPE '\\'";
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_files WHERE ${where}`).get(params).n;
      const rows = db.prepare(`SELECT * FROM core_files WHERE ${where} ORDER BY id DESC LIMIT :limit OFFSET :offset`).all({ ...params, limit: query.limit, offset: query.offset });
      return pageResponse(rows.map((r) => present(r)), total, query);
    },
  };
}
