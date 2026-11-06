import { registerImportType } from '../eng/excel.js';
import { CRED_TYPES, awardsOf } from './award.js';
import { SECTORS } from './constants.js';

// Part 08.03 for the rest of the ERP: the Excel import (04.13) of the credentials library (the work orders, completion certificates and financials a company has, loaded once).
registerImportType({
  code: 'BD_CREDENTIAL', label: 'Tender credentials (library)', module: 'business development',
  description: 'Each row adds a credential to the library: a work order, a completion certificate, audited financials, machinery or a key person. Files are attached afterwards on the credential.',
  permission: 'bd.credential.manage', exportPermission: 'bd.credential.view', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'type', label: 'Type', type: 'enum', values: Object.keys(CRED_TYPES), required: true }, { key: 'title', label: 'Title', type: 'text', required: true, maxLength: 200 }, { key: 'clientName', label: 'Client', type: 'text', maxLength: 160 },
    { key: 'sector', label: 'Sector', type: 'enum', values: Object.keys(SECTORS) }, { key: 'value', label: 'Value (₹)', type: 'money', min: 0 }, { key: 'completionDate', label: 'Completed on', type: 'date' }, { key: 'validUntil', label: 'Valid until', type: 'date' }, { key: 'tags', label: 'Tags (comma separated)', type: 'text', maxLength: 300 },
  ],
  keys: ['title'], findExisting: () => null,
  validateRow() { return []; },
  commitRow(ctx, { row }) {
    const r = awardsOf(ctx.db).credentials.create(ctx.actor, { type: row.type, title: row.title, clientName: row.clientName ?? null, sector: row.sector ?? null, value: row.value == null ? null : Number(row.value), completionDate: row.completionDate ?? null, validUntil: row.validUntil ?? null, tags: String(row.tags ?? '').split(',').map((x) => x.trim()).filter(Boolean), notes: null });
    return { id: r.id, ref: r.docNo };
  },
});
