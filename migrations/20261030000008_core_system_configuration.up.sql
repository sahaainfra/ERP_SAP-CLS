-- System configuration (part 01.03): company settings, financial years and periods, typed parameters, holiday calendars.
-- Dates are plain YYYY-MM-DD business dates. Each table carries the standard columns (standards section 4.2).

CREATE TABLE IF NOT EXISTS core_company_settings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  legal_name    TEXT    NOT NULL,
  trade_name    TEXT,
  address_json  TEXT    NOT NULL DEFAULT '{}',
  gstins_json   TEXT    NOT NULL DEFAULT '[]',
  pan           TEXT,
  cin           TEXT,
  logo_file_id  TEXT,
  currency      TEXT    NOT NULL DEFAULT 'INR' CHECK (length(currency) = 3),
  timezone      TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  date_format   TEXT    NOT NULL DEFAULT 'DD-MMM-YYYY' CHECK (date_format IN ('DD-MMM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD')),
  number_format TEXT    NOT NULL DEFAULT 'indian' CHECK (number_format IN ('indian', 'international')),
  fy_start_month INTEGER NOT NULL DEFAULT 4 CHECK (fy_start_month BETWEEN 1 AND 12),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_company_settings_company ON core_company_settings (company_id);

CREATE TABLE IF NOT EXISTS core_financial_years (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  code        TEXT    NOT NULL,
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Closed')),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT,
  CHECK (end_date > start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_financial_years_code ON core_financial_years (company_id, code);
CREATE INDEX IF NOT EXISTS ix_core_financial_years_company_status ON core_financial_years (company_id, status);
CREATE INDEX IF NOT EXISTS ix_core_financial_years_dates ON core_financial_years (company_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS core_periods (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER NOT NULL,
  fy_id              INTEGER NOT NULL REFERENCES core_financial_years(id),
  period_no          INTEGER NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  name               TEXT    NOT NULL,
  start_date         TEXT    NOT NULL,
  end_date           TEXT    NOT NULL,
  module_status_json TEXT    NOT NULL DEFAULT '{}',
  project_id         INTEGER,
  site_id            INTEGER,
  created_by         TEXT,
  created_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by         TEXT,
  updated_at         TEXT,
  version            INTEGER NOT NULL DEFAULT 1,
  is_active          INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at         TEXT,
  deleted_by         TEXT,
  source_type        TEXT,
  source_id          TEXT,
  remarks            TEXT,
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_periods_fy_no ON core_periods (fy_id, period_no);
CREATE INDEX IF NOT EXISTS ix_core_periods_company_dates ON core_periods (company_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS core_parameters (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  key            TEXT    NOT NULL,
  value          TEXT    NOT NULL,
  data_type      TEXT    NOT NULL CHECK (data_type IN ('string', 'integer', 'decimal', 'boolean', 'date', 'json')),
  scope_type     TEXT    NOT NULL CHECK (scope_type IN ('system', 'company', 'project', 'site')),
  scope_id       INTEGER,
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  company_id     INTEGER,
  project_id     INTEGER,
  site_id        INTEGER,
  created_by     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by     TEXT,
  updated_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at     TEXT,
  deleted_by     TEXT,
  source_type    TEXT,
  source_id      TEXT,
  remarks        TEXT,
  CHECK ((scope_type = 'system' AND scope_id IS NULL) OR (scope_type <> 'system' AND scope_id IS NOT NULL)),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_parameters_version ON core_parameters (key, scope_type, COALESCE(scope_id, 0), effective_from);
CREATE INDEX IF NOT EXISTS ix_core_parameters_key ON core_parameters (key, scope_type, scope_id);
CREATE INDEX IF NOT EXISTS ix_core_parameters_company ON core_parameters (company_id);

CREATE TABLE IF NOT EXISTS core_holiday_calendars (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  state_code  TEXT,
  site_id     INTEGER,
  project_id  INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_holiday_calendars_code ON core_holiday_calendars (company_id, code);
CREATE INDEX IF NOT EXISTS ix_core_holiday_calendars_site ON core_holiday_calendars (company_id, site_id);

CREATE TABLE IF NOT EXISTS core_holidays (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  calendar_id  INTEGER NOT NULL REFERENCES core_holiday_calendars(id),
  holiday_date TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  type         TEXT    NOT NULL DEFAULT 'company' CHECK (type IN ('national', 'state', 'company', 'optional', 'site')),
  project_id   INTEGER,
  site_id      INTEGER,
  created_by   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by   TEXT,
  updated_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at   TEXT,
  deleted_by   TEXT,
  source_type  TEXT,
  source_id    TEXT,
  remarks      TEXT
);
-- Partial: a deleted holiday (soft delete) frees its date so it can be added again.
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_holidays_calendar_date ON core_holidays (calendar_id, holiday_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_core_holidays_company_date ON core_holidays (company_id, holiday_date);
