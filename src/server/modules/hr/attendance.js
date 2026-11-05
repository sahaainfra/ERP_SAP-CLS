import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { objectTypes } from '../../platform/objects/index.js';
import { evidenceProviders, workflowOf, workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { holidaysOn } from '../core/holidays/service.js';
import { addDays, evaluateDay, hhmm, isWeeklyOff, patternShift, payImpacting, periodFor, shiftSpan, withDefaults } from './att-calc.js';
import { DEP_STATUS } from './deployments.js';

// Shifts, work calendars and attendance policies (part 07.04). A shift (FR-01) has its times (a night shift ends after midnight), break, grace, the hours for a half and a full day, when overtime starts and how times are rounded;
// a shift in use keeps its times, a new shift is made instead (BR-02). An attendance policy (FR-04) is a set of rules (late marks, early going, missing punch, comp-off, overtime) with an effective date; a change is a new version,
// approved by the HR manager and, when it touches pay, the director, and it governs only the dates from its effective date (BR-02). Policies, shifts, weekly offs and holiday calendars are assigned to the company, a site, a crew or
// an employee from a date (FR-05) and resolved most specific first (BR-01). Rosters (FR-02) rotate shifts per site or crew; a change of one day or a swap of two people is approved by the supervisor and the project manager.
// The attendance period (FR-06) is cut from a start day and closed for good: nothing before the close is changed.
export const POLICY_DOC = 'HR_ATT_POLICY';
export const ROSTER_DOC = 'HR_ROSTER_CHANGE';
const STATUS = DEP_STATUS;
const nowIso = () => new Date().toISOString();
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const LEVELS = ['EMPLOYEE', 'CREW', 'SITE', 'COMPANY'];

export const shiftList = defineList({
  code: 'att.shifts', label: 'Shifts', permission: 'att.shift.view', from: 'att_shifts s', where: 's.deleted_at IS NULL', searchable: ['s.code', 's.name'], defaultSort: 'code',
  columns: {
    code: { sql: 's.code', type: 'text', label: 'Code' }, name: { sql: 's.name', type: 'text', label: 'Shift' },
    startMinute: { sql: 's.start_minute', type: 'number', label: 'Starts (minute)' }, endMinute: { sql: 's.end_minute', type: 'number', label: 'Ends (minute)' },
    night: { sql: 's.night_shift', type: 'enum', label: 'Night shift', options: [['1', 'Night'], ['0', 'Day']] }, graceMinutes: { sql: 's.grace_minutes', type: 'number', label: 'Grace (minutes)' },
    fullDayMinutes: { sql: 's.full_day_minutes', type: 'number', label: 'Full day (minutes)' }, status: { sql: 's.status', type: 'enum', label: 'Status', options: [['ACTIVE', 'Active'], ['INACTIVE', 'Inactive']] },
  },
});
export const policyList = defineList({
  code: 'att.policies', label: 'Attendance policies', permission: 'att.policy.view', from: 'att_policies p', where: 'p.deleted_at IS NULL', searchable: ['p.code', 'p.name'], defaultSort: 'code',
  columns: {
    code: { sql: 'p.code', type: 'text', label: 'Code' }, name: { sql: 'p.name', type: 'text', label: 'Policy' }, version: { sql: 'p.version_no', type: 'number', label: 'Version' }, effectiveFrom: { sql: 'p.effective_from', type: 'date', label: 'Effective from' },
    band: { sql: 'p.band', type: 'enum', label: 'Pay impact', options: [['STANDARD', 'No effect on pay'], ['PAY_IMPACTING', 'Touches pay']] }, status: { sql: 'p.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) },
    updatedAt: { sql: 'COALESCE(p.updated_at, p.created_at)', type: 'datetime', label: 'Changed' },
  },
});

export function createAttendanceService({ db, validRules }) {
  const authz = authzOf(db);
  const notif = notificationsOf(db);
  const may = (actor, key, scope) => (scope ? authz.check(actor, key, { companyId: actor.companyId, ...scope }) : authz.check(actor, key)).allowed;
  const need = (actor, key, what, scope) => { if (!may(actor, key, scope)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const maker = (actor, r) => same(r.created_by, actor.user);
  const event = (type, actor, entity, id, companyId, data, siteId = null) => publishEvent(db, { type, entity, entityId: id, actorId: actor.user, companyId, siteId: siteId ?? undefined, data });
  const tell = (companyId, to, what, ref, title, decision, comment, link) => to && notif.notify({ companyId, templateCode: 'att.config.decided', recipients: [`user:${to}`], data: { what, ref, title, decision, comment: comment ? `: ${comment}` : '' }, link, sourceType: 'att_config', sourceId: ref, eventKey: `att.config.decided:${ref}:${decision}:${Date.now()}` });
  const nextDoc = (actor, docType, table, prefix) => {
    try { return issueNumber(db, { companyId: actor.companyId, docType, actor: actor.user, refType: table }).number; } catch (e) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(e?.code)) throw e; }
    const n = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE company_id = ?`).get(actor.companyId).n + 1;
    let no = `${prefix}-${String(n).padStart(5, '0')}`;
    for (let k = n + 1; db.prepare(`SELECT 1 FROM ${table} WHERE company_id = ? AND doc_no = ?`).get(actor.companyId, no); k += 1) no = `${prefix}-${String(k).padStart(5, '0')}`;
    return no;
  };
  const myUserId = (actor) => actor.userId ?? db.prepare('SELECT id FROM iam_users WHERE company_id = ? AND lower(username) = lower(?) AND is_active = 1').get(actor.companyId, actor.user)?.id ?? null;
  const myEmployee = (actor) => { const uid = myUserId(actor); return uid ? db.prepare("SELECT id FROM hr_employees WHERE company_id = ? AND user_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED'").get(actor.companyId, uid)?.id ?? null : null; };
  const siteRow = (companyId, id) => db.prepare('SELECT s.id, s.org_project_id AS project_id, s.name, (SELECT b.state_code FROM org_projects p JOIN org_branches b ON b.id = p.branch_id WHERE p.id = s.org_project_id) AS state_code FROM org_sites s WHERE s.id = ? AND s.company_id = ?').get(id, companyId);

  // ---- attendance periods (FR-06) ----
  const lastClosedEnd = (companyId) => db.prepare("SELECT MAX(period_end) AS e FROM att_periods WHERE company_id = ? AND status = 'CLOSED' AND deleted_at IS NULL").get(companyId).e ?? null;
  const startDayOn = (companyId, date) => db.prepare('SELECT start_day FROM att_period_defs WHERE company_id = ? AND deleted_at IS NULL AND effective_from <= ? ORDER BY effective_from DESC, id DESC LIMIT 1').get(companyId, date)?.start_day ?? 1;
  const ensurePeriod = (companyId, date, by = 'system') => {
    const p = periodFor(startDayOn(companyId, date), date);
    let row = db.prepare('SELECT * FROM att_periods WHERE company_id = ? AND period_start = ? AND deleted_at IS NULL').get(companyId, p.start);
    if (!row) {
      // a period cut under a new start day may overlap the one before; the earlier one is kept as it is and the new one starts after it
      const clash = db.prepare('SELECT 1 FROM att_periods WHERE company_id = ? AND deleted_at IS NULL AND period_start <= ? AND period_end >= ?').get(companyId, p.end, p.start);
      if (!clash) db.prepare("INSERT INTO att_periods (company_id, period_start, period_end, label, created_by, source_type) VALUES (?, ?, ?, ?, ?, 'att_period_defs')").run(companyId, p.start, p.end, p.label, by);
      row = db.prepare('SELECT * FROM att_periods WHERE company_id = ? AND deleted_at IS NULL AND period_start <= ? AND period_end >= ?').get(companyId, date, date);
    }
    return row;
  };
  const periodView = (r) => ({ id: r.id, start: r.period_start, end: r.period_end, label: r.label, status: r.status, closedBy: r.closed_by, closedAt: r.closed_at, version: r.version });
  const closedGuard = (companyId, date, what) => { const e = lastClosedEnd(companyId); if (e && date <= e) throw unprocessable(`${what}: the attendance period up to ${e} is closed and is never recalculated.`); };
  const periods = {
    def(actor) { need(actor, 'att.period.view', 'see the attendance period'); const d = db.prepare('SELECT * FROM att_period_defs WHERE company_id = ? AND deleted_at IS NULL ORDER BY effective_from DESC, id DESC').all(actor.companyId); return { current: startDayOn(actor.companyId, todayIST()), history: d.map((x) => ({ id: x.id, startDay: x.start_day, effectiveFrom: x.effective_from, by: x.created_by })), lastClosedEnd: lastClosedEnd(actor.companyId) }; },
    setDef(actor, { startDay, effectiveFrom }) {
      need(actor, 'att.period.manage', 'set the attendance period');
      closedGuard(actor.companyId, effectiveFrom, 'The new start day cannot take effect inside a closed period');
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO att_period_defs (company_id, start_day, effective_from, created_by, source_type) VALUES (?, ?, ?, ?, 'att_period_defs')").run(actor.companyId, startDay, effectiveFrom, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'att_period_defs', entityId: id, action: 'set', newValues: { startDay, effectiveFrom }, actor: actor.user, companyId: actor.companyId });
        return periods.def(actor);
      });
    },
    list(actor, { from = addDays(todayIST(), -120), to = addDays(todayIST(), 35) } = /** @type {any} */ ({})) {
      need(actor, 'att.period.view', 'see attendance periods');
      transaction(db, () => { for (let d = from; d <= to; d = addDays(d, 20)) ensurePeriod(actor.companyId, d, actor.user); ensurePeriod(actor.companyId, to, actor.user); });
      return db.prepare('SELECT * FROM att_periods WHERE company_id = ? AND deleted_at IS NULL AND period_end >= ? AND period_start <= ? ORDER BY period_start DESC').all(actor.companyId, from, to).map(periodView);
    },
    of(companyId, date) { return periodView(ensurePeriod(companyId, date)); },
    close(actor, id) {
      need(actor, 'att.period.manage', 'close attendance periods');
      const p = db.prepare('SELECT * FROM att_periods WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
      if (!p) throw notFound('That period does not exist.');
      if (p.status === 'CLOSED') throw conflict('That period is already closed.');
      if (p.period_end >= todayIST()) throw unprocessable('A period is closed after its last day.');
      const earlier = db.prepare("SELECT period_start FROM att_periods WHERE company_id = ? AND status = 'OPEN' AND deleted_at IS NULL AND period_end < ? LIMIT 1").get(actor.companyId, p.period_start);
      if (earlier) throw unprocessable(`The period starting ${earlier.period_start} is still open: close periods in order.`);
      return transaction(db, () => {
        db.prepare("UPDATE att_periods SET status = 'CLOSED', closed_by = ?, closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), actor.user, nowIso(), id);
        writeAudit(db, { entity: 'att_periods', entityId: id, action: 'close', actor: actor.user, companyId: actor.companyId });
        event('att.period.closed', actor, 'att_period', id, actor.companyId, { start: p.period_start, end: p.period_end, label: p.label });
        return periodView(db.prepare('SELECT * FROM att_periods WHERE id = ?').get(id));
      });
    },
  };

  // ---- shifts (FR-01) ----
  const shiftOf = (r) => r && ({ id: r.id, code: r.code, name: r.name, startMinute: r.start_minute, endMinute: r.end_minute, breakMinutes: r.break_minutes, graceMinutes: r.grace_minutes, halfDayMinutes: r.half_day_minutes, fullDayMinutes: r.full_day_minutes, otAfterMinutes: r.ot_after_minutes, roundingMinutes: r.rounding_minutes, roundingMode: r.rounding_mode, nightShift: r.night_shift === 1, status: r.status });
  const shiftInUse = (id) => !!(db.prepare('SELECT 1 FROM att_policy_assignments WHERE shift_id = ? AND deleted_at IS NULL').get(id) || db.prepare('SELECT 1 FROM att_roster_changes WHERE (shift_id = ? OR swap_shift_id = ?) AND deleted_at IS NULL').get(id, id)
    || db.prepare('SELECT pattern_json FROM att_rosters WHERE deleted_at IS NULL').all().some((r) => (json(r.pattern_json, {}).cycle ?? []).includes(id)));
  function shiftView(actor, r) {
    const sp = shiftSpan(shiftOf(r));
    return { ...shiftOf(r), startTime: hhmm(r.start_minute), endTime: hhmm(r.end_minute), crossesMidnight: sp.crosses, lengthMinutes: sp.length, paidMinutes: sp.paid, halfDayHours: r.half_day_minutes / 60, fullDayHours: r.full_day_minutes / 60, otAfterHours: r.ot_after_minutes == null ? null : r.ot_after_minutes / 60, inUse: shiftInUse(r.id), rowVersion: r.version, can: { edit: may(actor, 'att.shift.edit') } };
  }
  const shiftRow = (actor, id) => { const r = db.prepare('SELECT * FROM att_shifts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!r) throw notFound('That shift does not exist.'); return r; };
  const SHIFT_TIMES = ['start_minute', 'end_minute', 'break_minutes', 'grace_minutes', 'half_day_minutes', 'full_day_minutes', 'ot_after_minutes', 'rounding_minutes', 'rounding_mode', 'night_shift'];
  const shiftCols = (b) => { const crosses = b.endMinute <= b.startMinute; return { start_minute: b.startMinute, end_minute: b.endMinute, break_minutes: b.breakMinutes, grace_minutes: b.graceMinutes, half_day_minutes: b.halfDayMinutes, full_day_minutes: b.fullDayMinutes, ot_after_minutes: b.otAfterMinutes ?? null, rounding_minutes: b.roundingMinutes, rounding_mode: b.roundingMode, night_shift: crosses || b.nightShift ? 1 : 0 }; };
  function checkShift(b, problems) {
    const sp = shiftSpan(b);
    if (sp.length < 60) problems.push({ field: 'endTime', message: 'A shift is at least an hour long' });
    if (b.fullDayMinutes > sp.paid) problems.push({ field: 'fullDayHours', message: 'A full day is longer than the paid time of the shift' });
    if (b.otAfterMinutes != null && b.otAfterMinutes < b.fullDayMinutes) problems.push({ field: 'otAfterHours', message: 'Overtime starts at or after a full day' });
  }
  const shifts = {
    list(actor, query) { need(actor, 'att.shift.view', 'see shifts'); return runList(db, shiftList, parseListRequest(shiftList, query), { select: 's.*', scopeSql: 's.company_id = :c', params: { c: actor.companyId }, tieBreaker: 's.id', map: (r) => ({ id: r.id, code: r.code, name: r.name, startTime: hhmm(r.start_minute), endTime: hhmm(r.end_minute), night: r.night_shift === 1, graceMinutes: r.grace_minutes, fullDayHours: r.full_day_minutes / 60, otAfterHours: r.ot_after_minutes == null ? null : r.ot_after_minutes / 60, status: r.status }) }); },
    exportSource(actor, req) { need(actor, 'att.shift.view', 'export shifts'); const o = { select: 's.*', scopeSql: 's.company_id = :c', params: { c: actor.companyId }, tieBreaker: 's.id' }; return { title: shiftList.label, permission: 'att.shift.view', personal: false, columns: Object.entries(shiftList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, shiftList, req, o), rows: () => runList(db, shiftList, req, { ...o, limit: null }).data, describe: () => '' }; },
    all(actor) { need(actor, 'att.shift.view', 'see shifts'); return db.prepare("SELECT * FROM att_shifts WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).map((r) => shiftView(actor, r)); },
    get(actor, id) { need(actor, 'att.shift.view', 'see shifts'); return shiftView(actor, shiftRow(actor, id)); },
    create(actor, b) {
      need(actor, 'att.shift.edit', 'keep shifts');
      const problems = []; checkShift(b, problems);
      if (db.prepare('SELECT 1 FROM att_shifts WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, b.code)) problems.push({ field: 'code', message: `The shift code ${b.code} is already used` });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const c = shiftCols(b);
      const id = Number(db.prepare(`INSERT INTO att_shifts (company_id, code, name, ${Object.keys(c).join(', ')}, created_by, source_type) VALUES (?, ?, ?, ${Object.keys(c).map(() => '?').join(', ')}, ?, 'att_shift')`).run(actor.companyId, b.code, b.name, ...Object.values(c), actor.user).lastInsertRowid);
      writeAudit(db, { entity: 'att_shifts', entityId: id, action: 'create', newValues: { code: b.code, start: b.startMinute, end: b.endMinute }, actor: actor.user, companyId: actor.companyId });
      return shifts.get(actor, id);
    },
    update(actor, id, b) {
      need(actor, 'att.shift.edit', 'keep shifts');
      const r = shiftRow(actor, id);
      if (r.version !== b.version) throw conflict('This shift was changed by someone else. Reload it and try again.');
      const problems = []; checkShift(b, problems);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      const c = shiftCols(b);
      if (shiftInUse(id) && SHIFT_TIMES.some((k) => String(c[k] ?? null) !== String(r[k] ?? null))) throw new HttpError(409, 'IN_USE', 'This shift is in use: its times and rules stay as they are for the dates already worked. Make a new shift, or only change its name and status.');
      if (r.code.toLowerCase() !== b.code.toLowerCase()) throw unprocessable('The code of a shift is not changed.');
      db.prepare(`UPDATE att_shifts SET name = ?, status = ?, ${Object.keys(c).map((k) => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(b.name, b.status, ...Object.values(c), actor.user, nowIso(), id);
      writeAudit(db, { entity: 'att_shifts', entityId: id, action: 'update', newValues: { name: b.name, status: b.status }, actor: actor.user, companyId: actor.companyId });
      return shifts.get(actor, id);
    },
  };

  // ---- policies (FR-04) ----
  const policyRow = (actor, id) => { const r = db.prepare('SELECT * FROM att_policies WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); if (!r) throw notFound('That policy does not exist.'); return r; };
  function policyView(actor, r) {
    const versions = db.prepare('SELECT id, version_no, effective_from, status FROM att_policies WHERE company_id = ? AND code = ? AND deleted_at IS NULL ORDER BY version_no DESC').all(r.company_id, r.code);
    return {
      id: r.id, code: r.code, name: r.name, version: r.version_no, effectiveFrom: r.effective_from, rules: withDefaults(json(r.rules_json, {})), band: r.band, status: r.status, statusLabel: STATUS[r.status], changeNote: r.change_note, workflowInstanceId: r.workflow_instance_id,
      requestedBy: r.requested_by, createdBy: r.created_by, rowVersion: r.version, versions: versions.map((v) => ({ id: v.id, version: v.version_no, effectiveFrom: v.effective_from, status: v.status })),
      can: { edit: ['DRAFT', 'RETURNED'].includes(r.status) && maker(actor, r) && may(actor, 'att.policy.edit'), submit: ['DRAFT', 'RETURNED'].includes(r.status) && maker(actor, r) && may(actor, 'att.policy.submit'), delete: r.status === 'DRAFT' && maker(actor, r) && may(actor, 'att.policy.delete'),
        withdraw: r.status === 'SUBMITTED' && maker(actor, r), cancel: ['SUBMITTED', 'RETURNED'].includes(r.status) && may(actor, 'att.policy.cancel'), amend: r.status === 'APPROVED' && may(actor, 'att.policy.amend') && !versions.some((v) => ['DRAFT', 'SUBMITTED', 'RETURNED'].includes(v.status)), print: may(actor, 'att.policy.print') },
    };
  }
  const checkPolicy = (actor, b, problems, exceptId = null) => {
    try { validRules(b.rules); } catch (e) { for (const d of e.details ?? []) problems.push({ field: `rules.${d.field}`, message: d.message }); if (!e.details?.length) problems.push({ field: 'rules', message: 'The rules are not valid' }); }
    const e = lastClosedEnd(actor.companyId);
    if (e && b.effectiveFrom <= e) problems.push({ field: 'effectiveFrom', message: `The attendance period up to ${e} is closed; a policy takes effect after it` });
    void exceptId;
  };
  const policies = {
    list(actor, query) { need(actor, 'att.policy.view', 'see attendance policies'); return runList(db, policyList, parseListRequest(policyList, query), { select: 'p.*', scopeSql: 'p.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'p.id', map: (r) => ({ id: r.id, code: r.code, name: r.name, version: r.version_no, effectiveFrom: r.effective_from, band: r.band, status: r.status, statusLabel: STATUS[r.status] }) }); },
    exportSource(actor, req) { need(actor, 'att.policy.export', 'export attendance policies'); const o = { select: 'p.*', scopeSql: 'p.company_id = :c', params: { c: actor.companyId }, tieBreaker: 'p.id' }; return { title: policyList.label, permission: 'att.policy.export', personal: false, columns: Object.entries(policyList.columns).map(([key, c]) => ({ key, label: c.label, type: c.type === 'enum' ? 'text' : c.type })), count: () => countList(db, policyList, req, o), rows: () => runList(db, policyList, req, { ...o, limit: null }).data, describe: () => '' }; },
    codes(actor) { need(actor, 'att.policy.view', 'see attendance policies'); return db.prepare("SELECT code, MAX(name) AS name FROM att_policies WHERE company_id = ? AND deleted_at IS NULL AND status = 'APPROVED' GROUP BY code ORDER BY code").all(actor.companyId); },
    create(actor, b) {
      need(actor, 'att.policy.create', 'make attendance policies');
      const problems = []; checkPolicy(actor, b, problems);
      if (db.prepare('SELECT 1 FROM att_policies WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, b.code)) problems.push({ field: 'code', message: `The policy code ${b.code} is already used: make a new version of it instead` });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const id = Number(db.prepare("INSERT INTO att_policies (company_id, code, name, version_no, effective_from, rules_json, band, status, requested_by, change_note, created_by, source_type) VALUES (?, ?, ?, 1, ?, ?, ?, 'DRAFT', ?, ?, ?, 'att_policy')")
          .run(actor.companyId, b.code, b.name, b.effectiveFrom, JSON.stringify(withDefaults(b.rules)), payImpacting(b.rules) ? 'PAY_IMPACTING' : 'STANDARD', actor.user, b.changeNote ?? null, actor.user).lastInsertRowid);
        db.prepare('UPDATE att_policies SET root_id = id WHERE id = ?').run(id);
        writeAudit(db, { entity: 'att_policies', entityId: id, action: 'create', newValues: { code: b.code, effectiveFrom: b.effectiveFrom }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? policies.submit(actor, id, { comment: b.changeNote }) : policyView(actor, policyRow(actor, id));
      });
    },
    get(actor, id) { need(actor, 'att.policy.view', 'see attendance policies'); const r = policyRow(actor, id); return { ...policyView(actor, r), history: policyHistory(actor, r) }; },
    update(actor, id, b) {
      need(actor, 'att.policy.edit', 'change attendance policies');
      const r = policyRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`A policy version that is ${STATUS[r.status].toLowerCase()} is changed by a new version.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who made this version, changes it.`);
      if (r.version !== b.version) throw conflict('This policy was changed by someone else. Reload it and try again.');
      const problems = []; checkPolicy(actor, b, problems, id);
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      db.prepare('UPDATE att_policies SET name = ?, effective_from = ?, rules_json = ?, band = ?, change_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name, b.effectiveFrom, JSON.stringify(withDefaults(b.rules)), payImpacting(b.rules) ? 'PAY_IMPACTING' : 'STANDARD', b.changeNote ?? null, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'att_policies', entityId: id, action: 'update', newValues: { effectiveFrom: b.effectiveFrom }, actor: actor.user, companyId: actor.companyId });
      return policyView(actor, policyRow(actor, id));
    },
    remove(actor, id) {
      need(actor, 'att.policy.delete', 'delete attendance policies');
      const r = policyRow(actor, id);
      if (r.status !== 'DRAFT') throw new HttpError(409, 'LOCKED', 'Only a draft is deleted.');
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by} deletes this draft.`);
      db.prepare('UPDATE att_policies SET deleted_at = ?, deleted_by = ?, is_active = 0, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, id);
      writeAudit(db, { entity: 'att_policies', entityId: id, action: 'delete', actor: actor.user, companyId: actor.companyId });
      return { id, deleted: true };
    },
    submit(actor, id, { comment } = /** @type {any} */ ({})) {
      need(actor, 'att.policy.submit', 'submit attendance policies');
      const r = policyRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict(`This policy version is ${STATUS[r.status].toLowerCase()}.`);
      if (!maker(actor, r)) throw forbidden(`Only ${r.created_by}, who made this version, submits it.`);
      return transaction(db, () => {
        const problems = []; checkPolicy(actor, { rules: json(r.rules_json, {}), effectiveFrom: r.effective_from }, problems);
        if (problems.length) throw unprocessable(problems[0].message);
        const band = payImpacting(json(r.rules_json, {})) ? 'PAY_IMPACTING' : 'STANDARD';
        const ctx = { band };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: comment ?? 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: POLICY_DOC, docId: id, comment: comment ?? 'Attendance policy', context: ctx }); db.prepare('UPDATE att_policies SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE att_policies SET status = 'SUBMITTED', band = ?, requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(band, actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'att_policies', entityId: id, action: 'submit', newValues: { band }, reason: comment ?? null, actor: actor.user, companyId: actor.companyId });
        return policyView(actor, policyRow(actor, id));
      });
    },
    withdraw(actor, id, { reason }) { const r = policyRow(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a policy version in approval is withdrawn.'); if (!maker(actor, r)) throw forbidden('Only the person who submitted it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return policyView(actor, policyRow(actor, id)); },
    cancel(actor, id, { reason }) {
      need(actor, 'att.policy.cancel', 'cancel attendance policies');
      const r = policyRow(actor, id);
      if (!['SUBMITTED', 'RETURNED'].includes(r.status)) throw unprocessable('Only a version in approval or returned is cancelled; delete a draft.');
      if (maker(actor, r)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.policy({ docId: r.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, r.workflow_instance_id, { reason });
      return policyView(actor, policyRow(actor, id));
    },
    /** BR-02: a change is a new version with its own effective date; the approved version stays in force until then. */
    amend(actor, id, { effectiveFrom, reason }) {
      need(actor, 'att.policy.amend', 'change attendance policies');
      const r = policyRow(actor, id);
      if (r.status !== 'APPROVED') throw unprocessable('Only an approved version is the base of a new version.');
      if (db.prepare("SELECT 1 FROM att_policies WHERE company_id = ? AND code = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.company_id, r.code)) throw new HttpError(409, 'PENDING_CHANGE', `A new version of ${r.code} is already open.`);
      const problems = []; checkPolicy(actor, { rules: json(r.rules_json, {}), effectiveFrom }, problems);
      const latest = db.prepare("SELECT MAX(effective_from) AS e FROM att_policies WHERE company_id = ? AND code = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(r.company_id, r.code).e;
      if (effectiveFrom <= latest) problems.push({ field: 'effectiveFrom', message: `A new version takes effect after the latest approved one (${latest})` });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const v = db.prepare('SELECT MAX(version_no) AS v FROM att_policies WHERE company_id = ? AND code = ?').get(r.company_id, r.code).v + 1;
        const nid = Number(db.prepare("INSERT INTO att_policies (company_id, code, name, version_no, root_id, supersedes_id, effective_from, rules_json, band, status, requested_by, change_note, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'att_policy', ?)")
          .run(r.company_id, r.code, r.name, v, r.root_id ?? r.id, r.id, effectiveFrom, r.rules_json, r.band, actor.user, reason, actor.user, String(r.id)).lastInsertRowid);
        writeAudit(db, { entity: 'att_policies', entityId: nid, action: 'amend', newValues: { from: r.id, version: v, effectiveFrom }, reason, actor: actor.user, companyId: actor.companyId });
        return policyView(actor, policyRow(actor, nid));
      });
    },
    compare(actor, id) {
      need(actor, 'att.policy.view', 'see attendance policies');
      const r = policyRow(actor, id);
      if (!r.supersedes_id) throw unprocessable('This is the first version.');
      const a = withDefaults(json(policyRow(actor, r.supersedes_id).rules_json, {})); const b = withDefaults(json(r.rules_json, {}));
      const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [[`${p}${k}`, Array.isArray(v) ? v.join(', ') || '—' : v]]));
      const fa = new Map(flat(a)); const fb = new Map(flat(b));
      return { rows: [...fb.keys()].map((k) => ({ field: k, before: fa.get(k), after: fb.get(k), changed: String(fa.get(k)) !== String(fb.get(k)) })) };
    },
    print(actor, id) {
      need(actor, 'att.policy.print', 'print attendance policies');
      const v = policyView(actor, policyRow(actor, id));
      writeAudit(db, { entity: 'att_policies', entityId: id, action: 'print', actor: actor.user, companyId: actor.companyId });
      const e = (s) => String(s ?? '—').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      const rows = [['Late marks', `${v.rules.late.enabled ? `${v.rules.late.countPerHalfDay} lates = half a day` : 'off'}`], ['Early going', `${v.rules.earlyGoing.enabled ? `${v.rules.earlyGoing.countPerHalfDay} = half a day, grace ${v.rules.earlyGoing.graceMinutes} min` : 'off'}`], ['Missing punch', v.rules.missingPunch.mode], ['Comp-off', v.rules.compOff.enabled ? `from ${v.rules.compOff.minMinutes} min, valid ${v.rules.compOff.expiryDays} days` : 'off'], ['Overtime', v.rules.ot.enabled ? `${v.rules.ot.multiplier} times, up to ${v.rules.ot.maxPerDayMinutes} min a day and ${v.rules.ot.maxPerWeekMinutes} a week` : 'off']];
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${e(v.code)}</title><style>body{font:12px system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}th{width:30%}</style></head><body><h2>${e(v.name)} (${e(v.code)}) version ${v.version}, from ${e(v.effectiveFrom)}</h2><table>${rows.map(([k, x]) => `<tr><th>${e(k)}</th><td>${e(x)}</td></tr>`).join('')}</table></body></html>`;
    },
  };
  function policyHistory(actor, r) {
    const ids = db.prepare('SELECT id, workflow_instance_id FROM att_policies WHERE company_id = ? AND code = ?').all(r.company_id, r.code);
    const approvals = ids.flatMap((v) => (v.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(v.workflow_instance_id).map((h) => ({ policyId: v.id, ...h })) : []));
    const audit = db.prepare(`SELECT action, actor, reason, created_at AS at, entity_id FROM core_audit_log WHERE entity = 'att_policies' AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids.map((v) => String(v.id)));
    return { approvals, audit: audit.map((x) => ({ policyId: Number(x.entity_id), action: x.action, by: x.actor, reason: x.reason, at: x.at })) };
  }

  // ---- assignment of policy, shift, weekly off and holiday calendar (FR-05) ----
  const scopeName = (type, id) => (type === 'COMPANY' ? 'Company default' : type === 'SITE' ? db.prepare('SELECT name FROM org_sites WHERE id = ?').get(id)?.name : type === 'CREW' ? db.prepare('SELECT name FROM hr_crews WHERE id = ?').get(id)?.name : db.prepare('SELECT full_name FROM hr_employees WHERE id = ?').get(id)?.full_name) ?? `#${id}`;
  const assignView = (a) => ({ id: a.id, scopeType: a.scope_type, scopeId: a.scope_id, scope: scopeName(a.scope_type, a.scope_id), policyCode: a.policy_code, shiftId: a.shift_id, shift: a.shift_id ? db.prepare('SELECT code FROM att_shifts WHERE id = ?').get(a.shift_id)?.code : null, weeklyOff: json(a.weekly_off_json, null), holidayCalendarId: a.holiday_calendar_id,
    holidayCalendar: a.holiday_calendar_id ? db.prepare('SELECT name FROM core_holiday_calendars WHERE id = ?').get(a.holiday_calendar_id)?.name : null, effectiveFrom: a.effective_from, effectiveTo: a.effective_to, reason: a.reason, rowVersion: a.version,
    when: a.effective_from > todayIST() ? 'FUTURE' : a.effective_to && a.effective_to < todayIST() ? 'ENDED' : 'CURRENT' });
  const assignScope = (actor, t, id) => {
    if (t === 'COMPANY') return {};
    if (t === 'SITE') { const s = siteRow(actor.companyId, id); if (!s) return null; return { projectId: s.project_id, siteId: s.id }; }
    if (t === 'CREW') { const c = db.prepare('SELECT crew_site_id FROM hr_crews WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId); const s = c && siteRow(actor.companyId, c.crew_site_id); return s ? { projectId: s.project_id, siteId: s.id } : null; }
    return db.prepare("SELECT 1 FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL AND record_status = 'APPROVED'").get(id, actor.companyId) ? {} : null;
  };
  const assignments = {
    list(actor, { scopeType, scopeId, includeEnded = false } = /** @type {any} */ ({})) {
      need(actor, 'att.assignment.view', 'see attendance assignments');
      const where = ['a.company_id = ?', 'a.deleted_at IS NULL']; const args = [actor.companyId];
      if (scopeType) { where.push('a.scope_type = ?'); args.push(scopeType); }
      if (scopeId != null) { where.push('a.scope_id = ?'); args.push(scopeId); }
      if (!includeEnded) { where.push('(a.effective_to IS NULL OR a.effective_to >= ?)'); args.push(todayIST()); }
      return db.prepare(`SELECT a.* FROM att_policy_assignments a WHERE ${where.join(' AND ')} ORDER BY CASE a.scope_type WHEN 'COMPANY' THEN 0 WHEN 'SITE' THEN 1 WHEN 'CREW' THEN 2 ELSE 3 END, a.scope_id, a.effective_from DESC LIMIT 500`).all(...args)
        .filter((a) => { const sc = assignScope(actor, a.scope_type, a.scope_id); return sc === null ? false : may(actor, 'att.assignment.view', Object.keys(sc).length ? sc : undefined); }).map(assignView);
    },
    create(actor, b) {
      need(actor, 'att.assignment.edit', 'assign attendance policies');
      const sc = assignScope(actor, b.scopeType, b.scopeId);
      const problems = [];
      if (sc === null) problems.push({ field: 'scopeId', message: 'That site, crew or employee does not exist' });
      if (b.scopeType === 'COMPANY' && b.scopeId !== 0) problems.push({ field: 'scopeId', message: 'The company default has no id' });
      if (b.policyCode && !db.prepare("SELECT 1 FROM att_policies WHERE company_id = ? AND code = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(actor.companyId, b.policyCode)) problems.push({ field: 'policyCode', message: 'No approved version of that policy exists' });
      if (b.shiftId && !db.prepare("SELECT 1 FROM att_shifts WHERE id = ? AND company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").get(b.shiftId, actor.companyId)) problems.push({ field: 'shiftId', message: 'That shift does not exist or is inactive' });
      if (b.holidayCalendarId && !db.prepare('SELECT 1 FROM core_holiday_calendars WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.holidayCalendarId, actor.companyId)) problems.push({ field: 'holidayCalendarId', message: 'That holiday calendar does not exist' });
      if (!b.policyCode && !b.shiftId && !b.weeklyOff && !b.holidayCalendarId) problems.push({ field: 'policyCode', message: 'Give at least a policy, a shift, a weekly off or a holiday calendar' });
      const closed = lastClosedEnd(actor.companyId);
      if (closed && b.effectiveFrom <= closed) problems.push({ field: 'effectiveFrom', message: `The attendance period up to ${closed} is closed; an assignment takes effect after it` });
      if (b.effectiveTo && b.effectiveTo < b.effectiveFrom) problems.push({ field: 'effectiveTo', message: 'The end date is on or after the start date' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const later = db.prepare('SELECT id FROM att_policy_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL AND effective_from >= ? AND (? IS NULL OR effective_from <= ?)').get(actor.companyId, b.scopeType, b.scopeId, b.effectiveFrom, b.effectiveTo ?? null, b.effectiveTo ?? '9999-12-31');
        if (later) throw new HttpError(409, 'OVERLAP', 'An assignment of this place already starts on or after that date inside these dates; end or change that one first.');
        // the one in force before is ended the day before: one assignment per place at a time (the new row replaces it whole)
        const prev = db.prepare('SELECT id FROM att_policy_assignments WHERE company_id = ? AND scope_type = ? AND scope_id = ? AND deleted_at IS NULL AND effective_from < ? AND (effective_to IS NULL OR effective_to >= ?)').all(actor.companyId, b.scopeType, b.scopeId, b.effectiveFrom, b.effectiveFrom);
        for (const p of prev) db.prepare('UPDATE att_policy_assignments SET effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(addDays(b.effectiveFrom, -1), actor.user, nowIso(), p.id);
        const id = Number(db.prepare("INSERT INTO att_policy_assignments (company_id, scope_type, scope_id, policy_code, shift_id, weekly_off_json, holiday_calendar_id, effective_from, effective_to, reason, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'att_assignment')")
          .run(actor.companyId, b.scopeType, b.scopeId, b.policyCode ?? null, b.shiftId ?? null, b.weeklyOff ? JSON.stringify(b.weeklyOff) : null, b.holidayCalendarId ?? null, b.effectiveFrom, b.effectiveTo ?? null, b.reason ?? null, sc?.projectId ?? null, sc?.siteId ?? null, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'att_policy_assignments', entityId: id, action: 'create', newValues: { scopeType: b.scopeType, scopeId: b.scopeId, policyCode: b.policyCode ?? null, shiftId: b.shiftId ?? null, effectiveFrom: b.effectiveFrom, ended: prev.map((p) => p.id) }, reason: b.reason ?? null, actor: actor.user, companyId: actor.companyId });
        event('att.assignment.changed', actor, 'att_assignment', id, actor.companyId, { scopeType: b.scopeType, scopeId: b.scopeId, policyCode: b.policyCode ?? null, shiftId: b.shiftId ?? null, effectiveFrom: b.effectiveFrom, effectiveTo: b.effectiveTo ?? null }, sc?.siteId ?? null);
        return assignView(db.prepare('SELECT * FROM att_policy_assignments WHERE id = ?').get(id));
      });
    },
    end(actor, id, { effectiveTo, reason }) {
      need(actor, 'att.assignment.edit', 'assign attendance policies');
      const a = db.prepare('SELECT * FROM att_policy_assignments WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
      if (!a) throw notFound('That assignment does not exist.');
      if (effectiveTo < a.effective_from) throw badRequest('Some fields are not valid.', [{ field: 'effectiveTo', message: 'The end date is on or after the start date' }]);
      closedGuard(actor.companyId, effectiveTo, 'An assignment is not ended inside a closed period');
      db.prepare('UPDATE att_policy_assignments SET effective_to = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(effectiveTo, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'att_policy_assignments', entityId: id, action: 'end', newValues: { effectiveTo }, reason, actor: actor.user, companyId: actor.companyId });
      event('att.assignment.changed', actor, 'att_assignment', id, actor.companyId, { scopeType: a.scope_type, scopeId: a.scope_id, effectiveTo }, a.site_id);
      return assignView(db.prepare('SELECT * FROM att_policy_assignments WHERE id = ?').get(id));
    },
  };

  // ---- resolution: the policy, shift, weekly off and holidays of a person on a date (BR-01) ----
  /** Everything resolution reads, loaded once for a company so a board of many people and days costs a few queries. */
  function facts(companyId) {
    const asg = db.prepare('SELECT * FROM att_policy_assignments WHERE company_id = ? AND deleted_at IS NULL').all(companyId);
    const pol = db.prepare("SELECT * FROM att_policies WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY effective_from DESC, version_no DESC").all(companyId);
    const shiftsById = new Map(db.prepare('SELECT * FROM att_shifts WHERE company_id = ? AND deleted_at IS NULL').all(companyId).map((s) => [s.id, s]));
    const rosters = db.prepare('SELECT * FROM att_rosters WHERE company_id = ? AND deleted_at IS NULL').all(companyId).map((r) => ({ ...r, pattern: json(r.pattern_json, { cycle: [] }) }));
    const changes = db.prepare("SELECT * FROM att_roster_changes WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").all(companyId);
    return { asg, pol, shiftsById, rosters, changes, sites: new Map(), emp: new Map(), place: new Map(), hol: new Map() };
  }
  /** Where a person is on a date: the primary approved deployment (site and crew), else the site of the employee record, and the crew by membership. */
  function placeOf(f, companyId, employeeId, date) {
    const key = `${employeeId}|${date}`;
    if (f.place.has(key)) return f.place.get(key);
    const d = db.prepare("SELECT dep_site_id, crew_id FROM hr_deployments WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND from_date <= ? AND (to_date IS NULL OR to_date >= ?) ORDER BY is_primary DESC, id LIMIT 1").get(companyId, employeeId, date, date);
    let siteId = d?.dep_site_id ?? null; let crewId = d?.crew_id ?? null;
    if (!siteId) siteId = db.prepare('SELECT site_id FROM hr_employees WHERE id = ?').get(employeeId)?.site_id ?? null;
    if (!crewId) crewId = db.prepare("SELECT m.crew_id FROM hr_crew_members m JOIN hr_crews k ON k.id = m.crew_id WHERE m.person_type = 'EMPLOYEE' AND m.person_id = ? AND m.deleted_at IS NULL AND m.from_date <= ? AND (m.to_date IS NULL OR m.to_date >= ?) AND (? IS NULL OR k.crew_site_id = ?) LIMIT 1").get(employeeId, date, date, siteId, siteId)?.crew_id ?? null;
    const out = { siteId, crewId }; f.place.set(key, out); return out;
  }
  function resolveWith(f, companyId, employeeId, date) {
    const emp = f.emp.get(employeeId) ?? db.prepare('SELECT id, full_name, emp_code, grade, employment_type FROM hr_employees WHERE id = ? AND company_id = ?').get(employeeId, companyId);
    if (!emp) throw notFound('That employee does not exist.');
    f.emp.set(employeeId, emp);
    const { siteId, crewId } = placeOf(f, companyId, employeeId, date);
    const site = siteId ? (f.sites.get(siteId) ?? (f.sites.set(siteId, siteRow(companyId, siteId)), f.sites.get(siteId))) : null;
    const sources = {};
    const pick = (attr, has) => {
      for (const level of LEVELS) {
        const id = level === 'EMPLOYEE' ? employeeId : level === 'CREW' ? crewId : level === 'SITE' ? siteId : 0;
        if (id == null) continue;
        const a = f.asg.find((x) => x.scope_type === level && x.scope_id === id && x.effective_from <= date && (!x.effective_to || x.effective_to >= date) && has(x));
        if (a) { sources[attr] = { level, assignmentId: a.id }; return a; }
      }
      return null;
    };
    const aPol = pick('policy', (x) => x.policy_code); const aShift = pick('shift', (x) => x.shift_id); const aOff = pick('weeklyOff', (x) => x.weekly_off_json); const aCal = pick('holidayCalendar', (x) => x.holiday_calendar_id);
    const policyRow_ = aPol ? f.pol.find((p) => same(p.code, aPol.policy_code) && p.effective_from <= date) : null;
    // the roster: an approved change of the day (a swap names two people), else the rotating pattern of the crew, else of the site
    let shiftId = aShift?.shift_id ?? null; let rosterOff = false;
    const ch = f.changes.find((c) => c.work_date === date && (c.employee_id === employeeId || c.swap_employee_id === employeeId));
    if (ch) { const mine = ch.employee_id === employeeId; const off = mine ? ch.is_off === 1 : ch.swap_is_off === 1; shiftId = off ? null : (mine ? ch.shift_id : ch.swap_shift_id); rosterOff = off; sources.shift = { level: 'ROSTER_CHANGE', assignmentId: null, changeId: ch.id }; }
    else {
      const r = (crewId && f.rosters.find((x) => x.crew_id === crewId && x.from_date <= date && (!x.to_date || x.to_date >= date))) || (siteId && f.rosters.find((x) => x.roster_site_id === siteId && !x.crew_id && x.from_date <= date && (!x.to_date || x.to_date >= date)));
      if (r) { const s = patternShift(r.pattern, date); if (s !== undefined) { shiftId = s; rosterOff = s === null; sources.shift = { level: 'ROSTER', assignmentId: null, rosterId: r.id }; } }
    }
    const shift = shiftId ? f.shiftsById.get(shiftId) : null;
    const off = aOff ? json(aOff.weekly_off_json, null) : null;
    const weeklyOff = isWeeklyOff(off, date);
    // holidays: the calendar assigned, else the company, state and site calendars that apply to the place (the holiday service of 01.03)
    const hk = `${aCal?.holiday_calendar_id ?? 'x'}|${siteId}|${date}`;
    if (!f.hol.has(hk)) f.hol.set(hk, aCal ? db.prepare('SELECT name, type FROM core_holidays WHERE calendar_id = ? AND holiday_date = ? AND deleted_at IS NULL').all(aCal.holiday_calendar_id, date) : holidaysOn(db, { companyId, date, stateCode: site?.state_code ?? null, siteId }).map((h) => ({ name: h.name, type: h.type })));
    const holiday = f.hol.get(hk)[0] ?? null;
    const dayType = holiday ? 'HOLIDAY' : weeklyOff ? 'WEEKLY_OFF' : rosterOff ? 'ROSTER_OFF' : 'WORKING';
    return {
      date, employeeId, employee: emp.full_name, employeeCode: emp.emp_code, grade: emp.grade, category: emp.employment_type, siteId, crewId, dayType, weeklyOff, holiday: holiday ? { name: holiday.name, type: holiday.type } : null,
      shift: shift ? { id: shift.id, code: shift.code, name: shift.name, startTime: hhmm(shift.start_minute), endTime: hhmm(shift.end_minute), nightShift: shift.night_shift === 1 } : null,
      shiftFull: shift ? shiftOf(shift) : null,
      policy: policyRow_ ? { id: policyRow_.id, code: policyRow_.code, name: policyRow_.name, version: policyRow_.version_no, effectiveFrom: policyRow_.effective_from, rules: withDefaults(json(policyRow_.rules_json, {})) } : null, sources,
    };
  }
  const resolve = (actor, employeeId, date) => {
    const view = (r) => ({ ...r, shiftFull: undefined });
    const e = db.prepare('SELECT id FROM hr_employees WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(employeeId, actor.companyId);
    if (!e) throw notFound('That employee does not exist.');
    const pl = placeOf(facts(actor.companyId), actor.companyId, employeeId, date);
    const own = myEmployee(actor) === employeeId;
    const s = pl.siteId ? siteRow(actor.companyId, pl.siteId) : null;
    if (!own && !may(actor, 'att.assignment.view', s ? { projectId: s.project_id, siteId: s.id } : undefined)) throw notFound('That employee does not exist.');
    return view(resolveWith(facts(actor.companyId), actor.companyId, employeeId, date));
  };
  /** For other modules (punch evaluation, leave, payroll): no actor, the company is named. */
  const resolveFor = (companyId, employeeId, date, f = facts(companyId)) => resolveWith(f, companyId, employeeId, date);

  /** What a day's punches mean under the policy and the shift that resolve for the person (FR-04); with `rules` and `shiftId` given it is the example on the policy editor. */
  function evaluate(actor, b) {
    need(actor, 'att.policy.view', 'evaluate attendance');
    let shift; let rules; let person = b.person ?? {}; let day = b.day ?? 'WORKING';
    if (b.employeeId) {
      const r = resolve(actor, b.employeeId, b.date);
      shift = r.shift && shiftOf(db.prepare('SELECT * FROM att_shifts WHERE id = ?').get(r.shift.id));
      rules = r.policy?.rules; person = { grade: r.grade, category: r.category }; day = r.dayType === 'HOLIDAY' ? 'HOLIDAY' : r.dayType === 'WORKING' ? 'WORKING' : 'WEEKLY_OFF';
      if (!shift) throw unprocessable('No shift resolves for that person on that date.');
    } else {
      const s = db.prepare('SELECT * FROM att_shifts WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(b.shiftId, actor.companyId);
      if (!s) throw notFound('That shift does not exist.');
      shift = shiftOf(s); rules = b.rules;
    }
    return evaluateDay({ shift, rules, date: b.date, day, punchIn: b.punchIn ?? null, punchOut: b.punchOut ?? null, person, lateMarksBefore: b.lateMarksBefore ?? 0, earlyMarksBefore: b.earlyMarksBefore ?? 0, weekOtMinutes: b.weekOtMinutes ?? 0 });
  }
  const mine = (actor, { from = todayIST(), days = 14 } = /** @type {any} */ ({})) => {
    const id = myEmployee(actor);
    if (!id) throw notFound('Your user account is not linked to an employee record.');
    const f = facts(actor.companyId);
    return { employeeId: id, days: Array.from({ length: days }, (_, i) => { const r = resolveWith(f, actor.companyId, id, addDays(from, i)); return { date: r.date, dayType: r.dayType, shift: r.shift, holiday: r.holiday }; }) };
  };

  // ---- rosters (FR-02) ----
  const rosterView = (r) => ({ id: r.id, siteId: r.roster_site_id, site: siteRow(r.company_id, r.roster_site_id)?.name, crewId: r.crew_id, crew: r.crew_id ? db.prepare('SELECT name FROM hr_crews WHERE id = ?').get(r.crew_id)?.name : null, name: r.name, anchor: json(r.pattern_json, {}).anchor, cycle: json(r.pattern_json, {}).cycle ?? [], fromDate: r.from_date, toDate: r.to_date, rowVersion: r.version });
  const rosters = {
    list(actor, { siteId, crewId } = /** @type {any} */ ({})) {
      need(actor, 'att.roster.view', 'see rosters');
      const where = ['company_id = ?', 'deleted_at IS NULL']; const args = [actor.companyId];
      if (siteId) { where.push('roster_site_id = ?'); args.push(siteId); }
      if (crewId) { where.push('crew_id = ?'); args.push(crewId); }
      return db.prepare(`SELECT * FROM att_rosters WHERE ${where.join(' AND ')} ORDER BY roster_site_id, crew_id, from_date DESC LIMIT 200`).all(...args).filter((r) => { const s = siteRow(actor.companyId, r.roster_site_id); return may(actor, 'att.roster.view', { projectId: s.project_id, siteId: s.id }); }).map(rosterView);
    },
    create(actor, b) {
      const s = siteRow(actor.companyId, b.siteId);
      if (!s) throw badRequest('Some fields are not valid.', [{ field: 'siteId', message: 'That site does not exist' }]);
      need(actor, 'att.roster.edit', 'keep rosters', { projectId: s.project_id, siteId: s.id });
      const problems = [];
      if (b.crewId && !db.prepare('SELECT 1 FROM hr_crews WHERE id = ? AND crew_site_id = ? AND deleted_at IS NULL').get(b.crewId, b.siteId)) problems.push({ field: 'crewId', message: 'That crew is not at the site' });
      for (const sid of b.cycle) if (sid !== null && !db.prepare("SELECT 1 FROM att_shifts WHERE id = ? AND company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").get(sid, actor.companyId)) { problems.push({ field: 'cycle', message: `Shift ${sid} does not exist or is inactive` }); break; }
      if (b.fromDate <= todayIST()) problems.push({ field: 'fromDate', message: 'A roster starts tomorrow or later; a change for a day already started is a roster change, approved by the supervisor and the project manager' });
      if (b.toDate && b.toDate < b.fromDate) problems.push({ field: 'toDate', message: 'The end date is on or after the start date' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        const clash = db.prepare('SELECT id, from_date FROM att_rosters WHERE company_id = ? AND roster_site_id = ? AND COALESCE(crew_id, 0) = ? AND deleted_at IS NULL AND (to_date IS NULL OR to_date >= ?) AND from_date <= ?').all(actor.companyId, b.siteId, b.crewId ?? 0, b.fromDate, b.toDate ?? '9999-12-31');
        for (const c of clash) { if (c.from_date >= b.fromDate) throw new HttpError(409, 'OVERLAP', 'A roster of this site or crew already starts inside these dates; end it first.'); db.prepare('UPDATE att_rosters SET to_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(addDays(b.fromDate, -1), actor.user, nowIso(), c.id); }
        const id = Number(db.prepare("INSERT INTO att_rosters (company_id, roster_site_id, crew_id, name, pattern_json, from_date, to_date, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'att_roster')")
          .run(actor.companyId, b.siteId, b.crewId ?? null, b.name, JSON.stringify({ anchor: b.fromDate, cycle: b.cycle }), b.fromDate, b.toDate ?? null, s.project_id, s.id, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'att_rosters', entityId: id, action: 'create', newValues: { siteId: b.siteId, crewId: b.crewId ?? null, fromDate: b.fromDate, cycle: b.cycle }, actor: actor.user, companyId: actor.companyId });
        event('att.roster.changed', actor, 'att_roster', id, actor.companyId, { siteId: b.siteId, crewId: b.crewId ?? null, fromDate: b.fromDate, toDate: b.toDate ?? null, kind: 'PATTERN' }, b.siteId);
        return rosterView(db.prepare('SELECT * FROM att_rosters WHERE id = ?').get(id));
      });
    },
    end(actor, id, { toDate }) {
      const r = db.prepare('SELECT * FROM att_rosters WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
      if (!r) throw notFound('That roster does not exist.');
      const s = siteRow(actor.companyId, r.roster_site_id);
      need(actor, 'att.roster.edit', 'keep rosters', { projectId: s.project_id, siteId: s.id });
      if (toDate <= todayIST() || toDate < r.from_date) throw unprocessable('A roster is ended from tomorrow; a change for today or earlier is a roster change.');
      db.prepare('UPDATE att_rosters SET to_date = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(toDate, actor.user, nowIso(), id);
      writeAudit(db, { entity: 'att_rosters', entityId: id, action: 'end', newValues: { toDate }, actor: actor.user, companyId: actor.companyId });
      event('att.roster.changed', actor, 'att_roster', id, actor.companyId, { siteId: r.roster_site_id, crewId: r.crew_id, toDate, kind: 'PATTERN_END' }, r.roster_site_id);
      return rosterView(db.prepare('SELECT * FROM att_rosters WHERE id = ?').get(id));
    },
    /** The planner: the people deployed at a site (or in one crew) on the first day, and for each day what resolves for them. */
    board(actor, { siteId, crewId = null, from = todayIST(), days = 7 }) {
      const s = siteRow(actor.companyId, siteId);
      if (!s) throw notFound('That site does not exist.');
      need(actor, 'att.roster.view', 'see the roster planner', { projectId: s.project_id, siteId: s.id });
      const f = facts(actor.companyId);
      const people = db.prepare(`SELECT DISTINCT e.id, e.full_name, e.emp_code, g.name AS designation FROM hr_deployments d JOIN hr_employees e ON e.id = d.person_id AND d.person_type = 'EMPLOYEE' LEFT JOIN org_designations g ON g.id = e.designation_id
        WHERE d.company_id = ? AND d.dep_site_id = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL AND d.from_date <= ? AND (d.to_date IS NULL OR d.to_date >= ?) ORDER BY e.full_name LIMIT 300`).all(actor.companyId, siteId, addDays(from, days - 1), from);
      const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
      const rows = people.map((p) => ({ employeeId: p.id, name: p.full_name, code: p.emp_code, designation: p.designation, days: dates.map((d) => { const r = resolveWith(f, actor.companyId, p.id, d); return { date: d, dayType: r.dayType, shiftId: r.shift?.id ?? null, shift: r.shift?.code ?? null, holiday: r.holiday?.name ?? null, source: r.sources.shift?.level ?? null, crewId: r.crewId }; }) }))
        .filter((p) => !crewId || p.days.some((d) => d.crewId === crewId));
      const pending = db.prepare("SELECT employee_id, swap_employee_id, work_date FROM att_roster_changes WHERE company_id = ? AND change_site_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL AND work_date >= ? AND work_date <= ?").all(actor.companyId, siteId, dates[0], dates[dates.length - 1]);
      const closed = lastClosedEnd(actor.companyId);
      return { siteId, site: s.name, from, dates, shifts: db.prepare("SELECT id, code, name, start_minute, end_minute FROM att_shifts WHERE company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL ORDER BY code").all(actor.companyId).map((x) => ({ id: x.id, code: x.code, name: x.name, startTime: hhmm(x.start_minute), endTime: hhmm(x.end_minute) })),
        crews: db.prepare('SELECT id, code, name FROM hr_crews WHERE crew_site_id = ? AND active = 1 AND deleted_at IS NULL ORDER BY name').all(siteId), rows,
        pending: pending.flatMap((p) => [`${p.employee_id}|${p.work_date}`, ...(p.swap_employee_id ? [`${p.swap_employee_id}|${p.work_date}`] : [])]), closedUpTo: closed, canChange: may(actor, 'att.roster.change', { projectId: s.project_id, siteId: s.id }), canEdit: may(actor, 'att.roster.edit', { projectId: s.project_id, siteId: s.id }) };
    },
  };

  // ---- a change of one day, or a swap of two people (FR-02), approved by the supervisor and the project manager ----
  const changeRow = (actor, id) => {
    const c = db.prepare('SELECT * FROM att_roster_changes WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(id, actor.companyId);
    const s = c && siteRow(actor.companyId, c.change_site_id);
    if (!c || !(may(actor, 'att.roster.view', { projectId: s.project_id, siteId: s.id }) || maker(actor, c))) throw notFound('That roster change does not exist.');
    return c;
  };
  const changeView = (actor, c) => {
    const s = siteRow(c.company_id, c.change_site_id);
    const nm = (id) => (id ? db.prepare('SELECT full_name FROM hr_employees WHERE id = ?').get(id)?.full_name : null);
    const sc = (id) => (id ? db.prepare('SELECT code FROM att_shifts WHERE id = ?').get(id)?.code : null);
    return { id: c.id, docNo: c.doc_no, kind: c.kind, siteId: c.change_site_id, site: s?.name, employeeId: c.employee_id, employee: nm(c.employee_id), swapEmployeeId: c.swap_employee_id, swapEmployee: nm(c.swap_employee_id), workDate: c.work_date, shiftId: c.shift_id, shift: c.is_off ? 'Off' : sc(c.shift_id), swapShift: c.swap_is_off ? 'Off' : sc(c.swap_shift_id), isOff: c.is_off === 1, reason: c.reason, band: c.band,
      status: c.status, statusLabel: STATUS[c.status], workflowInstanceId: c.workflow_instance_id, requestedBy: c.requested_by, createdBy: c.created_by, rowVersion: c.version,
      can: { submit: ['DRAFT', 'RETURNED'].includes(c.status) && maker(actor, c), withdraw: c.status === 'SUBMITTED' && maker(actor, c), cancel: ['SUBMITTED', 'RETURNED', 'APPROVED'].includes(c.status) && may(actor, 'att.roster.change', { projectId: s.project_id, siteId: s.id }) && c.work_date >= todayIST() } };
  };
  const deployedAt = (companyId, employeeId, siteId, date) => !!db.prepare("SELECT 1 FROM hr_deployments WHERE company_id = ? AND person_type = 'EMPLOYEE' AND person_id = ? AND dep_site_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND from_date <= ? AND (to_date IS NULL OR to_date >= ?)").get(companyId, employeeId, siteId, date, date);
  const rosterChanges = {
    list(actor, { siteId, status } = /** @type {any} */ ({})) {
      need(actor, 'att.roster.view', 'see roster changes');
      const where = ['company_id = ?', 'deleted_at IS NULL']; const args = [actor.companyId];
      if (siteId) { where.push('change_site_id = ?'); args.push(siteId); }
      if (status) { where.push('status = ?'); args.push(status); }
      return db.prepare(`SELECT * FROM att_roster_changes WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args).filter((c) => { const s = siteRow(actor.companyId, c.change_site_id); return may(actor, 'att.roster.view', { projectId: s.project_id, siteId: s.id }) || maker(actor, c); }).map((c) => changeView(actor, c));
    },
    get(actor, id) { return changeView(actor, changeRow(actor, id)); },
    create(actor, b) {
      const s = siteRow(actor.companyId, b.siteId);
      if (!s) throw badRequest('Some fields are not valid.', [{ field: 'siteId', message: 'That site does not exist' }]);
      need(actor, 'att.roster.change', 'ask for roster changes', { projectId: s.project_id, siteId: s.id });
      const problems = [];
      if (b.workDate < todayIST()) problems.push({ field: 'workDate', message: 'A roster change is for today or a later day' });
      const closed = lastClosedEnd(actor.companyId);
      if (closed && b.workDate <= closed) problems.push({ field: 'workDate', message: `The attendance period up to ${closed} is closed` });
      for (const [f, id] of [['employeeId', b.employeeId], ...(b.kind === 'SWAP' ? [['swapEmployeeId', b.swapEmployeeId]] : [])]) if (!deployedAt(actor.companyId, id, b.siteId, b.workDate)) problems.push({ field: f, message: 'The person is not deployed at this site on that day' });
      if (b.kind === 'CHANGE' && !b.isOff && !db.prepare("SELECT 1 FROM att_shifts WHERE id = ? AND company_id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").get(b.shiftId, actor.companyId)) problems.push({ field: 'shiftId', message: 'Choose a shift, or Off' });
      if (b.kind === 'SWAP' && (!b.swapEmployeeId || b.swapEmployeeId === b.employeeId)) problems.push({ field: 'swapEmployeeId', message: 'Choose another person to swap with' });
      if (db.prepare("SELECT 1 FROM att_roster_changes WHERE company_id = ? AND work_date = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED') AND deleted_at IS NULL AND (employee_id IN (?, ?) OR swap_employee_id IN (?, ?))").get(actor.companyId, b.workDate, b.employeeId, b.swapEmployeeId ?? 0, b.employeeId, b.swapEmployeeId ?? 0)) problems.push({ field: 'workDate', message: 'There is already a roster change for one of these people on that day; cancel it first' });
      if (problems.length) throw badRequest('Some fields are not valid.', problems);
      return transaction(db, () => {
        // the shifts of a swap are read now, on the server: each person takes the shift or day off of the other
        let sh = b.isOff ? null : b.shiftId ?? null; let off = b.isOff ? 1 : 0; let sw = null; let swOff = 0;
        if (b.kind === 'SWAP') {
          const f = facts(actor.companyId);
          const a = resolveWith(f, actor.companyId, b.employeeId, b.workDate); const c = resolveWith(f, actor.companyId, b.swapEmployeeId, b.workDate);
          sh = c.shift?.id ?? null; off = c.shift ? 0 : 1; sw = a.shift?.id ?? null; swOff = a.shift ? 0 : 1;
          if (sh === sw && off === swOff) throw unprocessable('Both people have the same shift on that day: there is nothing to swap.');
        }
        const no = nextDoc(actor, 'ATT_ROSTER_CHANGE', 'att_roster_changes', 'RCH');
        const supervisor = db.prepare('SELECT 1 FROM hr_crews k JOIN hr_employees e ON e.id = k.supervisor_id WHERE k.crew_site_id = ? AND e.user_id = ? AND k.deleted_at IS NULL').get(b.siteId, myUserId(actor) ?? 0);
        const band = (actor.roles ?? []).includes('WSUP') || supervisor ? 'RAISED_BY_WSUP' : 'STANDARD';
        const id = Number(db.prepare("INSERT INTO att_roster_changes (company_id, doc_no, change_site_id, kind, employee_id, swap_employee_id, work_date, shift_id, is_off, swap_shift_id, swap_is_off, reason, band, status, requested_by, project_id, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'att_roster_change')")
          .run(actor.companyId, no, b.siteId, b.kind, b.employeeId, b.swapEmployeeId ?? null, b.workDate, sh, off, sw, swOff, b.reason, band, actor.user, s.project_id, s.id, actor.user).lastInsertRowid);
        writeAudit(db, { entity: 'att_roster_changes', entityId: id, action: 'create', newValues: { docNo: no, kind: b.kind, workDate: b.workDate, employeeId: b.employeeId }, actor: actor.user, companyId: actor.companyId });
        return b.submit ? rosterChanges.submit(actor, id) : changeView(actor, changeRow(actor, id));
      });
    },
    submit(actor, id) {
      const c = changeRow(actor, id);
      if (!['DRAFT', 'RETURNED'].includes(c.status)) throw conflict(`This roster change is ${STATUS[c.status].toLowerCase()}.`);
      if (!maker(actor, c)) throw forbidden(`Only ${c.created_by}, who asked for it, submits it.`);
      const s = siteRow(c.company_id, c.change_site_id);
      need(actor, 'att.roster.change', 'ask for roster changes', { projectId: s.project_id, siteId: s.id });
      return transaction(db, () => {
        closedGuard(c.company_id, c.work_date, 'The change cannot be made');
        if (c.work_date < todayIST()) throw unprocessable('That day has passed.');
        const ctx = { band: c.band, projectId: s.project_id, siteId: s.id };
        if (c.status === 'RETURNED') workflowOf(db).resubmit(actor, c.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: ROSTER_DOC, docId: id, comment: c.reason, context: ctx }); db.prepare('UPDATE att_roster_changes SET workflow_instance_id = ? WHERE id = ?').run(inst.id, id); }
        db.prepare("UPDATE att_roster_changes SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), id);
        writeAudit(db, { entity: 'att_roster_changes', entityId: id, action: 'submit', actor: actor.user, companyId: actor.companyId });
        return changeView(actor, changeRow(actor, id));
      });
    },
    withdraw(actor, id, { reason }) { const c = changeRow(actor, id); if (c.status !== 'SUBMITTED') throw unprocessable('Only a change in approval is withdrawn.'); if (!maker(actor, c)) throw forbidden('Only the person who asked for it withdraws it.'); workflowOf(db).withdraw(actor, c.workflow_instance_id, { comment: reason }); return changeView(actor, changeRow(actor, id)); },
    cancel(actor, id, { reason }) {
      const c = changeRow(actor, id);
      const s = siteRow(c.company_id, c.change_site_id);
      need(actor, 'att.roster.change', 'cancel roster changes', { projectId: s.project_id, siteId: s.id });
      if (c.work_date < todayIST()) throw unprocessable('That day has passed.');
      if (c.status === 'APPROVED') {
        db.prepare("UPDATE att_roster_changes SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id);
        writeAudit(db, { entity: 'att_roster_changes', entityId: id, action: 'cancel', reason, actor: actor.user, companyId: actor.companyId });
        event('att.roster.changed', actor, 'att_roster_change', id, actor.companyId, { siteId: c.change_site_id, workDate: c.work_date, kind: 'CANCELLED' }, c.change_site_id);
        return changeView(actor, changeRow(actor, id));
      }
      if (['DRAFT'].includes(c.status)) { db.prepare("UPDATE att_roster_changes SET status = 'CANCELLED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, nowIso(), id); return changeView(actor, changeRow(actor, id)); }
      if (!['SUBMITTED', 'RETURNED'].includes(c.status)) throw unprocessable('That change cannot be cancelled.');
      if (maker(actor, c)) transaction(db, () => { workflowOf(db).abandon(actor.companyId, c.workflow_instance_id, actor.user, 'CANCELLED', reason); decisions.rosterChange({ docId: c.id, status: 'CANCELLED' }, actor, 'CANCELLED', reason); });
      else workflowOf(db).cancel(actor, c.workflow_instance_id, { reason });
      return changeView(actor, changeRow(actor, id));
    },
  };
  const decisions = {
    policy(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM att_policies WHERE id = ?').get(Number(instance.docId));
      if (!r || !['SUBMITTED', 'RETURNED'].includes(r.status)) return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        const closed = lastClosedEnd(r.company_id);
        if (closed && r.effective_from <= closed) throw unprocessable(`The attendance period up to ${closed} was closed while this waited: it cannot take effect on ${r.effective_from}. Return it and set a later date.`);
        db.prepare("UPDATE att_policies SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id);
        event('att.policy.approved', actor, 'att_policy', r.id, r.company_id, { code: r.code, version: r.version_no, effectiveFrom: r.effective_from, band: r.band });
      } else {
        const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
        db.prepare('UPDATE att_policies SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, r.id);
        if (withdrawn) db.prepare('UPDATE att_policies SET workflow_instance_id = NULL WHERE id = ?').run(r.id);
      }
      writeAudit(db, { entity: 'att_policies', entityId: r.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: r.company_id });
      tell(r.company_id, r.requested_by ?? r.created_by, 'Policy', `${r.code} v${r.version_no}`, r.name, outcome === 'RETURNED' ? 'returned for correction' : outcome.toLowerCase().replace('cancelled', 'cancelled'), comment, `/hr/attendance/policies/policy?id=${r.id}`);
    },
    rosterChange(instance, actor, outcome, comment) {
      const c = db.prepare('SELECT * FROM att_roster_changes WHERE id = ?').get(Number(instance.docId));
      if (!c || !['SUBMITTED', 'RETURNED'].includes(c.status)) return;
      const now = nowIso();
      if (outcome === 'APPROVED') {
        closedGuard(c.company_id, c.work_date, 'The change cannot be applied');
        db.prepare("UPDATE att_roster_changes SET status = 'APPROVED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, c.id);
        event('att.roster.changed', actor, 'att_roster_change', c.id, c.company_id, { siteId: c.change_site_id, workDate: c.work_date, employeeId: c.employee_id, swapEmployeeId: c.swap_employee_id, kind: c.kind }, c.change_site_id);
      } else {
        const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN';
        db.prepare('UPDATE att_roster_changes SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED', actor.user, now, c.id);
        if (withdrawn) db.prepare('UPDATE att_roster_changes SET workflow_instance_id = NULL WHERE id = ?').run(c.id);
      }
      writeAudit(db, { entity: 'att_roster_changes', entityId: c.id, action: outcome.toLowerCase(), reason: comment ?? null, actor: actor.user, companyId: c.company_id });
      tell(c.company_id, c.requested_by ?? c.created_by, 'Roster change', c.doc_no, `${c.kind === 'SWAP' ? 'Swap' : 'Change'} on ${c.work_date}`, outcome === 'RETURNED' ? 'returned for correction' : outcome.toLowerCase(), comment, '/hr/attendance/roster');
    },
  };
  /** Counts for the widget: the people whose shift today is a night shift or a roster change waiting. */
  const widget = (actor) => (may(actor, 'att.roster.view') ? { value: db.prepare("SELECT COUNT(*) AS n FROM att_roster_changes WHERE company_id = ? AND status = 'SUBMITTED' AND deleted_at IS NULL").get(actor.companyId).n } : { value: 0 });

  return { shifts, policies, assignments, rosters, rosterChanges, periods, resolve, resolveFor, facts, evaluate, mine, decisions, widget, policyList, shiftList };
}

const services = new WeakMap();
export const bindAttendance = (db, s) => services.set(db, s);
export const attendanceOf = (db) => services.get(db) ?? null;

const step = (code, name, roles, when = null) => ({ code, name, type: 'approval', mode: 'single', approvers: roles.map((role) => ({ kind: 'role', role })), slaHours: 48, requireAttachment: false, checklist: [], when, notify: [], action: null });
const hooks = (fn) => ({
  onApproved: (db, { instance, actor }) => attendanceOf(db)?.decisions[fn](instance, actor, 'APPROVED'),
  onRejected: (db, { instance, actor, comment }) => attendanceOf(db)?.decisions[fn](instance, actor, 'REJECTED', comment),
  onReturned: (db, { instance, actor, comment }) => attendanceOf(db)?.decisions[fn](instance, actor, 'RETURNED', comment),
  onCancelled: (db, { instance, actor, comment }) => attendanceOf(db)?.decisions[fn](instance, actor, 'CANCELLED', comment),
});
workflowTypes.register({
  docType: POLICY_DOC, label: 'Attendance policy change', processOwner: 'HRMGR', route: (id) => `/hr/attendance/policies/policy?id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT code, version_no, name, requested_by, created_by FROM att_policies WHERE id = ? AND company_id = ?').get(Number(id), companyId); return r ? { ref: `${r.code}/v${r.version_no}`, title: r.name, originator: r.requested_by ?? r.created_by } : null; },
  summarise(db, _actor, id) { const r = db.prepare('SELECT * FROM att_policies WHERE id = ?').get(Number(id)); if (!r) return null; return { fields: [{ label: 'Policy', value: `${r.code} version ${r.version_no}` }, { label: 'Name', value: r.name }, { label: 'Effective from', value: r.effective_from }, { label: 'Touches pay', value: r.band === 'PAY_IMPACTING' ? 'Yes' : 'No' }, { label: 'Change', value: r.change_note ?? '—' }] }; },
  defaultDefinition: { name: 'Attendance policy: HR manager, the director when it touches pay', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('HRMGR', 'HR manager', ['HRMGR']), step('DIR', 'Director (touches pay)', ['DIR'], { field: 'band', op: 'eq', value: 'PAY_IMPACTING' })] },
  hooks: hooks('policy'),
});
workflowTypes.register({
  docType: ROSTER_DOC, label: 'Roster change or shift swap', processOwner: 'HRMGR', route: () => '/hr/attendance/roster',
  describe(db, companyId, id) { const c = db.prepare('SELECT doc_no, work_date, kind, requested_by, created_by, change_site_id FROM att_roster_changes WHERE id = ? AND company_id = ?').get(Number(id), companyId); const s = c && db.prepare('SELECT org_project_id FROM org_sites WHERE id = ?').get(c.change_site_id); return c ? { ref: c.doc_no, title: `${c.kind === 'SWAP' ? 'Swap' : 'Change'} on ${c.work_date}`, originator: c.requested_by ?? c.created_by, projectId: s?.org_project_id, siteId: c.change_site_id } : null; },
  summarise(db, _actor, id) { const c = db.prepare('SELECT * FROM att_roster_changes WHERE id = ?').get(Number(id)); if (!c) return null; const n = (i) => db.prepare('SELECT full_name FROM hr_employees WHERE id = ?').get(i)?.full_name ?? '—'; const sh = (i, off) => (off ? 'Off' : db.prepare('SELECT code FROM att_shifts WHERE id = ?').get(i)?.code ?? '—'); return { fields: [{ label: 'Change', value: `${c.doc_no} (${c.kind === 'SWAP' ? 'swap' : 'one day'})` }, { label: 'Day', value: c.work_date }, { label: 'Person', value: `${n(c.employee_id)} to ${sh(c.shift_id, c.is_off)}` }, ...(c.swap_employee_id ? [{ label: 'Swapped with', value: `${n(c.swap_employee_id)} to ${sh(c.swap_shift_id, c.swap_is_off)}` }] : []), { label: 'Why', value: c.reason }] }; },
  defaultDefinition: { name: 'Roster change: supervisor, project manager', settings: { resubmit: 'first', distinctApprovers: true, matrix: true }, steps: [step('WSUP', 'Workforce supervisor', ['WSUP']), step('PM', 'Project manager', ['PM'])] },
  hooks: hooks('rosterChange'),
});
evidenceProviders.register(POLICY_DOC, ({ db, instance }) => {
  const r = db.prepare('SELECT * FROM att_policies WHERE id = ?').get(Number(instance.docId)); if (!r) return { sections: [] };
  const used = db.prepare("SELECT COUNT(*) AS n FROM att_policy_assignments WHERE company_id = ? AND policy_code = ? AND deleted_at IS NULL AND (effective_to IS NULL OR effective_to >= date('now'))").get(r.company_id, r.code).n;
  const prev = r.supersedes_id ? db.prepare('SELECT effective_from FROM att_policies WHERE id = ?').get(r.supersedes_id) : null;
  return { sections: [{ code: 'att-policy', title: 'Before approving', kind: 'metrics', items: [{ label: 'Effective from', value: r.effective_from, format: 'text' }, { label: 'Replaces version in force since', value: prev?.effective_from ?? 'first version', format: 'text' }, { label: 'Places that use this policy', value: String(used), format: 'text' }, { label: 'Touches pay', value: r.band === 'PAY_IMPACTING' ? 'Yes: the director also approves' : 'No', format: 'text', tone: r.band === 'PAY_IMPACTING' ? 'warn' : undefined }] }] };
});
objectTypes.register({
  type: 'att_policy', label: 'Attendance policy', permission: 'att.policy.view', route: (id) => `/hr/attendance/policies/policy?id=${id}`,
  access(db, actor, id) { const s = attendanceOf(db); if (!s) return null; try { const r = s.policies.get(actor, Number(id)); return { companyId: actor.companyId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'att_policies', id }],
  summary(db, actor, id) { const s = attendanceOf(db); if (!s) return null; try { const r = s.policies.get(actor, Number(id)); return { label: `${r.code} v${r.version} ${r.name}`, status: r.status }; } catch { return null; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'att.policy.view').allowed) return []; return db.prepare("SELECT id FROM att_policies WHERE company_id = ? AND deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY id DESC LIMIT ?").all(actor.companyId, `%${q}%`, `%${q}%`, limit).map((r) => r.id); },
});
objectTypes.register({
  type: 'att_shift', label: 'Shift', permission: 'att.shift.view', route: (id) => `/hr/attendance/shifts/shift?id=${id}`,
  access(db, actor, id) { const s = attendanceOf(db); if (!s) return null; try { const r = s.shifts.get(actor, Number(id)); return { companyId: actor.companyId, status: r.status }; } catch { return null; } },
  auditEntities: (id) => [{ entity: 'att_shifts', id }],
  summary(db, actor, id) { const s = attendanceOf(db); if (!s) return null; try { const r = s.shifts.get(actor, Number(id)); return { label: `${r.code} ${r.name}`, status: r.status }; } catch { return null; } },
  search(db, actor, q, limit) { if (!authzOf(db).check(actor, 'att.shift.view').allowed) return []; return db.prepare("SELECT id FROM att_shifts WHERE company_id = ? AND deleted_at IS NULL AND (code LIKE ? OR name LIKE ?) ORDER BY id DESC LIMIT ?").all(actor.companyId, `%${q}%`, `%${q}%`, limit).map((r) => r.id); },
});
void payImpacting;
