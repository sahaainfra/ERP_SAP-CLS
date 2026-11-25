import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv } from '../../platform/security/csv.js';
import { workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createBase, nowIso, rid } from '../proc/base.js';
import { addMonths } from './handover.js';

/**
 * Part 26.03: defects liability period (DLP) and warranty management (built on the owner's instruction of 2026-11-25, audit AUD-DEF-004).
 *
 *  - FR-01 A period opens for each issued handover (26.02, event ho.handover.issued), for its area, from the effective date for the agreed
 *    months; the periods ending within 30 days are told to the project manager every morning.
 *  - FR-02 A complaint (a defect reported in the period, by the client or found by the team) has a location, an asset of the client register
 *    when it concerns one, and a severity whose response time sets its due time (critical 24 h, major 72 h, minor 7 days).
 *  - FR-03 It is assigned to a party (own crew, a subcontractor or a supplier) and may carry a recovery: when a complaint against a
 *    subcontractor or supplier is closed with an amount, dlp.defect.backcharge_raised is announced for their bill (22.05).
 *  - FR-04 The party records the rectification with its evidence; someone other than the rectifier verifies it and closes it, or sends it
 *    back. Overdue complaints are escalated every hour (level 1 the project manager, level 2 and more the QA/QC manager too).
 *  - FR-05 The completion certificate: requested by the project manager once the period has ended and no complaint is open (BR-01), approved
 *    by the commercial manager and the CFO through the workflow (07: PM -> COMMGR -> CFO). Completion announces dlp.period.completed; the
 *    retention is then released through Billing's release requests (22.07) on the DLP end basis.
 *  - FR-06 Warranty claims to the supplier of a handed-over asset, with their resolution.
 */
export const DLP_FLAG = 'ff.close.p2603';
export const DLP_DOC = 'DLP_COMPLETION';
export const RESPONSE_HOURS = Object.freeze({ CRITICAL: 24, MAJOR: 72, MINOR: 168 });
const OPEN = ['OPEN', 'ASSIGNED', 'RECTIFIED'];

