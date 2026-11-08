import { transaction } from '../../platform/db/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { DIRECTIONS, RESPONSES, STATUS_CODES, TRANSMITTAL_DOC, TX_PURPOSE, TX_STATUS, esc, nowIso, rid, same } from './constants.js';
import { enggOf } from './drawings.js';

// Transmittals (part 11.01): the covering record of drawings sent to a consultant, a client or a contractor (outgoing) or received from them (incoming), with the purpose, the recipients, the due date and the response codes
// A approved, B approved with comments, C revise and resubmit, D rejected. An outgoing transmittal for approval is checked by document control and the design coordinator before it leaves; the others are issued by whoever sends them.
const SUP = 'SUPERSEDED, DO NOT USE';
export const transmittalList = defineList({
  code: 'engg.transmittals', label: 'Transmittals', permission: 'engg.transmittal.view',
  from: 'engg_transmittals x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.party', 'p.code', 'x.cover_note'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'No.' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    direction: { sql: 'x.direction', type: 'enum', label: 'Direction', options: Object.entries(DIRECTIONS) }, party: { sql: 'x.party', type: 'text', label: 'Party' }, purpose: { sql: 'x.purpose', type: 'enum', label: 'Purpose', options: Object.entries(TX_PURPOSE) },
    issuedOn: { sql: 'x.issued_on', type: 'date', label: 'Issued' }, dueOn: { sql: 'x.due_on', type: 'date', label: 'Response due' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(TX_STATUS) },
    items: { sql: '(SELECT COUNT(*) FROM engg_transmittal_items i WHERE i.transmittal_id = x.id AND i.deleted_at IS NULL)', type: 'number', label: 'Drawings' },
    pending: { sql: '(SELECT COUNT(*) FROM engg_transmittal_items i WHERE i.transmittal_id = x.id AND i.deleted_at IS NULL AND i.response_code IS NULL)', type: 'number', label: 'Unanswered' },
    overdue: { sql: "(CASE WHEN x.status = 'ISSUED' AND x.direction = 'OUT' AND x.purpose = 'FOR_APPROVAL' AND x.due_on IS NOT NULL AND x.due_on < date('now', '+330 minutes') THEN 1 ELSE 0 END)", type: 'number', label: 'Overdue' },
  },
});

