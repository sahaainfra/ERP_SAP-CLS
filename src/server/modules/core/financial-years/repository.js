/** Data access for core_financial_years and core_periods. */
export function createFinancialYearRepository(db) {
  const repo = {
    listYears({ companyId, limit, offset }) {
      const total = db.prepare('SELECT COUNT(*) AS n FROM core_financial_years WHERE company_id = ? AND is_active = 1').get(companyId).n;
      const rows = db
        .prepare('SELECT * FROM core_financial_years WHERE company_id = ? AND is_active = 1 ORDER BY start_date DESC LIMIT ? OFFSET ?')
        .all(companyId, limit, offset);
      return { rows, total };
    },
    year: (id, companyId) => db.prepare('SELECT * FROM core_financial_years WHERE id = ? AND company_id = ? AND is_active = 1').get(id, companyId),
    yearByDate: (companyId, date) => db.prepare('SELECT * FROM core_financial_years WHERE company_id = ? AND is_active = 1 AND start_date <= ? AND end_date >= ?').get(companyId, date, date),
    overlapping: (companyId, start, end) => db.prepare('SELECT * FROM core_financial_years WHERE company_id = ? AND is_active = 1 AND start_date <= ? AND end_date >= ?').get(companyId, end, start),
    yearByCode: (companyId, code) => db.prepare('SELECT id FROM core_financial_years WHERE company_id = ? AND code = ?').get(companyId, code),

    insertYear(companyId, fy, actor) {
      const res = db
        .prepare("INSERT INTO core_financial_years (company_id, code, start_date, end_date, status, created_by, source_type) VALUES (?, ?, ?, ?, 'Open', ?, 'financial_year')")
        .run(companyId, fy.code, fy.startDate, fy.endDate, actor);
      return Number(res.lastInsertRowid);
    },
    insertPeriod(companyId, fyId, p, statusJson, actor) {
      db.prepare('INSERT INTO core_periods (company_id, fy_id, period_no, name, start_date, end_date, module_status_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        companyId, fyId, p.periodNo, p.name, p.startDate, p.endDate, statusJson, actor, 'financial_year',
      );
    },
    periods: (fyId) => db.prepare('SELECT * FROM core_periods WHERE fy_id = ? AND is_active = 1 ORDER BY period_no').all(fyId),
    period: (id, companyId) => db.prepare('SELECT * FROM core_periods WHERE id = ? AND company_id = ? AND is_active = 1').get(id, companyId),
    periodByDate: (companyId, date) => db.prepare('SELECT * FROM core_periods WHERE company_id = ? AND is_active = 1 AND start_date <= ? AND end_date >= ?').get(companyId, date, date),

    setPeriodStatuses(id, version, json, actor, now) {
      const res = db.prepare('UPDATE core_periods SET module_status_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?').run(json, actor, now, id, version);
      return Number(res.changes) === 1;
    },
    setYearStatus(id, status, actor, now) {
      db.prepare('UPDATE core_financial_years SET status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(status, actor, now, id);
    },
    hasNumbering: (companyId, fyCode) => Boolean(db.prepare('SELECT 1 FROM core_number_counters c JOIN core_number_series s ON s.id = c.series_id WHERE s.company_id = ? AND c.period_key = ?').get(companyId, fyCode)),
  };
  return repo;
}
