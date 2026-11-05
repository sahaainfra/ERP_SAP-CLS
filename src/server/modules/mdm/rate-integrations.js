import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerImportType } from '../eng/excel.js';
import { PRICE_BASES, ratesOf } from './rates.js';

// The rate library (part 06.06) for the rest of the ERP: the Excel import (04.13) of resource rates and of schedule of rates items (a CPWD DSR or a client SOR typed into the template, into the draft edition
// of a book), and a lookup of the items of the active schedules for forms.
const itemByCode = (db, companyId, code) => db.prepare("SELECT id FROM mdm_items WHERE company_id = ? AND code = ? AND item_status IN ('ACTIVE', 'SUBMITTED') AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(companyId, String(code ?? '').trim().toUpperCase())?.id ?? null;
const projectByCode = (db, companyId, code) => (code ? db.prepare('SELECT id FROM org_projects WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(companyId, String(code).trim())?.id ?? -1 : null);
const rateBody = (ctx, row) => ({ itemId: itemByCode(ctx.db, ctx.actor.companyId, row.itemCode), region: row.region ? String(row.region).toUpperCase() : null, projectId: projectByCode(ctx.db, ctx.actor.companyId, row.projectCode), rate: String(row.rate), uom: String(row.uom ?? '').toUpperCase(), basis: row.basis, basisRef: row.basisRef ?? null, effectiveFrom: row.effectiveFrom, effectiveTo: null });
registerImportType({
  code: 'MDM_RESOURCE_RATE', label: 'Resource rates (rate library)', module: 'master data',
  description: 'Each row is a rate of an item (material, labour trade, equipment, transport) for a region or project from a date; the rate in force for the same item, region and project ends the day before.',
  permission: 'mdm.rate.edit', exportPermission: 'mdm.analyse.view', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'itemCode', label: 'Item code', type: 'text', required: true, maxLength: 40 },
    { key: 'region', label: 'State code', type: 'text', maxLength: 3, help: 'Empty for every region' },
    { key: 'projectCode', label: 'Project code', type: 'text', maxLength: 20, help: 'Empty unless the rate is for one project' },
    { key: 'rate', label: 'Rate', type: 'text', required: true, maxLength: 20 },
    { key: 'uom', label: 'Unit', type: 'text', required: true, maxLength: 10 },
    { key: 'basis', label: 'Source', type: 'enum', values: Object.keys(PRICE_BASES), required: true },
    { key: 'basisRef', label: 'Source reference', type: 'text', maxLength: 120 },
    { key: 'effectiveFrom', label: 'From (YYYY-MM-DD)', type: 'text', required: true, maxLength: 10 },
  ],
  keys: ['itemCode', 'region', 'projectCode', 'effectiveFrom'],
  findExisting: () => null,
  validateRow(ctx, row) {
    const b = rateBody(ctx, row);
    const out = [];
    if (!b.itemId) out.push({ column: 'itemCode', message: `${row.itemCode} is not an active item of your company` });
    if (b.projectId === -1) out.push({ column: 'projectCode', message: `${row.projectCode} is not a project of your company` });
    if (!/^\d{1,12}(\.\d{1,4})?$/.test(String(row.rate ?? ''))) out.push({ column: 'rate', message: 'A rate is a number with up to 4 decimals' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.effectiveFrom ?? ''))) out.push({ column: 'effectiveFrom', message: 'Use a date such as 2026-12-01' });
    if (!out.length) for (const p of ratesOf(ctx.db).library.check(ctx.actor, b)) out.push({ column: p.field === 'itemId' ? 'itemCode' : p.field === 'projectId' ? 'projectCode' : p.field, message: p.message });
    return out;
  },
  commitRow(ctx, { row }) { const r = ratesOf(ctx.db).library.create(ctx.actor, { ...rateBody(ctx, row), sourceType: 'xl_import' }); return { id: r.id, ref: `${r.itemCode} ${r.rate}/${r.uom} from ${r.effectiveFrom}` }; },
});
const draftBook = (db, companyId, code) => db.prepare("SELECT id FROM ra_sor_books WHERE company_id = ? AND code = ? AND book_status = 'DRAFT' AND deleted_at IS NULL").get(companyId, String(code ?? '').trim().toUpperCase())?.id ?? null;
registerImportType({
  code: 'MDM_SOR_ITEM', label: 'Schedule of rates items (DSR / SOR)', module: 'master data',
  description: 'Each row is an item of a schedule of rates (CPWD DSR, state PWD or client SOR) added to the draft edition of the book named in the row; an item already in it is replaced. Put the edition in use afterwards.',
  permission: 'mdm.rate.edit', exportPermission: 'mdm.analyse.view', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'bookCode', label: 'Book code', type: 'text', required: true, maxLength: 20 },
    { key: 'itemCode', label: 'Item code', type: 'text', required: true, maxLength: 30 },
    { key: 'parentCode', label: 'Parent item code', type: 'text', maxLength: 30 },
    { key: 'description', label: 'Description', type: 'text', required: true, maxLength: 2000 },
    { key: 'uom', label: 'Unit', type: 'text', maxLength: 10 },
    { key: 'rate', label: 'Rate', type: 'text', maxLength: 20, help: 'Empty for a heading' },
  ],
  keys: ['bookCode', 'itemCode'],
  findExisting: () => null,
  validateRow(ctx, row) {
    const out = [];
    if (!draftBook(ctx.db, ctx.actor.companyId, row.bookCode)) out.push({ column: 'bookCode', message: `${row.bookCode} has no draft edition; create the book or a new edition first` });
    if (row.rate != null && row.rate !== '' && !/^\d{1,12}(\.\d{1,4})?$/.test(String(row.rate))) out.push({ column: 'rate', message: 'A rate is a number with up to 4 decimals' });
    return out;
  },
  commitRow(ctx, { row }) {
    const id = draftBook(ctx.db, ctx.actor.companyId, row.bookCode);
    ratesOf(ctx.db).sor.putItems(ctx.actor, id, { items: [{ itemCode: String(row.itemCode).trim(), parentCode: row.parentCode ?? null, description: String(row.description).trim(), uom: row.uom ? String(row.uom).toUpperCase() : null, rate: row.rate === '' || row.rate == null ? null : String(row.rate) }], replace: false });
    return { id, ref: `${row.bookCode} ${row.itemCode}` };
  },
});
lookupRegistry.register({
  module: 'mdm', name: 'sor-items', label: 'Schedule of rates items', permission: 'mdm.analyse.view', columns: [{ key: 'book', label: 'Schedule' }, { key: 'rate', label: 'Rate' }],
  search(db, actor, q) {
    const s = ratesOf(db); if (!s) return { rows: [], total: 0 };
    const out = s.sor.search(actor, { q: q.text || '', limit: Math.min(q.limit, 50) }).rows.filter((r) => !q.ids || q.ids.includes(r.id));
    return { rows: out.map((r) => ({ id: r.id, code: r.itemCode, name: r.description.slice(0, 120), extra: { book: r.book, rate: r.rate ?? '' } })), total: out.length };
  },
});
