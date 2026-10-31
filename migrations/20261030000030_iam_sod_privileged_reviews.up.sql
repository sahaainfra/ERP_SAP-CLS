-- Segregation of duties, privileged access and access reviews (part 02.05). SoD rules and the violations found against them, a ledger of
-- who did what to which document (for transaction-time checks), time-boxed elevations and their request log, and access review
-- campaigns with their reviewers' lists and decisions. The ledger and the elevation log are technical tables; the rest carry the
-- standard columns. Nothing existing is altered.

CREATE TABLE IF NOT EXISTS iam_sod_rules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  kind           TEXT    NOT NULL CHECK (kind IN ('PERMISSION', 'ACTION')),
  set_a_json     TEXT    NOT NULL DEFAULT '[]',
  set_b_json     TEXT    NOT NULL DEFAULT '[]',
  scope          TEXT    NOT NULL DEFAULT 'USER' CHECK (scope IN ('USER', 'DOCUMENT', 'VENDOR', 'PERIOD', 'PROJECT')),
  severity       TEXT    NOT NULL DEFAULT 'BLOCK' CHECK (severity IN ('BLOCK', 'WARN', 'DETECT')),
  conditions_json TEXT   NOT NULL DEFAULT '{}',
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  catalogue_ref  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_sod_rules_code ON iam_sod_rules (company_id, code);

CREATE TABLE IF NOT EXISTS iam_sod_violations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  rule_id       INTEGER NOT NULL REFERENCES iam_sod_rules (id),
  user_id       INTEGER REFERENCES iam_users (id),
  user_ref      TEXT    NOT NULL,
  source        TEXT    NOT NULL CHECK (source IN ('ASSIGNMENT', 'TRANSACTION', 'ELEVATION')),
  outcome       TEXT    NOT NULL CHECK (outcome IN ('STANDING', 'BLOCKED', 'WARNED', 'DETECTED')),
  severity      TEXT    NOT NULL CHECK (severity IN ('BLOCK', 'WARN', 'DETECT')),
  document_type TEXT,
  document_id   TEXT,
  detail_json   TEXT    NOT NULL DEFAULT '{}',
  detected_at   TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED', 'ACCEPTED', 'BLOCKED')),
  resolved_at   TEXT,
  resolved_by   TEXT,
  resolution    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_sod_violations_standing ON iam_sod_violations (rule_id, user_id) WHERE source = 'ASSIGNMENT' AND status = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_iam_sod_violations_company ON iam_sod_violations (company_id, status, detected_at);
CREATE INDEX IF NOT EXISTS ix_iam_sod_violations_rule ON iam_sod_violations (rule_id, status);
CREATE INDEX IF NOT EXISTS ix_iam_sod_violations_user ON iam_sod_violations (user_id);

-- Who did what to which document, for the transaction-time checks (technical table).
CREATE TABLE IF NOT EXISTS iam_sod_actions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  user_ref      TEXT    NOT NULL,
  action_key    TEXT    NOT NULL,
  subject_type  TEXT    NOT NULL,
  subject_id    TEXT    NOT NULL,
  project_id    INTEGER,
  period        TEXT,
  vendor_ref    TEXT,
  amount_paise  INTEGER,
  at            TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_iam_sod_actions_subject ON iam_sod_actions (company_id, subject_type, subject_id);
CREATE INDEX IF NOT EXISTS ix_iam_sod_actions_user ON iam_sod_actions (company_id, user_ref, action_key);

CREATE TABLE IF NOT EXISTS iam_elevations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  user_id         INTEGER NOT NULL REFERENCES iam_users (id),
  role_id         INTEGER NOT NULL REFERENCES iam_roles (id),
  scope_type      TEXT    NOT NULL DEFAULT 'COMPANY' CHECK (scope_type IN ('COMPANY', 'BRANCH', 'DEPARTMENT', 'PROJECT', 'SITE', 'OWN')),
  scope_ids_json  TEXT    NOT NULL DEFAULT '[]',
  reason          TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'ACTIVE', 'REJECTED', 'CANCELLED', 'EXPIRED', 'REVOKED')),
  requested_hours INTEGER NOT NULL CHECK (requested_hours >= 1),
  requested_start TEXT,
  financial       INTEGER NOT NULL DEFAULT 0 CHECK (financial IN (0, 1)),
  approved_by     TEXT,
  starts_at       TEXT,
  ends_at         TEXT,
  revoked_at      TEXT,
  revoked_by      TEXT,
  revoke_reason   TEXT,
  request_id      INTEGER REFERENCES core_change_requests (id),
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
  remarks       TEXT,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS ix_iam_elevations_user ON iam_elevations (user_id, status);
