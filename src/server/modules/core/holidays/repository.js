/** Data access for core_holiday_calendars and core_holidays. */
export function createHolidayRepository(db) {
  return {
    calendars: (companyId) =>
      db
        .prepare(
          `SELECT c.*, (SELECT COUNT(*) FROM core_holidays h WHERE h.calendar_id = c.id AND h.is_active = 1) AS holiday_count
           FROM core_holiday_calendars c WHERE c.company_id = ? AND c.is_active = 1 ORDER BY c.code`,
        )
        .all(companyId),
    calendar: (id, companyId) => db.prepare('SELECT * FROM core_holiday_calendars WHERE id = ? AND company_id = ? AND is_active = 1').get(id, companyId),
    calendarByCode: (companyId, code) => db.prepare('SELECT id FROM core_holiday_calendars WHERE company_id = ? AND code = ?').get(companyId, code),
    insertCalendar(companyId, v, actor) {
      const res = db
        .prepare('INSERT INTO core_holiday_calendars (company_id, code, name, state_code, site_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(companyId, v.code, v.name, v.stateCode, v.siteId, actor, 'holiday_calendar');
      return Number(res.lastInsertRowid);
    },
    updateCalendar(id, version, v, actor, now) {
      const res = db
        .prepare('UPDATE core_holiday_calendars SET name = ?, state_code = ?, site_id = ?, is_active = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?')
        .run(v.name, v.stateCode, v.siteId, v.isActive ? 1 : 0, actor, now, id, version);
      return Number(res.changes) === 1;
    },

    holidays: (calendarId, from, to) =>
      db.prepare('SELECT * FROM core_holidays WHERE calendar_id = ? AND is_active = 1 AND holiday_date >= ? AND holiday_date <= ? ORDER BY holiday_date').all(calendarId, from, to),
    holiday: (id, companyId) => db.prepare('SELECT * FROM core_holidays WHERE id = ? AND company_id = ? AND is_active = 1').get(id, companyId),
    holidayOn: (calendarId, date) => db.prepare('SELECT * FROM core_holidays WHERE calendar_id = ? AND holiday_date = ? AND is_active = 1').get(calendarId, date),
    insertHoliday(companyId, calendarId, v, actor) {
      const res = db
        .prepare('INSERT INTO core_holidays (company_id, calendar_id, holiday_date, name, type, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(companyId, calendarId, v.date, v.name, v.type, actor, v.source ?? 'holiday');
      return Number(res.lastInsertRowid);
    },
    updateHoliday(id, version, v, actor, now) {
      const res = db.prepare('UPDATE core_holidays SET name = ?, type = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?').run(v.name, v.type, actor, now, id, version);
      return Number(res.changes) === 1;
    },
    softDeleteHoliday(id, actor, now) {
      db.prepare('UPDATE core_holidays SET is_active = 0, deleted_at = ?, deleted_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(now, actor, actor, now, id);
    },

    /** Calendars that apply to a place: company-wide ones, the state's, and the site's. */
    applicable: (companyId, stateCode, siteId) =>
      db
        .prepare(
          `SELECT id, code, name FROM core_holiday_calendars
           WHERE company_id = :c AND is_active = 1 AND ((state_code IS NULL AND site_id IS NULL) OR (state_code = :s) OR (site_id = :site))`,
        )
        .all({ c: companyId, s: stateCode ?? null, site: siteId ?? null }),
    holidaysBetween: (calendarIds, from, to) =>
      calendarIds.length
        ? db.prepare(`SELECT h.holiday_date, h.name, h.type, c.name AS calendar FROM core_holidays h JOIN core_holiday_calendars c ON c.id = h.calendar_id WHERE h.calendar_id IN (${calendarIds.map(() => '?').join(',')}) AND h.holiday_date >= ? AND h.holiday_date <= ? AND h.is_active = 1 ORDER BY h.holiday_date`).all(...calendarIds, from, to)
        : [],
    holidayMatches: (calendarIds, date) =>
      calendarIds.length
        ? db.prepare(`SELECT h.name, h.type, c.name AS calendar FROM core_holidays h JOIN core_holiday_calendars c ON c.id = h.calendar_id WHERE h.calendar_id IN (${calendarIds.map(() => '?').join(',')}) AND h.holiday_date = ? AND h.is_active = 1`).all(...calendarIds, date)
        : [],
  };
}
