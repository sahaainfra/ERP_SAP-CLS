import { notFound } from '../../platform/http/errors.js';
import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerExportSource, registerImportType } from '../eng/excel.js';
import { COMMON, commonOf } from './common.js';

// How the common masters (part 06.02) reach the rest of the ERP: form lookups (GET /api/v1/mdm/lookups/<name>, the 03.02 contract) for every master, one per lookup list
// (/mdm/lookups/priority, /mdm/lookups/delay-cause ...) with the label in the person's language (T-03), and an Excel import and export through the data-exchange engine (04.13, FR-09).
// An imported statutory row is a change request like one typed on the page: the approval of the accounts manager and the CFO still applies (AC-04).
/** @type {(actor: any) => boolean} */
let flagCheck = () => true;
/** The module sets how the flag is read once it is mounted (the lookups are served by the 03.02 router, outside the module's own gate). */
export const setCommonFlag = (fn) => { flagCheck = fn; };
const gate = (actor) => { if (!flagCheck(actor)) throw notFound('The common masters are not enabled for your company yet (feature flag ff.mdm.p0602 is OFF).'); };

/** @type {Array<[string, string, (r: any, hi?: boolean) => any, Array<{ key: string, label: string }>]>} */
const LOOKUPS = [
  ['uoms', 'uom', (r) => ({ code: r.code, name: r.name, extra: { category: r.category, base: r.baseUom } }), [{ key: 'category', label: 'Measures' }]],
  ['states', 'states', (r, hi) => ({ code: r.code, name: hi && r.nameHi ? r.nameHi : r.name, extra: { gstCode: r.gstCode } }), [{ key: 'gstCode', label: 'GST code' }]],
  ['districts', 'districts', (r, hi) => ({ code: r.code, name: hi && r.nameHi ? r.nameHi : r.name, extra: { state: r.stateCode } }), []],
  ['gst-rates', 'gst-rates', (r) => ({ code: r.code, name: `${r.description} (${r.igstPct}%)`, extra: { igst: r.igstPct } }), [{ key: 'igst', label: 'IGST %' }]],
  ['hsn-sac', 'hsn-sac', (r) => ({ code: r.code, name: r.description, extra: { type: r.codeType, rate: r.defaultGstRate } }), [{ key: 'type', label: 'Type' }, { key: 'rate', label: 'GST' }]],
  ['tds-sections', 'tds-sections', (r) => ({ code: r.section, name: r.description, extra: { rate: r.rateCompany } }), [{ key: 'rate', label: 'Rate %' }]],
  ['currencies', 'currencies', (r) => ({ code: r.code, name: r.name, extra: { symbol: r.symbol } }), []],
  ['banks', 'banks', (r) => ({ code: r.ifsc, name: `${r.bankName}, ${r.branch}`, extra: { city: r.city ?? '' } }), [{ key: 'city', label: 'City' }]],
  ['payment-terms', 'payment-terms', (r) => ({ code: r.code, name: r.description, extra: { kind: r.termKind } }), [{ key: 'kind', label: 'Kind' }]],
];
for (const [name, master, map, columns] of LOOKUPS) {
  lookupRegistry.register({
    module: 'mdm', name, label: COMMON[master].label, permission: 'mdm.record.view', columns,
    search(db, actor, q) {
      gate(actor);
      const s = commonOf(db);
      const hi = s.lookups.languageOf(actor) === 'hi';
      const out = s.list(actor, master, { q: q.text || undefined, limit: q.ids ? 100 : q.limit, offset: q.ids ? 0 : q.offset });
      const rows = out.rows.filter((r) => !q.ids || q.ids.includes(r.id)).map((r) => ({ id: r.id, ...map(r, hi) }));
      return { rows, total: q.ids ? rows.length : out.total };
    },
  });
}
// one lookup per list: /mdm/lookups/priority, /mdm/lookups/doc-category ...
lookupRegistry.registerFamily('mdm', (name) => (COMMON[name] || !/^[a-z][a-z0-9-]*$/.test(name) ? null : {
  module: 'mdm', name, label: `Lookup list ${name}`, permission: 'mdm.record.view', anywhere: true, columns: [{ key: 'labelEn', label: 'English' }],
  search(db, actor, q) {
    gate(actor);
    const v = commonOf(db).lookups.values(actor, name);
    const rows = v.rows.filter((r) => (!q.ids || q.ids.includes(r.id)) && (!q.text || `${r.code} ${r.label} ${r.labelEn}`.toLowerCase().includes(q.text.toLowerCase())));
    return { rows: rows.slice(q.offset, q.offset + q.limit).map((r) => ({ id: r.id, code: r.code, name: r.label, extra: { labelEn: r.labelEn, language: v.language } })), total: rows.length };
  },
}));