export function createDlp({ db }) {
  const base = createBase({ db });
  const { may, need, audit, number, notify } = base;
  const today = () => todayIST();
  const scope = (actor, key, alias = 'p') => base.authz.scopeFilter(actor, key, { project: `${alias}.org_project_id`, site: `${alias}.org_site_id` }).sql;
  const periodRow = (actor, id, key = 'dlp.view') => {
    const p = db.prepare('SELECT * FROM dlp_periods WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!p || !may(actor, 'dlp.view', p.org_project_id, p.org_site_id)) throw notFound('That defects liability period does not exist.');
    if (key !== 'dlp.view') need(actor, key, 'do that for this period', p.org_project_id, p.org_site_id);
    return p;
  };
  const complaintRow = (actor, id, key) => {
    const c = db.prepare('SELECT * FROM dlp_complaints WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!c) throw notFound('That complaint does not exist.');
    return { c, p: periodRow(actor, c.period_id, key) };
  };
  const partnerOk = (companyId, id) => Boolean(db.prepare('SELECT 1 FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), companyId));
  const fileOk = (companyId, id) => Boolean(db.prepare('SELECT 1 FROM core_files WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), companyId));
  const assetOf = (p, id) => db.prepare("SELECT a.* FROM ho_client_assets a WHERE a.id = ? AND a.company_id = ? AND a.handover_id = ? AND a.deleted_at IS NULL AND a.status = 'ACTIVE'").get(rid(id), p.company_id, p.handover_id);
  const complaintsOf = (pid) => db.prepare('SELECT * FROM dlp_complaints WHERE period_id = ? AND deleted_at IS NULL ORDER BY id').all(pid);
  const dueAt = (reportedAt, severity) => new Date(new Date(reportedAt).getTime() + RESPONSE_HOURS[severity] * 3600_000).toISOString();

  /** Opens the period of an issued handover (the event consumer and the manual route); returns the existing one when it is open already. */
  function openFor(companyId, handoverId, user = 'system') {
    const h = db.prepare("SELECT * FROM ho_handovers WHERE id = ? AND company_id = ? AND status = 'ISSUED' AND deleted_at IS NULL").get(rid(handoverId), companyId);
    if (!h) throw unprocessable('A defects liability period opens for an issued handover.');
    const existing = db.prepare('SELECT * FROM dlp_periods WHERE handover_id = ? AND deleted_at IS NULL').get(h.id); if (existing) return existing;
    const docNo = number(companyId, user, 'DLP_PERIOD', 'dlp_periods', 'DLP');
    const id = Number(db.prepare("INSERT INTO dlp_periods (company_id, org_project_id, org_site_id, handover_id, doc_no, area_label, starts_on, ends_on, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'event', ?)")
      .run(companyId, h.org_project_id, h.org_site_id, h.id, docNo, h.scope_type === 'AREA' ? (h.area_label ?? h.title) : h.title, h.effective_on, addMonths(h.effective_on, h.dlp_months), h.org_project_id, h.org_site_id, user, String(h.id)).lastInsertRowid);
    audit({ user }, 'dlp_periods', String(id), 'open', companyId, { newValues: { handover: h.doc_no } });
    return db.prepare('SELECT * FROM dlp_periods WHERE id = ?').get(id);
  }

  function readiness(p) {
    const blockers = [];
    if (p.ends_on > today()) blockers.push(`The period runs until ${p.ends_on}.`);
    const open = complaintsOf(p.id).filter((c) => OPEN.includes(c.status));
    if (open.length) blockers.push(`${open.length} complaint(s) not closed: ${open.map((c) => c.doc_no).join(', ')}.`);
    return { ready: blockers.length === 0, blockers };
  }

  const overdue = (c) => OPEN.includes(c.status) && c.status !== 'RECTIFIED' && c.due_at < nowIso();
  const complaintView = (c) => ({ id: c.id, periodId: c.period_id, docNo: c.doc_no, reportedOn: c.reported_on, reportedBy: c.reported_by, source: c.source, location: c.location_text, description: c.description, severity: c.severity, dueAt: c.due_at, overdue: overdue(c), responsibleType: c.responsible_type, partnerId: c.partner_id, partner: c.partner_id ? db.prepare('SELECT trade_name, legal_name FROM mdm_partners WHERE id = ?').get(c.partner_id)?.trade_name ?? null : null, status: c.status, rectifiedBy: c.rectified_by, rectifiedAt: c.rectified_at, rectification: c.rectification_note, rectifyFileId: c.rectify_file_id, verifiedBy: c.verified_by, closedAt: c.closed_at, recovery: c.recovery_amount / 100, escalationLevel: c.escalation_level, assetId: c.asset_id, asset: c.asset_id ? db.prepare('SELECT tag_no FROM ho_client_assets WHERE id = ?').get(c.asset_id)?.tag_no ?? null : null, version: c.version, period: db.prepare('SELECT doc_no FROM dlp_periods WHERE id = ?').get(c.period_id)?.doc_no ?? null });
  const claimView = (w) => ({ id: w.id, docNo: w.doc_no, assetId: w.asset_id, asset: db.prepare('SELECT tag_no, description FROM ho_client_assets WHERE id = ?').get(w.asset_id)?.tag_no ?? null, complaintId: w.complaint_id, partnerId: w.partner_id, claimedOn: w.claimed_on, description: w.description, status: w.status, resolution: w.resolution_note, resolvedOn: w.resolved_on, version: w.version });
  const periodView = (p) => {
    const cs = complaintsOf(p.id);
    return { id: p.id, docNo: p.doc_no, projectId: p.org_project_id, siteId: p.org_site_id, handoverId: p.handover_id, handover: db.prepare('SELECT doc_no FROM ho_handovers WHERE id = ?').get(p.handover_id)?.doc_no ?? null, area: p.area_label, startsOn: p.starts_on, endsOn: p.ends_on, daysLeft: Math.round((Date.parse(p.ends_on) - Date.parse(today())) / 86_400_000), status: p.status, workflowInstanceId: p.workflow_instance_id, completedAt: p.completed_at, version: p.version, project: db.prepare('SELECT code FROM org_projects WHERE id = ?').get(p.org_project_id)?.code ?? null, complaints: { total: cs.length, open: cs.filter((c) => OPEN.includes(c.status)).length, overdue: cs.filter(overdue).length } };
  };
  const listGuard = (actor) => { if (!base.authz.hasAnywhere(actor, 'dlp.view')) throw forbidden('You may not see the defects liability periods (permission dlp.view).'); };

  const svc = {
    openFor,
    periods: {
      list(actor, { projectId = null, status = null } = {}) {
        listGuard(actor);
        const where = ['p.company_id = ?', 'p.deleted_at IS NULL', scope(actor, 'dlp.view')]; const args = [actor.companyId];
        if (projectId) { where.push('p.org_project_id = ?'); args.push(rid(projectId)); } if (status) { where.push('p.status = ?'); args.push(status); }
        return db.prepare(`SELECT p.* FROM dlp_periods p WHERE ${where.join(' AND ')} ORDER BY p.ends_on, p.id LIMIT 500`).all(...args).map(periodView);
      },
      open(actor, { handoverId }) {
        const h = db.prepare('SELECT org_project_id, org_site_id FROM ho_handovers WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(handoverId), actor.companyId);
        if (!h || !may(actor, 'dlp.view', h.org_project_id, h.org_site_id)) throw notFound('That handover does not exist.');
        need(actor, 'dlp.manage', 'open a defects liability period', h.org_project_id, h.org_site_id);
        return svc.periods.get(actor, openFor(actor.companyId, handoverId, actor.user).id);
      },
      get(actor, id) {
        const p = periodRow(actor, id);
        return { ...periodView(p), complaintList: complaintsOf(p.id).map(complaintView), claims: db.prepare('SELECT * FROM dlp_warranty_claims WHERE period_id = ? AND deleted_at IS NULL ORDER BY id').all(p.id).map(claimView), assets: db.prepare("SELECT id, tag_no AS tagNo, description, warranty_until AS warrantyUntil FROM ho_client_assets WHERE handover_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL ORDER BY tag_no").all(p.handover_id).map((a) => ({ ...a })), partners: may(actor, 'dlp.manage', p.org_project_id, p.org_site_id) ? db.prepare("SELECT id, COALESCE(trade_name, legal_name) AS name FROM mdm_partners WHERE company_id = ? AND deleted_at IS NULL AND partner_status = 'ACTIVE' ORDER BY name LIMIT 500").all(p.company_id).map((x) => ({ ...x })) : [], readiness: readiness(p), can: { report: may(actor, 'dlp.complaint.create', p.org_project_id, p.org_site_id), manage: may(actor, 'dlp.manage', p.org_project_id, p.org_site_id), rectify: may(actor, 'dlp.rectify', p.org_project_id, p.org_site_id), verify: may(actor, 'dlp.verify', p.org_project_id, p.org_site_id), complete: may(actor, 'dlp.complete.request', p.org_project_id, p.org_site_id) } };
      },
      dashboard(actor) {
        const ps = svc.periods.list(actor);
        const live = ps.filter((p) => p.status === 'ACTIVE' || p.status === 'COMPLETION_REVIEW');
        return { periods: ps, totals: { active: live.length, endingIn30: live.filter((p) => p.daysLeft >= 0 && p.daysLeft <= 30).length, ended: live.filter((p) => p.daysLeft < 0).length, openComplaints: live.reduce((t, p) => t + p.complaints.open, 0), overdue: live.reduce((t, p) => t + p.complaints.overdue, 0), completed: ps.filter((p) => p.status === 'COMPLETED').length } };
      },
    },
    complaints: {
      list(actor, { status = null, projectId = null, overdue: late = null } = {}) {
        listGuard(actor);
        const where = ['c.company_id = ?', 'c.deleted_at IS NULL', scope(actor, 'dlp.view')]; const args = [actor.companyId];
        if (status) { where.push('c.status = ?'); args.push(status); } if (projectId) { where.push('p.org_project_id = ?'); args.push(rid(projectId)); }
        if (late) { where.push("c.status IN ('OPEN', 'ASSIGNED') AND c.due_at < ?"); args.push(nowIso()); }
        return db.prepare(`SELECT c.* FROM dlp_complaints c JOIN dlp_periods p ON p.id = c.period_id WHERE ${where.join(' AND ')} ORDER BY c.due_at, c.id LIMIT 1000`).all(...args).map(complaintView);
      },
      create(actor, periodId, b) {
        const p = periodRow(actor, periodId, 'dlp.complaint.create');
        if (p.status !== 'ACTIVE') throw conflict(`${p.doc_no} is ${p.status.toLowerCase().replace('_', ' ')}: complaints are raised in an active period.`);
        if (b.reportedOn < p.starts_on || b.reportedOn > p.ends_on) throw unprocessable(`A complaint is reported within the period (${p.starts_on} to ${p.ends_on}).`);
        if (b.reportedOn > today()) throw unprocessable('A complaint is reported on a day that has come.');
        if (b.assetId && !assetOf(p, b.assetId)) throw unprocessable('That asset is not in the register of this handover.');
        const docNo = number(actor.companyId, actor.user, 'DLP_COMPLAINT', 'dlp_complaints', 'DLC');
        const id = Number(db.prepare("INSERT INTO dlp_complaints (company_id, period_id, asset_id, doc_no, reported_on, reported_by, source, location_text, description, severity, due_at, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
          .run(actor.companyId, p.id, b.assetId ?? null, docNo, b.reportedOn, b.reportedBy, b.source, b.location ?? null, b.description, b.severity, dueAt(nowIso(), b.severity), p.org_project_id, p.org_site_id, actor.user).lastInsertRowid);
        audit(actor, 'dlp_complaints', String(id), 'create', actor.companyId, { newValues: b });
        return complaintView(db.prepare('SELECT * FROM dlp_complaints WHERE id = ?').get(id));
      },
      assign(actor, id, b) {
        const { c } = complaintRow(actor, id, 'dlp.manage');
        if (!['OPEN', 'ASSIGNED'].includes(c.status)) throw conflict(`${c.doc_no} is ${c.status.toLowerCase()}.`);
        if (b.responsibleType !== 'OWN_CREW' && !b.partnerId) throw unprocessable('Name the subcontractor or supplier.');
        if (b.partnerId && !partnerOk(actor.companyId, b.partnerId)) throw unprocessable('That party does not exist.');
        db.prepare("UPDATE dlp_complaints SET status = 'ASSIGNED', responsible_type = ?, partner_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.responsibleType, b.responsibleType === 'OWN_CREW' ? null : rid(b.partnerId), actor.user, nowIso(), c.id);
        audit(actor, 'dlp_complaints', String(c.id), 'assign', actor.companyId, { newValues: b });
        return complaintView(db.prepare('SELECT * FROM dlp_complaints WHERE id = ?').get(c.id));
      },
      rectify(actor, id, b) {
        const { c } = complaintRow(actor, id, 'dlp.rectify');
        if (c.status !== 'ASSIGNED') throw conflict(`${c.doc_no} is ${c.status.toLowerCase()}: an assigned complaint is rectified.`);
        if (!fileOk(actor.companyId, b.fileId)) throw unprocessable('Attach the evidence of the rectification.');
        db.prepare("UPDATE dlp_complaints SET status = 'RECTIFIED', rectified_by = ?, rectified_at = ?, rectification_note = ?, rectify_file_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), b.note, rid(b.fileId), actor.user, nowIso(), c.id);
        audit(actor, 'dlp_complaints', String(c.id), 'rectify', actor.companyId, { reason: b.note });
        return complaintView(db.prepare('SELECT * FROM dlp_complaints WHERE id = ?').get(c.id));
      },
      /** FR-04: verified by someone other than the rectifier: closed (with a recovery when a party is responsible) or sent back. */
      verify(actor, id, b) {
        const { c, p } = complaintRow(actor, id, 'dlp.verify');
        if (c.status !== 'RECTIFIED') throw conflict(`${c.doc_no} is ${c.status.toLowerCase()}: a rectified complaint is verified.`);
        if (c.rectified_by === actor.user) throw forbidden('The person who rectified a complaint does not verify it.');
        if (!b.accept) {
          db.prepare("UPDATE dlp_complaints SET status = 'ASSIGNED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.note, actor.user, nowIso(), c.id);
          audit(actor, 'dlp_complaints', String(c.id), 'reopen', actor.companyId, { reason: b.note });
          return complaintView(db.prepare('SELECT * FROM dlp_complaints WHERE id = ?').get(c.id));
        }
        const amount = Math.round((b.recovery ?? 0) * 100);
        if (amount > 0 && !['SUBCONTRACTOR', 'SUPPLIER'].includes(c.responsible_type)) throw unprocessable('A recovery is charged to a subcontractor or supplier.');
        return transaction(db, () => {
          db.prepare("UPDATE dlp_complaints SET status = 'CLOSED', verified_by = ?, closed_at = ?, recovery_amount = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), amount, actor.user, nowIso(), c.id);
          audit(actor, 'dlp_complaints', String(c.id), 'close', actor.companyId, { newValues: { recovery: amount / 100 } });
          if (amount > 0) publishEvent(db, { type: 'dlp.defect.backcharge_raised', entity: 'dlp_complaints', entityId: String(c.id), actorId: actor.user, companyId: actor.companyId, projectId: p.org_project_id, data: { complaintId: c.id, docNo: c.doc_no, periodId: p.id, projectId: p.org_project_id, responsibleType: c.responsible_type, partnerId: c.partner_id, amount: amount / 100 } });
          return complaintView(db.prepare('SELECT * FROM dlp_complaints WHERE id = ?').get(c.id));
        });
      },
      reject(actor, id, { reason }) {
        const { c } = complaintRow(actor, id, 'dlp.manage');
        if (!['OPEN', 'ASSIGNED'].includes(c.status)) throw conflict(`${c.doc_no} is ${c.status.toLowerCase()}.`);
        db.prepare("UPDATE dlp_complaints SET status = 'REJECTED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), c.id);
        audit(actor, 'dlp_complaints', String(c.id), 'reject', actor.companyId, { reason });
        return complaintView(db.prepare('SELECT * FROM dlp_complaints WHERE id = ?').get(c.id));
      },
      exportCsv(actor, q) {
        if (!base.authz.hasAnywhere(actor, 'dlp.export')) throw forbidden('You may not export the complaints (permission dlp.export).');
        const rows = svc.complaints.list(actor, q);
        audit(actor, 'dlp_complaints', '0', 'export', actor.companyId, { reason: `${rows.length} row(s)` });
        return { contentType: 'text/csv; charset=utf-8', fileName: `dlp-complaints-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Complaint', 'Period', 'Reported on', 'Reported by', 'Location', 'Description', 'Severity', 'Due', 'Overdue', 'Responsible', 'Party', 'Status', 'Recovery (Rs)'], rows.map((c) => [c.docNo, c.period, c.reportedOn, c.reportedBy, c.location ?? '', c.description, c.severity, c.dueAt, c.overdue ? 'Yes' : 'No', c.responsibleType ?? '', c.partner ?? '', c.status, c.recovery]))}`, 'utf8') };
      },
    },
    claims: {
      create(actor, periodId, b) {
        const p = periodRow(actor, periodId, 'dlp.manage');
        const a = assetOf(p, b.assetId); if (!a) throw unprocessable('That asset is not in the register of this handover.');
        if (b.complaintId && !db.prepare('SELECT 1 FROM dlp_complaints WHERE id = ? AND period_id = ?').get(rid(b.complaintId), p.id)) throw unprocessable('That complaint is not of this period.');
        if (b.partnerId && !partnerOk(actor.companyId, b.partnerId)) throw unprocessable('That supplier does not exist.');
        if (b.claimedOn > today()) throw unprocessable('A claim is made on a day that has come.');
        if (a.warranty_until && b.claimedOn > a.warranty_until) throw unprocessable(`The warranty of ${a.tag_no} ended on ${a.warranty_until}.`);
        const docNo = number(actor.companyId, actor.user, 'DLP_WARRANTY_CLAIM', 'dlp_warranty_claims', 'WC');
        const id = Number(db.prepare("INSERT INTO dlp_warranty_claims (company_id, period_id, asset_id, complaint_id, partner_id, doc_no, claimed_on, description, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')")
          .run(actor.companyId, p.id, a.id, b.complaintId ?? null, b.partnerId ?? null, docNo, b.claimedOn, b.description, p.org_project_id, p.org_site_id, actor.user).lastInsertRowid);
        audit(actor, 'dlp_warranty_claims', String(id), 'create', actor.companyId, { newValues: b });
        return claimView(db.prepare('SELECT * FROM dlp_warranty_claims WHERE id = ?').get(id));
      },
      update(actor, id, b) {
        const w = db.prepare('SELECT * FROM dlp_warranty_claims WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!w) throw notFound('That warranty claim does not exist.');
        periodRow(actor, w.period_id, 'dlp.manage');
        const next = { OPEN: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['RESOLVED'] }[w.status] ?? [];
        if (!next.includes(b.status)) throw conflict(`A claim that is ${w.status.toLowerCase()} does not become ${b.status.toLowerCase()}.`);
        db.prepare('UPDATE dlp_warranty_claims SET status = ?, resolution_note = COALESCE(?, resolution_note), resolved_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.status, b.note ?? null, ['RESOLVED', 'REJECTED'].includes(b.status) ? today() : null, actor.user, nowIso(), w.id);
        audit(actor, 'dlp_warranty_claims', String(w.id), b.status.toLowerCase(), actor.companyId, { reason: b.note });
        return claimView(db.prepare('SELECT * FROM dlp_warranty_claims WHERE id = ?').get(w.id));
      },
    },
    // FR-05 the completion certificate
    requestCompletion(actor, id) {
      const p = periodRow(actor, id, 'dlp.complete.request');
      if (p.status !== 'ACTIVE') throw conflict(`${p.doc_no} is ${p.status.toLowerCase().replace('_', ' ')}.`);
      const r = readiness(p);
      if (!r.ready) throw unprocessable(`The completion certificate is refused: ${r.blockers.join(' ')}`, r.blockers.map((m) => ({ field: 'readiness', message: m })));
      return transaction(db, () => {
        db.prepare("UPDATE dlp_periods SET status = 'COMPLETION_REVIEW', requested_by = ?, readiness_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, JSON.stringify(r), actor.user, nowIso(), p.id);
        const inst = workflowOf(db).submit(actor, { docType: DLP_DOC, docId: String(p.id), comment: `Completion of ${p.doc_no}`, context: { projectId: p.org_project_id, siteId: p.org_site_id } });
        db.prepare('UPDATE dlp_periods SET workflow_instance_id = ? WHERE id = ?').run(inst.id, p.id);
        audit(actor, 'dlp_periods', String(p.id), 'request', actor.companyId);
        return svc.periods.get(actor, p.id);
      });
    },
    decide(instance, actor, outcome, comment) {
      const p = db.prepare('SELECT * FROM dlp_periods WHERE id = ?').get(rid(instance.docId)); if (!p || p.status !== 'COMPLETION_REVIEW') return;
      if (outcome !== 'APPROVED') {
        db.prepare("UPDATE dlp_periods SET status = 'ACTIVE', remarks = COALESCE(?, remarks), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(comment ?? null, actor?.user ?? 'system', nowIso(), p.id);
        audit(actor, 'dlp_periods', String(p.id), outcome.toLowerCase(), p.company_id, { reason: comment ?? undefined }); return;
      }
      db.prepare("UPDATE dlp_periods SET status = 'COMPLETED', completed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor?.user ?? 'system', nowIso(), p.id);
      audit(actor, 'dlp_periods', String(p.id), 'complete', p.company_id);
      const recoveries = db.prepare("SELECT COALESCE(SUM(recovery_amount), 0) AS n FROM dlp_complaints WHERE period_id = ? AND status = 'CLOSED'").get(p.id).n;
      publishEvent(db, { type: 'dlp.period.completed', entity: 'dlp_periods', entityId: String(p.id), actorId: actor?.user ?? 'system', companyId: p.company_id, projectId: p.org_project_id, data: { periodId: p.id, docNo: p.doc_no, handoverId: p.handover_id, projectId: p.org_project_id, siteId: p.org_site_id, startsOn: p.starts_on, endsOn: p.ends_on, recoveries: recoveries / 100 } });
    },
    /** Hourly: overdue complaints escalate one level (1: the project manager; 2 and more: the QA/QC manager too). Every morning: periods ending within 30 days. */
    sweep(companyId) {
      let escalated = 0; let ending = 0;
      const late = db.prepare("SELECT c.*, p.org_project_id, p.org_site_id FROM dlp_complaints c JOIN dlp_periods p ON p.id = c.period_id WHERE c.company_id = ? AND c.deleted_at IS NULL AND c.status IN ('OPEN', 'ASSIGNED') AND c.due_at < ? AND (c.escalated_at IS NULL OR c.escalated_at < ?)").all(companyId, nowIso(), new Date(Date.now() - 24 * 3600_000).toISOString());
      for (const c of late) {
        const level = c.escalation_level + 1;
        db.prepare('UPDATE dlp_complaints SET escalation_level = ?, escalated_at = ? WHERE id = ?').run(level, nowIso(), c.id);
        notify(companyId, 'dlp.complaint.overdue', level >= 2 ? ['role:PM', 'role:QCMGR'] : ['role:PM'], c.doc_no, `overdue, escalation level ${level}`, c.description, `/close/dlp/complaints?id=${c.id}`, `${c.id}.${level}`, { projectId: c.org_project_id });
        escalated += 1;
      }
      const soon = db.prepare("SELECT * FROM dlp_periods WHERE company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND ends_on <= ? AND (expiry_notified_on IS NULL OR expiry_notified_on < ?)").all(companyId, addMonths(today(), 1), today());
      for (const p of soon) {
        db.prepare('UPDATE dlp_periods SET expiry_notified_on = ? WHERE id = ?').run(today(), p.id);
        notify(companyId, 'dlp.period.ending', ['role:PM', 'role:COMMGR'], p.doc_no, `ends on ${p.ends_on}`, p.area_label ?? '', `/close/dlp/period?id=${p.id}`, `${p.id}.${today()}`, { projectId: p.org_project_id }); ending += 1;
      }
      return { escalated, ending };
    },
  };
  return svc;
}

const instances = new WeakMap();
export const dlpOf = (db) => { if (!instances.has(db)) instances.set(db, createDlp({ db })); return instances.get(db); };

const step = (code, name, role) => ({ code, name, type: 'approval', mode: 'single', approvers: [{ kind: 'role', role }], slaHours: 72, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
workflowTypes.register({
  docType: DLP_DOC, label: 'Defects liability completion', processOwner: 'COMMGR', route: (id) => `/close/dlp/period?id=${id}`,
  describe(db, companyId, id) { const p = db.prepare('SELECT * FROM dlp_periods WHERE id = ?').get(rid(id)); return p && p.company_id === companyId ? { ref: p.doc_no, title: `Completion of defects liability ${p.doc_no}: ${p.area_label ?? ''}`.slice(0, 300), originator: p.requested_by, projectId: p.org_project_id, siteId: p.org_site_id ?? undefined } : null; },
  summarise(db, _actor, id) { const p = db.prepare('SELECT * FROM dlp_periods WHERE id = ?').get(rid(id)); if (!p) return null; const n = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(recovery_amount), 0) AS r FROM dlp_complaints WHERE period_id = ? AND deleted_at IS NULL").get(p.id); return { fields: [{ label: 'Period', value: `${p.starts_on} to ${p.ends_on}` }, { label: 'Area', value: p.area_label ?? '' }, { label: 'Complaints', value: `${n.n}, all closed` }, { label: 'Recovered from parties', value: `Rs ${(n.r / 100).toFixed(2)}` }] }; },
  defaultDefinition: { name: 'Defects liability completion: the commercial manager and the CFO approve what the project manager requested', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('COMMGR', 'Commercial manager', 'COMMGR'), step('CFO', 'Chief financial officer', 'CFO')] },
  hooks: {
    onApproved: (db, { instance, actor }) => dlpOf(db).decide(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => dlpOf(db).decide(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => dlpOf(db).decide(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => dlpOf(db).decide(instance, actor, 'CANCELLED', comment),
  },
});
