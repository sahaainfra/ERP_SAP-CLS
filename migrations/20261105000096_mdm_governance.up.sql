-- Part 06.01: master data governance. mdm_records / mdm_record_versions: a governed master record and every version of its data with the date it applies from (effective dating, "as of" queries).
-- mdm_change_requests: every change (new record, update, inactivation, reactivation, merge) with its justification and its workflow. mdm_duplicates: duplicate candidates and how they were resolved.
-- mdm_merge_map: where a merged record now points (the merged record is never deleted). mdm_quality_rules / mdm_stewards: the data-quality rules and the stewards of each master, versioned, changed only by an approved change.

CREATE TABLE IF NOT EXISTS mdm_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  master_type     TEXT    NOT NULL,
  record_code     TEXT    NOT NULL,
  display_name    TEXT    NOT NULL,
  record_status   TEXT    NOT NULL DEFAULT 'SUBMITTED' CHECK (record_status IN ('SUBMITTED', 'ACTIVE', 'INACTIVE', 'MERGED', 'REJECTED')),
  current_version_id INTEGER,
  merged_into_id  INTEGER REFERENCES mdm_records (id),
  dq_score        INTEGER NOT NULL DEFAULT 0 CHECK (dq_score BETWEEN 0 AND 100),
  last_changed_at TEXT,
  last_reviewed_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_record_code ON mdm_records (company_id, master_type, record_code);
CREATE INDEX IF NOT EXISTS ix_mdm_record_list ON mdm_records (company_id, master_type, record_status);
CREATE INDEX IF NOT EXISTS ix_mdm_record_name ON mdm_records (company_id, master_type, display_name);
CREATE INDEX IF NOT EXISTS ix_mdm_record_merged ON mdm_records (merged_into_id);

