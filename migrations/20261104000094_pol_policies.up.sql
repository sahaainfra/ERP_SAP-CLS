-- Part 05.05: company policy management and policy-to-protocol. pol_policies: the register (one row per policy). pol_versions: every version with its text, attachments, quiz and applicability; a published version is never edited (BR-01).
-- pol_acknowledgements: who has to acknowledge a version and whether they did (with the quiz). pol_requirements: clauses tagged as controllable requirements and the draft control point, approval rule or alert rule made from them.

CREATE TABLE IF NOT EXISTS pol_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  policy_no       TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  category        TEXT    NOT NULL CHECK (category IN ('HR', 'FINANCE', 'PROCUREMENT', 'HSE', 'QUALITY', 'IT', 'CONDUCT', 'OTHER')),
  owner_ref       TEXT    NOT NULL,
  department_id   INTEGER REFERENCES org_departments (id),
  applicability_json TEXT NOT NULL DEFAULT '{}',
  current_version_id INTEGER,
  policy_status   TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (policy_status IN ('DRAFT', 'PUBLISHED', 'ACTIVE', 'UNDER_REVISION', 'ARCHIVED')),
  effective_from  TEXT,
  review_due      TEXT,
  archived_at     TEXT,
  archive_reason  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pol_policy_no ON pol_policies (company_id, policy_no);
CREATE INDEX IF NOT EXISTS ix_pol_policy_list ON pol_policies (company_id, policy_status, category);
CREATE INDEX IF NOT EXISTS ix_pol_policy_owner ON pol_policies (company_id, owner_ref);
CREATE INDEX IF NOT EXISTS ix_pol_policy_department ON pol_policies (department_id);
CREATE INDEX IF NOT EXISTS ix_pol_policy_review ON pol_policies (company_id, review_due);

CREATE TABLE IF NOT EXISTS pol_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  policy_id       INTEGER NOT NULL REFERENCES pol_policies (id),
  version_no      INTEGER NOT NULL CHECK (version_no >= 1),
  body_html       TEXT    NOT NULL DEFAULT '',
  attachments_json TEXT   NOT NULL DEFAULT '[]',
  change_summary  TEXT    NOT NULL DEFAULT '',
  quiz_json       TEXT    NOT NULL DEFAULT '[]',
  pass_mark       INTEGER NOT NULL DEFAULT 100 CHECK (pass_mark BETWEEN 1 AND 100),
  applicability_json TEXT NOT NULL DEFAULT '{}',
  effective_from  TEXT,
  review_due      TEXT,
  ack_due_days    INTEGER NOT NULL DEFAULT 14 CHECK (ack_due_days BETWEEN 1 AND 365),
  version_status  TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (version_status IN ('DRAFT', 'IN_APPROVAL', 'REJECTED', 'PUBLISHED', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  instance_id     INTEGER,
  submitted_by    TEXT,
  submitted_at    TEXT,
  approved_at     TEXT,
  published_at    TEXT,
  superseded_at   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pol_version_no ON pol_versions (policy_id, version_no);
CREATE INDEX IF NOT EXISTS ix_pol_version_status ON pol_versions (company_id, version_status, effective_from);
CREATE INDEX IF NOT EXISTS ix_pol_version_company_id ON pol_versions (company_id);

CREATE TABLE IF NOT EXISTS pol_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  policy_version_id INTEGER NOT NULL REFERENCES pol_versions (id),
  user_ref        TEXT    NOT NULL,
  due_at          TEXT,
  notified_at     TEXT,
  read_at         TEXT,
  acknowledged_at TEXT,
  quiz_score      INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  reminded_at     TEXT,
  reminder_count  INTEGER NOT NULL DEFAULT 0 CHECK (reminder_count >= 0),
  escalated_at    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pol_ack_one ON pol_acknowledgements (policy_version_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_pol_ack_user ON pol_acknowledgements (company_id, user_ref, acknowledged_at);
CREATE INDEX IF NOT EXISTS ix_pol_ack_due ON pol_acknowledgements (company_id, acknowledged_at, due_at);

CREATE TABLE IF NOT EXISTS pol_requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  policy_version_id INTEGER NOT NULL REFERENCES pol_versions (id),
  clause_ref      TEXT    NOT NULL,
  requirement_text TEXT   NOT NULL,
  proposed_artifact_type TEXT NOT NULL CHECK (proposed_artifact_type IN ('CONTROL_POINT', 'APPROVAL_RULE', 'ALERT_RULE')),
  proposed_config_json TEXT NOT NULL DEFAULT '{}',
  req_status      TEXT    NOT NULL DEFAULT 'TAGGED' CHECK (req_status IN ('TAGGED', 'DRAFTED', 'DISMISSED')),
  artifact_entity TEXT,
  artifact_id     TEXT,
  artifact_label  TEXT,
  converted_by    TEXT,
  converted_at    TEXT,
  dismiss_reason  TEXT,
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
CREATE INDEX IF NOT EXISTS ix_pol_req_version ON pol_requirements (policy_version_id, req_status);
CREATE INDEX IF NOT EXISTS ix_pol_req_status ON pol_requirements (company_id, req_status);

