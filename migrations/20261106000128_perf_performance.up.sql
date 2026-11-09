-- Part 07.11: performance management, role KPIs and appraisals (module hr).
-- perf_cycles: the appraisal cycles. perf_kpis: the KPI library (a formula reference into the metrics the system can compute, weight, target, direction, effective dates; a change is activated by a second person).
-- perf_kpi_values: the computed value of a KPI for an employee and a month, with the evidence that reproduces it. perf_kpi_disputes: an employee disputes a value; it is frozen until resolved.
-- perf_goals: goals agreed with the manager. perf_feedback: feedback, recognition and one-to-one notes. perf_reviews: the review of an employee in a cycle (self, manager, calibration, final rating, development plan), approved by workflow.

CREATE TABLE IF NOT EXISTS perf_cycles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  kind           TEXT    NOT NULL DEFAULT 'ANNUAL' CHECK (kind IN ('ANNUAL', 'HALF_YEARLY', 'QUARTERLY')),
  start_date     TEXT    NOT NULL,
  end_date       TEXT    NOT NULL,
  self_due       TEXT,
  senior_from_level INTEGER NOT NULL DEFAULT 7 CHECK (senior_from_level BETWEEN 1 AND 20),
  cycle_status   TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (cycle_status IN ('DRAFT', 'OPEN', 'CLOSED')),
  opened_at      TEXT,
  closed_at      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_perf_cycles_code ON perf_cycles (company_id, code);
CREATE INDEX IF NOT EXISTS ix_perf_cycles_company_id ON perf_cycles (company_id);
CREATE INDEX IF NOT EXISTS ix_perf_cycles_status ON perf_cycles (company_id, cycle_status);
CREATE INDEX IF NOT EXISTS ix_perf_cycles_project ON perf_cycles (project_id);
CREATE INDEX IF NOT EXISTS ix_perf_cycles_site ON perf_cycles (site_id);

