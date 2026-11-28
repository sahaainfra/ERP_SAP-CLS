import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv, toPdf, toXlsx } from '../../platform/export/index.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { findCycle, makeCalendar, ordOf } from './cpm.js';
import { ExchangeError, FORMATS, parseFile, toMspXml, toP6Xml } from './exchange.js';
import { isEnabled } from '../core/feature-flags/service.js';
import { QUALITY, VARIANCE_STATUS, changeOf, qualityOf, varianceOf } from './analysis.js';
import { keyOf } from './gantt.js';

// Baselines, programme revisions and the exchange with MS Project and Primavera (part 13.03).
// - A baseline is a frozen picture of a schedule: its calendars, WBS nodes, activities with their dates, durations and floats, its links and its resources (FR-01). The picture is taken when the baseline
//   is drafted and again when it is sent for approval, so what is approved is what was sent. It is approved by the project manager and then the project director; the planner who prepares it holds no
//   approval. Approved, it is never changed (BR-01: the code never tries, and two triggers of the table refuse it anyway) and it becomes the current baseline of the project, the one variance and
//   earned value read; the earlier baselines stay, approved and readable.
// - A revision (FR-02) is a new baseline with its kind (extension of time, re-sequencing, change of scope), its reason and a summary of what changed against the current baseline, worked out here and
//   completed by the planner; it replaces the current baseline only when it is approved.
// - The comparison (FR-03) and the quality check (FR-06) are in analysis.js; here they are given their pictures, filters, pages and exports.
// - A file of MS Project or Primavera (FR-04) is read, checked and shown with a proposed mapping first; applied, it changes the working schedule only (a draft or a returned one), never a baseline (BR-02).
export const BASELINE_DOC = 'PLAN_BASELINE';
export const BASELINE_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', APPROVED: 'Approved', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled' };
export const REVISION_TYPES = { ORIGINAL: 'Original programme', EOT: 'Extension of time', RESEQUENCE: 'Re-sequencing', SCOPE: 'Change of scope', OTHER: 'Other' };
export const IMPORT_STATUS = { ANALYSED: 'Read, not applied', IMPORTED: 'Applied', DISCARDED: 'Discarded' };
const COLS = 'x.id, x.company_id, x.doc_no, x.doc_date, x.org_project_id, x.schedule_id, x.schedule_version_no, x.baseline_no, x.name, x.revision_type, x.reason, x.change_summary, x.reference_no, x.previous_baseline_id, x.snapshot_hash, x.change_json, x.start_date, x.finish_date, x.data_date, x.activities_count, x.critical_count, x.links_count, x.status, x.is_current, x.workflow_instance_id, x.requested_by, x.approved_by, x.approved_at, x.created_by, x.created_at, x.updated_at, x.version, x.remarks';
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const same = (a, b) => Boolean(a && b && String(a).toLowerCase() === String(b).toLowerCase());
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const lower = (s) => String(s ?? '').toLowerCase();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-');
const signed = (n) => (n == null ? '' : n > 0 ? `+${n}` : String(n));
const HOURLY = /^h(ou)?rs?$/i;
const DEFAULT_UOM = { LABOUR: 'man-day', PLANT: 'hour', MATERIAL: 'unit' };
const ITEM_TYPES = { LABOUR: ['LABOUR'], PLANT: ['EQUIPMENT', 'TOOL'], MATERIAL: ['MATERIAL', 'CONSUMABLE', 'RETURNABLE', 'SPARE'] };
const CODE_OK = /^[A-Za-z0-9._-]{1,30}$/;
const NOTE_LIMIT = 300;
const ERROR_CODES = new Set(['NO_ACTIVITIES', 'MAPPING_CALENDAR', 'MAPPING_WBS', 'MAPPING_RESOURCE', 'CODE_MISSING', 'CODE_INVALID', 'CODE_DUPLICATE', 'NAME_MISSING', 'DURATION_RANGE', 'LAG_RANGE', 'LOOP']);
const INFO_CODES = new Set(['MERGE', 'START', 'MANUAL', 'RESOURCE_COST', 'BASELINE_IN_FILE']);

export const baselineList = defineList({
  code: 'plan.baselines', label: 'Baselines', permission: 'plan.baseline.view',
  from: 'plan_baselines x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.name', 'p.code', 'p.name', 'x.reference_no'], defaultSort: '-docDate',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Baseline no.' }, name: { sql: 'x.name', type: 'text', label: 'Name' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    docDate: { sql: 'x.doc_date', type: 'date', label: 'Date' }, baselineNo: { sql: 'x.baseline_no', type: 'number', label: 'Revision' }, revisionType: { sql: 'x.revision_type', type: 'enum', label: 'Kind', options: Object.entries(REVISION_TYPES) }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(BASELINE_STATUS) },
    current: { sql: 'x.is_current', type: 'number', label: 'Current' }, startDate: { sql: 'x.start_date', type: 'date', label: 'Start' }, finishDate: { sql: 'x.finish_date', type: 'date', label: 'Finish' }, activities: { sql: 'x.activities_count', type: 'number', label: 'Activities' }, approvedAt: { sql: 'x.approved_at', type: 'date', label: 'Approved' },
  },
});

