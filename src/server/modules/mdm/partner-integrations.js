import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerImportType } from '../eng/excel.js';
import { CONSTITUTIONS, ROLES, partnersOf } from './partners.js';

// The business partner master (part 06.04) for the rest of the ERP: form lookups that offer only partners that can be chosen (BR-02: active; GET /api/v1/mdm/lookups/partners, /vendors, /subcontractors,
// /clients ...) and the Excel import (04.13): each row is a registration sent for approval, like one typed in the wizard; an import never approves anything (AC-04).
for (const [name, label, role] of [['partners', 'Business partners', null], ['vendors', 'Vendors', 'VENDOR'], ['subcontractors', 'Subcontractors', 'SUBCONTRACTOR'], ['labour-contractors', 'Labour contractors', 'LABOUR_CONTRACTOR'], ['clients', 'Clients', 'CLIENT'], ['consultants', 'Consultants', 'CONSULTANT'], ['transporters', 'Transporters', 'TRANSPORTER'], ['service-providers', 'Service providers', 'SERVICE_PROVIDER']]) {
  lookupRegistry.register({
    module: 'mdm', name, label, permission: 'mdm.record.view', columns: [{ key: 'trade', label: 'Trade name' }],
    search(db, actor, q) {
      const s = partnersOf(db);
      if (!s) return { rows: [], total: 0 };
      const out = s.lookup(actor, { q: q.text || undefined, role, limit: q.ids ? 200 : q.limit, offset: q.ids ? 0 : q.offset });
      return q.ids ? { rows: out.rows.filter((r) => q.ids.includes(r.id)), total: q.ids.length } : out;
    },
  });
}

const yes = (v) => v === true;
registerImportType({
  code: 'MDM_BUSINESS_PARTNER', label: 'Business partners (registrations)', module: 'master data',
  description: 'Each row registers a partner and sends it for approval (its steward, then the accounts manager). PAN, GSTIN and bank account are checked; a duplicate PAN, GSTIN or bank account is refused.',
  permission: 'mdm.partner.edit', exportPermission: 'mdm.record.view', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'legalName', label: 'Legal name', type: 'text', required: true, maxLength: 160 },
    { key: 'tradeName', label: 'Trade name', type: 'text', maxLength: 160 },
    { key: 'constitution', label: 'Constitution', type: 'enum', values: CONSTITUTIONS, required: true },
    { key: 'roles', label: 'Roles', type: 'text', required: true, maxLength: 120, help: `Comma separated: ${ROLES.join(', ')}` },
    { key: 'pan', label: 'PAN', type: 'text', maxLength: 10 },
    { key: 'gstin', label: 'GSTIN', type: 'text', maxLength: 15, help: 'The GSTIN of the state of the registered address' },
    { key: 'address', label: 'Registered address', type: 'text', required: true, maxLength: 300 },
    { key: 'city', label: 'City', type: 'text', maxLength: 60 },
    { key: 'stateCode', label: 'State code', type: 'text', required: true, maxLength: 3, help: 'For example MH or 27' },
    { key: 'pin', label: 'PIN code', type: 'text', maxLength: 6 },
    { key: 'contactName', label: 'Contact name', type: 'text', required: true, maxLength: 80 },
    { key: 'mobile', label: 'Contact mobile', type: 'text', maxLength: 16 },
    { key: 'email', label: 'Contact e-mail', type: 'text', maxLength: 120 },
    { key: 'msmeNo', label: 'Udyam number', type: 'text', maxLength: 19 },
    { key: 'msmeCategory', label: 'MSME category', type: 'enum', values: ['MICRO', 'SMALL', 'MEDIUM'] },
    { key: 'notDuplicate', label: 'Not a duplicate', type: 'bool', help: 'Yes when the row looks like an existing partner (similar name or same mobile) but is a different one.' },
  ],
  keys: ['legalName'],
  findExisting: () => null,
  validateRow(ctx, row) {
    const b = bodyOf(row);
    const c = partnersOf(ctx.db).registration.check(ctx.actor, b);
    const out = c.errors.map((e) => ({ column: colOf(e.field), message: e.message }));
    for (const d of c.duplicates) if (d.block || !yes(row.notDuplicate)) out.push({ column: colOf(d.field), message: `${d.rule} as ${d.code} ${d.name}${d.block ? '' : ': write Yes in "Not a duplicate" if it is a different partner'}`, code: d.block ? 'DUPLICATE' : 'POSSIBLE_DUPLICATE' });
    return out;
  },
  commitRow(ctx, { row }) {
    const r = partnersOf(ctx.db).registration.create(ctx.actor, { ...bodyOf(row), acknowledgeDuplicates: yes(row.notDuplicate), submit: true, comment: 'Imported from Excel' });
    return { id: r.id, ref: `${r.code} (waiting for approval)` };
  },
});
const colOf = (f) => (String(f ?? '').startsWith('gstins') ? 'gstin' : String(f ?? '').startsWith('addresses') ? 'address' : String(f ?? '').startsWith('contacts') ? 'mobile' : f);
function bodyOf(row) {
  const st = String(row.stateCode ?? '').toUpperCase();
  return {
    legalName: row.legalName, tradeName: row.tradeName ?? null, constitution: row.constitution, pan: row.pan ? String(row.pan).toUpperCase() : null, msmeNo: row.msmeNo ?? null, msmeCategory: row.msmeCategory ?? null, cin: null,
    roles: String(row.roles ?? '').split(',').map((x) => x.trim().toUpperCase().replace(/\s+/g, '_')).filter(Boolean), categories: [], regions: [],
    gstins: row.gstin ? [{ stateCode: st, gstin: String(row.gstin).toUpperCase() }] : [],
    addresses: [{ addressType: 'REGISTERED', address: row.address, city: row.city ?? null, stateCode: st, pin: row.pin ?? null }],
    contacts: [{ name: row.contactName, mobile: row.mobile ? String(row.mobile).replace(/[\s-]/g, '').replace(/^(\+91|0)/, '') : null, email: row.email ?? null, isPrimary: true }], bank: null, tds: [],
  };
}
