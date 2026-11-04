import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import sharp from 'sharp';
import { zipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import { writeAudit } from '../../platform/audit/index.js';
import { writeExport } from '../../platform/export/index.js';
import { FILE_TYPES } from '../../platform/files/types.js';
import { HttpError, badRequest, conflict, notFound, unprocessable } from '../../platform/http/errors.js';

// What goes with the register but is not a record (part 04.10): the content of a revision for the viewer and the downloads (a superseded revision carries a watermark), the zip of selected
// documents, and the Excel sheet that registers many documents at once.
export const WATERMARK_MAX_BYTES = 60 * 1024 * 1024;
export const ZIP_MAX_DOCS = 100;
export const ZIP_MAX_BYTES = 200 * 1024 * 1024;
export const BULK_MAX_ROWS = 500;
const IMAGES = new Set(['png', 'jpg', 'jpeg', 'webp']);

const readAll = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
};

/** The file with the words across every page (a PDF) or the picture (an image). Other kinds cannot carry one: `applied` says so. */
export async function watermark(buffer, extension, text, note) {
  if (extension === 'pdf') {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    const font = await pdf.embedFont(StandardFonts.HelveticaBold);
    const small = await pdf.embedFont(StandardFonts.Helvetica);
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      const size = Math.max(24, Math.min(width, height) / 9);
      const w = font.widthOfTextAtSize(text, size);
      page.drawText(text, { x: (width - w * Math.SQRT1_2) / 2, y: height / 2 - (w * Math.SQRT1_2) / 2, size, font, color: rgb(0.8, 0.1, 0.1), opacity: 0.28, rotate: degrees(45) });
      page.drawText(note, { x: 24, y: 14, size: 8, font: small, color: rgb(0.7, 0.1, 0.1), opacity: 0.9 });
    }
    return { buffer: Buffer.from(await pdf.save()), applied: true };
  }
  if (IMAGES.has(extension)) {
    const img = sharp(buffer, { failOn: 'none' }).rotate();
    const { width = 800, height = 600 } = await img.metadata();
    const size = Math.round(Math.max(24, Math.min(width, height) / 9));
    const esc = (t) => t.replace(/[<>&"]/g, '');
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="50%" y="50%" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="${size}" fill="rgb(204,26,26)" fill-opacity="0.35" transform="rotate(-30 ${width / 2} ${height / 2})">${esc(text)}</text><text x="12" y="${height - 12}" font-family="sans-serif" font-size="${Math.max(12, Math.round(size / 3))}" fill="rgb(180,20,20)">${esc(note)}</text></svg>`);
    const type = extension === 'jpg' ? 'jpeg' : extension;
    return { buffer: await img.composite([{ input: svg, top: 0, left: 0 }]).toFormat(type).toBuffer(), applied: true };
  }
  return { buffer, applied: false };
}

export function createDocumentOps({ db, service, storage }) {
  const docs = service.documents;

  /** The bytes of a revision for a person who may see it: { status, headers, stream | buffer }. BR-03: no view, no content (404, like the record). */
  async function content(actor, versionId, { download = false, range = null } = {}) {
    const v = db.prepare('SELECT * FROM doc_versions WHERE id = ? AND company_id = ? AND is_active = 1').get(versionId, actor.companyId);
    if (!v) throw notFound('That revision does not exist.');
    const { d } = service.load(actor, v.document_id);
    const f = v.file_id ? db.prepare('SELECT * FROM core_files WHERE id = ?').get(v.file_id) : db.prepare("SELECT * FROM core_files WHERE linked_entity = 'doc_version' AND linked_id = ? AND deleted_at IS NULL AND is_active = 1 ORDER BY id DESC LIMIT 1").get(v.id);
    if (!f) throw notFound('This revision has no file yet.');
    if (f.scan_status !== 'CLEAN') throw new HttpError(409, 'FILE_NOT_AVAILABLE', f.scan_status === 'PENDING' ? 'This file is still being scanned for viruses, so it cannot be opened.' : 'This file did not pass the virus scan, so it cannot be opened.');
    const type = FILE_TYPES[f.extension];
    const total = await storage.size(f.storage_key);
    if (total === null) throw notFound('The stored file is missing. Tell an administrator.');
    const superseded = v.status === 'SUPERSEDED';
    const safe = f.original_name.replace(/[^\w.\- ]+/g, '_');
    const base = {
      'content-type': type?.mime ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'cache-control': 'private, no-store', 'accept-ranges': 'bytes',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox", 'x-revision': v.revision, 'x-revision-status': v.status,
    };
    writeAudit(db, { entity: 'doc_documents', entityId: d.id, action: download ? 'download' : 'view', newValues: { revision: v.revision, superseded }, actor: actor.user, companyId: d.company_id });
    const disposition = download || !type?.inline ? 'attachment' : 'inline';
    if (superseded) {
      if (total > WATERMARK_MAX_BYTES) throw unprocessable('This superseded revision is too large to carry its watermark here. Ask the document controller.');
      const by = v.superseded_by ? db.prepare('SELECT revision FROM doc_versions WHERE id = ?').get(v.superseded_by)?.revision : null;
      const text = `SUPERSEDED rev ${v.revision}`;
      const note = `${d.doc_no} revision ${v.revision} was superseded${by ? ` by revision ${by}` : ''} on ${String(v.superseded_at ?? '').slice(0, 10)}. Do not use. Downloaded by ${actor.user}.`;
      const out = await watermark(await readAll(storage.createReadStream(f.storage_key)), f.extension, text, note);
      const name = `${safe.replace(/\.[^.]+$/, '')}-SUPERSEDED-rev${v.revision}.${f.extension}`;
      return { status: 200, headers: { ...base, 'content-length': String(out.buffer.length), 'content-disposition': `${disposition}; filename="${name}"`, 'x-watermark': out.applied ? 'applied' : 'not-possible-for-this-type' }, buffer: out.buffer };
    }
    const headers = { ...base, 'content-disposition': `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(f.original_name)}` };
    const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? '');
    if (m && (m[1] || m[2])) {
      const start = m[1] === '' ? Math.max(0, total - Number(m[2])) : Number(m[1]);
      const end = m[1] === '' || m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1);
      if (start > end || start >= total) return { status: 416, headers: { ...headers, 'content-range': `bytes */${total}` }, stream: null };
      return { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': String(end - start + 1) }, stream: storage.createReadStream(f.storage_key, { start, end }) };
    }
    return { status: 200, headers: { ...headers, 'content-length': String(total) }, stream: storage.createReadStream(f.storage_key) };
  }

  /** FR-08: the current files of the chosen documents in one zip, each only if the person may see it. */
  async function zip(actor, ids) {
    const unique = [...new Set(ids)];
    if (unique.length > ZIP_MAX_DOCS) throw badRequest(`Choose at most ${ZIP_MAX_DOCS} documents for one download.`, [{ field: 'ids', message: `more than ${ZIP_MAX_DOCS}` }]);
    const files = {};
    const left = [];
    let bytes = 0;
    for (const id of unique) {
      let d;
      try { d = service.load(actor, id).d; } catch { left.push({ id, reason: 'You may not see this document.' }); continue; }
      const v = d.current_version_id ? db.prepare('SELECT * FROM doc_versions WHERE id = ?').get(d.current_version_id) : null;
      const f = v?.file_id ? db.prepare('SELECT * FROM core_files WHERE id = ?').get(v.file_id) : null;
      if (!f || f.scan_status !== 'CLEAN') { left.push({ id, docNo: d.doc_no, reason: 'It has no issued file.' }); continue; }
      bytes += f.size_bytes;
      if (bytes > ZIP_MAX_BYTES) throw unprocessable(`The chosen files are more than ${ZIP_MAX_BYTES / 1024 / 1024} MB together. Choose fewer.`);
      let name = `${d.doc_no}_rev${v.revision}_${f.original_name}`.replace(/[^\w.\- ]+/g, '_');
      while (files[name]) name = `x${name}`;
      files[name] = new Uint8Array(await readAll(storage.createReadStream(f.storage_key)));
    }
    if (!Object.keys(files).length) throw unprocessable('None of the chosen documents has a file you may download.');
    if (left.length) files['NOT-INCLUDED.txt'] = new Uint8Array(Buffer.from(left.map((l) => `${l.docNo ?? l.id}: ${l.reason}`).join('\n')));
    writeAudit(db, { entity: 'doc_documents', entityId: 'zip', action: 'zip', newValues: { documents: Object.keys(files).length - (left.length ? 1 : 0), left: left.length, bytes }, actor: actor.user, companyId: actor.companyId });
    return { buffer: Buffer.from(zipSync(files, { level: 0 })), fileName: `documents-${service.today()}.zip`, included: Object.keys(files).length - (left.length ? 1 : 0), left };
  }

  const COLUMNS = [['title', 'Title'], ['docType', 'Type'], ['discipline', 'Discipline'], ['project', 'Project code'], ['folder', 'Folder'], ['confidentiality', 'Confidentiality'], ['owner', 'Owner'], ['validUntil', 'Valid until'], ['wbsRef', 'WBS'], ['locationRef', 'Location'], ['tags', 'Tags']];
  const template = () => writeExport('xlsx', { columns: COLUMNS.map(([key, label]) => ({ key, label })), rows: [{ title: 'Pier 4 reinforcement layout', docType: 'DRAWING', discipline: 'Structural', project: 'P1', folder: 'Drawings/Structural', confidentiality: 'INTERNAL', owner: '', validUntil: '', wbsRef: '1.2.4', locationRef: 'Pier 4', tags: 'rebar, pier' }], footer: [], sheetName: 'Documents', title: 'Documents to register' });

  /** FR-08: register many documents from a sheet. Without `commit` it only checks and reports each row; with it, every row that is valid is registered (a row with a problem is left out and reported). */
  async function bulkImport(actor, buffer, { commit }) {
    let sheets;
    try { sheets = await readXlsxFile(buffer); } catch { throw badRequest('That file could not be read as an Excel workbook (.xlsx).', [{ field: 'file', message: 'is not a valid .xlsx file' }]); }
    const table = sheets[0]?.data ?? [];
    const header = (table[0] ?? []).map((h) => String(h ?? '').trim().toLowerCase());
    const idx = Object.fromEntries(COLUMNS.map(([key, label]) => [key, header.indexOf(label.toLowerCase())]));
    if (idx.title < 0 || idx.docType < 0) throw badRequest('The first row must name the columns, at least Title and Type.', [{ field: 'file', message: 'is missing the Title or Type column' }]);
    if (table.length - 1 > BULK_MAX_ROWS) throw badRequest(`The file has more than ${BULK_MAX_ROWS} rows. Split it.`, [{ field: 'file', message: `has more than ${BULK_MAX_ROWS} rows` }]);
    const cell = (r, k) => (idx[k] < 0 || r[idx[k]] === null || r[idx[k]] === undefined ? '' : String(r[idx[k]] instanceof Date ? r[idx[k]].toISOString().slice(0, 10) : r[idx[k]]).trim());
    const out = { rows: [], created: 0, problems: 0 };
    for (const [i, r] of table.slice(1).entries()) {
      const line = i + 2;
      if (r.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;
      const item = { line, title: cell(r, 'title'), docType: cell(r, 'docType').toUpperCase(), ok: false, problems: [], docNo: null };
      const body = { title: item.title, docType: item.docType, discipline: cell(r, 'discipline') || undefined, confidentiality: cell(r, 'confidentiality').toUpperCase() || undefined, owner: cell(r, 'owner') || undefined, validUntil: cell(r, 'validUntil') || undefined, wbsRef: cell(r, 'wbsRef') || undefined, locationRef: cell(r, 'locationRef') || undefined, tags: cell(r, 'tags') ? cell(r, 'tags').split(',').map((t) => t.trim()).filter(Boolean) : undefined, source: { type: 'bulk_upload', id: `line-${line}` } };
      if (item.title.length < 3) item.problems.push('Title: give at least 3 characters.');
      const code = cell(r, 'project');
      if (code) { const p = db.prepare('SELECT id FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE').get(actor.companyId, code); if (!p) item.problems.push(`Project: no project has the code ${code}.`); else body.projectId = p.id; }
      const path = cell(r, 'folder');
      if (path) { const f = db.prepare('SELECT id FROM doc_folders WHERE company_id = ? AND COALESCE(project_id, 0) = ? AND path = ? COLLATE NOCASE AND is_active = 1').get(actor.companyId, body.projectId ?? 0, path); if (!f) item.problems.push(`Folder: ${path} is not a folder of ${code || 'the company'}.`); else body.folderId = f.id; }
      if (body.confidentiality && !['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'].includes(body.confidentiality)) item.problems.push('Confidentiality: use PUBLIC, INTERNAL, CONFIDENTIAL or RESTRICTED.');
      if (body.validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(body.validUntil)) item.problems.push('Valid until: write the date as 2027-03-31.');
      if (!item.problems.length) {
        if (commit) {
          try { const d = docs.create(actor, body); item.docNo = d.docNo; item.ok = true; item.id = d.id; out.created += 1; } catch (e) { item.problems.push(e.details?.map((x) => `${x.field}: ${x.message}`).join(' ') || e.message); }
        } else {
          const type = service.types.get(actor.companyId, item.docType);
          if (!type) item.problems.push(`Type: ${item.docType || '(empty)'} is not a document type.`);
          else if (type.has_validity && !body.validUntil) item.problems.push(`Valid until: ${type.name} needs the date until which it is valid.`);
          else item.ok = true;
        }
      }
      if (item.problems.length) out.problems += 1;
      out.rows.push(item);
    }
    writeAudit(db, { entity: 'doc_documents', entityId: 'bulk', action: commit ? 'bulk_upload' : 'bulk_check', newValues: { rows: out.rows.length, created: out.created, problems: out.problems }, actor: actor.user, companyId: actor.companyId });
    if (commit && !out.rows.length) throw conflict('The file has no rows to register.');
    return out;
  }
  return { content, zip, template, bulkImport };
}
