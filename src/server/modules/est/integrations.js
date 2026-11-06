import { registerImportType } from '../eng/excel.js';
import { estimatesOf } from './estimate.js';
import { mtoOf } from './mto.js';

// Part 09.01 for the rest of the ERP: the Excel import (04.13) of a client BOQ into a draft estimate version. Each row adds an unpriced item (section, item number, description, unit, quantity, the client's rate);
// the estimator prices it afterwards. The same check runs for rows pasted on the Import Client BOQ page.
registerImportType({
  code: 'EST_BOQ', label: 'Client BOQ into an estimate', module: 'estimation',
  description: 'Each row adds an item of the client BOQ to a draft estimate version (give its number and version). Items are added unpriced and keep the client\'s rate; price them in the estimate.',
  permission: 'est.estimate.import', exportPermission: 'est.estimate.view', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'estimateNo', label: 'Estimate', type: 'text', required: true, maxLength: 40 }, { key: 'versionNo', label: 'Version', type: 'int', min: 1 },
    { key: 'sectionCode', label: 'Section', type: 'text', required: true, maxLength: 40 }, { key: 'sectionName', label: 'Section name', type: 'text', maxLength: 200 },
    { key: 'itemNo', label: 'Item no.', type: 'text', required: true, maxLength: 40 }, { key: 'description', label: 'Description', type: 'text', required: true, maxLength: 2000 },
    { key: 'uom', label: 'Unit', type: 'text', required: true, maxLength: 20 }, { key: 'qty', label: 'Quantity', type: 'decimal', required: true, min: 0 }, { key: 'clientRate', label: 'Client rate (₹)', type: 'money', min: 0 },
  ],
  keys: ['estimateNo', 'itemNo'], findExisting: () => null,
  validateRow() { return []; },
  commitRow(ctx, { row }) {
    return estimatesOf(ctx.db).estimates.importRow(ctx.actor, { estimateNo: row.estimateNo, versionNo: row.versionNo ?? 1, row: { sectionCode: row.sectionCode, sectionName: row.sectionName ?? null, itemNo: row.itemNo, description: row.description, uom: row.uom, qty: String(row.qty), clientRate: row.clientRate == null ? null : String(row.clientRate) } });
  },
});

// Part 09.02: the line items of an engineering MTO (piping, structural steel, electrical) as exported from the design tool, into a draft take-off of kind Engineering MTO.
registerImportType({
  code: 'EST_MTO', label: 'Engineering MTO lines', module: 'estimation',
  description: 'Each row adds a line item to a draft engineering MTO (give its number and revision): the tag or BOQ reference, the description and spec, the quantity and unit. The quantity is taken as given.',
  permission: 'est.takeoff.import', exportPermission: 'est.takeoff.view', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'docNo', label: 'MTO', type: 'text', required: true, maxLength: 40 }, { key: 'revisionNo', label: 'Revision', type: 'int', min: 0 },
    { key: 'boqItemRef', label: 'Tag or BOQ item', type: 'text', maxLength: 40 }, { key: 'description', label: 'Description', type: 'text', required: true, maxLength: 1000 },
    { key: 'spec', label: 'Specification', type: 'text', maxLength: 500 }, { key: 'quantity', label: 'Quantity', type: 'decimal', required: true, min: 0 }, { key: 'uom', label: 'Unit', type: 'text', required: true, maxLength: 20 },
  ],
  keys: ['docNo', 'boqItemRef'], findExisting: () => null,
  validateRow() { return []; },
  commitRow(ctx, { row }) {
    return mtoOf(ctx.db).takeoffs.importLine(ctx.actor, { docNo: row.docNo, revisionNo: row.revisionNo ?? 0, line: { boqItemRef: row.boqItemRef ?? null, description: row.description, spec: row.spec ?? null, template: 'DIRECT', quantity: String(row.quantity), uom: row.uom } });
  },
});
