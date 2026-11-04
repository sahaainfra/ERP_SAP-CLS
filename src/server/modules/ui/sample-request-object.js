import { authzOf } from '../../platform/authz/index.js';
import { amountInWords } from '../../../shared/i18n/words.js';
import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { qrRegistry } from '../../platform/qr/index.js';
import { formatINR, fromUnits } from '../../../shared/money.js';
import { cancelNumber } from '../core/numbering/service.js';
import { missingDocuments } from './objects.js';

// The sample material request as an Object Page record (part 03.04): who may see it, which actions its status and the viewer allow, its
// approval chain, the snapshot used for the amendment comparison, its print layout and related records. Registered once; every hook gets
// the database it works on.
export const TYPE = 'sample_request';
export const DOC_TYPE = 'SAMPLE_MR';
export const APPROVAL_TYPE = 'sample_request_approval';
const PERMISSION = 'core.sample.use';
/** Requests worth ₹5,00,000 or more also need the CFO (a stand-in chain until the workflow engine of 04.01 holds the real ones). */
export const CHAIN_THRESHOLD_PAISE = 50_000_000;
export const approvalChain = (totalPaise) => (totalPaise >= CHAIN_THRESHOLD_PAISE ? ['ACCMGR', 'CFO'] : ['ACCMGR']);

export const maskRuleOf = (db, actor) => authzOf(db).maskRule(actor, 'ui_sample_request', 'total');
const money = (rule, v) => (rule === 'show' ? v : rule === 'hide' ? undefined : '•••');

/** The latest approval request raised for a request (each return and resubmit makes a new one), or null. */
export const latestApproval = (db, companyId, id) => db.prepare("SELECT id, status, chain_json, current_step, requested_by, version FROM core_change_requests WHERE company_id = ? AND target_type = 'sample_request' AND target_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 1").get(companyId, id) ?? null;

/** What the header, the lines and the total looked like, as plain values for the comparison. Unmasked: mask with maskSnapshot before showing. */
export function snapshotOf(db, id) {
  const r = db.prepare('SELECT r.*, p.code AS project_code, s.code AS site_code FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id LEFT JOIN org_sites s ON s.id = r.site_id WHERE r.id = ?').get(id);
  const lines = db.prepare('SELECT * FROM ui_sample_request_lines WHERE request_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  return {
    header: {
      title: r.title, docDate: r.doc_date, requiredBy: r.required_by, project: r.project_code, site: r.site_code ?? '', priority: r.priority, urgencyReason: r.urgency_reason ?? '',
      returnable: r.returnable === 1 ? 'Yes' : 'No', returnBy: r.return_by ?? '', deliveryNote: r.delivery_note ?? '', lineCount: String(r.line_count), total: fromUnits(r.total_amount, 'money').toFixed(2),
    },
    lines: lines.map((l) => ({ id: l.id, lineNo: l.line_no, description: l.description, uom: l.uom, quantity: fromUnits(l.quantity, 'quantity').toFixed(3), unitRate: fromUnits(l.unit_rate, 'rate').toFixed(4), amount: fromUnits(l.line_amount, 'money').toFixed(2), neededOn: l.needed_on ?? '', comment: l.comment ?? '' })),
  };
}
export function maskSnapshot(db, actor, snap) {
  const rule = maskRuleOf(db, actor);
  if (rule === 'show') return snap;
  const m = (o, keys) => { const c = { ...o }; for (const k of keys) { const v = money(rule, c[k]); if (v === undefined) delete c[k]; else c[k] = v; } return c; };
  return { header: m(snap.header, ['total']), lines: snap.lines.map((l) => m(l, ['unitRate', 'amount'])) };
}

