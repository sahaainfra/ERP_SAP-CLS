-- Part 07.09: employee and manager self-service (module hr). ess_requests: what an employee asks HR for through self-service: today the letters (employment certificate, salary certificate, no-objection certificate),
-- approved by the HR manager and then issued from the template library (04.11). A change of the employee's own details is the change document of part 07.01 (hr_employee_changes) and is not copied here.

CREATE TABLE IF NOT EXISTS ess_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  revision_no    INTEGER NOT NULL DEFAULT 1,
  root_id        INTEGER,
  doc_date       TEXT    NOT NULL,
  employee_id    INTEGER NOT NULL REFERENCES hr_employees (id),
  request_type   TEXT    NOT NULL DEFAULT 'LETTER' CHECK (request_type IN ('LETTER')),
  letter_type    TEXT    NOT NULL CHECK (letter_type IN ('EMPLOYMENT', 'SALARY', 'NOC')),
  purpose        TEXT    NOT NULL,
  addressed_to   TEXT,
  payload_json   TEXT    NOT NULL DEFAULT '{}',
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'ISSUED')),
  band           TEXT    NOT NULL DEFAULT 'STANDARD',
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  generated_doc_id INTEGER,
  issued_at      TEXT,
  issued_by      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ess_requests_doc ON ess_requests (company_id, doc_no, revision_no);
CREATE INDEX IF NOT EXISTS ix_ess_requests_company_id ON ess_requests (company_id);
CREATE INDEX IF NOT EXISTS ix_ess_requests_employee ON ess_requests (employee_id, status);
CREATE INDEX IF NOT EXISTS ix_ess_requests_status ON ess_requests (company_id, status);
CREATE INDEX IF NOT EXISTS ix_ess_requests_root_id ON ess_requests (root_id);
CREATE INDEX IF NOT EXISTS ix_ess_requests_generated ON ess_requests (generated_doc_id);
