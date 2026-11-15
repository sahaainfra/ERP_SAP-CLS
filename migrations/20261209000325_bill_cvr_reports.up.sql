-- Part 22.09: the monthly cost-value reconciliation (CVR) of a project: the value side and the cost side as they stood when it was prepared, the manual assessments with their notes, the margin, the comparison with the budget and the month before, and the approval that locks it.
CREATE TABLE IF NOT EXISTS bill_cvr_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  as_of           TEXT    NOT NULL,
  value_lines_json      TEXT    NOT NULL DEFAULT '[]',
  expense_lines_json       TEXT    NOT NULL DEFAULT '[]',
  assessments_json TEXT   NOT NULL DEFAULT '{}',
  value_paise     INTEGER NOT NULL DEFAULT 0,
  cost_paise      INTEGER NOT NULL DEFAULT 0,
  margin_paise    INTEGER NOT NULL DEFAULT 0,
  margin_bp       INTEGER,
  budget_margin_bp INTEGER,
  prev_margin_bp  INTEGER,
  prev_report_id  INTEGER REFERENCES bill_cvr_reports (id),
  forecast_value_paise INTEGER,
  forecast_cost_paise INTEGER,
  forecast_margin_bp INTEGER,
  commentary_qs   TEXT,
  commentary_pm   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_cvr_doc ON bill_cvr_reports (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bill_cvr_period ON bill_cvr_reports (company_id, org_project_id, period) WHERE deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED');
CREATE INDEX IF NOT EXISTS ix_bill_cvr_reports_org_project_id ON bill_cvr_reports (org_project_id);
CREATE INDEX IF NOT EXISTS ix_bill_cvr_reports_org_site_id ON bill_cvr_reports (org_site_id);
CREATE INDEX IF NOT EXISTS ix_bill_cvr_reports_prev_report_id ON bill_cvr_reports (prev_report_id);
CREATE INDEX IF NOT EXISTS ix_bill_cvr_status ON bill_cvr_reports (company_id, org_project_id, status, period);