export function createBaselineService({ db, plan }) {
  const authz = authzOf(db);
  const may = (actor, key, pid) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed;
  const need = (actor, key, what, pid) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const notify = (companyId, code, users, ref, subject, detail, link, sourceId) => { const to = [...new Set(users.filter(Boolean))]; if (!to.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients: to.map((u) => `user:${u}`), data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId }); } catch { /* saved anyway */ } };
  const numberFor = (actor) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType: BASELINE_DOC, actor: actor.user, refType: 'plan_baselines' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM plan_baselines WHERE company_id = ?').get(actor.companyId).n ?? 0) + 1; return `BL/${String(n).padStart(5, '0')}`;
  };
  const orgOf = (id) => db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ?').get(id);
  const schedRow = (id) => db.prepare('SELECT * FROM plan_schedules WHERE id = ?').get(id);
  /** A schedule the person may see (404 otherwise), as its row. */
  const schedule = (actor, id) => { const v = plan.schedules.get(actor, id); return schedRow(v.id); };

  // ---- the picture of a schedule ----------------------------------------------------------------------------------------------------------------------------------------
  function calendarPicture(id) {
    const c = db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(id); if (!c) return null; const ex = json(c.exceptions_json, []); const worked = new Set(ex.filter((e) => e.working).map((e) => e.date));
    const off = new Set(c.holiday_calendar_id ? db.prepare('SELECT holiday_date FROM core_holidays WHERE calendar_id = ? AND deleted_at IS NULL').all(c.holiday_calendar_id).map((h) => h.holiday_date) : []); for (const e of ex) if (!e.working) off.add(e.date);
    return { key: String(c.id), id: c.id, code: c.code, name: c.name, workWeek: c.work_week, hoursPerDay: c.hours_per_day, holidays: [...off].filter((d) => !worked.has(d)).sort(), exceptions: [...worked].sort() };
  }
  /** Everything a baseline keeps of a schedule, and what the exports and the checks read (FR-01): calendars, the WBS nodes in use, activities, links and resources. */
  function snapshotOf(s) {
    const acts = db.prepare('SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(s.id);
    const calIds = [...new Set([s.calendar_id, ...acts.map((a) => a.calendar_id).filter(Boolean)])];
    const all = new Map(db.prepare('SELECT id, parent_id, code, name FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL').all(s.org_project_id).map((w) => [w.id, w])); const used = new Set();
    for (const a of acts) { let w = all.get(a.wbs_id); while (w && !used.has(w.id)) { used.add(w.id); w = all.get(w.parent_id); } }
    return {
      v: 1, takenAt: nowIso(),
      schedule: { id: s.id, docNo: s.doc_no, name: s.name, versionNo: s.version_no, status: s.status, start: s.start_date, finish: s.finish_date, dataDate: s.data_date, calendarKey: String(s.calendar_id) },
      calendars: calIds.map(calendarPicture).filter(Boolean),
      wbs: [...used].map((id) => all.get(id)).sort((x, y) => x.code.localeCompare(y.code, 'en', { numeric: true })).map((w) => ({ key: String(w.id), id: w.id, parentKey: w.parent_id && used.has(w.parent_id) ? String(w.parent_id) : null, code: w.code, name: w.name })),
      activities: acts.map((a) => ({
        key: String(a.id), id: a.id, code: a.code, name: a.name, wbsKey: a.wbs_id ? String(a.wbs_id) : null, type: a.act_type, duration: a.duration_days, calendarKey: a.calendar_id && a.calendar_id !== s.calendar_id ? String(a.calendar_id) : null, constraintType: a.constraint_type, constraintDate: a.constraint_date,
        start: a.es, finish: a.ef, ls: a.ls, lf: a.lf, totalFloat: a.total_float, freeFloat: a.free_float, critical: Boolean(a.is_critical), actualStart: a.actual_start, actualFinish: a.actual_finish, pct: a.pct_complete / 100, remaining: a.remaining_days, qty: a.qty / 1000, uom: a.uom,
      })),
      links: db.prepare('SELECT pred_id, succ_id, dep_type, lag_days FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL ORDER BY id').all(s.id).map((l) => ({ pred: String(l.pred_id), succ: String(l.succ_id), type: l.dep_type, lag: l.lag_days })),
      resources: db.prepare('SELECT r.*, i.code AS item_code FROM plan_activity_resources r LEFT JOIN mdm_items i ON i.id = r.item_id WHERE r.schedule_id = ? AND r.deleted_at IS NULL ORDER BY r.activity_id, r.resource_type, r.label, r.id').all(s.id)
        .map((r) => ({ activity: String(r.activity_id), type: r.resource_type, key: r.res_key, itemId: r.item_id, itemCode: r.item_code ?? null, trade: r.trade, label: r.label, uom: r.uom, basis: r.basis, qtyTotal: r.qty_total / 1000, qtyPerDay: r.qty_per_day / 1000 })),
    };
  }
  const hashOf = (snap) => createHash('sha256').update(JSON.stringify({ ...snap, takenAt: null })).digest('hex');
  const mustBeCalculated = (s) => { if (!s.activities_count) throw unprocessable(`${s.doc_no} has no activities: there is nothing to keep as a baseline.`); if (s.needs_calc) throw unprocessable(`${s.doc_no} changed since its last calculation: calculate it first, so the baseline keeps its dates.`); };

  // ---- baselines (FR-01, FR-02, BR-01) -----------------------------------------------------------------------------------------------------------------------------------
  function row(actor, id, key = 'plan.baseline.view') {
    const r = db.prepare(`SELECT ${COLS} FROM plan_baselines x WHERE x.id = ? AND x.company_id = ? AND x.deleted_at IS NULL`).get(rid(id), actor.companyId);
    if (!r || !may(actor, 'plan.baseline.view', r.org_project_id)) throw notFound('That baseline does not exist.');
    if (key !== 'plan.baseline.view') need(actor, key, 'do that with a baseline', r.org_project_id);
    return r;
  }
  const fresh = (id) => db.prepare(`SELECT ${COLS} FROM plan_baselines x WHERE x.id = ?`).get(id);
  const snapOf = (id) => json(db.prepare('SELECT snapshot_json FROM plan_baselines WHERE id = ?').get(id)?.snapshot_json, null);
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(r.status === 'APPROVED' ? `${r.doc_no} is approved: an approved baseline is never changed (a revision is a new baseline).` : `${r.doc_no} is ${BASELINE_STATUS[r.status].toLowerCase()}: it is not changed now.`); };
  const openOf = (projectId, exceptId = 0) => db.prepare("SELECT id, doc_no FROM plan_baselines WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND id <> ? AND deleted_at IS NULL").get(projectId, exceptId);
  const currentOf = (projectId) => db.prepare(`SELECT ${COLS} FROM plan_baselines x WHERE x.org_project_id = ? AND x.is_current = 1 AND x.deleted_at IS NULL`).get(projectId) ?? null;
  const hasEot = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ctr_eot_awards'").get());
  const EOT_SQL = "SELECT a.id, a.days, a.completion_after AS completionAfter, c.claim_no AS claimNo, c.doc_no AS claimDocNo, c.org_project_id AS projectId FROM ctr_eot_awards a JOIN ctr_claims c ON c.id = a.claim_id WHERE a.deleted_at IS NULL";
  const eotAwardOf = (id) => (hasEot() ? db.prepare(`${EOT_SQL} AND a.id = ?`).get(id) ?? null : null);
  /** The awards of the project not yet taken into a baseline revision. */
  const eotAwardsOf = (projectId) => (hasEot() ? db.prepare(`${EOT_SQL} AND c.org_project_id = ? AND NOT EXISTS (SELECT 1 FROM plan_baselines b WHERE b.source_type = 'ctr_eot_awards' AND b.source_id = CAST(a.id AS TEXT) AND b.status NOT IN ('CANCELLED', 'REJECTED') AND b.deleted_at IS NULL) ORDER BY a.id`).all(projectId) : []);
  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const s = db.prepare('SELECT doc_no, name, status, version_no FROM plan_schedules WHERE id = ?').get(r.schedule_id); const can = (k) => may(actor, k, r.org_project_id);
    const prev = r.previous_baseline_id ? db.prepare('SELECT doc_no, baseline_no, finish_date FROM plan_baselines WHERE id = ?').get(r.previous_baseline_id) : null;
    const v = {
      id: r.id, docNo: r.doc_no, docDate: r.doc_date, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, scheduleId: r.schedule_id, scheduleDocNo: s?.doc_no ?? null, scheduleVersionNo: r.schedule_version_no, baselineNo: r.baseline_no, name: r.name,
      revisionType: r.revision_type, revisionLabel: REVISION_TYPES[r.revision_type], reason: r.reason, changeSummary: r.change_summary, referenceNo: r.reference_no, previousBaselineId: r.previous_baseline_id, previousDocNo: prev?.doc_no ?? null, previousFinish: prev?.finish_date ?? null,
      startDate: r.start_date, finishDate: r.finish_date, dataDate: r.data_date, activities: r.activities_count, critical: r.critical_count, links: r.links_count, status: r.status, statusLabel: BASELINE_STATUS[r.status], current: Boolean(r.is_current),
      requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, workflowInstanceId: r.workflow_instance_id, snapshotHash: r.snapshot_hash, rowVersion: r.version,
      can: {
        edit: can('plan.baseline.edit') && editable(r), submit: can('plan.baseline.submit') && editable(r), withdraw: r.status === 'SUBMITTED' && same(r.requested_by, actor.user), cancel: can('plan.baseline.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status),
        delete: can('plan.baseline.delete') && r.status === 'DRAFT' && !r.workflow_instance_id, amend: can('plan.baseline.amend') && r.status === 'APPROVED' && Boolean(r.is_current) && !openOf(r.org_project_id), print: can('plan.baseline.print'), export: can('plan.baseline.export'),
      },
    };
    if (detail) { v.change = json(r.change_json, {}); v.scheduleName = s?.name ?? null; v.scheduleStatus = s?.status ?? null; v.remarks = r.remarks;
      // part 30.01 (BR-01): an extension-of-time revision comes from the award of a claim (21.06), not a typed reference
      const src = db.prepare('SELECT source_type, source_id FROM plan_baselines WHERE id = ?').get(r.id); v.eotAward = src?.source_type === 'ctr_eot_awards' ? eotAwardOf(Number(src.source_id)) : null; v.eotAwards = v.can.amend ? eotAwardsOf(r.org_project_id) : []; }
    return v;
  }
  const scope = (actor) => { const f = authz.scopeFilter(actor, 'plan.baseline.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const listRow = (actor, x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, name: v.name, project: v.projectCode, projectId: v.projectId, docDate: v.docDate, baselineNo: v.baselineNo, revisionType: v.revisionType, revisionLabel: v.revisionLabel, status: v.status, statusLabel: v.statusLabel, current: v.current, startDate: v.startDate, finishDate: v.finishDate, activities: v.activities, approvedAt: v.approvedAt, scheduleId: v.scheduleId, scheduleDocNo: v.scheduleDocNo }; };
  /** Take the picture of the schedule into a baseline row that may still change, with the change against the current baseline. */
  function freeze(r, s) {
    mustBeCalculated(s); const snap = snapshotOf(s); const cur = currentOf(r.org_project_id); const base = cur && cur.id !== r.id ? snapOf(cur.id) : null;
    db.prepare('UPDATE plan_baselines SET snapshot_json = ?, snapshot_hash = ?, change_json = ?, previous_baseline_id = ?, schedule_version_no = ?, start_date = ?, finish_date = ?, data_date = ?, activities_count = ?, critical_count = ?, links_count = ? WHERE id = ?')
      .run(JSON.stringify(snap), hashOf(snap), JSON.stringify(base ? changeOf(base, snap) : {}), cur && cur.id !== r.id ? cur.id : null, s.version_no, s.start_date, s.finish_date, s.data_date, snap.activities.length, snap.activities.filter((a) => a.critical).length, snap.links.length, r.id);
    return snap;
  }
  const typeCheck = (projectId, type, exceptId = 0) => {
    const approved = db.prepare("SELECT 1 FROM plan_baselines WHERE org_project_id = ? AND status = 'APPROVED' AND id <> ? AND deleted_at IS NULL").get(projectId, exceptId);
    if (approved && type === 'ORIGINAL') return [{ field: 'revisionType', message: 'The project has an approved baseline: this one is a revision (extension of time, re-sequencing, change of scope or other)' }];
    if (!approved && type !== 'ORIGINAL') return [{ field: 'revisionType', message: 'The first baseline of a project is the original programme' }];
    return [];
  };

  const baselines = {
    list(actor, query) { if (!authz.check(actor, 'plan.baseline.view').allowed) throw forbidden('You may not see baselines (permission plan.baseline.view).'); const sc = scope(actor); return runList(db, baselineList, parseListRequest(baselineList, query), { select: COLS, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => listRow(actor, x) }); },
    exportSource(actor, req) {
      if (!authz.check(actor, 'plan.baseline.export').allowed) throw forbidden('You may not export baselines (permission plan.baseline.export).'); const sc = scope(actor); const opts = { select: COLS, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' };
      return { title: baselineList.label, permission: 'plan.baseline.export', personal: false, columns: ['docNo', 'project', 'name', 'baselineNo', 'revisionType', 'status', 'current', 'startDate', 'finishDate', 'activities', 'approvedAt'].map((k) => ({ key: k, label: baselineList.columns[k]?.label ?? k, type: 'text' })),
        rows: () => runList(db, baselineList, req, { ...opts, limit: null, map: (x) => { const v = listRow(actor, x); return { docNo: v.docNo, project: v.project, name: v.name, baselineNo: String(v.baselineNo), revisionType: v.revisionLabel, status: v.statusLabel, current: v.current ? 'Yes' : '', startDate: v.startDate ?? '', finishDate: v.finishDate ?? '', activities: String(v.activities), approvedAt: (v.approvedAt ?? '').slice(0, 10) }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All baselines you may see'], count: () => countList(db, baselineList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    /** The baselines of a project in the order they were made, and the current one: what the pages offer and what 13.04, 13.05 and 21.06 read. */
    ofProject(actor, projectId) {
      const o = orgOf(Number(projectId)); if (!o || o.company_id !== actor.companyId || !may(actor, 'plan.baseline.view', o.id)) throw notFound('That project does not exist.');
      const rows = db.prepare(`SELECT ${COLS} FROM plan_baselines x WHERE x.org_project_id = ? AND x.deleted_at IS NULL ORDER BY x.baseline_no`).all(o.id).map((x) => listRow(actor, x));
      return { projectId: o.id, projectCode: o.code, rows, currentId: rows.find((x) => x.current)?.id ?? null, canCreate: may(actor, 'plan.baseline.create', o.id) && !openOf(o.id), kinds: Object.entries(REVISION_TYPES).map(([code, label]) => ({ code, label })) };
    },
    create(actor, b) {
      const s = schedule(actor, b.scheduleId); need(actor, 'plan.baseline.create', 'prepare a baseline for this project', s.org_project_id);
      if (['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(s.status)) throw unprocessable(`${s.doc_no} is ${s.status.toLowerCase()}: a baseline is taken of a schedule in use.`);
      const op = openOf(s.org_project_id); if (op) throw conflict(`${op.doc_no} is open for this project: finish or cancel it first.`);
      fail(typeCheck(s.org_project_id, b.revisionType)); mustBeCalculated(s);
      return transaction(db, () => {
        const no = (db.prepare('SELECT MAX(baseline_no) AS n FROM plan_baselines WHERE org_project_id = ? AND deleted_at IS NULL').get(s.org_project_id).n ?? -1) + 1;
        const id = Number(db.prepare("INSERT INTO plan_baselines (company_id, doc_no, doc_date, org_project_id, schedule_id, schedule_version_no, baseline_no, name, revision_type, reason, change_summary, reference_no, snapshot_json, snapshot_hash, status, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', '', 'DRAFT', ?, ?, ?, 'api')")
          .run(actor.companyId, numberFor(actor), todayIST(), s.org_project_id, s.id, s.version_no, no, b.name, b.revisionType, b.reason, b.changeSummary ?? null, b.referenceNo ?? null, actor.user, s.org_project_id, actor.user).lastInsertRowid);
        freeze({ id, org_project_id: s.org_project_id }, s);
        audit(actor, 'plan_baselines', id, 'create', actor.companyId, { reason: b.reason, newValues: { schedule: s.doc_no, kind: b.revisionType, baselineNo: no } }); return baselines.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'plan.baseline.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this baseline; reload it.');
      if ('revisionType' in b) fail(typeCheck(r.org_project_id, b.revisionType, r.id));
      return transaction(db, () => {
        const sets = []; const vals = []; for (const [k, c] of [['name', 'name'], ['revisionType', 'revision_type'], ['reason', 'reason'], ['changeSummary', 'change_summary'], ['referenceNo', 'reference_no']]) if (k in b) { sets.push(`${c} = ?`); vals.push(b[k]); }
        db.prepare(`UPDATE plan_baselines SET ${[...sets, 'updated_by = ?', 'updated_at = ?', 'version = version + 1'].join(', ')} WHERE id = ?`).run(...vals, actor.user, nowIso(), r.id);
        if (b.refresh) freeze(r, schedRow(r.schedule_id));
        const changed = { ...b }; delete changed.rowVersion; audit(actor, 'plan_baselines', r.id, 'update', r.company_id, { newValues: changed }); return baselines.get(actor, r.id);
      });
    },
    remove(actor, id) {
      const r = row(actor, id, 'plan.baseline.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.');
      db.prepare('UPDATE plan_baselines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'plan_baselines', r.id, 'delete', r.company_id); return { id: r.id, deleted: true };
    },
    submit(actor, id) {
      const r = row(actor, id, 'plan.baseline.submit'); if (!editable(r)) throw unprocessable('Only a draft or a returned baseline is sent for approval.');
      if (r.revision_type !== 'ORIGINAL' && !(r.change_summary ?? '').trim()) fail([{ field: 'changeSummary', message: 'Say what changed against the current baseline before sending a revision' }]);
      const s = schedRow(r.schedule_id); if (['CANCELLED', 'REJECTED', 'SUPERSEDED'].includes(s.status)) throw unprocessable(`${s.doc_no} is ${s.status.toLowerCase()}: take the baseline of the schedule in use.`);
      return transaction(db, () => {
        const snap = freeze(r, s); const c = json(fresh(r.id).change_json, {}); const ctx = { projectId: r.org_project_id, activities: snap.activities.length, finish: s.finish_date, finishVar: c.finishVar ?? 0, revisionType: r.revision_type };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: BASELINE_DOC, docId: String(r.id), comment: `${r.doc_no} ${r.name}`.slice(0, 300), context: ctx }); db.prepare('UPDATE plan_baselines SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE plan_baselines SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id);
        audit(actor, 'plan_baselines', r.id, 'submit', r.company_id, { newValues: { finish: s.finish_date, activities: snap.activities.length, hash: hashOf(snap) } }); return baselines.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a baseline waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return baselines.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'plan.baseline.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable(r.status === 'APPROVED' ? 'An approved baseline is never cancelled: a revision replaces it as the current baseline.' : 'Only a baseline that is not decided is cancelled.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE plan_baselines SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'plan_baselines', r.id, 'cancel', r.company_id, { reason }); return baselines.get(actor, r.id); });
    },
    /** FR-02: a revision of the current baseline: a new draft of the schedule in work (or of the one named), with its kind and reason. The approved baseline itself stays as it is. */
    amend(actor, id, b) {
      const r = row(actor, id, 'plan.baseline.amend'); if (r.status !== 'APPROVED' || !r.is_current) throw unprocessable('Only the current approved baseline is revised.');
      const sid = b.scheduleId ?? db.prepare("SELECT id FROM plan_schedules WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED') ORDER BY (status = 'APPROVED'), id DESC").get(r.org_project_id)?.id;
      if (!sid) throw unprocessable('The project has no schedule in use to revise the baseline from.');
      let award = null;
      if (b.eotAwardId) {
        if (b.revisionType !== 'EOT') fail([{ field: 'eotAwardId', message: 'An awarded extension of time goes with a revision of kind extension of time' }]);
        award = eotAwardsOf(r.org_project_id).find((a) => a.id === b.eotAwardId);
        if (!award) fail([{ field: 'eotAwardId', message: 'Choose an extension of time awarded on this project and not yet in a baseline' }]);
      }
      return transaction(db, () => {
        const made = baselines.create(actor, { scheduleId: sid, name: b.name ?? `${r.name} (revision)`.slice(0, 200), revisionType: b.revisionType, reason: b.reason, changeSummary: b.changeSummary ?? null, referenceNo: award ? award.claimNo : b.referenceNo ?? null });
        if (award) db.prepare("UPDATE plan_baselines SET source_type = 'ctr_eot_awards', source_id = ? WHERE id = ?").run(String(award.id), made.id);
        audit(actor, 'plan_baselines', made.id, 'amend', r.company_id, { reason: b.reason, newValues: { from: r.doc_no, ...(award ? { eotAward: award.id, claim: award.claimNo, days: award.days } : {}) } });
        return award ? { ...made, referenceNo: award.claimNo, eotAward: award } : made;
      });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'plan_baselines' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'plan.baseline.print'); const v = view(actor, r, { detail: true }); const snap = snapOf(r.id); const wbs = new Map(snap.wbs.map((w) => [w.key, w.code]));
      const tr = (c, h = false) => `<tr>${c.map((x) => `<${h ? 'th' : 'td'}>${esc(x)}</${h ? 'th' : 'td'}>`).join('')}</tr>`; const c = v.change ?? {};
      audit(actor, 'plan_baselines', r.id, 'print', r.company_id);
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${v.status === 'APPROVED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT AN APPROVED BASELINE</strong></p>`}<h1>Baseline ${esc(v.docNo)} · ${esc(v.projectCode)} ${esc(v.projectName)}</h1>`
        + `<p>${esc(v.name)} · revision ${v.baselineNo} (${esc(v.revisionLabel)})${v.current ? ' · CURRENT BASELINE' : ''} · schedule ${esc(v.scheduleDocNo)} v${v.scheduleVersionNo} · start ${esc(v.startDate ?? '—')} · finish ${esc(v.finishDate ?? '—')} · ${v.activities} activities, ${v.critical} critical, ${v.links} links</p>`
        + `<p>Reason: ${esc(v.reason)}${v.referenceNo ? ` · reference ${esc(v.referenceNo)}` : ''}</p>${v.changeSummary ? `<p>Change: ${esc(v.changeSummary)}</p>` : ''}`
        + (v.previousDocNo ? `<p>Against ${esc(v.previousDocNo)}: finish ${esc(c.baselineFinish ?? '—')} → ${esc(c.finish ?? '—')} (${esc(signed(c.finishVar ?? 0))} days); ${c.added ?? 0} added, ${c.removed ?? 0} removed, ${c.changed ?? 0} changed, ${c.slipped ?? 0} later (${c.criticalSlipped ?? 0} critical).</p>` : '')
        + `<p>${v.approvedAt ? `Approved by ${esc(v.approvedBy)} on ${esc(v.approvedAt.slice(0, 10))}` : `Prepared by ${esc(v.requestedBy ?? '')}`} · picture ${esc(v.snapshotHash.slice(0, 12))}</p>`
        + `<table border="1" cellpadding="3">${tr(['Code', 'Activity', 'WBS', 'Type', 'Dur.', 'Start', 'Finish', 'Total float', 'Critical'], true)}${snap.activities.map((a) => tr([a.code, a.name, wbs.get(a.wbsKey) ?? '', a.type, a.duration, a.start ?? '', a.finish ?? '', a.totalFloat ?? '', a.critical ? 'Yes' : ''])).join('')}</table></body></html>`;
    },
    /** The approval engine tells the outcome here. Approved, the baseline is frozen and becomes the current one of its project (BR-01). */
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        transaction(db, () => {
          const prev = currentOf(r.org_project_id); const c = json(r.change_json, {});
          if (prev) db.prepare('UPDATE plan_baselines SET is_current = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(actor.user, now, prev.id);
          db.prepare("UPDATE plan_baselines SET status = 'APPROVED', is_current = 1, approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
          audit(actor, 'plan_baselines', r.id, 'approve', r.company_id, { newValues: { replaces: prev?.doc_no ?? null, hash: r.snapshot_hash } });
          publishEvent(db, { type: 'plan.baseline.approved', entity: 'plan_baseline', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, data: { baselineId: r.id, projectId: r.org_project_id, scheduleId: r.schedule_id, docNo: r.doc_no, baselineNo: r.baseline_no, revisionType: r.revision_type, previousBaselineId: prev?.id ?? null, start: r.start_date, finish: r.finish_date, previousFinish: prev?.finish_date ?? null, finishVar: c.finishVar ?? null, activities: r.activities_count, critical: r.critical_count } });
          notify(r.company_id, 'plan.baseline.approved', [r.requested_by], r.doc_no, r.name, `Baseline ${r.doc_no} (revision ${r.baseline_no}) is approved: it is the current baseline of the project.`, `/plan/baselines?id=${r.id}`, r.id);
        });
        return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE plan_baselines SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'plan_baselines', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'plan.baseline.rejected', [r.requested_by], r.doc_no, r.name, `Baseline ${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/plan/baselines?id=${r.id}`, r.id);
    },
    /** What other modules read: the current baseline of a project with its activities by code (dates, duration, float), or null. */
    current(actor, projectId) {
      const o = orgOf(Number(projectId)); if (!o || o.company_id !== actor.companyId || !may(actor, 'plan.baseline.view', o.id)) throw notFound('That project does not exist.');
      const r = currentOf(o.id); if (!r) return { projectId: o.id, baseline: null, activities: [] }; const snap = snapOf(r.id);
      return { projectId: o.id, baseline: listRow(actor, r), activities: snap.activities.map((a) => ({ code: a.code, name: a.name, type: a.type, duration: a.duration, start: a.start, finish: a.finish, totalFloat: a.totalFloat, critical: a.critical, qty: a.qty, uom: a.uom })) };
    },
  };

  /** The dates of the current baseline for the bars of the Gantt (13.02 contract: `baseline`), matched to the activities of a schedule by their code. */
  function ganttBaseline(actor, s) {
    if (!may(actor, 'plan.baseline.view', s.org_project_id)) return null; const r = currentOf(s.org_project_id); if (!r) return null; const snap = snapOf(r.id); const by = new Map(snap.activities.map((a) => [lower(a.code), a])); const dates = {};
    for (const a of db.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id)) { const b = by.get(lower(a.code)); if (b?.start && b?.finish) dates[a.id] = [b.start, b.finish]; }
    return { id: r.id, docNo: r.doc_no, baselineNo: r.baseline_no, name: r.name, start: r.start_date, finish: r.finish_date, dates };
  }

  // ---- FR-03: baseline against current -------------------------------------------------------------------------------------------------------------------------------------
  const VAR_COLUMNS = [['code', 'Code', 'text'], ['name', 'Activity', 'text'], ['wbs', 'WBS', 'text'], ['statusLabel', 'Status', 'text'], ['bStart', 'Baseline start', 'text'], ['bFinish', 'Baseline finish', 'text'], ['cStart', 'Current start', 'text'], ['cFinish', 'Current finish', 'text'], ['startVar', 'Start variance (days)', 'number'], ['finishVar', 'Finish variance (days)', 'number'], ['bDuration', 'Baseline duration', 'number'], ['cDuration', 'Current duration', 'number'], ['durationVar', 'Duration variance', 'number'], ['criticalLabel', 'Critical', 'text']];
  function compare(actor, id, q) {
    const r = row(actor, id); const base = snapOf(r.id); let cur; let against;
    if (q.withBaselineId) { const o = row(actor, q.withBaselineId); if (o.org_project_id !== r.org_project_id) fail([{ field: 'withBaselineId', message: 'Choose a baseline of the same project' }]); cur = snapOf(o.id); against = { kind: 'baseline', id: o.id, docNo: o.doc_no, label: `${o.doc_no} revision ${o.baseline_no}`, start: o.start_date, finish: o.finish_date, needsCalc: false }; }
    else {
      const sid = q.scheduleId ?? db.prepare("SELECT id FROM plan_schedules WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED') ORDER BY (status = 'APPROVED'), id DESC").get(r.org_project_id)?.id ?? r.schedule_id;
      const s = schedule(actor, sid); if (s.org_project_id !== r.org_project_id) fail([{ field: 'scheduleId', message: 'Choose a schedule of the same project' }]);
      cur = snapshotOf(s); against = { kind: 'schedule', id: s.id, docNo: s.doc_no, label: `${s.doc_no} v${s.version_no}`, start: s.start_date, finish: s.finish_date, needsCalc: Boolean(s.needs_calc), status: s.status };
    }
    const v = varianceOf(base, cur); const term = lower(q.q ?? '');
    let rows = v.rows.filter((x) => (q.only === 'slipped' ? x.slipped : q.only === 'critical' ? x.criticalSlip : q.only === 'milestones' ? x.milestone : q.only === 'changed' ? x.status !== 'SAME' : q.only === 'added' ? x.status === 'ADDED' : q.only === 'removed' ? x.status === 'REMOVED' : true));
    if (q.wbs) rows = rows.filter((x) => x.wbsCode && (lower(x.wbsCode) === lower(q.wbs) || lower(x.wbsCode).startsWith(`${lower(q.wbs)}.`)));
    if (term) rows = rows.filter((x) => lower(x.code).includes(term) || lower(x.name).includes(term));
    const dir = q.sort?.startsWith('-') ? -1 : 1; const key = (q.sort ?? '-finishVar').replace(/^-/, ''); const val = (x) => (key === 'code' ? x.code : key === 'startVar' ? x.startVar : key === 'durationVar' ? x.durationVar : key === 'cFinish' ? x.cFinish : x.finishVar);
    rows.sort((a, b) => { const x = val(a); const y = val(b); if (x == null && y == null) return a.code.localeCompare(b.code, 'en', { numeric: true }); if (x == null) return 1; if (y == null) return -1; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true })) * dir || a.code.localeCompare(b.code, 'en', { numeric: true }); });
    for (const x of rows) { x.statusLabel = VARIANCE_STATUS[x.status]; x.criticalLabel = x.critical ? 'Yes' : ''; }
    const wbs = [...new Map(v.rows.filter((x) => x.wbsCode).map((x) => [x.wbsCode, x.wbs])).entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })).map(([code, label]) => ({ code, label }));
    return { r, against, summary: v.summary, rows, wbs };
  }
  function variance(actor, id, q) {
    const c = compare(actor, id, q); const total = c.rows.length; const page = c.rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const chart = [...c.rows].filter((x) => x.bStart && x.bFinish && x.cStart && x.cFinish).slice(0, 25).map((x) => ({ code: x.code, name: x.name, bStart: x.bStart, bFinish: x.bFinish, cStart: x.cStart, cFinish: x.cFinish, finishVar: x.finishVar, critical: x.critical, milestone: x.milestone }));
    const filtered = { rows: total, slipped: c.rows.filter((x) => x.slipped).length, criticalSlipped: c.rows.filter((x) => x.criticalSlip).length, maxSlip: c.rows.reduce((m, x) => Math.max(m, x.finishVar ?? 0), 0) };
    return { baseline: listRow(actor, c.r), against: c.against, summary: c.summary, filtered, wbs: c.wbs, total, page: q.page, pageSize: q.pageSize, rows: page, chart, can: { export: may(actor, 'plan.baseline.export', c.r.org_project_id) } };
  }
  function varianceExport(actor, id, q) {
    const r = row(actor, id, 'plan.baseline.export'); const c = compare(actor, id, q); const columns = VAR_COLUMNS.map(([key, label, type]) => ({ key, label, type })); const s = c.summary;
    const title = `Variance of ${c.against.label} against baseline ${r.doc_no} (revision ${r.baseline_no})`; const name = `variance-${slug(r.doc_no)}-${todayIST()}`;
    const rows = [...c.rows, { code: 'Total', name: `${c.rows.length} activities`, statusLabel: `${c.rows.filter((x) => x.slipped).length} later, ${c.rows.filter((x) => x.criticalSlip).length} critical`, bFinish: s.baselineFinish ?? '', cFinish: s.currentFinish ?? '', finishVar: s.finishVar ?? '' }];
    const footer = [title, `Programme finish: baseline ${s.baselineFinish ?? '—'}, current ${s.currentFinish ?? '—'} (${signed(s.finishVar ?? 0)} days). ${s.slipped} later, ${s.criticalSlipped} of them critical; ${s.added} added, ${s.removed} removed.`, `Generated by ${actor.user} on ${todayIST()}`];
    audit(actor, 'plan_baselines', r.id, 'export', r.company_id, { newValues: { report: 'variance', against: c.against.label, rows: c.rows.length, format: q.format } });
    if (q.format === 'csv') return { buffer: toCsv({ columns, rows, footer }), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: c.rows.length };
    if (q.format === 'pdf') return { buffer: toPdf({ columns: columns.filter((x) => !['wbs', 'bDuration', 'cDuration', 'criticalLabel'].includes(x.key)), rows, footer, title }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: c.rows.length };
    return { buffer: toXlsx({ columns, rows, footer, sheetName: 'Variance' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: c.rows.length };
  }

  // ---- FR-06: the quality check ---------------------------------------------------------------------------------------------------------------------------------------------
  function qualityFor(actor, q, { scheduleId = null, baselineId = null }) {
    let model; let subject; let projectId;
    if (baselineId) { const r = row(actor, baselineId); model = snapOf(r.id); projectId = r.org_project_id; subject = { kind: 'baseline', id: r.id, docNo: r.doc_no, label: `Baseline ${r.doc_no} revision ${r.baseline_no}`, needsCalc: false }; }
    else { const s = schedule(actor, scheduleId); model = snapshotOf(s); projectId = s.org_project_id; subject = { kind: 'schedule', id: s.id, docNo: s.doc_no, label: `${s.doc_no} v${s.version_no}`, needsCalc: Boolean(s.needs_calc), status: s.status }; }
    const cur = !baselineId && may(actor, 'plan.baseline.view', projectId) ? currentOf(projectId) : null; const res = qualityOf(model, { highFloat: q.highFloat, longDuration: q.longDuration, tolerance: q.tolerance, baseline: cur ? snapOf(cur.id) : null });
    return { res, subject, projectId, baseline: cur ? { id: cur.id, docNo: cur.doc_no, baselineNo: cur.baseline_no } : null };
  }
  function quality(actor, q, target) {
    const x = qualityFor(actor, q, target); const one = q.check ? x.res.checks.find((c) => c.code === q.check) : null; if (q.check && !one) fail([{ field: 'check', message: `Choose one of ${Object.keys(QUALITY).join(', ')}` }]);
    const out = { subject: x.subject, baseline: x.baseline, summary: x.res.summary, params: x.res.params, checks: x.res.checks.map(({ items, ...c }) => ({ ...c, sample: items.slice(0, 5) })), can: { export: may(actor, 'plan.schedule.export', x.projectId) } };
    if (one) out.drill = { code: one.code, name: one.name, total: one.items.length, page: q.page, pageSize: q.pageSize, rows: one.items.slice((q.page - 1) * q.pageSize, q.page * q.pageSize) };
    return out;
  }
  function qualityExport(actor, q, target) {
    const x = qualityFor(actor, q, target); need(actor, target.baselineId ? 'plan.baseline.export' : 'plan.schedule.export', 'export this check', x.projectId);
    const columns = [{ key: 'check', label: 'Check', type: 'text' }, { key: 'what', label: 'What is counted', type: 'text' }, { key: 'found', label: 'Found', type: 'text' }, { key: 'threshold', label: 'Allowed', type: 'text' }, { key: 'status', label: 'Result', type: 'text' }, { key: 'code', label: 'Activity or link', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }];
    const rows = []; for (const c of x.res.checks) { rows.push({ check: c.name, what: c.description, found: c.valueLabel, threshold: c.threshold, status: c.status === 'NA' ? 'Not applicable' : c.status === 'PASS' ? 'Pass' : 'Fail', code: '', name: '', detail: '' }); if (q.format !== 'pdf') for (const i of c.items) rows.push({ check: c.name, what: '', found: '', threshold: '', status: '', code: i.code, name: i.name, detail: i.detail }); }
    const s = x.res.summary; const checks = x.res.checks.length; rows.push({ check: 'Total', what: `${s.activities} activities, ${s.links} links`, found: `${s.passed} passed, ${s.failed} failed, ${s.notApplicable} not applicable`, threshold: '', status: s.score == null ? '' : `${s.score} %`, code: '', name: '', detail: '' });
    const footer = [`Schedule quality check of ${x.subject.label}`, `Limits: high float over ${x.res.params.highFloat} days, long duration over ${x.res.params.longDuration} days, ${x.res.params.tolerance} % allowed.`, `Generated by ${actor.user} on ${todayIST()}`];
    const name = `quality-${slug(x.subject.docNo)}-${todayIST()}`; audit(actor, target.baselineId ? 'plan_baselines' : 'plan_schedules', x.subject.id, 'export', actor.companyId, { newValues: { report: 'schedule quality check', format: q.format, failed: s.failed } });
    if (q.format === 'csv') return { buffer: toCsv({ columns, rows, footer }), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: checks };
    if (q.format === 'pdf') return { buffer: toPdf({ columns: columns.slice(0, 5), rows, footer, title: `Schedule quality check of ${x.subject.label}` }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: checks };
    return { buffer: toXlsx({ columns, rows, footer, sheetName: 'Quality' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: checks };
  }

  // ---- FR-05: a schedule or a baseline as an MS Project or Primavera file ---------------------------------------------------------------------------------------------------
  function exchangeFile(actor, { scheduleId = null, baselineId = null }, { format }) {
    let snap; let docNo; let entity; let id; let companyId;
    if (baselineId) { const r = row(actor, baselineId, 'plan.baseline.export'); snap = snapOf(r.id); docNo = r.doc_no; entity = 'plan_baselines'; id = r.id; companyId = r.company_id; snap.schedule.docNo = r.doc_no; snap.schedule.name = r.name; }
    else { const s = schedule(actor, scheduleId); need(actor, 'plan.schedule.export', 'export this schedule', s.org_project_id); snap = snapshotOf(s); docNo = s.doc_no; entity = 'plan_schedules'; id = s.id; companyId = s.company_id; }
    // PACK-21 (ff.plan.pack21): a schedule written as MS Project XML carries the current approved baseline of its project as baseline 0, by activity code
    let withBaseline = null;
    if (!baselineId && format !== 'p6' && isEnabled(db, 'ff.plan.pack21', { companyId }) && may(actor, 'plan.baseline.view', schedRow(id).org_project_id)) {
      const cur = currentOf(schedRow(id).org_project_id); if (cur) { const by = new Map(snapOf(cur.id).activities.map((a) => [lower(a.code), a])); let n = 0; for (const a of snap.activities) { const b = by.get(lower(a.code)); if (b?.start && b?.finish) { a.baselineStart = b.start; a.baselineFinish = b.finish; a.baselineDuration = b.duration; n += 1; } } withBaseline = { docNo: cur.doc_no, activities: n }; }
    }
    const buffer = format === 'p6' ? toP6Xml(snap) : toMspXml(snap);
    audit(actor, entity, id, 'export', companyId, { newValues: { file: format === 'p6' ? 'Primavera P6 XML' : 'MS Project XML', activities: snap.activities.length, links: snap.links.length, ...(withBaseline ? { baseline: withBaseline.docNo, baselineActivities: withBaseline.activities } : {}) } });
    return { buffer, contentType: 'application/xml; charset=utf-8', fileName: `${slug(docNo)}-${format === 'p6' ? 'p6' : 'msp'}.xml`, rows: snap.activities.length };
  }

  // ---- FR-04, BR-02: reading a file into the working schedule -----------------------------------------------------------------------------------------------------------------
  const impRow = (actor, id) => {
    const r = db.prepare('SELECT * FROM plan_imports WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'plan.schedule.view', r.org_project_id)) throw notFound('That import does not exist.'); need(actor, 'plan.schedule.import', 'import schedules for this project', r.org_project_id); return r;
  };
  const impView = (actor, r, { detail = false } = {}) => {
    const s = db.prepare('SELECT doc_no, name, status, version_no, start_date FROM plan_schedules WHERE id = ?').get(r.schedule_id); const o = orgOf(r.org_project_id);
    const v = { id: r.id, projectId: r.org_project_id, projectCode: o?.code, scheduleId: r.schedule_id, scheduleDocNo: s?.doc_no, scheduleStatus: s?.status, fileName: r.file_name, fileSize: r.file_size, fileHash: r.file_sha256, format: r.format, formatLabel: FORMATS[r.format], mode: r.mode, status: r.status, statusLabel: IMPORT_STATUS[r.status], activities: r.activities_count, links: r.links_count, errors: r.errors_count, warnings: r.warnings_count, importedAt: r.imported_at, importedBy: r.imported_by, createdBy: r.created_by, createdAt: r.created_at, rowVersion: r.version,
      can: { apply: r.status === 'ANALYSED' && r.errors_count === 0 && ['DRAFT', 'RETURNED'].includes(s?.status), edit: r.status === 'ANALYSED', discard: r.status === 'ANALYSED' } };
    if (detail) { v.mapping = json(r.mapping_json, {}); v.result = json(r.result_json, {}); if (r.status === 'ANALYSED') v.options = optionsFor(actor, r, json(r.parsed_json, null)); }
    return v;
  };
  const usableCalendars = (companyId, projectId) => db.prepare("SELECT * FROM plan_calendars WHERE company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND (org_project_id IS NULL OR org_project_id = ?) ORDER BY code").all(companyId, projectId);
  const wbsOf = (projectId) => db.prepare("SELECT id, code, name FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL AND wbs_status = 'ACTIVE' ORDER BY code").all(projectId);
  const itemByCode = (companyId, code) => (code ? db.prepare("SELECT id, code, name, item_type, base_uom FROM mdm_items WHERE company_id = ? AND code = ? COLLATE NOCASE AND item_status = 'ACTIVE' AND deleted_at IS NULL").get(companyId, code) : null);
  const itemById = (companyId, id) => db.prepare("SELECT id, code, name, item_type, base_uom FROM mdm_items WHERE id = ? AND company_id = ? AND item_status = 'ACTIVE' AND deleted_at IS NULL").get(id, companyId);
  /** What the wizard offers for the mapping: the calendars, WBS nodes and resources of the file, and the calendars and WBS nodes of the project. */
  function optionsFor(actor, r, fm) {
    if (!fm) return null; const usedCal = new Map(); for (const a of fm.activities) { const k = a.calendarKey ?? fm.defaultCalendarKey; usedCal.set(k, (usedCal.get(k) ?? 0) + 1); } const usedWbs = new Map(); for (const a of fm.activities) if (a.wbsKey) usedWbs.set(a.wbsKey, (usedWbs.get(a.wbsKey) ?? 0) + 1);
    const usedRes = new Map(); for (const a of fm.assignments) usedRes.set(a.resourceKey, (usedRes.get(a.resourceKey) ?? 0) + 1);
    return {
      codeFrom: fm.format === 'MSP_XML' ? [['TEXT1', 'The "Activity code" text field'], ['WBS', 'The WBS code of the task'], ['ID', 'The row number (T1, T2, …)'], ['UID', 'The unique id (U1, U2, …)']].map(([code, label]) => ({ code, label })) : [],
      fileCalendars: fm.calendars.filter((c) => usedCal.has(c.key)).map((c) => ({ key: c.key, name: c.name, workWeek: c.workWeek, hoursPerDay: c.hoursPerDay, holidays: c.holidays.length, activities: usedCal.get(c.key), isDefault: c.key === fm.defaultCalendarKey })),
      fileWbs: fm.wbs.map((w) => ({ key: w.key, code: w.code, name: w.name, activities: usedWbs.get(w.key) ?? 0 })).slice(0, 2000), fileResources: fm.resources.filter((x) => usedRes.has(x.key)).map((x) => ({ key: x.key, code: x.code, name: x.name, type: x.type, uom: x.uom, assignments: usedRes.get(x.key) })),
      calendars: usableCalendars(r.company_id, r.org_project_id).map((c) => ({ id: c.id, code: c.code, name: c.name, workWeek: c.work_week })), wbs: wbsOf(r.org_project_id).map((w) => ({ id: w.id, code: w.code, name: w.name })),
      file: { name: fm.name, start: fm.start, finish: fm.finish, dataDate: fm.dataDate, activities: fm.activities.length, links: fm.links.length, calendars: fm.calendars.length, wbs: fm.wbs.length, resources: fm.resources.length, assignments: fm.assignments.length },
    };
  }
  /** The mapping proposed for a file: calendars by code or name, WBS nodes by code then name, resources by item code, else by trade. */
  function suggest(fm, s) {
    const cals = usableCalendars(s.company_id, s.org_project_id); const calOf = (name) => { const n = lower(name); return cals.find((c) => lower(`${c.code} ${c.name}`) === n || lower(c.code) === n || lower(c.name) === n)?.id ?? null; };
    const wbs = wbsOf(s.org_project_id); const byCode = new Map(wbs.map((w) => [lower(w.code), w.id])); const byName = new Map(wbs.map((w) => [lower(w.name), w.id]));
    const codes = fm.activities.map((a) => lower(a.wbsCode)); const wbsUnique = codes.every(Boolean) && new Set(codes).size === codes.length;
    const hasActs = s.activities_count > 0;
    return {
      mode: hasActs ? 'MERGE' : 'REPLACE', codeFrom: fm.format !== 'MSP_XML' ? 'ID' : fm.codeField === 'TEXT1' && fm.activities.every((a) => a.text1) ? 'TEXT1' : wbsUnique ? 'WBS' : 'ID', useFileStart: !hasActs && Boolean(fm.start), progress: true, resourcesOn: true,
      calendars: Object.fromEntries(fm.calendars.map((c) => [c.key, calOf(c.name)])), wbs: Object.fromEntries(fm.wbs.map((w) => [w.key, byCode.get(lower(w.code)) ?? byName.get(lower(w.name)) ?? null])),
      resources: Object.fromEntries(fm.resources.map((x) => { const it = itemByCode(s.company_id, x.code); const ok = it && ITEM_TYPES[x.type].includes(it.item_type); return [x.key, ok ? { type: x.type, itemId: it.id, trade: null, uom: it.base_uom ?? x.uom ?? DEFAULT_UOM[x.type], skip: false } : { type: x.type, itemId: null, trade: x.name.slice(0, 80), uom: x.uom ?? DEFAULT_UOM[x.type], skip: false }]; })),
    };
  }
  const codeFor = (fm, a, from) => { const raw = fm.format !== 'MSP_XML' ? a.code : from === 'TEXT1' ? a.text1 : from === 'WBS' ? a.wbsCode : from === 'UID' ? `U${a.uid}` : `T${a.id}`; return raw == null ? null : String(raw).trim(); };
  /**
   * The validation report of a file under a mapping, and the rows it would write. Errors stop the import; warnings say what is carried differently. Nothing is written here.
   */
  function validate(fm, m, s) {
    const notes = { error: [], warning: [], info: [] }; const counts = {}; const say = (level, code, message, ref = null) => { counts[code] = (counts[code] ?? 0) + 1; if (notes[level].length < NOTE_LIMIT) notes[level].push({ code, message, ref }); };
    for (const n of fm.notes) say(n.level === 'info' ? 'info' : 'warning', n.code, n.message, n.ref);
    if (!fm.activities.length) say('error', 'NO_ACTIVITIES', 'The file has no activities');
    const cals = new Map(usableCalendars(s.company_id, s.org_project_id).map((c) => [c.id, c])); const wbsIds = new Set(wbsOf(s.org_project_id).map((w) => w.id)); const fileCal = new Map(fm.calendars.map((c) => [c.key, c]));
    for (const [k, v] of Object.entries(m.calendars ?? {})) if (v != null && !cals.has(v)) say('error', 'MAPPING_CALENDAR', `The calendar chosen for "${fileCal.get(k)?.name ?? k}" is not a calendar in force for this project`, k);
    for (const [k, v] of Object.entries(m.wbs ?? {})) if (v != null && !wbsIds.has(v)) say('error', 'MAPPING_WBS', `The WBS node chosen for "${k}" is not a node of this project`, k);
    // the activities
    const seen = new Map(); const acts = []; let rounded = 0; let changedCodes = 0; let noWbs = 0; const calUse = new Map(); const byKey = new Map();
    for (const a of fm.activities) {
      const ref = a.id ?? a.key; let code = codeFor(fm, a, m.codeFrom);
      if (!code) { say('error', 'CODE_MISSING', `Activity "${a.name}" (${ref}) has no code in the field chosen`, ref); continue; }
      if (!CODE_OK.test(code)) { const fixed = code.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30); if (!fixed) { say('error', 'CODE_INVALID', `The code "${code}" cannot be used`, ref); continue; } changedCodes += 1; if (changedCodes <= 20) say('warning', 'CODE_CHANGED', `The code "${code}" is written as "${fixed}" (letters, digits, dot, dash and underscore, at most 30)`, ref); else counts.CODE_CHANGED = (counts.CODE_CHANGED ?? 0) + 1; code = fixed; }
      if (seen.has(lower(code))) { say('error', 'CODE_DUPLICATE', `The code ${code} is given to two activities ("${seen.get(lower(code))}" and "${a.name}")`, ref); continue; } seen.set(lower(code), a.name);
      const name = a.name.slice(0, 200); if (name.length < 2) { say('error', 'NAME_MISSING', `Activity ${code} has no name`, ref); continue; }
      let type = a.type; let dur = Math.round(a.durationDays); if (Math.abs(a.durationDays - dur) > 0.01) rounded += 1;
      if (type === 'MILESTONE') dur = 0; else if (dur <= 0) { if (a.durationDays > 0) dur = 1; else { type = 'MILESTONE'; say('warning', 'ZERO_DURATION', `Activity ${code} has no duration: it is read as a milestone`, ref); } }
      if (dur > 36500) { say('error', 'DURATION_RANGE', `Activity ${code} is ${dur} days long: at most 36500`, ref); continue; }
      const fk = a.calendarKey ?? fm.defaultCalendarKey; const mapped = fk != null ? m.calendars?.[fk] ?? null : null; calUse.set(fk, (calUse.get(fk) ?? 0) + 1);
      const wbsId = a.wbsKey ? m.wbs?.[a.wbsKey] ?? null : null; if (a.wbsKey && !wbsId) noWbs += 1;
      let as = m.progress ? a.actualStart : null; let af = m.progress ? a.actualFinish : null; let pct = m.progress ? a.pct : 0;
      if (af && !as) { as = a.start && a.start <= af ? a.start : af; say('warning', 'PROGRESS_FIXED', `Activity ${code} is finished without an actual start: ${as} is taken`, ref); }
      if (as && af && af < as) { say('warning', 'PROGRESS_DROPPED', `Activity ${code}: the actual finish is before the actual start; its progress is not carried`, ref); as = null; af = null; pct = 0; }
      if (!as && pct > 0) { pct = 0; say('warning', 'PROGRESS_DROPPED', `Activity ${code} has a percentage but no actual start: its progress is not carried`, ref); }
      const row = { key: a.key, code, name, type, duration: dur, wbsId: wbsId && wbsIds.has(wbsId) ? wbsId : null, calendarId: mapped && cals.has(mapped) && mapped !== s.calendar_id ? mapped : null, constraintType: a.constraintType, constraintDate: a.constraintType === 'NONE' ? null : a.constraintDate, actualStart: as, actualFinish: af, pct: af ? 100 : Math.round(pct * 100) / 100, remaining: as && !af ? (a.remainingDays != null ? Math.max(0, Math.round(a.remainingDays)) : Math.max(0, Math.round(dur * (100 - pct) / 100))) : af ? 0 : null, fileStart: a.start, fileFinish: a.finish };
      acts.push(row); byKey.set(a.key, row);
    }
    if (rounded) say('warning', 'DURATION_ROUNDED', `${rounded} activit${rounded === 1 ? 'y has a duration' : 'ies have durations'} that are not whole days: rounded to the nearest day`);
    if (noWbs) say('warning', 'WBS_UNMAPPED', `${noWbs} activit${noWbs === 1 ? 'y sits' : 'ies sit'} under a WBS node of the file that is not matched to a node of the project: placed without a WBS node`);
    // the calendars: what is not matched works on the calendar of the schedule; a difference in working days is told
    const sCal = cals.get(s.calendar_id) ?? db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(s.calendar_id); const from = ordOf(fm.start ?? s.start_date); const to = Math.min(from + 1100, ordOf(fm.finish ?? fm.start ?? s.start_date) + 30);
    for (const [fk, n] of calUse) {
      const fc = fileCal.get(fk); if (!fc) continue; const mapped = m.calendars?.[fk] ?? null; const target = mapped && cals.has(mapped) ? cals.get(mapped) : sCal;
      if (!mapped && fk !== fm.defaultCalendarKey) say('warning', 'CALENDAR_UNMAPPED', `The calendar "${fc.name}" of the file (${n} activities) is not matched: they work on the calendar of the schedule (${sCal.code})`, fk);
      const a = makeCalendar({ workWeek: fc.workWeek, holidays: fc.holidays, exceptions: fc.exceptions.map((d) => ({ date: d, working: true })) }); const b = plan.calendarOf(target); let diff = 0; for (let o = from; o <= to; o += 1) if (a.isWork(o) !== b.isWork(o)) diff += 1;
      if (diff) say('warning', 'CALENDAR_DIFFERS', `The calendar "${fc.name}" of the file and ${target.code} ${target.name} differ on ${diff} day(s) of the programme: the dates worked out here will differ from the file`, fk);
    }
    // the links
    const summaries = new Set(fm.summaryKeys ?? []); const links = []; const pairs = new Set(); let lagRounded = 0;
    for (const l of fm.links) {
      const p = byKey.get(l.predKey); const q = byKey.get(l.succKey);
      if (!p || !q) { say('warning', summaries.has(l.predKey) || summaries.has(l.succKey) ? 'LINK_SUMMARY' : 'LINK_DANGLING', summaries.has(l.predKey) || summaries.has(l.succKey) ? `A link on a summary task (${l.predKey} → ${l.succKey}) is left out: link the activities themselves` : `A link to an activity that is not read (${l.predKey} → ${l.succKey}) is left out`, l.succKey); continue; } // PACK-21: the row of the link (its successor) is named
      if (p === q) { say('warning', 'LINK_SELF', `Activity ${p.code} is linked to itself: left out`); continue; }
      const pk = `${p.key}>${q.key}`; if (pairs.has(pk)) { say('warning', 'LINK_DUPLICATE', `${p.code} → ${q.code} is linked twice: the first link is kept`); continue; } pairs.add(pk);
      const lag = Math.round(l.lagDays); if (Math.abs(l.lagDays - lag) > 0.01) lagRounded += 1; if (Math.abs(lag) > 3650) { say('error', 'LAG_RANGE', `The lag of ${p.code} → ${q.code} is ${lag} days: at most 3650`); continue; }
      links.push({ predKey: p.key, succKey: q.key, type: l.type, lag });
    }
    if (lagRounded) say('warning', 'LAG_ROUNDED', `${lagRounded} lag(s) are not whole days: rounded to the nearest day`);
    const idx = new Map(acts.map((a, i) => [a.key, i + 1])); const cyc = acts.length ? findCycle(acts.map((a) => idx.get(a.key)), links.map((l) => ({ pred: idx.get(l.predKey), succ: idx.get(l.succKey) }))) : null;
    if (cyc?.length) say('error', 'LOOP', `The logic of the file has a loop: ${cyc.map((i) => acts[i - 1].code).join(' → ')}`);
    // the resources
    const res = []; if (m.resourcesOn !== false) {
      const fr = new Map(fm.resources.map((x) => [x.key, x])); const merged = new Map();
      for (const a of fm.assignments) {
        const act = byKey.get(a.activityKey); const map = m.resources?.[a.resourceKey]; const x = fr.get(a.resourceKey); if (!act || !x || !map || map.skip) continue;
        const it = map.itemId ? itemById(s.company_id, map.itemId) : null; if (map.itemId && (!it || !ITEM_TYPES[map.type].includes(it.item_type))) { say('error', 'MAPPING_RESOURCE', `The item chosen for "${x.name}" is not ${lower(map.type)} of the item master`, a.resourceKey); continue; }
        const trade = map.type === 'LABOUR' ? (map.trade || it?.name || x.name) : (map.trade ?? (it ? null : x.name)); const uom = map.uom || it?.base_uom || DEFAULT_UOM[map.type]; const qty = a.unit === 'hour' && !HOURLY.test(uom) ? a.qty / (fm.hoursPerDay || 8) : a.qty;
        const key = keyOf(map.type, it?.id, trade, it?.name); const mk = `${act.key}|${map.type}|${key}`; const cur = merged.get(mk);
        if (cur) cur.qty += qty; else { const r = { activityKey: act.key, type: map.type, itemId: it?.id ?? null, trade: trade ? String(trade).slice(0, 80) : null, key, label: (it ? `${it.code} ${it.name}` : String(trade)).slice(0, 200), uom: String(uom).slice(0, 20), qty }; merged.set(mk, r); res.push(r); }
      }
    }
    // what the schedule holds now
    const existing = db.prepare('SELECT code, actual_start FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id); const have = new Set(existing.map((e) => lower(e.code))); const inFile = new Set(acts.map((a) => lower(a.code)));
    const updates = acts.filter((a) => have.has(lower(a.code))).length; const kept = existing.filter((e) => !inFile.has(lower(e.code)));
    if (m.mode === 'REPLACE' && existing.length) say('warning', 'REPLACE_REMOVES', `The ${existing.length} activit${existing.length === 1 ? 'y' : 'ies'} of ${s.doc_no} are replaced by the file${existing.some((e) => e.actual_start) ? ' (some have progress)' : ''}`);
    if (m.mode === 'MERGE' && existing.length) say('info', 'MERGE', `${updates} activit${updates === 1 ? 'y is' : 'ies are'} updated by their code, ${acts.length - updates} added, ${kept.length} of ${s.doc_no} left as they are`);
    { const bl = fm.activities.filter((a) => a.baselineStart && a.baselineFinish).length; if (bl) say('info', 'BASELINE_IN_FILE', `${bl} activit${bl === 1 ? 'y carries' : 'ies carry'} a baseline in the file: kept for comparison only; a baseline of this project is made and approved here`); }
    if (fm.start && fm.start !== s.start_date) say('info', 'START', m.useFileStart ? `The start of ${s.doc_no} becomes ${fm.start} (it is ${s.start_date})` : `The file starts on ${fm.start}; ${s.doc_no} keeps its start ${s.start_date}`);
    const report = {
      summary: { format: fm.format, name: fm.name, start: fm.start, finish: fm.finish, dataDate: fm.dataDate, activities: acts.length, milestones: acts.filter((a) => a.type === 'MILESTONE').length, links: links.length, calendars: calUse.size, wbsNodes: fm.wbs.length, wbsMatched: Object.values(m.wbs ?? {}).filter(Boolean).length, resources: new Set(res.map((r) => `${r.type}|${r.key}`)).size, assignments: res.length, withProgress: acts.filter((a) => a.actualStart).length, toUpdate: m.mode === 'MERGE' ? updates : 0, toAdd: m.mode === 'MERGE' ? acts.length - updates : acts.length, toRemove: m.mode === 'REPLACE' ? existing.length : 0 },
      errors: notes.error, warnings: notes.warning, info: notes.info, counts, errorCount: Object.entries(counts).filter(([k]) => ERROR_CODES.has(k)).reduce((t, [, n]) => t + n, 0), warningCount: 0,
    };
    report.warningCount = Object.entries(counts).filter(([k]) => !ERROR_CODES.has(k) && !INFO_CODES.has(k)).reduce((t, [, n]) => t + n, 0);
    return { report, acts, links, res };
  }
  const targetSchedule = (actor, scheduleId) => {
    const s = schedule(actor, scheduleId); need(actor, 'plan.schedule.import', 'import a file into this schedule', s.org_project_id);
    if (!['DRAFT', 'RETURNED'].includes(s.status)) throw conflict(`${s.doc_no} is ${lower(s.status)}: a file is read into the working schedule only (a draft or a returned one). Amend the schedule to get a working version; a baseline is never changed by an import.`);
    return s;
  };
  const cleanMapping = (fm, base, given = {}) => {
    const pick = (k, allowed, d) => (allowed.includes(given[k]) ? given[k] : d); const out = { mode: pick('mode', ['REPLACE', 'MERGE'], base.mode), codeFrom: fm.format === 'MSP_XML' ? pick('codeFrom', ['TEXT1', 'WBS', 'ID', 'UID'], base.codeFrom) : 'ID', useFileStart: typeof given.useFileStart === 'boolean' ? given.useFileStart : base.useFileStart, progress: typeof given.progress === 'boolean' ? given.progress : base.progress, resourcesOn: typeof given.resourcesOn === 'boolean' ? given.resourcesOn : base.resourcesOn ?? true, calendars: {}, wbs: {}, resources: {} };
    for (const c of fm.calendars) out.calendars[c.key] = c.key in (given.calendars ?? {}) ? given.calendars[c.key] ?? null : base.calendars[c.key] ?? null;
    for (const w of fm.wbs) out.wbs[w.key] = w.key in (given.wbs ?? {}) ? given.wbs[w.key] ?? null : base.wbs[w.key] ?? null;
    for (const x of fm.resources) { const g = given.resources?.[x.key]; const b = base.resources[x.key]; out.resources[x.key] = g ? { type: g.type ?? b.type, itemId: g.itemId ?? null, trade: g.itemId ? null : (g.trade ?? b.trade ?? x.name), uom: g.uom ?? b.uom, skip: Boolean(g.skip) } : b; }
    return out;
  };

  const imports = {
    list(actor, { scheduleId = null, projectId = null }) {
      let pid = projectId; if (scheduleId) pid = schedule(actor, scheduleId).org_project_id; const o = orgOf(Number(pid)); if (!o || o.company_id !== actor.companyId || !may(actor, 'plan.schedule.view', o.id)) throw notFound('That project does not exist.');
      need(actor, 'plan.schedule.import', 'see the imports of this project', o.id);
      return { projectId: o.id, rows: db.prepare(`SELECT * FROM plan_imports WHERE org_project_id = ? AND deleted_at IS NULL ${scheduleId ? 'AND schedule_id = ?' : ''} ORDER BY id DESC LIMIT 100`).all(...(scheduleId ? [o.id, scheduleId] : [o.id])).map((r) => impView(actor, r)), formats: Object.entries(FORMATS).map(([code, label]) => ({ code, label })) };
    },
    get(actor, id) { return impView(actor, impRow(actor, id), { detail: true }); },
    /** Step 1 of the wizard: the file is read and checked, and a mapping proposed. Nothing of the schedule changes. */
    analyse(actor, { scheduleId, format = null, fileName }, buffer) {
      const s = targetSchedule(actor, scheduleId); let fm;
      try { fm = parseFile(buffer, format); } catch (x) { if (x instanceof ExchangeError) throw badRequest('The file cannot be read', [{ field: 'file', message: x.message }]); throw x; }
      const base = suggest(fm, s); const mapping = cleanMapping(fm, base); const v = validate(fm, mapping, s);
      const id = Number(db.prepare("INSERT INTO plan_imports (company_id, org_project_id, schedule_id, file_name, file_sha256, file_size, format, mode, mapping_json, parsed_json, result_json, activities_count, links_count, errors_count, warnings_count, status, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ANALYSED', ?, ?, 'upload')")
        .run(s.company_id, s.org_project_id, s.id, String(fileName).slice(0, 200), createHash('sha256').update(buffer).digest('hex'), buffer.length, fm.format, mapping.mode, JSON.stringify(mapping), JSON.stringify(fm), JSON.stringify({ report: v.report }), v.acts.length, v.links.length, v.report.errorCount, v.report.warningCount, s.org_project_id, actor.user).lastInsertRowid);
      audit(actor, 'plan_imports', id, 'analyse', s.company_id, { newValues: { file: String(fileName).slice(0, 200), format: fm.format, schedule: s.doc_no, activities: v.acts.length, errors: v.report.errorCount } });
      return imports.get(actor, id);
    },
    /** Step 2: the mapping is changed and the file checked again under it. */
    update(actor, id, b) {
      const r = impRow(actor, id); if (r.status !== 'ANALYSED') throw conflict(`This import is ${lower(IMPORT_STATUS[r.status])}: its mapping is not changed.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this import; reload it.');
      const s = schedRow(r.schedule_id); const fm = json(r.parsed_json, null); if (!fm) throw unprocessable('The file of this import is no longer kept: read it again.');
      const mapping = cleanMapping(fm, json(r.mapping_json, {}), b.mapping ?? {}); const v = validate(fm, mapping, s);
      db.prepare('UPDATE plan_imports SET mapping_json = ?, mode = ?, result_json = ?, activities_count = ?, links_count = ?, errors_count = ?, warnings_count = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(mapping), mapping.mode, JSON.stringify({ report: v.report }), v.acts.length, v.links.length, v.report.errorCount, v.report.warningCount, actor.user, nowIso(), r.id);
      return imports.get(actor, r.id);
    },
    discard(actor, id) {
      const r = impRow(actor, id); if (r.status !== 'ANALYSED') throw conflict(`This import is ${lower(IMPORT_STATUS[r.status])}.`);
      db.prepare("UPDATE plan_imports SET status = 'DISCARDED', parsed_json = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id); audit(actor, 'plan_imports', r.id, 'discard', r.company_id); return imports.get(actor, r.id);
    },
    /** Step 3: the file is written into the working schedule and the schedule calculated. One transaction: all of it or nothing. */
    apply(actor, id, b = {}) {
      const r = impRow(actor, id); if (r.status !== 'ANALYSED') throw conflict(r.status === 'IMPORTED' ? 'This file was applied already.' : 'This import was discarded: read the file again.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this import; reload it.');
      const s = targetSchedule(actor, r.schedule_id); const fm = json(r.parsed_json, null); if (!fm) throw unprocessable('The file of this import is no longer kept: read it again.');
      const m = json(r.mapping_json, {}); const v = validate(fm, m, s);
      if (v.report.errorCount) throw Object.assign(unprocessable(`The file has ${v.report.errorCount} error(s): correct the file or the mapping first.`), { details: v.report.errors.slice(0, 20).map((e) => ({ field: 'file', message: e.message })) });
      return transaction(db, () => {
        const now = nowIso(); const stamp = [now, actor.user]; let removed = 0; let updated = 0; let created = 0;
        const dataDate = m.progress && v.acts.some((a) => a.actualStart) ? [fm.dataDate, ...v.acts.flatMap((a) => [a.actualStart, a.actualFinish])].filter(Boolean).sort().at(-1) : null; const start = m.useFileStart && fm.start ? fm.start : s.start_date;
        db.prepare('UPDATE plan_schedules SET start_date = ?, data_date = ?, needs_calc = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(start, dataDate && dataDate >= start ? dataDate : (s.data_date && s.data_date >= start ? s.data_date : null), actor.user, now, s.id);
        if (m.mode === 'REPLACE') {
          for (const t of ['plan_dependencies', 'plan_activity_resources']) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE schedule_id = ? AND deleted_at IS NULL`).run(...stamp, s.id);
          db.prepare('UPDATE plan_activity_boq SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE deleted_at IS NULL AND activity_id IN (SELECT id FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL)').run(...stamp, s.id);
          removed = Number(db.prepare('UPDATE plan_activities SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE schedule_id = ? AND deleted_at IS NULL').run(...stamp, s.id).changes);
        }
        const have = new Map(db.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id).map((a) => [lower(a.code), a.id])); let sort = db.prepare('SELECT MAX(sort_order) AS m FROM plan_activities WHERE schedule_id = ?').get(s.id).m ?? 0; const idOf = new Map();
        const ins = db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, wbs_id, act_type, duration_days, calendar_id, constraint_type, constraint_date, actual_start, actual_finish, pct_complete, pct_source, remaining_days, sort_order, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, 'import', ?)");
        const upd = db.prepare('UPDATE plan_activities SET name = ?, wbs_id = COALESCE(?, wbs_id), act_type = ?, duration_days = ?, calendar_id = ?, constraint_type = ?, constraint_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?');
        const prog = db.prepare("UPDATE plan_activities SET actual_start = ?, actual_finish = ?, pct_complete = ?, pct_source = 'MANUAL', remaining_days = ? WHERE id = ?");
        for (const a of v.acts) {
          const ex = have.get(lower(a.code));
          if (ex) { upd.run(a.name, a.wbsId, a.type, a.duration, a.calendarId, a.constraintType, a.constraintDate, actor.user, now, ex); if (m.progress) prog.run(a.actualStart, a.actualFinish, Math.round(a.pct * 100), a.remaining, ex); idOf.set(a.key, ex); updated += 1; }
          else { sort += 10; idOf.set(a.key, Number(ins.run(s.company_id, s.id, a.code, a.name, a.wbsId, a.type, a.duration, a.calendarId, a.constraintType, a.constraintDate, a.actualStart, a.actualFinish, Math.round(a.pct * 100), a.remaining, sort, s.org_project_id, actor.user, String(r.id)).lastInsertRowid)); created += 1; }
        }
        // the logic of the activities of the file is the logic of the file: their earlier links among themselves go, links to activities the file does not name stay
        const ids = [...idOf.values()];
        if (m.mode === 'MERGE' && updated) { const inFile = new Set(ids); for (const d of db.prepare('SELECT id, pred_id, succ_id FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id)) if (inFile.has(d.pred_id) && inFile.has(d.succ_id)) db.prepare('UPDATE plan_dependencies SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(...stamp, d.id); }
        const insLink = db.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id, dep_type, lag_days, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', ?)");
        for (const l of v.links) insLink.run(s.company_id, s.id, idOf.get(l.predKey), idOf.get(l.succKey), l.type, l.lag, s.org_project_id, actor.user, String(r.id));
        let resources = 0;
        if (m.resourcesOn !== false && v.res.length) {
          const durOf = new Map(v.acts.map((a) => [a.key, Math.max(1, a.duration)])); const touched = new Set(v.res.map((x) => idOf.get(x.activityKey)));
          if (m.mode === 'MERGE') for (const aid of touched) db.prepare('UPDATE plan_activity_resources SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE activity_id = ? AND deleted_at IS NULL').run(...stamp, aid);
          const insRes = db.prepare("INSERT INTO plan_activity_resources (company_id, schedule_id, activity_id, resource_type, item_id, trade, res_key, label, uom, basis, qty_total, qty_per_day, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'TOTAL', ?, ?, ?, ?, 'import', ?)");
          for (const x of v.res) { const total = Math.round(x.qty * 1000); if (total <= 0) continue; insRes.run(s.company_id, s.id, idOf.get(x.activityKey), x.type, x.itemId, x.trade, x.key, x.label, x.uom, total, Math.round(total / durOf.get(x.activityKey)), s.org_project_id, actor.user, String(r.id)); resources += 1; }
        }
        // a link of the schedule that stays (MERGE) may close a loop with the links of the file: the calculation refuses it and nothing is kept
        const calc = plan.runCalc(actor, s.id); const after = new Map(db.prepare('SELECT id, es, ef FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id).map((a) => [a.id, a]));
        const differ = v.acts.filter((a) => !a.actualStart && a.fileStart && a.fileFinish).map((a) => ({ a, n: after.get(idOf.get(a.key)) })).filter(({ a, n }) => n && (n.es !== a.fileStart || n.ef !== a.fileFinish));
        const result = { report: v.report, applied: { created, updated, removed, links: v.links.length, resources, start, finish: calc.finishDate, fileFinish: fm.finish, dataDate: calc.dataDate ?? null, datesCompared: v.acts.filter((a) => !a.actualStart && a.fileStart && a.fileFinish).length, datesDiffer: differ.length, sample: differ.slice(0, 20).map(({ a, n }) => ({ code: a.code, fileStart: a.fileStart, fileFinish: a.fileFinish, start: n.es, finish: n.ef })) } };
        db.prepare("UPDATE plan_imports SET status = 'IMPORTED', imported_at = ?, imported_by = ?, result_json = ?, parsed_json = NULL, activities_count = ?, links_count = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, JSON.stringify(result), v.acts.length, v.links.length, actor.user, now, r.id);
        audit(actor, 'plan_schedules', s.id, 'import', s.company_id, { newValues: { importId: r.id, file: r.file_name, format: r.format, mode: m.mode, created, updated, removed, links: v.links.length, resources } });
        publishEvent(db, { type: 'plan.schedule.imported', entity: 'plan_schedule', entityId: s.id, actorId: actor.user, companyId: s.company_id, projectId: s.org_project_id, data: { scheduleId: s.id, projectId: s.org_project_id, importId: r.id, format: r.format, mode: m.mode, created, updated, removed, links: v.links.length, finish: calc.finishDate ?? null } });
        return imports.get(actor, r.id);
      });
    },
  };

  return { baselines, imports, variance, varianceExport, quality, qualityExport, exchangeFile, ganttBaseline, snapshotOf, baselineDecide: baselines.decide };
}
