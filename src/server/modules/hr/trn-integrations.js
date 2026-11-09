import { registerImportType } from '../eng/excel.js';
import { trainingOf } from './training.js';

// Training for the rest of the ERP (part 07.10): the Excel import of the certificates and licences people hold already (04.13). Each row is recorded like one typed on the form: it is not verified, and a certificate that does not count
// for a check until HR (somebody other than the importer) verifies it (AC-04).
const emp = (ctx, code) => ctx.db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND emp_code = ? COLLATE NOCASE AND deleted_at IS NULL").get(ctx.actor.companyId, String(code ?? '').trim())?.id ?? null;
registerImportType({
  code: 'TRN_CERT', label: 'Certificates and licences (to be verified)', module: 'hr',
  description: 'Each row records a certificate or licence of an employee, found by employee code. Nothing is verified by an import: HR verifies each certificate before it counts for a check. A certificate of the same type and number already recorded is refused.',
  permission: 'hr.cert.create', exportPermission: 'hr.cert.export', onExisting: ['ERROR'], chunked: true,
  columns: [
    { key: 'employee', label: 'Employee code', type: 'text', required: true, maxLength: 30 }, { key: 'certType', label: 'Certificate type code', type: 'text', required: true, maxLength: 30 },
    { key: 'number', label: 'Number', type: 'text', maxLength: 60 }, { key: 'issuer', label: 'Issued by', type: 'text', maxLength: 100 },
    { key: 'validFrom', label: 'Valid from', type: 'date', required: true }, { key: 'validUntil', label: 'Valid until', type: 'date' },
  ],
  keys: ['employee', 'certType', 'number'], findExisting: () => null,
  validateRow(ctx, row) {
    const out = [];
    if (!emp(ctx, row.employee)) out.push({ column: 'employee', message: `${row.employee} is not an employee code` });
    if (!ctx.db.prepare('SELECT 1 FROM trn_cert_types WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(ctx.actor.companyId, String(row.certType ?? '').trim())) out.push({ column: 'certType', message: `${row.certType} is not a certificate type` });
    if (row.validUntil && row.validFrom && row.validUntil < row.validFrom) out.push({ column: 'validUntil', message: 'The certificate cannot end before it starts' });
    return out;
  },
  commitRow(ctx, { row }) {
    const r = trainingOf(ctx.db).certs.create(ctx.actor, { personType: 'EMPLOYEE', personId: emp(ctx, row.employee), certType: String(row.certType).trim().toUpperCase(), number: row.number ? String(row.number) : null, issuer: row.issuer ? String(row.issuer) : null, validFrom: row.validFrom, validUntil: row.validUntil || null, fileId: null });
    return { id: r.id, ref: `${r.certName} ${r.number ?? ''} (to be verified)` };
  },
});
