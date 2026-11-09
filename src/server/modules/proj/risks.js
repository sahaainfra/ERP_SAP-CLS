import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { alertDatasets, alertsOf } from '../../platform/alerts/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { evidenceProviders, workflowOf, workflowResolvers, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import {
  HEATMAP_DEFAULTS, ISSUE_STATUS, RISK_CATEGORIES, RISK_CLOSE_DOC, RISK_LEVELS, RISK_LEVEL_ORDER, RISK_REVIEW_DOC, RISK_STATUS, RISK_STRATEGIES, RISK_STRATEGY_OF, RTYPES, SNAP_STATUS, TRIGGER_COMPARATORS,
  emvOf, esc, json, levelOf, money, nowIso, rid, same, units,
} from './constants.js';

// Risks, opportunities and issues of a project (part 10.06). A risk (a threat) or an opportunity has a cause, an effect, a category, an owner, a probability and an impact on cost, time, quality and safety (1 to 5): the score is the probability times
// the worst impact and its level (low, medium, high, critical) comes from thresholds the project sets (BR-01); the response strategy, the residual rating and the exposure (minimum, most likely, maximum for cost and for days) follow, and the expected
// monetary value (EMV) is the probability in percent times the most likely cost, worked out on the server. The response actions become tasks (04.08); early-warning triggers compare a reading with a threshold and raise an alert (04.09) when passed;
// contingency is allocated to risks out of the project's pool and drawn down by a request that the budget (12.02) executes. Closing a high or critical risk needs the owner's justification and the approval of the project manager (BR-02). The monthly
// review freezes the figures of the register into a snapshot, approved by the project manager and then the project director. The issue log holds the problems that have already happened.
const TASK_STATUS = { OPEN: 'OPEN', ACCEPTED: 'OPEN', IN_PROGRESS: 'IN_PROGRESS', BLOCKED: 'BLOCKED', DONE: 'DONE', VERIFIED: 'DONE', CLOSED: 'DONE', CANCELLED: 'CANCELLED' };
const ACTION_STATUS_LABEL = { OPEN: 'Open', IN_PROGRESS: 'In progress', BLOCKED: 'Blocked', DONE: 'Done', CANCELLED: 'Cancelled' };
const WORST = 'MAX(x.impact_cost, x.impact_time, x.impact_quality, x.impact_safety)';
const toPaise = (v) => units(v ?? '0', 'money');

export const riskList = defineList({
  code: 'proj.risks', label: 'Risks and opportunities', permission: 'proj.risk.view',
  from: 'proj_risks x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'p.code', 'x.owner_user', 'x.description'], defaultSort: '-score',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'No.' }, type: { sql: 'x.rtype', type: 'enum', label: 'Type', options: Object.entries(RTYPES) }, title: { sql: 'x.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    category: { sql: 'x.category', type: 'enum', label: 'Category', options: Object.entries(RISK_CATEGORIES) }, owner: { sql: 'x.owner_user', type: 'text', label: 'Owner' }, probability: { sql: 'x.probability', type: 'number', label: 'Probability' },
    impact: { sql: WORST, type: 'number', label: 'Impact' }, score: { sql: 'x.score', type: 'number', label: 'Score' }, level: { sql: 'x.level', type: 'enum', label: 'Level', options: Object.entries(RISK_LEVELS) },
    strategy: { sql: 'x.strategy', type: 'enum', label: 'Response', options: Object.entries(RISK_STRATEGIES) }, emv: { sql: '(x.emv / 100.0)', type: 'money', label: 'EMV (₹)' }, exposure: { sql: '(x.exposure_cost_ml / 100.0)', type: 'money', label: 'Most likely cost (₹)' },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(RISK_STATUS) }, wbsId: { sql: 'x.wbs_id', type: 'number', label: 'WBS id' },
  },
});
export const issueList = defineList({
  code: 'proj.issues', label: 'Issue log', permission: 'proj.issue.view',
  from: 'proj_risk_issues x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'p.code', 'x.owner_user', 'x.description'], defaultSort: '-priorityRank',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'No.' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' },
    priority: { sql: 'x.priority', type: 'enum', label: 'Priority', options: [['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High'], ['CRITICAL', 'Critical']] },
    priorityRank: { sql: "(CASE x.priority WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END)", type: 'number', label: 'Priority rank' }, owner: { sql: 'x.owner_user', type: 'text', label: 'Owner' },
    dueDate: { sql: 'x.due_date', type: 'date', label: 'Due' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(ISSUE_STATUS) }, impactCost: { sql: '(x.impact_cost / 100.0)', type: 'money', label: 'Cost impact (₹)' },
    impactTime: { sql: 'x.impact_time', type: 'number', label: 'Delay (days)' },
    overdue: { sql: "(CASE WHEN x.due_date IS NOT NULL AND x.due_date < date('now', '+330 minutes') AND x.status IN ('OPEN', 'IN_PROGRESS') THEN 1 ELSE 0 END)", type: 'number', label: 'Overdue' },
  },
});

/** What 12.02 (the budget), 23.11 (the forecast at completion) and 21.06 (claims) read: the live exposure of a project's register. */
export function riskExposureOf(db, orgProjectId) {
  const r = db.prepare("SELECT COALESCE(SUM(CASE WHEN rtype = 'RISK' THEN emv END), 0) AS risk_emv, COALESCE(SUM(CASE WHEN rtype = 'OPPORTUNITY' THEN emv END), 0) AS opp_emv, COALESCE(SUM(CASE WHEN rtype = 'RISK' THEN exposure_cost_ml END), 0) AS risk_ml, COALESCE(SUM(CASE WHEN rtype = 'RISK' THEN exposure_cost_max END), 0) AS risk_max, COALESCE(SUM(CASE WHEN rtype = 'RISK' THEN exposure_time_ml END), 0) AS days_ml, COALESCE(SUM(contingency_allocated), 0) AS allocated FROM proj_risks WHERE org_project_id = ? AND status IN ('OPEN', 'CLOSE_REQUESTED') AND deleted_at IS NULL").get(orgProjectId);
  const drawn = db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM proj_risk_contingency WHERE org_project_id = ? AND kind = 'DRAWDOWN' AND entry_status IN ('REQUESTED', 'EXECUTED') AND deleted_at IS NULL").get(orgProjectId).n;
  return { riskEmv: r.risk_emv, opportunityEmv: r.opp_emv, riskMostLikely: r.risk_ml, riskMax: r.risk_max, delayDaysMostLikely: r.days_ml, contingencyAllocated: r.allocated, contingencyDrawn: drawn };
}
/** Later parts (12.02) register how a drawdown request is executed; the request stays "requested" until one of them marks it executed. */
export const drawdownExecutors = [];

const services = new WeakMap();
export const bindRisks = (db, s) => services.set(db, s);
export const risksOf = (db) => services.get(db) ?? null;

const mapOf = (l) => new Map(l.map((x) => [x[0], x[1]]));
void mapOf;

