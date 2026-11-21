import { transaction } from '../../platform/db/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { enggOf } from './drawings.js';
import { vdrList } from './deliverables.js';
import { VDR_DOC, VDR_STATUS, VDR_TYPES, esc, nowIso, rid, same } from './constants.js';

// Vendor document review (part 11.04, FR-04): the documents a vendor owes on a purchase order (GA drawings, data sheets, test procedures, manuals) with their due dates. The vendor's submission is recorded (through the portal, 25.02, when it exists), the review code
// A to D is proposed by the reviewer and approved by the engineering manager; A and B accept the document, C and D send it back to the vendor for another cycle. The purchase orders themselves (15.05) are referred to by number until that part exists.
export function createVdrService({ db, base }) {
  const { may, need, fail, project, orgOf, scopeSql, audit, event, today } = base;
  const row = (actor, id, key = 'engg.vdr_item.view') => {
    const r = db.prepare('SELECT * FROM engg_vdr_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'engg.vdr_item.view', r.org_project_id)) throw notFound('That VDR item does not exist.');
    if (key !== 'engg.vdr_item.view') need(actor, key, 'do that with a VDR item', r.org_project_id);
    return r;
  };
  const fresh = (id) => db.prepare('SELECT * FROM engg_vdr_items WHERE id = ?').get(id);
  const nextNo = (companyId) => { let k = db.prepare('SELECT COUNT(*) AS n FROM engg_vdr_items WHERE company_id = ?').get(companyId).n + 1; let no = `VDR-${String(k).padStart(5, '0')}`; while (db.prepare('SELECT 1 FROM engg_vdr_items WHERE company_id = ? AND vdr_no = ?').get(companyId, no)) { k += 1; no = `VDR-${String(k).padStart(5, '0')}`; } return no; };
  function view(actor, r) {
    const o = orgOf(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const day = today(); const editable = ['REQUIRED', 'RETURNED', 'RESUBMIT'].includes(r.status);
    return {
      id: r.id, shareWithSupplier: Boolean(linkedOrder(r.id)), vdrNo: r.vdr_no, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, poRef: r.po_ref, vendor: r.vendor, docType: r.doc_type, docTypeLabel: VDR_TYPES[r.doc_type], title: r.title, dueDate: r.due_date, submittedOn: r.submitted_on, cycle: r.cycle_no,
      reviewCode: r.review_code, reviewText: r.review_text, reviewedOn: r.reviewed_on, pendingCode: r.pending_code, pendingText: r.pending_text, status: r.status, statusLabel: VDR_STATUS[r.status], overdue: ['REQUIRED', 'RESUBMIT'].includes(r.status) && r.due_date < day,
      requestedBy: r.requested_by, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { edit: can('engg.vdr_item.edit') && editable, receive: can('engg.vdr_item.edit') && ['REQUIRED', 'RESUBMIT'].includes(r.status), review: can('engg.vdr_item.submit') && r.status === 'RECEIVED', withdraw: r.status === 'IN_REVIEW' && same(r.requested_by, actor.user),
        cancel: can('engg.vdr_item.cancel') && ['REQUIRED', 'RESUBMIT', 'RECEIVED', 'RETURNED'].includes(r.status), delete: can('engg.vdr_item.delete') && r.status === 'REQUIRED' && r.cycle_no === 1 && !r.workflow_instance_id, amend: can('engg.vdr_item.amend') && ['ACCEPTED', 'CANCELLED'].includes(r.status), print: can('engg.vdr_item.print'), export: can('engg.vdr_item.export') },
    };
  }
  const linkedOrder = (id) => db.prepare('SELECT po_id FROM ptl_vdr_orders WHERE item_id = ?').get(id)?.po_id ?? null;
  function markedOrder(companyId, projectId, poRef, vendor) {
    const order = db.prepare(`SELECT p.id FROM proc_purchase_orders p JOIN mdm_partners v
      ON v.id = p.vendor_id AND v.company_id = p.company_id WHERE p.company_id = ? AND p.org_project_id = ?
      AND p.doc_no = ? AND p.status IN ('APPROVED', 'CLOSED') AND p.deleted_at IS NULL
      AND v.deleted_at IS NULL AND (? COLLATE NOCASE IN (v.legal_name, v.trade_name, v.code))`)
      .get(companyId, projectId, poRef, vendor);
    if (!order) throw unprocessable('Sharing requires an approved purchase order number and its exact supplier name or code.');
    return order.id;
  }
  const supplierView = (r) => ({ id: r.id, reference: r.vdr_no, title: r.title, dueDate: r.due_date,
    status: r.status, reviewCode: r.review_code, reviewText: r.review_text, version: r.version });
  function receive(actor, r, submittedOn) {
    if (!['REQUIRED', 'RESUBMIT'].includes(r.status)) throw unprocessable('A submission is recorded on a document the vendor still owes.');
    const day = submittedOn ?? today();
    if (day > today()) fail([{ field: 'submittedOn', message: 'The date of a submission is not in the future' }]);
    db.prepare("UPDATE engg_vdr_items SET status = 'RECEIVED', submitted_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?")
      .run(day, actor.user, nowIso(), r.id);
    audit(actor, 'engg_vdr_items', r.id, 'receive', r.company_id);
  }
  const COLS = { poRef: 'po_ref', vendor: 'vendor', docType: 'doc_type', title: 'title', dueDate: 'due_date' };
  const vdr = {
    list(actor, query) {
      need(actor, 'engg.vdr_item.view', 'see VDR items'); const s = scopeSql(actor, 'engg.vdr_item.view');
      return runList(db, vdrList, parseListRequest(vdrList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, vdrNo: v.vdrNo, projectId: v.projectId, project: v.projectCode, poRef: v.poRef, vendor: v.vendor, docType: v.docTypeLabel, title: v.title, dueDate: v.dueDate, submittedOn: v.submittedOn, status: v.status, statusLabel: v.statusLabel, reviewCode: v.reviewCode, cycle: v.cycle, overdue: v.overdue ? 1 : 0 }; } });
    },
    exportSource(actor, req) {
      need(actor, 'engg.vdr_item.export', 'export the VDR tracker'); const s = scopeSql(actor, 'engg.vdr_item.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: vdrList.label, permission: 'engg.vdr_item.export', personal: false, columns: [{ key: 'vdrNo', label: 'VDR no.', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'poRef', label: 'PO', type: 'text' }, { key: 'vendor', label: 'Vendor', type: 'text' }, { key: 'docType', label: 'Document', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'dueDate', label: 'Due', type: 'text' }, { key: 'submittedOn', label: 'Submitted', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'reviewCode', label: 'Review code', type: 'text' }],
        rows: () => runList(db, vdrList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { vdrNo: v.vdrNo, project: v.projectCode, poRef: v.poRef, vendor: v.vendor, docType: v.docTypeLabel, title: v.title, dueDate: v.dueDate, submittedOn: v.submittedOn ?? '', status: v.statusLabel, reviewCode: v.reviewCode ?? '' }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All VDR items you may see'], count: () => countList(db, vdrList, req, opts) };
    },
    /** The tracker by purchase order and vendor: how many documents are required, received, in review, accepted and overdue. */
    tracker(actor, q = {}) {
      need(actor, 'engg.vdr_item.view', 'see the VDR tracker'); const s = scopeSql(actor, 'engg.vdr_item.view'); const params = { ...s.params }; let extra = ''; if (q.projectId) { extra = ' AND x.org_project_id = :pid'; params.pid = Number(q.projectId); }
      const day = today(); const list = db.prepare(`SELECT x.*, p.code AS pcode FROM engg_vdr_items x JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.status <> 'CANCELLED' AND ${s.sql}${extra} ORDER BY x.po_ref, x.vendor, x.due_date`).all(params); const groups = new Map();
      for (const r of list) { const k = `${r.org_project_id}|${r.po_ref}|${r.vendor}`; const g = groups.get(k) ?? { project: r.pcode, projectId: r.org_project_id, poRef: r.po_ref, vendor: r.vendor, total: 0, required: 0, received: 0, inReview: 0, accepted: 0, resubmit: 0, overdue: 0 }; g.total += 1; if (r.status === 'REQUIRED') g.required += 1; if (r.status === 'RECEIVED') g.received += 1; if (r.status === 'IN_REVIEW') g.inReview += 1; if (r.status === 'ACCEPTED') g.accepted += 1; if (r.status === 'RESUBMIT') g.resubmit += 1; if (['REQUIRED', 'RESUBMIT'].includes(r.status) && r.due_date < day) g.overdue += 1; groups.set(k, g); }
      return { asOf: day, groups: [...groups.values()].map((g) => ({ ...g, acceptedPct: g.total ? Math.round((g.accepted / g.total) * 100) : 0 })), totals: { total: list.length, accepted: list.filter((r) => r.status === 'ACCEPTED').length, overdue: list.filter((r) => ['REQUIRED', 'RESUBMIT'].includes(r.status) && r.due_date < day).length } };
    },
    get(actor, id) { return view(actor, row(actor, id)); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'engg.vdr_item.create', 'engg.vdr_item.view');
      return transaction(db, () => {
        const poId = b.shareWithSupplier ? markedOrder(o.company_id, o.id, b.poRef, b.vendor) : null;
        const id = Number(db.prepare("INSERT INTO engg_vdr_items (company_id, vdr_no, org_project_id, po_ref, vendor, doc_type, title, due_date, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_vdr_items', ?)").run(o.company_id, nextNo(o.company_id), o.id, b.poRef, b.vendor, b.docType, b.title, b.dueDate, o.id, actor.user, b.poRef).lastInsertRowid);
        if (poId) db.prepare('INSERT INTO ptl_vdr_orders (item_id, po_id) VALUES (?, ?)').run(id, poId);
        audit(actor, 'engg_vdr_items', id, 'create', o.company_id, { newValues: { poRef: b.poRef, vendor: b.vendor } }); return vdr.get(actor, id);
      });
    },
    update(actor, id, b) {
      return transaction(db, () => {
        const r = row(actor, id, 'engg.vdr_item.edit');
        if (!['REQUIRED', 'RETURNED', 'RESUBMIT'].includes(r.status)) throw conflict(`${r.vdr_no} is ${VDR_STATUS[r.status].toLowerCase()}: it is not edited now.`);
        if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this VDR item; reload it.');
        const link = linkedOrder(r.id);
        const scopeChanged = (b.poRef !== undefined && b.poRef !== r.po_ref) || (b.vendor !== undefined && b.vendor !== r.vendor);
        if (scopeChanged && link) throw conflict('Create a new requirement to change the order or supplier on a shared VDR item.');
        const fields = Object.entries(COLS).filter(([key]) => key in b).map(([key, column]) => [column, b[key]]);
        if (b.shareWithSupplier === true && !link) {
          const poId = markedOrder(r.company_id, r.org_project_id, b.poRef ?? r.po_ref, b.vendor ?? r.vendor);
          db.prepare('INSERT INTO ptl_vdr_orders (item_id, po_id) VALUES (?, ?)').run(r.id, poId);
        }
        if (b.shareWithSupplier === false && link) {
          if (db.prepare("SELECT 1 FROM core_files WHERE linked_entity = 'engg_vdr_item' AND linked_id = ? AND deleted_at IS NULL").get(r.id)) {
            throw conflict('Sharing is locked after the supplier uploads a document.');
          }
          db.prepare('DELETE FROM ptl_vdr_orders WHERE item_id = ?').run(r.id);
        }
        const changes = [...fields.map(([column]) => `${column} = ?`), 'updated_by = ?', 'updated_at = ?', 'version = version + 1'];
        if (fields.length || b.shareWithSupplier !== undefined) db.prepare(`UPDATE engg_vdr_items SET ${changes.join(', ')} WHERE id = ?`)
          .run(...fields.map(([, value]) => value), actor.user, nowIso(), r.id);
        audit(actor, 'engg_vdr_items', r.id, 'update', r.company_id, { newValues: { shareWithSupplier: b.shareWithSupplier } });
        return vdr.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = row(actor, id, 'engg.vdr_item.delete'); if (r.status !== 'REQUIRED' || r.cycle_no !== 1 || r.workflow_instance_id) throw unprocessable('Only a requirement that was never touched is deleted.'); db.prepare('UPDATE engg_vdr_items SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'engg_vdr_items', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    receive(actor, id, b) {
      const r = row(actor, id, 'engg.vdr_item.edit');
      receive(actor, r, b.submittedOn);
      return vdr.get(actor, id);
    },
    supplierList(scope, order) {
      return db.prepare(`SELECT * FROM engg_vdr_items WHERE company_id = ? AND org_project_id = ? AND id IN (SELECT item_id FROM ptl_vdr_orders WHERE po_id = ?)
        AND deleted_at IS NULL AND is_active = 1 AND status <> 'CANCELLED'
        AND (? IS NULL OR site_id IS NULL OR site_id = ?) ORDER BY id DESC LIMIT 100`)
        .all(scope.companyId, order.org_project_id, order.id, scope.siteId, scope.siteId).map(supplierView);
    },
    supplierReceive(scope, order, id, version, attach) {
      return transaction(db, () => {
        const r = db.prepare(`SELECT * FROM engg_vdr_items WHERE company_id = ? AND org_project_id = ? AND id IN (SELECT item_id FROM ptl_vdr_orders WHERE po_id = ?)
          AND id = ? AND deleted_at IS NULL AND is_active = 1 AND (? IS NULL OR site_id IS NULL OR site_id = ?)`)
          .get(scope.companyId, order.org_project_id, order.id, id, scope.siteId, scope.siteId);
        if (!r || !['APPROVED', 'CLOSED'].includes(order.status)) throw notFound('That vendor document requirement is unavailable.');
        if (r.version !== version) throw conflict('The document requirement changed. Reload the order.');
        attach({ entity: 'engg_vdr_item', id: r.id, projectId: r.org_project_id, siteId: order.po_site_id });
        receive({ user: `portal-supplier:${scope.accountId}`, companyId: scope.companyId }, r);
        return supplierView(fresh(r.id));
      });
    },
    /** The reviewer proposes the review code; the engineering manager approves it before the vendor is told. */
    review(actor, id, b) {
      const r = row(actor, id, 'engg.vdr_item.submit'); if (r.status !== 'RECEIVED') throw unprocessable('Only a document that was received is reviewed.');
      if (['B', 'C', 'D'].includes(b.code) && !b.text) fail([{ field: 'text', message: `Say what the comments are (code ${b.code})` }]);
      return transaction(db, () => {
        const inst = workflowOf(db).submit(actor, { docType: VDR_DOC, docId: `${r.id}.${r.cycle_no}`, comment: `${r.vdr_no}: review code ${b.code}`.slice(0, 300), context: { projectId: r.org_project_id } });
        db.prepare("UPDATE engg_vdr_items SET status = 'IN_REVIEW', pending_code = ?, pending_text = ?, workflow_instance_id = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.code, b.text, inst.id, actor.user, actor.user, nowIso(), r.id); audit(actor, 'engg_vdr_items', r.id, 'review', r.company_id, { newValues: { code: b.code } }); return vdr.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'IN_REVIEW') throw unprocessable('Only a review waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return vdr.get(actor, r.id); },
    cancel(actor, id, { reason }) { const r = row(actor, id, 'engg.vdr_item.cancel'); if (!['REQUIRED', 'RESUBMIT', 'RECEIVED', 'RETURNED'].includes(r.status)) throw unprocessable('That VDR item cannot be cancelled now.'); db.prepare("UPDATE engg_vdr_items SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'engg_vdr_items', r.id, 'cancel', r.company_id, { reason }); return vdr.get(actor, r.id); },
    /** An accepted or cancelled item is taken up again: the vendor owes a new cycle. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'engg.vdr_item.amend'); if (!['ACCEPTED', 'CANCELLED'].includes(r.status)) throw unprocessable('Only an accepted or cancelled item is reopened.');
      db.prepare("UPDATE engg_vdr_items SET status = 'RESUBMIT', cycle_no = cycle_no + 1, review_code = NULL, review_text = NULL, reviewed_on = NULL, workflow_instance_id = NULL, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'engg_vdr_items', r.id, 'amend', r.company_id, { reason }); return vdr.get(actor, r.id);
    },
    history(actor, id) {
      const r = row(actor, id);
      return { approvals: db.prepare("SELECT h.event, h.actor, h.comment, h.at, h.step_code FROM wf_history h JOIN wf_instances i ON i.id = h.instance_id WHERE i.company_id = ? AND i.doc_type = ? AND i.doc_id LIKE ? ORDER BY h.id").all(r.company_id, VDR_DOC, `${r.id}.%`), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'engg_vdr_items' AND entity_id = ? ORDER BY id").all(String(r.id)) };
    },
    print(actor, id) { const r = row(actor, id, 'engg.vdr_item.print'); const v = view(actor, r); return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.vdrNo)}</title></head><body><h1>${esc(v.vdrNo)}: ${esc(v.title)}</h1><p>${esc(v.projectCode)} · PO ${esc(v.poRef)} · ${esc(v.vendor)} · ${esc(v.docTypeLabel)} · due ${esc(v.dueDate)} · ${esc(v.statusLabel)}</p><p>Review code ${esc(v.reviewCode ?? 'none yet')} ${esc(v.reviewText ?? '')} (cycle ${v.cycle})</p></body></html>`; },
    import(actor, b) {
      project(actor, b.projectId, 'engg.vdr_item.create', 'engg.vdr_item.view'); const made = []; const errors = [];
      b.rows.forEach((x, i) => { try { const v = vdr.create(actor, { projectId: b.projectId, ...x }); made.push({ row: i + 1, id: v.id, vdrNo: v.vdrNo }); } catch (e) { errors.push({ row: i + 1, title: x.title, message: e.details?.[0]?.message ?? e.message }); } });
      return { created: made.length, errors, rows: made };
    },
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'IN_REVIEW') return;
      if (outcome === 'APPROVED') {
        const accepted = ['A', 'B'].includes(r.pending_code); const to = accepted ? 'ACCEPTED' : 'RESUBMIT';
        db.prepare('UPDATE engg_vdr_items SET status = ?, review_code = ?, review_text = ?, reviewed_on = ?, pending_code = NULL, pending_text = NULL, cycle_no = cycle_no + ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, r.pending_code, r.pending_text, today(), accepted ? 0 : 1, actor.user, nowIso(), r.id);
        audit(actor, 'engg_vdr_items', r.id, 'review_approved', r.company_id, { newValues: { code: r.pending_code } });
        event('engg.vdr.reviewed', actor, 'engg_vdr_item', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, vdrId: r.id, vdrNo: r.vdr_no, poRef: r.po_ref, vendor: r.vendor, docType: r.doc_type, code: r.pending_code, status: to }); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare("UPDATE engg_vdr_items SET status = 'RECEIVED', workflow_instance_id = ?, pending_code = NULL, pending_text = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(withdrawn ? null : r.workflow_instance_id, actor.user, nowIso(), r.id); audit(actor, 'engg_vdr_items', r.id, `review_${outcome.toLowerCase()}`, r.company_id, { reason: comment ?? null });
    },
  };
  return { vdr, vdrDecide: vdr.decide };
}
const vline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM engg_vdr_items x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: VDR_DOC, label: 'Review of a vendor document', processOwner: 'DESIGN', route: (id) => `/engg/vdr-item?id=${id}`,
  describe(db, companyId, id) { const r = vline(db, rid(id)); return r && r.company_id === companyId ? { ref: r.vdr_no, title: `${r.code} ${r.vendor}: ${r.title}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = vline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'VDR item', value: `${r.vdr_no} · ${r.title}` }, { label: 'PO and vendor', value: `${r.po_ref} · ${r.vendor}` }, { label: 'Document', value: VDR_TYPES[r.doc_type] }, { label: 'Cycle', value: String(r.cycle_no) }, { label: 'Proposed code', value: r.pending_code ?? '' }, { label: 'Comments', value: r.pending_text ?? '' }], lines: [] }; },
  defaultDefinition: { name: 'Vendor document review: the engineering manager approves the review code', settings: { resubmit: 'first', distinctApprovers: true }, steps: [{ code: 'DESIGN', name: 'Engineering manager', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'DESIGN' }], slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: { onApproved: (db, { instance, actor }) => enggOf(db)?.vdrDecide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => enggOf(db)?.vdrDecide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => enggOf(db)?.vdrDecide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => enggOf(db)?.vdrDecide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(VDR_DOC, ({ db, instance }) => {
  const r = vline(db, rid(instance.docId)); if (!r) return { sections: [] };
  return { sections: [{ code: 'engg-vdr', title: 'The vendor document', kind: 'metrics', items: [{ label: 'Item', value: `${r.vdr_no} ${r.title}`, format: 'text' }, { label: 'PO and vendor', value: `${r.po_ref} · ${r.vendor}`, format: 'text' }, { label: 'Due', value: r.due_date, format: 'text' }, { label: 'Submitted', value: r.submitted_on ?? '—', format: 'text' }, { label: 'Cycle', value: String(r.cycle_no), format: 'text' }, { label: 'Proposed code', value: r.pending_code ?? '—', format: 'text' }] }] };
});

fileEntities.register({
  entity: 'engg_vdr_item',
  label: 'Vendor document requirement',
  resolve(db, actor, id) {
    try {
      const item = enggOf(db)?.vdr.get(actor, Number(id));
      if (!item) return null;
      return { companyId: actor.companyId, projectId: item.projectId, canView: true, canEdit: false, locked: true };
    } catch (err) {
      if (err.status === 403 || err.status === 404) return null;
      throw err;
    }
  },
});
