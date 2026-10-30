import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { assertPermission } from '../../../platform/auth/index.js';
import { assertVersion } from '../../../platform/db/repository.js';
import { companyScope } from '../../../platform/db/scope.js';
import { badRequest, conflict, notFound, unprocessable } from '../../../platform/http/errors.js';
import { parseBusinessDate } from '../../../../shared/dates.js';
import { isStateCode } from '../../../../shared/gst.js';
import { createHolidayRepository } from './repository.js';

export const MAX_IMPORT_ROWS = 400;
export const HOLIDAY_TYPES = ['national', 'state', 'company', 'optional', 'site'];

const presentCalendar = (c) => ({ id: c.id, code: c.code, name: c.name, stateCode: c.state_code, siteId: c.site_id, holidayCount: c.holiday_count ?? null, version: c.version });
const presentHoliday = (h) => ({ id: h.id, calendarId: h.calendar_id, date: h.holiday_date, name: h.name, type: h.type, version: h.version });

/** Is the date a holiday for a place? Company-wide calendars always apply; state and site calendars when they match. */
export function holidaysOn(db, { companyId, date, stateCode = null, siteId = null }) {
  const repo = createHolidayRepository(db);
  const calendars = repo.applicable(companyId, stateCode, siteId);
  return repo.holidayMatches(calendars.map((c) => c.id), date);
}
export const isHoliday = (db, ctx) => holidaysOn(db, ctx).length > 0;

/** A working day is neither a weekly off (parameter core.calendar.week_off_days; 0 = Sunday) nor a holiday. */
export function isWorkingDay(db, store, ctx) {
  const weekday = new Date(`${ctx.date}T00:00:00Z`).getUTCDay();
  const weekOff = store.get('core.calendar.week_off_days', { companyId: ctx.companyId, siteId: ctx.siteId ?? null, date: ctx.date });
  return !weekOff.includes(weekday) && !isHoliday(db, ctx);
}

