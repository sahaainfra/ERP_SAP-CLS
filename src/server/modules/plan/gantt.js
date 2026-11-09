import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf, toXlsx } from '../../platform/export/index.js';
import { todayIST } from '../../../shared/dates.js';
import { isoOf, ordOf } from './cpm.js';

// Interactive Gantt, schedule editing and resource loading (part 13.02). It calls the schedule core of 13.01 for every change (activities, links, the CPM pass), never its tables directly for logic:
// - an edit made on the Gantt (move, resize, inline edit, link, unlink, add, delete) is tried first inside a savepoint: the server applies it through the 13.01 service, recalculates, works out what moved
//   and what conflicts with the logic or a constraint, and rolls back (BR-01). The page shows that; the save repeats it for real and keeps the state before and after, so the edit can be undone (FR-02);
// - the labour, plant and material of an activity (FR-03), as a total or a daily rate, by hand or from the BOQ norms (the rate analyses of 06.06, or the bill of resources of 06.03);
// - the availability: approved deployments of 07.03 by crew trade, and capacity rows drafted by one person and put in force by another (the adapter until the plant register of 17.02);
// - the histograms: the demand of every resource by day, week or month on the early or late dates, against the availability, with the over-allocated days.
export const RES_TYPES = { LABOUR: 'Labour', PLANT: 'Plant', MATERIAL: 'Material' };
const ITEM_TYPES = { LABOUR: ['LABOUR'], PLANT: ['EQUIPMENT', 'TOOL'], MATERIAL: ['MATERIAL', 'CONSUMABLE', 'RETURNABLE', 'SPARE'] };
const TYPE_OF_COMPONENT = { LABOUR: 'LABOUR', EQUIPMENT: 'PLANT', MATERIAL: 'MATERIAL', CONSUMABLE: 'MATERIAL', RETURNABLE: 'MATERIAL', SPARE: 'MATERIAL', TOOL: 'PLANT' };
const TABLES = { acts: 'plan_activities', links: 'plan_dependencies', res: 'plan_activity_resources', boq: 'plan_activity_boq' };
const KEEP = new Set(['id', 'company_id', 'created_at', 'created_by', 'version']);
const nowIso = () => new Date().toISOString();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const round3 = (n) => Math.round(n * 1000) / 1000;
const keyOf = (type, itemId, trade, itemName) => (type === 'LABOUR' ? `trade:${String(trade || itemName || '').trim().toLowerCase()}` : itemId ? `item:${itemId}` : `trade:${String(trade).trim().toLowerCase()}`);

