-- Part 15.08: vendor prequalification, the approved vendor list (AVL), suspensions, scorecards and performance actions (module proc, tables vnd_*).
-- Scores are percentages x 10000 (100 percent = 1000000), so a stored scorecard can be worked out again from its evidence.

CREATE TABLE IF NOT EXISTS vnd_prequalifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  category_ids_json TEXT  NOT NULL DEFAULT '[]',
  regions_json    TEXT    NOT NULL DEFAULT '[]',
  strategic       INTEGER NOT NULL DEFAULT 0 CHECK (strategic IN (0, 1)),
  questionnaire_json TEXT NOT NULL DEFAULT '[]',
  score           INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000000),
  visit_date      TEXT,
  visit_notes     TEXT,
  visit_report_file_id INTEGER,
  result          TEXT    NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'QUALIFIED', 'CONDITIONAL', 'NOT_QUALIFIED')),
  valid_until     TEXT,
  conditions      TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 0 CHECK (revision_no >= 0),
  parent_id       INTEGER REFERENCES vnd_prequalifications (id),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_vnd_preq_doc ON vnd_prequalifications (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_vnd_preq_list ON vnd_prequalifications (company_id, status);
CREATE INDEX IF NOT EXISTS ix_vnd_preq_partner ON vnd_prequalifications (partner_id, status);
CREATE INDEX IF NOT EXISTS ix_vnd_preq_parent ON vnd_prequalifications (parent_id);

CREATE TABLE IF NOT EXISTS vnd_avl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  category_id     INTEGER NOT NULL REFERENCES mdm_item_categories (id),
  region_code     TEXT    NOT NULL DEFAULT 'ALL',
  avl_status      TEXT    NOT NULL DEFAULT 'APPROVED' CHECK (avl_status IN ('APPROVED', 'CONDITIONAL', 'SUSPENDED')),
  valid_from      TEXT    NOT NULL,
  valid_until     TEXT,
  prequal_id      INTEGER REFERENCES vnd_prequalifications (id),
  conditions      TEXT,
  suspended_reason TEXT,
  suspended_on    TEXT,
  reminded_for    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_vnd_avl_key ON vnd_avl (company_id, partner_id, category_id, region_code);
CREATE INDEX IF NOT EXISTS ix_vnd_avl_list ON vnd_avl (company_id, avl_status, valid_until);
CREATE INDEX IF NOT EXISTS ix_vnd_avl_category ON vnd_avl (category_id, avl_status);
CREATE INDEX IF NOT EXISTS ix_vnd_avl_prequal ON vnd_avl (prequal_id);
CREATE INDEX IF NOT EXISTS ix_vnd_avl_partner ON vnd_avl (partner_id);

CREATE TABLE IF NOT EXISTS vnd_scorecards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  period          TEXT    NOT NULL,
  period_from     TEXT    NOT NULL,
  period_to       TEXT    NOT NULL,
  on_time_pct     INTEGER CHECK (on_time_pct IS NULL OR on_time_pct BETWEEN 0 AND 1000000),
  quality_pct     INTEGER CHECK (quality_pct IS NULL OR quality_pct BETWEEN 0 AND 1000000),
  price_score     INTEGER CHECK (price_score IS NULL OR price_score BETWEEN 0 AND 1000000),
  responsiveness  INTEGER CHECK (responsiveness IS NULL OR responsiveness BETWEEN 0 AND 1000000),
  safety_score    INTEGER CHECK (safety_score IS NULL OR safety_score BETWEEN 0 AND 1000000),
  invoice_accuracy INTEGER CHECK (invoice_accuracy IS NULL OR invoice_accuracy BETWEEN 0 AND 1000000),
  weights_json    TEXT    NOT NULL DEFAULT '{}',
  evidence_json   TEXT    NOT NULL DEFAULT '{}',
  total_score     INTEGER CHECK (total_score IS NULL OR total_score BETWEEN 0 AND 1000000),
  rating          TEXT    NOT NULL DEFAULT 'NA' CHECK (rating IN ('A', 'B', 'C', 'D', 'NA')),
  computed_at     TEXT    NOT NULL,
  computed_by     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_vnd_score_key ON vnd_scorecards (company_id, partner_id, period);
CREATE INDEX IF NOT EXISTS ix_vnd_score_list ON vnd_scorecards (company_id, period, rating);
CREATE INDEX IF NOT EXISTS ix_vnd_score_partner ON vnd_scorecards (partner_id, period_to);

CREATE TABLE IF NOT EXISTS vnd_score_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  period          TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('SAFETY', 'INVOICE_ACCURACY', 'QUALITY')),
  value_pct       INTEGER NOT NULL CHECK (value_pct BETWEEN 0 AND 1000000),
  note            TEXT,
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
CREATE INDEX IF NOT EXISTS ix_vnd_input_key ON vnd_score_inputs (company_id, partner_id, period, kind);
CREATE INDEX IF NOT EXISTS ix_vnd_input_partner ON vnd_score_inputs (partner_id);

CREATE TABLE IF NOT EXISTS vnd_suspensions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  avl_ids_json    TEXT    NOT NULL DEFAULT '[]',
  reason          TEXT    NOT NULL,
  auto_suggested  INTEGER NOT NULL DEFAULT 0 CHECK (auto_suggested IN (0, 1)),
  scorecard_id    INTEGER REFERENCES vnd_scorecards (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_vnd_susp_doc ON vnd_suspensions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_vnd_susp_list ON vnd_suspensions (company_id, status);
CREATE INDEX IF NOT EXISTS ix_vnd_susp_partner ON vnd_suspensions (partner_id, status);
CREATE INDEX IF NOT EXISTS ix_vnd_susp_score ON vnd_suspensions (scorecard_id);

CREATE TABLE IF NOT EXISTS vnd_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  scorecard_id    INTEGER REFERENCES vnd_scorecards (id),
  kind            TEXT    NOT NULL CHECK (kind IN ('REVIEW', 'CAR', 'DEVELOPMENT')),
  title           TEXT    NOT NULL,
  detail          TEXT,
  owner_user      TEXT,
  due_date        TEXT,
  action_status   TEXT    NOT NULL DEFAULT 'OPEN' CHECK (action_status IN ('OPEN', 'RESPONDED', 'CLOSED', 'CANCELLED')),
  response        TEXT,
  closed_by       TEXT,
  closed_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_vnd_action_doc ON vnd_actions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_vnd_action_list ON vnd_actions (company_id, action_status);
CREATE INDEX IF NOT EXISTS ix_vnd_action_partner ON vnd_actions (partner_id, action_status);
CREATE INDEX IF NOT EXISTS ix_vnd_action_score ON vnd_actions (scorecard_id);
