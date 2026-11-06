import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { calcOf } from '../../platform/calc/index.js';
import { fileEntities } from '../../platform/files/entities.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { documentsOf } from '../eng/documents.js';
import { esc, json, nowIso, rupees, same, toMinor } from './constants.js';
import { convertHooks, crmOf, rid, wfDoc } from './crm.js';
import { createKit } from './kit.js';
import { BID_TYPES, CRITERIA, DECISIONS, DECISION_DOC, IMPACTS, LIVE_STAGES, NUMERIC_CRITERIA, PORTALS, QUERY_STATUS, RESULTS, SCORE_KEYS, TASK_STATUS, TEAM_KINDS, TENDER_DOC, TENDER_STAGES } from './tender-constants.js';

const APPROVAL = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
const TENDER_STATUS = { ...APPROVAL, APPROVED: 'Registered' };
const CLIENT_OK = ['PROSPECT', 'PENDING', 'ACTIVE'];
const CLIENT_ROLE = "EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role = 'CLIENT' AND r.deleted_at IS NULL)";
const APPROVER = (docTypes, a) => `EXISTS (SELECT 1 FROM wf_tasks w JOIN wf_instances i ON i.id = w.instance_id WHERE i.doc_type IN (${docTypes}) AND (i.doc_id = CAST(${a}.id AS TEXT) OR i.doc_id LIKE CAST(${a}.id AS TEXT) || '-A%') AND w.status IN ('OPEN', 'ADMIN_QUEUE', 'DONE') AND (lower(w.assignee_user_id) = lower(:u) OR w.assignee_role IN (SELECT value FROM json_each(:roles))))`;
const SCOPE_T = (all) => (all ? 't.company_id = :c AND (1 = 1 OR :u IS NULL OR :roles IS NULL)' : `t.company_id = :c AND (lower(t.owner) = lower(:u) OR lower(t.created_by) = lower(:u) OR ${APPROVER("'TDR_TENDER'", 't')} OR EXISTS (SELECT 1 FROM tdr_bid_decisions bd WHERE bd.tender_id = t.id AND bd.deleted_at IS NULL AND ${APPROVER("'TDR_BID_DECISION'", 'bd')}))`);
const SCOPE_D = (all) => (all ? 'd.company_id = :c AND (1 = 1 OR :u IS NULL OR :roles IS NULL)' : `d.company_id = :c AND (lower(d.created_by) = lower(:u) OR lower(t.owner) = lower(:u) OR lower(t.created_by) = lower(:u) OR ${APPROVER("'TDR_BID_DECISION'", 'd')})`);
const dayOf = (s) => (s ? String(s).slice(0, 10) : null);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const defined = (b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined));

export const tenderList = defineList({
  code: 'bd.tenders', label: 'Tenders', permission: 'bd.tender.view',
  from: 'tdr_tenders t JOIN mdm_partners p ON p.id = t.client_partner_id', where: 't.deleted_at IS NULL', searchable: ['t.doc_no', 't.reference_no', 't.name_of_work', 'p.legal_name'], defaultSort: 'submission',
  columns: {
    docNo: { sql: 't.doc_no', type: 'text', label: 'Tender' }, reference: { sql: 't.reference_no', type: 'text', label: 'Reference' }, client: { sql: 'p.legal_name', type: 'text', label: 'Client' }, nameOfWork: { sql: 't.name_of_work', type: 'text', label: 'Name of work' },
    portal: { sql: 't.portal', type: 'enum', label: 'Portal', options: Object.entries(PORTALS) }, bidType: { sql: 't.bid_type', type: 'enum', label: 'Bid type', options: Object.entries(BID_TYPES) },
    estCost: { sql: '(t.est_cost_minor / 100.0)', type: 'money', label: 'Estimated cost (₹)' }, emd: { sql: '(t.emd_minor / 100.0)', type: 'money', label: 'EMD (₹)' }, submission: { sql: 'substr(t.submission_at, 1, 10)', type: 'date', label: 'Submission' },
    owner: { sql: 't.owner', type: 'text', label: 'Owner' }, stage: { sql: 't.stage', type: 'enum', label: 'Stage', options: Object.entries(TENDER_STAGES) }, status: { sql: 't.status', type: 'enum', label: 'Registration', options: Object.entries(TENDER_STATUS) },
  },
});
export const decisionList = defineList({
  code: 'bd.bid_decisions', label: 'Bid / no-bid decisions', permission: 'bd.bid_decision.view',
  from: 'tdr_bid_decisions d JOIN tdr_tenders t ON t.id = d.tender_id', where: 'd.deleted_at IS NULL', searchable: ['d.doc_no', 't.doc_no', 't.name_of_work'], defaultSort: '-docNo',
  columns: {
    docNo: { sql: 'd.doc_no', type: 'text', label: 'Decision' }, tender: { sql: 't.doc_no', type: 'text', label: 'Tender' }, nameOfWork: { sql: 't.name_of_work', type: 'text', label: 'Name of work' }, score: { sql: 'd.total_score', type: 'number', label: 'Score' },
    recommendation: { sql: 'd.recommendation', type: 'enum', label: 'Recommended', options: Object.entries(DECISIONS) }, decision: { sql: 'd.decision', type: 'enum', label: 'Decision', options: Object.entries(DECISIONS) }, status: { sql: 'd.status', type: 'enum', label: 'Status', options: Object.entries(APPROVAL) },
  },
});

