import { createOrgService } from '../iam/org/service.js';
import { registerExportSource, registerImportType } from './excel.js';

// The import types and exports that this part registers to show the engine at work end to end (FR-07): the designations master (a master of the organisation, created through the organisation service) and the
// sample document of the workflow engine (a transactional record: it is created as a draft and sent into its approval chain, never approved by the import). Real modules register theirs in their own parts.
const services = new WeakMap();
/** The engine module hands over the services the adapters call. */
export const bindAdapters = (db, s) => services.set(db, s);
const orgOf = (db) => { const s = services.get(db); if (!s.org) s.org = createOrgService({ db, approvals: null, clock: () => new Date() }); return s.org; };

const ref = (db, sql, ...p) => db.prepare(sql).get(...p);

registerImportType({
  code: 'ORG_DESIGNATION', label: 'Designations', module: 'organisation', description: 'The designations (job titles) with their grade and level. An existing code can be updated.',
  permission: 'org.designation.import', exportPermission: 'org.designation.import', onExisting: ['ERROR', 'UPDATE', 'SKIP'], chunked: true,
  columns: [
    { key: 'code', label: 'Code', type: 'text', required: true, maxLength: 30, pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$', patternMessage: 'Code: use letters, digits, dot, dash or underscore (1 to 30 characters).', help: 'Unique short code, for example SE-1.' },
    { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 120, help: 'The designation, for example Site Engineer.' },
    { key: 'grade', label: 'Grade', type: 'text', maxLength: 20, help: 'Optional grade, for example G3.' },
    { key: 'level', label: 'Level', type: 'int', min: 1, max: 20, help: 'Seniority from 1 (lowest) to 20.' },
  ],
  keys: ['code'],
  findExisting: (ctx, row) => ref(ctx.db, 'SELECT id, version, name, grade, level FROM org_designations WHERE company_id = ? AND code = ? COLLATE NOCASE AND is_active = 1', ctx.companyId, row.code) ?? null,
  validateRow: (ctx) => (ctx.can('org.hr.manage') ? [] : [{ message: 'You may not maintain designations (permission org.hr.manage).', code: 'PERMISSION' }]),
  commitRow(ctx, { row, existing, action }) {
    const input = { code: row.code, name: row.name, ...(row.grade != null ? { grade: row.grade } : {}), ...(row.level != null ? { level: row.level } : {}) };
    const org = orgOf(ctx.db);
    const c = { correlationId: null };
    if (action === 'update') { const r = org.update(ctx.actor, 'designations', existing.id, { ...input, version: existing.version, reason: 'Updated by an Excel import' }, c); return { id: r.id, ref: row.code }; }
    const r = org.create(ctx.actor, 'designations', input, c);
    return { id: r.id, ref: row.code };
  },
  exportRows: (ctx) => ctx.db.prepare('SELECT code, name, grade, level FROM org_designations WHERE company_id = ? AND is_active = 1 ORDER BY code').all(ctx.companyId),
});

registerImportType({
  code: 'ENG_SAMPLE_DOC', label: 'Sample documents (with approval)', module: 'engine', description: 'Requests that follow the approval chain. Each row is created as a document and, when "Send for approval" is Yes, sent into the chain: an import never approves anything.',
  permission: 'eng.sample.import', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'title', label: 'Title', type: 'text', required: true, maxLength: 200, help: 'What the request is for (at least 3 characters).' },
    { key: 'amount', label: 'Amount', type: 'money', required: true, min: 0.01, help: 'Rupees, up to two decimals.' },
    { key: 'project', label: 'Project', type: 'lookup', required: true, help: 'Code or name of a project.', lookup: {
      noun: 'project',
      resolve: (ctx, v) => ctx.db.prepare('SELECT id, code FROM org_projects WHERE company_id = ? AND is_active = 1 AND (code = ? COLLATE NOCASE OR name = ? COLLATE NOCASE)').all(ctx.companyId, v, v),
      list: (ctx) => ctx.db.prepare('SELECT code FROM org_projects WHERE company_id = ? AND is_active = 1 ORDER BY code LIMIT 1000').all(ctx.companyId).map((r) => r.code),
    } },
    { key: 'submit', label: 'Send for approval', type: 'bool', help: 'Yes sends the document into its approval chain; No leaves it a draft. Default Yes.' },
  ],
  keys: ['title', 'project'],
  validateRow: (ctx, row, ids) => (ctx.can('eng.sample.use', { projectId: ids.project }) ? (row.title.length < 3 ? [{ column: 'title', message: 'Title: give at least 3 characters.' }] : []) : [{ column: 'project', message: `You may not raise documents for project ${row.project} (permission eng.sample.use).`, code: 'PERMISSION' }]),
  commitRow(ctx, { row, ids }) {
    const docs = services.get(ctx.db).sampleDocs;
    const d = docs.create(ctx.actor, { title: row.title, amount: row.amount, projectId: ids.project });
    const status = row.submit === false ? d : docs.submit(ctx.actor, d.id, { comment: 'Imported from Excel', source: 'import' });
    return { id: d.id, ref: status.docNo ?? d.docNo };
  },
});

registerExportSource({
  code: 'xl.jobs', label: 'Import history', permission: 'xl.import.use',
  columns: [{ key: 'id', label: 'Job' }, { key: 'type', label: 'Import' }, { key: 'file', label: 'File' }, { key: 'status', label: 'Status' }, { key: 'rows', label: 'Rows', type: 'number' }, { key: 'valid', label: 'Correct', type: 'number' }, { key: 'errors', label: 'With errors', type: 'number' }, { key: 'created', label: 'Created', type: 'number' }, { key: 'updated', label: 'Updated', type: 'number' }, { key: 'by', label: 'Started by' }, { key: 'at', label: 'Started at' }],
  rows(ctx, filters) {
    const all = ctx.can('xl.job.view_all');
    const rows = ctx.db.prepare(`SELECT * FROM xl_jobs WHERE company_id = ? AND is_active = 1 ${all ? '' : 'AND started_by = ?'} ${filters.status ? 'AND status = ?' : ''} ${filters.importType ? 'AND import_type = ?' : ''} ORDER BY id DESC LIMIT 50000`).all(...[ctx.companyId, ...(all ? [] : [ctx.actor.user]), ...(filters.status ? [filters.status] : []), ...(filters.importType ? [filters.importType] : [])]);
    return rows.map((j) => ({ id: j.id, type: j.import_type, file: j.file_name, status: j.status, rows: j.total_rows, valid: j.valid_rows, errors: j.error_rows, created: j.create_rows, updated: j.update_rows, by: j.started_by, at: j.started_at }));
  },
});