export function createTransmittalService({ db, base }) {
  const { may, need, fail, project, orgOf, scopeSql, audit, event, today } = base;
  const rid2 = rid;
  const row = (actor, id, key = 'engg.transmittal.view') => {
    const t = db.prepare('SELECT * FROM engg_transmittals WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid2(id), actor.companyId);
    if (!t || !may(actor, 'engg.transmittal.view', t.org_project_id)) throw notFound('That transmittal does not exist.');
    if (key !== 'engg.transmittal.view') need(actor, key, 'do that with a transmittal', t.org_project_id);
    return t;
  };
  const itemsOf = (id) => db.prepare('SELECT i.*, d.drawing_no, d.title, r.rev_label, r.status_code, r.rev_status FROM engg_transmittal_items i JOIN engg_drawings d ON d.id = i.drawing_id JOIN engg_drawing_revisions r ON r.id = i.revision_id WHERE i.transmittal_id = ? AND i.deleted_at IS NULL ORDER BY i.id').all(id)
    .map((i) => ({ id: i.id, drawingId: i.drawing_id, drawingNo: i.drawing_no, title: i.title, revisionId: i.revision_id, revision: i.rev_label, statusCode: i.status_code, revisionStatus: i.rev_status, banner: i.rev_status === 'SUPERSEDED' ? SUP : null, copies: i.copies, responseCode: i.response_code, responseLabel: i.response_code ? `${i.response_code} ${RESPONSES[i.response_code]}` : null, responseDate: i.response_date, comments: i.comments }));
  function view(actor, t, { detail = false } = {}) {
    const o = orgOf(t.org_project_id); const can = (k) => may(actor, k, t.org_project_id); const editable = ['DRAFT', 'RETURNED'].includes(t.status); const open = t.status === 'ISSUED' && t.direction === 'OUT';
    const items = detail ? itemsOf(t.id) : null; const n = db.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN response_code IS NULL THEN 1 ELSE 0 END) AS open FROM engg_transmittal_items WHERE transmittal_id = ? AND deleted_at IS NULL').get(t.id);
    const out = {
      id: t.id, docNo: t.doc_no, projectId: t.org_project_id, projectCode: o?.code, projectName: o?.name, direction: t.direction, directionLabel: DIRECTIONS[t.direction], party: t.party, contact: t.contact, purpose: t.purpose, purposeLabel: TX_PURPOSE[t.purpose], coverNote: t.cover_note,
      issuedOn: t.issued_on, dueOn: t.due_on, status: t.status, statusLabel: TX_STATUS[t.status], closedAt: t.closed_at, itemCount: n.n, unanswered: n.open ?? 0, overdue: open && t.purpose === 'FOR_APPROVAL' && Boolean(t.due_on) && t.due_on < today(), requestedBy: t.requested_by, workflowInstanceId: t.workflow_instance_id, createdBy: t.created_by, rowVersion: t.version,
      needsApproval: t.direction === 'OUT' && t.purpose === 'FOR_APPROVAL',
      can: { edit: can('engg.transmittal.edit') && editable, submit: can('engg.transmittal.submit') && editable, withdraw: t.status === 'SUBMITTED' && same(t.requested_by, actor.user), cancel: can('engg.transmittal.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'ISSUED'].includes(t.status) && !(n.n - (n.open ?? 0)),
        delete: can('engg.transmittal.delete') && t.status === 'DRAFT' && !t.workflow_instance_id, amend: can('engg.transmittal.amend') && ['ISSUED', 'CANCELLED', 'REJECTED', 'CLOSED'].includes(t.status), respond: can('engg.transmittal.respond') && open && Boolean(n.open), print: can('engg.transmittal.print'), export: can('engg.transmittal.export') },
    };
    if (detail) out.items = items;
    return out;
  }
  const fresh = (id) => db.prepare('SELECT * FROM engg_transmittals WHERE id = ?').get(id);
  const nextNo = (companyId) => { let k = db.prepare('SELECT COUNT(*) AS n FROM engg_transmittals WHERE company_id = ?').get(companyId).n + 1; let no = `TRN-${String(k).padStart(5, '0')}`; while (db.prepare('SELECT 1 FROM engg_transmittals WHERE company_id = ? AND doc_no = ?').get(companyId, no)) { k += 1; no = `TRN-${String(k).padStart(5, '0')}`; } return no; };

  /** The drawings on a transmittal: each revision belongs to its drawing and to the project; an outgoing one carries issued revisions, and what is sent for construction is the current IFC (BR-01). */
  function problems(o, b) {
    const p = []; const seen = new Set();
    if (b.direction === 'IN' && b.purpose === 'FOR_CONSTRUCTION') p.push({ field: 'purpose', message: 'A transmittal received from outside is for approval or for information' });
    for (const [i, it] of (b.items ?? []).entries()) {
      const r = db.prepare('SELECT r.*, d.org_project_id AS dproject, d.register_status FROM engg_drawing_revisions r JOIN engg_drawings d ON d.id = r.drawing_id WHERE r.id = ? AND r.drawing_id = ? AND r.deleted_at IS NULL AND d.deleted_at IS NULL').get(it.revisionId, it.drawingId);
      if (!r || r.dproject !== o.id) { p.push({ field: `items.${i}.revisionId`, message: 'Choose a revision of a drawing of this project' }); continue; }
      if (seen.has(it.revisionId)) p.push({ field: `items.${i}.revisionId`, message: 'The revision is on the transmittal already' }); seen.add(it.revisionId);
      if (r.rev_status === 'SUPERSEDED') p.push({ field: `items.${i}.revisionId`, message: `Revision ${r.rev_label} is ${SUP}: send the current one` });
      else if (r.rev_status !== 'ISSUED') p.push({ field: `items.${i}.revisionId`, message: `Revision ${r.rev_label} is not issued yet` });
      else if (b.direction === 'OUT' && b.purpose === 'FOR_CONSTRUCTION' && r.status_code !== 'IFC') p.push({ field: `items.${i}.revisionId`, message: `Only issued-for-construction revisions are sent for construction (${r.rev_label} is ${STATUS_CODES[r.status_code].toLowerCase()})` });
    }
    return p;
  }
  const writeItems = (actor, t, items) => {
    db.prepare('UPDATE engg_transmittal_items SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE transmittal_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, t.id);
    for (const it of items) db.prepare("INSERT INTO engg_transmittal_items (company_id, transmittal_id, org_project_id, drawing_id, revision_id, copies, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'engg_transmittals', ?)").run(t.company_id, t.id, t.org_project_id, it.drawingId, it.revisionId, it.copies ?? 1, t.org_project_id, actor.user, String(t.id));
  };
  /** The transmittal leaves (or is registered, if incoming): an incoming one is the receipt of the drawings. */
  function issueNow(actor, t) {
    const day = today();
    db.prepare("UPDATE engg_transmittals SET status = 'ISSUED', issued_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(day, actor.user, nowIso(), t.id);
    if (t.direction === 'IN') for (const it of db.prepare('SELECT drawing_id FROM engg_transmittal_items WHERE transmittal_id = ? AND deleted_at IS NULL').all(t.id)) db.prepare('UPDATE engg_drawings SET actual_receipt = COALESCE(actual_receipt, ?) WHERE id = ?').run(day, it.drawing_id);
    audit(actor, 'engg_transmittals', t.id, 'issue', t.company_id);
    event('engg.transmittal.issued', actor, 'engg_transmittal', t.id, t.company_id, t.org_project_id, { projectId: t.org_project_id, transmittalId: t.id, docNo: t.doc_no, direction: t.direction, purpose: t.purpose, party: t.party, items: itemsOf(t.id).map((i) => ({ drawingNo: i.drawingNo, revision: i.revision })), dueOn: t.due_on });
  }

  const transmittals = {
    list(actor, query) {
      need(actor, 'engg.transmittal.view', 'see transmittals'); const s = scopeSql(actor, 'engg.transmittal.view');
      return runList(db, transmittalList, parseListRequest(transmittalList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, projectId: v.projectId, project: v.projectCode, direction: v.direction, directionLabel: v.directionLabel, party: v.party, purpose: v.purposeLabel, issuedOn: v.issuedOn, dueOn: v.dueOn, status: v.status, statusLabel: v.statusLabel, items: v.itemCount, pending: v.unanswered, overdue: v.overdue ? 1 : 0 }; } });
    },
    exportSource(actor, req) {
      need(actor, 'engg.transmittal.export', 'export transmittals'); const s = scopeSql(actor, 'engg.transmittal.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: transmittalList.label, permission: 'engg.transmittal.export', personal: false, columns: [{ key: 'docNo', label: 'No.', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'direction', label: 'Direction', type: 'text' }, { key: 'party', label: 'Party', type: 'text' }, { key: 'purpose', label: 'Purpose', type: 'text' }, { key: 'issuedOn', label: 'Issued', type: 'text' }, { key: 'dueOn', label: 'Response due', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'items', label: 'Drawings', type: 'number' }, { key: 'pending', label: 'Unanswered', type: 'number' }],
        rows: () => runList(db, transmittalList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { docNo: v.docNo, project: v.projectCode, direction: v.directionLabel, party: v.party, purpose: v.purposeLabel, issuedOn: v.issuedOn ?? '', dueOn: v.dueOn ?? '', status: v.statusLabel, items: v.itemCount, pending: v.unanswered }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All transmittals you may see'], count: () => countList(db, transmittalList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'engg.transmittal.create', 'engg.transmittal.view'); fail(problems(o, b));
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO engg_transmittals (company_id, doc_no, org_project_id, direction, party, contact, purpose, cover_note, due_on, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'engg_transmittals', ?)").run(o.company_id, nextNo(o.company_id), o.id, b.direction, b.party, b.contact, b.purpose, b.coverNote, b.dueOn, o.id, actor.user, o.code).lastInsertRowid);
        const t = fresh(id); writeItems(actor, t, b.items); audit(actor, 'engg_transmittals', id, 'create', o.company_id, { newValues: { docNo: t.doc_no, items: b.items.length } }); return transmittals.get(actor, id);
      });
    },
    update(actor, id, b) {
      const t = row(actor, id, 'engg.transmittal.edit'); if (!['DRAFT', 'RETURNED'].includes(t.status)) throw conflict(`${t.doc_no} is ${TX_STATUS[t.status].toLowerCase()}: make an amendment to send it again.`);
      if (b.rowVersion && b.rowVersion !== t.version) throw conflict('Someone changed this transmittal; reload it.');
      const o = orgOf(t.org_project_id); const merged = { direction: t.direction, purpose: b.purpose ?? t.purpose, items: b.items ?? itemsOf(t.id).map((i) => ({ drawingId: i.drawingId, revisionId: i.revisionId, copies: i.copies })) }; fail(problems(o, merged));
      const m = { party: 'party', contact: 'contact', purpose: 'purpose', coverNote: 'cover_note', dueOn: 'due_on' };
      return transaction(db, () => {
        const sets = Object.entries(m).filter(([k]) => k in b); if (sets.length) db.prepare(`UPDATE engg_transmittals SET ${sets.map(([, c]) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...sets.map(([k]) => b[k]), actor.user, nowIso(), t.id);
        if (b.items) writeItems(actor, t, b.items); audit(actor, 'engg_transmittals', t.id, 'update', t.company_id); return transmittals.get(actor, t.id);
      });
    },
    remove(actor, id) { const t = row(actor, id, 'engg.transmittal.delete'); if (t.status !== 'DRAFT' || t.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted.'); db.prepare('UPDATE engg_transmittals SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, t.id); db.prepare('UPDATE engg_transmittal_items SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE transmittal_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, t.id); audit(actor, 'engg_transmittals', t.id, 'delete', t.company_id); return { id: t.id, deleted: true }; },
    submit(actor, id) {
      const t = row(actor, id, 'engg.transmittal.submit'); if (!['DRAFT', 'RETURNED'].includes(t.status)) throw unprocessable('Only a draft or a returned transmittal is sent.');
      const o = orgOf(t.org_project_id); const items = itemsOf(t.id); if (!items.length) throw unprocessable('Pick at least one drawing.');
      fail(problems(o, { direction: t.direction, purpose: t.purpose, items: items.map((i) => ({ drawingId: i.drawingId, revisionId: i.revisionId })) }));
      return transaction(db, () => {
        db.prepare('UPDATE engg_transmittals SET requested_by = ? WHERE id = ?').run(actor.user, t.id);
        if (!(t.direction === 'OUT' && t.purpose === 'FOR_APPROVAL')) { issueNow(actor, fresh(t.id)); return transmittals.get(actor, t.id); }
        const ctx = { projectId: t.org_project_id }; const ref = `${t.doc_no}:${t.version}`;
        if (t.status === 'RETURNED') workflowOf(db).resubmit(actor, t.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: TRANSMITTAL_DOC, docId: String(t.id), comment: `${t.doc_no} to ${t.party} for approval`.slice(0, 300), context: ctx }); db.prepare('UPDATE engg_transmittals SET workflow_instance_id = ? WHERE id = ?').run(inst.id, t.id); }
        db.prepare("UPDATE engg_transmittals SET status = 'SUBMITTED', version = version + 1 WHERE id = ?").run(t.id); audit(actor, 'engg_transmittals', t.id, 'submit', t.company_id, { newValues: { ref } }); return transmittals.get(actor, t.id);
      });
    },
    withdraw(actor, id, { reason }) { const t = row(actor, id); if (t.status !== 'SUBMITTED') throw unprocessable('Only a transmittal waiting for approval is withdrawn.'); if (!same(t.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, t.workflow_instance_id, { comment: reason }); return transmittals.get(actor, t.id); },
    cancel(actor, id, { reason }) {
      const t = row(actor, id, 'engg.transmittal.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'ISSUED'].includes(t.status)) throw unprocessable('That transmittal cannot be cancelled.');
      if (db.prepare('SELECT 1 FROM engg_transmittal_items WHERE transmittal_id = ? AND response_code IS NOT NULL AND deleted_at IS NULL').get(t.id)) throw conflict('A response was recorded: a transmittal that was answered is closed, not cancelled.');
      return transaction(db, () => { if (t.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, t.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE engg_transmittals SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), t.id); audit(actor, 'engg_transmittals', t.id, 'cancel', t.company_id, { reason }); return transmittals.get(actor, t.id); });
    },
    /** An amendment is a new draft that begins as a copy of the old one; the old one keeps its place in the history. */
    amend(actor, id, { reason }) {
      const t = row(actor, id, 'engg.transmittal.amend'); if (!['ISSUED', 'CANCELLED', 'REJECTED', 'CLOSED'].includes(t.status)) throw unprocessable('Only a transmittal that left or was stopped is amended.');
      const items = itemsOf(t.id).filter((i) => i.revisionStatus === 'ISSUED').map((i) => ({ drawingId: i.drawingId, revisionId: i.revisionId, copies: i.copies })); if (!items.length) throw unprocessable('Every revision on it has been replaced: make a new transmittal with the current ones.');
      return transaction(db, () => { const n = transmittals.create(actor, { projectId: t.org_project_id, direction: t.direction, party: t.party, contact: t.contact, purpose: t.purpose, coverNote: `Amends ${t.doc_no}: ${reason}${t.cover_note ? `\n${t.cover_note}` : ''}`, dueOn: t.due_on, items }); audit(actor, 'engg_transmittals', t.id, 'amend', t.company_id, { reason, newValues: { newDocNo: n.docNo } }); return n; });
    },
    /** FR-03: the responses of the recipient. Each one updates the drawing (T-02); when every drawing has an answer the transmittal is closed. */
    respond(actor, id, b) {
      const t = row(actor, id, 'engg.transmittal.respond'); if (t.direction !== 'OUT' || t.status !== 'ISSUED') throw unprocessable('Responses are recorded on an outgoing transmittal that was issued.');
      const items = itemsOf(t.id); const p = []; const day = today();
      b.responses.forEach((r, i) => { if (!items.find((x) => x.id === r.itemId)) p.push({ field: `responses.${i}.itemId`, message: 'That drawing is not on this transmittal' }); if (r.date && r.date > day) p.push({ field: `responses.${i}.date`, message: 'The date of a response is not in the future' }); if (['B', 'C', 'D'].includes(r.code) && !r.comments) p.push({ field: `responses.${i}.comments`, message: `Say what the comments are (code ${r.code})` }); }); fail(p);
      return transaction(db, () => {
        for (const r of b.responses) {
          const it = items.find((x) => x.id === r.itemId); const when = r.date ?? day;
          db.prepare('UPDATE engg_transmittal_items SET response_code = ?, response_date = ?, comments = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(r.code, when, r.comments, actor.user, nowIso(), it.id);
          // the response belongs to the drawing only while its revision is still the current one
          const d = base.dfresh(it.drawingId); if (d.current_revision_id === it.revisionId || d.current_ifc_revision_id === it.revisionId || !d.response_date || d.response_date <= when) db.prepare('UPDATE engg_drawings SET response_code = ?, response_date = ?, version = version + 1 WHERE id = ?').run(r.code, when, d.id);
          event('engg.transmittal.response', actor, 'engg_transmittal', t.id, t.company_id, t.org_project_id, { projectId: t.org_project_id, transmittalId: t.id, docNo: t.doc_no, drawingId: it.drawingId, drawingNo: it.drawingNo, revision: it.revision, code: r.code, comments: r.comments });
        }
        const left = db.prepare('SELECT COUNT(*) AS n FROM engg_transmittal_items WHERE transmittal_id = ? AND deleted_at IS NULL AND response_code IS NULL').get(t.id).n;
        if (!left) db.prepare("UPDATE engg_transmittals SET status = 'CLOSED', closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, nowIso(), t.id);
        audit(actor, 'engg_transmittals', t.id, 'respond', t.company_id, { newValues: { responses: b.responses.length } }); return transmittals.get(actor, t.id);
      });
    },
    history(actor, id) {
      const t = row(actor, id);
      return { approvals: t.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(t.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'engg_transmittals' AND entity_id = ? ORDER BY id").all(String(t.id)) };
    },
    print(actor, id) {
      const t = row(actor, id, 'engg.transmittal.print'); const v = view(actor, t, { detail: true });
      const rows = v.items.map((i) => `<tr><td>${esc(i.drawingNo)}</td><td>${esc(i.title)}</td><td>${esc(i.revision)} ${esc(i.statusCode)}</td><td>${i.copies}</td><td>${esc(i.responseLabel ?? '')}</td></tr>`).join('');
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body><h1>Transmittal ${esc(v.docNo)}</h1><p>${esc(v.projectCode)} · ${esc(v.directionLabel)} · ${esc(v.party)} · ${esc(v.purposeLabel)} · issued ${esc(v.issuedOn ?? 'not yet')} · response due ${esc(v.dueOn ?? 'n/a')}</p><p>${esc(v.coverNote ?? '')}</p><table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Drawing</th><th>Title</th><th>Rev.</th><th>Copies</th><th>Response</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    },
    /** The decision of the approval chain. */
    decide(instance, actor, outcome, comment) {
      const t = db.prepare('SELECT * FROM engg_transmittals WHERE id = ?').get(rid2(instance.docId)); if (!t || t.status !== 'SUBMITTED') return;
      if (outcome === 'APPROVED') { issueNow(actor, t); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE engg_transmittals SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : t.workflow_instance_id, actor.user, nowIso(), t.id);
      audit(actor, 'engg_transmittals', t.id, outcome.toLowerCase(), t.company_id, { reason: comment ?? null });
    },
  };
  return { transmittals };
}

const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const tline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM engg_transmittals x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: TRANSMITTAL_DOC, label: 'Transmittal of drawings for approval', processOwner: 'DOC', route: (id) => `/engg/transmittal?id=${id}`,
  describe(db, companyId, id) { const t = tline(db, rid(id)); return t && t.company_id === companyId ? { ref: t.doc_no, title: `${t.code} to ${t.party}`, originator: t.requested_by } : null; },
  summarise(db, _actor, id) { const t = tline(db, rid(id)); if (!t) return null; const items = db.prepare('SELECT d.drawing_no, r.rev_label FROM engg_transmittal_items i JOIN engg_drawings d ON d.id = i.drawing_id JOIN engg_drawing_revisions r ON r.id = i.revision_id WHERE i.transmittal_id = ? AND i.deleted_at IS NULL').all(t.id); return { fields: [{ label: 'Project', value: `${t.code} ${t.pname}` }, { label: 'Transmittal', value: t.doc_no }, { label: 'To', value: t.party }, { label: 'Purpose', value: TX_PURPOSE[t.purpose] }, { label: 'Response due', value: t.due_on ?? 'Not set' }, { label: 'Cover note', value: t.cover_note ?? '' }], lines: items.map((i) => ({ label: i.drawing_no, value: `rev ${i.rev_label}` })) }; },
  defaultDefinition: { name: 'Outgoing transmittal for approval: document control checks, the design coordinator approves', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('DOC', 'Document control check', [{ kind: 'resolver', resolver: 'engg.docCheck' }]), step('DESIGN', 'Design coordinator', [{ kind: 'role', role: 'DESIGN' }])] },
  hooks: { onApproved: (db, { instance, actor }) => enggOf(db)?.transmittals.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => enggOf(db)?.transmittals.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => enggOf(db)?.transmittals.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => enggOf(db)?.transmittals.decide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(TRANSMITTAL_DOC, ({ db, instance }) => {
  const t = tline(db, rid(instance.docId)); if (!t) return { sections: [] };
  const items = db.prepare('SELECT d.drawing_no, r.rev_label, r.status_code, r.rev_status FROM engg_transmittal_items i JOIN engg_drawings d ON d.id = i.drawing_id JOIN engg_drawing_revisions r ON r.id = i.revision_id WHERE i.transmittal_id = ? AND i.deleted_at IS NULL').all(t.id);
  return { sections: [{ code: 'engg-transmittal', title: 'What leaves with this transmittal', kind: 'metrics', items: [{ label: 'To', value: t.party, format: 'text' }, { label: 'Drawings', value: String(items.length), format: 'text' }, { label: 'Not current (superseded)', value: String(items.filter((i) => i.rev_status === 'SUPERSEDED').length), format: 'text' }, ...items.slice(0, 12).map((i) => ({ label: i.drawing_no, value: `rev ${i.rev_label} ${i.status_code}`, format: 'text' }))] }] };
});
void badRequest;
