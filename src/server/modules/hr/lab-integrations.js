import { lookupRegistry } from '../../platform/lookups/index.js';
import { registerImportType } from '../eng/excel.js';
import { labourOf } from './labour.js';

// Contract labour for the rest of the ERP (part 07.08): the lookup of workers for the crew screen, and the Excel import of workers (04.13): each row is a worker sent for approval like one typed on the form; the contractor
// is named by its code in the partner master, and an import approves nothing (AC-04).
lookupRegistry.register({
  module: 'hr', name: 'workers', label: 'Contract workers', permission: 'hr.worker.view', columns: [{ key: 'trade', label: 'Trade' }],
  search(db, actor, q) { const s = labourOf(db); return s ? s.lookup(actor, { q: q.text || undefined, limit: q.limit, offset: q.offset, ids: q.ids, contractorId: q.parent }) : { rows: [], total: 0 }; },
});
const SKILLS = ['UNSKILLED', 'SEMI_SKILLED', 'SKILLED', 'HIGHLY_SKILLED'];
const contractorOf = (ctx, code) => ctx.db.prepare("SELECT p.id FROM mdm_partners p WHERE p.company_id = ? AND p.code = ? COLLATE NOCASE AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'LABOUR_CONTRACTOR' AND r.deleted_at IS NULL)").get(ctx.companyId, code)?.id ?? null;
const bodyOf = (ctx, row) => ({ name: String(row.name).trim(), photoFileId: null, aadhaar: row.aadhaar ? String(row.aadhaar).replace(/\D/g, '') : null, mobile: row.mobile ? String(row.mobile).replace(/\D/g, '') : null, dob: row.dob, gender: String(row.gender ?? '').toUpperCase(), homeState: row.homeState ?? null, tradeCode: String(row.trade ?? '').toUpperCase(), skillCategory: String(row.skill ?? '').toUpperCase().replace(' ', '_').replace('-', '_'), contractorId: contractorOf(ctx, row.contractor), bankAccount: null, ifsc: null, uan: null, esicIp: null, bocwNo: row.bocwNo ?? null, emergencyName: null, emergencyMobile: null });
registerImportType({
  code: 'HR_WORKER', label: 'Contract workers (sent for approval)', module: 'hr',
  description: 'Each row registers a contract worker under a labour contractor and sends it for approval: supervisor first, then the HR manager. Nobody under 18 is accepted; an ID number already registered is refused. The contractor is given by its partner code.',
  permission: 'hr.worker.create', exportPermission: 'hr.worker.export', onExisting: ['ERROR'], chunked: true,
  columns: [
    { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 100 }, { key: 'dob', label: 'Date of birth', type: 'date', required: true }, { key: 'gender', label: 'Gender', type: 'text', required: true, maxLength: 6, help: 'MALE, FEMALE or OTHER' },
    { key: 'aadhaar', label: 'ID number (Aadhaar)', type: 'text', required: true, maxLength: 14 }, { key: 'mobile', label: 'Mobile', type: 'text', maxLength: 12 }, { key: 'contractor', label: 'Contractor code', type: 'text', required: true, maxLength: 30 },
    { key: 'trade', label: 'Trade', type: 'text', required: true, maxLength: 30 }, { key: 'skill', label: 'Skill', type: 'text', required: true, maxLength: 20, help: 'UNSKILLED, SEMI_SKILLED, SKILLED or HIGHLY_SKILLED' },
    { key: 'homeState', label: 'Home state', type: 'text', maxLength: 40 }, { key: 'bocwNo', label: 'BOCW number', type: 'text', maxLength: 40 },
  ],
  keys: ['aadhaar'], findExisting: () => null,
  validateRow(ctx, row) {
    const out = []; const b = bodyOf(ctx, row);
    if (!b.contractorId) out.push({ column: 'contractor', message: `${row.contractor} is not a labour contractor` });
    if (!['MALE', 'FEMALE', 'OTHER'].includes(b.gender)) out.push({ column: 'gender', message: 'Use MALE, FEMALE or OTHER' });
    if (!SKILLS.includes(b.skillCategory)) out.push({ column: 'skill', message: 'Use UNSKILLED, SEMI_SKILLED, SKILLED or HIGHLY_SKILLED' });
    if (!/^\d{12}$/.test(b.aadhaar ?? '')) out.push({ column: 'aadhaar', message: 'The ID number is 12 digits' });
    if (b.mobile && !/^\d{10}$/.test(b.mobile)) out.push({ column: 'mobile', message: 'The mobile number is 10 digits' });
    return out;
  },
  commitRow(ctx, { row }) {
    const r = labourOf(ctx.db).workers.create(ctx.actor, { ...bodyOf(ctx, row), submit: true, comment: 'Imported from Excel' });
    return { id: r.id, ref: `${r.workerCode} (waiting for approval)` };
  },
});
