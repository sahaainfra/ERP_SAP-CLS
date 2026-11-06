-- Part 07.05: geo-fenced mobile attendance (module hr). att_punches: one row for every punch with where it was made (as the phone said), what the server decided (fence, accuracy, clock, device) and the result;
-- a rejected punch is kept with its reason and never counts (BR-03). att_anomalies: what looks wrong and a person reviews. att_visits: a punch at a site the person is not deployed to, approved by the manager and the site's project
-- manager. att_device_bindings: which phone belongs to whom (a phone used by two people is an anomaly). att_site_settings: selfie, accuracy and tolerance per site.

CREATE TABLE IF NOT EXISTS att_punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  person_type    TEXT    NOT NULL DEFAULT 'EMPLOYEE' CHECK (person_type IN ('EMPLOYEE', 'WORKER')),
  person_id      INTEGER NOT NULL,
  punch_site_id  INTEGER NOT NULL REFERENCES org_sites (id),
  punch_type     TEXT    NOT NULL CHECK (punch_type IN ('IN', 'OUT')),
  work_date      TEXT    NOT NULL,
  device_time    TEXT    NOT NULL,
  server_time    TEXT    NOT NULL,
  effective_time TEXT    NOT NULL,
  lat            REAL    CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng            REAL    CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  accuracy_m     REAL    CHECK (accuracy_m IS NULL OR accuracy_m >= 0),
  inside_fence   INTEGER CHECK (inside_fence IS NULL OR inside_fence IN (0, 1)),
  distance_m     REAL,
  selfie_file_id INTEGER,
  method         TEXT    NOT NULL CHECK (method IN ('MOBILE', 'SUPERVISOR', 'KIOSK', 'DEVICE')),
  recorded_by    TEXT    NOT NULL,
  device_id      TEXT,
  offline        INTEGER NOT NULL DEFAULT 0 CHECK (offline IN (0, 1)),
  client_uuid    TEXT    NOT NULL,
  group_id       TEXT,
  deployment_id  INTEGER,
  visit_id       INTEGER,
  result         TEXT    NOT NULL CHECK (result IN ('ACCEPTED', 'FLAGGED', 'REJECTED', 'PENDING')),
  reason_code    TEXT,
  flags_json     TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_punches_client ON att_punches (company_id, client_uuid);
CREATE INDEX IF NOT EXISTS ix_att_punches_company_id ON att_punches (company_id);
CREATE INDEX IF NOT EXISTS ix_att_punches_person ON att_punches (person_type, person_id, effective_time);
CREATE INDEX IF NOT EXISTS ix_att_punches_site_day ON att_punches (punch_site_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_punches_day ON att_punches (company_id, work_date, result);
CREATE INDEX IF NOT EXISTS ix_att_punches_device ON att_punches (company_id, device_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_punches_group ON att_punches (group_id);
CREATE INDEX IF NOT EXISTS ix_att_punches_deployment ON att_punches (deployment_id);
CREATE INDEX IF NOT EXISTS ix_att_punches_visit ON att_punches (visit_id);
CREATE INDEX IF NOT EXISTS ix_att_punches_selfie ON att_punches (selfie_file_id);

CREATE TABLE IF NOT EXISTS att_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  punch_id       INTEGER NOT NULL REFERENCES att_punches (id),
  anomaly_type   TEXT    NOT NULL CHECK (anomaly_type IN ('OUTSIDE_FENCE', 'IMPOSSIBLE_TRAVEL', 'LOW_ACCURACY', 'REPEATED_LOW_ACCURACY', 'MOCK_LOCATION', 'SHARED_DEVICE', 'SELFIE_MISMATCH', 'NEW_DEVICE', 'CLOCK_SKEW', 'LATE_SYNC', 'NO_PRIOR_IN')),
  severity       TEXT    NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  status         TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PENDING_APPROVAL', 'ACCEPTED', 'REJECTED')),
  detail         TEXT,
  reviewed_by    TEXT,
  reviewed_at    TEXT,
  review_note    TEXT,
  band           TEXT    NOT NULL DEFAULT 'STANDARD' CHECK (band IN ('STANDARD', 'REPEATED')),
  workflow_instance_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_anomalies_punch_type ON att_anomalies (punch_id, anomaly_type);
CREATE INDEX IF NOT EXISTS ix_att_anomalies_company_id ON att_anomalies (company_id);
CREATE INDEX IF NOT EXISTS ix_att_anomalies_queue ON att_anomalies (company_id, status, severity);

CREATE TABLE IF NOT EXISTS att_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  visit_site_id  INTEGER NOT NULL REFERENCES org_sites (id),
  work_date      TEXT    NOT NULL,
  reason         TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED')),
  workflow_instance_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_visits_doc ON att_visits (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_att_visits_company_id ON att_visits (company_id);
CREATE INDEX IF NOT EXISTS ix_att_visits_employee ON att_visits (employee_id, work_date);
CREATE INDEX IF NOT EXISTS ix_att_visits_site ON att_visits (visit_site_id, work_date);

CREATE TABLE IF NOT EXISTS att_device_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  device_id      TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  first_seen_at  TEXT    NOT NULL,
  last_seen_at   TEXT    NOT NULL,
  punches        INTEGER NOT NULL DEFAULT 0,
  status         TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_device_bindings ON att_device_bindings (company_id, device_id, employee_id);
CREATE INDEX IF NOT EXISTS ix_att_device_bindings_company_id ON att_device_bindings (company_id);
CREATE INDEX IF NOT EXISTS ix_att_device_bindings_employee ON att_device_bindings (employee_id);

CREATE TABLE IF NOT EXISTS att_site_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  setting_site_id INTEGER NOT NULL REFERENCES org_sites (id),
  selfie_mode    TEXT    NOT NULL DEFAULT 'OPTIONAL' CHECK (selfie_mode IN ('NONE', 'OPTIONAL', 'REQUIRED')),
  flag_accuracy_m INTEGER CHECK (flag_accuracy_m IS NULL OR flag_accuracy_m BETWEEN 5 AND 1000),
  reject_accuracy_m INTEGER CHECK (reject_accuracy_m IS NULL OR reject_accuracy_m BETWEEN 10 AND 5000),
  tolerance_m    INTEGER CHECK (tolerance_m IS NULL OR tolerance_m BETWEEN 0 AND 100),
  kiosk_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (kiosk_enabled IN (0, 1)),
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
  UNIQUE (company_id, setting_site_id)
);
CREATE INDEX IF NOT EXISTS ix_att_site_settings_company_id ON att_site_settings (company_id);
CREATE INDEX IF NOT EXISTS ix_att_site_settings_setting_site_id ON att_site_settings (setting_site_id);
