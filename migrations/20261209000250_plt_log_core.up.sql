-- Part 17.03: the daily log books of equipment (approval-controlled) and breakdown reports. Nothing here changes an existing table. Hours and meters are thousandths, money paise.
CREATE TABLE IF NOT EXISTS plt_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  allocation_id   INTEGER NOT NULL REFERENCES plt_allocations (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  log_date        TEXT    NOT NULL,
  shift           TEXT    NOT NULL DEFAULT 'GENERAL' CHECK (shift IN ('GENERAL', 'DAY', 'NIGHT')),
  operator_type   TEXT    CHECK (operator_type IS NULL OR operator_type IN ('EMPLOYEE', 'WORKER')),
  operator_id     INTEGER,
  operator_name   TEXT,
  start_meter     INTEGER NOT NULL CHECK (start_meter >= 0),
  end_meter       INTEGER NOT NULL CHECK (end_meter >= 0),
  working_hrs     INTEGER NOT NULL DEFAULT 0 CHECK (working_hrs >= 0),
  idle_hrs        INTEGER NOT NULL DEFAULT 0 CHECK (idle_hrs >= 0),
  idle_reason     TEXT    CHECK (idle_reason IS NULL OR idle_reason IN ('NO_WORK', 'NO_OPERATOR', 'WEATHER', 'WAITING', 'OTHER')),
  breakdown_hrs   INTEGER NOT NULL DEFAULT 0 CHECK (breakdown_hrs >= 0),
  breakdown_id    INTEGER REFERENCES plt_breakdowns (id),
  wa_id           INTEGER REFERENCES site_work_authorisations (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  cost_code_id    INTEGER,
  work_qty        INTEGER NOT NULL DEFAULT 0 CHECK (work_qty >= 0),
  work_uom        TEXT,
  fuel_litres     INTEGER NOT NULL DEFAULT 0 CHECK (fuel_litres >= 0),
  fuel_ref        TEXT,
  meter_photo_file_id INTEGER REFERENCES core_files (id),
  anomalies_json  TEXT    NOT NULL DEFAULT '[]',
  anomaly_note    TEXT,
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  vendor_rep      TEXT,
  vendor_signed_at TEXT,
  vendor_signature_file_id INTEGER REFERENCES core_files (id),
  charge_rate     INTEGER NOT NULL DEFAULT 0 CHECK (charge_rate >= 0),
  charge_basis    TEXT    NOT NULL DEFAULT 'DAY' CHECK (charge_basis IN ('HOUR', 'DAY', 'MONTH')),
  cost_amount     INTEGER NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  use_recorded    INTEGER NOT NULL DEFAULT 0 CHECK (use_recorded IN (0, 1)),
  use_note        TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
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
  remarks     TEXT,
  CHECK (end_meter >= start_meter)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_logs_doc ON plt_logs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plt_logs_eq ON plt_logs (equipment_id, log_date, shift);
CREATE INDEX IF NOT EXISTS ix_plt_logs_alloc ON plt_logs (allocation_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_project ON plt_logs (org_project_id, log_date);
CREATE INDEX IF NOT EXISTS ix_plt_logs_site ON plt_logs (org_site_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_wa ON plt_logs (wa_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_activity ON plt_logs (activity_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_wbs ON plt_logs (wbs_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_vendor ON plt_logs (vendor_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_breakdown ON plt_logs (breakdown_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_photo ON plt_logs (meter_photo_file_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_sign ON plt_logs (vendor_signature_file_id);
CREATE INDEX IF NOT EXISTS ix_plt_logs_list ON plt_logs (company_id, status, log_date);

CREATE TABLE IF NOT EXISTS plt_breakdowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  allocation_id   INTEGER REFERENCES plt_allocations (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  category        TEXT    NOT NULL CHECK (category IN ('MECHANICAL', 'HYDRAULIC', 'ELECTRICAL', 'TYRE', 'ACCIDENT', 'OTHER')),
  description     TEXT    NOT NULL,
  reported_on     TEXT    NOT NULL,
  reported_at     TEXT    NOT NULL,
  reported_by     TEXT    NOT NULL,
  prior_state     TEXT    NOT NULL DEFAULT 'AVAILABLE',
  breakdown_status TEXT   NOT NULL DEFAULT 'OPEN' CHECK (breakdown_status IN ('OPEN', 'RESOLVED')),
  resolved_on     TEXT,
  resolved_by     TEXT,
  resolution      TEXT,
  job_card_ref    TEXT,
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
  CHECK (resolved_on IS NULL OR resolved_on >= reported_on)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_bd_doc ON plt_breakdowns (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plt_bd_eq ON plt_breakdowns (equipment_id, breakdown_status);
CREATE INDEX IF NOT EXISTS ix_plt_bd_alloc ON plt_breakdowns (allocation_id);
CREATE INDEX IF NOT EXISTS ix_plt_bd_project ON plt_breakdowns (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_bd_site ON plt_breakdowns (org_site_id);
