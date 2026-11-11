import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { PRIORITIES, d3, lower, nowIso, q3, rid, same } from './base.js';
import { STORE_KINDS } from './stock.js';

// Material requests, the site indents (part 15.01, FR-01, FR-02): what a site needs, against a work authorisation and a WBS node, with the stock of the site, nearby stores and the central warehouse shown on each line. The site engineer (or
// storekeeper, or planner) raises it and the construction manager approves it; the procurement officer then meets each line from the stock of the site (issue), another store (transfer) or by purchase (a requisition, consolidated with
// other requests). The issue and the transfer are done by the stock module (16.04, 16.05) once it exists: here they are asked for and recorded, with an event.
export const MR_DOC = 'PROC_MR';
export const MR_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', CLOSED: 'Closed', SUPERSEDED: 'Superseded by an amendment' };
export const FULFILMENT = { NONE: 'Not met yet', PARTIAL: 'Partly met', COVERED: 'Met' };
export const MODES = { NONE: 'Not decided', ISSUE: 'Issue from site stock', TRANSFER: 'Transfer from another store', PR: 'Purchase', MIXED: 'More than one way' };
const EDITABLE = ['DRAFT', 'RETURNED'];

export const mrList = defineList({
  code: 'proc.material_requests', label: 'Material requests', permission: 'proc.material_request.view', from: 'proc_material_requests x JOIN org_projects p ON p.id = x.org_project_id JOIN org_sites s ON s.id = x.mr_site_id LEFT JOIN site_work_authorisations w ON w.id = x.wa_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 's.code', 'x.purpose', 'x.requested_by'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'MR no.' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, site: { sql: 's.code', type: 'text', label: 'Site' }, siteId: { sql: 'x.mr_site_id', type: 'number', label: 'Site id' },
    requestedBy: { sql: 'x.requested_by', type: 'text', label: 'Requested by' }, requiredBy: { sql: 'x.required_by', type: 'date', label: 'Required by' }, wa: { sql: 'w.wa_no', type: 'text', label: 'Work authorisation' }, priority: { sql: 'x.priority', type: 'enum', label: 'Priority', options: Object.entries(PRIORITIES) },
    fulfilment: { sql: "CASE WHEN x.status NOT IN ('APPROVED', 'CLOSED') THEN '' ELSE (SELECT CASE WHEN COALESCE(SUM(l.issue_qty + l.transfer_qty + l.pr_qty), 0) = 0 THEN 'NONE' WHEN SUM(l.issue_qty + l.transfer_qty + l.pr_qty) >= SUM(l.qty) THEN 'COVERED' ELSE 'PARTIAL' END FROM proc_mr_lines l WHERE l.mr_id = x.id AND l.deleted_at IS NULL) END", type: 'enum', label: 'Fulfilment', options: Object.entries(FULFILMENT) },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(MR_STATUS) },
  },
});

