-- Part 19.04: inspection schedules, safety observations (with the penalty approval), the PPE catalogue and issues, the safety equipment register and the contractor safety scores. Nothing here changes an existing table.
CREATE TABLE IF NOT EXISTS hse_inspection_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  title           TEXT    NOT NULL,
  register_type  TEXT    NOT NULL CHECK (register_type IN ('SCAFFOLD', 'EQUIPMENT', 'ELECTRICAL', 'HOUSEKEEPING', 'FIRE_EXTINGUISHER', 'OTHER')),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  template_id     INTEGER NOT NULL REFERENCES qa_checklist_templates (id),
  frequency_days  INTEGER NOT NULL CHECK (frequency_days BETWEEN 1 AND 366),
  next_due        TEXT    NOT NULL,
  last_done_on    TEXT,
  last_inspection_id INTEGER REFERENCES qa_inspections (id),
  last_result     TEXT,
  schedule_status TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (schedule_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_is_code ON hse_inspection_schedules (company_id, code);
CREATE INDEX IF NOT EXISTS ix_hse_is_site ON hse_inspection_schedules (org_site_id, schedule_status, next_due);
CREATE INDEX IF NOT EXISTS ix_hse_is_project ON hse_inspection_schedules (org_project_id);
CREATE INDEX IF NOT EXISTS ix_hse_is_template ON hse_inspection_schedules (template_id);
CREATE INDEX IF NOT EXISTS ix_hse_is_inspection ON hse_inspection_schedules (last_inspection_id);
CREATE TABLE IF NOT EXISTS hse_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  obs_type        TEXT    NOT NULL CHECK (obs_type IN ('UNSAFE_ACT', 'UNSAFE_CONDITION', 'POSITIVE')),
  description     TEXT    NOT NULL,
  location_id     INTEGER REFERENCES proj_locations (id),
  location_text   TEXT,
  photo_file_ids  TEXT    NOT NULL DEFAULT '[]',
  responsible_type TEXT   NOT NULL DEFAULT 'OWN_CREW' CHECK (responsible_type IN ('OWN_CREW', 'SUBCONTRACTOR', 'SUPPLIER')),
  responsible_id  INTEGER REFERENCES mdm_partners (id),
  severity        TEXT    NOT NULL DEFAULT 'LOW' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  immediate_action TEXT,
  action_required TEXT,
  due_at          TEXT,
  schedule_id     INTEGER REFERENCES hse_inspection_schedules (id),
  inspection_id   INTEGER REFERENCES qa_inspections (id),
  observed_by     TEXT    NOT NULL,
  obs_status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (obs_status IN ('OPEN', 'ACTION_DONE', 'CLOSED', 'CANCELLED')),
  action_done_by  TEXT,
  action_done_on  TEXT,
  action_note     TEXT,
  closed_by       TEXT,
  closed_on       TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 3),
  escalated_at    TEXT,
  penalty_amount  INTEGER NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
  penalty_reason  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_ob_doc ON hse_observations (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hse_ob_site ON hse_observations (org_site_id, obs_status, severity);
CREATE INDEX IF NOT EXISTS ix_hse_ob_project ON hse_observations (org_project_id, obs_type);
CREATE INDEX IF NOT EXISTS ix_hse_ob_party ON hse_observations (responsible_id);
CREATE INDEX IF NOT EXISTS ix_hse_ob_location ON hse_observations (location_id);
CREATE INDEX IF NOT EXISTS ix_hse_ob_schedule ON hse_observations (schedule_id);
CREATE INDEX IF NOT EXISTS ix_hse_ob_inspection ON hse_observations (inspection_id);
CREATE INDEX IF NOT EXISTS ix_hse_ob_due ON hse_observations (obs_status, due_at);
CREATE TABLE IF NOT EXISTS hse_ppe_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  code            TEXT    NOT NULL COLLATE NOCASE,
  name            TEXT    NOT NULL,
  name_hi         TEXT,
  item_id         INTEGER REFERENCES mdm_items (id),
  replace_days    INTEGER CHECK (replace_days IS NULL OR replace_days BETWEEN 1 AND 3650),
  ppe_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (ppe_status IN ('ACTIVE', 'INACTIVE')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_pp_code ON hse_ppe_items (company_id, code);
CREATE INDEX IF NOT EXISTS ix_hse_pp_item ON hse_ppe_items (item_id);
CREATE TABLE IF NOT EXISTS hse_ppe_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  ppe_item_id     INTEGER NOT NULL REFERENCES hse_ppe_items (id),
  person_type     TEXT    NOT NULL CHECK (person_type IN ('WORKER', 'EMPLOYEE')),
  person_id       INTEGER NOT NULL,
  person_code     TEXT    NOT NULL,
  person_name     TEXT    NOT NULL,
  issue_date      TEXT    NOT NULL,
  qty             INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1),
  replace_due     TEXT,
  acknowledged_at TEXT,
  via             TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (via IN ('QR', 'MANUAL')),
  issue_ref       TEXT,
  replaces_id     INTEGER REFERENCES hse_ppe_issues (id),
  returned_on     TEXT,
  return_condition TEXT CHECK (return_condition IS NULL OR return_condition IN ('GOOD', 'WORN', 'DAMAGED', 'LOST')),
  issued_by       TEXT    NOT NULL,
  issue_status    TEXT    NOT NULL DEFAULT 'ISSUED' CHECK (issue_status IN ('ISSUED', 'RETURNED', 'REPLACED', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_pi_doc ON hse_ppe_issues (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_hse_pi_person ON hse_ppe_issues (person_type, person_id, issue_status);
CREATE INDEX IF NOT EXISTS ix_hse_pi_item ON hse_ppe_issues (ppe_item_id);
CREATE INDEX IF NOT EXISTS ix_hse_pi_site ON hse_ppe_issues (org_site_id, issue_status);
CREATE INDEX IF NOT EXISTS ix_hse_pi_project ON hse_ppe_issues (org_project_id);
CREATE INDEX IF NOT EXISTS ix_hse_pi_due ON hse_ppe_issues (issue_status, replace_due);
CREATE INDEX IF NOT EXISTS ix_hse_pi_replaces ON hse_ppe_issues (replaces_id);
CREATE TABLE IF NOT EXISTS hse_equipment_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  equip_type      TEXT    NOT NULL CHECK (equip_type IN ('FIRE_EXTINGUISHER', 'FIRST_AID_BOX', 'EYE_WASH', 'SMOKE_DETECTOR', 'EMERGENCY_LIGHT', 'SPILL_KIT', 'OTHER')),
  tag             TEXT    NOT NULL COLLATE NOCASE,
  location_id     INTEGER REFERENCES proj_locations (id),
  location_text   TEXT,
  capacity        TEXT,
  expiry_date     TEXT,
  last_inspected_on TEXT,
  last_inspection_id INTEGER REFERENCES qa_inspections (id),
  alerted_state   TEXT,
  eq_status       TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (eq_status IN ('ACTIVE', 'OUT_OF_SERVICE', 'RETIRED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_eq_tag ON hse_equipment_register (company_id, tag);
CREATE INDEX IF NOT EXISTS ix_hse_eq_site ON hse_equipment_register (org_site_id, eq_status, expiry_date);
CREATE INDEX IF NOT EXISTS ix_hse_eq_project ON hse_equipment_register (org_project_id);
CREATE INDEX IF NOT EXISTS ix_hse_eq_location ON hse_equipment_register (location_id);
CREATE INDEX IF NOT EXISTS ix_hse_eq_inspection ON hse_equipment_register (last_inspection_id);
CREATE TABLE IF NOT EXISTS hse_contractor_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id      INTEGER NOT NULL REFERENCES mdm_partners (id),
  period          TEXT    NOT NULL,
  workers         INTEGER NOT NULL DEFAULT 0 CHECK (workers >= 0),
  induction_bp    INTEGER NOT NULL DEFAULT 10000 CHECK (induction_bp BETWEEN 0 AND 10000),
  ppe_bp          INTEGER NOT NULL DEFAULT 10000 CHECK (ppe_bp BETWEEN 0 AND 10000),
  violations      INTEGER NOT NULL DEFAULT 0 CHECK (violations >= 0),
  incidents       INTEGER NOT NULL DEFAULT 0 CHECK (incidents >= 0),
  score           INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  band            TEXT    NOT NULL DEFAULT 'A' CHECK (band IN ('A', 'B', 'C', 'D')),
  computed_at     TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hse_cs_period ON hse_contractor_scores (company_id, partner_id, period);
CREATE INDEX IF NOT EXISTS ix_hse_cs_partner ON hse_contractor_scores (partner_id);