export function createRiskService({ db }) {
  const authz = authzOf(db);
  const may = (actor, key, pid = null) => (pid == null ? authz.check(actor, key).allowed : authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed);
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const event = (type, actor, entity, id, companyId, projectId, data) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, projectId, data });
  const orgOf = (id) => db.prepare('SELECT * FROM org_projects WHERE id = ?').get(id);
  const userOf = (companyId, u) => db.prepare('SELECT username, display_name FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(companyId, u);
  const scopeSql = (actor, perm, col = 'x.org_project_id') => { const f = authz.scopeFilter(actor, perm, { project: col }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  function project(actor, projectId, key, base) {
    const o = orgOf(Number(projectId));
    if (!o || o.company_id !== actor.companyId || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(o.id) || !may(actor, base, o.id)) throw notFound('That project does not exist.');
    if (key !== base) need(actor, key, 'do that with the register', o.id);
    return o;
  }
  const nextNo = (table, prefix, companyId) => {
    let k = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(companyId).n + 1; let no = `${prefix}-${String(k).padStart(5, '0')}`;
    while (db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(companyId, no)) { k += 1; no = `${prefix}-${String(k).padStart(5, '0')}`; }
    return no;
  };

  // ---- settings: the contingency pool and the heat-map thresholds (BR-01) ----------------------------------------------------------------------------------
  const thresholdsOf = (orgProjectId) => {
    const s = db.prepare('SELECT * FROM proj_risk_settings WHERE org_project_id = ? AND deleted_at IS NULL').get(orgProjectId);
    const t = json(s?.thresholds_json, {}); const pct = Array.isArray(t.probabilityPct) && t.probabilityPct.length === 5 ? t.probabilityPct.map((v) => Math.round(Number(v) * 10000)) : HEATMAP_DEFAULTS.probabilityPct;
    return { medium: t.medium ?? HEATMAP_DEFAULTS.medium, high: t.high ?? HEATMAP_DEFAULTS.high, critical: t.critical ?? HEATMAP_DEFAULTS.critical, probabilityPct: pct, pool: s?.contingency_pool ?? 0, rowVersion: s?.version ?? 0 };
  };
  const settingsView = (t) => ({ medium: t.medium, high: t.high, critical: t.critical, probabilityPct: t.probabilityPct.map((v) => v / 10000), contingencyPool: money(t.pool), rowVersion: t.rowVersion });
  const settings = {
    get(actor, projectId) { const o = project(actor, projectId, 'proj.risk.view', 'proj.risk.view'); return { projectId: o.id, ...settingsView(thresholdsOf(o.id)) }; },
    put(actor, b) {
      const o = project(actor, b.projectId, 'proj.risk.approve', 'proj.risk.view');
      const cur = thresholdsOf(o.id); const th = { medium: b.thresholds?.medium ?? cur.medium, high: b.thresholds?.high ?? cur.high, critical: b.thresholds?.critical ?? cur.critical, probabilityPct: b.thresholds?.probabilityPct ?? cur.probabilityPct.map((v) => v / 10000) };
      const p = []; if (!(th.medium < th.high && th.high < th.critical)) p.push({ field: 'thresholds', message: 'The thresholds rise: medium below high below critical' });
      if (th.probabilityPct.some((v, i) => i && v < th.probabilityPct[i - 1])) p.push({ field: 'thresholds.probabilityPct', message: 'The probability scale does not fall from 1 to 5' });
      const pool = b.contingencyPool == null ? cur.pool : toPaise(b.contingencyPool);
      const allocated = db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM proj_risk_contingency WHERE org_project_id = ? AND kind = 'ALLOCATION' AND entry_status = 'ACTIVE' AND deleted_at IS NULL").get(o.id).n;
      if (pool < allocated) p.push({ field: 'contingencyPool', message: `${money(allocated)} is allocated to risks already: the pool cannot be less` });
      fail(p);
      return transaction(db, () => {
        if (db.prepare('SELECT 1 FROM proj_risk_settings WHERE org_project_id = ?').get(o.id)) db.prepare('UPDATE proj_risk_settings SET contingency_pool = ?, thresholds_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE org_project_id = ?').run(pool, JSON.stringify(th), actor.user, nowIso(), o.id);
        else db.prepare("INSERT INTO proj_risk_settings (company_id, org_project_id, contingency_pool, thresholds_json, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'proj_risk_settings')").run(o.company_id, o.id, pool, JSON.stringify(th), o.id, actor.user);
        // the score of every open item follows the new thresholds
        const t2 = thresholdsOf(o.id);
        for (const r of db.prepare("SELECT * FROM proj_risks WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'CLOSE_REQUESTED')").all(o.id)) {
          const lvl = levelOf(r.score, t2); const rl = r.residual_score == null ? null : levelOf(r.residual_score, t2);
          if (lvl !== r.level || rl !== r.residual_level) db.prepare('UPDATE proj_risks SET level = ?, residual_level = ? WHERE id = ?').run(lvl, rl, r.id);
        }
        writeAudit(db, { entity: 'proj_risk_settings', entityId: o.id, action: 'update', newValues: { thresholds: th, contingencyPool: money(pool) }, actor: actor.user, companyId: o.company_id });
        return settings.get(actor, o.id);
      });
    },
  };

  // ---- the assessment -------------------------------------------------------------------------------------------------------------------------------------
  function assess(b, t) {
    const worst = Math.max(b.impactCost, b.impactTime, b.impactQuality, b.impactSafety); const score = b.probability * worst; const pct = t.probabilityPct[b.probability - 1];
    const out = { score, level: levelOf(score, t), probabilityPct: pct, emv: emvOf(pct, toPaise(b.exposureCost.mostLikely)), residualScore: null, residualLevel: null };
    if (b.residualProbability != null && b.residualImpact != null) { out.residualScore = b.residualProbability * b.residualImpact; out.residualLevel = levelOf(out.residualScore, t); }
    return out;
  }
  const flat = (r) => ({
    rtype: r.rtype, title: r.title, description: r.description, cause: r.cause, effect: r.effect, category: r.category, wbsId: r.wbs_id, costCodeId: r.cost_code_id, activityRef: r.activity_ref, clauseRef: r.clause_ref, ownerUser: r.owner_user,
    probability: r.probability, impactCost: r.impact_cost, impactTime: r.impact_time, impactQuality: r.impact_quality, impactSafety: r.impact_safety, strategy: r.strategy, residualProbability: r.residual_probability, residualImpact: r.residual_impact,
    exposureCost: { min: money(r.exposure_cost_min), mostLikely: money(r.exposure_cost_ml), max: money(r.exposure_cost_max) }, exposureDays: { min: r.exposure_time_min, mostLikely: r.exposure_time_ml, max: r.exposure_time_max }, remarks: r.remarks,
  });
  function problems(actor, o, b) {
    const p = [];
    if (!userOf(actor.companyId, b.ownerUser)) p.push({ field: 'ownerUser', message: 'The owner is an active user of your company' });
    if (b.wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.wbsId, o.id)) p.push({ field: 'wbsId', message: 'Choose a WBS node of this project' });
    if (b.costCodeId && !db.prepare('SELECT 1 FROM fin_cost_codes WHERE id = ? AND deleted_at IS NULL AND (company_id IS NULL OR company_id = ?)').get(b.costCodeId, actor.companyId)) p.push({ field: 'costCodeId', message: 'Choose a cost code of your company' });
    if (!RISK_STRATEGY_OF[b.rtype].includes(b.strategy)) p.push({ field: 'strategy', message: `A ${RTYPES[b.rtype].toLowerCase()} is answered by: ${RISK_STRATEGY_OF[b.rtype].map((s) => RISK_STRATEGIES[s].toLowerCase()).join(', ')}` });
    const c = b.exposureCost.min != null ? [toPaise(b.exposureCost.min), toPaise(b.exposureCost.mostLikely), toPaise(b.exposureCost.max)] : [0, 0, 0]; const d = b.exposureDays;
    if (!(c[0] <= c[1] && c[1] <= c[2])) p.push({ field: 'exposureCost', message: 'The cost exposure rises: minimum, most likely, maximum' });
    if (!(d.min <= d.mostLikely && d.mostLikely <= d.max)) p.push({ field: 'exposureDays', message: 'The delay exposure rises: minimum, most likely, maximum' });
    if ((b.residualProbability == null) !== (b.residualImpact == null)) p.push({ field: 'residualProbability', message: 'Give both the residual probability and the residual impact, or neither' });
    for (const [i, a] of (b.actions ?? []).entries()) if (!userOf(actor.companyId, a.ownerUser)) p.push({ field: `actions.${i}.ownerUser`, message: `${a.ownerUser} is not a user of your company` });
    return p;
  }

  // ---- the views ------------------------------------------------------------------------------------------------------------------------------------------
  const actionsOf = (riskId) => db.prepare('SELECT a.*, k.status AS task_status, k.task_no FROM proj_risk_actions a LEFT JOIN tsk_tasks k ON k.id = a.task_id WHERE a.risk_id = ? AND a.deleted_at IS NULL ORDER BY a.action_no, a.id').all(riskId);
  const aview = (a, actor) => { const st = a.task_status ? TASK_STATUS[a.task_status] : 'OPEN'; return { id: a.id, no: a.action_no, description: a.description, ownerUser: a.owner_user, dueDate: a.due_date, taskId: a.task_id, taskNo: a.task_no ?? null, status: st, statusLabel: ACTION_STATUS_LABEL[st], overdue: a.due_date < todayIST() && ['OPEN', 'IN_PROGRESS', 'BLOCKED'].includes(st), mine: same(a.owner_user, actor.user) }; };
  const triggersOf = (riskId) => db.prepare('SELECT * FROM proj_risk_triggers WHERE risk_id = ? AND deleted_at IS NULL ORDER BY id').all(riskId);
  const tview = (t) => ({ id: t.id, name: t.name, indicator: t.indicator, comparator: t.comparator, comparatorLabel: TRIGGER_COMPARATORS[t.comparator], threshold: t.threshold, unit: t.unit, currentValue: t.current_value, status: t.trigger_status, firedAt: t.fired_at, lastReadingAt: t.last_reading_at });
  const contingencyOf = (riskId) => db.prepare('SELECT * FROM proj_risk_contingency WHERE risk_id = ? AND deleted_at IS NULL ORDER BY id').all(riskId);
  const cview = (c) => ({ id: c.id, kind: c.kind, amount: money(c.amount), status: c.entry_status, reason: c.reason, by: c.by_user, at: c.created_at });
  const drawn = (riskId) => db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM proj_risk_contingency WHERE risk_id = ? AND kind = 'DRAWDOWN' AND entry_status IN ('REQUESTED', 'EXECUTED') AND deleted_at IS NULL").get(riskId).n;
  const mine = (actor, r) => same(r.owner_user, actor.user);
  function view(actor, r, { detail = false } = {}) {
    const o = orgOf(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const open = r.status === 'OPEN';
    /** @type {any} */
    const out = {
      id: r.id, docNo: r.doc_no, projectId: r.org_project_id, projectCode: o?.code, projectName: o?.name, ...flat(r), typeLabel: RTYPES[r.rtype], categoryLabel: RISK_CATEGORIES[r.category], strategyLabel: RISK_STRATEGIES[r.strategy],
      score: r.score, level: r.level, levelLabel: RISK_LEVELS[r.level], residualScore: r.residual_score, residualLevel: r.residual_level, probabilityPct: r.probability_pct / 10000, emv: money(r.emv), contingencyAllocated: money(r.contingency_allocated),
      contingencyDrawn: money(drawn(r.id)), status: r.status, statusLabel: RISK_STATUS[r.status], closeReason: r.close_reason, closedAt: r.closed_at, closedBy: r.closed_by, requestedBy: r.requested_by, occurredIssueId: r.occurred_issue_id, workflowInstanceId: r.workflow_instance_id,
      createdBy: r.created_by, rowVersion: r.version, needsApproval: ['HIGH', 'CRITICAL'].includes(r.level),
      can: {
        edit: can('proj.risk.edit') && open, submit: can('proj.risk.submit') && open && (mine(actor, r) || can('proj.risk.approve')), withdraw: r.status === 'CLOSE_REQUESTED' && same(r.requested_by, actor.user), cancel: can('proj.risk.cancel') && open,
        delete: can('proj.risk.delete') && open && !db.prepare('SELECT 1 FROM proj_risk_actions WHERE risk_id = ? AND task_id IS NOT NULL AND deleted_at IS NULL').get(r.id), amend: can('proj.risk.amend') && ['CLOSED', 'CANCELLED'].includes(r.status), print: can('proj.risk.print'), export: can('proj.risk.export'),
        reading: can('proj.risk.edit') && open, contingency: can('proj.risk.approve') && open,
      },
    };
    if (detail) {
      out.actions = actionsOf(r.id).map((a) => aview(a, actor)); out.triggers = triggersOf(r.id).map(tview); out.contingency = contingencyOf(r.id).map(cview);
      out.issues = db.prepare('SELECT id, doc_no, title, status, priority FROM proj_risk_issues WHERE risk_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((i) => ({ id: i.id, docNo: i.doc_no, title: i.title, status: i.status, statusLabel: ISSUE_STATUS[i.status], priority: i.priority }));
    }
    return out;
  }
  const row = (actor, id, key = 'proj.risk.view') => {
    const r = db.prepare('SELECT * FROM proj_risks WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'proj.risk.view', r.org_project_id)) throw notFound('That risk does not exist.');
    if (key !== 'proj.risk.view') need(actor, key, 'do that with a risk', r.org_project_id);
    return r;
  };
  const fresh = (id) => db.prepare('SELECT * FROM proj_risks WHERE id = ?').get(id);
  const lockedMsg = (r) => conflict(`${r.doc_no} is ${RISK_STATUS[r.status].toLowerCase()}: reopen it by an amendment to change it.`);

  // ---- actions (tasks) and triggers ----------------------------------------------------------------------------------------------------------------------
  function writeActions(actor, r, list) {
    const old = db.prepare('SELECT * FROM proj_risk_actions WHERE risk_id = ? AND deleted_at IS NULL').all(r.id); const keep = new Set(); const o = orgOf(r.org_project_id);
    db.prepare('UPDATE proj_risk_actions SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE risk_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id);
    list.forEach((a, i) => {
      const prev = old.find((x) => !keep.has(x.id) && x.description === a.description.trim() && same(x.owner_user, a.ownerUser) && x.due_date === a.dueDate); if (prev) keep.add(prev.id);
      const id = Number(db.prepare("INSERT INTO proj_risk_actions (company_id, risk_id, org_project_id, action_no, description, owner_user, due_date, task_id, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_risks', ?)").run(r.company_id, r.id, r.org_project_id, i + 1, a.description.trim(), a.ownerUser, a.dueDate, prev?.task_id ?? null, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
      if (!prev) {
        const task = tasksOf(db).create({ companyId: r.company_id, title: `${r.doc_no}: ${a.description}`.slice(0, 160), description: `Response action ${i + 1} of ${RTYPES[r.rtype].toLowerCase()} "${r.title}" (${o.code}).`, entity: 'proj_risk', entityId: r.id, entityLabel: r.doc_no, projectId: r.org_project_id, priority: ['HIGH', 'CRITICAL'].includes(r.level) ? 'HIGH' : 'MEDIUM', dueDate: a.dueDate, assignees: [a.ownerUser], origin: 'auto', assigner: r.owner_user, actor: actor.user, source: { type: 'proj_risk_action', id: `${r.id}:${id}` } });
        db.prepare('UPDATE proj_risk_actions SET task_id = ? WHERE id = ?').run(task?.id ?? null, id);
      }
    });
    for (const x of old) if (x.task_id && !keep.has(x.id)) cancelTask(actor, x.task_id, `${r.doc_no} was reassessed`);
  }
  const cancelTask = (actor, taskId, reason) => { try { tasksOf(db).act(actor.user, taskId, 'cancel', { reason }); } catch { /* a task closed elsewhere stays as it is */ } };
  function writeTriggers(actor, r, list) {
    const old = triggersOf(r.id); const keep = new Set();
    db.prepare('UPDATE proj_risk_triggers SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE risk_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, r.id);
    for (const t of list) {
      const prev = old.find((x) => !keep.has(x.id) && x.name === t.name && x.comparator === t.comparator && x.threshold === t.threshold); if (prev) keep.add(prev.id);
      db.prepare("INSERT INTO proj_risk_triggers (company_id, risk_id, org_project_id, name, indicator, comparator, threshold, unit, current_value, trigger_status, fired_at, last_reading_at, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_risks', ?)").run(r.company_id, r.id, r.org_project_id, t.name, t.indicator ?? null, t.comparator, t.threshold, t.unit ?? null, prev?.current_value ?? null, prev?.trigger_status ?? 'ARMED', prev?.fired_at ?? null, prev?.last_reading_at ?? null, r.org_project_id, actor.user, String(r.id));
    }
  }
  const crossed = (t, v) => (t.comparator === 'GTE' ? v >= t.threshold : t.comparator === 'GT' ? v > t.threshold : t.comparator === 'LTE' ? v <= t.threshold : v < t.threshold);
  /** The company's copy of the library alert rule (04.09): created active the first time a trigger is read, so a passed threshold raises an alert at once. */
  function alertRule(companyId) {
    let r = db.prepare("SELECT * FROM alr_rules WHERE company_id = ? AND code = 'risk.trigger_fired' AND status = 'ACTIVE' AND enabled = 1 AND is_active = 1").get(companyId);
    if (!r) {
      const lib = db.prepare("SELECT * FROM alr_rules WHERE company_id IS NULL AND code = 'risk.trigger_fired' AND status = 'LIBRARY'").get(); if (!lib) return null;
      db.prepare("INSERT OR IGNORE INTO alr_rules (company_id, code, name, description, trigger_type, event_type, schedule, dataset, condition_json, actions_json, message_template, throttle_minutes, severity, owner_module, owner_role, external, enabled, rule_version, status, created_by, source_type) SELECT ?, code, name, description, trigger_type, event_type, schedule, dataset, condition_json, actions_json, message_template, throttle_minutes, severity, owner_module, owner_role, 0, 1, rule_version, 'ACTIVE', 'system', 'proj_risks' FROM alr_rules WHERE id = ?").run(companyId, lib.id);
      r = db.prepare("SELECT * FROM alr_rules WHERE company_id = ? AND code = 'risk.trigger_fired' AND status = 'ACTIVE'").get(companyId);
    }
    return r ? alertsOf(db).ruleOf(r) : null;
  }
  const triggerRow = (actor, riskId, tid) => { const r = row(actor, riskId, 'proj.risk.edit'); const t = db.prepare('SELECT * FROM proj_risk_triggers WHERE id = ? AND risk_id = ? AND deleted_at IS NULL').get(rid(tid), r.id); if (!t) throw notFound('That trigger does not exist.'); return { r, t }; };

  // ---- the register ---------------------------------------------------------------------------------------------------------------------------------------
  const risks = {
    list(actor, query) {
      need(actor, 'proj.risk.view', 'see risks'); const s = scopeSql(actor, 'proj.risk.view');
      return runList(db, riskList, parseListRequest(riskList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = view(actor, x); return { id: v.id, docNo: v.docNo, type: v.rtype, typeLabel: v.typeLabel, title: v.title, projectId: v.projectId, project: v.projectCode, category: v.categoryLabel, owner: v.ownerUser, probability: v.probability, impact: Math.max(v.impactCost, v.impactTime, v.impactQuality, v.impactSafety), score: v.score, level: v.level, levelLabel: v.levelLabel, strategy: v.strategyLabel, emv: v.emv, exposure: v.exposureCost.mostLikely, status: v.status, statusLabel: v.statusLabel, residualLevel: v.residualLevel }; } });
    },
    exportSource(actor, req) {
      need(actor, 'proj.risk.export', 'export the register'); const s = scopeSql(actor, 'proj.risk.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: riskList.label, permission: 'proj.risk.export', personal: false, columns: [{ key: 'docNo', label: 'No.', type: 'text' }, { key: 'type', label: 'Type', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'category', label: 'Category', type: 'text' }, { key: 'owner', label: 'Owner', type: 'text' }, { key: 'score', label: 'Score', type: 'number' }, { key: 'level', label: 'Level', type: 'text' }, { key: 'strategy', label: 'Response', type: 'text' }, { key: 'emv', label: 'EMV (₹)', type: 'money' }, { key: 'status', label: 'Status', type: 'text' }],
        rows: () => runList(db, riskList, req, { ...opts, limit: null, map: (x) => { const v = view(actor, x); return { docNo: v.docNo, type: v.typeLabel, title: v.title, project: v.projectCode, category: v.categoryLabel, owner: v.ownerUser, score: v.score, level: v.levelLabel, strategy: v.strategyLabel, emv: v.emv, status: v.statusLabel }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All risks and opportunities you may see'],
        count: () => countList(db, riskList, req, opts) };
    },
    get(actor, id) { return view(actor, row(actor, id), { detail: true }); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'proj.risk.create', 'proj.risk.view'); const t = thresholdsOf(o.id); const p = problems(actor, o, b);
      if (['HIGH', 'CRITICAL'].includes(assess(b, t).level) && b.strategy !== 'ACCEPT' && !b.actions.length && b.rtype === 'RISK') p.push({ field: 'actions', message: 'A high or critical risk needs at least one response action' });
      fail(p); const a = assess(b, t);
      return transaction(db, () => {
        const no = nextNo('proj_risks', b.rtype === 'RISK' ? 'RSK' : 'OPP', actor.companyId); const ec = b.exposureCost; const ed = b.exposureDays;
        const id = Number(db.prepare("INSERT INTO proj_risks (company_id, doc_no, org_project_id, rtype, title, description, cause, effect, category, wbs_id, cost_code_id, activity_ref, clause_ref, owner_user, probability, impact_cost, impact_time, impact_quality, impact_safety, score, level, strategy, residual_probability, residual_impact, residual_score, residual_level, exposure_cost_min, exposure_cost_ml, exposure_cost_max, exposure_time_min, exposure_time_ml, exposure_time_max, probability_pct, emv, remarks, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_risks', ?)")
          .run(actor.companyId, no, o.id, b.rtype, b.title, b.description, b.cause, b.effect, b.category, b.wbsId, b.costCodeId, b.activityRef, b.clauseRef, b.ownerUser, b.probability, b.impactCost, b.impactTime, b.impactQuality, b.impactSafety, a.score, a.level, b.strategy, b.residualProbability, b.residualImpact, a.residualScore, a.residualLevel, toPaise(ec.min), toPaise(ec.mostLikely), toPaise(ec.max), ed.min, ed.mostLikely, ed.max, a.probabilityPct, a.emv, b.remarks, o.id, actor.user, no).lastInsertRowid);
        const r = fresh(id); writeActions(actor, r, b.actions); writeTriggers(actor, r, b.triggers);
        writeAudit(db, { entity: 'proj_risks', entityId: id, action: 'create', newValues: { docNo: no, score: a.score, level: a.level, emv: money(a.emv) }, actor: actor.user, companyId: actor.companyId });
        event('proj.risk.created', actor, 'proj_risk', id, actor.companyId, o.id, { projectId: o.id, code: o.code, riskId: id, docNo: no, type: b.rtype, level: a.level, score: a.score, emv: money(a.emv) });
        return risks.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proj.risk.edit'); if (r.status !== 'OPEN') throw lockedMsg(r);
      if (b.rowVersion != null && b.rowVersion !== r.version) throw conflict(`${r.doc_no} was changed by someone else (version ${r.version}, you had ${b.rowVersion}); reload it.`);
      const o = orgOf(r.org_project_id); const { rowVersion, ...rest } = b; void rowVersion; const merged = { ...flat(r), ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
      const p = problems(actor, o, { ...merged, actions: rest.actions ?? [] }); const t = thresholdsOf(o.id); const a = assess(merged, t);
      if (rest.actions && ['HIGH', 'CRITICAL'].includes(a.level) && merged.strategy !== 'ACCEPT' && r.rtype === 'RISK' && !rest.actions.length) p.push({ field: 'actions', message: 'A high or critical risk needs at least one response action' });
      fail(p);
      return transaction(db, () => {
        const ec = merged.exposureCost; const ed = merged.exposureDays;
        db.prepare('UPDATE proj_risks SET title = ?, description = ?, cause = ?, effect = ?, category = ?, wbs_id = ?, cost_code_id = ?, activity_ref = ?, clause_ref = ?, owner_user = ?, probability = ?, impact_cost = ?, impact_time = ?, impact_quality = ?, impact_safety = ?, score = ?, level = ?, strategy = ?, residual_probability = ?, residual_impact = ?, residual_score = ?, residual_level = ?, exposure_cost_min = ?, exposure_cost_ml = ?, exposure_cost_max = ?, exposure_time_min = ?, exposure_time_ml = ?, exposure_time_max = ?, probability_pct = ?, emv = ?, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
          .run(merged.title, merged.description, merged.cause, merged.effect, merged.category, merged.wbsId, merged.costCodeId, merged.activityRef, merged.clauseRef, merged.ownerUser, merged.probability, merged.impactCost, merged.impactTime, merged.impactQuality, merged.impactSafety, a.score, a.level, merged.strategy, merged.residualProbability, merged.residualImpact, a.residualScore, a.residualLevel, toPaise(ec.min), toPaise(ec.mostLikely), toPaise(ec.max), ed.min, ed.mostLikely, ed.max, a.probabilityPct, a.emv, merged.remarks, actor.user, nowIso(), r.id);
        if (rest.actions) writeActions(actor, fresh(r.id), rest.actions);
        if (rest.triggers) writeTriggers(actor, fresh(r.id), rest.triggers);
        writeAudit(db, { entity: 'proj_risks', entityId: r.id, action: 'update', oldValues: { score: r.score, level: r.level, emv: money(r.emv), probability: r.probability }, newValues: { score: a.score, level: a.level, emv: money(a.emv), probability: merged.probability }, actor: actor.user, companyId: r.company_id });
        if (a.level !== r.level) event('proj.risk.reassessed', actor, 'proj_risk', r.id, r.company_id, r.org_project_id, { projectId: o.id, riskId: r.id, docNo: r.doc_no, from: r.level, to: a.level, score: a.score });
        return risks.get(actor, r.id);
      });
    },
    remove(actor, id) {
      const r = row(actor, id, 'proj.risk.delete'); if (r.status !== 'OPEN') throw unprocessable('Only an open risk is deleted; cancel any other.');
      if (db.prepare('SELECT 1 FROM proj_risk_actions WHERE risk_id = ? AND task_id IS NOT NULL AND deleted_at IS NULL').get(r.id)) throw unprocessable('Its actions are tasks already: cancel the risk instead.');
      db.prepare('UPDATE proj_risks SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id);
      writeAudit(db, { entity: 'proj_risks', entityId: r.id, action: 'delete', actor: actor.user, companyId: r.company_id }); return { id: r.id, deleted: true };
    },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'proj.risk.cancel'); if (r.status !== 'OPEN') throw unprocessable('Only an open risk is cancelled.');
      return transaction(db, () => { releaseAll(actor, r, 'Cancelled'); endActions(actor, r, `${r.doc_no} was cancelled`); db.prepare("UPDATE proj_risks SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); writeAudit(db, { entity: 'proj_risks', entityId: r.id, action: 'cancel', reason, actor: actor.user, companyId: r.company_id }); return risks.get(actor, r.id); });
    },
    /** BR-02: the owner asks to close the risk with a justification; a high or critical one waits for the project manager, any other closes at once. */
    submit(actor, id, { reason, occurred }) {
      const r = row(actor, id, 'proj.risk.submit'); if (r.status !== 'OPEN') throw lockedMsg(r);
      if (!mine(actor, r) && !may(actor, 'proj.risk.approve', r.org_project_id)) throw forbidden('Only the owner of the risk asks to close it.');
      if (occurred && r.rtype !== 'RISK') throw unprocessable('Only a risk occurs: an opportunity is closed or taken.');
      return transaction(db, () => {
        db.prepare('UPDATE proj_risks SET close_reason = ?, close_occurred = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(reason, occurred ? 1 : 0, actor.user, actor.user, nowIso(), r.id);
        if (!['HIGH', 'CRITICAL'].includes(r.level)) { closeNow(actor, fresh(r.id)); return risks.get(actor, r.id); }
        const inst = workflowOf(db).submit(actor, { docType: RISK_CLOSE_DOC, docId: String(r.id), comment: `${r.doc_no}: ${reason}`.slice(0, 300), context: { projectId: r.org_project_id } });
        db.prepare("UPDATE proj_risks SET status = 'CLOSE_REQUESTED', workflow_instance_id = ? WHERE id = ?").run(inst.id, r.id);
        writeAudit(db, { entity: 'proj_risks', entityId: r.id, action: 'submit', reason, actor: actor.user, companyId: r.company_id });
        return risks.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'CLOSE_REQUESTED') throw unprocessable('Only a closure waiting for the project manager is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who asked withdraws the request.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return risks.get(actor, r.id); },
    /** A closed or cancelled item is reopened with a reason; its history keeps the closure. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'proj.risk.amend'); if (!['CLOSED', 'CANCELLED'].includes(r.status)) throw unprocessable('Only a closed or cancelled risk is reopened.');
      db.prepare("UPDATE proj_risks SET status = 'OPEN', closed_at = NULL, closed_by = NULL, close_reason = NULL, close_occurred = 0, workflow_instance_id = NULL, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(`Reopened: ${reason}`, actor.user, nowIso(), r.id);
      writeAudit(db, { entity: 'proj_risks', entityId: r.id, action: 'reopen', reason, actor: actor.user, companyId: r.company_id }); return risks.get(actor, r.id);
    },
    history(actor, id) {
      const r = row(actor, id);
      return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [],
        audit: db.prepare("SELECT action, actor, reason, created_at AS at, old_values AS oldValues, new_values AS newValues FROM core_audit_log WHERE entity = 'proj_risks' AND entity_id = ? ORDER BY id").all(String(r.id)).map((a) => ({ action: a.action, actor: a.actor, reason: a.reason, at: a.at, from: json(a.oldValues, null), to: json(a.newValues, null) })) };
    },
    document(actor, id, format = 'html') {
      const r = row(actor, id, ['xlsx', 'csv'].includes(format) ? 'proj.risk.export' : 'proj.risk.print'); const v = view(actor, r, { detail: true });
      writeAudit(db, { entity: 'proj_risks', entityId: r.id, action: ['xlsx', 'csv'].includes(format) ? 'export' : 'print', newValues: { format }, actor: actor.user, companyId: r.company_id });
      const rows = [
        { section: 'Assessment', item: v.title, detail: `${v.typeLabel} · ${v.categoryLabel} · owner ${v.ownerUser}` }, { section: 'Assessment', item: 'Probability and impact', detail: `P${v.probability} × worst impact → score ${v.score} (${v.levelLabel})${v.residualScore != null ? `; residual ${v.residualScore}` : ''}` },
        { section: 'Assessment', item: 'Cause and effect', detail: `${v.cause ?? '-'} → ${v.effect ?? '-'}` }, { section: 'Exposure', item: 'Cost (₹)', detail: `${v.exposureCost.min} / ${v.exposureCost.mostLikely} / ${v.exposureCost.max}` }, { section: 'Exposure', item: 'Delay (days)', detail: `${v.exposureDays.min} / ${v.exposureDays.mostLikely} / ${v.exposureDays.max}` },
        { section: 'Exposure', item: 'EMV (₹)', detail: `${v.emv} at ${v.probabilityPct}%` }, { section: 'Response', item: v.strategyLabel, detail: `Contingency ${v.contingencyAllocated}` },
        ...v.actions.map((a) => ({ section: 'Actions', item: `A${a.no} · ${a.ownerUser} · due ${a.dueDate}`, detail: `${a.description} [${a.statusLabel}]` })), ...v.triggers.map((t) => ({ section: 'Triggers', item: t.name, detail: `${t.comparatorLabel} ${t.threshold}${t.unit ? ` ${t.unit}` : ''} · now ${t.currentValue ?? '-'} · ${t.status}` })),
      ];
      const title = `${v.typeLabel} ${v.docNo} · ${v.projectCode} · ${v.statusLabel}`;
      if (format === 'html') { const sections = [...new Set(rows.map((x) => x.section))]; return { kind: 'html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:13px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left;vertical-align:top}table{border-collapse:collapse;width:100%;margin-bottom:12px}</style></head><body><h1>${esc(title)}</h1>${sections.map((s) => `<h2>${esc(s)}</h2><table>${rows.filter((x) => x.section === s).map((x) => `<tr><td>${esc(x.item)}</td><td>${esc(x.detail)}</td></tr>`).join('')}</table>`).join('')}</body></html>` }; }
      return { kind: 'file', buffer: writeExport(format, { columns: [{ key: 'section', label: 'Section', type: 'text' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }], rows, footer: [`Status: ${v.statusLabel}`], title, sheetName: 'Risk' }), contentType: FORMATS[format], fileName: `${v.docNo}.${format}` };
    },
    /** Many items from one sheet: each row is a risk with its response and exposure; all or none. */
    import(actor, projectId, rows) {
      project(actor, projectId, 'proj.risk.create', 'proj.risk.view');
      return transaction(db, () => { const made = rows.map((b, i) => { try { return risks.create(actor, { ...b, projectId }).docNo; } catch (x) { throw badRequest(`Row ${i + 1}: ${x.message}`, (x.details ?? []).map((d) => ({ ...d, field: `rows.${i}.${d.field}` }))); } }); return { created: made.length, docNos: made }; });
    },
    /** FR-04: a reading of an early-warning indicator; the trigger fires when the threshold is passed, an event goes out and the alert rule (04.09) raises its alert. */
    reading(actor, id, tid, { value, note }) {
      const { r, t } = triggerRow(actor, id, tid); if (r.status !== 'OPEN') throw lockedMsg(r);
      const now = nowIso(); const hit = crossed(t, value); const fire = hit && t.trigger_status !== 'FIRED';
      return transaction(db, () => {
        db.prepare("UPDATE proj_risk_triggers SET current_value = ?, last_reading_at = ?, trigger_status = ?, fired_at = ?, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(value, now, hit ? 'FIRED' : 'ARMED', hit ? (t.fired_at ?? now) : null, note ?? t.remarks, actor.user, now, t.id);
        writeAudit(db, { entity: 'proj_risk_triggers', entityId: t.id, action: fire ? 'fire' : 'reading', newValues: { value, threshold: t.threshold, comparator: t.comparator }, actor: actor.user, companyId: r.company_id });
        let alerted = false;
        if (fire) {
          event('proj.risk.trigger_fired', actor, 'proj_risk', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, riskId: r.id, docNo: r.doc_no, trigger: t.name, reading: value, threshold: t.threshold, level: r.level });
          try { const rule = alertRule(r.company_id); if (rule) { alertsOf(db).run(rule, 'event'); alerted = true; } } catch { /* the trigger stays fired; the alert runs again with the schedule */ }
        }
        return { riskId: r.id, trigger: tview(db.prepare('SELECT * FROM proj_risk_triggers WHERE id = ?').get(t.id)), fired: fire, alerted };
      });
    },
    rearm(actor, id, tid) { const { r, t } = triggerRow(actor, id, tid); db.prepare("UPDATE proj_risk_triggers SET trigger_status = 'ARMED', fired_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), t.id); return risks.get(actor, r.id); },
    /** FR-05: contingency out of the project pool to a risk (an allocation) and a request to draw on it (executed by 12.02). */
    contingency(actor, id, { kind, amount, reason }) {
      const r = row(actor, id, 'proj.risk.approve'); if (r.status !== 'OPEN') throw lockedMsg(r); if (r.rtype !== 'RISK') throw unprocessable('Contingency covers risks, not opportunities.');
      const amt = toPaise(amount); const t = thresholdsOf(r.org_project_id); const p = []; if (amt <= 0) p.push({ field: 'amount', message: 'Give an amount above zero' });
      if (kind === 'ALLOCATION') {
        const used = db.prepare("SELECT COALESCE(SUM(amount), 0) AS n FROM proj_risk_contingency WHERE org_project_id = ? AND kind = 'ALLOCATION' AND entry_status = 'ACTIVE' AND deleted_at IS NULL").get(r.org_project_id).n;
        if (!t.pool) p.push({ field: 'amount', message: 'Set the contingency pool of the project first' }); else if (used + amt > t.pool) p.push({ field: 'amount', message: `Only ${money(t.pool - used)} is left in the pool of ${money(t.pool)}` });
      } else if (amt > r.contingency_allocated - drawn(r.id)) p.push({ field: 'amount', message: `Only ${money(Math.max(0, r.contingency_allocated - drawn(r.id)))} of the contingency allocated to this risk is left to draw` });
      fail(p);
      return transaction(db, () => {
        const cid = Number(db.prepare("INSERT INTO proj_risk_contingency (company_id, risk_id, org_project_id, kind, amount, entry_status, reason, by_user, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_risks', ?)").run(r.company_id, r.id, r.org_project_id, kind, amt, kind === 'ALLOCATION' ? 'ACTIVE' : 'REQUESTED', reason, actor.user, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
        if (kind === 'ALLOCATION') db.prepare('UPDATE proj_risks SET contingency_allocated = contingency_allocated + ?, version = version + 1 WHERE id = ?').run(amt, r.id);
        writeAudit(db, { entity: 'proj_risk_contingency', entityId: cid, action: kind === 'ALLOCATION' ? 'allocate' : 'drawdown_request', newValues: { riskId: r.id, amount: money(amt) }, reason, actor: actor.user, companyId: r.company_id });
        event(kind === 'ALLOCATION' ? 'proj.risk.contingency_allocated' : 'proj.risk.drawdown_requested', actor, 'proj_risk', r.id, r.company_id, r.org_project_id, { projectId: r.org_project_id, riskId: r.id, docNo: r.doc_no, entryId: cid, amount: money(amt), reason });
        return risks.get(actor, r.id);
      });
    },
    releaseContingency(actor, id, entryId) {
      const r = row(actor, id, 'proj.risk.approve'); const c = db.prepare("SELECT * FROM proj_risk_contingency WHERE id = ? AND risk_id = ? AND deleted_at IS NULL").get(rid(entryId), r.id); if (!c) throw notFound('That entry does not exist.');
      if (c.kind !== 'ALLOCATION' || c.entry_status !== 'ACTIVE') throw unprocessable('Only an active allocation is released.');
      if (r.contingency_allocated - c.amount < drawn(r.id)) throw unprocessable('Part of it is drawn or requested: it cannot be released.');
      db.prepare("UPDATE proj_risk_contingency SET entry_status = 'RELEASED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), c.id);
      db.prepare('UPDATE proj_risks SET contingency_allocated = contingency_allocated - ?, version = version + 1 WHERE id = ?').run(c.amount, r.id);
      writeAudit(db, { entity: 'proj_risk_contingency', entityId: c.id, action: 'release', actor: actor.user, companyId: r.company_id }); return risks.get(actor, r.id);
    },
    /** Called by the budget (12.02) when it has posted a drawdown, or refused it. */
    settleDrawdown(entryId, outcome, by = 'system') { db.prepare('UPDATE proj_risk_contingency SET entry_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND kind = \'DRAWDOWN\' AND entry_status = \'REQUESTED\'').run(outcome === 'EXECUTED' ? 'EXECUTED' : 'REJECTED', by, nowIso(), rid(entryId)); },
    /** The workflow decided on the closure of a high or critical risk (BR-02). */
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'CLOSE_REQUESTED') return;
      if (outcome === 'APPROVED') { closeNow(actor, r); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
      db.prepare("UPDATE proj_risks SET status = 'OPEN', workflow_instance_id = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id);
      writeAudit(db, { entity: 'proj_risks', entityId: r.id, action: withdrawn ? 'withdraw' : outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
    },
  };
  function endActions(actor, r, why) { for (const a of db.prepare('SELECT * FROM proj_risk_actions WHERE risk_id = ? AND deleted_at IS NULL AND task_id IS NOT NULL').all(r.id)) cancelTask(actor, a.task_id, why); }
  function releaseAll(actor, r, why) {
    const live = db.prepare("SELECT * FROM proj_risk_contingency WHERE risk_id = ? AND kind = 'ALLOCATION' AND entry_status = 'ACTIVE' AND deleted_at IS NULL").all(r.id);
    for (const c of live) db.prepare("UPDATE proj_risk_contingency SET entry_status = 'RELEASED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(why, actor.user, nowIso(), c.id);
    if (live.length) db.prepare('UPDATE proj_risks SET contingency_allocated = ? WHERE id = ?').run(drawn(r.id), r.id);
  }
  function closeNow(actor, r) {
    const now = nowIso(); let issueId = null; const o = orgOf(r.org_project_id);
    releaseAll(actor, r, `Closed ${r.doc_no}`); endActions(actor, r, `${r.doc_no} was closed`);
    if (r.close_occurred) issueId = issues.createFromRisk(actor, r);
    db.prepare("UPDATE proj_risks SET status = ?, closed_at = ?, closed_by = ?, occurred_issue_id = ?, workflow_instance_id = workflow_instance_id, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(r.close_occurred ? 'OCCURRED' : 'CLOSED', now, actor.user, issueId, actor.user, now, r.id);
    writeAudit(db, { entity: 'proj_risks', entityId: r.id, action: 'close', reason: r.close_reason, newValues: { occurred: Boolean(r.close_occurred), issueId }, actor: actor.user, companyId: r.company_id });
    event('proj.risk.closed', actor, 'proj_risk', r.id, r.company_id, r.org_project_id, { projectId: o.id, code: o.code, riskId: r.id, docNo: r.doc_no, level: r.level, occurred: Boolean(r.close_occurred), issueId });
  }

  // ---- the issue log --------------------------------------------------------------------------------------------------------------------------------------
  const iview = (actor, i) => {
    const o = orgOf(i.org_project_id); const can = (k) => may(actor, k, i.org_project_id); const live = ['OPEN', 'IN_PROGRESS'].includes(i.status);
    return { id: i.id, docNo: i.doc_no, projectId: i.org_project_id, projectCode: o?.code, title: i.title, description: i.description, priority: i.priority, ownerUser: i.owner_user, dueDate: i.due_date, wbsId: i.wbs_id, riskId: i.risk_id, impactCost: money(i.impact_cost), impactTime: i.impact_time, impactText: i.impact_text, resolution: i.resolution, status: i.status, statusLabel: ISSUE_STATUS[i.status], resolvedAt: i.resolved_at, resolvedBy: i.resolved_by, overdue: Boolean(i.due_date && i.due_date < todayIST() && live), createdBy: i.created_by, rowVersion: i.version,
      can: { edit: can('proj.issue.edit') && live, submit: can('proj.issue.submit') && live && (same(i.owner_user, actor.user) || can('proj.issue.approve')), withdraw: i.status === 'RESOLVED' && same(i.resolved_by, actor.user), cancel: can('proj.issue.cancel') && live, delete: can('proj.issue.delete') && i.status === 'OPEN', amend: can('proj.issue.amend') && ['RESOLVED', 'CANCELLED'].includes(i.status), print: can('proj.issue.print'), export: can('proj.issue.export') } };
  };
  const irow = (actor, id, key = 'proj.issue.view') => {
    const i = db.prepare('SELECT * FROM proj_risk_issues WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!i || !may(actor, 'proj.issue.view', i.org_project_id)) throw notFound('That issue does not exist.');
    if (key !== 'proj.issue.view') need(actor, key, 'do that with an issue', i.org_project_id);
    return i;
  };
  function iproblems(actor, o, b) {
    const p = [];
    if (b.ownerUser && !userOf(actor.companyId, b.ownerUser)) p.push({ field: 'ownerUser', message: 'The owner is an active user of your company' });
    if (b.wbsId && !db.prepare('SELECT 1 FROM proj_wbs WHERE id = ? AND project_id = ? AND deleted_at IS NULL').get(b.wbsId, o.id)) p.push({ field: 'wbsId', message: 'Choose a WBS node of this project' });
    if (b.riskId && !db.prepare('SELECT 1 FROM proj_risks WHERE id = ? AND org_project_id = ? AND deleted_at IS NULL').get(b.riskId, o.id)) p.push({ field: 'riskId', message: 'Choose a risk of this project' });
    return p;
  }
  const issues = {
    list(actor, query) {
      need(actor, 'proj.issue.view', 'see issues'); const s = scopeSql(actor, 'proj.issue.view');
      return runList(db, issueList, parseListRequest(issueList, query), { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id', map: (x) => { const v = iview(actor, x); return { id: v.id, docNo: v.docNo, title: v.title, projectId: v.projectId, project: v.projectCode, priority: v.priority, owner: v.ownerUser, dueDate: v.dueDate, status: v.status, statusLabel: v.statusLabel, impactCost: v.impactCost, impactTime: v.impactTime, overdue: v.overdue ? 1 : 0 }; } });
    },
    exportSource(actor, req) {
      need(actor, 'proj.issue.export', 'export the issue log'); const s = scopeSql(actor, 'proj.issue.view'); const opts = { select: 'x.*', scopeSql: s.sql, params: s.params, tieBreaker: 'x.id' };
      return { title: issueList.label, permission: 'proj.issue.export', personal: false, columns: [{ key: 'docNo', label: 'No.', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'priority', label: 'Priority', type: 'text' }, { key: 'owner', label: 'Owner', type: 'text' }, { key: 'dueDate', label: 'Due', type: 'text' }, { key: 'status', label: 'Status', type: 'text' }, { key: 'impactCost', label: 'Cost impact (₹)', type: 'money' }, { key: 'impactTime', label: 'Delay (days)', type: 'number' }],
        rows: () => runList(db, issueList, req, { ...opts, limit: null, map: (x) => { const v = iview(actor, x); return { docNo: v.docNo, title: v.title, project: v.projectCode, priority: v.priority, owner: v.ownerUser, dueDate: v.dueDate, status: v.statusLabel, impactCost: v.impactCost, impactTime: v.impactTime }; } }).data,
        describe: (r) => [r.q ? `Search: ${r.q}` : 'All issues you may see'], count: () => countList(db, issueList, req, opts) };
    },
    get(actor, id) { return iview(actor, irow(actor, id)); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'proj.issue.create', 'proj.issue.view'); fail(iproblems(actor, o, b));
      return transaction(db, () => {
        const no = nextNo('proj_risk_issues', 'ISS', actor.companyId);
        const id = Number(db.prepare("INSERT INTO proj_risk_issues (company_id, doc_no, org_project_id, risk_id, title, description, priority, owner_user, due_date, wbs_id, impact_cost, impact_time, impact_text, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_risk_issues', ?)").run(actor.companyId, no, o.id, b.riskId, b.title, b.description, b.priority, b.ownerUser, b.dueDate, b.wbsId, toPaise(b.impactCost), b.impactTime, b.impactText, o.id, actor.user, no).lastInsertRowid);
        writeAudit(db, { entity: 'proj_risk_issues', entityId: id, action: 'create', newValues: { docNo: no, priority: b.priority }, actor: actor.user, companyId: actor.companyId });
        event('proj.issue.raised', actor, 'proj_issue', id, actor.companyId, o.id, { projectId: o.id, code: o.code, issueId: id, docNo: no, priority: b.priority, riskId: b.riskId });
        return issues.get(actor, id);
      });
    },
    /** A risk that occurred becomes an issue linked to it. */
    createFromRisk(actor, r) {
      const no = nextNo('proj_risk_issues', 'ISS', r.company_id);
      const id = Number(db.prepare("INSERT INTO proj_risk_issues (company_id, doc_no, org_project_id, risk_id, title, description, priority, owner_user, wbs_id, impact_cost, impact_time, impact_text, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proj_risks', ?)").run(r.company_id, no, r.org_project_id, r.id, `Occurred: ${r.title}`, r.description, r.level === 'CRITICAL' ? 'CRITICAL' : r.level === 'HIGH' ? 'HIGH' : 'MEDIUM', r.owner_user, r.wbs_id, r.exposure_cost_ml, r.exposure_time_ml, r.effect, r.org_project_id, actor.user, String(r.id)).lastInsertRowid);
      event('proj.issue.raised', actor, 'proj_issue', id, r.company_id, r.org_project_id, { projectId: r.org_project_id, issueId: id, docNo: no, priority: 'HIGH', riskId: r.id, fromRisk: true });
      return id;
    },
    update(actor, id, b) {
      const i = irow(actor, id, 'proj.issue.edit'); if (!['OPEN', 'IN_PROGRESS'].includes(i.status)) throw conflict(`${i.doc_no} is ${ISSUE_STATUS[i.status].toLowerCase()}: reopen it by an amendment to change it.`);
      const o = orgOf(i.org_project_id); fail(iproblems(actor, o, b)); const u = (k, c) => (b[k] === undefined ? c : b[k]);
      db.prepare('UPDATE proj_risk_issues SET title = ?, description = ?, priority = ?, owner_user = ?, due_date = ?, wbs_id = ?, risk_id = ?, impact_cost = ?, impact_time = ?, impact_text = ?, status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(u('title', i.title), u('description', i.description), u('priority', i.priority), u('ownerUser', i.owner_user), u('dueDate', i.due_date), u('wbsId', i.wbs_id), u('riskId', i.risk_id), b.impactCost === undefined ? i.impact_cost : toPaise(b.impactCost), u('impactTime', i.impact_time), u('impactText', i.impact_text), u('status', i.status), actor.user, nowIso(), i.id);
      writeAudit(db, { entity: 'proj_risk_issues', entityId: i.id, action: 'update', actor: actor.user, companyId: i.company_id }); return issues.get(actor, i.id);
    },
    remove(actor, id) { const i = irow(actor, id, 'proj.issue.delete'); if (i.status !== 'OPEN') throw unprocessable('Only an open issue is deleted; cancel any other.'); db.prepare('UPDATE proj_risk_issues SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, i.id); writeAudit(db, { entity: 'proj_risk_issues', entityId: i.id, action: 'delete', actor: actor.user, companyId: i.company_id }); return { id: i.id, deleted: true }; },
    /** The owner resolves the issue with the resolution. */
    resolve(actor, id, { resolution }) {
      const i = irow(actor, id, 'proj.issue.submit'); if (!['OPEN', 'IN_PROGRESS'].includes(i.status)) throw unprocessable('Only an open issue is resolved.');
      if (!same(i.owner_user, actor.user) && !may(actor, 'proj.issue.approve', i.org_project_id)) throw forbidden('Only the owner of the issue resolves it.');
      db.prepare("UPDATE proj_risk_issues SET status = 'RESOLVED', resolution = ?, resolved_at = ?, resolved_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(resolution, nowIso(), actor.user, actor.user, nowIso(), i.id);
      writeAudit(db, { entity: 'proj_risk_issues', entityId: i.id, action: 'resolve', reason: resolution, actor: actor.user, companyId: i.company_id });
      event('proj.issue.resolved', actor, 'proj_issue', i.id, i.company_id, i.org_project_id, { projectId: i.org_project_id, issueId: i.id, docNo: i.doc_no }); return issues.get(actor, i.id);
    },
    reopen(actor, id, { reason }, key) {
      const i = irow(actor, id, key); if (!['RESOLVED', 'CANCELLED'].includes(i.status)) throw unprocessable('Only a resolved or cancelled issue is reopened.');
      db.prepare("UPDATE proj_risk_issues SET status = 'IN_PROGRESS', resolved_at = NULL, resolved_by = NULL, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(`Reopened: ${reason}`, actor.user, nowIso(), i.id);
      writeAudit(db, { entity: 'proj_risk_issues', entityId: i.id, action: 'reopen', reason, actor: actor.user, companyId: i.company_id }); return issues.get(actor, i.id);
    },
    withdraw(actor, id, b) { const i = irow(actor, id); if (i.status !== 'RESOLVED' || !same(i.resolved_by, actor.user)) throw forbidden('Only the person who resolved it takes the resolution back, while it stands.'); return issues.reopen(actor, id, b, 'proj.issue.view'); },
    cancel(actor, id, { reason }) { const i = irow(actor, id, 'proj.issue.cancel'); if (!['OPEN', 'IN_PROGRESS'].includes(i.status)) throw unprocessable('Only a live issue is cancelled.'); db.prepare("UPDATE proj_risk_issues SET status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), i.id); writeAudit(db, { entity: 'proj_risk_issues', entityId: i.id, action: 'cancel', reason, actor: actor.user, companyId: i.company_id }); return issues.get(actor, i.id); },
    history(actor, id) { const i = irow(actor, id); return { approvals: [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'proj_risk_issues' AND entity_id = ? ORDER BY id").all(String(i.id)) }; },
    document(actor, id, format = 'html') {
      const i = irow(actor, id, ['xlsx', 'csv'].includes(format) ? 'proj.issue.export' : 'proj.issue.print'); const v = iview(actor, i);
      writeAudit(db, { entity: 'proj_risk_issues', entityId: i.id, action: ['xlsx', 'csv'].includes(format) ? 'export' : 'print', newValues: { format }, actor: actor.user, companyId: i.company_id });
      const rows = [{ section: 'Issue', item: v.title, detail: `${v.priority} · owner ${v.ownerUser}${v.dueDate ? ` · due ${v.dueDate}` : ''}` }, { section: 'Issue', item: 'Description', detail: v.description ?? '' }, { section: 'Impact', item: 'Cost (₹) and delay', detail: `${v.impactCost} · ${v.impactTime} day(s) · ${v.impactText ?? ''}` }, { section: 'Resolution', item: v.statusLabel, detail: v.resolution ?? '' }];
      const title = `Issue ${v.docNo} · ${v.projectCode} · ${v.statusLabel}`;
      if (format === 'html') return { kind: 'html', body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title><style>body{font:13px sans-serif;margin:24px}td,th{border:1px solid #888;padding:4px 6px;text-align:left}table{border-collapse:collapse;width:100%}</style></head><body><h1>${esc(title)}</h1><table>${rows.map((x) => `<tr><td>${esc(x.section)}</td><td>${esc(x.item)}</td><td>${esc(x.detail)}</td></tr>`).join('')}</table></body></html>` };
      return { kind: 'file', buffer: writeExport(format, { columns: [{ key: 'section', label: 'Section', type: 'text' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }], rows, footer: [`Status: ${v.statusLabel}`], title, sheetName: 'Issue' }), contentType: FORMATS[format], fileName: `${v.docNo}.${format}` };
    },
    import(actor, projectId, rows) {
      project(actor, projectId, 'proj.issue.create', 'proj.issue.view');
      return transaction(db, () => { const made = rows.map((b, i) => { try { return issues.create(actor, { ...b, projectId }).docNo; } catch (x) { throw badRequest(`Row ${i + 1}: ${x.message}`, (x.details ?? []).map((d) => ({ ...d, field: `rows.${i}.${d.field}` }))); } }); return { created: made.length, docNos: made }; });
    },
  };

  // ---- the dashboard and the monthly review ---------------------------------------------------------------------------------------------------------------
  function figures(orgProjectId, t) {
    const live = db.prepare("SELECT * FROM proj_risks WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'CLOSE_REQUESTED') ORDER BY score DESC, emv DESC, id").all(orgProjectId);
    const risk = live.filter((r) => r.rtype === 'RISK'); const opp = live.filter((r) => r.rtype === 'OPPORTUNITY');
    const heat = Array.from({ length: 5 }, () => Array(5).fill(0)); const byLevel = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const r of risk) { heat[r.probability - 1][Math.max(r.impact_cost, r.impact_time, r.impact_quality, r.impact_safety) - 1] += 1; byLevel[r.level] += 1; }
    const sum = (l, k) => l.reduce((n, r) => n + r[k], 0); const exp = riskExposureOf(db, orgProjectId); const iss = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END), 0) AS late FROM proj_risk_issues WHERE org_project_id = ? AND deleted_at IS NULL AND status IN ('OPEN', 'IN_PROGRESS')").get(todayIST(), orgProjectId);
    const late = db.prepare(`SELECT COUNT(*) AS n FROM proj_risk_actions a JOIN proj_risks x ON x.id = a.risk_id LEFT JOIN tsk_tasks k ON k.id = a.task_id WHERE a.org_project_id = ? AND a.deleted_at IS NULL AND x.deleted_at IS NULL AND x.status IN ('OPEN', 'CLOSE_REQUESTED') AND a.due_date < ? AND COALESCE(k.status, 'OPEN') IN ('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED')`).get(orgProjectId, todayIST()).n;
    const fired = db.prepare("SELECT COUNT(*) AS n FROM proj_risk_triggers tr JOIN proj_risks x ON x.id = tr.risk_id WHERE tr.org_project_id = ? AND tr.deleted_at IS NULL AND tr.trigger_status = 'FIRED' AND x.status = 'OPEN' AND x.deleted_at IS NULL").get(orgProjectId).n;
    return {
      counts: { risks: risk.length, opportunities: opp.length, high: byLevel.HIGH, critical: byLevel.CRITICAL, issues: iss.n, issuesOverdue: iss.late, actionsOverdue: late, triggersFired: fired },
      byLevel, heat, riskEmv: sum(risk, 'emv'), opportunityEmv: sum(opp, 'emv'), exposureCostMl: sum(risk, 'exposure_cost_ml'), exposureCostMax: sum(risk, 'exposure_cost_max'), exposureDaysMl: sum(risk, 'exposure_time_ml'),
      contingency: { pool: t.pool, allocated: exp.contingencyAllocated, drawn: exp.contingencyDrawn },
      top: risk.slice(0, 10).map((r) => ({ id: r.id, docNo: r.doc_no, title: r.title, score: r.score, level: r.level, emv: r.emv, owner: r.owner_user })),
    };
  }
  const figView = (f) => ({ counts: f.counts, byLevel: f.byLevel, heat: f.heat, riskEmv: money(f.riskEmv), opportunityEmv: money(f.opportunityEmv), exposureCostMl: money(f.exposureCostMl), exposureCostMax: money(f.exposureCostMax), exposureDaysMl: f.exposureDaysMl, contingency: { pool: money(f.contingency.pool), allocated: money(f.contingency.allocated), drawn: money(f.contingency.drawn), left: money(f.contingency.pool - f.contingency.allocated) }, top: f.top.map((x) => ({ ...x, emv: money(x.emv) })) });
  const dashboard = {
    get(actor, projectId) {
      const o = project(actor, projectId, 'proj.risk.view', 'proj.risk.view'); const t = thresholdsOf(o.id); const f = figures(o.id, t); const v = figView(f);
      const trend = db.prepare("SELECT period, data_json FROM proj_risk_snapshots WHERE org_project_id = ? AND deleted_at IS NULL AND snap_status = 'APPROVED' ORDER BY period").all(o.id).map((s) => { const d = json(s.data_json, {}); return { period: s.period, riskEmv: d.riskEmv, exposureCostMl: d.exposureCostMl, risks: d.counts?.risks ?? 0 }; });
      trend.push({ period: 'live', riskEmv: v.riskEmv, exposureCostMl: v.exposureCostMl, risks: f.counts.risks });
      const k = (key, label, value, filter, page = 'risks') => ({ key, label, value, filter, page });
      return {
        projectId: o.id, projectCode: o.code, projectName: o.name, thresholds: settingsView(t), ...v, trend,
        emvVsContingency: { riskEmv: v.riskEmv, contingencyPool: v.contingency.pool, allocated: v.contingency.allocated, gap: money(f.riskEmv - f.contingency.allocated), covered: f.riskEmv <= f.contingency.allocated },
        tiles: [k('risks', 'Open risks', f.counts.risks, { type: 'RISK', status: 'OPEN' }), k('critical', 'Critical', f.counts.critical, { type: 'RISK', status: 'OPEN', level: 'CRITICAL' }), k('high', 'High', f.counts.high, { type: 'RISK', status: 'OPEN', level: 'HIGH' }), k('opportunities', 'Open opportunities', f.counts.opportunities, { type: 'OPPORTUNITY', status: 'OPEN' }),
          k('issues', 'Open issues', f.counts.issues, { status: 'OPEN' }, 'issues'), k('issuesOverdue', 'Issues overdue', f.counts.issuesOverdue, { overdue: '1' }, 'issues'), k('actionsOverdue', 'Actions overdue', f.counts.actionsOverdue, { status: 'OPEN' }), k('triggers', 'Triggers fired', f.counts.triggersFired, { status: 'OPEN' })],
      };
    },
  };
  const snapRow = (actor, id, key = 'proj.risk.view') => {
    const s = db.prepare('SELECT * FROM proj_risk_snapshots WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!s || !may(actor, 'proj.risk.view', s.org_project_id)) throw notFound('That review does not exist.');
    if (key !== 'proj.risk.view') need(actor, key, 'do that with the risk review', s.org_project_id);
    return s;
  };
  const sview = (actor, s) => {
    const o = orgOf(s.org_project_id); const can = (k) => may(actor, k, s.org_project_id); const editable = ['DRAFT', 'RETURNED'].includes(s.snap_status);
    return { id: s.id, projectId: s.org_project_id, projectCode: o?.code, period: s.period, notes: s.notes, status: s.snap_status, statusLabel: SNAP_STATUS[s.snap_status], data: json(s.data_json, {}), requestedBy: s.requested_by, approvedAt: s.approved_at, workflowInstanceId: s.workflow_instance_id, createdBy: s.created_by, rowVersion: s.version,
      can: { edit: can('proj.risk.edit') && editable, submit: can('proj.risk.submit') && editable, withdraw: s.snap_status === 'SUBMITTED' && same(s.requested_by, actor.user), cancel: can('proj.risk.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(s.snap_status), delete: can('proj.risk.delete') && s.snap_status === 'DRAFT' && !s.workflow_instance_id } };
  };
  const reviews = {
    list(actor, projectId) { const o = project(actor, projectId, 'proj.risk.view', 'proj.risk.view'); return db.prepare("SELECT * FROM proj_risk_snapshots WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY period DESC, id DESC").all(o.id).map((s) => sview(actor, s)); },
    get(actor, id) { return sview(actor, snapRow(actor, id)); },
    create(actor, b) {
      const o = project(actor, b.projectId, 'proj.risk.create', 'proj.risk.view');
      if (db.prepare("SELECT 1 FROM proj_risk_snapshots WHERE org_project_id = ? AND period = ? AND deleted_at IS NULL AND snap_status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED')").get(o.id, b.period)) throw conflict(`The review of ${b.period} exists already.`);
      const id = Number(db.prepare("INSERT INTO proj_risk_snapshots (company_id, org_project_id, period, data_json, notes, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'proj_risk_snapshots', ?)").run(o.company_id, o.id, b.period, JSON.stringify(figView(figures(o.id, thresholdsOf(o.id)))), b.notes, o.id, actor.user, b.period).lastInsertRowid);
      writeAudit(db, { entity: 'proj_risk_snapshots', entityId: id, action: 'create', newValues: { period: b.period }, actor: actor.user, companyId: o.company_id }); return reviews.get(actor, id);
    },
    update(actor, id, b) { const s = snapRow(actor, id, 'proj.risk.edit'); if (!['DRAFT', 'RETURNED'].includes(s.snap_status)) throw conflict('A review waiting for approval or reviewed is not edited.'); db.prepare('UPDATE proj_risk_snapshots SET notes = ?, data_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.notes ?? s.notes, JSON.stringify(figView(figures(s.org_project_id, thresholdsOf(s.org_project_id)))), actor.user, nowIso(), s.id); return reviews.get(actor, s.id); },
    remove(actor, id) { const s = snapRow(actor, id, 'proj.risk.delete'); if (s.snap_status !== 'DRAFT' || s.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted.'); db.prepare('UPDATE proj_risk_snapshots SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, s.id); return { id: s.id, deleted: true }; },
    submit(actor, id) {
      const s = snapRow(actor, id, 'proj.risk.submit'); if (!['DRAFT', 'RETURNED'].includes(s.snap_status)) throw unprocessable('Only a draft or a returned review is sent.');
      return transaction(db, () => {
        db.prepare('UPDATE proj_risk_snapshots SET data_json = ? WHERE id = ?').run(JSON.stringify(figView(figures(s.org_project_id, thresholdsOf(s.org_project_id)))), s.id); const ctx = { projectId: s.org_project_id };
        if (s.snap_status === 'RETURNED') workflowOf(db).resubmit(actor, s.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: RISK_REVIEW_DOC, docId: String(s.id), comment: `${orgOf(s.org_project_id).code} risk review ${s.period}`, context: ctx }); db.prepare('UPDATE proj_risk_snapshots SET workflow_instance_id = ? WHERE id = ?').run(inst.id, s.id); }
        db.prepare("UPDATE proj_risk_snapshots SET snap_status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), s.id);
        writeAudit(db, { entity: 'proj_risk_snapshots', entityId: s.id, action: 'submit', actor: actor.user, companyId: s.company_id }); return reviews.get(actor, s.id);
      });
    },
    withdraw(actor, id, { reason }) { const s = snapRow(actor, id); if (s.snap_status !== 'SUBMITTED') throw unprocessable('Only a review waiting for approval is withdrawn.'); if (!same(s.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, s.workflow_instance_id, { comment: reason }); return reviews.get(actor, s.id); },
    cancel(actor, id, { reason }) {
      const s = snapRow(actor, id, 'proj.risk.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(s.snap_status)) throw unprocessable('Only a review that is not yet approved is cancelled.');
      return transaction(db, () => { if (s.snap_status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, s.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proj_risk_snapshots SET snap_status = 'CANCELLED', remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), s.id); return reviews.get(actor, s.id); });
    },
    history(actor, id) { const s = snapRow(actor, id); return { approvals: s.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(s.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'proj_risk_snapshots' AND entity_id = ? ORDER BY id").all(String(s.id)) }; },
    /** The monthly review was decided: an approved review keeps its frozen figures. */
    decide(instance, actor, outcome, comment) {
      const s = db.prepare('SELECT * FROM proj_risk_snapshots WHERE id = ?').get(rid(instance.docId)); if (!s || s.snap_status !== 'SUBMITTED') return;
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'APPROVED' ? 'APPROVED' : outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proj_risk_snapshots SET snap_status = ?, approved_at = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, to === 'APPROVED' ? nowIso() : null, withdrawn ? null : s.workflow_instance_id, actor.user, nowIso(), s.id);
      writeAudit(db, { entity: 'proj_risk_snapshots', entityId: s.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: s.company_id });
      if (to === 'APPROVED') event('proj.risk.review_approved', actor, 'proj_risk_review', s.id, s.company_id, s.org_project_id, { projectId: s.org_project_id, reviewId: s.id, period: s.period });
    },
  };
  return { risks, issues, dashboard, reviews, settings };
}

// ---- workflow, resolvers, evidence and the alert dataset (04.09) -----------------------------------------------------------------------------------------
const userRoles = (u) => json(u.roles_json, []);
/** The project manager approves the closure of a high risk and the monthly review: the manager of the project (another project manager when they are the sender). */
if (!workflowResolvers.get('proj.riskpm')) workflowResolvers.register('proj.riskpm', ({ db, companyId, instance }) => {
  const oid = instance.docType === RISK_CLOSE_DOC ? db.prepare('SELECT org_project_id AS n FROM proj_risks WHERE id = ?').get(rid(instance.docId))?.n : db.prepare('SELECT org_project_id AS n FROM proj_risk_snapshots WHERE id = ?').get(rid(instance.docId))?.n;
  const x = oid ? db.prepare('SELECT pm_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(oid) : null; const me = String(instance.submittedBy ?? '').toLowerCase();
  if (x?.pm_user && x.pm_user.toLowerCase() !== me) return [{ user: x.pm_user }];
  const users = db.prepare('SELECT username, roles_json FROM iam_users WHERE company_id = ? AND is_active = 1').all(companyId).filter((u) => userRoles(u).includes('PM') && u.username.toLowerCase() !== me).map((u) => ({ user: u.username }));
  return users.length ? users : [{ role: 'PD' }];
});
const step = (code, name, approvers) => ({ code, name, type: 'approval', mode: 'single', approvers, slaHours: 48, requireAttachment: false, checklist: [], when: null, notify: [], action: null });
const rline = (db, id) => db.prepare('SELECT x.*, p.code, p.name AS pname FROM proj_risks x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(id);
workflowTypes.register({
  docType: RISK_CLOSE_DOC, label: 'Closure of a high or critical risk', processOwner: 'PM', route: (id) => `/proj/risk?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT x.doc_no, x.title, x.requested_by, p.code FROM proj_risks x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ? AND x.company_id = ?').get(rid(id), companyId); return r ? { ref: r.doc_no, title: `${r.code} ${r.title}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) { const r = rline(db, rid(id)); if (!r) return null; return { fields: [{ label: 'Project', value: `${r.code} ${r.pname}` }, { label: 'Risk', value: `${r.doc_no} · ${r.title}` }, { label: 'Level', value: `${RISK_LEVELS[r.level]} (score ${r.score})` }, { label: 'Owner', value: r.owner_user }, { label: 'Justification', value: r.close_reason ?? '' }, { label: 'Occurred', value: r.close_occurred ? 'Yes: an issue is raised' : 'No' }], lines: [] }; },
  defaultDefinition: { name: 'Risk closure: the owner justifies, the project manager approves', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PM', 'Project manager', [{ kind: 'resolver', resolver: 'proj.riskpm' }])] },
  hooks: { onApproved: (db, { instance, actor }) => risksOf(db)?.risks.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => risksOf(db)?.risks.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => risksOf(db)?.risks.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => risksOf(db)?.risks.decide(instance, actor, 'CANCELLED', comment) },
});
workflowTypes.register({
  docType: RISK_REVIEW_DOC, label: 'Monthly risk review', processOwner: 'PM', route: (id) => `/proj/risk-reviews?id=${id}`,
  describe(db, companyId, id) { const s = db.prepare('SELECT x.period, x.requested_by, p.code FROM proj_risk_snapshots x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ? AND x.company_id = ?').get(rid(id), companyId); return s ? { ref: `${s.code} ${s.period}`, title: `${s.code} risk review ${s.period}`, originator: s.requested_by } : null; },
  summarise(db, _actor, id) { const s = db.prepare('SELECT x.*, p.code, p.name AS pname FROM proj_risk_snapshots x JOIN org_projects p ON p.id = x.org_project_id WHERE x.id = ?').get(rid(id)); if (!s) return null; const d = json(s.data_json, {}); return { fields: [{ label: 'Project', value: `${s.code} ${s.pname}` }, { label: 'Month', value: s.period }, { label: 'Open risks', value: String(d.counts?.risks ?? 0) }, { label: 'Risk EMV', value: d.riskEmv ?? '0.00' }, { label: 'Contingency left', value: d.contingency?.left ?? '0.00' }, { label: 'Notes', value: s.notes ?? '' }], lines: [] }; },
  defaultDefinition: { name: 'Monthly risk review: the project manager, then the project director', settings: { resubmit: 'first', distinctApprovers: true }, steps: [step('PM', 'Project manager', [{ kind: 'resolver', resolver: 'proj.riskpm' }]), step('PD', 'Project director', [{ kind: 'role', role: 'PD' }])] },
  hooks: { onApproved: (db, { instance, actor }) => risksOf(db)?.reviews.decide(instance, actor, 'APPROVED'), onRejected: (db, { instance, actor, comment }) => risksOf(db)?.reviews.decide(instance, actor, 'REJECTED', comment), onReturned: (db, { instance, actor, comment }) => risksOf(db)?.reviews.decide(instance, actor, 'RETURNED', comment), onCancelled: (db, { instance, actor, comment }) => risksOf(db)?.reviews.decide(instance, actor, 'CANCELLED', comment) },
});
evidenceProviders.register(RISK_CLOSE_DOC, ({ db, instance }) => {
  const r = rline(db, rid(instance.docId)); if (!r) return { sections: [] };
  const open = db.prepare("SELECT COUNT(*) AS n FROM proj_risk_actions a LEFT JOIN tsk_tasks k ON k.id = a.task_id WHERE a.risk_id = ? AND a.deleted_at IS NULL AND COALESCE(k.status, 'OPEN') IN ('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED')").get(r.id).n;
  return { sections: [{ code: 'proj-risk', title: 'Before closing the risk', kind: 'metrics', items: [{ label: 'Risk', value: `${r.doc_no} ${r.title}`, format: 'text' }, { label: 'Score', value: `${r.score} (${RISK_LEVELS[r.level]})`, format: 'text' }, { label: 'EMV (₹)', value: money(r.emv), format: 'text' }, { label: 'Response actions still open', value: String(open), format: 'text' }, { label: 'Owner justification', value: r.close_reason ?? '', format: 'text' }] }] };
});
evidenceProviders.register(RISK_REVIEW_DOC, ({ db, instance }) => {
  const s = db.prepare('SELECT * FROM proj_risk_snapshots WHERE id = ?').get(rid(instance.docId)); if (!s) return { sections: [] }; const d = json(s.data_json, {});
  return { sections: [{ code: 'proj-risk-review', title: 'The register this month', kind: 'metrics', items: [{ label: 'Open risks', value: String(d.counts?.risks ?? 0), format: 'text' }, { label: 'High and critical', value: String((d.counts?.high ?? 0) + (d.counts?.critical ?? 0)), format: 'text' }, { label: 'Risk EMV (₹)', value: d.riskEmv ?? '0.00', format: 'text' }, { label: 'Open issues', value: String(d.counts?.issues ?? 0), format: 'text' }] }] };
});
if (!alertDatasets.get('proj.risk_trigger')) alertDatasets.register({
  code: 'proj.risk_trigger', label: 'Risk early-warning triggers (fired)', ownerModule: 'proj', entity: 'risk_trigger',
  fields: [{ key: 'riskNo', label: 'Risk', type: 'text' }, { key: 'trigger', label: 'Indicator', type: 'text' }, { key: 'reading', label: 'Reading', type: 'number' }, { key: 'threshold', label: 'Threshold', type: 'number' }, { key: 'project', label: 'Project', type: 'text' }, { key: 'level', label: 'Risk level', type: 'enum' }, { key: 'fired', label: 'Fired', type: 'boolean' }],
  query(db, { companyId }) {
    return db.prepare("SELECT tr.*, x.doc_no, x.level, x.owner_user, p.code FROM proj_risk_triggers tr JOIN proj_risks x ON x.id = tr.risk_id JOIN org_projects p ON p.id = tr.org_project_id WHERE tr.company_id = ? AND tr.deleted_at IS NULL AND tr.trigger_status = 'FIRED' AND x.status = 'OPEN' AND x.deleted_at IS NULL").all(companyId).map((t) => ({
      id: String(t.id), label: `${t.doc_no}: ${t.name}`, route: `/proj/risk?id=${t.risk_id}`, projectId: t.org_project_id, siteId: null, owners: [t.owner_user],
      fields: { riskNo: t.doc_no, trigger: t.name, reading: t.current_value, threshold: t.threshold, project: t.code, level: t.level, fired: true },
    }));
  },
});
void RISK_LEVEL_ORDER; void same;
