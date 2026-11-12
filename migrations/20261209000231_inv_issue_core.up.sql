-- Part 16.04: material issue slips, their lines, returns from site and the subcontractor free-issue ledger. Quantities are thousandths of the unit, rates and values paise, percentages x10000.
CREATE TABLE IF NOT EXISTS inv_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  issue_date      TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  issue_type      TEXT    NOT NULL CHECK (issue_type IN ('OWN_CREW', 'SUBCO_FREE', 'SUBCO_CHARGEABLE', 'EQUIPMENT')),
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  mr_id           INTEGER REFERENCES proc_material_requests (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER REFERENCES fin_cost_codes (id),
  issued_to_type  TEXT    NOT NULL CHECK (issued_to_type IN ('CREW', 'SUBCONTRACTOR', 'EQUIPMENT', 'PERSON')),
  issued_to_id    INTEGER,
  issued_to_name  TEXT    NOT NULL,
  receiver_user   TEXT,
  ack_method      TEXT    CHECK (ack_method IS NULL OR ack_method IN ('OTP', 'SIGNATURE')),
  ack_hash        TEXT,
  ack_expires     TEXT,
  ack_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (ack_attempts >= 0),
  receiver_ack    INTEGER NOT NULL DEFAULT 0 CHECK (receiver_ack IN (0, 1)),
  receiver_name   TEXT,
  receiver_ack_at TEXT,
  signature_file_id INTEGER REFERENCES core_files (id),
  exception_needed INTEGER NOT NULL DEFAULT 0 CHECK (exception_needed IN (0, 1)),
  total_value     INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  recoverable_value INTEGER NOT NULL DEFAULT 0 CHECK (recoverable_value >= 0),
  reason          TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  posted_at       TEXT,
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
  remarks     TEXT,
  CHECK (issue_type NOT IN ('SUBCO_FREE', 'SUBCO_CHARGEABLE') OR (issued_to_type = 'SUBCONTRACTOR' AND issued_to_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_iss_doc ON inv_issues (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_iss_list ON inv_issues (company_id, status, issue_date);
CREATE INDEX IF NOT EXISTS ix_inv_iss_project ON inv_issues (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_iss_site ON inv_issues (org_site_id);
CREATE INDEX IF NOT EXISTS ix_inv_iss_store ON inv_issues (store_id, status);
CREATE INDEX IF NOT EXISTS ix_inv_iss_wa ON inv_issues (wa_id);
CREATE INDEX IF NOT EXISTS ix_inv_iss_mr ON inv_issues (mr_id);
CREATE INDEX IF NOT EXISTS ix_inv_iss_activity ON inv_issues (activity_id);
CREATE INDEX IF NOT EXISTS ix_inv_iss_wbs ON inv_issues (wbs_id);
CREATE INDEX IF NOT EXISTS ix_inv_iss_cost ON inv_issues (cost_code_id);
CREATE INDEX IF NOT EXISTS ix_inv_iss_to ON inv_issues (issued_to_type, issued_to_id);
CREATE INDEX IF NOT EXISTS ix_inv_iss_sig ON inv_issues (signature_file_id);

CREATE TABLE IF NOT EXISTS inv_issue_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  issue_id        INTEGER NOT NULL REFERENCES inv_issues (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  uom             TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  authorised_qty  INTEGER NOT NULL DEFAULT 0 CHECK (authorised_qty >= 0),
  issued_before   INTEGER NOT NULL DEFAULT 0 CHECK (issued_before >= 0),
  excess_qty      INTEGER NOT NULL DEFAULT 0 CHECK (excess_qty >= 0),
  batch_no        TEXT,
  rate            INTEGER NOT NULL DEFAULT 0 CHECK (rate >= 0),
  value           INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  charge_rate     INTEGER CHECK (charge_rate IS NULL OR charge_rate >= 0),
  returned_qty    INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  mr_line_id      INTEGER REFERENCES proc_mr_lines (id),
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
  CHECK (returned_qty <= qty)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_issl_no ON inv_issue_lines (issue_id, line_no);
CREATE INDEX IF NOT EXISTS ix_inv_issl_company ON inv_issue_lines (company_id);
CREATE INDEX IF NOT EXISTS ix_inv_issl_item ON inv_issue_lines (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_issl_mr ON inv_issue_lines (mr_line_id);

CREATE TABLE IF NOT EXISTS inv_site_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  return_date     TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  issue_id        INTEGER NOT NULL REFERENCES inv_issues (id),
  from_type       TEXT    NOT NULL CHECK (from_type IN ('CREW', 'SUBCONTRACTOR', 'EQUIPMENT', 'PERSON')),
  from_id         INTEGER,
  from_name       TEXT    NOT NULL,
  condition       TEXT    NOT NULL CHECK (condition IN ('GOOD', 'DAMAGED', 'SCRAP')),
  reason          TEXT    NOT NULL,
  lines_json      TEXT    NOT NULL DEFAULT '[]',
  total_value     INTEGER NOT NULL DEFAULT 0 CHECK (total_value >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT    NOT NULL,
  approved_by     TEXT,
  approved_at     TEXT,
  posted_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_ret_doc ON inv_site_returns (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_inv_ret_list ON inv_site_returns (company_id, status, return_date);
CREATE INDEX IF NOT EXISTS ix_inv_ret_project ON inv_site_returns (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_ret_store ON inv_site_returns (store_id);
CREATE INDEX IF NOT EXISTS ix_inv_ret_issue ON inv_site_returns (issue_id);

CREATE TABLE IF NOT EXISTS inv_sub_certified (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  boq_line_id     INTEGER NOT NULL REFERENCES proj_boq_lines (id),
  period          TEXT    NOT NULL,
  certified_qty   INTEGER NOT NULL CHECK (certified_qty >= 0),
  certificate_ref TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_cert_key ON inv_sub_certified (company_id, org_project_id, subcontractor_id, boq_line_id, period);
CREATE INDEX IF NOT EXISTS ix_inv_cert_sub ON inv_sub_certified (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_inv_cert_project ON inv_sub_certified (org_project_id);
CREATE INDEX IF NOT EXISTS ix_inv_cert_boq ON inv_sub_certified (boq_line_id);

CREATE TABLE IF NOT EXISTS inv_free_issue_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  subcontractor_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  period          TEXT    NOT NULL,
  issued_qty      INTEGER NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  returned_qty    INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  entitled_qty    INTEGER NOT NULL DEFAULT 0 CHECK (entitled_qty >= 0),
  excess_qty      INTEGER NOT NULL DEFAULT 0 CHECK (excess_qty >= 0),
  recovery_rate   INTEGER NOT NULL DEFAULT 0 CHECK (recovery_rate >= 0),
  recovery_amount INTEGER NOT NULL DEFAULT 0 CHECK (recovery_amount >= 0),
  computed_at     TEXT    NOT NULL,
  computed_by     TEXT    NOT NULL,
  notified        INTEGER NOT NULL DEFAULT 0 CHECK (notified IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_inv_fil_key ON inv_free_issue_ledger (company_id, org_project_id, subcontractor_id, item_id, period);
CREATE INDEX IF NOT EXISTS ix_inv_fil_sub ON inv_free_issue_ledger (subcontractor_id);
CREATE INDEX IF NOT EXISTS ix_inv_fil_item ON inv_free_issue_ledger (item_id);
CREATE INDEX IF NOT EXISTS ix_inv_fil_project ON inv_free_issue_ledger (org_project_id, period);
