-- Part 10.01: the project master, its lifecycle and key dates (module proj, tables proj_*). Money in paise (x 100), percentages x 10 000, as in the other parts.
-- proj_projects: the 1:1 extension of org_projects (02.02) with the client, consultant and funding agency from the partner master, the contract summary, the key dates, the lifecycle state, the settings and the approval of its activation.
-- proj_milestones: the register of key dates and contractual milestones (payment links come with billing). proj_lifecycle_log: every move of the lifecycle with its checklist, and the requests for the moves that need approval.
CREATE TABLE IF NOT EXISTS proj_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  lifecycle_state TEXT    NOT NULL DEFAULT 'SETUP' CHECK (lifecycle_state IN ('SETUP', 'MOBILISATION', 'EXECUTION', 'SUSPENDED', 'SUBSTANTIALLY_COMPLETE', 'DLP', 'CLOSED', 'ARCHIVED')),
  sector          TEXT,
  location        TEXT,
  client_partner_id     INTEGER REFERENCES mdm_partners (id),
  consultant_partner_id INTEGER REFERENCES mdm_partners (id),
  funder_partner_id     INTEGER REFERENCES mdm_partners (id),
  tender_id       INTEGER REFERENCES tdr_tenders (id),
  contract_type   TEXT    NOT NULL DEFAULT 'ITEM_RATE' CHECK (contract_type IN ('ITEM_RATE', 'LUMP_SUM', 'EPC', 'HAM', 'COST_PLUS')),
  contract_no     TEXT,
  contract_value  INTEGER NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  start_date      TEXT,
  scheduled_completion TEXT,
  revised_completion   TEXT,
  dlp_months      INTEGER NOT NULL DEFAULT 0 CHECK (dlp_months >= 0 AND dlp_months <= 120),
  retention_pct   INTEGER NOT NULL DEFAULT 0 CHECK (retention_pct >= 0 AND retention_pct <= 1000000),
  mob_advance_pct INTEGER NOT NULL DEFAULT 0 CHECK (mob_advance_pct >= 0 AND mob_advance_pct <= 1000000),
  ld_summary      TEXT,
  pm_user         TEXT,
  director_user   TEXT,
  settings_json   TEXT,
  setup_json      TEXT,
  pending_json    TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  activated_at    TEXT,
  activated_by    TEXT,
  closed_at       TEXT,
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
  CHECK (scheduled_completion IS NULL OR start_date IS NULL OR scheduled_completion >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_projects_project ON proj_projects (project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proj_projects_company_id ON proj_projects (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_projects_status ON proj_projects (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proj_projects_state ON proj_projects (company_id, lifecycle_state);
CREATE INDEX IF NOT EXISTS ix_proj_projects_client ON proj_projects (client_partner_id);
CREATE INDEX IF NOT EXISTS ix_proj_projects_consultant ON proj_projects (consultant_partner_id);
CREATE INDEX IF NOT EXISTS ix_proj_projects_funder ON proj_projects (funder_partner_id);
CREATE INDEX IF NOT EXISTS ix_proj_projects_tender ON proj_projects (tender_id);
CREATE TABLE IF NOT EXISTS proj_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  planned_date    TEXT    NOT NULL,
  actual_date     TEXT,
  contractual     INTEGER NOT NULL DEFAULT 0 CHECK (contractual IN (0, 1)),
  payment_linked  INTEGER NOT NULL DEFAULT 0 CHECK (payment_linked IN (0, 1)),
  milestone_status TEXT   NOT NULL DEFAULT 'PLANNED' CHECK (milestone_status IN ('PLANNED', 'ACHIEVED', 'WAIVED')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_milestones_code ON proj_milestones (project_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proj_milestones_company_id ON proj_milestones (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_milestones_project ON proj_milestones (project_id, planned_date);
CREATE TABLE IF NOT EXISTS proj_lifecycle_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  kind            TEXT    NOT NULL DEFAULT 'TRANSITION' CHECK (kind IN ('ACTIVATION', 'TRANSITION', 'AMENDMENT')),
  from_state      TEXT,
  to_state        TEXT,
  log_status      TEXT    NOT NULL DEFAULT 'EFFECTIVE' CHECK (log_status IN ('REQUESTED', 'EFFECTIVE', 'RETURNED', 'REJECTED', 'CANCELLED')),
  checklist_json  TEXT,
  warnings_json   TEXT,
  changes_json    TEXT,
  reason          TEXT,
  workflow_instance_id INTEGER,
  by_user         TEXT    NOT NULL,
  decided_at      TEXT,
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
CREATE INDEX IF NOT EXISTS ix_proj_lifecycle_log_company_id ON proj_lifecycle_log (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_lifecycle_log_project ON proj_lifecycle_log (project_id, id);
CREATE INDEX IF NOT EXISTS ix_proj_lifecycle_log_status ON proj_lifecycle_log (company_id, log_status);