export function createGanttService({ db, plan }) {
  const authz = authzOf(db);
  const at = (actor, key, projectId) => authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed;
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const sched = (actor, id) => { const v = plan.schedules.get(actor, id); return { v, s: db.prepare('SELECT * FROM plan_schedules WHERE id = ?').get(v.id) }; };
  const editable = (s) => ['DRAFT', 'RETURNED'].includes(s.status);
  const calRows = new Map();
  const calendarById = (id) => plan.calendarOf(db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(id));
  const calendars = () => { calRows.clear(); return (id) => { if (!calRows.has(id)) calRows.set(id, calendarById(id)); return calRows.get(id); }; };
  const actRow = (actor, id) => { const a = db.prepare('SELECT * FROM plan_activities WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId); if (!a) throw notFound('That activity does not exist.'); return a; };

  // ---- the Gantt data (FR-01) -------------------------------------------------------------------------------------------------------------------------------------
  function lastEdits(s, n = 10) { return db.prepare('SELECT id, op, summary, finish_before, finish_after, created_by, created_at, undone_at, undone_by FROM plan_gantt_edits WHERE schedule_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(s.id, n).map((e) => ({ id: e.id, op: e.op, summary: e.summary, finishBefore: e.finish_before, finishAfter: e.finish_after, by: e.created_by, at: e.created_at, undoneAt: e.undone_at, undoneBy: e.undone_by })); }
  function data(actor, id) {
    const { v, s } = sched(actor, id);
    const res = new Map(db.prepare('SELECT activity_id, COUNT(*) AS n FROM plan_activity_resources WHERE schedule_id = ? AND deleted_at IS NULL GROUP BY activity_id').all(s.id).map((r) => [r.activity_id, r.n]));
    const acts = db.prepare('SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL ORDER BY sort_order, id').all(s.id).map((a) => ({
      id: a.id, code: a.code, name: a.name, wbsId: a.wbs_id, type: a.act_type, duration: a.duration_days, calendarId: a.calendar_id, constraintType: a.constraint_type, constraintDate: a.constraint_date,
      es: a.es, ef: a.ef, ls: a.ls, lf: a.lf, totalFloat: a.total_float, freeFloat: a.free_float, critical: Boolean(a.is_critical), actualStart: a.actual_start, actualFinish: a.actual_finish,
      pctComplete: a.pct_complete / 100, remainingDays: a.remaining_days, rowVersion: a.version, resources: res.get(a.id) ?? 0,
    }));
    const links = db.prepare('SELECT id, pred_id, succ_id, dep_type, lag_days FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id).map((l) => ({ id: l.id, predId: l.pred_id, succId: l.succ_id, type: l.dep_type, lag: l.lag_days }));
    const wbs = db.prepare('SELECT id, parent_id, code, name, level FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL ORDER BY code').all(s.org_project_id).map((w) => ({ id: w.id, parentId: w.parent_id, code: w.code, name: w.name, level: w.level }));
    const canEdit = Boolean(v.can.edit) && editable(s);
    const edits = lastEdits(s);
    return {
      schedule: { id: s.id, docNo: s.doc_no, name: s.name, projectId: s.org_project_id, projectCode: v.projectCode, projectName: v.projectName, versionNo: s.version_no, status: s.status, start: s.start_date, finish: s.finish_date, dataDate: s.data_date, today: todayIST(), needsCalc: Boolean(s.needs_calc), calendar: v.calendar, workWeek: db.prepare('SELECT work_week FROM plan_calendars WHERE id = ?').get(s.calendar_id)?.work_week ?? '1111110' },
      can: { edit: canEdit, resources: at(actor, 'plan.resource.view', s.org_project_id), editResources: canEdit && at(actor, 'plan.resource.edit', s.org_project_id), print: at(actor, 'plan.schedule.print', s.org_project_id), export: at(actor, 'plan.schedule.export', s.org_project_id), undo: canEdit && edits.some((e) => !e.undoneAt) },
      activities: acts, links, wbs, edits, baseline: null,
    };
  }

  // ---- edits with a try first, and undo (FR-02, BR-01) ------------------------------------------------------------------------------------------------------------
  const snap = (scheduleId, ids) => {
    const list = [...new Set(ids.filter(Boolean))]; if (!list.length) return { acts: [], links: [], res: [], boq: [] }; const ph = list.map(() => '?').join(',');
    return {
      acts: db.prepare(`SELECT * FROM plan_activities WHERE id IN (${ph})`).all(...list),
      links: db.prepare(`SELECT * FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL AND (pred_id IN (${ph}) OR succ_id IN (${ph}))`).all(scheduleId, ...list, ...list),
      res: db.prepare(`SELECT * FROM plan_activity_resources WHERE deleted_at IS NULL AND activity_id IN (${ph})`).all(...list),
      boq: db.prepare(`SELECT * FROM plan_activity_boq WHERE deleted_at IS NULL AND activity_id IN (${ph})`).all(...list),
    };
  };
  const datesOf = (scheduleId) => new Map(db.prepare('SELECT id, code, es, ef, total_float FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(scheduleId).map((a) => [a.id, a]));
  const workingDays = (cal, from, to) => { let n = 0; for (let o = ordOf(from); o <= ordOf(to); o += 1) if (cal.isWork(o)) n += 1; return n; };
  const calFor = (s, a) => calendarById(a.calendar_id ?? s.calendar_id);
  const recalc = (actor, s) => plan.runCalc(actor, s.id);

  /** Move an activity to start on a date: the logic decides the earliest start; a later start is held by a "start no earlier than" constraint. */
  function move(actor, s, a, start, out) {
    if (a.actual_start) throw unprocessable(`${a.code} has started on ${a.actual_start}: its start is a fact. Record its progress instead.`);
    if (['SUMMARY', 'LOE'].includes(a.act_type)) throw unprocessable(`${a.code} spans other activities: move those instead.`);
    const cal = calFor(s, a); let want = start;
    if (!cal.isWork(ordOf(want))) { want = isoOf(cal.next(ordOf(want))); out.warnings.push({ code: 'NON_WORKING', message: `${start} is not a working day of ${a.code}'s calendar: it starts on ${want}.` }); }
    if (want < s.start_date) { out.conflicts.push({ code: 'BEFORE_START', message: `${a.code} cannot start before the schedule starts (${s.start_date}).`, activities: [a.code] }); want = s.start_date; }
    if (a.constraint_type === 'FNLT') out.conflicts.push({ code: 'CONSTRAINT_REPLACED', message: `${a.code} must finish no later than ${a.constraint_date}; moving it replaces that constraint with "start no earlier than ${want}".`, activities: [a.code] });
    plan.activities.update(actor, a.id, { constraintType: 'NONE', constraintDate: null }); recalc(actor, s);
    const logic = db.prepare('SELECT es FROM plan_activities WHERE id = ?').get(a.id).es;
    if (want > logic) plan.activities.update(actor, a.id, { constraintType: 'SNET', constraintDate: want });
    else if (want < logic) {
      const drivers = db.prepare('SELECT p.code FROM plan_dependencies d JOIN plan_activities p ON p.id = d.pred_id WHERE d.succ_id = ? AND d.deleted_at IS NULL AND p.deleted_at IS NULL ORDER BY p.ef DESC LIMIT 3').all(a.id).map((x) => x.code);
      out.conflicts.push({ code: 'LOGIC', message: `${a.code} cannot start before ${logic}${drivers.length ? `: its predecessors ${drivers.join(', ')} hold it` : ''}. It stays at ${logic}; remove or change a link to start it earlier.`, activities: [a.code, ...drivers] });
    }
  }
  /** Stretch or shorten an activity to finish on a date: its duration becomes the working days from its start to that date. */
  function resize(actor, s, a, finish) {
    if (a.actual_finish) throw unprocessable(`${a.code} is finished: its dates are facts.`);
    if (a.actual_start) throw unprocessable(`${a.code} has started: change its remaining duration through the progress update.`);
    if (['MILESTONE', 'SUMMARY', 'LOE'].includes(a.act_type)) throw unprocessable(`${a.code} is a ${a.act_type === 'MILESTONE' ? 'milestone (no duration)' : 'span of other activities'}: it is not stretched.`);
    const cur = db.prepare('SELECT es FROM plan_activities WHERE id = ?').get(a.id).es ?? s.start_date;
    if (finish < cur) throw badRequest('Correct the highlighted fields', [{ field: 'finish', message: `The finish is on or after the start (${cur})` }]);
    const d = Math.max(1, workingDays(calFor(s, a), cur, finish)); plan.activities.update(actor, a.id, { duration: d }); return d;
  }

  function perform(actor, s, b, out) {
    const a = b.activityId ? actRow(actor, b.activityId) : null;
    if (a && a.schedule_id !== s.id) throw notFound('That activity is not in this schedule.');
    const need = (k) => { if (!b[k] && b[k] !== 0) throw badRequest('Correct the highlighted fields', [{ field: k, message: 'Required for this edit' }]); };
    switch (b.op) {
      case 'MOVE': need('activityId'); need('start'); move(actor, s, a, b.start, out); out.summary = `Moved ${a.code} to start ${b.start}`; out.ids = [a.id]; break;
      case 'RESIZE': { need('activityId'); need('finish'); const d = resize(actor, s, a, b.finish); out.summary = `${a.code} to finish ${b.finish} (${d} days)`; out.ids = [a.id]; break; }
      case 'EDIT': {
        need('activityId'); const parts = [];
        if (b.name && b.name !== a.name) { plan.activities.update(actor, a.id, { name: b.name }); parts.push(`name "${b.name}"`); }
        if (b.duration != null && b.duration !== a.duration_days) { if (a.actual_start) throw unprocessable(`${a.code} has started: change its remaining duration through the progress update.`); plan.activities.update(actor, a.id, { duration: b.duration }); parts.push(`${b.duration} days`); }
        if (b.start) { recalc(actor, s); move(actor, s, actRow(actor, a.id), b.start, out); parts.push(`start ${b.start}`); }
        if (b.finish) { recalc(actor, s); resize(actor, s, actRow(actor, a.id), b.finish); parts.push(`finish ${b.finish}`); }
        if (!parts.length) throw badRequest('Correct the highlighted fields', [{ field: 'name', message: 'Change the name, duration, start or finish' }]);
        out.summary = `${a.code}: ${parts.join(', ')}`; out.ids = [a.id]; break;
      }
      case 'LINK': { need('predId'); need('succId'); const l = plan.links.create(actor, s.id, { predId: b.predId, succId: b.succId, type: b.type, lag: b.lag }); out.summary = `Linked ${l.pred} ${l.type}${l.lag ? (l.lag > 0 ? `+${l.lag}` : l.lag) : ''} ${l.succ}`; out.ids = [l.predId, l.succId]; break; }
      case 'UNLINK': {
        need('linkId'); const d = db.prepare('SELECT d.*, p.code AS pc, q.code AS sc FROM plan_dependencies d JOIN plan_activities p ON p.id = d.pred_id JOIN plan_activities q ON q.id = d.succ_id WHERE d.id = ? AND d.schedule_id = ? AND d.deleted_at IS NULL').get(b.linkId, s.id);
        if (!d) throw notFound('That link is not in this schedule.'); out.ids = [d.pred_id, d.succ_id]; out.before = snap(s.id, out.ids); plan.links.remove(actor, d.id); out.summary = `Removed the link ${d.pc} → ${d.sc}`; break;
      }
      case 'ADD': {
        if (!b.name) throw badRequest('Correct the highlighted fields', [{ field: 'name', message: 'Name the activity' }]);
        const created = plan.activities.create(actor, s.id, { name: b.name, type: b.actType, duration: b.actType === 'MILESTONE' ? 0 : (b.duration ?? 1), wbsId: b.wbsId ?? null });
        out.ids = [created.id]; out.summary = `Added ${created.code} ${b.name}`;
        if (b.afterId) { const l = plan.links.create(actor, s.id, { predId: b.afterId, succId: created.id, type: 'FS', lag: 0 }); out.ids.push(l.predId); out.summary += ` after ${l.pred}`; }
        out.created = created.id; break;
      }
      case 'DELETE': {
        need('activityId'); if (a.actual_start) throw unprocessable(`${a.code} has started: it is not deleted.`);
        db.prepare('UPDATE plan_activity_resources SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE activity_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, a.id);
        plan.activities.remove(actor, a.id); out.summary = `Deleted ${a.code} ${a.name}`; out.ids = [a.id]; break;
      }
      default: throw badRequest('Unknown edit');
    }
  }

  /** FR-02, BR-01: an edit made on the Gantt. With `dryRun` (or when it conflicts and is not confirmed) nothing is kept: the answer says what would move and what conflicts. */
  function edit(actor, id, b, { dryRun = false } = {}) {
    const { v, s } = sched(actor, id);
    if (!at(actor, 'plan.schedule.edit', s.org_project_id)) throw forbidden('You may not edit this schedule (permission plan.schedule.edit).');
    if (!editable(s) || !v.can.edit) throw conflict(`${s.doc_no} is ${s.status.toLowerCase()}: its logic is changed in a new version.`);
    if (!s.activities_count && b.op !== 'ADD') throw unprocessable('The schedule has no activities yet.');
    const out = { op: b.op, summary: '', conflicts: [], warnings: [], ids: [], before: null, created: null };
    db.exec('SAVEPOINT plan_gantt_try');
    let keep = false;
    try {
      if (s.activities_count && (s.needs_calc || !s.finish_date)) recalc(actor, s);
      const s0 = db.prepare('SELECT * FROM plan_schedules WHERE id = ?').get(s.id); const dates0 = datesOf(s.id);
      const pre = b.op === 'ADD' ? [b.afterId] : b.op === 'LINK' ? [b.predId, b.succId] : [b.activityId];
      const before = b.op === 'UNLINK' ? null : snap(s.id, pre);
      perform(actor, s, b, out);
      const beforeSnap = before ?? out.before;
      recalc(actor, s);
      const s1 = db.prepare('SELECT * FROM plan_schedules WHERE id = ?').get(s.id); const dates1 = datesOf(s.id);
      const changed = []; for (const [k, x] of dates1) { const y = dates0.get(k); if (!y || y.es !== x.es || y.ef !== x.ef) changed.push({ id: k, code: x.code, es: x.es, ef: x.ef, esBefore: y?.es ?? null, efBefore: y?.ef ?? null }); }
      const negative = [...dates1.values()].filter((x) => x.total_float != null && x.total_float < 0 && !((dates0.get(x.id)?.total_float ?? 0) < 0)).map((x) => x.code);
      if (negative.length) out.conflicts.push({ code: 'NEGATIVE_FLOAT', message: `${negative.length} ${negative.length === 1 ? 'activity would finish' : 'activities would finish'} after a "finish no later than" constraint (negative float): ${negative.slice(0, 10).join(', ')}${negative.length > 10 ? ' …' : ''}.`, activities: negative.slice(0, 50) });
      if (s0.finish_date && s1.finish_date && s1.finish_date > s0.finish_date) out.warnings.push({ code: 'FINISH_LATER', message: `The schedule would finish on ${s1.finish_date} instead of ${s0.finish_date}.` });
      const result = { saved: false, editId: null, op: b.op, summary: out.summary, conflicts: out.conflicts, warnings: out.warnings, changed: changed.slice(0, 500), changedCount: changed.length, finishBefore: s0.finish_date, finishAfter: s1.finish_date, createdId: out.created };
      if (dryRun || (out.conflicts.length && !b.confirm)) {
        if (!dryRun) throw Object.assign(conflict(`The edit conflicts with the schedule: ${out.conflicts.map((c) => c.message).join(' ')} Confirm it to save it anyway.`), { details: out.conflicts.map((c) => ({ field: c.code, message: c.message })) });
        return result;
      }
      const after = snap(s.id, [...out.ids, out.created]);
      const editId = Number(db.prepare('INSERT INTO plan_gantt_edits (company_id, schedule_id, op, summary, before_json, after_json, finish_before, finish_after, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'gantt\')')
        .run(s.company_id, s.id, b.op, out.summary.slice(0, 300), JSON.stringify(beforeSnap), JSON.stringify(after), s0.finish_date, s1.finish_date, s.org_project_id, actor.user).lastInsertRowid);
      syncResources(s.id);
      audit(actor, 'plan_schedules', s.id, 'gantt_edit', s.company_id, { newValues: { edit: editId, op: b.op, summary: out.summary, confirmed: out.conflicts.length ? out.conflicts.map((c) => c.code) : undefined, finish: s1.finish_date } });
      keep = true;
      return { ...result, saved: true, editId };
    } finally {
      db.exec(keep ? 'RELEASE plan_gantt_try' : 'ROLLBACK TO plan_gantt_try; RELEASE plan_gantt_try');
    }
  }

  /** FR-02: undo the latest edit of the schedule that is not undone yet, if nothing it touched has changed since. */
  function undo(actor, id, { editId = null } = {}) {
    const { v, s } = sched(actor, id);
    if (!at(actor, 'plan.schedule.edit', s.org_project_id)) throw forbidden('You may not edit this schedule (permission plan.schedule.edit).');
    if (!editable(s) || !v.can.edit) throw conflict(`${s.doc_no} is ${s.status.toLowerCase()}: nothing is undone on it.`);
    const last = db.prepare('SELECT * FROM plan_gantt_edits WHERE schedule_id = ? AND undone_at IS NULL AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(s.id);
    if (!last) throw unprocessable('There is nothing to undo.');
    if (editId && editId !== last.id) { const e = db.prepare('SELECT undone_at FROM plan_gantt_edits WHERE id = ? AND schedule_id = ?').get(editId, s.id); throw conflict(e?.undone_at ? 'That edit was undone already.' : 'Undo the later edits first: edits are undone from the latest.'); }
    const before = json(last.before_json, {}); const after = json(last.after_json, {});
    for (const [k, t] of Object.entries(TABLES)) {
      for (const r of after[k] ?? []) { const cur = db.prepare(`SELECT version, deleted_at FROM ${t} WHERE id = ?`).get(r.id); if (!cur || cur.version !== r.version || (cur.deleted_at ?? null) !== (r.deleted_at ?? null)) throw conflict(`Something this edit touched has changed since ("${last.summary}"): it can no longer be undone. Reload the schedule.`); }
    }
    return transaction(db, () => {
      const now = nowIso();
      for (const [k, t] of Object.entries(TABLES)) {
        const was = new Set((before[k] ?? []).map((r) => r.id));
        for (const r of after[k] ?? []) if (!was.has(r.id) && !r.deleted_at) db.prepare(`UPDATE ${t} SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?`).run(now, actor.user, r.id);
        for (const r of before[k] ?? []) {
          const cols = Object.keys(r).filter((c) => !KEEP.has(c));
          // the row as it was, version included: the state is the one an earlier edit (or a page holding that version) knew
          try { db.prepare(`UPDATE ${t} SET ${cols.map((c) => `${c} = ?`).join(', ')}, version = ? WHERE id = ?`).run(...cols.map((c) => r[c]), r.version, r.id); } catch (e) { if (/UNIQUE/.test(String(e?.message))) throw conflict('An activity or link made since takes the place of one this edit removed: it can no longer be undone.'); throw e; }
        }
      }
      db.prepare('UPDATE plan_gantt_edits SET undone_at = ?, undone_by = ?, version = version + 1 WHERE id = ?').run(now, actor.user, last.id);
      db.prepare('UPDATE plan_schedules SET needs_calc = 1 WHERE id = ?').run(s.id);
      const live = db.prepare('SELECT COUNT(*) AS n FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').get(s.id).n;
      if (live) recalc(actor, s); else db.prepare('UPDATE plan_schedules SET activities_count = 0, critical_count = 0, finish_date = NULL WHERE id = ?').run(s.id);
      syncResources(s.id);
      audit(actor, 'plan_schedules', s.id, 'gantt_undo', s.company_id, { newValues: { edit: last.id, summary: last.summary } });
      return { undone: last.id, summary: last.summary, finish: db.prepare('SELECT finish_date FROM plan_schedules WHERE id = ?').get(s.id).finish_date };
    });
  }

  // ---- resources of an activity (FR-03) -----------------------------------------------------------------------------------------------------------------------------
  /** The stored total and daily rate follow the duration: the one entered is kept, the other is worked out. */
  function syncResources(scheduleId) {
    db.prepare(`UPDATE plan_activity_resources SET
        qty_per_day = CASE WHEN basis = 'TOTAL' THEN CAST(ROUND(qty_total * 1.0 / MAX(1, (SELECT duration_days FROM plan_activities a WHERE a.id = activity_id))) AS INTEGER) ELSE qty_per_day END,
        qty_total = CASE WHEN basis = 'PER_DAY' THEN qty_per_day * MAX(1, (SELECT duration_days FROM plan_activities a WHERE a.id = activity_id)) ELSE qty_total END
      WHERE schedule_id = ? AND deleted_at IS NULL`).run(scheduleId);
  }
  const resView = (r) => ({ id: r.id, activityId: r.activity_id, type: r.resource_type, typeLabel: RES_TYPES[r.resource_type], itemId: r.item_id, itemCode: r.item_code ?? null, trade: r.trade, key: r.res_key, label: r.label, uom: r.uom, basis: r.basis, qtyTotal: r.qty_total / 1000, qtyPerDay: r.qty_per_day / 1000, sourceType: r.source_type });
  function resourcesOf(actor, activityId) {
    const a = actRow(actor, activityId); const { s } = sched(actor, a.schedule_id);
    if (!at(actor, 'plan.resource.view', s.org_project_id)) throw forbidden('You may not see the resources of this schedule (permission plan.resource.view).');
    return { activityId: a.id, code: a.code, name: a.name, duration: a.duration_days, rowVersion: a.version, editable: editable(s) && at(actor, 'plan.resource.edit', s.org_project_id), rows: db.prepare('SELECT r.*, i.code AS item_code FROM plan_activity_resources r LEFT JOIN mdm_items i ON i.id = r.item_id WHERE r.activity_id = ? AND r.deleted_at IS NULL ORDER BY r.resource_type, r.label').all(a.id).map(resView) };
  }
  const itemOf = (companyId, id) => db.prepare("SELECT id, code, name, item_type, base_uom FROM mdm_items WHERE id = ? AND company_id = ? AND item_status = 'ACTIVE' AND deleted_at IS NULL").get(id, companyId);
  function checkRows(actor, rows, prefix = 'rows') {
    const p = []; const seen = new Set();
    const out = rows.map((r, i) => {
      const it = r.itemId ? itemOf(actor.companyId, r.itemId) : null;
      if (r.itemId && !it) { p.push({ field: `${prefix}.${i}.itemId`, message: 'Choose an item in force of the item master' }); return null; }
      if (it && !ITEM_TYPES[r.type].includes(it.item_type)) { p.push({ field: `${prefix}.${i}.itemId`, message: `${it.code} is ${it.item_type.toLowerCase()}, not ${r.type.toLowerCase()}` }); return null; }
      const key = keyOf(r.type, it?.id, r.trade, it?.name); const uom = r.uom ?? it?.base_uom ?? (r.type === 'LABOUR' ? 'man-day' : r.type === 'PLANT' ? 'hour' : null);
      if (!uom) p.push({ field: `${prefix}.${i}.uom`, message: 'Give the unit' });
      if (seen.has(`${r.type}|${key}`)) p.push({ field: `${prefix}.${i}.itemId`, message: 'This resource is given twice' }); seen.add(`${r.type}|${key}`);
      return { ...r, key, uom, label: it ? `${it.code} ${it.name}` : String(r.trade).trim(), trade: r.type === 'LABOUR' ? (r.trade || it?.name || null) : (r.trade ?? null), itemId: it?.id ?? null };
    });
    if (p.length) throw badRequest('Correct the highlighted fields', p);
    return out;
  }
  /** Replace the resources of an activity; kept in the edit log so it can be undone like any Gantt edit. */
  function saveResources(actor, activityId, b) {
    const a = actRow(actor, activityId); const { v, s } = sched(actor, a.schedule_id);
    if (!at(actor, 'plan.resource.edit', s.org_project_id)) throw forbidden('You may not assign resources (permission plan.resource.edit).');
    if (!editable(s) || !v.can.edit) throw conflict(`${s.doc_no} is ${s.status.toLowerCase()}: its resources change in a new version.`);
    if (b.rowVersion && b.rowVersion !== a.version) throw conflict('Someone changed this activity; reload it.');
    const rows = checkRows(actor, b.rows); const dur = Math.max(1, a.duration_days);
    return transaction(db, () => {
      const before = snap(s.id, [a.id]); const now = nowIso();
      db.prepare('UPDATE plan_activity_resources SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE activity_id = ? AND deleted_at IS NULL').run(now, actor.user, a.id);
      for (const r of rows) {
        const q = Math.round(r.qty * 1000); const total = r.basis === 'TOTAL' ? q : q * dur; const perDay = r.basis === 'TOTAL' ? Math.round(q / dur) : q;
        db.prepare('INSERT INTO plan_activity_resources (company_id, schedule_id, activity_id, resource_type, item_id, trade, res_key, label, uom, basis, qty_total, qty_per_day, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(s.company_id, s.id, a.id, r.type, r.itemId, r.trade, r.key, r.label.slice(0, 200), r.uom, r.basis, total, perDay, s.org_project_id, actor.user, r.sourceType);
      }
      const after = snap(s.id, [a.id]); const summary = `Resources of ${a.code}: ${rows.length ? rows.map((r) => `${r.label} ${round3(r.qty)} ${r.uom}${r.basis === 'PER_DAY' ? '/day' : ''}`).join(', ').slice(0, 250) : 'none'}`;
      const editId = Number(db.prepare("INSERT INTO plan_gantt_edits (company_id, schedule_id, op, summary, before_json, after_json, finish_before, finish_after, project_id, created_by, source_type) VALUES (?, ?, 'RESOURCES', ?, ?, ?, ?, ?, ?, ?, 'gantt')")
        .run(s.company_id, s.id, summary, JSON.stringify(before), JSON.stringify(after), s.finish_date, s.finish_date, s.org_project_id, actor.user).lastInsertRowid);
      audit(actor, 'plan_activities', a.id, 'resources', s.company_id, { oldValues: { rows: before.res.length }, newValues: { rows: rows.map((r) => ({ type: r.type, key: r.key, qty: r.qty, basis: r.basis, uom: r.uom })) } });
      publishEvent(db, { type: 'plan.resources.updated', entity: 'plan_schedule', entityId: s.id, actorId: actor.user, companyId: s.company_id, projectId: s.org_project_id, data: { scheduleId: s.id, projectId: s.org_project_id, activityId: a.id, code: a.code, rows: rows.map((r) => ({ type: r.type, key: r.key, label: r.label, uom: r.uom, qtyTotal: r.basis === 'TOTAL' ? r.qty : round3(r.qty * dur) })) } });
      return { ...resourcesOf(actor, a.id), editId };
    });
  }
  /** FR-03: what the BOQ lines of an activity need by the norms: the rate analysis of the line (or the approved one of its work item), else the bill of resources of the work item. Nothing is saved. */
  function norms(actor, activityId) {
    const a = actRow(actor, activityId); const { s } = sched(actor, a.schedule_id);
    if (!at(actor, 'plan.resource.view', s.org_project_id)) throw forbidden('You may not see the resources of this schedule (permission plan.resource.view).');
    const lines = db.prepare('SELECT b.qty, l.id, l.item_code, l.description, l.uom, l.analysis_id, l.work_item_id FROM plan_activity_boq b JOIN proj_boq_lines l ON l.id = b.boq_line_id WHERE b.activity_id = ? AND b.deleted_at IS NULL').all(a.id);
    const agg = new Map(); const missing = []; const used = [];
    const add = (type, it, qty, uom, from) => { const key = keyOf(type, it.id, null, it.name); const k = `${type}|${key}`; const x = agg.get(k) ?? { type, itemId: it.id, itemCode: it.code, label: `${it.code} ${it.name}`, trade: type === 'LABOUR' ? it.name : null, uom, qty: 0, basis: 'TOTAL', sourceType: 'BOQ_NORM', from: [] }; x.qty += qty; if (!x.from.includes(from)) x.from.push(from); agg.set(k, x); };
    for (const l of lines) {
      const boqQty = l.qty / 1000;
      const an = l.analysis_id ? db.prepare('SELECT id, analysis_no, version_no, basis_qty FROM ra_analyses WHERE id = ?').get(l.analysis_id)
        : l.work_item_id ? db.prepare("SELECT id, analysis_no, version_no, basis_qty FROM ra_analyses WHERE company_id = ? AND work_item_id = ? AND analysis_status = 'APPROVED' AND deleted_at IS NULL AND (project_id IS NULL OR project_id = ?) ORDER BY (project_id IS NULL), effective_from DESC, version_no DESC LIMIT 1").get(s.company_id, l.work_item_id, s.org_project_id) : null;
      let n = 0;
      if (an) {
        for (const c of db.prepare("SELECT c.component_type, c.qty_per_basis, c.wastage_pct, c.uom, i.id, i.code, i.name FROM ra_analysis_lines c JOIN mdm_items i ON i.id = c.component_item_id WHERE c.analysis_id = ? AND c.deleted_at IS NULL AND c.component_type IN ('LABOUR', 'EQUIPMENT', 'MATERIAL')").all(an.id)) {
          const type = TYPE_OF_COMPONENT[c.component_type]; add(type, c, (boqQty * (c.qty_per_basis / 1000)) / (an.basis_qty / 1000) * (1 + c.wastage_pct / 1e6), c.uom, l.item_code); n += 1;
        }
        if (n) used.push(`${l.item_code}: ${an.analysis_no}/v${an.version_no}`);
      }
      if (!n && l.work_item_id) {
        for (const c of db.prepare('SELECT r.qty_per_unit, r.wastage_pct, r.uom, i.id, i.code, i.name, i.item_type FROM mdm_item_resources r JOIN mdm_items i ON i.id = r.component_item_id WHERE r.parent_item_id = ? AND r.deleted_at IS NULL').all(l.work_item_id)) {
          const type = TYPE_OF_COMPONENT[c.item_type]; if (!type) continue; add(type, c, boqQty * (c.qty_per_unit / 1000) * (1 + c.wastage_pct / 1e6), c.uom, l.item_code); n += 1;
        }
        if (n) used.push(`${l.item_code}: bill of resources`);
      }
      if (!n) missing.push(`${l.item_code} ${l.description}`.slice(0, 120));
    }
    return { activityId: a.id, code: a.code, boqLines: lines.length, rows: [...agg.values()].map((x) => ({ ...x, qty: round3(x.qty) })), sources: used, missing };
  }
  function resourceOptions(actor, { projectId, type, q }) {
    if (!authz.check(actor, 'plan.resource.view').allowed) throw forbidden('You may not see resources (permission plan.resource.view).');
    const types = type ? ITEM_TYPES[type] : Object.values(ITEM_TYPES).flat(); const like = `%${q ?? ''}%`;
    const items = db.prepare(`SELECT id, code, name, item_type, base_uom FROM mdm_items WHERE company_id = ? AND item_status = 'ACTIVE' AND deleted_at IS NULL AND item_type IN (${types.map(() => '?').join(',')}) AND (code LIKE ? OR name LIKE ?) ORDER BY code LIMIT 50`).all(actor.companyId, ...types, like, like)
      .map((i) => ({ id: i.id, code: i.code, name: i.name, type: Object.keys(ITEM_TYPES).find((k) => ITEM_TYPES[k].includes(i.item_type)), uom: i.base_uom }));
    const trades = db.prepare("SELECT DISTINCT trade FROM hr_crews WHERE company_id = ? AND trade IS NOT NULL AND trade <> '' AND deleted_at IS NULL ORDER BY trade").all(actor.companyId).map((r) => r.trade);
    return { items, trades, types: Object.entries(RES_TYPES).map(([code, label]) => ({ code, label })), projectId: projectId ?? null };
  }

  // ---- availability: deployments (07.03) and capacity rows put in force by a second person ----------------------------------------------------------------------
  const capView = (actor, r) => ({ id: r.id, projectId: r.org_project_id, project: r.pcode ?? null, type: r.resource_type, typeLabel: RES_TYPES[r.resource_type], itemId: r.item_id, trade: r.trade, key: r.res_key, label: r.label, uom: r.uom, qtyPerDay: r.qty_per_day / 1000, from: r.from_date, to: r.to_date, status: r.status, reason: r.reason, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at,
    can: { activate: r.status === 'DRAFT' && at(actor, 'plan.capacity.approve', r.org_project_id) && String(r.requested_by).toLowerCase() !== String(actor.user).toLowerCase(), cancel: r.status !== 'CANCELLED' && (at(actor, 'plan.capacity.manage', r.org_project_id) || at(actor, 'plan.capacity.approve', r.org_project_id)) } });
  const capRow = (actor, id) => { const r = db.prepare('SELECT c.*, p.code AS pcode FROM plan_resource_capacity c JOIN org_projects p ON p.id = c.org_project_id WHERE c.id = ? AND c.company_id = ? AND c.deleted_at IS NULL').get(Number(id), actor.companyId); if (!r || !at(actor, 'plan.resource.view', r.org_project_id)) throw notFound('That availability row does not exist.'); return r; };
  const capacity = {
    list(actor, { projectId }) {
      if (!authz.check(actor, 'plan.resource.view').allowed) throw forbidden('You may not see resource availability (permission plan.resource.view).');
      const f = authz.scopeFilter(actor, 'plan.resource.view', { project: 'c.org_project_id' });
      const rows = db.prepare(`SELECT c.*, p.code AS pcode FROM plan_resource_capacity c JOIN org_projects p ON p.id = c.org_project_id WHERE c.company_id = :c AND c.deleted_at IS NULL ${projectId ? 'AND c.org_project_id = :p' : ''} AND ${f.sql} ORDER BY c.status = 'CANCELLED', c.resource_type, c.label, c.from_date LIMIT 500`).all({ c: actor.companyId, ...(projectId ? { p: projectId } : {}) });
      return { rows: rows.map((r) => capView(actor, r)), canManage: projectId ? at(actor, 'plan.capacity.manage', projectId) : authz.check(actor, 'plan.capacity.manage').allowed };
    },
    create(actor, b) {
      const p = db.prepare('SELECT id FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.projectId, actor.companyId); if (!p || !at(actor, 'plan.resource.view', b.projectId)) throw notFound('That project does not exist.');
      if (!at(actor, 'plan.capacity.manage', b.projectId)) throw forbidden('You may not set resource availability (permission plan.capacity.manage).');
      const [r] = checkRows(actor, [{ type: b.type, itemId: b.itemId, trade: b.trade, uom: b.uom, basis: 'PER_DAY', qty: b.qtyPerDay, sourceType: 'MANUAL' }], 'row');
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO plan_resource_capacity (company_id, org_project_id, resource_type, item_id, trade, res_key, label, uom, qty_per_day, from_date, to_date, status, reason, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')")
          .run(actor.companyId, b.projectId, b.type, r.itemId, r.trade, r.key, r.label.slice(0, 200), r.uom, Math.round(b.qtyPerDay * 1000), b.from, b.to, b.reason, actor.user, b.projectId, actor.user).lastInsertRowid);
        audit(actor, 'plan_resource_capacity', id, 'create', actor.companyId, { newValues: { type: b.type, key: r.key, qtyPerDay: b.qtyPerDay, from: b.from, to: b.to }, reason: b.reason });
        return capView(actor, capRow(actor, id));
      });
    },
    activate(actor, id) {
      const r = capRow(actor, id); if (!at(actor, 'plan.capacity.approve', r.org_project_id)) throw forbidden('You may not put availability in force (permission plan.capacity.approve).');
      if (r.status !== 'DRAFT') throw conflict('Only a draft is put in force.'); if (String(r.requested_by).toLowerCase() === String(actor.user).toLowerCase()) throw forbidden('The person who drafted the availability does not put it in force (maker-checker).');
      return transaction(db, () => { db.prepare("UPDATE plan_resource_capacity SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), actor.user, nowIso(), r.id); audit(actor, 'plan_resource_capacity', r.id, 'activate', r.company_id, { oldValues: { status: 'DRAFT' }, newValues: { status: 'ACTIVE' } }); return capView(actor, capRow(actor, r.id)); });
    },
    cancel(actor, id, { reason }) {
      const r = capRow(actor, id); if (!(at(actor, 'plan.capacity.manage', r.org_project_id) || at(actor, 'plan.capacity.approve', r.org_project_id))) throw forbidden('You may not change resource availability (permission plan.capacity.manage).');
      if (r.status === 'CANCELLED') throw conflict('It is cancelled already.');
      return transaction(db, () => { db.prepare("UPDATE plan_resource_capacity SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), r.id); audit(actor, 'plan_resource_capacity', r.id, 'cancel', r.company_id, { oldValues: { status: r.status }, newValues: { status: 'CANCELLED' }, reason }); return capView(actor, capRow(actor, r.id)); });
    },
  };

  // ---- histograms (FR-03) -------------------------------------------------------------------------------------------------------------------------------------------
  function load(actor, id, q) {
    const { s } = sched(actor, id);
    if (!at(actor, 'plan.resource.view', s.org_project_id)) throw forbidden('You may not see the resources of this schedule (permission plan.resource.view).');
    const from = q.from ?? s.start_date; const to = q.to ?? s.finish_date ?? s.start_date;
    if (to < from) throw badRequest('Correct the highlighted fields', [{ field: 'to', message: 'The end is on or after the start' }]);
    const o0 = ordOf(from); const days = ordOf(to) - o0 + 1; if (days > 1830) throw badRequest('Correct the highlighted fields', [{ field: 'to', message: 'Show at most five years at a time' }]);
    const cal = calendarById(s.calendar_id); const calOf = calendars();
    const work = new Uint8Array(days); for (let i = 0; i < days; i += 1) work[i] = cal.isWork(o0 + i) ? 1 : 0;
    const series = new Map(); const ensure = (type, key, label, uom) => { const k = `${type}|${key}`; if (!series.has(k)) series.set(k, { type, key, label, uom, demand: new Float64Array(days), avail: null, rows: [] }); return series.get(k); };
    const rows = db.prepare(`SELECT r.*, a.code, a.name AS aname, a.es, a.ef, a.ls, a.lf, a.calendar_id, a.act_type FROM plan_activity_resources r JOIN plan_activities a ON a.id = r.activity_id WHERE r.schedule_id = ? AND r.deleted_at IS NULL AND a.deleted_at IS NULL ${q.type ? 'AND r.resource_type = ?' : ''}`).all(s.id, ...(q.type ? [q.type] : []));
    for (const r of rows) {
      const st = (q.dates === 'late' ? r.ls : null) ?? r.es; const fn = (q.dates === 'late' ? r.lf : null) ?? r.ef; const x = ensure(r.resource_type, r.res_key, r.label, r.uom);
      if (!st || !fn) continue; const c = r.calendar_id ? calOf(r.calendar_id) : cal; let n = 0; for (let o = ordOf(st); o <= ordOf(fn); o += 1) if (c.isWork(o)) n += 1;
      const perDay = r.basis === 'TOTAL' ? r.qty_total / 1000 / Math.max(1, n) : r.qty_per_day / 1000;
      for (let o = Math.max(ordOf(st), o0); o <= Math.min(ordOf(fn), o0 + days - 1); o += 1) if (c.isWork(o)) x.demand[o - o0] += perDay;
      x.rows.push({ activityId: r.activity_id, code: r.code, name: r.aname, st, fn, perDay, cal: c });
    }
    // availability: approved deployments by crew trade (one person counts once a day) and capacity rows in force
    const dep = db.prepare("SELECT d.person_type, d.person_id, d.from_date, d.to_date, LOWER(TRIM(c.trade)) AS trade FROM hr_deployments d JOIN hr_crews c ON c.id = d.crew_id WHERE d.company_id = ? AND d.dep_project_id = ? AND d.status IN ('APPROVED', 'CLOSED') AND d.is_primary = 1 AND d.deleted_at IS NULL AND c.trade IS NOT NULL AND TRIM(c.trade) <> '' AND d.from_date <= ? AND COALESCE(d.to_date, '9999-12-31') >= ?").all(s.company_id, s.org_project_id, to, from);
    for (const d of dep) {
      if (q.type && q.type !== 'LABOUR') break; const x = ensure('LABOUR', `trade:${d.trade}`, d.trade.replace(/\b\w/g, (m) => m.toUpperCase()), 'man-day'); x.avail ??= new Float64Array(days);
      for (let o = Math.max(ordOf(d.from_date), o0); o <= Math.min(ordOf(d.to_date ?? '9999-12-31'), o0 + days - 1); o += 1) if (work[o - o0]) x.avail[o - o0] += 1;
    }
    for (const c of db.prepare(`SELECT * FROM plan_resource_capacity WHERE company_id = ? AND org_project_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL AND from_date <= ? AND to_date >= ? ${q.type ? 'AND resource_type = ?' : ''}`).all(s.company_id, s.org_project_id, to, from, ...(q.type ? [q.type] : []))) {
      const x = ensure(c.resource_type, c.res_key, c.label, c.uom); x.avail ??= new Float64Array(days);
      for (let o = Math.max(ordOf(c.from_date), o0); o <= Math.min(ordOf(c.to_date), o0 + days - 1); o += 1) if (work[o - o0]) x.avail[o - o0] += c.qty_per_day / 1000;
    }
    return { s, from, to, o0, days, work, series };
  }
  const bucketOf = (bucket, ord) => { const iso = isoOf(ord); if (bucket === 'day') return iso; if (bucket === 'month') return iso.slice(0, 7); const wd = (ord + 3) % 7; return isoOf(ord - wd); };
  function histogram(actor, id, q) {
    const { s, from, to, o0, days, series } = load(actor, id, q);
    const keys = []; const index = new Map(); const bounds = [];
    for (let i = 0; i < days; i += 1) { const k = bucketOf(q.bucket, o0 + i); if (!index.has(k)) { index.set(k, keys.length); keys.push(k); bounds.push({ from: isoOf(o0 + i), to: isoOf(o0 + i) }); } bounds[index.get(k)].to = isoOf(o0 + i); }
    const out = [];
    for (const x of series.values()) {
      if (q.key && x.key !== q.key) continue;
      const b = keys.map(() => ({ demand: 0, available: x.avail ? 0 : null, over: false, overDays: 0, peak: 0 })); let total = 0; let peak = 0; let peakDate = null; let overDays = 0;
      for (let i = 0; i < days; i += 1) {
        const k = index.get(bucketOf(q.bucket, o0 + i)); const d = x.demand[i]; b[k].demand += d; total += d; if (d > peak + 1e-9) { peak = d; peakDate = isoOf(o0 + i); } if (d > b[k].peak) b[k].peak = d;
        if (x.avail) { b[k].available += x.avail[i]; if (d > x.avail[i] + 1e-9) { b[k].over = true; b[k].overDays += 1; overDays += 1; } }
      }
      out.push({ type: x.type, typeLabel: RES_TYPES[x.type], key: x.key, label: x.label, uom: x.uom, tracked: Boolean(x.avail), total: round3(total), peak: round3(peak), peakDate, overDays, activities: new Set(x.rows.map((r) => r.activityId)).size,
        buckets: b.map((y) => ({ demand: round3(y.demand), available: y.available == null ? null : round3(y.available), peak: round3(y.peak), over: y.over, overDays: y.overDays })) });
    }
    out.sort((a, b) => a.type.localeCompare(b.type) || b.overDays - a.overDays || a.label.localeCompare(b.label));
    const totals = Object.keys(RES_TYPES).map((t) => ({ type: t, label: RES_TYPES[t], resources: out.filter((r) => r.type === t).length, over: out.filter((r) => r.type === t && r.overDays > 0).length }));
    return { scheduleId: s.id, docNo: s.doc_no, projectId: s.org_project_id, needsCalc: Boolean(s.needs_calc) || !s.finish_date, from, to, bucket: q.bucket, dates: q.dates, buckets: keys.map((k, i) => ({ key: k, from: bounds[i].from, to: bounds[i].to })), resources: out, totals };
  }
  /** Drill-down: the activities behind a bar. */
  function drill(actor, id, q) {
    const { s, series } = load(actor, id, { ...q, from: q.from, to: q.to, type: q.type });
    const x = series.get(`${q.type}|${q.key}`); if (!x) return { scheduleId: s.id, rows: [] };
    const f = ordOf(q.from); const t = ordOf(q.to);
    const rows = x.rows.map((r) => { let n = 0; for (let o = Math.max(ordOf(r.st), f); o <= Math.min(ordOf(r.fn), t); o += 1) if (r.cal.isWork(o)) n += 1; return { activityId: r.activityId, code: r.code, name: r.name, start: r.st, finish: r.fn, perDay: round3(r.perDay), qty: round3(r.perDay * n), days: n }; }).filter((r) => r.days > 0).sort((a, b) => b.qty - a.qty);
    return { scheduleId: s.id, type: q.type, key: q.key, label: x.label, uom: x.uom, from: q.from, to: q.to, rows, total: round3(rows.reduce((a, r) => a + r.qty, 0)) };
  }
  /** The resource loading by month, for budget phasing (12.01) and resource planning (17.08). */
  function loading(actor, id) {
    const h = histogram(actor, id, { bucket: 'month', dates: 'early', type: null, from: null, to: null, key: null });
    return { scheduleId: h.scheduleId, docNo: h.docNo, projectId: h.projectId, from: h.from, to: h.to, months: h.buckets.map((b) => b.key), resources: h.resources.map((r) => ({ type: r.type, key: r.key, label: r.label, uom: r.uom, total: r.total, months: r.buckets.map((b) => b.demand) })) };
  }
  /** The histogram as a file: CSV or XLSX with one column per period, or a PDF with one line per resource and period (legible whatever the number of periods). */
  function histogramExport(actor, id, q) {
    const { format, ...hq } = q; const h = histogram(actor, id, hq); const { s } = sched(actor, id);
    if (!at(actor, 'plan.schedule.export', s.org_project_id)) throw forbidden('You may not export the schedule (permission plan.schedule.export).');
    const base = `resource-histogram-${s.doc_no.replace(/[^A-Za-z0-9_-]+/g, '-')}`; const note = [`Schedule ${s.doc_no}; ${h.from} to ${h.to}; by ${hq.bucket}; ${hq.dates} dates.`];
    audit(actor, 'plan_schedules', s.id, 'export', s.company_id, { newValues: { report: 'resource histogram', format, bucket: hq.bucket, type: hq.type } });
    if (format === 'pdf') {
      const rows = []; for (const r of h.resources) for (const b of r.buckets) if (b.demand > 0 || (r.tracked && b.available > 0)) rows.push({ type: r.typeLabel, resource: r.label, uom: r.uom, period: b.key, demand: b.demand, available: r.tracked ? b.available : '', over: r.tracked && b.demand > b.available ? round3(b.demand - b.available) : '' });
      return { name: `${base}.pdf`, type: 'application/pdf', body: toPdf({ title: `Resource histogram ${s.doc_no}`, columns: [{ key: 'type', label: 'Type', type: 'text' }, { key: 'resource', label: 'Resource', type: 'text' }, { key: 'uom', label: 'Unit', type: 'text' }, { key: 'period', label: 'Period', type: 'text' }, { key: 'demand', label: 'Demand', type: 'number' }, { key: 'available', label: 'Available', type: 'number' }, { key: 'over', label: 'Over', type: 'number' }], rows, footer: note }) };
    }
    const wide = []; for (const r of h.resources) { wide.push({ type: r.typeLabel, resource: r.label, uom: r.uom, measure: 'Demand', b: r.buckets.map((b) => b.demand), total: r.total }); if (r.tracked) wide.push({ type: r.typeLabel, resource: r.label, uom: r.uom, measure: 'Available', b: r.buckets.map((b) => b.available), total: round3(r.buckets.reduce((a, b) => a + (b.available ?? 0), 0)) }); }
    if (format === 'xlsx') {
      const columns = [{ key: 'type', label: 'Type', type: 'text' }, { key: 'resource', label: 'Resource', type: 'text' }, { key: 'uom', label: 'Unit', type: 'text' }, { key: 'measure', label: 'Measure', type: 'text' }, ...h.buckets.map((b, i) => ({ key: `b${i}`, label: b.key, type: 'number' })), { key: 'total', label: 'Total', type: 'number' }];
      return { name: `${base}.xlsx`, type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: toXlsx({ sheetName: 'Histogram', columns, rows: wide.map((w) => ({ type: w.type, resource: w.resource, uom: w.uom, measure: w.measure, total: w.total, ...Object.fromEntries(w.b.map((v, i) => [`b${i}`, v])) })), footer: note }) };
    }
    const cell = (v) => { const t = String(v ?? ''); return /^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t) ? `'${t}` : t; };
    const lines = [['Type', 'Resource', 'Unit', 'Measure', ...h.buckets.map((b) => b.key), 'Total'], ...wide.map((w) => [w.type, w.resource, w.uom, w.measure, ...w.b, w.total])];
    return { name: `${base}.csv`, type: 'text/csv; charset=utf-8', body: `\uFEFF${lines.map((l) => l.map((v) => `"${cell(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')}` };
  }

  return { data, edit, undo, edits: (actor, id) => { const { s } = sched(actor, id); return { rows: lastEdits(s, 50) }; }, resourcesOf, saveResources, norms, resourceOptions, capacity, histogram, drill, loading, histogramExport, syncResources };
}
