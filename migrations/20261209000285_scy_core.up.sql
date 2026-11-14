-- Part 19.06: security posts, checkpoints and patrol scans, guard rosters, visitors, security incidents and the shift handover log. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS scy_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  post_type       TEXT    NOT NULL DEFAULT 'GATE' CHECK (post_type IN ('GATE', 'PERIMETER', 'STORE', 'OFFICE', 'OTHER')),
  required_guards INTEGER NOT NULL DEFAULT 1 CHECK (required_guards BETWEEN 1 AND 50),
  agency_id       INTEGER REFERENCES mdm_partners (id),
  post_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (post_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_scy_post_code ON scy_posts (company_id, code);
CREATE INDEX IF NOT EXISTS ix_scy_post_site ON scy_posts (org_site_id, post_status);
CREATE INDEX IF NOT EXISTS ix_scy_post_project ON scy_posts (org_project_id);
CREATE INDEX IF NOT EXISTS ix_scy_post_agency ON scy_posts (agency_id);
CREATE TABLE IF NOT EXISTS scy_checkpoints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  post_id         INTEGER REFERENCES scy_posts (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  qr_token        TEXT    NOT NULL,
  lat             REAL,
  lng             REAL,
  interval_min    INTEGER NOT NULL DEFAULT 120 CHECK (interval_min BETWEEN 10 AND 1440),
  active_from     TEXT    NOT NULL DEFAULT '00:00',
  active_to       TEXT    NOT NULL DEFAULT '23:59',
  last_alert_slot TEXT,
  cp_status       TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (cp_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_scy_cp_code ON scy_checkpoints (company_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_scy_cp_token ON scy_checkpoints (qr_token);
CREATE INDEX IF NOT EXISTS ix_scy_cp_site ON scy_checkpoints (org_site_id, cp_status);
CREATE INDEX IF NOT EXISTS ix_scy_cp_post ON scy_checkpoints (post_id);
CREATE TABLE IF NOT EXISTS scy_patrol_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  checkpoint_id   INTEGER NOT NULL REFERENCES scy_checkpoints (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  guard_id        INTEGER NOT NULL REFERENCES lab_workers (id),
  scanned_at      TEXT    NOT NULL,
  lat             REAL,
  lng             REAL,
  distance_m      INTEGER,
  off_site        INTEGER NOT NULL DEFAULT 0 CHECK (off_site IN (0, 1)),
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
CREATE INDEX IF NOT EXISTS ix_scy_ps_cp ON scy_patrol_scans (checkpoint_id, scanned_at);
CREATE INDEX IF NOT EXISTS ix_scy_ps_site ON scy_patrol_scans (org_site_id, scanned_at);
CREATE INDEX IF NOT EXISTS ix_scy_ps_guard ON scy_patrol_scans (guard_id, scanned_at);
CREATE TABLE IF NOT EXISTS scy_rosters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  period          TEXT    NOT NULL,
  assignments_json TEXT   NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_scy_ro_doc ON scy_rosters (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_scy_ro_site ON scy_rosters (org_site_id, period, status);
CREATE INDEX IF NOT EXISTS ix_scy_ro_project ON scy_rosters (org_project_id);
CREATE TABLE IF NOT EXISTS scy_visitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  visitor_name    TEXT    NOT NULL,
  phone           TEXT,
  organisation    TEXT,
  id_type         TEXT,
  id_ref_masked   TEXT,
  host_user       TEXT    NOT NULL,
  purpose         TEXT    NOT NULL,
  expected_on     TEXT    NOT NULL,
  vehicle_no      TEXT,
  photo_file_id   INTEGER,
  badge_token     TEXT    NOT NULL,
  pre_registered  INTEGER NOT NULL DEFAULT 0 CHECK (pre_registered IN (0, 1)),
  safety_briefed  INTEGER NOT NULL DEFAULT 0 CHECK (safety_briefed IN (0, 1)),
  decided_by      TEXT,
  decided_at      TEXT,
  decline_reason  TEXT,
  check_in        TEXT,
  check_out       TEXT,
  checked_in_by   TEXT,
  overstay_alerted INTEGER NOT NULL DEFAULT 0 CHECK (overstay_alerted IN (0, 1)),
  visit_status    TEXT    NOT NULL DEFAULT 'AWAITING_HOST' CHECK (visit_status IN ('AWAITING_HOST', 'APPROVED', 'DECLINED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW')),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_scy_vi_doc ON scy_visitors (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_scy_vi_badge ON scy_visitors (badge_token);
CREATE INDEX IF NOT EXISTS ix_scy_vi_site ON scy_visitors (org_site_id, visit_status, expected_on);
CREATE INDEX IF NOT EXISTS ix_scy_vi_host ON scy_visitors (company_id, host_user, visit_status);
CREATE INDEX IF NOT EXISTS ix_scy_vi_project ON scy_visitors (org_project_id);
CREATE TABLE IF NOT EXISTS scy_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  post_id         INTEGER REFERENCES scy_posts (id),
  incident_type   TEXT    NOT NULL CHECK (incident_type IN ('THEFT', 'TRESPASS', 'DAMAGE', 'FIRE_ALARM', 'ALTERCATION', 'OTHER')),
  occurred_at     TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  action_taken    TEXT,
  investigation   TEXT,
  loss_estimate   INTEGER NOT NULL DEFAULT 0 CHECK (loss_estimate >= 0),
  reported_by     TEXT    NOT NULL,
  photo_file_ids  TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_scy_in_doc ON scy_incidents (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_scy_in_site ON scy_incidents (org_site_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_scy_in_project ON scy_incidents (org_project_id, incident_type);
CREATE INDEX IF NOT EXISTS ix_scy_in_post ON scy_incidents (post_id);
CREATE TABLE IF NOT EXISTS scy_handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  post_id         INTEGER NOT NULL REFERENCES scy_posts (id),
  shift_date      TEXT    NOT NULL,
  shift           TEXT    NOT NULL CHECK (shift IN ('DAY', 'NIGHT')),
  from_guard_id   INTEGER NOT NULL REFERENCES lab_workers (id),
  to_guard_id     INTEGER REFERENCES lab_workers (id),
  notes           TEXT,
  items_json      TEXT    NOT NULL DEFAULT '[]',
  acknowledged_by TEXT,
  acknowledged_at TEXT,
  logged_by       TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_scy_ho_site ON scy_handovers (org_site_id, shift_date);
CREATE INDEX IF NOT EXISTS ix_scy_ho_post ON scy_handovers (post_id, shift_date);
CREATE INDEX IF NOT EXISTS ix_scy_ho_from ON scy_handovers (from_guard_id);
CREATE INDEX IF NOT EXISTS ix_scy_ho_to ON scy_handovers (to_guard_id);
CREATE INDEX IF NOT EXISTS ix_scy_handovers_company_id ON scy_handovers (company_id);
CREATE INDEX IF NOT EXISTS ix_scy_patrol_scans_company_id ON scy_patrol_scans (company_id);