CREATE TABLE IF NOT EXISTS mdm_change_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  master_type     TEXT    NOT NULL,
  record_id       INTEGER REFERENCES mdm_records (id),
  change_type     TEXT    NOT NULL CHECK (change_type IN ('CREATE', 'UPDATE', 'INACTIVATE', 'REACTIVATE', 'MERGE')),
  change_json     TEXT    NOT NULL DEFAULT '{}',
  before_json     TEXT    NOT NULL DEFAULT '{}',
  justification   TEXT    NOT NULL,
  effective_from  TEXT,
  sensitive       INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
  duplicates_json TEXT    NOT NULL DEFAULT '[]',
  request_status  TEXT    NOT NULL DEFAULT 'PENDING' CHECK (request_status IN ('PENDING', 'RETURNED', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  decided_by      TEXT,
  decided_at      TEXT,
  applied_at      TEXT,
  target_id       INTEGER REFERENCES mdm_records (id),
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
CREATE INDEX IF NOT EXISTS ix_mdm_cr_list ON mdm_change_requests (company_id, master_type, request_status);
CREATE INDEX IF NOT EXISTS ix_mdm_cr_record ON mdm_change_requests (record_id);
CREATE INDEX IF NOT EXISTS ix_mdm_cr_target ON mdm_change_requests (target_id);
CREATE INDEX IF NOT EXISTS ix_mdm_cr_requester ON mdm_change_requests (company_id, requested_by);

CREATE TABLE IF NOT EXISTS mdm_record_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  record_id       INTEGER NOT NULL REFERENCES mdm_records (id),
  version_no      INTEGER NOT NULL CHECK (version_no >= 1),
  data_json       TEXT    NOT NULL,
  effective_from  TEXT    NOT NULL,
  version_status  TEXT    NOT NULL DEFAULT 'PENDING' CHECK (version_status IN ('PENDING', 'SCHEDULED', 'ACTIVE', 'SUPERSEDED', 'REJECTED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
  record_status_after TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (record_status_after IN ('ACTIVE', 'INACTIVE')),
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
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_version_no ON mdm_record_versions (record_id, version_no);
CREATE INDEX IF NOT EXISTS ix_mdm_version_asof ON mdm_record_versions (record_id, version_status, effective_from);
CREATE INDEX IF NOT EXISTS ix_mdm_version_cr ON mdm_record_versions (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_version_due ON mdm_record_versions (company_id, version_status, effective_from);

CREATE TABLE IF NOT EXISTS mdm_duplicates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  master_type     TEXT    NOT NULL,
  record_a        INTEGER NOT NULL REFERENCES mdm_records (id),
  record_b        INTEGER NOT NULL REFERENCES mdm_records (id),
  score           INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  match_rule      TEXT    NOT NULL,
  duplicate_status TEXT   NOT NULL DEFAULT 'OPEN' CHECK (duplicate_status IN ('OPEN', 'NOT_DUPLICATE', 'MERGE_PENDING', 'MERGED')),
  resolution      TEXT,
  resolved_by     TEXT,
  resolved_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_dup_pair ON mdm_duplicates (company_id, master_type, record_a, record_b);
CREATE INDEX IF NOT EXISTS ix_mdm_dup_status ON mdm_duplicates (company_id, master_type, duplicate_status);
CREATE INDEX IF NOT EXISTS ix_mdm_dup_a ON mdm_duplicates (record_a);
CREATE INDEX IF NOT EXISTS ix_mdm_dup_b ON mdm_duplicates (record_b);

CREATE TABLE IF NOT EXISTS mdm_merge_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  master_type     TEXT    NOT NULL,
  from_id         INTEGER NOT NULL REFERENCES mdm_records (id),
  to_id           INTEGER NOT NULL REFERENCES mdm_records (id),
  merged_at       TEXT    NOT NULL,
  merged_by       TEXT    NOT NULL,
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_merge_from ON mdm_merge_map (from_id);
CREATE INDEX IF NOT EXISTS ix_mdm_merge_to ON mdm_merge_map (to_id);
CREATE INDEX IF NOT EXISTS ix_mdm_merge_cr ON mdm_merge_map (change_request_id);
CREATE INDEX IF NOT EXISTS ix_mdm_merge_company_id ON mdm_merge_map (company_id);

CREATE TABLE IF NOT EXISTS mdm_quality_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  config_version  INTEGER NOT NULL,
  master_type     TEXT    NOT NULL,
  field           TEXT    NOT NULL,
  rule            TEXT    NOT NULL CHECK (rule IN ('REQUIRED', 'FORMAT', 'STALE')),
  param           TEXT,
  severity        TEXT    NOT NULL DEFAULT 'ERROR' CHECK (severity IN ('ERROR', 'WARNING', 'INFO')),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  config_status   TEXT    NOT NULL DEFAULT 'PENDING' CHECK (config_status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  instance_id     INTEGER,
  reason          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mdm_rules_status ON mdm_quality_rules (company_id, config_status, master_type);
CREATE INDEX IF NOT EXISTS ix_mdm_rules_version ON mdm_quality_rules (company_id, config_version);

CREATE TABLE IF NOT EXISTS mdm_stewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  config_version  INTEGER NOT NULL,
  master_type     TEXT    NOT NULL,
  user_id         INTEGER NOT NULL REFERENCES iam_users (id),
  user_ref        TEXT    NOT NULL,
  steward_role    TEXT    NOT NULL DEFAULT 'PRIMARY' CHECK (steward_role IN ('PRIMARY', 'BACKUP')),
  config_status   TEXT    NOT NULL DEFAULT 'PENDING' CHECK (config_status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  instance_id     INTEGER,
  reason          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mdm_stewards_status ON mdm_stewards (company_id, config_status, master_type);
CREATE INDEX IF NOT EXISTS ix_mdm_stewards_user ON mdm_stewards (user_id);
CREATE INDEX IF NOT EXISTS ix_mdm_stewards_version ON mdm_stewards (company_id, config_version);

