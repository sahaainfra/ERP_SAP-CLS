-- Part 14.03: site diary, weather, hindrances and site conditions.
-- site_weather: the weather of a site for a day (manual or fetched through the integration hub), the hours lost, the shutdown and the concrete-pour restriction worked out on the server (FR-01).
-- site_hindrances (approval-controlled): the obstacles that stop or slow the work, with the letter that notified them and the delay draft they raised (FR-02, FR-05, BR-01).
-- site_diary: the free-form daily notes of a site with a category, signed off by the construction manager (FR-03); site_visitors: the visits of officials, the client and the consultant (FR-04).
-- Measures are integers in thousandths (rainfall, temperatures, wind, hours) or whole percent (humidity), as the quantities of the other site tables.

CREATE TABLE IF NOT EXISTS site_weather (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  wx_site_id      INTEGER NOT NULL REFERENCES org_sites (id),
  wx_date         TEXT    NOT NULL,
  rainfall_mm     INTEGER CHECK (rainfall_mm IS NULL OR (rainfall_mm >= 0 AND rainfall_mm <= 2000000)),
  temp_min        INTEGER CHECK (temp_min IS NULL OR (temp_min >= -80000 AND temp_min <= 70000)),
  temp_max        INTEGER CHECK (temp_max IS NULL OR (temp_max >= -80000 AND temp_max <= 70000)),
  humidity_pct    INTEGER CHECK (humidity_pct IS NULL OR (humidity_pct >= 0 AND humidity_pct <= 100)),
  wind_kmh        INTEGER CHECK (wind_kmh IS NULL OR (wind_kmh >= 0 AND wind_kmh <= 500000)),
  condition_code  TEXT    CHECK (condition_code IS NULL OR condition_code IN ('CLEAR', 'CLOUDY', 'RAIN', 'HEAVY_RAIN', 'STORM', 'FOG', 'HOT', 'COLD')),
  source          TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL', 'API')),
  connector_code  TEXT,
  hours_lost      INTEGER NOT NULL DEFAULT 0 CHECK (hours_lost >= 0 AND hours_lost <= 24000),
  shutdown        INTEGER NOT NULL DEFAULT 0 CHECK (shutdown IN (0, 1)),
  shutdown_reason TEXT,
  pour_restricted INTEGER NOT NULL DEFAULT 0 CHECK (pour_restricted IN (0, 1)),
  pour_reason     TEXT,
  notes           TEXT,
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
  CHECK (temp_min IS NULL OR temp_max IS NULL OR temp_min <= temp_max)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_weather_site_day ON site_weather (wx_site_id, wx_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_site_weather_company ON site_weather (company_id, wx_date);
CREATE INDEX IF NOT EXISTS ix_site_weather_project ON site_weather (org_project_id, wx_date);
CREATE INDEX IF NOT EXISTS ix_site_weather_shutdown ON site_weather (company_id, shutdown, wx_date) WHERE shutdown = 1;

CREATE TABLE IF NOT EXISTS site_hindrances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  hin_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  title           TEXT    NOT NULL,
  description     TEXT,
  hin_type        TEXT    NOT NULL CHECK (hin_type IN ('SITE_NOT_HANDED_OVER', 'DRAWINGS_PENDING', 'UTILITY_SHIFTING', 'LOCAL_ISSUES', 'APPROVALS', 'OTHER')),
  start_date      TEXT    NOT NULL,
  end_date        TEXT,
  affected_json   TEXT    NOT NULL DEFAULT '{}',
  responsible_party TEXT  NOT NULL CHECK (responsible_party IN ('CLIENT', 'CONSULTANT', 'THIRD_PARTY', 'AUTHORITY', 'CONTRACTOR')),
  responsible_name TEXT,
  letter_id       INTEGER REFERENCES engg_letters (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  parent_hindrance_id INTEGER REFERENCES site_hindrances (id),
  closure_notes   TEXT,
  closed_at       TEXT,
  closed_by       TEXT,
  escalated_at    TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
  reason          TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
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
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_hindrances_doc ON site_hindrances (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_site_hindrances_company ON site_hindrances (company_id, status);
CREATE INDEX IF NOT EXISTS ix_site_hindrances_project ON site_hindrances (org_project_id, start_date);
CREATE INDEX IF NOT EXISTS ix_site_hindrances_site ON site_hindrances (hin_site_id, status, start_date);
CREATE INDEX IF NOT EXISTS ix_site_hindrances_letter ON site_hindrances (letter_id) WHERE letter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_hindrances_parent ON site_hindrances (parent_hindrance_id) WHERE parent_hindrance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_hindrances_open ON site_hindrances (company_id, start_date) WHERE end_date IS NULL AND status IN ('SUBMITTED', 'APPROVED');

CREATE TABLE IF NOT EXISTS site_diary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  dy_site_id      INTEGER NOT NULL REFERENCES org_sites (id),
  diary_date      TEXT    NOT NULL,
  category        TEXT    NOT NULL CHECK (category IN ('GENERAL', 'PROGRESS', 'INSTRUCTION', 'HINDRANCE', 'QUALITY', 'SAFETY', 'MATERIAL', 'VISITOR')),
  entry_text      TEXT    NOT NULL,
  signed_by       TEXT,
  signed_at       TEXT,
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
  remarks     TEXT
);
CREATE INDEX IF NOT EXISTS ix_site_diary_company ON site_diary (company_id, diary_date);
CREATE INDEX IF NOT EXISTS ix_site_diary_site ON site_diary (dy_site_id, diary_date, category);
CREATE INDEX IF NOT EXISTS ix_site_diary_project ON site_diary (org_project_id, diary_date);
CREATE INDEX IF NOT EXISTS ix_site_diary_unsigned ON site_diary (company_id, diary_date) WHERE signed_at IS NULL;

CREATE TABLE IF NOT EXISTS site_visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  vis_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  visit_date      TEXT    NOT NULL,
  time_in         TEXT,
  time_out        TEXT,
  visitor_name    TEXT    NOT NULL,
  organisation    TEXT,
  visitor_type    TEXT    NOT NULL DEFAULT 'OFFICIAL' CHECK (visitor_type IN ('OFFICIAL', 'CLIENT', 'CONSULTANT', 'AUTHORITY', 'OTHER')),
  purpose         TEXT    NOT NULL,
  instructions    TEXT,
  linked_letter_id INTEGER REFERENCES engg_letters (id),
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
  CHECK (time_in IS NULL OR time_out IS NULL OR time_out >= time_in)
);
CREATE INDEX IF NOT EXISTS ix_site_visitors_company ON site_visitors (company_id, visit_date);
CREATE INDEX IF NOT EXISTS ix_site_visitors_site ON site_visitors (vis_site_id, visit_date);
CREATE INDEX IF NOT EXISTS ix_site_visitors_project ON site_visitors (org_project_id, visit_date);
CREATE INDEX IF NOT EXISTS ix_site_visitors_letter ON site_visitors (linked_letter_id) WHERE linked_letter_id IS NOT NULL;
