import { authzOf } from '../../platform/authz/index.js';
import { masterTypes, mdmOf } from '../../platform/mdm/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { registerExportSource, registerImportType } from '../eng/excel.js';
import './masters.js';

// How governed masters plug into the rest of the ERP (part 06.01): a record is an object of the record registry (search, links, tasks), and the business partner master has an Excel import and export through the
// data-exchange engine (04.13, FR-06). An imported row is a change request like one typed in a form: it meets the same checks (formats, duplicates) and the same approvals; an import never approves anything.

objectTypes.register({
  type: 'mdm_record',
  label: 'Master record',
  permission: 'mdm.record.view',
  route: (id) => `/admin/master-data/records?id=${id}`,
  /** BR-01: a reference to a merged record opens the record it was merged into. */
  access(db, actor, id) {
    if (!authzOf(db).check(actor, 'mdm.record.view').allowed) return null;
    const s = mdmOf(db);
    const to = s ? s.resolveId(actor.companyId, Number(id)) : Number(id);
    const r = db.prepare('SELECT company_id, record_status FROM mdm_records WHERE id = ? AND company_id = ? AND is_active = 1').get(to, actor.companyId);
    return r ? { companyId: r.company_id, projectId: null, siteId: null, status: r.record_status } : null;
  },
  auditEntities: (id) => [{ entity: 'mdm_records', id }],
  summary(db, actor, id) {
    const s = mdmOf(db);
    const to = s ? s.resolveId(actor.companyId, Number(id)) : Number(id);
    const r = db.prepare('SELECT id, record_code, display_name, record_status, master_type FROM mdm_records WHERE id = ? AND company_id = ?').get(to, actor.companyId);
    if (!r) return null;
    return { label: `${r.record_code} ${r.display_name}${to !== Number(id) ? ' (merged record redirected)' : ''}`, status: r.record_status, resolvedId: r.id, masterType: r.master_type };
  },
  search(db, actor, q, limit) {
    if (!authzOf(db).check(actor, 'mdm.record.view').allowed) return [];
    return db.prepare("SELECT id FROM mdm_records WHERE company_id = ? AND is_active = 1 AND record_status IN ('ACTIVE', 'INACTIVE') AND (display_name LIKE ? OR record_code LIKE ?) ORDER BY display_name LIMIT ?").all(actor.companyId, `%${q}%`, `%${q}%`, limit);
  },
});

