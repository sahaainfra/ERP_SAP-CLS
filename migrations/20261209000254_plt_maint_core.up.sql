-- Part 17.05: preventive maintenance plans (by equipment class or machine, by hours, km or days) with the state of each plan on each machine, job cards (approval-controlled) and the spares drawn for them. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS plt_pm_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  task            TEXT    NOT NULL,
  class_item_id   INTEGER REFERENCES mdm_items (id),
  equipment_id    INTEGER REFERENCES plt_equipment (id),
  interval_type   TEXT    NOT NULL CHECK (interval_type IN ('HOURS', 'KM', 'DAYS')),
  interval_value  INTEGER NOT NULL CHECK (interval_value > 0),
  warn_before     INTEGER NOT NULL DEFAULT 0 CHECK (warn_before >= 0),
  critical        INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0, 1)),
  checklist_json  TEXT    NOT NULL DEFAULT '[]',
  plan_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (plan_status IN ('ACTIVE', 'INACTIVE')),
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
  CHECK (class_item_id IS NOT NULL OR equipment_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_pmp_code ON plt_pm_plans (company_id, code);
CREATE INDEX IF NOT EXISTS ix_plt_pmp_class ON plt_pm_plans (class_item_id);
CREATE INDEX IF NOT EXISTS ix_plt_pmp_equip ON plt_pm_plans (equipment_id);

CREATE TABLE IF NOT EXISTS plt_pm_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  plan_id         INTEGER NOT NULL REFERENCES plt_pm_plans (id),
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  last_done_meter INTEGER NOT NULL DEFAULT 0 CHECK (last_done_meter >= 0),
  last_done_date  TEXT    NOT NULL,
  next_due_meter  INTEGER,
  next_due_date   TEXT,
  due_state       TEXT    NOT NULL DEFAULT 'OK' CHECK (due_state IN ('OK', 'DUE', 'OVERDUE')),
  last_told_on    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_pms_plan_eq ON plt_pm_status (plan_id, equipment_id);
CREATE INDEX IF NOT EXISTS ix_plt_pms_equip ON plt_pm_status (equipment_id);
CREATE INDEX IF NOT EXISTS ix_plt_pms_state ON plt_pm_status (company_id, due_state);

CREATE TABLE IF NOT EXISTS plt_job_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  job_type        TEXT    NOT NULL CHECK (job_type IN ('PREVENTIVE', 'BREAKDOWN')),
  pm_status_ids_json TEXT NOT NULL DEFAULT '[]',
  breakdown_id    INTEGER REFERENCES plt_breakdowns (id),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  complaint       TEXT    NOT NULL,
  diagnosis       TEXT,
  work_done       TEXT,
  opened_at       TEXT    NOT NULL,
  started_at      TEXT,
  closed_at       TEXT,
  downtime_start  TEXT,
  downtime_end    TEXT,
  downtime_hrs    INTEGER NOT NULL DEFAULT 0 CHECK (downtime_hrs >= 0),
  meter_at_service INTEGER,
  mechanic        TEXT,
  vendor_id       INTEGER REFERENCES mdm_partners (id),
  external_ref    TEXT,
  external_cost   INTEGER NOT NULL DEFAULT 0 CHECK (external_cost >= 0),
  labour_hrs      INTEGER NOT NULL DEFAULT 0 CHECK (labour_hrs >= 0),
  labour_cost     INTEGER NOT NULL DEFAULT 0 CHECK (labour_cost >= 0),
  spares_cost     INTEGER NOT NULL DEFAULT 0,
  total_cost      INTEGER NOT NULL DEFAULT 0,
  warranty        INTEGER NOT NULL DEFAULT 0 CHECK (warranty IN (0, 1)),
  warranty_ref    TEXT,
  warranty_status TEXT    NOT NULL DEFAULT 'NONE' CHECK (warranty_status IN ('NONE', 'CLAIMED', 'RECOVERED', 'REJECTED')),
  warranty_amount INTEGER NOT NULL DEFAULT 0 CHECK (warranty_amount >= 0),
  prior_state     TEXT,
  job_status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (job_status IN ('OPEN', 'IN_PROGRESS', 'CLOSED')),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_jc_doc ON plt_job_cards (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plt_jc_equip ON plt_job_cards (equipment_id, job_status);
CREATE INDEX IF NOT EXISTS ix_plt_jc_bd ON plt_job_cards (breakdown_id);
CREATE INDEX IF NOT EXISTS ix_plt_jc_project ON plt_job_cards (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_jc_site ON plt_job_cards (org_site_id);
CREATE INDEX IF NOT EXISTS ix_plt_jc_vendor ON plt_job_cards (vendor_id);
CREATE INDEX IF NOT EXISTS ix_plt_jc_status ON plt_job_cards (company_id, status, job_status);

CREATE TABLE IF NOT EXISTS plt_job_spares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  job_card_id     INTEGER NOT NULL REFERENCES plt_job_cards (id),
  item_id         INTEGER NOT NULL REFERENCES mdm_items (id),
  store_id        INTEGER NOT NULL REFERENCES inv_stores (id),
  uom             TEXT    NOT NULL,
  qty             INTEGER NOT NULL CHECK (qty > 0),
  spare_status    TEXT    NOT NULL DEFAULT 'REQUESTED' CHECK (spare_status IN ('REQUESTED', 'RESERVED', 'ISSUED', 'RETURNED', 'CANCELLED')),
  reservation_id  INTEGER REFERENCES inv_reservations (id),
  ledger_ids_json TEXT    NOT NULL DEFAULT '[]',
  issued_qty      INTEGER NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  returned_qty    INTEGER NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  unit_cost       INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  cost            INTEGER NOT NULL DEFAULT 0,
  issued_by       TEXT,
  issued_at       TEXT,
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
CREATE INDEX IF NOT EXISTS ix_plt_js_job ON plt_job_spares (job_card_id);
CREATE INDEX IF NOT EXISTS ix_plt_js_item ON plt_job_spares (item_id);
CREATE INDEX IF NOT EXISTS ix_plt_js_store ON plt_job_spares (store_id);
CREATE INDEX IF NOT EXISTS ix_plt_js_resv ON plt_job_spares (reservation_id);
CREATE INDEX IF NOT EXISTS ix_plt_job_spares_company_id ON plt_job_spares (company_id);