export function createHolidayService({ db }) {
  const repo = createHolidayRepository(db);
  const companyOf = (actor) => companyScope(actor).params._company_scope;
  const calendarOrThrow = (id, companyId) => repo.calendar(id, companyId) ?? (() => { throw notFound('That holiday calendar does not exist.'); })();

  function checkRow(v) {
    try {
      parseBusinessDate(v.date);
    } catch {
      return 'the date is not a real date (use YYYY-MM-DD)';
    }
    if (!v.name || v.name.length > 120) return 'the name is missing or longer than 120 characters';
    if (!HOLIDAY_TYPES.includes(v.type)) return `the type must be one of ${HOLIDAY_TYPES.join(', ')}`;
    return null;
  }

  return {
    listCalendars(actor) {
      return repo.calendars(companyOf(actor)).map(presentCalendar);
    },

    getCalendar(actor, id, { from, to }) {
      const companyId = companyOf(actor);
      const c = calendarOrThrow(id, companyId);
      return { ...presentCalendar(c), holidays: repo.holidays(id, from, to).map(presentHoliday) };
    },

    createCalendar(actor, v, correlationId) {
      assertPermission(actor, 'core.holiday.configure');
      const companyId = companyOf(actor);
      if (v.stateCode && !isStateCode(v.stateCode)) throw unprocessable(`${v.stateCode} is not a GST state code.`);
      return transaction(db, () => {
        if (repo.calendarByCode(companyId, v.code)) throw conflict(`A holiday calendar with the code ${v.code} already exists.`);
        const id = repo.insertCalendar(companyId, v, actor.user);
        writeAudit(db, { entity: 'core_holiday_calendars', entityId: id, action: 'create', newValues: v, reason: v.reason, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.holiday_calendar.created', entity: 'holiday_calendar', entityId: id, actorId: actor.user, companyId, data: { code: v.code } });
        return presentCalendar({ ...repo.calendar(id, companyId), holiday_count: 0 });
      });
    },

    updateCalendar(actor, id, v, correlationId) {
      assertPermission(actor, 'core.holiday.configure');
      const companyId = companyOf(actor);
      if (v.stateCode && !isStateCode(v.stateCode)) throw unprocessable(`${v.stateCode} is not a GST state code.`);
      return transaction(db, () => {
        const c = calendarOrThrow(id, companyId);
        assertVersion(c.version, v.version, `The calendar ${c.code}`, 'Refresh the page and try again.');
        const next = { name: v.name ?? c.name, stateCode: v.stateCode === undefined ? c.state_code : v.stateCode, siteId: v.siteId === undefined ? c.site_id : v.siteId, isActive: v.isActive ?? true };
        if (!repo.updateCalendar(id, c.version, next, actor.user, new Date().toISOString())) throw conflict('The calendar was changed by someone else. Refresh and try again.');
        writeAudit(db, { entity: 'core_holiday_calendars', entityId: id, action: 'update', oldValues: presentCalendar(c), newValues: next, reason: v.reason, actor: actor.user, correlationId });
        return presentCalendar({ ...repo.calendar(id, companyId) ?? { ...c, is_active: 0 }, holiday_count: null });
      });
    },

    addHoliday(actor, calendarId, v, correlationId) {
      assertPermission(actor, 'core.holiday.configure');
      const companyId = companyOf(actor);
      const problem = checkRow(v);
      if (problem) throw badRequest(`The holiday is not valid: ${problem}.`, [{ field: 'date', message: problem }]);
      return transaction(db, () => {
        calendarOrThrow(calendarId, companyId);
        if (repo.holidayOn(calendarId, v.date)) throw conflict(`There is already a holiday on ${v.date} in this calendar. Edit it instead.`);
        const id = repo.insertHoliday(companyId, calendarId, v, actor.user);
        writeAudit(db, { entity: 'core_holidays', entityId: id, action: 'create', newValues: v, actor: actor.user, correlationId });
        return presentHoliday(repo.holiday(id, companyId));
      });
    },

    updateHoliday(actor, id, v, correlationId) {
      assertPermission(actor, 'core.holiday.configure');
      const companyId = companyOf(actor);
      return transaction(db, () => {
        const h = repo.holiday(id, companyId) ?? (() => { throw notFound('That holiday does not exist.'); })();
        assertVersion(h.version, v.version, 'The holiday', 'Refresh the page and try again.');
        const next = { name: v.name ?? h.name, type: v.type ?? h.type };
        const problem = checkRow({ date: h.holiday_date, ...next });
        if (problem) throw badRequest(`The holiday is not valid: ${problem}.`, [{ field: 'name', message: problem }]);
        if (!repo.updateHoliday(id, h.version, next, actor.user, new Date().toISOString())) throw conflict('The holiday was changed by someone else. Refresh and try again.');
        writeAudit(db, { entity: 'core_holidays', entityId: id, action: 'update', oldValues: { name: h.name, type: h.type }, newValues: next, actor: actor.user, correlationId });
        return presentHoliday(repo.holiday(id, companyId));
      });
    },

    deleteHoliday(actor, id, correlationId) {
      assertPermission(actor, 'core.holiday.configure');
      const companyId = companyOf(actor);
      return transaction(db, () => {
        const h = repo.holiday(id, companyId) ?? (() => { throw notFound('That holiday does not exist.'); })();
        repo.softDeleteHoliday(id, actor.user, new Date().toISOString());
        writeAudit(db, { entity: 'core_holidays', entityId: id, action: 'delete', oldValues: { date: h.holiday_date, name: h.name }, actor: actor.user, correlationId });
        return { id };
      });
    },

    /**
     * Import many holidays at once (from a spreadsheet read in the browser). All or nothing: if any row is wrong,
     * nothing is saved and every problem is listed with its row number. Existing dates are updated, new ones added.
     */
    importHolidays(actor, calendarId, rows, correlationId) {
      assertPermission(actor, 'core.holiday.configure');
      const companyId = companyOf(actor);
      if (rows.length === 0) throw badRequest('The file has no holidays to import.', [{ field: 'rows', message: 'is empty' }]);
      if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`Import at most ${MAX_IMPORT_ROWS} holidays at a time.`, [{ field: 'rows', message: `has ${rows.length} rows` }]);
      const problems = [];
      const seen = new Set();
      rows.forEach((r, i) => {
        const p = checkRow(r);
        if (p) problems.push({ field: `rows.${i}`, message: `Row ${i + 1}: ${p}` });
        else if (seen.has(r.date)) problems.push({ field: `rows.${i}`, message: `Row ${i + 1}: ${r.date} appears twice in the file` });
        seen.add(r.date);
      });
      if (problems.length) throw badRequest(`The file has ${problems.length} problem(s); nothing was imported.`, problems.slice(0, 50));
      return transaction(db, () => {
        calendarOrThrow(calendarId, companyId);
        let added = 0;
        let updated = 0;
        let unchanged = 0;
        for (const r of rows) {
          const ex = repo.holidayOn(calendarId, r.date);
          if (!ex) {
            repo.insertHoliday(companyId, calendarId, { ...r, source: 'holiday_import' }, actor.user);
            added++;
          } else if (ex.name !== r.name || ex.type !== r.type) {
            repo.updateHoliday(ex.id, ex.version, r, actor.user, new Date().toISOString());
            updated++;
          } else unchanged++;
        }
        writeAudit(db, { entity: 'core_holiday_calendars', entityId: calendarId, action: 'import', newValues: { added, updated, unchanged }, actor: actor.user, correlationId });
        publishEvent(db, { type: 'core.holiday_calendar.imported', entity: 'holiday_calendar', entityId: calendarId, actorId: actor.user, companyId, data: { added, updated, unchanged } });
        return { added, updated, unchanged };
      });
    },

    /** Is a date a holiday for a place? (any signed-in user: used by screens that grey out days). */
    check(actor, { date, stateCode, siteId }) {
      const companyId = companyOf(actor);
      const matches = holidaysOn(db, { companyId, date, stateCode: stateCode ?? null, siteId: siteId ?? null });
      return { date, isHoliday: matches.length > 0, matches };
    },
  };
}