CREATE INDEX IF NOT EXISTS ix_iam_elevations_role ON iam_elevations (role_id);
CREATE INDEX IF NOT EXISTS ix_iam_elevations_request ON iam_elevations (request_id);
CREATE INDEX IF NOT EXISTS ix_iam_elevations_company ON iam_elevations (company_id, status, ends_at);

-- Every request made while elevated (technical table).
CREATE TABLE IF NOT EXISTS iam_elevation_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  elevation_id   INTEGER NOT NULL REFERENCES iam_elevations (id),
  user_id        INTEGER NOT NULL,
  at             TEXT    NOT NULL,
  method         TEXT    NOT NULL,
  route          TEXT    NOT NULL,
  status         INTEGER NOT NULL,
  correlation_id TEXT,
  duration_ms    INTEGER
);
CREATE INDEX IF NOT EXISTS ix_iam_elevation_log_elevation ON iam_elevation_log (elevation_id, id);

CREATE TABLE IF NOT EXISTS iam_access_campaigns (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  campaign_code TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  scope         TEXT    NOT NULL CHECK (scope IN ('PRIVILEGED', 'DEPARTMENT', 'ALL')),
  department_id INTEGER REFERENCES org_departments (id),
  due_date      TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
  closed_at     TEXT,
  closed_by     TEXT,
  summary_json  TEXT    NOT NULL DEFAULT '{}',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_access_campaigns_code ON iam_access_campaigns (company_id, campaign_code);
CREATE INDEX IF NOT EXISTS ix_iam_access_campaigns_department ON iam_access_campaigns (department_id);

CREATE TABLE IF NOT EXISTS iam_access_reviews (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  campaign_id   INTEGER NOT NULL REFERENCES iam_access_campaigns (id),
  campaign_code TEXT    NOT NULL,
  scope         TEXT    NOT NULL,
  reviewer_id   INTEGER NOT NULL REFERENCES iam_users (id),
  status        TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'CANCELLED')),
  due_date      TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_access_reviews_reviewer ON iam_access_reviews (campaign_id, reviewer_id);
CREATE INDEX IF NOT EXISTS ix_iam_access_reviews_reviewer ON iam_access_reviews (reviewer_id, status);
CREATE INDEX IF NOT EXISTS ix_iam_access_reviews_company_id ON iam_access_reviews (company_id);

CREATE TABLE IF NOT EXISTS iam_access_review_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  review_id     INTEGER NOT NULL REFERENCES iam_access_reviews (id),
  assignment_id INTEGER REFERENCES iam_assignments (id),
  user_id       INTEGER NOT NULL REFERENCES iam_users (id),
  source        TEXT    NOT NULL CHECK (source IN ('ASSIGNMENT', 'ROLE_LIST')),
  role_code     TEXT    NOT NULL,
  role_name     TEXT    NOT NULL DEFAULT '',
  scope_text    TEXT    NOT NULL DEFAULT '',
  privileged    INTEGER NOT NULL DEFAULT 0 CHECK (privileged IN (0, 1)),
  last_login_at TEXT,
  decision      TEXT    NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING', 'CERTIFY', 'REVOKE')),
  comment       TEXT,
  decided_at    TEXT,
  decided_by    TEXT,
  applied_at    TEXT,
  applied_note  TEXT,
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
CREATE INDEX IF NOT EXISTS ix_iam_access_review_items_company_id ON iam_access_review_items (company_id);
CREATE INDEX IF NOT EXISTS ix_iam_access_review_items_review ON iam_access_review_items (review_id, decision);
CREATE INDEX IF NOT EXISTS ix_iam_access_review_items_assignment ON iam_access_review_items (assignment_id);
CREATE INDEX IF NOT EXISTS ix_iam_access_review_items_user ON iam_access_review_items (user_id);