CREATE TABLE IF NOT EXISTS perf_kpis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code           TEXT    NOT NULL COLLATE NOCASE,
  name           TEXT    NOT NULL,
  name_hi        TEXT,
  applies_to_json TEXT   NOT NULL DEFAULT '{}',
  formula_ref    TEXT    NOT NULL,
  unit           TEXT    NOT NULL DEFAULT 'PERCENT' CHECK (unit IN ('PERCENT', 'COUNT', 'DAYS')),
  direction      TEXT    NOT NULL DEFAULT 'HIGHER' CHECK (direction IN ('HIGHER', 'LOWER')),
  target_value   REAL    NOT NULL CHECK (target_value >= 0),
  weight         INTEGER NOT NULL DEFAULT 10 CHECK (weight BETWEEN 1 AND 100),
  effective_from TEXT    NOT NULL,
  effective_to   TEXT,
  kpi_status     TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (kpi_status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  activated_by   TEXT,
  activated_at   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_perf_kpis_code ON perf_kpis (company_id, code);
CREATE INDEX IF NOT EXISTS ix_perf_kpis_company_id ON perf_kpis (company_id);
CREATE INDEX IF NOT EXISTS ix_perf_kpis_status ON perf_kpis (company_id, kpi_status);
CREATE INDEX IF NOT EXISTS ix_perf_kpis_project ON perf_kpis (project_id);
CREATE INDEX IF NOT EXISTS ix_perf_kpis_site ON perf_kpis (site_id);

CREATE TABLE IF NOT EXISTS perf_kpi_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  kpi_code       TEXT    NOT NULL COLLATE NOCASE,
  period         TEXT    NOT NULL,
  as_of          TEXT    NOT NULL,
  value          REAL,
  target_value   REAL    NOT NULL,
  score          INTEGER CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  sample_size    INTEGER NOT NULL DEFAULT 0,
  excluded_days  INTEGER NOT NULL DEFAULT 0,
  evidence_json  TEXT    NOT NULL DEFAULT '{}',
  value_status   TEXT    NOT NULL DEFAULT 'COMPUTED' CHECK (value_status IN ('COMPUTED', 'NO_DATA', 'DISPUTED', 'ADJUSTED')),
  adjusted_by    TEXT,
  adjust_reason  TEXT,
  computed_at    TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_perf_kpi_values_key ON perf_kpi_values (company_id, employee_id, kpi_code, period);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_values_company_id ON perf_kpi_values (company_id);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_values_employee ON perf_kpi_values (employee_id, period);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_values_status ON perf_kpi_values (company_id, value_status);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_values_project ON perf_kpi_values (project_id);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_values_site ON perf_kpi_values (site_id);

CREATE TABLE IF NOT EXISTS perf_kpi_disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  kpi_value_id   INTEGER NOT NULL REFERENCES perf_kpi_values (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  reason         TEXT    NOT NULL,
  dispute_status TEXT    NOT NULL DEFAULT 'OPEN' CHECK (dispute_status IN ('OPEN', 'UPHELD', 'REJECTED')),
  resolution     TEXT,
  adjusted_value REAL,
  resolved_by    TEXT,
  resolved_at    TEXT,
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
CREATE INDEX IF NOT EXISTS ix_perf_kpi_disputes_company_id ON perf_kpi_disputes (company_id);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_disputes_value ON perf_kpi_disputes (kpi_value_id);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_disputes_employee ON perf_kpi_disputes (employee_id, dispute_status);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_disputes_project ON perf_kpi_disputes (project_id);
CREATE INDEX IF NOT EXISTS ix_perf_kpi_disputes_site ON perf_kpi_disputes (site_id);

CREATE TABLE IF NOT EXISTS perf_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  cycle_id       INTEGER NOT NULL REFERENCES perf_cycles (id),
  title          TEXT    NOT NULL,
  measure        TEXT,
  target_text    TEXT,
  weight         INTEGER NOT NULL DEFAULT 10 CHECK (weight BETWEEN 1 AND 100),
  progress_pct   INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  goal_status    TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (goal_status IN ('DRAFT', 'PROPOSED', 'AGREED', 'RETURNED')),
  manager_note   TEXT,
  agreed_by      TEXT,
  agreed_at      TEXT,
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
CREATE INDEX IF NOT EXISTS ix_perf_goals_company_id ON perf_goals (company_id);
CREATE INDEX IF NOT EXISTS ix_perf_goals_employee ON perf_goals (employee_id, cycle_id);
CREATE INDEX IF NOT EXISTS ix_perf_goals_cycle ON perf_goals (cycle_id);
CREATE INDEX IF NOT EXISTS ix_perf_goals_project ON perf_goals (project_id);
CREATE INDEX IF NOT EXISTS ix_perf_goals_site ON perf_goals (site_id);

CREATE TABLE IF NOT EXISTS perf_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  author         TEXT    NOT NULL,
  author_employee_id INTEGER REFERENCES hr_employees (id),
  kind           TEXT    NOT NULL CHECK (kind IN ('FEEDBACK', 'RECOGNITION', 'ONE_TO_ONE')),
  body           TEXT    NOT NULL,
  shared         INTEGER NOT NULL DEFAULT 1 CHECK (shared IN (0, 1)),
  meeting_date   TEXT,
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
CREATE INDEX IF NOT EXISTS ix_perf_feedback_company_id ON perf_feedback (company_id);
CREATE INDEX IF NOT EXISTS ix_perf_feedback_employee ON perf_feedback (employee_id, created_at);
CREATE INDEX IF NOT EXISTS ix_perf_feedback_author ON perf_feedback (author_employee_id);
CREATE INDEX IF NOT EXISTS ix_perf_feedback_project ON perf_feedback (project_id);
CREATE INDEX IF NOT EXISTS ix_perf_feedback_site ON perf_feedback (site_id);

CREATE TABLE IF NOT EXISTS perf_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  cycle_id       INTEGER NOT NULL REFERENCES perf_cycles (id),
  stage          TEXT    NOT NULL DEFAULT 'SELF' CHECK (stage IN ('SELF', 'MANAGER', 'CALIBRATION', 'FINAL', 'DONE')),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  self_rating    INTEGER CHECK (self_rating IS NULL OR (self_rating BETWEEN 1 AND 5)),
  self_comments  TEXT,
  self_at        TEXT,
  manager_rating INTEGER CHECK (manager_rating IS NULL OR (manager_rating BETWEEN 1 AND 5)),
  manager_comments TEXT,
  manager_by     TEXT,
  manager_at     TEXT,
  calibrated_rating INTEGER CHECK (calibrated_rating IS NULL OR (calibrated_rating BETWEEN 1 AND 5)),
  calibration_reason TEXT,
  calibrated_by  TEXT,
  calibrated_at  TEXT,
  final_rating   INTEGER CHECK (final_rating IS NULL OR (final_rating BETWEEN 1 AND 5)),
  kpi_score      INTEGER CHECK (kpi_score IS NULL OR (kpi_score BETWEEN 0 AND 100)),
  goal_score     INTEGER CHECK (goal_score IS NULL OR (goal_score BETWEEN 0 AND 100)),
  development_plan TEXT,
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  letter_doc_id  INTEGER,
  letter_at      TEXT,
  approved_at    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_perf_reviews_doc ON perf_reviews (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_perf_reviews_person ON perf_reviews (cycle_id, employee_id) WHERE deleted_at IS NULL AND status != 'CANCELLED';
CREATE INDEX IF NOT EXISTS ix_perf_reviews_company_id ON perf_reviews (company_id);
CREATE INDEX IF NOT EXISTS ix_perf_reviews_employee ON perf_reviews (employee_id);
CREATE INDEX IF NOT EXISTS ix_perf_reviews_status ON perf_reviews (company_id, status, stage);
CREATE INDEX IF NOT EXISTS ix_perf_reviews_letter ON perf_reviews (letter_doc_id);
CREATE INDEX IF NOT EXISTS ix_perf_reviews_project ON perf_reviews (project_id);
CREATE INDEX IF NOT EXISTS ix_perf_reviews_site ON perf_reviews (site_id);