const HEADER_FIELDS = [['title', 'Title'], ['docDate', 'Request date'], ['requiredBy', 'Required by'], ['project', 'Project'], ['site', 'Site'], ['priority', 'Priority'], ['urgencyReason', 'Urgency reason'], ['returnable', 'Returnable'], ['returnBy', 'Return by'], ['deliveryNote', 'Delivery instructions'], ['lineCount', 'Items'], ['total', 'Total (₹)']].map(([key, label]) => ({ key, label }));
const LINE_FIELDS = [['description', 'Description'], ['uom', 'Unit'], ['quantity', 'Quantity'], ['unitRate', 'Rate (₹)'], ['amount', 'Amount (₹)'], ['neededOn', 'Needed on'], ['comment', 'Comment']].map(([key, label]) => ({ key, label }));

/**
 * The actions a viewer may take on a request now (BR-01): every action that applies to the request's status, each with `allowed` and, when
 * not, the reason (shown as a tooltip and in text). `confirm` says how the browser must ask before doing it (BR-02).
 */
export function allowedActionsOf(db, actor, r) {
  const owner = actor.user === r.requested_by;
  const appr = latestApproval(db, r.company_id, r.id);
  const out = [];
  const add = (id, label, kind, allowed, reason, confirm = null) => out.push({ id, label, kind, allowed, reason: allowed ? null : reason, confirm });
  const onlyOwner = `Only ${r.requested_by}, who raised this request, can do this.`;
  if (r.status === 'DRAFT') {
    add('edit', 'Edit', 'secondary', owner, onlyOwner);
    add('submit', 'Submit for approval', 'primary', owner, onlyOwner, { title: 'Submit for approval?', text: 'The request gets its number and goes to the approvers. You can change it again only if it is returned to you.', reasonFor: null });
    add('cancel', 'Cancel request', 'danger', owner, onlyOwner, { title: 'Cancel this request?', text: 'A cancelled request cannot be changed or submitted. If it has a number, it keeps it.', reasonFor: 'cancel' });
  }
  if (r.status === 'SUBMITTED') {
    const open = appr?.status === 'SUBMITTED';
    if (open) {
      const chain = JSON.parse(appr.chain_json);
      const role = chain[appr.current_step - 1];
      const holds = role.split('|').some((x) => (actor.roles ?? []).includes(x));
      const missing = missingDocuments(db, { companyId: r.company_id, type: TYPE, docType: DOC_TYPE, id: r.id, stage: 'approve' });
      const why = (docs) => (owner ? 'You raised this request, so someone else must decide it.' : !holds ? `Waiting for ${role.replace('|', ' or ')} (step ${appr.current_step} of ${chain.length}).` : docs && missing.length ? `Attach ${missing.map((m) => m.label.toLowerCase()).join(' and ')} first.` : null);
      const can = (docs) => holds && !owner && !(docs && missing.length);
      add('approve', 'Approve', 'primary', can(true), why(true), { title: 'Approve this request?', text: appr.current_step === chain.length ? 'This is the last step: the request becomes approved.' : 'It then goes to the next approver.', reasonFor: null, commentOptional: true });
      add('return', 'Return for changes', 'secondary', can(false), why(false), { title: 'Return this request?', text: 'It goes back to the requester as a draft to be changed and sent again.', reasonFor: 'return' });
      add('reject', 'Reject', 'danger', can(false), why(false), { title: 'Reject this request?', text: 'A rejected request is cancelled. It keeps its number.', reasonFor: 'reject' });
    }
    add('cancel', 'Cancel request', 'danger', owner, onlyOwner, { title: 'Cancel this request?', text: open ? 'The open approval is withdrawn. The request keeps its number.' : 'The request keeps its number.', reasonFor: 'cancel' });
  }
  add('print', 'Print / PDF', 'secondary', true, null);
  return out;
}