export function createMrService({ db, base, stock }) {
  const { authz, may, need, fail, audit, notify, number, project, siteOf, wbsOf, codeOf, itemOf, uomOk } = base;
  const evt = (type, actor, r, data) => publishEvent(db, { type, entity: 'proc_material_request', entityId: r.id, actorId: actor?.user ?? 'system', companyId: r.company_id, projectId: r.org_project_id, siteId: r.mr_site_id, data: { mrId: r.id, docNo: r.doc_no, projectId: r.org_project_id, siteId: r.mr_site_id, ...data } });
  const linesOf = (id) => db.prepare('SELECT * FROM proc_mr_lines WHERE mr_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  const row = (actor, id, key = 'proc.material_request.view') => {
    const r = db.prepare('SELECT * FROM proc_material_requests WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'proc.material_request.view', r.org_project_id, r.mr_site_id)) throw notFound('That material request does not exist.'); if (key !== 'proc.material_request.view') need(actor, key, 'do that with a material request', r.org_project_id, r.mr_site_id); return r;
  };
  const scope = (actor) => { const f = authz.scopeFilter(actor, 'proc.material_request.view', { project: 'x.org_project_id', site: 'x.mr_site_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const covered = (l) => l.issue_qty + l.transfer_qty + l.pr_qty;
  const fulfilmentOf = (ls) => { const c = ls.reduce((n, l) => n + covered(l), 0); return c === 0 ? 'NONE' : c >= ls.reduce((n, l) => n + l.qty, 0) ? 'COVERED' : 'PARTIAL'; };
  const modeOf = (l) => { const m = [l.issue_qty > 0, l.transfer_qty > 0, l.pr_qty > 0].filter(Boolean).length; return m === 0 ? 'NONE' : m > 1 ? 'MIXED' : l.issue_qty > 0 ? 'ISSUE' : l.transfer_qty > 0 ? 'TRANSFER' : 'PR'; };
  const prsOf = (lineId) => db.prepare("SELECT p.id, p.doc_no, p.status, s.qty FROM proc_pr_sources s JOIN proc_pr_lines pl ON pl.id = s.pr_line_id JOIN proc_requisitions p ON p.id = pl.pr_id WHERE s.mr_line_id = ? AND s.deleted_at IS NULL AND pl.deleted_at IS NULL ORDER BY p.id").all(lineId);

  /** BR-01 and the master data: the lines of a request are checked again on every save and send. */
  function checkLines(actor, p, header, lines) {
    const problems = []; const today = todayIST(); const out = []; const seen = new Set();
    if (header.requiredBy < today) problems.push({ field: 'requiredBy', message: 'The required-by date is not before today' });
    if (!lines.length) problems.push({ field: 'lines', message: 'Add at least one line' });
    lines.forEach((l, i) => {
      const at = `lines.${i}`; const item = itemOf(actor.companyId, l.itemId);
      if (!item || item.item_status !== 'ACTIVE') { problems.push({ field: `${at}.itemId`, message: 'Choose an active item of the item master' }); return; }
      if (!uomOk(item, l.uom)) problems.push({ field: `${at}.uom`, message: `Not a unit of ${item.code} (${item.base_uom} or one of its conversions)` });
      if (l.wbsId && !wbsOf(p.id, l.wbsId)) problems.push({ field: `${at}.wbsId`, message: 'Not a WBS node of this project' });
      if (l.costCodeId && !codeOf(actor.companyId, l.costCodeId)) problems.push({ field: `${at}.costCodeId`, message: 'Not a cost code of this company' });
      const key = `${l.itemId}|${lower(l.uom)}|${l.wbsId ?? 0}`; if (seen.has(key)) problems.push({ field: `${at}.itemId`, message: 'The same item, unit and WBS node is already on this request: add to that line' }); seen.add(key);
      out.push({ ...l, item, qty: q3(l.qty) });
    });
    fail(problems); return out;
  }
  /** FR-01: a request is raised against a work authorisation of the site (approved or an emergency one), which names the activity. */
  function waCheck(p, siteId, waId) {
    if (!waId) return null; const w = db.prepare('SELECT id, wa_no, wa_site_id, activity_id, wbs_id, status, org_project_id FROM site_work_authorisations WHERE id = ? AND deleted_at IS NULL').get(rid(waId));
    if (!w || w.org_project_id !== p.id || w.wa_site_id !== siteId) fail([{ field: 'waId', message: 'Not a work authorisation of this site' }]); if (!['APPROVED', 'EMERGENCY', 'CLOSED'].includes(w.status)) fail([{ field: 'waId', message: 'The work authorisation is not approved' }]); return w;
  }

  const view = (actor, r, { detail = false } = {}) => {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const s = db.prepare('SELECT code, name FROM org_sites WHERE id = ?').get(r.mr_site_id); const wa = r.wa_id ? db.prepare('SELECT wa_no FROM site_work_authorisations WHERE id = ?').get(r.wa_id) : null;
    const act = r.activity_id ? db.prepare('SELECT code, name FROM plan_activities WHERE id = ?').get(r.activity_id) : null; const can = (k) => may(actor, k, r.org_project_id, r.mr_site_id); const own = same(r.requested_by, actor.user); const ls = linesOf(r.id);
    const o = {
      id: r.id, docNo: r.doc_no, date: r.doc_date, projectId: r.org_project_id, projectCode: p?.code, projectName: p?.name, siteId: r.mr_site_id, siteCode: s?.code, siteName: s?.name, requestedBy: r.requested_by, requiredBy: r.required_by, waId: r.wa_id, waNo: wa?.wa_no ?? null, activityId: r.activity_id, activity: act ? `${act.code} ${act.name}` : null,
      priority: r.priority, priorityLabel: PRIORITIES[r.priority], purpose: r.purpose, status: r.status, statusLabel: MR_STATUS[r.status], revisionNo: r.revision_no, parentId: r.parent_id, workflowInstanceId: r.workflow_instance_id, approvedBy: r.approved_by, approvedAt: r.approved_at, cancelReason: r.cancel_reason, rowVersion: r.version,
      fulfilment: ['APPROVED', 'CLOSED'].includes(r.status) ? fulfilmentOf(ls) : null, lineCount: ls.length,
      can: { edit: can('proc.material_request.edit') && EDITABLE.includes(r.status) && (own || can('proc.material_request.process')), submit: can('proc.material_request.submit') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, cancel: can('proc.material_request.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status), delete: can('proc.material_request.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('proc.material_request.amend') && r.status === 'APPROVED' && ls.every((l) => covered(l) === 0), approve: can('proc.material_request.approve') && r.status === 'SUBMITTED' && !own, process: can('proc.material_request.process') && r.status === 'APPROVED', print: can('proc.material_request.print') },
    };
    if (detail) {
      const av = stock.availability(r.company_id, r.org_project_id, r.mr_site_id, ls.map((l) => l.item_id));
      o.lines = ls.map((l) => { const it = itemOf(r.company_id, l.item_id); const a = av.get(l.item_id); const w = l.wbs_id ? wbsOf(r.org_project_id, l.wbs_id) : null; const c = l.cost_code_id ? codeOf(r.company_id, l.cost_code_id) : null;
        return { id: l.id, lineNo: l.line_no, itemId: l.item_id, itemCode: it?.code, itemName: it?.name, qty: d3(l.qty), uom: l.uom, wbsId: l.wbs_id, wbs: w ? `${w.code} ${w.name}` : null, costCodeId: l.cost_code_id, costCode: c ? `${c.code} ${c.name}` : null, remarks: l.remarks, mode: modeOf(l), modeLabel: MODES[modeOf(l)], issueQty: d3(l.issue_qty), transferQty: d3(l.transfer_qty), prQty: d3(l.pr_qty), fulfilledQty: d3(l.fulfilled_qty), openQty: d3(l.qty - covered(l)), fromStore: l.from_store_code,
          availability: a ? { stores: a.stores, controlQty: a.controlQty, total: a.total, covers: a.controlMilli >= l.qty } : null, requisitions: prsOf(l.id).map((x) => ({ id: x.id, docNo: x.doc_no, status: x.status, qty: d3(x.qty) })) }; });
    }
    return o;
  };

  const header = (b) => ({ requiredBy: b.requiredBy, priority: b.priority ?? 'NORMAL', purpose: b.purpose ?? null });
  const saveLines = (r, lines, actor) => {
    const now = nowIso(); db.prepare('UPDATE proc_mr_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE mr_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id);
    lines.forEach((l, i) => db.prepare('INSERT INTO proc_mr_lines (company_id, mr_id, line_no, item_id, qty, uom, wbs_id, cost_code_id, remarks, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'api\')').run(r.company_id, r.id, i + 1, l.itemId, l.qty, l.uom, l.wbsId ?? null, l.costCodeId ?? null, l.remarks ?? null, r.org_project_id, r.mr_site_id, actor.user));
  };
  const mrs = {
    /** The projects the person sees requests or requisitions of, with what they may do there. */
    projects(actor) { return db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'proc.material_request.view', p.id) || may(actor, 'proc.requisition.view', p.id)).map((p) => ({ id: p.id, code: p.code, name: p.name, canRaiseMr: may(actor, 'proc.material_request.create', p.id), canRaisePr: may(actor, 'proc.requisition.create', p.id) })); },
    list(actor, query) {
      if (!authz.check(actor, 'proc.material_request.view').allowed) throw forbidden('You may not see material requests (permission proc.material_request.view).'); const sc = scope(actor);
      return runList(db, mrList, parseListRequest(mrList, query), { select: 'x.*, p.code AS pcode, s.code AS scode, w.wa_no AS wno', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, docNo: x.doc_no, date: x.doc_date, project: x.pcode, projectId: x.org_project_id, site: x.scode, siteId: x.mr_site_id, requestedBy: x.requested_by, requiredBy: x.required_by, wa: x.wno, priority: x.priority, status: x.status, statusLabel: MR_STATUS[x.status], fulfilment: ['APPROVED', 'CLOSED'].includes(x.status) ? fulfilmentOf(linesOf(x.id)) : '' }) });
    },
    exportSource(actor, req) { return mrs.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get: (actor, id) => { const v = view(actor, row(actor, id), { detail: true }); if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; return v; },
    options(actor, projectId) {
      const p = project(actor, projectId, 'proc.material_request.view');
      return { projectId: p.id, sites: db.prepare("SELECT id, code, name FROM org_sites WHERE org_project_id = ? AND company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(p.id, actor.companyId).filter((s) => may(actor, 'proc.material_request.view', p.id, s.id)),
        was: db.prepare("SELECT w.id, w.wa_no, w.wa_site_id, w.activity_id, w.wbs_id, w.plan_date, a.code AS acode, a.name AS aname FROM site_work_authorisations w JOIN plan_activities a ON a.id = w.activity_id WHERE w.org_project_id = ? AND w.company_id = ? AND w.deleted_at IS NULL AND w.status IN ('APPROVED', 'EMERGENCY') ORDER BY w.plan_date DESC, w.id DESC LIMIT 200").all(p.id, actor.companyId).map((w) => ({ id: w.id, waNo: w.wa_no, siteId: w.wa_site_id, activityId: w.activity_id, wbsId: w.wbs_id, planDate: w.plan_date, label: `${w.wa_no} · ${w.acode} ${w.aname} · ${w.plan_date}` })),
        wbs: db.prepare('SELECT id, code, name FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL ORDER BY code').all(p.id).map((w) => ({ id: w.id, label: `${w.code} ${w.name}` })), costCodes: db.prepare('SELECT id, code, name FROM fin_cost_codes WHERE (company_id = ? OR company_id IS NULL) AND deleted_at IS NULL ORDER BY code').all(actor.companyId).map((c) => ({ id: c.id, label: `${c.code} ${c.name}` })), today: todayIST() };
    },
    /** FR-01: the stock of one item at the site, for the line being filled in. */
    availability(actor, { projectId, siteId, itemId }) { const p = project(actor, projectId, 'proc.material_request.view'); if (siteId && !siteOf(actor.companyId, p.id, siteId)) throw notFound('That site does not exist.'); if (!itemOf(actor.companyId, itemId)) throw notFound('That item does not exist.'); return stock.availability(actor.companyId, p.id, siteId ? rid(siteId) : null, [rid(itemId)]).get(rid(itemId)); },
    create(actor, b) {
      const p = project(actor, b.projectId, 'proc.material_request.view'); const site = siteOf(actor.companyId, p.id, b.siteId); if (!site) fail([{ field: 'siteId', message: 'Not a site of this project' }]); need(actor, 'proc.material_request.create', 'raise a material request here', p.id, site.id);
      const wa = waCheck(p, site.id, b.waId); const lines = checkLines(actor, p, header(b), b.lines);
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, MR_DOC, 'proc_material_requests', 'MR');
        const id = Number(db.prepare("INSERT INTO proc_material_requests (company_id, doc_no, doc_date, org_project_id, mr_site_id, requested_by, required_by, wa_id, activity_id, priority, purpose, status, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(actor.companyId, no, todayIST(), p.id, site.id, actor.user, b.requiredBy, wa?.id ?? null, wa?.activity_id ?? null, b.priority ?? 'NORMAL', b.purpose ?? null, p.id, site.id, actor.user).lastInsertRowid);
        const r = db.prepare('SELECT * FROM proc_material_requests WHERE id = ?').get(id); saveLines(r, lines, actor); audit(actor, 'proc_material_requests', id, 'create', actor.companyId, { newValues: { docNo: no, lines: lines.length } }); return mrs.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proc.material_request.edit'); if (!EDITABLE.includes(r.status)) throw conflict(r.status === 'APPROVED' ? 'An approved request is locked: amend it.' : `${MR_STATUS[r.status]}: it is not changed now.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this request; reload it.');
      const p = project(actor, r.org_project_id, 'proc.material_request.view'); const siteId = b.siteId ?? r.mr_site_id; const site = siteOf(actor.companyId, p.id, siteId); if (!site) fail([{ field: 'siteId', message: 'Not a site of this project' }]);
      const waId = 'waId' in b ? b.waId : r.wa_id; const wa = waCheck(p, site.id, waId); const req = b.requiredBy ?? r.required_by; const lines = b.lines ? checkLines(actor, p, { requiredBy: req }, b.lines) : null;
      if (!b.lines && req < todayIST()) fail([{ field: 'requiredBy', message: 'The required-by date is not before today' }]);
      return transaction(db, () => {
        db.prepare('UPDATE proc_material_requests SET mr_site_id = ?, required_by = ?, wa_id = ?, activity_id = ?, priority = ?, purpose = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(site.id, req, wa?.id ?? null, wa?.activity_id ?? null, b.priority ?? r.priority, 'purpose' in b ? b.purpose : r.purpose, actor.user, nowIso(), r.id);
        if (lines) saveLines({ ...r, mr_site_id: site.id }, lines, actor); audit(actor, 'proc_material_requests', r.id, 'update', r.company_id, { newValues: { lines: lines?.length ?? undefined } }); return mrs.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = row(actor, id, 'proc.material_request.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { const now = nowIso(); db.prepare('UPDATE proc_mr_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE mr_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_material_requests SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'proc_material_requests', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    /** Send for approval: the construction manager decides. The checks are made again. */
    submit(actor, id) {
      const r = row(actor, id, 'proc.material_request.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned request is sent for approval.');
      const p = project(actor, r.org_project_id, 'proc.material_request.view'); const lines = linesOf(r.id); checkLines(actor, p, { requiredBy: r.required_by }, lines.map((l) => ({ itemId: l.item_id, qty: d3(l.qty), uom: l.uom, wbsId: l.wbs_id, costCodeId: l.cost_code_id })));
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, siteId: r.mr_site_id, priority: r.priority, lines: lines.length };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: MR_DOC, docId: String(r.id), comment: `${r.doc_no}: ${lines.length} line(s)`.slice(0, 300), context: ctx }); db.prepare('UPDATE proc_material_requests SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE proc_material_requests SET status = 'SUBMITTED', requested_by = ?, submitted_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(r.requested_by, nowIso(), actor.user, nowIso(), r.id); audit(actor, 'proc_material_requests', r.id, 'submit', r.company_id, { newValues: ctx }); return mrs.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a request waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return mrs.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'proc.material_request.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status)) throw unprocessable('Only a request that is not closed is cancelled.');
      if (linesOf(r.id).some((l) => covered(l) > 0)) throw conflict('Part of this request is already being met (issue, transfer or purchase): cancel those first.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proc_material_requests SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'proc_material_requests', r.id, 'cancel', r.company_id, { reason }); evt('proc.mr.cancelled', actor, r, { reason }); return mrs.get(actor, r.id); });
    },
    /** An approved request is changed by a new revision, which replaces it when it is approved. Not once a line is being met. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'proc.material_request.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved request is amended.'); if (linesOf(r.id).some((l) => covered(l) > 0)) throw conflict('Part of this request is already being met: it is not amended.');
      if (db.prepare("SELECT 1 FROM proc_material_requests WHERE parent_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment of this request is already open.');
      return transaction(db, () => {
        const no = `${r.doc_no.split('/R')[0]}/R${r.revision_no + 1}`; const nid = Number(db.prepare("INSERT INTO proc_material_requests (company_id, doc_no, doc_date, org_project_id, mr_site_id, requested_by, required_by, wa_id, activity_id, priority, purpose, status, revision_no, parent_id, project_id, site_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 'amendment', ?, ?)").run(r.company_id, no, todayIST(), r.org_project_id, r.mr_site_id, actor.user, r.required_by > todayIST() ? r.required_by : todayIST(), r.wa_id, r.activity_id, r.priority, r.purpose, r.revision_no + 1, r.id, r.org_project_id, r.mr_site_id, actor.user, String(r.id), reason).lastInsertRowid);
        const n = db.prepare('SELECT * FROM proc_material_requests WHERE id = ?').get(nid); saveLines(n, linesOf(r.id).map((l) => ({ itemId: l.item_id, qty: l.qty, uom: l.uom, wbsId: l.wbs_id, costCodeId: l.cost_code_id, remarks: l.remarks })), actor); audit(actor, 'proc_material_requests', nid, 'amend', r.company_id, { reason, newValues: { of: r.doc_no } }); return mrs.get(actor, nid);
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'proc_material_requests' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'proc.material_request.print'); const v = view(actor, r, { detail: true }); audit(actor, 'proc_material_requests', r.id, 'print', r.company_id);
      const columns = [['lineNo', '#'], ['item', 'Item'], ['qty', 'Quantity'], ['uom', 'Unit'], ['wbs', 'WBS'], ['mode', 'Met by']].map(([key, label]) => ({ key, label, type: 'text' })); const rows = v.lines.map((l) => ({ lineNo: String(l.lineNo), item: `${l.itemCode} ${l.itemName}`, qty: String(l.qty), uom: l.uom, wbs: l.wbs ?? '', mode: l.modeLabel }));
      const footer = [`${v.docNo}: ${v.projectCode} / ${v.siteCode}, required by ${v.requiredBy}, ${v.priorityLabel} priority`, `Requested by ${v.requestedBy}${v.approvedBy ? `; approved by ${v.approvedBy}` : ''}${v.waNo ? `; work authorisation ${v.waNo}` : ''}`, v.purpose ?? ''].filter(Boolean);
      return { buffer: toPdf({ columns, rows, footer, title: `Material request ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    /** Lines pasted or exported from a sheet are added to a draft by item code, with the same checks as a typed line. */
    importLines(actor, id, { rows }) {
      const r = row(actor, id, 'proc.material_request.edit'); if (!EDITABLE.includes(r.status)) throw conflict('Lines are added to a draft or a returned request.'); const p = project(actor, r.org_project_id, 'proc.material_request.view'); const problems = [];
      const add = rows.map((x, i) => { const it = db.prepare("SELECT id FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND item_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(actor.companyId, x.itemCode); if (!it) problems.push({ field: `rows.${i}.itemCode`, message: `No active item with the code ${x.itemCode}` }); return { itemId: it?.id, qty: x.qty, uom: x.uom, wbsId: null, costCodeId: null, remarks: x.remarks ?? null }; }); fail(problems);
      const all = [...linesOf(r.id).map((l) => ({ itemId: l.item_id, qty: d3(l.qty), uom: l.uom, wbsId: l.wbs_id, costCodeId: l.cost_code_id, remarks: l.remarks })), ...add]; const lines = checkLines(actor, p, { requiredBy: r.required_by }, all);
      return transaction(db, () => { saveLines(r, lines, actor); audit(actor, 'proc_material_requests', r.id, 'import', r.company_id, { newValues: { added: add.length } }); return mrs.get(actor, r.id); });
    },
    /** FR-02: the way each line is met. Issue is from the store of the site and transfer from another store, each against its free stock; the rest is bought, through a requisition. */
    fulfil(actor, id, { lines }) {
      const r = row(actor, id, 'proc.material_request.process'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved request is met.'); const ls = new Map(linesOf(r.id).map((l) => [l.id, { ...l }])); const problems = []; const plan = [];
      const av = stock.availability(r.company_id, r.org_project_id, r.mr_site_id, [...ls.values()].map((l) => l.item_id));
      lines.forEach((x, i) => {
        const l = ls.get(x.lineId); if (!l) { problems.push({ field: `lines.${i}.lineId`, message: 'Not a line of this request' }); return; } const qty = q3(x.qty); if (qty > l.qty - covered(l)) { problems.push({ field: `lines.${i}.qty`, message: 'More than is left to meet on this line' }); return; } const planned = () => { if (x.mode === 'ISSUE') l.issue_qty += qty; else l.transfer_qty += qty; };
        const stores = av.get(l.item_id)?.stores ?? []; const st = x.storeCode ? stores.find((s) => s.storeCode === x.storeCode) : null;
        if (x.mode === 'ISSUE') { const s = st ?? stores.find((y) => y.relation === 'SAME_SITE'); if (!s || s.relation !== 'SAME_SITE') problems.push({ field: `lines.${i}.mode`, message: 'Issue is from the store of this site' }); else if (Math.round(s.freeQty * 1000) < qty) problems.push({ field: `lines.${i}.qty`, message: `Only ${s.freeQty} ${l.uom} is free in ${s.storeName}` }); else { planned(); plan.push({ l, x, qty, store: s }); } }
        else { if (!st || st.relation === 'SAME_SITE') problems.push({ field: `lines.${i}.storeCode`, message: 'Choose a nearby store or the central warehouse' }); else if (Math.round(st.freeQty * 1000) < qty) problems.push({ field: `lines.${i}.qty`, message: `Only ${st.freeQty} ${l.uom} is free in ${st.storeName}` }); else { planned(); plan.push({ l, x, qty, store: st }); } }
      });
      fail(problems);
      return transaction(db, () => {
        for (const { l, x, qty, store } of plan) {
          const n = l; db.prepare('UPDATE proc_mr_lines SET issue_qty = ?, transfer_qty = ?, fulfilment_mode = ?, from_store_code = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(n.issue_qty, n.transfer_qty, modeOf(n), store.storeCode, actor.user, nowIso(), l.id);
          evt(x.mode === 'ISSUE' ? 'proc.mr.issue_requested' : 'proc.mr.transfer_requested', actor, r, { lineId: l.id, lineNo: l.line_no, itemId: l.item_id, qty: d3(qty), uom: l.uom, fromStore: store.storeCode, fromStoreKind: STORE_KINDS[store.kind], toSiteId: r.mr_site_id });
        }
        audit(actor, 'proc_material_requests', r.id, 'fulfil', r.company_id, { newValues: { lines: plan.length } }); return mrs.get(actor, r.id);
      });
    },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM proc_material_requests WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso(); const p = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(r.org_project_id);
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE proc_material_requests SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
        if (r.parent_id) db.prepare("UPDATE proc_material_requests SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND status = 'APPROVED'").run(actor.user, now, r.parent_id);
        audit(actor, 'proc_material_requests', r.id, 'approve', r.company_id); evt('proc.mr.approved', actor, r, { requiredBy: r.required_by, priority: r.priority, waId: r.wa_id, activityId: r.activity_id, supersedes: r.parent_id, lines: linesOf(r.id).map((l) => ({ lineId: l.id, lineNo: l.line_no, itemId: l.item_id, qty: d3(l.qty), uom: l.uom, wbsId: l.wbs_id, costCodeId: l.cost_code_id })) });
        notify(r.company_id, 'proc.mr.approved', [`user:${r.requested_by}`, 'role:PROCIC|PROCMGR'], r.doc_no, String(p?.code), `${r.doc_no} is approved and waits to be met: issue from stock, transfer, or purchase.`, `/proc/material-requests?id=${r.id}`, r.id, { projectId: r.org_project_id, siteId: r.mr_site_id }); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proc_material_requests SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'proc_material_requests', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'proc.mr.rejected', [`user:${r.requested_by}`], r.doc_no, String(p?.code), `${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/proc/material-requests?id=${r.id}`, r.id);
    },
  };
  return { mrs, covered, modeOf, linesOf, decide: mrs.decide };
}
