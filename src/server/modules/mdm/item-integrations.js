import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerExportSource, registerImportType } from '../eng/excel.js';
import { itemsOf, TYPES } from './items.js';

// The item master (part 06.03) for the rest of the ERP: a form lookup (GET /api/v1/mdm/lookups/items, the 03.02 contract) and the Excel import and export (04.13). An imported row is a request for a new item,
// approved by the steward of its category like one typed in the wizard; an import never approves anything (AC-04).
lookupRegistry.register({
  module: 'mdm', name: 'items', label: 'Items', permission: 'mdm.record.view', columns: [{ key: 'uom', label: 'Unit' }, { key: 'type', label: 'Type' }],
  search(db, actor, q) {
    const s = itemsOf(db);
    if (!s) return { rows: [], total: 0 };
    const out = s.items.search(actor, { q: q.text || undefined, limit: Math.min(q.limit, 50) });
    const rows = out.rows.filter((r) => !q.ids || q.ids.includes(r.id)).map((r) => ({ id: r.id, code: r.code, name: r.name, extra: { uom: r.uom, type: r.typeLabel } }));
    return { rows, total: rows.length };
  },
});

const yes = (v) => v === true;
registerImportType({
  code: 'MDM_ITEM', label: 'Items (requests for new items)', module: 'master data', description: 'Each row asks for a new item in a category; the steward of the category approves it. A row that looks like an existing item needs Yes in "Not a duplicate".',
  permission: 'mdm.item.import', exportPermission: 'mdm.record.view', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'category', label: 'Category code', type: 'text', required: true, maxLength: 20, help: 'The code of the category, for example CEMENT.' },
    { key: 'itemType', label: 'Type', type: 'enum', values: TYPES, required: true, help: TYPES.join(', ') },
    { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 160 },
    { key: 'baseUom', label: 'Base unit', type: 'text', required: true, maxLength: 10, help: 'A unit code such as MT, BAG, NOS, CUM.' },
    { key: 'spec', label: 'Specification', type: 'text', maxLength: 600, help: 'The attributes of the category as key=value; key=value, for example grade=OPC 53; standard=IS 269; packing=50 kg bag.' },
    { key: 'hsnSac', label: 'HSN/SAC', type: 'text', maxLength: 8, help: 'Optional: the category default applies when empty.' },
    { key: 'stockTracked', label: 'Stock tracked', type: 'bool' },
    { key: 'standardRate', label: 'Standard rate', type: 'text', maxLength: 16, help: 'Rupees per base unit.' },
    { key: 'justification', label: 'Justification', type: 'text', maxLength: 500 },
    { key: 'notDuplicate', label: 'Not a duplicate', type: 'bool', help: 'Yes when the row looks like an existing item but is a different one.' },
  ],
  keys: ['name', 'category'],
  findExisting: () => null,
  validateRow(ctx, row) {
    const s = itemsOf(ctx.db);
    const cat = ctx.db.prepare('SELECT id FROM mdm_item_categories WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(ctx.companyId, String(row.category).toUpperCase());
    if (!cat) return [{ column: 'category', message: `${row.category} is not a category of your company.`, code: 'NOT_FOUND' }];
    const spec = parseSpec(row.spec);
    const c = s.items.check(ctx.actor, { categoryId: cat.id, itemType: row.itemType, name: row.name, baseUom: String(row.baseUom).toUpperCase(), spec, hsnSac: row.hsnSac ?? undefined, stockTracked: yes(row.stockTracked) });
    const out = c.errors.map((e) => ({ column: e.field?.startsWith('spec') ? 'spec' : e.field, message: e.message }));
    if (!yes(row.notDuplicate)) for (const d of c.duplicates) out.push({ column: 'name', message: `Looks like ${d.code} ${d.name} (${d.rule}). Use that item, or write Yes in "Not a duplicate".`, code: 'POSSIBLE_DUPLICATE' });
    return out;
  },
  commitRow(ctx, { row }) {
    const cat = ctx.db.prepare('SELECT id FROM mdm_item_categories WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(ctx.companyId, String(row.category).toUpperCase());
    const r = itemsOf(ctx.db).items.create(ctx.actor, { categoryId: cat.id, itemType: row.itemType, name: row.name, baseUom: String(row.baseUom).toUpperCase(), spec: parseSpec(row.spec), hsnSac: row.hsnSac ?? undefined, stockTracked: yes(row.stockTracked), batchTracked: false, serialTracked: false, standardRate: row.standardRate ?? undefined, preferredBrands: [], uoms: [], justification: row.justification ?? 'Imported from Excel', acknowledgeDuplicates: yes(row.notDuplicate) });
    return { id: r.item.id, ref: `${r.item.code} (waiting for approval)` };
  },
  exportRows: (ctx) => itemsOf(ctx.db).items.list(ctx.actor, { status: 'ACTIVE', limit: 100, offset: 0 }).rows.map((r) => ({ category: r.category?.code, itemType: r.type, name: r.name, baseUom: r.baseUom, spec: Object.entries(r.spec).map(([k, v]) => `${k}=${v}`).join('; '), hsnSac: r.hsnSac, stockTracked: r.stockTracked, standardRate: r.standardRate })),
});
const parseSpec = (s) => Object.fromEntries(String(s ?? '').split(';').map((p) => p.split('=').map((x) => x.trim())).filter(([k, v]) => k && v));

registerExportSource({
  code: 'mdm.items', label: 'Items', permission: 'mdm.record.view', unmaskPermission: 'mdm.item.rate.view',
  columns: [{ key: 'code', label: 'Code' }, { key: 'versionNo', label: 'Version', type: 'number' }, { key: 'name', label: 'Name' }, { key: 'typeLabel', label: 'Type' }, { key: 'category', label: 'Category' }, { key: 'baseUom', label: 'Base unit' }, { key: 'hsnSac', label: 'HSN/SAC' }, { key: 'gstRate', label: 'GST' }, { key: 'spec', label: 'Specification' }, { key: 'status', label: 'Status' }, { key: 'standardRate', label: 'Standard rate', sensitive: true }],
  rows(ctx, filters) {
    const out = []; const s = itemsOf(ctx.db);
    for (let offset = 0; offset < 50_000; offset += 100) {
      const page = s.items.list(ctx.actor, { q: filters.q, type: filters.type, category: filters.category ? Number(filters.category) : undefined, status: filters.status, limit: 100, offset });
      out.push(...page.rows.map((r) => ({ ...r, category: r.category?.name, spec: Object.entries(r.spec).map(([k, v]) => `${k}=${v}`).join('; ') })));
      if (offset + 100 >= page.total) break;
    }
    return out;
  },
});