const PARTNER = 'PARTNER';
const t = masterTypes.get(PARTNER);
const yes = (v) => v === true;
const COLUMNS = [
  { key: 'code', label: 'Code', type: 'text', maxLength: 20, help: 'Empty for a new partner; the code (for example BP-00012) to change an existing one.' },
  ...t.fields.map((f) => (f.type === 'enum' ? { key: f.key, label: f.label, type: 'enum', values: f.options.map(([k]) => k), required: Boolean(f.required), help: f.options.map(([k, l]) => `${k} = ${l}`).join(', ') } : { key: f.key, label: f.label, type: 'text', maxLength: f.max ?? 200, required: Boolean(f.required), help: f.format ? `Format: ${f.format}` : '' })),
  { key: 'effectiveFrom', label: 'Applies from', type: 'date', help: 'Optional: the date the record or the change applies from (today when empty).' },
  { key: 'justification', label: 'Justification', type: 'text', required: true, maxLength: 500, help: 'Why the record is created or changed (the steward reads it).' },
  { key: 'notDuplicate', label: 'Not a duplicate', type: 'bool', help: 'Yes when the row looks like an existing partner (similar name or same mobile) but you checked it is a different one.' },
];
const dataOf = (row) => Object.fromEntries(t.fields.filter((f) => row[f.key] != null).map((f) => [f.key, row[f.key]]));
registerImportType({
  code: 'MDM_PARTNER', label: 'Business partners (governed)', module: 'master data',
  description: 'Vendors, subcontractors, clients and consultants. A new row becomes a request for a new partner, a row with a code a change request; both are checked for duplicates and go to the stewards for approval.',
  permission: 'mdm.record.import', exportPermission: 'mdm.record.view', onExisting: ['ERROR', 'UPDATE', 'SKIP'], chunked: false,
  columns: COLUMNS,
  keys: ['code'],
  findExisting: (ctx, row) => (row.code ? ctx.db.prepare("SELECT id, version FROM mdm_records WHERE company_id = ? AND master_type = ? AND record_code = ? COLLATE NOCASE AND is_active = 1").get(ctx.companyId, PARTNER, row.code) ?? null : null),
  validateRow(ctx, row) {
    const s = mdmOf(ctx.db);
    const existing = row.code ? ctx.db.prepare("SELECT id FROM mdm_records WHERE company_id = ? AND master_type = ? AND record_code = ? COLLATE NOCASE AND is_active = 1").get(ctx.companyId, PARTNER, row.code) : null;
    if (row.code && !existing) return [{ column: 'code', message: `There is no partner ${row.code}. Leave the code empty for a new partner.`, code: 'NOT_FOUND' }];
    try {
      const c = s.records.check(ctx.actor, PARTNER, { data: dataOf(row), recordId: existing?.id });
      const out = c.errors.map((e) => ({ column: e.field, message: e.message }));
      for (const d of c.duplicates) {
        if (d.block && (!existing || d.id !== existing.id)) out.push({ column: d.field, message: `Same ${t.fields.find((f) => f.key === d.field)?.label ?? d.field} as ${d.code} ${d.name}: this partner already exists.`, code: 'DUPLICATE' });
        else if (!existing && !yes(row.notDuplicate)) out.push({ column: d.field, message: `Looks like ${d.code} ${d.name} (${d.rules.join(', ')}). Check it; if it is a different partner write Yes in "Not a duplicate".`, code: 'POSSIBLE_DUPLICATE' });
      }
      return out;
    } catch (e) { return [{ message: e.message, code: 'RULE' }]; }
  },
  commitRow(ctx, { row, existing, action }) {
    const s = mdmOf(ctx.db);
    if (action === 'update') {
      const r = s.records.update(ctx.actor, PARTNER, existing.id, { data: dataOf(row), version: existing.version, effectiveFrom: row.effectiveFrom ?? undefined, justification: row.justification });
      return { id: existing.id, ref: row.code + (r.applied ? '' : ` (request ${r.changeRequestId})`) };
    }
    const r = s.records.create(ctx.actor, PARTNER, { data: dataOf(row), effectiveFrom: row.effectiveFrom ?? undefined, justification: row.justification, acknowledgeDuplicates: yes(row.notDuplicate) });
    return { id: r.record.id, ref: `${r.record.code} (request ${r.changeRequestId})` };
  },
  exportRows: (ctx) => mdmOf(ctx.db).records.list(ctx.actor, PARTNER, { limit: 50_000, offset: 0 }).rows.filter((r) => ['ACTIVE', 'INACTIVE'].includes(r.status)).map((r) => ({ code: r.code, ...r.data, effectiveFrom: r.effectiveFrom })),
});

registerExportSource({
  code: 'mdm.partners', label: 'Business partners', permission: 'mdm.record.view', unmaskPermission: 'mdm.sensitive.view',
  columns: [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'kind', label: 'Kind' }, { key: 'status', label: 'Status' }, { key: 'pan', label: 'PAN', sensitive: true }, { key: 'gstin', label: 'GSTIN', sensitive: true }, { key: 'mobile', label: 'Mobile' }, { key: 'state', label: 'State' }, { key: 'dqScore', label: 'Quality score', type: 'number' }, { key: 'effectiveFrom', label: 'Version from' }],
  rows: (ctx, filters) => mdmOf(ctx.db).records.list(ctx.actor, PARTNER, { limit: 50_000, offset: 0, status: filters.status, q: filters.q }).rows.map((r) => ({ code: r.code, name: r.name, kind: r.data.kind, status: r.status, pan: r.data.pan, gstin: r.data.gstin, mobile: r.data.mobile, state: r.data.state, dqScore: r.dqScore, effectiveFrom: r.effectiveFrom })),
});