export function createTenderService({ db }) {
  const kit = createKit(db);
  const { may, need, param, today, nextDoc, event, tell } = kit;
  const maker = (actor, r) => same(r.created_by, actor.user) || same(r.owner, actor.user);
  const seesAll = (actor) => may(actor, 'bd.tender.view_all');
  const params = (actor) => ({ c: actor.companyId, u: actor.user, roles: JSON.stringify(actor.roles ?? []) });
  const wfSeen = (actor, docTypes, id) => Boolean(db.prepare(`SELECT 1 FROM wf_tasks w JOIN wf_instances i ON i.id = w.instance_id WHERE i.company_id = ? AND i.doc_type IN (${docTypes.map(() => '?').join(',')}) AND (i.doc_id = ? OR i.doc_id LIKE ?) AND w.status IN ('OPEN', 'ADMIN_QUEUE', 'DONE') AND (lower(w.assignee_user_id) = lower(?) OR w.assignee_role IN (SELECT value FROM json_each(?)))`).get(actor.companyId, ...docTypes, String(id), `${id}-A%`, actor.user, JSON.stringify(actor.roles ?? [])));
  const seenTender = (actor, t) => t.company_id === actor.companyId && (seesAll(actor) || maker(actor, t) || wfSeen(actor, [TENDER_DOC], t.id) || db.prepare('SELECT id FROM tdr_bid_decisions WHERE tender_id = ? AND deleted_at IS NULL').all(t.id).some((d) => wfSeen(actor, [DECISION_DOC], d.id)));
  const clientRow = (companyId, id) => db.prepare(`SELECT p.id, p.code, p.legal_name, p.partner_status FROM mdm_partners p WHERE p.id = ? AND p.company_id = ? AND p.deleted_at IS NULL AND ${CLIENT_ROLE}`).get(Number(id), companyId);
  const tenderRow = (actor, id) => {
    const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!t || !seenTender(actor, t)) throw notFound('That tender does not exist or is not yours to see.');
    return t;
  };

  // ------------------------------------------------------------------ bid capacity (BR-02): the calculation engine, never the page
  /** A x N x factor - B, with A and B from the tender or, when it has none, from the company's profile; N is the completion period in years. */
  function capacityOf(companyId, t, user) {
    const a = t.bc_turnover_minor ?? Number(param(companyId, 'tdr.profile.max_turnover_minor') ?? 0);
    const b = t.bc_commitments_minor ?? Number(param(companyId, 'tdr.profile.commitments_minor') ?? 0);
    const factor = t.bc_factor ?? Number(param(companyId, 'tdr.capacity_factor') ?? 2);
    const years = (t.period_months / 12).toFixed(3).replace(/\.?0+$/, '') || '0';
    const r = calcOf(db).evaluate('tdr.bid_capacity', { max_turnover: (a / 100).toFixed(2), years, commitments: (b / 100).toFixed(2), factor: String(factor) }, { entity: 'tdr_tender', entityId: t.id ?? null, field: 'bid_capacity', companyId, user });
    return { minor: Math.round(Number(r.result.capacity) * 100), a, b, factor, years, formula: 'tdr.bid_capacity' };
  }
  function recompute(actor, t) {
    const c = capacityOf(actor.companyId, t, actor.user);
    db.prepare('UPDATE tdr_tenders SET bid_capacity_minor = ?, capacity_json = ? WHERE id = ?').run(c.minor, JSON.stringify(c), t.id);
    // the checklist rows that are worked out by the server follow: a number against a number
    for (const e of db.prepare("SELECT * FROM tdr_eligibility WHERE tender_id = ? AND deleted_at IS NULL").all(t.id)) {
      let { requirement_minor: req, our_minor: our } = e;
      if (e.criterion === 'BID_CAPACITY') { req = t.est_cost_minor; our = c.minor; }
      const auto = NUMERIC_CRITERIA.includes(e.criterion) && e.result_mode === 'AUTO';
      const result = auto ? (req != null && our != null && req > 0 ? (our >= req ? 'PASS' : 'FAIL') : 'PENDING') : e.result;
      if (req !== e.requirement_minor || our !== e.our_minor || result !== e.result) db.prepare('UPDATE tdr_eligibility SET requirement_minor = ?, our_minor = ?, result = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(req, our, result, nowIso(), e.id);
    }
    return c;
  }

  // ------------------------------------------------------------------ the tender
  const fieldsOf = (t) => ({ opportunityId: t.opportunity_id, clientPartnerId: t.client_partner_id, referenceNo: t.reference_no, portal: t.portal, portalName: t.portal_name, nameOfWork: t.name_of_work, location: t.location, region: t.region, estCost: rupees(t.est_cost_minor), emd: rupees(t.emd_minor), tenderFee: rupees(t.tender_fee_minor), bidType: t.bid_type, periodMonths: t.period_months, publishDate: t.publish_date, prebidDate: t.prebid_date, submissionAt: t.submission_at, openingAt: t.opening_at, owner: t.owner });
  function problemsOf(actor, m, { forSubmit = false } = {}) {
    const out = [];
    const c = clientRow(actor.companyId, m.clientPartnerId);
    if (!c) out.push({ field: 'clientPartnerId', message: 'Choose the authority from the partner master (a business partner with the role Client)' });
    else if (!CLIENT_OK.includes(c.partner_status)) out.push({ field: 'clientPartnerId', message: `${c.legal_name} cannot be chosen (${c.partner_status.toLowerCase()})` });
    if (m.owner && !kit.userExists(actor.companyId, m.owner)) out.push({ field: 'owner', message: 'The owner is not an active user of this company' });
    const order = [['publishDate', dayOf(m.publishDate)], ['prebidDate', dayOf(m.prebidDate)], ['submissionAt', dayOf(m.submissionAt)], ['openingAt', dayOf(m.openingAt)]].filter(([, v]) => v);
    for (let i = 1; i < order.length; i += 1) if (order[i][1] < order[i - 1][1]) out.push({ field: order[i][0], message: `${order[i][0].replace(/([A-Z])/g, ' $1').replace(/ At$| Date$/, '').toLowerCase()} is on or after ${order[i - 1][0].replace(/([A-Z])/g, ' $1').replace(/ At$| Date$/, '').toLowerCase()}` });
    if (m.openingAt && m.submissionAt && m.openingAt < m.submissionAt) out.push({ field: 'openingAt', message: 'The opening is at or after the submission deadline' });
    if (forSubmit) {
      for (const [k, label] of [['referenceNo', 'the tender reference'], ['submissionAt', 'the submission deadline']]) if (!m[k]) out.push({ field: k, message: `Give ${label} before sending the tender for registration` });
      if (!m.estCost) out.push({ field: 'estCost', message: 'Give the estimated cost' });
    }
    return out;
  }
  const checklistOf = (t) => {
    const rows = db.prepare('SELECT * FROM tdr_eligibility WHERE tender_id = ? AND deleted_at IS NULL ORDER BY seq').all(t.id);
    const done = rows.filter((r) => ['PASS', 'WAIVED'].includes(r.result)).length;
    return { rows: rows.map((e) => ({ id: e.id, seq: e.seq, criterion: e.criterion, criterionLabel: CRITERIA[e.criterion], title: e.title, requirementText: e.requirement_text, requirement: rupees(e.requirement_minor), our: rupees(e.our_minor), ourText: e.our_text, result: e.result, resultLabel: RESULTS[e.result], auto: e.result_mode === 'AUTO', waiveReason: e.waive_reason, notes: e.notes, rowVersion: e.version })), total: rows.length, passed: rows.filter((r) => r.result === 'PASS').length, waived: rows.filter((r) => r.result === 'WAIVED').length, failed: rows.filter((r) => r.result === 'FAIL').length, pending: rows.filter((r) => r.result === 'PENDING').length, complete: rows.length > 0 && done === rows.length };
  };
  const liveDecision = (tenderId) => db.prepare("SELECT * FROM tdr_bid_decisions WHERE tender_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED') ORDER BY id DESC LIMIT 1").get(tenderId);
  /** BR-01: what stands between the tender and the submission, one line each (blocking ones decide). */
  function readiness(t) {
    const d = liveDecision(t.id); const e = checklistOf(t);
    const addenda = db.prepare('SELECT COUNT(*) AS n FROM tdr_addenda WHERE tender_id = ? AND ack_at IS NULL AND deleted_at IS NULL').get(t.id).n;
    const queries = db.prepare("SELECT COUNT(*) AS n FROM tdr_queries WHERE tender_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(t.id).n;
    const tasks = db.prepare("SELECT COUNT(*) AS n FROM tdr_team_tasks WHERE tender_id = ? AND status = 'OPEN'").get(t.id).n;
    const items = [
      { code: 'REGISTERED', blocking: true, ok: t.status === 'APPROVED', text: t.status === 'APPROVED' ? 'The tender is registered' : 'The registration of the tender is not approved yet' },
      { code: 'DECISION', blocking: true, ok: Boolean(d && d.status === 'APPROVED' && d.decision === 'BID'), text: d?.status === 'APPROVED' ? (d.decision === 'BID' ? 'The decision to bid is approved' : 'The decision is not to bid') : 'The bid or no-bid decision is not approved yet' },
      { code: 'ELIGIBILITY', blocking: true, ok: e.complete, text: e.total === 0 ? 'The eligibility checklist is empty' : e.complete ? `Eligibility is complete (${e.passed} passed, ${e.waived} waived)` : `Eligibility is not complete (${e.pending} not assessed, ${e.failed} failed)` },
      { code: 'ADDENDA', blocking: true, ok: addenda === 0, text: addenda === 0 ? 'Every addendum has been read' : `${addenda} addendum(s) not acknowledged` },
      { code: 'DEADLINE', blocking: true, ok: Boolean(t.submission_at) && dayOf(t.submission_at) >= today(), text: t.submission_at ? (dayOf(t.submission_at) >= today() ? `Submission by ${t.submission_at.replace('T', ' ')}` : 'The submission deadline has passed') : 'No submission deadline' },
      { code: 'QUERIES', blocking: false, ok: queries === 0, text: queries === 0 ? 'No query is waiting for an answer' : `${queries} query(ies) wait for an answer` },
      { code: 'TASKS', blocking: false, ok: tasks === 0, text: tasks === 0 ? 'The team tasks are done' : `${tasks} team task(s) are open` },
    ];
    return { items, ready: items.filter((i) => i.blocking).every((i) => i.ok) };
  }
  const daysLeft = (t) => (t.submission_at ? daysBetween(today(), dayOf(t.submission_at)) : null);
  const tenderView = (actor, t, { detail = false } = {}) => {
    const c = clientRow(t.company_id, t.client_partner_id); const mine = maker(actor, t); const manage = may(actor, 'bd.tender.manage'); const live = t.status !== 'CANCELLED' && !['CLOSED', 'SUBMITTED', 'AWARDED', 'LOST'].includes(t.stage);
    const v = {
      id: t.id, docNo: t.doc_no, docDate: t.doc_date, status: t.status, statusLabel: TENDER_STATUS[t.status], stage: t.stage, stageLabel: TENDER_STAGES[t.stage], rowVersion: t.version, opportunityId: t.opportunity_id, clientPartnerId: t.client_partner_id, clientCode: c?.code ?? null, clientName: c?.legal_name ?? null,
      referenceNo: t.reference_no, portal: t.portal, portalLabel: PORTALS[t.portal], portalName: t.portal_name, nameOfWork: t.name_of_work, location: t.location, region: t.region, estCost: rupees(t.est_cost_minor), emd: rupees(t.emd_minor), tenderFee: rupees(t.tender_fee_minor), bidType: t.bid_type, bidTypeLabel: BID_TYPES[t.bid_type],
      periodMonths: t.period_months, publishDate: t.publish_date, prebidDate: t.prebid_date, submissionAt: t.submission_at, openingAt: t.opening_at, daysToSubmission: daysLeft(t), owner: t.owner, bcTurnover: rupees(t.bc_turnover_minor), bcCommitments: rupees(t.bc_commitments_minor), bcFactor: t.bc_factor,
      bidCapacity: rupees(t.bid_capacity_minor), capacity: json(t.capacity_json, null), amendmentNo: t.amendment_no, readyAt: t.ready_at, submittedOn: t.submitted_on, workflowInstanceId: t.workflow_instance_id, requestedBy: t.requested_by, createdBy: t.created_by,
      can: {
        edit: ['DRAFT', 'RETURNED'].includes(t.status) && mine && may(actor, 'bd.tender.edit'), submit: ['DRAFT', 'RETURNED'].includes(t.status) && mine && may(actor, 'bd.tender.submit'), delete: t.status === 'DRAFT' && mine && may(actor, 'bd.tender.delete'),
        withdraw: t.status === 'SUBMITTED' && same(t.requested_by, actor.user), cancel: live && ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'].includes(t.status) && (mine || manage) && may(actor, 'bd.tender.cancel'), amend: t.status === 'APPROVED' && ['OPEN', 'BID', 'NO_BID'].includes(t.stage) && (mine || manage) && may(actor, 'bd.tender.amend'),
        manage: manage && t.status === 'APPROVED' && live, ready: manage && t.status === 'APPROVED' && t.stage === 'BID' && may(actor, 'bd.tender.ready'), unready: manage && t.stage === 'READY', decide: t.status === 'APPROVED' && t.stage === 'OPEN' && may(actor, 'bd.bid_decision.create') && !liveDecision(t.id), print: may(actor, 'bd.tender.print'),
        track: manage && live && t.status === 'APPROVED',
      },
    };
    if (detail) {
      v.eligibility = checklistOf(t); v.readiness = readiness(t);
      const d = liveDecision(t.id); v.decision = d ? { id: d.id, docNo: d.doc_no, status: d.status, decision: d.decision, totalScore: d.total_score, recommendation: d.recommendation } : null;
      v.addenda = addenda.list(actor, t.id); v.queries = queries.list(actor, t.id); v.teamTasks = teamTasks.list(actor, t.id);
      v.dateLog = db.prepare('SELECT field, old_value AS oldValue, new_value AS newValue, reason, addendum_number AS addendumNumber, changed_by AS by, changed_at AS at FROM tdr_date_log WHERE tender_id = ? ORDER BY id').all(t.id);
      v.amendments = db.prepare("SELECT amendment_no AS no, snapshot_json, reason, amended_by AS by, amended_at AS at FROM tdr_amendments WHERE entity = 'TENDER' AND entity_id = ? ORDER BY amendment_no").all(t.id).map((a) => ({ no: a.no, reason: a.reason, by: a.by, at: a.at, before: json(a.snapshot_json, {}) }));
      v.related = [...(t.opportunity_id ? [{ type: 'Opportunity', id: t.opportunity_id, ref: db.prepare('SELECT doc_no FROM bd_opportunities WHERE id = ?').get(t.opportunity_id)?.doc_no, route: `/bd/opportunity?id=${t.opportunity_id}` }] : []), { type: 'Client', id: t.client_partner_id, ref: c ? `${c.code} ${c.legal_name}` : null, route: `/bd/client?id=${t.client_partner_id}` }];
    }
    return v;
  };
  function insertTender(actor, m, extra = {}) {
    const no = nextDoc(actor, TENDER_DOC, 'tdr_tenders', 'TDR');
    const id = Number(db.prepare("INSERT INTO tdr_tenders (company_id, doc_no, doc_date, opportunity_id, client_partner_id, reference_no, portal, portal_name, name_of_work, location, region, est_cost_minor, emd_minor, tender_fee_minor, bid_type, period_months, publish_date, prebid_date, submission_at, opening_at, owner, bc_turnover_minor, bc_commitments_minor, bc_factor, status, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)")
      .run(actor.companyId, no, today(), m.opportunityId ?? null, m.clientPartnerId, m.referenceNo ?? null, m.portal ?? 'OTHER', m.portalName ?? null, m.nameOfWork.trim(), m.location ?? null, m.region ?? null, toMinor(m.estCost ?? 0), toMinor(m.emd ?? 0), toMinor(m.tenderFee ?? 0), m.bidType ?? 'ITEM_RATE', m.periodMonths ?? 12, m.publishDate ?? null, m.prebidDate ?? null, m.submissionAt ?? null, m.openingAt ?? null, m.owner ?? actor.user,
        m.bcTurnover == null ? null : toMinor(m.bcTurnover), m.bcCommitments == null ? null : toMinor(m.bcCommitments), m.bcFactor ?? Number(param(actor.companyId, 'tdr.capacity_factor') ?? 2), actor.user, extra.sourceType ?? 'tdr_tender', extra.sourceId ?? null).lastInsertRowid);
    const list = param(actor.companyId, 'tdr.eligibility_checklist'); let seq = 0;
    for (const [criterion, title] of Array.isArray(list) ? list : []) { seq += 1; if (CRITERIA[criterion]) db.prepare('INSERT INTO tdr_eligibility (company_id, tender_id, seq, criterion, title, result_mode, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, \'tdr_tender\')').run(actor.companyId, id, seq, criterion, title, NUMERIC_CRITERIA.includes(criterion) ? 'AUTO' : 'MANUAL', actor.user); }
    const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(id); recompute(actor, t);
    writeAudit(db, { entity: 'tdr_tenders', entityId: id, action: 'create', newValues: { docNo: no, nameOfWork: m.nameOfWork, estCost: m.estCost ?? 0 }, actor: actor.user, companyId: actor.companyId });
    event('bd.tender.created', actor, 'tdr_tender', id, actor.companyId, { docNo: no, clientPartnerId: m.clientPartnerId, opportunityId: m.opportunityId ?? null, estCost: m.estCost ?? 0 });
    return id;
  }
  const tenders = {
    list(actor, query) { need(actor, 'bd.tender.view', 'see tenders'); return runList(db, tenderList, parseListRequest(tenderList, query), { select: 't.*', scopeSql: SCOPE_T(seesAll(actor)), params: params(actor), tieBreaker: 't.id', map: (t) => tenderView(actor, t) }); },
    exportSource(actor, req) {
      need(actor, 'bd.tender.export', 'export tenders');
      const opts = { select: 't.*', scopeSql: SCOPE_T(seesAll(actor)), params: params(actor), tieBreaker: 't.id' };
      return { title: tenderList.label, permission: 'bd.tender.export', personal: false, columns: Object.entries(tenderList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, tenderList, req, opts),
        rows: () => runList(db, tenderList, req, { ...opts, limit: null, map: (t) => { const v = tenderView(actor, t); return { docNo: v.docNo, reference: v.referenceNo, client: v.clientName, nameOfWork: v.nameOfWork, portal: v.portalLabel, bidType: v.bidTypeLabel, estCost: v.estCost, emd: v.emd, submission: v.submissionAt?.slice(0, 10), owner: v.owner, stage: v.stageLabel, status: v.statusLabel }; } }).data,
        describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${tenderList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { need(actor, 'bd.tender.view', 'see tenders'); return tenderView(actor, tenderRow(actor, id), { detail: true }); },
    create(actor, b) {
      need(actor, 'bd.tender.create', 'register tenders');
      const problems = problemsOf(actor, { ...b, owner: b.owner ?? actor.user });
      let opp = null;
      if (b.opportunityId) {
        opp = db.prepare('SELECT * FROM bd_opportunities WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.opportunityId, actor.companyId);
        if (!opp || (!seesAll(actor) && !maker(actor, opp))) throw notFound('That opportunity does not exist or is not yours to see.');
        if (opp.status !== 'APPROVED') problems.push({ field: 'opportunityId', message: 'The opportunity needs the go-ahead for tendering first' });
        else if (db.prepare("SELECT 1 FROM tdr_tenders WHERE opportunity_id = ? AND deleted_at IS NULL AND status <> 'CANCELLED'").get(opp.id)) problems.push({ field: 'opportunityId', message: 'A tender is registered for this opportunity already' });
        if (opp.client_partner_id !== b.clientPartnerId) problems.push({ field: 'clientPartnerId', message: 'The authority is the client of the opportunity' });
      }
      if (b.referenceNo && db.prepare("SELECT 1 FROM tdr_tenders WHERE company_id = ? AND client_partner_id = ? AND lower(reference_no) = lower(?) AND status <> 'CANCELLED' AND deleted_at IS NULL").get(actor.companyId, b.clientPartnerId, b.referenceNo)) problems.push({ field: 'referenceNo', message: 'This authority has a tender with that reference already' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const id = insertTender(actor, b, opp ? { sourceType: 'bd_opportunity', sourceId: String(opp.id) } : {});
        if (opp?.converted_at && !opp.tender_ref) crmOf(db).opportunities.linkTender(kit.systemActor(actor.companyId), opp.id, db.prepare('SELECT doc_no FROM tdr_tenders WHERE id = ?').get(id).doc_no);
        return b.submit ? tenders.submit(actor, id, {}) : tenders.get(actor, id);
      });
    },
    /** 08.01: an opportunity converted to a tender makes the draft of the tender in the same transaction (the hook below). */
    createFromOpportunity(actor, opp) {
      const id = insertTender(actor, { opportunityId: opp.id, clientPartnerId: opp.client_partner_id, nameOfWork: opp.name, location: opp.location, region: opp.region, estCost: rupees(opp.est_value_minor), owner: opp.owner, portal: 'OTHER', bidType: 'ITEM_RATE', periodMonths: 12 }, { sourceType: 'bd_opportunity', sourceId: String(opp.id) });
      const no = db.prepare('SELECT doc_no FROM tdr_tenders WHERE id = ?').get(id).doc_no;
      crmOf(db).opportunities.linkTender(kit.systemActor(actor.companyId), opp.id, no);
      return id;
    },
    update(actor, id, b) {
      const t = tenderRow(actor, id); need(actor, 'bd.tender.edit', 'change tenders');
      if (!['DRAFT', 'RETURNED'].includes(t.status)) throw conflict(`A tender that is ${TENDER_STATUS[t.status].toLowerCase()} is not changed; a registered one is amended.`);
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by} or ${t.owner} changes this tender.`);
      if (t.version !== b.version) throw conflict('This tender was changed by someone else. Reload it and try again.');
      return save(actor, t, b, 'update');
    },
    remove(actor, id) {
      const t = tenderRow(actor, id); need(actor, 'bd.tender.delete', 'delete tenders');
      if (t.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by} or ${t.owner} deletes this draft.`);
      db.prepare('UPDATE tdr_tenders SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, t.id);
      writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: t.id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const t = tenderRow(actor, id); need(actor, 'bd.tender.submit', 'send tenders for registration');
      if (!['DRAFT', 'RETURNED'].includes(t.status)) throw conflict(`This tender is ${TENDER_STATUS[t.status].toLowerCase()}.`);
      if (!maker(actor, t)) throw forbidden(`Only ${t.created_by} or ${t.owner} sends this tender.`);
      const problems = problemsOf(actor, fieldsOf(t), { forSubmit: true }); if (problems.length) throw badRequest('The tender cannot be sent yet.', problems);
      return transaction(db, () => {
        const ctx = { valueMinor: t.est_cost_minor };
        if (t.status === 'RETURNED') workflowOf(db).resubmit(actor, t.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: TENDER_DOC, docId: wfDoc(t.id, t.amendment_no), amendsDocId: t.amendment_no ? wfDoc(t.id, t.amendment_no - 1) : null, comment: comment ?? 'Registration of the tender', context: ctx }); db.prepare('UPDATE tdr_tenders SET workflow_instance_id = ? WHERE id = ?').run(inst.id, t.id); }
        db.prepare("UPDATE tdr_tenders SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), t.id);
        writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return tenders.get(actor, t.id);
      });
    },
    withdraw(actor, id, { reason }) {
      const t = tenderRow(actor, id);
      if (t.status !== 'SUBMITTED') throw unprocessable('Only a tender in approval is withdrawn.');
      if (!same(t.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, t.workflow_instance_id, { comment: reason });
      return tenders.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      const t = tenderRow(actor, id); need(actor, 'bd.tender.cancel', 'cancel tenders');
      if (!tenderView(actor, t).can.cancel) throw unprocessable('This tender cannot be cancelled now (it is submitted, awarded or closed).');
      return transaction(db, () => {
        if (t.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, t.workflow_instance_id, actor.user, 'CANCELLED', reason);
        db.prepare("UPDATE tdr_tenders SET status = 'CANCELLED', stage = 'CLOSED', updated_by = ?, updated_at = ?, version = version + 1, remarks = ? WHERE id = ?").run(actor.user, nowIso(), reason, t.id);
        for (const x of db.prepare("SELECT * FROM tdr_team_tasks WHERE tender_id = ? AND status = 'OPEN'").all(t.id)) cancelTask(actor, x);
        writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        event('bd.tender.cancelled', actor, 'tdr_tender', t.id, t.company_id, { docNo: t.doc_no, reason });
        return tenders.get(actor, t.id);
      });
    },
    amend(actor, id, b) {
      const t = tenderRow(actor, id); need(actor, 'bd.tender.amend', 'amend tenders');
      if (!tenderView(actor, t).can.amend) throw unprocessable('Only a registered tender that is not yet ready for submission is amended.');
      if (t.version !== b.version) throw conflict('This tender was changed by someone else. Reload it and try again.');
      return transaction(db, () => {
        db.prepare("INSERT INTO tdr_amendments (company_id, entity, entity_id, amendment_no, snapshot_json, reason, amended_by, created_by) VALUES (?, 'TENDER', ?, ?, ?, ?, ?, ?)").run(t.company_id, t.id, t.amendment_no + 1, JSON.stringify({ ...fieldsOf(t), stage: t.stage }), b.reason, actor.user, actor.user);
        db.prepare("UPDATE tdr_tenders SET status = 'DRAFT', amendment_no = amendment_no + 1, workflow_instance_id = NULL, requested_by = NULL WHERE id = ?").run(t.id);
        const { reason, ...fields } = b;
        const out = save(actor, db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(t.id), { ...fields, version: undefined }, 'amend', reason);
        event('bd.tender.amended', actor, 'tdr_tender', t.id, t.company_id, { docNo: t.doc_no, amendmentNo: t.amendment_no + 1 });
        return out;
      });
    },
    /** The owner and the capacity inputs of a registered tender change without an amendment. */
    track(actor, id, b) {
      const t = tenderRow(actor, id); need(actor, 'bd.tender.manage', 'manage tenders');
      if (!tenderView(actor, t).can.track) throw unprocessable('This tender is not managed now.');
      if (t.version !== b.version) throw conflict('This tender was changed by someone else. Reload it and try again.');
      if (b.owner && !kit.userExists(actor.companyId, b.owner)) throw badRequest('Some fields are not valid.', [{ field: 'owner', message: 'The owner is not an active user of this company' }]);
      const m = { owner: b.owner ?? t.owner, bc_turnover_minor: b.bcTurnover === undefined ? t.bc_turnover_minor : b.bcTurnover === null ? null : toMinor(b.bcTurnover), bc_commitments_minor: b.bcCommitments === undefined ? t.bc_commitments_minor : b.bcCommitments === null ? null : toMinor(b.bcCommitments), bc_factor: b.bcFactor ?? t.bc_factor };
      return transaction(db, () => {
        db.prepare('UPDATE tdr_tenders SET owner = ?, bc_turnover_minor = ?, bc_commitments_minor = ?, bc_factor = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.owner, m.bc_turnover_minor, m.bc_commitments_minor, m.bc_factor, actor.user, nowIso(), t.id);
        recompute(actor, db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(t.id));
        writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'track', oldValues: { owner: t.owner, capacity: rupees(t.bid_capacity_minor) }, newValues: { owner: m.owner }, actor: actor.user, companyId: actor.companyId });
        return tenders.get(actor, t.id);
      });
    },
    capacity(actor, id) { const t = tenderRow(actor, id); need(actor, 'bd.tender.manage', 'work out the bid capacity'); recompute(actor, t); return tenders.get(actor, id); },
    /** BR-01: ready for submission only when the registration and the bid decision are approved, the eligibility is complete and every addendum is read. The hand-off to estimation (09.01) and submission (08.03) is the event. */
    markReady(actor, id) {
      const t = tenderRow(actor, id); need(actor, 'bd.tender.ready', 'mark tenders ready for submission');
      if (t.status !== 'APPROVED' || !['OPEN', 'BID'].includes(t.stage)) throw unprocessable(t.stage === 'READY' ? 'The tender is ready already.' : 'This tender cannot be made ready now.');
      const r = readiness(t);
      if (!r.ready) throw new HttpError(422, 'NOT_READY', `The tender is not ready for submission: ${r.items.filter((i) => i.blocking && !i.ok).map((i) => i.text).join('; ')}.`);
      return transaction(db, () => {
        db.prepare("UPDATE tdr_tenders SET stage = 'READY', ready_at = ?, ready_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, actor.user, nowIso(), t.id);
        writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'ready', actor: actor.user, companyId: actor.companyId });
        event('bd.tender.ready', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, opportunityId: t.opportunity_id, clientPartnerId: t.client_partner_id, nameOfWork: t.name_of_work, estCost: rupees(t.est_cost_minor), emd: rupees(t.emd_minor), tenderFee: rupees(t.tender_fee_minor), bidType: t.bid_type, periodMonths: t.period_months, submissionAt: t.submission_at, openingAt: t.opening_at, region: t.region, bidCapacity: rupees(t.bid_capacity_minor) });
        return tenders.get(actor, t.id);
      });
    },
    unready(actor, id, { reason }) {
      const t = tenderRow(actor, id); need(actor, 'bd.tender.ready', 'take tenders back from ready');
      if (t.stage !== 'READY') throw unprocessable('The tender is not marked ready.');
      db.prepare("UPDATE tdr_tenders SET stage = 'BID', ready_at = NULL, ready_by = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), t.id);
      writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'unready', reason, actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
    /** 08.03 submits the bid and tells the register. */
    markSubmitted(actor, id, { submittedOn } = /** @type {any} */ ({})) {
      const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
      if (!t || t.stage !== 'READY') throw unprocessable('Only a tender that is ready for submission is submitted.');
      db.prepare("UPDATE tdr_tenders SET stage = 'SUBMITTED', submitted_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(submittedOn ?? today(), actor.user, nowIso(), t.id);
      writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'submitted', actor: actor.user, companyId: actor.companyId });
      event('bd.tender.submitted', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, submittedOn: submittedOn ?? today() });
      return { id: t.id, stage: 'SUBMITTED' };
    },
    history(actor, id) {
      const t = tenderRow(actor, id);
      return { approvals: t.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(t.workflow_instance_id) : [], dateLog: db.prepare('SELECT field, old_value AS oldValue, new_value AS newValue, reason, changed_by AS by, changed_at AS at FROM tdr_date_log WHERE tender_id = ? ORDER BY id').all(t.id), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('tdr_tenders', 'tdr_eligibility', 'tdr_addenda', 'tdr_queries', 'tdr_team_tasks') AND (entity_id = ? OR entity_id IN (SELECT CAST(id AS TEXT) FROM tdr_eligibility WHERE tender_id = ? UNION SELECT CAST(id AS TEXT) FROM tdr_addenda WHERE tender_id = ? UNION SELECT CAST(id AS TEXT) FROM tdr_queries WHERE tender_id = ? UNION SELECT CAST(id AS TEXT) FROM tdr_team_tasks WHERE tender_id = ?)) ORDER BY id").all(String(t.id), t.id, t.id, t.id, t.id) };
    },
    print(actor, id) {
      need(actor, 'bd.tender.print', 'print tenders'); const v = tenderView(actor, tenderRow(actor, id), { detail: true });
      writeAudit(db, { entity: 'tdr_tenders', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const n = (x) => (x == null ? '' : esc(Number(x).toLocaleString('en-IN')));
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>Tender ${esc(v.docNo)}</h1><p>${esc(v.nameOfWork)} · ${esc(v.stageLabel)}</p><table><tr><th>Authority</th><td>${esc(v.clientName)}</td><th>Reference</th><td>${esc(v.referenceNo)} (${esc(v.portalLabel)})</td></tr><tr><th>Estimated cost</th><td>₹ ${n(v.estCost)}</td><th>EMD / fee</th><td>₹ ${n(v.emd)} / ₹ ${n(v.tenderFee)}</td></tr><tr><th>Bid type</th><td>${esc(v.bidTypeLabel)}</td><th>Period</th><td>${v.periodMonths} months</td></tr><tr><th>Pre-bid</th><td>${esc(v.prebidDate ?? '')}</td><th>Submission</th><td>${esc(v.submissionAt ?? '')}</td></tr><tr><th>Opening</th><td>${esc(v.openingAt ?? '')}</td><th>Bid capacity</th><td>₹ ${n(v.bidCapacity)}</td></tr></table><h2>Eligibility</h2><table><tr><th>Criterion</th><th>Requirement</th><th>Ours</th><th>Result</th></tr>${v.eligibility.rows.map((e) => `<tr><td>${esc(e.title)}</td><td>${e.requirement != null ? `₹ ${n(e.requirement)}` : esc(e.requirementText ?? '')}</td><td>${e.our != null ? `₹ ${n(e.our)}` : esc(e.ourText ?? '')}</td><td>${esc(e.resultLabel)}</td></tr>`).join('')}</table></body></html>`;
    },
  };
  /** One place writes the fields of a tender (update and amendment), and the dates that move are logged. */
  function save(actor, t, b, action, reason = null) {
    const cur = fieldsOf(t); /** @type {any} */ const m = { ...cur, ...defined(b) }; delete m.version; delete m.submit; delete m.comment; delete m.opportunityId;
    m.opportunityId = t.opportunity_id;
    const problems = problemsOf(actor, m); if (m.referenceNo && db.prepare("SELECT 1 FROM tdr_tenders WHERE company_id = ? AND client_partner_id = ? AND lower(reference_no) = lower(?) AND id <> ? AND status <> 'CANCELLED' AND deleted_at IS NULL").get(actor.companyId, m.clientPartnerId, m.referenceNo, t.id)) problems.push({ field: 'referenceNo', message: 'This authority has a tender with that reference already' });
    if (problems.length) throw badRequest('Some fields are not valid.', problems);
    db.prepare('UPDATE tdr_tenders SET client_partner_id = ?, reference_no = ?, portal = ?, portal_name = ?, name_of_work = ?, location = ?, region = ?, est_cost_minor = ?, emd_minor = ?, tender_fee_minor = ?, bid_type = ?, period_months = ?, publish_date = ?, prebid_date = ?, submission_at = ?, opening_at = ?, owner = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(m.clientPartnerId, m.referenceNo ?? null, m.portal, m.portalName ?? null, m.nameOfWork.trim(), m.location ?? null, m.region ?? null, toMinor(m.estCost ?? 0), toMinor(m.emd ?? 0), toMinor(m.tenderFee ?? 0), m.bidType, m.periodMonths, m.publishDate ?? null, m.prebidDate ?? null, m.submissionAt ?? null, m.openingAt ?? null, m.owner, actor.user, nowIso(), t.id);
    for (const [k, col] of [['publishDate', 'publish_date'], ['prebidDate', 'prebid_date'], ['submissionAt', 'submission_at'], ['openingAt', 'opening_at']]) if ((m[k] ?? null) !== (t[col] ?? null)) logDate(actor, t, col, t[col], m[k] ?? null, reason ?? action);
    recompute(actor, db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(t.id));
    writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action, reason, oldValues: { nameOfWork: cur.nameOfWork, estCost: cur.estCost, submissionAt: cur.submissionAt }, newValues: { nameOfWork: m.nameOfWork, estCost: m.estCost, submissionAt: m.submissionAt }, actor: actor.user, companyId: actor.companyId });
    return tenders.get(actor, t.id);
  }
  function logDate(actor, t, field, from, to, reason, addendumNumber = null) {
    db.prepare('INSERT INTO tdr_date_log (company_id, tender_id, field, old_value, new_value, reason, addendum_number, changed_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, \'tdr_tender\')').run(t.company_id, t.id, field, from, to, reason ?? null, addendumNumber, actor.user, actor.user);
  }
  /** A registered tender in preparation is worked on; a tender that is ready is changed after taking it back (unready), except for what the authority sends (addenda, answers). */
  const editable = (actor, t, what, { ready = false } = {}) => {
    need(actor, 'bd.tender.manage', what);
    if (t.status !== 'APPROVED') throw unprocessable('The registration of the tender must be approved first.');
    if (!(ready ? LIVE_STAGES : ['OPEN', 'BID']).includes(t.stage)) throw unprocessable(t.stage === 'READY' ? 'The tender is ready for submission: take it back from ready before changing it.' : `A tender that is ${TENDER_STAGES[t.stage].toLowerCase()} is not changed.`);
  };

  // ------------------------------------------------------------------ eligibility (FR-02)
  const eligibility = {
    add(actor, tenderId, b) {
      const t = tenderRow(actor, tenderId); editable(actor, t, 'keep the eligibility checklist');
      const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM tdr_eligibility WHERE tender_id = ?').get(t.id).n) + 1;
      const auto = NUMERIC_CRITERIA.includes(b.criterion) ? 'AUTO' : 'MANUAL';
      const id = Number(db.prepare('INSERT INTO tdr_eligibility (company_id, tender_id, seq, criterion, title, requirement_text, requirement_minor, our_minor, our_text, result_mode, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'tdr_tender\')')
        .run(actor.companyId, t.id, seq, b.criterion, b.title.trim(), b.requirementText ?? null, b.requirement == null ? null : toMinor(b.requirement), b.our == null ? null : toMinor(b.our), b.ourText ?? null, auto, b.notes ?? null, actor.user).lastInsertRowid);
      recompute(actor, t); writeAudit(db, { entity: 'tdr_eligibility', entityId: id, action: 'create', newValues: { criterion: b.criterion, title: b.title }, actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
    update(actor, id, b) {
      const e = db.prepare('SELECT * FROM tdr_eligibility WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!e) throw notFound('That eligibility row does not exist.');
      const t = tenderRow(actor, e.tender_id); editable(actor, t, 'keep the eligibility checklist');
      if (e.version !== b.version) throw conflict('This row was changed by someone else. Reload it and try again.');
      const numeric = NUMERIC_CRITERIA.includes(e.criterion); const problems = [];
      if (b.result === 'WAIVED' && !String(b.waiveReason ?? e.waive_reason ?? '').trim()) problems.push({ field: 'waiveReason', message: 'Say why the criterion is waived (for example: met through the joint venture partner)' });
      if (numeric && b.result && !['WAIVED', 'PENDING'].includes(b.result)) problems.push({ field: 'result', message: 'The result of a figure against a figure is worked out from the figures; waive it with a reason, or give the figures' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      let mode = e.result_mode; let result = e.result; let waive = e.waive_reason;
      if (b.result === 'WAIVED') { mode = 'MANUAL'; result = 'WAIVED'; waive = b.waiveReason ?? e.waive_reason; }
      else if (b.result) { waive = null; if (numeric) { mode = 'AUTO'; result = 'PENDING'; } else { mode = 'MANUAL'; result = b.result; } }
      const m = { requirement_text: b.requirementText === undefined ? e.requirement_text : b.requirementText, requirement_minor: b.requirement === undefined ? e.requirement_minor : b.requirement === null ? null : toMinor(b.requirement), our_minor: b.our === undefined ? e.our_minor : b.our === null ? null : toMinor(b.our), our_text: b.ourText === undefined ? e.our_text : b.ourText, notes: b.notes === undefined ? e.notes : b.notes, title: b.title ?? e.title };
      db.prepare('UPDATE tdr_eligibility SET title = ?, requirement_text = ?, requirement_minor = ?, our_minor = ?, our_text = ?, notes = ?, result = ?, waive_reason = ?, result_mode = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(m.title, m.requirement_text, m.requirement_minor, m.our_minor, m.our_text, m.notes, result, waive, mode, actor.user, nowIso(), e.id);
      recompute(actor, t); writeAudit(db, { entity: 'tdr_eligibility', entityId: e.id, action: 'update', oldValues: { result: e.result }, newValues: { result: b.result ?? 'computed' }, actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
    remove(actor, id) {
      const e = db.prepare('SELECT * FROM tdr_eligibility WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!e) throw notFound('That eligibility row does not exist.');
      const t = tenderRow(actor, e.tender_id); editable(actor, t, 'keep the eligibility checklist');
      db.prepare('UPDATE tdr_eligibility SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, e.id);
      writeAudit(db, { entity: 'tdr_eligibility', entityId: e.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
  };

  // ------------------------------------------------------------------ addenda (FR-04)
  const addendumView = (actor, a) => ({ id: a.id, number: a.number, kind: a.kind, date: a.addendum_date, summary: a.summary, impact: a.impact, impactLabel: IMPACTS[a.impact], impactNote: a.impact_note, newPrebidDate: a.new_prebid_date, newSubmissionAt: a.new_submission_at, newOpeningAt: a.new_opening_at, acknowledged: Boolean(a.ack_at), ackBy: a.ack_by, ackAt: a.ack_at, createdBy: a.created_by });
  const addenda = {
    list(actor, tenderId) { return db.prepare('SELECT * FROM tdr_addenda WHERE tender_id = ? AND company_id = ? AND deleted_at IS NULL ORDER BY number').all(tenderId, actor.companyId).map((a) => addendumView(actor, a)); },
    add(actor, tenderId, b) {
      const t = tenderRow(actor, tenderId); need(actor, 'bd.tender.manage', 'record addenda');
      if (t.status !== 'APPROVED' || t.stage === 'CLOSED') throw unprocessable('Addenda are recorded on a registered tender that is not closed.');
      const m = { prebidDate: b.newPrebidDate ?? t.prebid_date, submissionAt: b.newSubmissionAt ?? t.submission_at, openingAt: b.newOpeningAt ?? t.opening_at, publishDate: t.publish_date, clientPartnerId: t.client_partner_id, owner: t.owner };
      const problems = problemsOf(actor, m).filter((p) => p.field !== 'clientPartnerId' || false);
      if ((b.newPrebidDate || b.newSubmissionAt || b.newOpeningAt) && b.impact !== 'DATES') problems.push({ field: 'impact', message: 'An addendum that moves a date has the impact Dates' });
      if (b.impact !== 'NONE' && !String(b.impactNote ?? '').trim()) problems.push({ field: 'impactNote', message: 'Say what the addendum changes for the bid' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const number = (db.prepare('SELECT COALESCE(MAX(number), 0) AS n FROM tdr_addenda WHERE tender_id = ?').get(t.id).n) + 1;
        const id = Number(db.prepare('INSERT INTO tdr_addenda (company_id, tender_id, number, kind, addendum_date, summary, impact, impact_note, new_prebid_date, new_submission_at, new_opening_at, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'tdr_tender\')')
          .run(actor.companyId, t.id, number, b.kind, b.date, b.summary.trim(), b.impact, b.impactNote ?? null, b.newPrebidDate ?? null, b.newSubmissionAt ?? null, b.newOpeningAt ?? null, actor.user).lastInsertRowid);
        const set = [];
        for (const [col, val] of [['prebid_date', b.newPrebidDate], ['submission_at', b.newSubmissionAt], ['opening_at', b.newOpeningAt]]) if (val && val !== t[col]) { logDate(actor, t, col, t[col], val, `${b.kind === 'CORRIGENDUM' ? 'Corrigendum' : 'Addendum'} ${number}`, number); set.push([col, val]); }
        for (const [col, val] of set) db.prepare(`UPDATE tdr_tenders SET ${col} = ? WHERE id = ?`).run(val, t.id);
        const back = t.stage === 'READY';
        db.prepare(`UPDATE tdr_tenders SET ${back ? "stage = 'BID', ready_at = NULL, ready_by = NULL, " : ''}updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, nowIso(), t.id);
        writeAudit(db, { entity: 'tdr_addenda', entityId: id, action: 'create', newValues: { tender: t.doc_no, number, impact: b.impact }, actor: actor.user, companyId: actor.companyId });
        event('bd.tender.addendum_issued', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, number, kind: b.kind, impact: b.impact, newSubmissionAt: b.newSubmissionAt ?? null, backToPreparation: back });
        const to = new Set([t.owner, ...db.prepare("SELECT assignee FROM tdr_team_tasks WHERE tender_id = ? AND status = 'OPEN'").all(t.id).map((x) => x.assignee)]);
        for (const u of to) if (!same(u, actor.user)) tell(t.company_id, u, 'bd.tender.reminder', { ref: t.doc_no, title: t.name_of_work, what: `${b.kind === 'CORRIGENDUM' ? 'corrigendum' : 'addendum'} ${number} issued`, when: b.impact === 'DATES' ? '(dates changed)' : '' }, `/bd/tender?id=${t.id}`, `add:${id}:${u}`);
        return tenders.get(actor, t.id);
      });
    },
    ack(actor, id) {
      const a = db.prepare('SELECT * FROM tdr_addenda WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!a) throw notFound('That addendum does not exist.');
      const t = tenderRow(actor, a.tender_id); editable(actor, t, 'acknowledge addenda', { ready: true });
      if (a.ack_at) throw unprocessable('This addendum is acknowledged already.');
      db.prepare('UPDATE tdr_addenda SET ack_by = ?, ack_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, nowIso(), actor.user, nowIso(), a.id);
      writeAudit(db, { entity: 'tdr_addenda', entityId: a.id, action: 'acknowledge', actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
  };

  // ------------------------------------------------------------------ pre-bid queries and clarifications (FR-05)
  const queryView = (q) => ({ id: q.id, seq: q.seq, clauseRef: q.clause_ref, query: q.query_text, addendumNumber: q.addendum_number, status: q.status, statusLabel: QUERY_STATUS[q.status], submittedOn: q.submitted_on, response: q.response, responseDate: q.response_date, raisedBy: q.raised_by, rowVersion: q.version });
  const queries = {
    list(actor, tenderId) { return db.prepare('SELECT * FROM tdr_queries WHERE tender_id = ? AND company_id = ? AND deleted_at IS NULL ORDER BY seq').all(tenderId, actor.companyId).map(queryView); },
    add(actor, tenderId, b) {
      const t = tenderRow(actor, tenderId); editable(actor, t, 'raise pre-bid queries');
      if (b.addendumNumber && !db.prepare('SELECT 1 FROM tdr_addenda WHERE tender_id = ? AND number = ?').get(t.id, b.addendumNumber)) throw badRequest('Some fields are not valid.', [{ field: 'addendumNumber', message: 'That addendum does not exist on this tender' }]);
      const seq = (db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM tdr_queries WHERE tender_id = ?').get(t.id).n) + 1;
      const id = Number(db.prepare('INSERT INTO tdr_queries (company_id, tender_id, seq, clause_ref, query_text, addendum_number, raised_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'tdr_tender\')').run(actor.companyId, t.id, seq, b.clauseRef ?? null, b.query.trim(), b.addendumNumber ?? null, actor.user, actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'tdr_queries', entityId: id, action: 'create', newValues: { tender: t.doc_no, clause: b.clauseRef ?? null }, actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
    update(actor, id, b) {
      const q = qRow(actor, id); const t = tenderRow(actor, q.tender_id); editable(actor, t, 'change pre-bid queries');
      if (q.status !== 'DRAFT') throw conflict('A query that was sent is not changed; record the response instead.');
      if (q.version !== b.version) throw conflict('This query was changed by someone else. Reload it and try again.');
      db.prepare('UPDATE tdr_queries SET clause_ref = ?, query_text = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.clauseRef === undefined ? q.clause_ref : b.clauseRef, (b.query ?? q.query_text).trim(), actor.user, nowIso(), q.id);
      return tenders.get(actor, t.id);
    },
    send(actor, id) {
      const q = qRow(actor, id); const t = tenderRow(actor, q.tender_id); editable(actor, t, 'send pre-bid queries');
      if (q.status !== 'DRAFT') throw unprocessable('This query was sent already.');
      if (t.prebid_date && today() > t.prebid_date) throw unprocessable(`The last day for queries was the pre-bid date, ${t.prebid_date}.`);
      db.prepare("UPDATE tdr_queries SET status = 'SUBMITTED', submitted_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(today(), actor.user, nowIso(), q.id);
      writeAudit(db, { entity: 'tdr_queries', entityId: q.id, action: 'send', actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
    respond(actor, id, b) {
      const q = qRow(actor, id); const t = tenderRow(actor, q.tender_id); editable(actor, t, 'record clarifications', { ready: true });
      if (!['SUBMITTED', 'ANSWERED'].includes(q.status)) throw unprocessable('Send the query before recording the response.');
      if (b.date < q.submitted_on) throw badRequest('Some fields are not valid.', [{ field: 'date', message: 'The response is on or after the day the query was sent' }]);
      db.prepare("UPDATE tdr_queries SET status = 'ANSWERED', response = ?, response_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.response.trim(), b.date, actor.user, nowIso(), q.id);
      writeAudit(db, { entity: 'tdr_queries', entityId: q.id, action: 'respond', actor: actor.user, companyId: actor.companyId });
      event('bd.tender.query_answered', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, clauseRef: q.clause_ref });
      return tenders.get(actor, t.id);
    },
    noResponse(actor, id) {
      const q = qRow(actor, id); const t = tenderRow(actor, q.tender_id); editable(actor, t, 'record clarifications', { ready: true });
      if (q.status !== 'SUBMITTED') throw unprocessable('Only a query that was sent and not answered is closed without a response.');
      db.prepare("UPDATE tdr_queries SET status = 'NO_RESPONSE', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), q.id);
      return tenders.get(actor, t.id);
    },
  };
  const qRow = (actor, id) => { const q = db.prepare('SELECT * FROM tdr_queries WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!q) throw notFound('That query does not exist.'); return q; };

  // ------------------------------------------------------------------ the tender team (FR-06)
  const taskView = (x) => ({ id: x.id, kind: x.kind, kindLabel: TEAM_KINDS[x.kind], title: x.title, assignee: x.assignee, dueDate: x.due_date, status: x.status, statusLabel: TASK_STATUS[x.status], taskId: x.task_id, doneAt: x.done_at, notes: x.notes, overdue: x.status === 'OPEN' && x.due_date < today() });
  function cancelTask(actor, x) {
    db.prepare("UPDATE tdr_team_tasks SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), x.id);
    if (x.task_id) { try { tasksOf(db).act(actor, x.task_id, 'cancel', { reason: 'The tender task was cancelled' }); } catch { /* a task closed elsewhere stays as it is */ } }
  }
  const tRow = (actor, id) => { const x = db.prepare('SELECT * FROM tdr_team_tasks WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!x) throw notFound('That task does not exist.'); return x; };
  const teamTasks = {
    list(actor, tenderId) { return db.prepare('SELECT * FROM tdr_team_tasks WHERE tender_id = ? AND company_id = ? AND deleted_at IS NULL ORDER BY due_date, id').all(tenderId, actor.companyId).map(taskView); },
    add(actor, tenderId, b) {
      const t = tenderRow(actor, tenderId); editable(actor, t, 'give tender team tasks');
      const problems = [];
      if (!kit.userExists(actor.companyId, b.assignee)) problems.push({ field: 'assignee', message: 'The assignee is not an active user of this company' });
      if (t.submission_at && b.dueDate > dayOf(t.submission_at)) problems.push({ field: 'dueDate', message: `A task is due on or before the submission, ${dayOf(t.submission_at)}` });
      if (b.dueDate < today()) problems.push({ field: 'dueDate', message: 'The due date is not in the past' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const id = Number(db.prepare('INSERT INTO tdr_team_tasks (company_id, tender_id, kind, title, assignee, due_date, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \'tdr_tender\')').run(actor.companyId, t.id, b.kind, b.title.trim(), b.assignee, b.dueDate, b.notes ?? null, actor.user).lastInsertRowid);
        try { const task = tasksOf(db).create({ companyId: actor.companyId, title: `${t.doc_no}: ${b.title.trim()}`.slice(0, 160), description: `${TEAM_KINDS[b.kind]} for the tender ${t.doc_no} (${t.name_of_work}), submission ${t.submission_at ?? 'date not set'}.`, assignees: [b.assignee], dueDate: b.dueDate, entity: 'tdr_team_task', entityId: id, entityLabel: t.doc_no, origin: 'auto', source: { type: 'tdr_team_task', id }, actor: actor.user }); db.prepare('UPDATE tdr_team_tasks SET task_id = ? WHERE id = ?').run(task?.id ?? null, id); } catch { /* the task stays on the tender and in the reminders */ }
        writeAudit(db, { entity: 'tdr_team_tasks', entityId: id, action: 'create', newValues: { tender: t.doc_no, kind: b.kind, assignee: b.assignee, dueDate: b.dueDate }, actor: actor.user, companyId: actor.companyId });
        return tenders.get(actor, t.id);
      });
    },
    done(actor, id) {
      const x = tRow(actor, id); const t = tenderRow(actor, x.tender_id);
      if (x.status !== 'OPEN') throw unprocessable('This task is not open.');
      if (!(same(x.assignee, actor.user) || may(actor, 'bd.tender.manage'))) throw forbidden('Only the person the task is given to, or the tender manager, marks it done.');
      db.prepare("UPDATE tdr_team_tasks SET status = 'DONE', done_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(nowIso(), actor.user, nowIso(), x.id);
      if (x.task_id) { try { tasksOf(db).act(actor, x.task_id, 'complete', { reason: 'Done on the tender' }); } catch { /* the task is closed elsewhere */ } }
      writeAudit(db, { entity: 'tdr_team_tasks', entityId: x.id, action: 'done', actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
    cancel(actor, id) {
      const x = tRow(actor, id); const t = tenderRow(actor, x.tender_id); editable(actor, t, 'cancel tender team tasks');
      if (x.status !== 'OPEN') throw unprocessable('This task is not open.');
      cancelTask(actor, x); writeAudit(db, { entity: 'tdr_team_tasks', entityId: x.id, action: 'cancel', actor: actor.user, companyId: actor.companyId });
      return tenders.get(actor, t.id);
    },
  };

  // ------------------------------------------------------------------ tender documents (FR-04): the document service (04.10), linked to the tender
  const documents = {
    list(actor, tenderId) {
      const t = tenderRow(actor, tenderId); const svc = documentsOf(db); if (!svc) return { available: false, rows: [] };
      const r = svc.documents.list(actor, { linkEntity: 'tdr_tender', linkId: t.id, limit: 100, offset: 0 });
      return { available: true, rows: r.rows.map((d) => ({ id: d.id, docNo: d.docNo, title: d.title, status: d.status, tags: d.tags, route: `/documents/document?id=${d.id}` })) };
    },
    register(actor, tenderId, b) {
      const t = tenderRow(actor, tenderId); need(actor, 'bd.tender.manage', 'register tender documents');
      const svc = documentsOf(db); if (!svc) throw unprocessable('The document service is not running.');
      const d = svc.documents.create(actor, { title: `${t.doc_no} ${b.title.trim()}`, docType: 'TENDER_DOCUMENT', confidentiality: 'CONFIDENTIAL', tags: [b.kind, t.doc_no], changeNote: 'Tender document registered', links: [{ entity: 'tdr_tender', entityId: String(t.id), label: t.doc_no, route: `/bd/tender?id=${t.id}` }] });
      writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: 'document', newValues: { document: d.docNo, kind: b.kind }, actor: actor.user, companyId: actor.companyId });
      return { id: d.id, docNo: d.docNo, title: d.title, route: `/documents/document?id=${d.id}` };
    },
  };

  // ------------------------------------------------------------------ the calendar (FR-07), the reminders (T-02), the dashboard
  function eventsOf(actor, { from, to }) {
    const w = SCOPE_T(seesAll(actor)); const p = { ...params(actor) };
    const rows = db.prepare(`SELECT t.* FROM tdr_tenders t WHERE ${w} AND t.deleted_at IS NULL AND t.status = 'APPROVED' AND t.stage IN ('OPEN', 'BID', 'READY')`).all(p);
    const out = []; const t0 = today();
    for (const t of rows) {
      for (const [kind, v] of [['PREBID', t.prebid_date], ['SUBMISSION', t.submission_at], ['OPENING', t.opening_at]]) {
        const d = dayOf(v); if (!d || d < from || d > to) continue;
        out.push({ date: d, time: v.length > 10 ? v.slice(11, 16) : null, kind, tenderId: t.id, docNo: t.doc_no, name: t.name_of_work, stage: t.stage, daysLeft: daysBetween(t0, d), tone: kind === 'SUBMISSION' && t.stage !== 'READY' && daysBetween(t0, d) <= 3 ? 'RED' : daysBetween(t0, d) <= 7 ? 'AMBER' : 'GREEN' });
      }
      for (const x of db.prepare("SELECT * FROM tdr_team_tasks WHERE tender_id = ? AND status = 'OPEN' AND due_date >= ? AND due_date <= ?").all(t.id, from, to)) out.push({ date: x.due_date, time: null, kind: 'TASK', tenderId: t.id, docNo: t.doc_no, name: `${x.title} (${x.assignee})`, stage: t.stage, daysLeft: daysBetween(t0, x.due_date), tone: x.due_date < t0 ? 'RED' : 'GREEN' });
    }
    return out.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')) || a.docNo.localeCompare(b.docNo));
  }
  const calendar = (actor, f = {}) => { need(actor, 'bd.tender.view', 'see the tender calendar'); const from = f.from ?? today(); const to = f.to ?? addDays(from, 60); return { from, to, events: eventsOf(actor, { from, to }) }; };
  /** T-02 (FR-07): on the days of the offsets before a key date (pre-bid, submission, opening) and before a task is due, the owner and the people with open tasks are reminded, once for each date and offset. */
  function cycle(companyId, { today: now = today() } = {}) {
    const offsets = (param(companyId, 'tdr.reminder_offsets_days') ?? [7, 3, 1, 0]).map(Number); const out = { reminded: 0 };
    const label = { PREBID: 'the pre-bid meeting', SUBMISSION: 'the submission deadline', OPENING: 'the opening of bids' };
    for (const t of db.prepare("SELECT * FROM tdr_tenders WHERE company_id = ? AND deleted_at IS NULL AND status = 'APPROVED' AND stage IN ('OPEN', 'BID', 'READY')").all(companyId)) {
      const who = new Set([t.owner, ...db.prepare("SELECT assignee FROM tdr_team_tasks WHERE tender_id = ? AND status = 'OPEN'").all(t.id).map((x) => x.assignee)]);
      for (const [kind, v] of [['PREBID', t.prebid_date], ['SUBMISSION', t.submission_at], ['OPENING', t.opening_at]]) {
        const d = dayOf(v); if (!d) continue; const left = daysBetween(now, d); if (!offsets.includes(left)) continue;
        for (const u of who) { tell(companyId, u, 'bd.tender.reminder', { ref: t.doc_no, title: t.name_of_work, what: label[kind], when: left === 0 ? 'is today' : `is in ${left} day(s), on ${v.replace('T', ' ')}` }, `/bd/tender?id=${t.id}`, `rem:${t.id}:${kind}:${left}:${v}:${u}`); out.reminded += 1; }
      }
      for (const x of db.prepare("SELECT * FROM tdr_team_tasks WHERE tender_id = ? AND status = 'OPEN'").all(t.id)) {
        const left = daysBetween(now, x.due_date); if (!offsets.includes(left)) continue;
        tell(companyId, x.assignee, 'bd.tender.reminder', { ref: t.doc_no, title: t.name_of_work, what: `your task "${x.title}" is due`, when: left === 0 ? 'today' : `in ${left} day(s)` }, `/bd/tender?id=${t.id}`, `remt:${x.id}:${left}:${x.due_date}`); out.reminded += 1;
      }
    }
    return out;
  }
  function dashboard(actor) {
    need(actor, 'bd.tender.view', 'see the tender dashboard');
    const w = SCOPE_T(seesAll(actor)); const base = `FROM tdr_tenders t WHERE ${w} AND t.deleted_at IS NULL AND t.status <> 'CANCELLED'`;
    const byStage = db.prepare(`SELECT t.stage AS k, COUNT(*) AS n, COALESCE(SUM(t.est_cost_minor), 0) AS v ${base} GROUP BY t.stage`).all(params(actor));
    const stages = Object.keys(TENDER_STAGES).map((k) => { const r = byStage.find((x) => x.k === k); return { stage: k, label: TENDER_STAGES[k], count: r?.n ?? 0, value: rupees(r?.v ?? 0) }; });
    const decided = db.prepare(`SELECT d.decision AS k, COUNT(*) AS n FROM tdr_bid_decisions d JOIN tdr_tenders t ON t.id = d.tender_id WHERE ${SCOPE_D(seesAll(actor))} AND d.deleted_at IS NULL AND d.status = 'APPROVED' GROUP BY d.decision`).all(params(actor));
    const bid = decided.find((x) => x.k === 'BID')?.n ?? 0; const noBid = decided.find((x) => x.k === 'NO_BID')?.n ?? 0;
    const pending = db.prepare(`SELECT COUNT(*) AS n ${base} AND t.status = 'APPROVED' AND t.stage = 'OPEN'`).get(params(actor)).n;
    const t0 = today(); const upcoming = eventsOf(actor, { from: t0, to: addDays(t0, 14) });
    const alerts = [
      ...db.prepare(`SELECT t.* ${base} AND t.status = 'APPROVED' AND t.stage IN ('OPEN', 'BID') AND t.submission_at IS NOT NULL AND substr(t.submission_at, 1, 10) BETWEEN :a AND :b`).all({ ...params(actor), a: t0, b: addDays(t0, 3) }).map((t) => ({ kind: 'NOT_READY', ref: t.doc_no, text: `${t.name_of_work}: submission ${t.submission_at.replace('T', ' ')} and not ready`, route: `/bd/tender?id=${t.id}` })),
      ...db.prepare("SELECT x.*, t.doc_no, t.id AS tid FROM tdr_team_tasks x JOIN tdr_tenders t ON t.id = x.tender_id WHERE x.company_id = ? AND x.status = 'OPEN' AND x.due_date < ? AND lower(x.assignee) = lower(?)").all(actor.companyId, t0, actor.user).map((x) => ({ kind: 'TASK_OVERDUE', ref: x.doc_no, text: `${x.title} was due ${x.due_date}`, route: `/bd/tender?id=${x.tid}` })),
    ];
    const roles = JSON.stringify(actor.roles ?? []);
    const approvals = db.prepare("SELECT COUNT(*) AS n FROM wf_tasks w JOIN wf_instances i ON i.id = w.instance_id WHERE i.company_id = ? AND i.doc_type IN ('TDR_TENDER', 'TDR_BID_DECISION') AND w.status = 'OPEN' AND (lower(w.assignee_user_id) = lower(?) OR w.assignee_role IN (SELECT value FROM json_each(?)))").get(actor.companyId, actor.user, roles).n;
    const myTasks = db.prepare("SELECT x.*, t.doc_no, t.id AS tid FROM tdr_team_tasks x JOIN tdr_tenders t ON t.id = x.tender_id WHERE x.company_id = ? AND x.status = 'OPEN' AND lower(x.assignee) = lower(?) ORDER BY x.due_date LIMIT 10").all(actor.companyId, actor.user).map((x) => ({ ...taskView(x), docNo: x.doc_no, tenderId: x.tid }));
    const toAck = db.prepare(`SELECT COUNT(*) AS n FROM tdr_addenda a JOIN tdr_tenders t ON t.id = a.tender_id WHERE ${w} AND a.ack_at IS NULL AND a.deleted_at IS NULL AND t.stage IN ('OPEN', 'BID', 'READY')`).get(params(actor)).n;
    const waiting = db.prepare(`SELECT COUNT(*) AS n FROM tdr_queries q JOIN tdr_tenders t ON t.id = q.tender_id WHERE ${w} AND q.status = 'SUBMITTED' AND q.deleted_at IS NULL`).get(params(actor)).n;
    const live = stages.filter((s) => ['OPEN', 'BID', 'READY'].includes(s.stage));
    return { tiles: { live: live.reduce((a, s) => a + s.count, 0), liveValue: live.reduce((a, s) => a + s.value, 0), dueThisWeek: upcoming.filter((e) => e.kind === 'SUBMISSION' && e.daysLeft <= 7).length, ready: stages.find((s) => s.stage === 'READY').count, bid, noBid, bidRatio: bid + noBid ? Math.round((bid / (bid + noBid)) * 100) : null, awaitingDecision: pending }, byStage: stages, upcoming: upcoming.slice(0, 30), alerts, myActions: { approvals, tasks: myTasks, addendaToAcknowledge: toAck, queriesWaiting: waiting } };
  }
  const widget = (actor) => (may(actor, 'bd.tender.view') ? { value: eventsOf(actor, { from: today(), to: addDays(today(), 7) }).filter((e) => e.kind === 'SUBMISSION').length } : { value: 0 });

  // ------------------------------------------------------------------ bid or no-bid decisions (FR-03)
  const weights = (companyId) => { const w = param(companyId, 'tdr.bid_weights') ?? {}; return Object.fromEntries(Object.keys(SCORE_KEYS).map((k) => [k, Number(w[k] ?? 0)])); };
  const scoreOf = (companyId, scores) => {
    const w = weights(companyId); let total = 0; const out = {}; const missing = [];
    for (const k of Object.keys(SCORE_KEYS)) { const x = scores?.[k]; const s = x?.score ?? null; out[k] = { score: s, note: x?.note?.trim() || null }; if (s == null) missing.push(k); else total += (w[k] * s) / 5; }
    return { json: out, total: Math.round(total), missing };
  };
  const dRow = (actor, id) => {
    const d = db.prepare('SELECT * FROM tdr_bid_decisions WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!d) throw notFound('That decision does not exist or is not yours to see.');
    const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(d.tender_id);
    if (!(seesAll(actor) || same(d.created_by, actor.user) || (t && seenTender(actor, t)) || wfSeen(actor, [DECISION_DOC], d.id))) throw notFound('That decision does not exist or is not yours to see.');
    return d;
  };
  const decisionView = (actor, d, { detail = false } = {}) => {
    const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(d.tender_id); const mine = same(d.created_by, actor.user);
    const v = { id: d.id, docNo: d.doc_no, docDate: d.doc_date, tenderId: d.tender_id, tenderNo: t?.doc_no, nameOfWork: t?.name_of_work, status: d.status, statusLabel: APPROVAL[d.status], rowVersion: d.version, scores: json(d.scores_json, {}), totalScore: d.total_score, threshold: d.threshold, recommendation: d.recommendation, decision: d.decision, decisionLabel: DECISIONS[d.decision], reasons: d.reasons, amendmentNo: d.amendment_no, decidedAt: d.decided_at, workflowInstanceId: d.workflow_instance_id, requestedBy: d.requested_by, createdBy: d.created_by,
      weights: weights(d.company_id), criteria: SCORE_KEYS,
      can: { edit: ['DRAFT', 'RETURNED'].includes(d.status) && mine && may(actor, 'bd.bid_decision.edit'), submit: ['DRAFT', 'RETURNED'].includes(d.status) && mine && may(actor, 'bd.bid_decision.submit'), delete: d.status === 'DRAFT' && mine && may(actor, 'bd.bid_decision.delete'), withdraw: d.status === 'SUBMITTED' && same(d.requested_by, actor.user), cancel: ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'].includes(d.status) && mine && may(actor, 'bd.bid_decision.cancel') && t?.stage !== 'READY', amend: d.status === 'APPROVED' && mine && may(actor, 'bd.bid_decision.amend') && ['BID', 'NO_BID'].includes(t?.stage), print: may(actor, 'bd.bid_decision.print') } };
    if (detail) { v.eligibility = t ? checklistOf(t) : null; v.bidCapacity = t ? rupees(t.bid_capacity_minor) : null; v.estCost = t ? rupees(t.est_cost_minor) : null; v.amendments = db.prepare("SELECT amendment_no AS no, snapshot_json, reason, amended_by AS by, amended_at AS at FROM tdr_amendments WHERE entity = 'BID_DECISION' AND entity_id = ? ORDER BY amendment_no").all(d.id).map((a) => ({ no: a.no, reason: a.reason, by: a.by, at: a.at, before: json(a.snapshot_json, {}) })); }
    return v;
  };
  function decisionProblems(actor, companyId, m) {
    const s = scoreOf(companyId, m.scores); const threshold = Number(param(companyId, 'tdr.bid_score_threshold') ?? 60); const out = [];
    for (const k of s.missing) out.push({ field: `scores.${k}`, message: `Score ${SCORE_KEYS[k].toLowerCase()} from 1 to 5` });
    const recommendation = s.total >= threshold ? 'BID' : 'NO_BID';
    if (!s.missing.length && m.decision !== recommendation && String(m.reasons ?? '').trim().length < 10) out.push({ field: 'reasons', message: `The score is ${s.total} (the line is ${threshold}), which recommends ${DECISIONS[recommendation].toLowerCase()}; say why the decision is ${DECISIONS[m.decision].toLowerCase()} (at least 10 characters)` });
    return { problems: out, score: s, threshold, recommendation };
  }
  const decisions = {
    list(actor, query) { need(actor, 'bd.bid_decision.view', 'see bid decisions'); return runList(db, decisionList, parseListRequest(decisionList, query), { select: 'd.*', scopeSql: SCOPE_D(seesAll(actor)), params: params(actor), tieBreaker: 'd.id', map: (d) => decisionView(actor, d) }); },
    exportSource(actor, req) {
      need(actor, 'bd.bid_decision.export', 'export bid decisions');
      const opts = { select: 'd.*', scopeSql: SCOPE_D(seesAll(actor)), params: params(actor), tieBreaker: 'd.id' };
      return { title: decisionList.label, permission: 'bd.bid_decision.export', personal: false, columns: Object.entries(decisionList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, decisionList, req, opts),
        rows: () => runList(db, decisionList, req, { ...opts, limit: null, map: (d) => { const v = decisionView(actor, d); return { docNo: v.docNo, tender: v.tenderNo, nameOfWork: v.nameOfWork, score: v.totalScore, recommendation: DECISIONS[v.recommendation], decision: v.decisionLabel, status: v.statusLabel }; } }).data,
        describe: (x) => [x.q ? `search "${x.q}"` : '', ...x.filters.map((f) => `${decisionList.columns[f.key]?.label ?? f.key} ${f.op} ${f.raw}`)].filter(Boolean) };
    },
    get(actor, id) { need(actor, 'bd.bid_decision.view', 'see bid decisions'); return decisionView(actor, dRow(actor, id), { detail: true }); },
    create(actor, b) {
      need(actor, 'bd.bid_decision.create', 'evaluate bid or no-bid');
      const t = tenderRow(actor, b.tenderId);
      if (t.status !== 'APPROVED') throw unprocessable('The registration of the tender must be approved before it is evaluated.');
      if (t.stage !== 'OPEN') throw unprocessable(`A tender that is ${TENDER_STAGES[t.stage].toLowerCase()} is not evaluated again; amend the decision.`);
      if (liveDecision(t.id)) throw conflict('This tender has a decision already; change it or amend it.');
      const r = decisionProblems(actor, actor.companyId, b); if (r.problems.length) throw badRequest('Some fields are not valid.', r.problems);
      return transaction(db, () => {
        const no = nextDoc(actor, DECISION_DOC, 'tdr_bid_decisions', 'BID');
        const id = Number(db.prepare("INSERT INTO tdr_bid_decisions (company_id, doc_no, doc_date, tender_id, scores_json, total_score, threshold, recommendation, decision, reasons, status, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 'tdr_tender')").run(actor.companyId, no, today(), t.id, JSON.stringify(r.score.json), r.score.total, r.threshold, r.recommendation, b.decision, b.reasons ?? null, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'tdr_bid_decisions', entityId: id, action: 'create', newValues: { docNo: no, tender: t.doc_no, score: r.score.total, decision: b.decision }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? decisions.submit(actor, id, {}) : decisions.get(actor, id);
      });
    },
    update(actor, id, b) {
      const d = dRow(actor, id); need(actor, 'bd.bid_decision.edit', 'change bid decisions');
      if (!['DRAFT', 'RETURNED'].includes(d.status)) throw conflict(`A decision that is ${APPROVAL[d.status].toLowerCase()} is not changed; an approved one is amended.`);
      if (!same(d.created_by, actor.user)) throw forbidden(`Only ${d.created_by} changes this decision.`);
      if (d.version !== b.version) throw conflict('This decision was changed by someone else. Reload it and try again.');
      return saveDecision(actor, d, b, 'update');
    },
    remove(actor, id) {
      const d = dRow(actor, id); need(actor, 'bd.bid_decision.delete', 'delete bid decisions');
      if (d.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted; cancel the others.');
      if (!same(d.created_by, actor.user)) throw forbidden(`Only ${d.created_by} deletes this draft.`);
      db.prepare('UPDATE tdr_bid_decisions SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, d.id);
      writeAudit(db, { entity: 'tdr_bid_decisions', entityId: d.id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id: d.id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      const d = dRow(actor, id); need(actor, 'bd.bid_decision.submit', 'send bid decisions');
      if (!['DRAFT', 'RETURNED'].includes(d.status)) throw conflict(`This decision is ${APPROVAL[d.status].toLowerCase()}.`);
      if (!same(d.created_by, actor.user)) throw forbidden(`Only ${d.created_by} sends this decision.`);
      return transaction(db, () => {
        const ctx = { score: d.total_score, decision: d.decision };
        if (d.status === 'RETURNED') workflowOf(db).resubmit(actor, d.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: DECISION_DOC, docId: wfDoc(d.id, d.amendment_no), amendsDocId: d.amendment_no ? wfDoc(d.id, d.amendment_no - 1) : null, comment: comment ?? 'Bid or no-bid', context: ctx }); db.prepare('UPDATE tdr_bid_decisions SET workflow_instance_id = ? WHERE id = ?').run(inst.id, d.id); }
        db.prepare("UPDATE tdr_bid_decisions SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), d.id);
        writeAudit(db, { entity: 'tdr_bid_decisions', entityId: d.id, action: 'submit', reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return decisions.get(actor, d.id);
      });
    },
    withdraw(actor, id, { reason }) {
      const d = dRow(actor, id);
      if (d.status !== 'SUBMITTED') throw unprocessable('Only a decision in approval is withdrawn.');
      if (!same(d.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.');
      workflowOf(db).withdraw(actor, d.workflow_instance_id, { comment: reason });
      return decisions.get(actor, id);
    },
    cancel(actor, id, { reason }) {
      const d = dRow(actor, id); need(actor, 'bd.bid_decision.cancel', 'cancel bid decisions');
      if (!decisionView(actor, d).can.cancel) throw unprocessable('This decision cannot be cancelled now (the tender is ready for submission, or you did not make it).');
      return transaction(db, () => {
        if (d.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, d.workflow_instance_id, actor.user, 'CANCELLED', reason);
        db.prepare("UPDATE tdr_bid_decisions SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1, remarks = ? WHERE id = ?").run(actor.user, nowIso(), reason, d.id);
        if (d.status === 'APPROVED') db.prepare("UPDATE tdr_tenders SET stage = 'OPEN', updated_at = ?, version = version + 1 WHERE id = ? AND stage IN ('BID', 'NO_BID')").run(nowIso(), d.tender_id);
        writeAudit(db, { entity: 'tdr_bid_decisions', entityId: d.id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        return decisions.get(actor, d.id);
      });
    },
    amend(actor, id, b) {
      const d = dRow(actor, id); need(actor, 'bd.bid_decision.amend', 'amend bid decisions');
      if (!decisionView(actor, d).can.amend) throw unprocessable('Only an approved decision of a tender not yet ready for submission, made by you, is amended.');
      if (d.version !== b.version) throw conflict('This decision was changed by someone else. Reload it and try again.');
      return transaction(db, () => {
        db.prepare("INSERT INTO tdr_amendments (company_id, entity, entity_id, amendment_no, snapshot_json, reason, amended_by, created_by) VALUES (?, 'BID_DECISION', ?, ?, ?, ?, ?, ?)").run(d.company_id, d.id, d.amendment_no + 1, JSON.stringify({ scores: json(d.scores_json, {}), totalScore: d.total_score, decision: d.decision, reasons: d.reasons }), b.reason, actor.user, actor.user);
        db.prepare("UPDATE tdr_bid_decisions SET status = 'DRAFT', amendment_no = amendment_no + 1, workflow_instance_id = NULL, requested_by = NULL WHERE id = ?").run(d.id);
        const { reason, ...fields } = b;
        return saveDecision(actor, db.prepare('SELECT * FROM tdr_bid_decisions WHERE id = ?').get(d.id), { ...fields, version: undefined }, 'amend', reason);
      });
    },
    history(actor, id) {
      const d = dRow(actor, id);
      return { approvals: d.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(d.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'tdr_bid_decisions' AND entity_id = ? ORDER BY id").all(String(d.id)) };
    },
    print(actor, id) {
      need(actor, 'bd.bid_decision.print', 'print bid decisions'); const v = decisionView(actor, dRow(actor, id), { detail: true });
      writeAudit(db, { entity: 'tdr_bid_decisions', entityId: v.id, action: 'print', actor: actor.user, companyId: actor.companyId });
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #888;padding:6px;text-align:left}</style></head><body><h1>Bid / no-bid ${esc(v.docNo)}</h1><p>${esc(v.tenderNo)} · ${esc(v.nameOfWork)} · ${esc(v.statusLabel)}</p><table><tr><th>Criterion</th><th>Weight</th><th>Score (1 to 5)</th><th>Note</th></tr>${Object.keys(SCORE_KEYS).map((k) => `<tr><td>${esc(SCORE_KEYS[k])}</td><td>${v.weights[k]}%</td><td>${v.scores[k]?.score ?? ''}</td><td>${esc(v.scores[k]?.note ?? '')}</td></tr>`).join('')}</table><p>Total ${v.totalScore}/100 (line ${v.threshold}): recommended ${esc(DECISIONS[v.recommendation])}. Decision: <strong>${esc(v.decisionLabel)}</strong>. ${esc(v.reasons ?? '')}</p></body></html>`;
    },
  };
  function saveDecision(actor, d, b, action, reason = null) {
    const cur = { scores: json(d.scores_json, {}), decision: d.decision, reasons: d.reasons };
    const m = { scores: b.scores ? Object.fromEntries(Object.keys(SCORE_KEYS).map((k) => [k, b.scores[k] ?? cur.scores[k]])) : cur.scores, decision: b.decision ?? cur.decision, reasons: b.reasons === undefined ? cur.reasons : b.reasons };
    const r = decisionProblems(actor, actor.companyId, m); if (r.problems.length) throw badRequest('Some fields are not valid.', r.problems);
    db.prepare('UPDATE tdr_bid_decisions SET scores_json = ?, total_score = ?, threshold = ?, recommendation = ?, decision = ?, reasons = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(r.score.json), r.score.total, r.threshold, r.recommendation, m.decision, m.reasons ?? null, actor.user, nowIso(), d.id);
    writeAudit(db, { entity: 'tdr_bid_decisions', entityId: d.id, action, reason, oldValues: { decision: d.decision, score: d.total_score }, newValues: { decision: m.decision, score: r.score.total }, actor: actor.user, companyId: actor.companyId });
    return decisions.get(actor, d.id);
  }

  // ------------------------------------------------------------------ what the workflow decided
  function decideTender(instance, actor, outcome, comment) {
    const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(rid(instance.docId));
    if (!t || !['SUBMITTED', 'RETURNED'].includes(t.status)) return;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
    db.prepare('UPDATE tdr_tenders SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, nowIso(), t.id);
    if (withdrawn) db.prepare('UPDATE tdr_tenders SET workflow_instance_id = NULL WHERE id = ?').run(t.id);
    writeAudit(db, { entity: 'tdr_tenders', entityId: t.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: t.company_id });
    if (outcome === 'APPROVED') event('bd.tender.registered', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, clientPartnerId: t.client_partner_id, opportunityId: t.opportunity_id, estCost: rupees(t.est_cost_minor), submissionAt: t.submission_at });
    tell(t.company_id, t.requested_by ?? t.created_by, 'bd.decided', { what: 'Registration of tender', ref: t.doc_no, title: t.name_of_work, decision: outcome === 'APPROVED' ? 'approved' : outcome === 'RETURNED' ? 'returned for correction' : outcome === 'REJECTED' ? 'refused' : 'cancelled', comment: comment ? `: ${comment}` : '' }, `/bd/tender?id=${t.id}`, `tdr:${t.id}:${outcome}`);
  }
  function decideDecision(instance, actor, outcome, comment) {
    const d = db.prepare('SELECT * FROM tdr_bid_decisions WHERE id = ?').get(rid(instance.docId));
    if (!d || !['SUBMITTED', 'RETURNED'].includes(d.status)) return;
    const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
    db.prepare('UPDATE tdr_bid_decisions SET status = ?, decided_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', outcome === 'APPROVED' ? nowIso() : null, actor.user, nowIso(), d.id);
    if (withdrawn) db.prepare('UPDATE tdr_bid_decisions SET workflow_instance_id = NULL WHERE id = ?').run(d.id);
    writeAudit(db, { entity: 'tdr_bid_decisions', entityId: d.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: d.company_id });
    const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(d.tender_id);
    if (outcome === 'APPROVED' && t && ['OPEN', 'BID', 'NO_BID', 'READY'].includes(t.stage)) {
      db.prepare('UPDATE tdr_tenders SET stage = ?, ready_at = NULL, ready_by = NULL, updated_at = ?, version = version + 1 WHERE id = ?').run(d.decision === 'BID' ? 'BID' : 'NO_BID', nowIso(), t.id);
      event('bd.tender.bid_decided', actor, 'tdr_tender', t.id, t.company_id, { tenderId: t.id, docNo: t.doc_no, decision: d.decision, score: d.total_score, opportunityId: t.opportunity_id });
    }
    tell(d.company_id, d.requested_by ?? d.created_by, 'bd.decided', { what: 'Bid or no-bid decision', ref: d.doc_no, title: t?.name_of_work ?? '', decision: outcome === 'APPROVED' ? `approved: ${DECISIONS[d.decision].toLowerCase()}` : outcome === 'RETURNED' ? 'returned for correction' : outcome === 'REJECTED' ? 'refused' : 'cancelled', comment: comment ? `: ${comment}` : '' }, `/bd/bid-decision?id=${d.id}`, `bid:${d.id}:${outcome}`);
  }

  const access = (actor, entity, id) => {
    const authz = kit.authz;
    if (entity === 'tdr_tender') { const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!t || !seenTender(actor, t)) return null; return { companyId: t.company_id, canView: authz.check(actor, 'bd.tender.view').allowed, canEdit: t.status !== 'CANCELLED' && !['CLOSED', 'SUBMITTED'].includes(t.stage) && authz.check(actor, 'bd.tender.manage').allowed }; }
    const table = entity === 'tdr_eligibility' ? 'tdr_eligibility' : 'tdr_addenda'; const r = db.prepare(`SELECT tender_id FROM ${table} WHERE id = ? AND company_id = ? AND deleted_at IS NULL`).get(Number(id), actor.companyId); if (!r) return null;
    return access(actor, 'tdr_tender', r.tender_id);
  };
  return { tenders, eligibility, addenda, queries, teamTasks, documents, decisions, calendar, dashboard, cycle, widget, decisionsOf: { tender: decideTender, decision: decideDecision }, access };
}

const services = new WeakMap();
export const bindTenders = (db, s) => services.set(db, s);
export const tendersOf = (db) => services.get(db) ?? null;

const step = (code, name, approvers, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
if (!workflowResolvers.get('tdr.reviewer')) workflowResolvers.register('tdr.reviewer', ({ db, companyId, instance }) => {
  const table = instance.docType === TENDER_DOC ? 'tdr_tenders' : 'tdr_bid_decisions';
  const r = db.prepare(`SELECT created_by${instance.docType === TENDER_DOC ? ', owner' : ''} FROM ${table} WHERE id = ?`).get(rid(instance.docId));
  const out = new Set([instance.submittedBy, r?.created_by, r?.owner].filter(Boolean).map((x) => String(x).toLowerCase()));
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => json(u.roles_json, []).includes('EST') && !out.has(u.username.toLowerCase())).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'DIR' }];
});
workflowTypes.register({
  docType: TENDER_DOC, label: 'Tender registration', processOwner: 'EST', route: (id) => `/bd/tender?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT doc_no, name_of_work, requested_by, created_by FROM tdr_tenders WHERE id = ? AND company_id = ?').get(rid(id), companyId); return r ? { ref: r.doc_no, title: r.name_of_work, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT t.*, p.legal_name FROM tdr_tenders t JOIN mdm_partners p ON p.id = t.client_partner_id WHERE t.id = ?').get(rid(id)); if (!r) return null; return { fields: [{ label: 'Tender', value: r.doc_no }, { label: 'Authority', value: r.legal_name }, { label: 'Reference', value: `${r.reference_no ?? '–'} (${PORTALS[r.portal]})` }, { label: 'Name of work', value: r.name_of_work }, { label: 'Estimated cost', value: `₹ ${rupees(r.est_cost_minor).toLocaleString('en-IN')}` }, { label: 'EMD / fee', value: `₹ ${rupees(r.emd_minor).toLocaleString('en-IN')} / ₹ ${rupees(r.tender_fee_minor).toLocaleString('en-IN')}` }, { label: 'Bid type', value: `${BID_TYPES[r.bid_type]}, ${r.period_months} months` }, { label: 'Submission', value: r.submission_at ?? '–' }] }; },
  defaultDefinition: { name: 'Tender registration: checked by a colleague of the estimation team (the director when there is none)', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('REGISTER', 'Estimation review', [{ kind: 'resolver', resolver: 'tdr.reviewer' }])] },
  hooks: {
    onApproved: (db, { instance, actor }) => tendersOf(db)?.decisionsOf.tender(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => tendersOf(db)?.decisionsOf.tender(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => tendersOf(db)?.decisionsOf.tender(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => tendersOf(db)?.decisionsOf.tender(instance, actor, 'CANCELLED', comment),
  },
});
workflowTypes.register({
  docType: DECISION_DOC, label: 'Bid or no-bid decision', processOwner: 'EST', route: (id) => `/bd/bid-decision?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT d.doc_no, d.requested_by, t.name_of_work FROM tdr_bid_decisions d JOIN tdr_tenders t ON t.id = d.tender_id WHERE d.id = ? AND d.company_id = ?').get(rid(id), companyId); return r ? { ref: r.doc_no, title: `Bid or no-bid: ${r.name_of_work}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const d = db.prepare('SELECT d.*, t.doc_no AS tender_no, t.name_of_work, t.est_cost_minor, t.bid_capacity_minor FROM tdr_bid_decisions d JOIN tdr_tenders t ON t.id = d.tender_id WHERE d.id = ?').get(rid(id)); if (!d) return null; const sc = json(d.scores_json, {}); return { fields: [{ label: 'Decision', value: d.doc_no }, { label: 'Tender', value: `${d.tender_no}: ${d.name_of_work}` }, ...Object.keys(SCORE_KEYS).map((k) => ({ label: SCORE_KEYS[k], value: `${sc[k]?.score ?? '–'}/5${sc[k]?.note ? ` (${sc[k].note})` : ''}` })), { label: 'Score', value: `${d.total_score}/100 (line ${d.threshold}): recommended ${DECISIONS[d.recommendation]}` }, { label: 'Proposed', value: `${DECISIONS[d.decision]}${d.reasons ? `: ${d.reasons}` : ''}` }, { label: 'Estimated cost / bid capacity', value: `₹ ${rupees(d.est_cost_minor).toLocaleString('en-IN')} / ₹ ${rupees(d.bid_capacity_minor).toLocaleString('en-IN')}` }] }; },
  defaultDefinition: { name: 'Bid or no-bid: a colleague of the estimation team, then the director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('EST', 'Estimation review', [{ kind: 'resolver', resolver: 'tdr.reviewer' }]), step('DIR', 'Director', [{ kind: 'role', role: 'DIR' }])] },
  hooks: {
    onApproved: (db, { instance, actor }) => tendersOf(db)?.decisionsOf.decision(instance, actor, 'APPROVED'),
    onRejected: (db, { instance, actor, comment }) => tendersOf(db)?.decisionsOf.decision(instance, actor, 'REJECTED', comment),
    onReturned: (db, { instance, actor, comment }) => tendersOf(db)?.decisionsOf.decision(instance, actor, 'RETURNED', comment),
    onCancelled: (db, { instance, actor, comment }) => tendersOf(db)?.decisionsOf.decision(instance, actor, 'CANCELLED', comment),
  },
});
evidenceProviders.register(DECISION_DOC, ({ db, instance }) => {
  const d = db.prepare('SELECT d.*, t.est_cost_minor, t.bid_capacity_minor, t.id AS tid FROM tdr_bid_decisions d JOIN tdr_tenders t ON t.id = d.tender_id WHERE d.id = ?').get(rid(instance.docId)); if (!d) return { sections: [] };
  const e = db.prepare("SELECT result, COUNT(*) AS n FROM tdr_eligibility WHERE tender_id = ? AND deleted_at IS NULL GROUP BY result").all(d.tid);
  const cap = d.bid_capacity_minor == null ? 'not worked out' : `₹ ${rupees(d.bid_capacity_minor).toLocaleString('en-IN')} against a cost of ₹ ${rupees(d.est_cost_minor).toLocaleString('en-IN')} (${d.bid_capacity_minor >= d.est_cost_minor ? 'sufficient' : 'short'})`;
  return { sections: [{ code: 'tdr-decision', title: 'Before deciding', kind: 'metrics', items: [{ label: 'Score', value: `${d.total_score}/100 (line ${d.threshold}), recommended ${DECISIONS[d.recommendation]}`, format: 'text' }, { label: 'Proposed decision', value: DECISIONS[d.decision], format: 'text' }, { label: 'Bid capacity', value: cap, format: 'text' }, { label: 'Eligibility', value: e.map((x) => `${x.n} ${RESULTS[x.result].toLowerCase()}`).join(', ') || 'no criteria', format: 'text' }] }] };
});
evidenceProviders.register(TENDER_DOC, ({ db, instance }) => {
  const t = db.prepare('SELECT * FROM tdr_tenders WHERE id = ?').get(rid(instance.docId)); if (!t) return { sections: [] };
  const same2 = db.prepare("SELECT COUNT(*) AS n FROM tdr_tenders WHERE client_partner_id = ? AND id <> ? AND deleted_at IS NULL AND status <> 'CANCELLED'").get(t.client_partner_id, t.id).n;
  return { sections: [{ code: 'tdr-tender', title: 'Before registering', kind: 'metrics', items: [{ label: 'Estimated cost', value: `₹ ${rupees(t.est_cost_minor).toLocaleString('en-IN')}`, format: 'text' }, { label: 'EMD and fee', value: `₹ ${rupees(t.emd_minor).toLocaleString('en-IN')} and ₹ ${rupees(t.tender_fee_minor).toLocaleString('en-IN')}`, format: 'text' }, { label: 'Bid capacity', value: t.bid_capacity_minor == null ? 'not worked out' : `₹ ${rupees(t.bid_capacity_minor).toLocaleString('en-IN')}`, format: 'text' }, { label: 'Other tenders of this authority', value: String(same2), format: 'text' }, { label: 'Submission', value: t.submission_at ?? 'not set', format: 'text' }] }] };
});
for (const [entity, label] of [['tdr_tender', 'Tender attachments'], ['tdr_eligibility', 'Eligibility evidence'], ['tdr_addendum', 'Addenda and corrigenda']]) {
  fileEntities.register({ entity, label, resolve(db, actor, id) { return tendersOf(db)?.access(actor, entity === 'tdr_addendum' ? 'tdr_addenda' : entity, id) ?? null; } });
}
convertHooks.push((db, actor, opp) => tendersOf(db)?.tenders.createFromOpportunity(actor, opp));