// ---- Excel (04.13) ----
const XL = { uom: 'MDM_UOM', 'gst-rates': 'MDM_GST_RATE', 'hsn-sac': 'MDM_HSN_SAC', 'tds-sections': 'MDM_TDS_SECTION', states: 'MDM_STATE', districts: 'MDM_DISTRICT', currencies: 'MDM_CURRENCY', 'exchange-rates': 'MDM_EXCHANGE_RATE', banks: 'MDM_BANK', 'payment-terms': 'MDM_PAYMENT_TERM', lookups: 'MDM_LOOKUP' };
export const IMPORT_CODES = XL;
const colType = (x) => (x.type === 'int' ? { type: 'int', min: x.min, max: x.max } : x.type === 'bool' ? { type: 'bool' } : x.type === 'date' ? { type: 'date' } : x.type === 'enum' ? { type: 'enum', values: x.options.map(([k]) => k) } : { type: 'text', maxLength: x.type === 'json' ? 2000 : x.max ?? 200 });
for (const [code, xl] of Object.entries(XL)) {
  const d = COMMON[code];
  const cols = d.fields.map((x) => ({ key: x.key, label: x.label, required: Boolean(x.required), help: x.hint ?? (x.type === 'percent' ? 'A percentage, for example 18 or 0.25' : x.type === 'money' ? 'Rupees' : x.type === 'json' ? 'For example [{"label":"On delivery","pct":80,"days":0}]' : ''), ...colType(x) }));
  if (d.dated) cols.push({ key: 'effectiveFrom', label: 'Applies from', type: 'date', required: true, help: 'The date the rate applies from (a change applies after the current rate).' });
  cols.push({ key: 'justification', label: 'Justification', type: 'text', required: Boolean(d.approval), maxLength: 500, help: d.approval ? 'Why the rate changes, for example the notification number (the approvers read it).' : 'Optional: why the rows change.' });
  const keyOf = (row) => d.key.map((k) => String(row[k] ?? '').trim().toUpperCase());
  const data = (row) => Object.fromEntries(d.fields.filter((x) => row[x.key] != null).map((x) => [x.key, row[x.key]]));
  registerImportType({
    code: xl, label: `${d.label} (master data)`, module: 'master data', description: d.approval ? `${d.label}. Each row is a change request approved by an accounts manager and the CFO; nothing changes before that.` : `${d.label}. A row with an existing key can update it.`,
    permission: d.edit, exportPermission: 'mdm.record.view', onExisting: d.approval ? ['ERROR', 'UPDATE'] : ['ERROR', 'UPDATE', 'SKIP'], chunked: !d.approval,
    columns: cols, keys: d.key,
    findExisting(ctx, row) {
      const k = keyOf(row);
      const hit = commonOf(ctx.db).list(ctx.actor, code, { limit: 5000, offset: 0 }).rows.find((r) => d.key.every((kk, i) => String(r[kk] ?? '').toUpperCase() === k[i]));
      return hit ? { id: hit.id, version: hit.rowVersion } : null;
    },
    validateRow: (ctx) => (ctx.can(d.edit) ? [] : [{ message: `You may not change ${d.label.toLowerCase()} (permission ${d.edit}).`, code: 'PERMISSION' }]),
    commitRow(ctx, { row, existing, action }) {
      const s = commonOf(ctx.db);
      const r = action === 'update'
        ? s.update(ctx.actor, code, existing.id, { data: Object.fromEntries(Object.entries(data(row)).filter(([k]) => !d.key.includes(k))), version: existing.version, effectiveFrom: row.effectiveFrom ?? undefined, justification: row.justification ?? 'Imported from Excel' })
        : s.create(ctx.actor, code, { data: data(row), effectiveFrom: row.effectiveFrom ?? undefined, justification: row.justification ?? 'Imported from Excel' });
      return { id: r.row?.id ?? existing?.id ?? r.changeRequestId, ref: r.applied ? keyOf(row).join('/') : `${keyOf(row).join('/')} (request ${r.changeRequestId})` };
    },
    exportRows: (ctx) => commonOf(ctx.db).list(ctx.actor, code, { limit: 50_000, offset: 0 }).rows.map((r) => ({ ...r, milestones: r.milestones ? JSON.stringify(r.milestones) : undefined, effectiveFrom: r.effectiveFrom })),
  });
  registerExportSource({
    code: `mdm.common.${code}`, label: d.label, permission: 'mdm.record.view',
    columns: [...d.fields.map((x) => ({ key: x.key, label: x.label, ...(x.type === 'int' ? { type: 'number' } : {}) })), { key: 'effectiveFrom', label: 'Applies from' }, { key: 'effectiveTo', label: 'Applies until' }, { key: 'source', label: 'Source' }],
    rows: (ctx, filters) => commonOf(ctx.db).list(ctx.actor, code, { limit: 50_000, offset: 0, q: filters.q, asOf: filters.asOf, status: filters.status }).rows.map((r) => ({ ...r, milestones: r.milestones ? JSON.stringify(r.milestones) : undefined, source: r.system ? 'System' : 'Company' })),
  });
}