/** An approval's effect on the request it governs, applied in the approver's transaction (rejection and return, through the engine's `decided` hook). */
export const sampleRequestHandlers = {
  [APPROVAL_TYPE]: {
    apply(db, request, actor) {
      writeAudit(db, { entity: 'ui_sample_requests', entityId: request.targetId, action: 'approve', newValues: { approval: request.id }, actor: actor.user, companyId: request.companyId });
      publishEvent(db, { type: 'ui.sample_request.approved', entity: 'sample_request', entityId: request.targetId, actorId: actor.user, companyId: request.companyId, data: { approval: request.id } });
    },
    decided(db, request, status, comment, actor) {
      const r = db.prepare('SELECT * FROM ui_sample_requests WHERE id = ? AND company_id = ?').get(request.targetId, request.companyId);
      if (!r || r.status !== 'SUBMITTED') return;
      const at = new Date().toISOString();
      if (status === 'REJECTED') {
        db.prepare("UPDATE ui_sample_requests SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, at, r.id);
        if (r.doc_no) cancelNumber(db, { companyId: r.company_id, docType: DOC_TYPE, number: r.doc_no, actor: actor.user });
        writeAudit(db, { entity: 'ui_sample_requests', entityId: r.id, action: 'reject', oldValues: { status: 'SUBMITTED' }, newValues: { status: 'CANCELLED', docNo: r.doc_no }, reason: comment, actor: actor.user, companyId: r.company_id });
        publishEvent(db, { type: 'ui.sample_request.rejected', entity: 'sample_request', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { docNo: r.doc_no } });
      } else {
        db.prepare("UPDATE ui_sample_requests SET status = 'DRAFT', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, at, r.id);
        writeAudit(db, { entity: 'ui_sample_requests', entityId: r.id, action: 'return', oldValues: { status: 'SUBMITTED' }, newValues: { status: 'DRAFT', docNo: r.doc_no }, reason: comment, actor: actor.user, companyId: r.company_id });
        publishEvent(db, { type: 'ui.sample_request.returned', entity: 'sample_request', entityId: r.id, actorId: actor.user, companyId: r.company_id, data: { docNo: r.doc_no } });
      }
    },
  },
};

function printOf(db, actor, id) {
  const r = db.prepare('SELECT r.*, p.code AS project_code, p.name AS project_name, s.code AS site_code FROM ui_sample_requests r JOIN org_projects p ON p.id = r.project_id LEFT JOIN org_sites s ON s.id = r.site_id WHERE r.id = ?').get(id);
  const snap = maskSnapshot(db, actor, snapshotOf(db, id));
  const rows = snap.lines.map((l) => ({ no: l.lineNo, description: l.description, uom: l.uom, quantity: l.quantity, unitRate: l.unitRate ?? '', amount: l.amount ?? '', neededOn: l.neededOn }));
  const approval = latestApproval(db, r.company_id, id);
  const total = snap.header.total === undefined ? '' : snap.header.total === '•••' ? '•••' : formatINR(snap.header.total);
  const footer = [
    `Project ${r.project_code} ${r.project_name}${r.site_code ? `, site ${r.site_code}` : ''}. Requested by ${r.requested_by}. Required by ${r.required_by}. Priority ${r.priority.toLowerCase()}.`,
    `Status ${r.status.toLowerCase()}${approval ? `, approval ${approval.status.toLowerCase()}` : ''}. Total ${total}.`,
    // the amount in words (part 03.09, BR-02); the printed page is English because the standard PDF fonts have no Devanagari (D-164)
    ...(/^\d+(\.\d+)?$/.test(String(snap.header.total ?? '')) ? [`Amount in words: ${amountInWords(snap.header.total, 'en')}`] : []),
    `Printed by ${actor.user} at ${new Date(Date.now() + 19_800_000).toISOString().replace('T', ' ').slice(0, 16)} (IST)`,
  ];
  const buffer = toPdf({ title: `Sample material request ${r.doc_no ?? `(draft ${r.id})`}: ${r.title}`, columns: [{ key: 'no', label: '#', type: 'number' }, { key: 'description', label: 'Description', type: 'text' }, { key: 'uom', label: 'Unit', type: 'text' }, { key: 'quantity', label: 'Quantity', type: 'number' }, { key: 'unitRate', label: 'Rate', type: 'money' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'neededOn', label: 'Needed on', type: 'date' }], rows, footer });
  return { buffer, fileName: `sample-request-${(r.doc_no ?? `draft-${r.id}`).replace(/[^A-Za-z0-9-]+/g, '-')}.pdf` };
}

objectTypes.register({
  type: TYPE,
  label: 'Sample material request',
  permission: PERMISSION,
  route: (id) => `/admin/sample-requests?open=${id}`,
  approvalTarget: 'sample_request',
  documentType: DOC_TYPE,
  attachmentEntity: 'sample_request',
  access(db, actor, id) {
    const r = db.prepare('SELECT company_id, project_id, site_id, status FROM ui_sample_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    if (!r || !authzOf(db).check(actor, PERMISSION, { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id ?? undefined }).allowed) return null;
    return { companyId: r.company_id, projectId: r.project_id, siteId: r.site_id, status: r.status };
  },
  auditEntities: (id) => [{ entity: 'ui_sample_requests', id }],
  summary(db, actor, id) {
    const r = db.prepare('SELECT doc_no, title, status FROM ui_sample_requests WHERE id = ? AND company_id = ?').get(id, actor.companyId);
    return r ? { label: r.doc_no ? `${r.doc_no}: ${r.title}` : r.title, status: r.status } : null;
  },
  projectRecords: (db, companyId, projectId, limit) => db.prepare('SELECT id FROM ui_sample_requests WHERE company_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(companyId, projectId, limit).map((r) => r.id),
  related(db, actor, id) {
    const r = db.prepare('SELECT source_type, source_id FROM ui_sample_requests WHERE id = ? AND company_id = ?').get(id, actor.companyId);
    const out = [];
    if (r?.source_type === 'core.sample_document' && r.source_id) {
      const d = db.prepare('SELECT doc_no, title FROM core_sample_documents WHERE id = ? AND company_id = ?').get(Number(r.source_id), actor.companyId);
      if (d) out.push({ kind: 'Source document', label: `${d.doc_no ?? `#${r.source_id}`}: ${d.title}`, to: '/admin/sample-documents', direction: 'source' });
    }
    return out;
  },
  snapshot: (db, _actor, id) => snapshotOf(db, id),
  compare: { header: HEADER_FIELDS, line: LINE_FIELDS },
  maskSnapshot,
  maskEntries(db, actor, values) {
    if (!values || typeof values !== 'object') return values;
    const rule = maskRuleOf(db, actor);
    if (rule === 'show' || !('total' in values)) return values;
    const out = { ...values };
    if (rule === 'hide') delete out.total; else out.total = '•••';
    return out;
  },
  print: printOf,
});


// Part 03.06: the scanner opens a sample request from its printed number or from an ERP:SAMPLE_REQUEST:<id> code, if the person may open it.
qrRegistry.register({
  type: 'SAMPLE_REQUEST',
  label: 'Sample material request',
  match: ({ code, typed }) => typed?.type === 'SAMPLE_REQUEST' || /^MR\/\d{4}-\d{2}\/\d{1,8}$/.test(code),
  resolve(db, actor, { code, typed }) {
    const row = typed?.type === 'SAMPLE_REQUEST'
      ? db.prepare('SELECT id, doc_no, title FROM ui_sample_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(typed.ref) || 0, actor.companyId)
      : db.prepare('SELECT id, doc_no, title FROM ui_sample_requests WHERE doc_no = ? AND company_id = ? AND deleted_at IS NULL').get(code, actor.companyId);
    if (!row || !objectTypes.get(TYPE).access(db, actor, row.id)) return null;
    return { id: row.id, title: row.doc_no ? `${row.doc_no}: ${row.title}` : row.title, route: `/admin/sample-requests?open=${row.id}` };
  },
});
