import { registerImportType } from '../eng/excel.js';
import { BID_TYPES, PORTALS } from './tender-constants.js';
import { tendersOf } from './tender.js';

// The tender register for the rest of the ERP (part 08.02): the Excel import (04.13). A row makes a draft tender of the person who imports it; the registration is sent for approval by hand and an import never approves it (AC-04).
const clientByCode = (db, companyId, code) => db.prepare("SELECT p.id FROM mdm_partners p WHERE p.company_id = ? AND lower(p.code) = lower(?) AND p.deleted_at IS NULL AND p.partner_status IN ('PROSPECT', 'PENDING', 'ACTIVE') AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'CLIENT' AND r.deleted_at IS NULL)").get(companyId, String(code ?? '').trim())?.id ?? null;
registerImportType({
  code: 'BD_TENDER', label: 'Tenders (drafts)', module: 'business development',
  description: 'Each row makes a draft tender of the person who imports it, for an authority of the partner master (by its code). The registration is sent for approval by hand.',
  permission: 'bd.tender.import', exportPermission: 'bd.tender.export', onExisting: ['ERROR'], chunked: false,
  columns: [
    { key: 'clientCode', label: 'Authority code', type: 'text', required: true, maxLength: 30 }, { key: 'referenceNo', label: 'Tender reference', type: 'text', required: true, maxLength: 80 }, { key: 'portal', label: 'Portal', type: 'enum', values: Object.keys(PORTALS) },
    { key: 'nameOfWork', label: 'Name of work', type: 'text', required: true, maxLength: 300 }, { key: 'location', label: 'Location', type: 'text', maxLength: 120 }, { key: 'region', label: 'Region', type: 'text', maxLength: 40 },
    { key: 'estCost', label: 'Estimated cost (₹)', type: 'money', required: true, min: 0 }, { key: 'emd', label: 'EMD (₹)', type: 'money', min: 0 }, { key: 'tenderFee', label: 'Tender fee (₹)', type: 'money', min: 0 },
    { key: 'bidType', label: 'Bid type', type: 'enum', values: Object.keys(BID_TYPES) }, { key: 'periodMonths', label: 'Completion period (months)', type: 'int', min: 1, max: 240 },
    { key: 'publishDate', label: 'Publication date', type: 'date' }, { key: 'prebidDate', label: 'Pre-bid date', type: 'date' }, { key: 'submissionDate', label: 'Submission date', type: 'date', required: true }, { key: 'submissionTime', label: 'Submission time (HH:MM)', type: 'text', maxLength: 5 },
  ],
  keys: ['referenceNo'], findExisting: () => null,
  validateRow(ctx, row) {
    const out = [];
    if (!clientByCode(ctx.db, ctx.actor.companyId, row.clientCode)) out.push({ column: 'clientCode', message: `${row.clientCode} is not a client of the partner master` });
    if (row.submissionTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.submissionTime)) out.push({ column: 'submissionTime', message: 'Use HH:MM, such as 15:00' });
    if (row.prebidDate && row.submissionDate && row.submissionDate < row.prebidDate) out.push({ column: 'submissionDate', message: 'The submission is on or after the pre-bid date' });
    return out;
  },
  commitRow(ctx, { row }) {
    const r = tendersOf(ctx.db).tenders.create(ctx.actor, { clientPartnerId: clientByCode(ctx.db, ctx.actor.companyId, row.clientCode), referenceNo: row.referenceNo, portal: row.portal ?? 'OTHER', nameOfWork: row.nameOfWork, location: row.location ?? null, region: row.region ?? null, estCost: Number(row.estCost ?? 0), emd: Number(row.emd ?? 0), tenderFee: Number(row.tenderFee ?? 0), bidType: row.bidType ?? 'ITEM_RATE', periodMonths: row.periodMonths ?? 12, publishDate: row.publishDate ?? null, prebidDate: row.prebidDate ?? null, submissionAt: `${row.submissionDate}T${row.submissionTime || '17:00'}`, submit: false });
    return { id: r.id, ref: `${r.docNo} (draft)` };
  },
});
