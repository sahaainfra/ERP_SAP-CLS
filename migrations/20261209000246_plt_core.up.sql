-- Part 17.01: equipment and vehicle register (approval-controlled), its documents and statutory certificates, and the append-only history of each machine. Nothing here changes an existing table.
-- Money is paise, quantities thousandths (the convention of the stores tables).
CREATE TABLE IF NOT EXISTS plt_equipment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  asset_code      TEXT    NOT NULL COLLATE NOCASE,
  class_item_id   INTEGER NOT NULL REFERENCES mdm_items (id),
  make            TEXT,
  model           TEXT,
  mfg_year        INTEGER CHECK (mfg_year IS NULL OR (mfg_year >= 1950 AND mfg_year <= 2100)),
  serial_no       TEXT,
  chassis_no      TEXT,
  engine_no       TEXT,
  reg_no          TEXT    COLLATE NOCASE,
  capacity        TEXT,
  ownership       TEXT    NOT NULL DEFAULT 'OWNED' CHECK (ownership IN ('OWNED', 'HIRED', 'SUBCONTRACTOR')),
  owner_partner_id INTEGER REFERENCES mdm_partners (id),
  purchase_value  INTEGER NOT NULL DEFAULT 0 CHECK (purchase_value >= 0),
  purchase_date   TEXT,
  meter_type      TEXT    NOT NULL DEFAULT 'HOURS' CHECK (meter_type IN ('HOURS', 'KM')),
  fuel_type       TEXT    NOT NULL DEFAULT 'DIESEL' CHECK (fuel_type IN ('DIESEL', 'PETROL', 'CNG', 'ELECTRIC', 'NONE')),
  tank_capacity   INTEGER NOT NULL DEFAULT 0 CHECK (tank_capacity >= 0),
  fuel_norm       INTEGER NOT NULL DEFAULT 0 CHECK (fuel_norm >= 0),
  fuel_norm_unit  TEXT    NOT NULL DEFAULT 'L_PER_HOUR' CHECK (fuel_norm_unit IN ('L_PER_HOUR', 'KM_PER_L')),
  gps_device_id   TEXT,
  road_vehicle    INTEGER NOT NULL DEFAULT 0 CHECK (road_vehicle IN (0, 1)),
  lifting         INTEGER NOT NULL DEFAULT 0 CHECK (lifting IN (0, 1)),
  operator_required INTEGER NOT NULL DEFAULT 0 CHECK (operator_required IN (0, 1)),
  operator_licence_class TEXT,
  equip_state     TEXT    NOT NULL DEFAULT 'AVAILABLE' CHECK (equip_state IN ('AVAILABLE', 'DEPLOYED', 'UNDER_MAINTENANCE', 'BREAKDOWN', 'IDLE', 'DEMOBILISED', 'DISPOSED')),
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  state_since     TEXT,
  state_note      TEXT,
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
  CHECK (ownership = 'OWNED' OR owner_partner_id IS NOT NULL OR status = 'DRAFT')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_eq_doc ON plt_equipment (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plt_eq_code ON plt_equipment (company_id, asset_code);
CREATE INDEX IF NOT EXISTS ix_plt_eq_class ON plt_equipment (class_item_id);
CREATE INDEX IF NOT EXISTS ix_plt_eq_owner ON plt_equipment (owner_partner_id);
CREATE INDEX IF NOT EXISTS ix_plt_eq_project ON plt_equipment (org_project_id);
CREATE INDEX IF NOT EXISTS ix_plt_eq_site ON plt_equipment (org_site_id);
CREATE INDEX IF NOT EXISTS ix_plt_eq_list ON plt_equipment (company_id, status, equip_state, ownership);
CREATE INDEX IF NOT EXISTS ix_plt_eq_reg ON plt_equipment (company_id, reg_no);

CREATE TABLE IF NOT EXISTS plt_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  doc_type        TEXT    NOT NULL CHECK (doc_type IN ('RC', 'INSURANCE', 'FITNESS', 'PUC', 'ROAD_PERMIT', 'LOAD_TEST', 'THIRD_PARTY_INSPECTION', 'OTHER')),
  doc_number      TEXT,
  issuer          TEXT,
  valid_from      TEXT,
  valid_until     TEXT,
  file_id         INTEGER REFERENCES core_files (id),
  mandatory       INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
  doc_status      TEXT    NOT NULL DEFAULT 'CURRENT' CHECK (doc_status IN ('CURRENT', 'SUPERSEDED')),
  superseded_by   INTEGER REFERENCES plt_documents (id),
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
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS ix_plt_doc_eq ON plt_documents (equipment_id, doc_type, doc_status);
CREATE INDEX IF NOT EXISTS ix_plt_doc_expiry ON plt_documents (company_id, doc_status, valid_until);
CREATE INDEX IF NOT EXISTS ix_plt_doc_file ON plt_documents (file_id);

CREATE TABLE IF NOT EXISTS plt_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  equipment_id    INTEGER NOT NULL REFERENCES plt_equipment (id),
  event           TEXT    NOT NULL,
  from_state      TEXT,
  to_state        TEXT,
  org_project_id  INTEGER REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  note            TEXT,
  done_by         TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_plt_tl_eq ON plt_timeline (equipment_id, id);
CREATE INDEX IF NOT EXISTS ix_plt_tl_project ON plt_timeline (org_project_id);
CREATE TRIGGER IF NOT EXISTS trg_plt_tl_no_update BEFORE UPDATE ON plt_timeline BEGIN SELECT RAISE(ABORT, 'The equipment history is never changed'); END;
CREATE TRIGGER IF NOT EXISTS trg_plt_tl_no_delete BEFORE DELETE ON plt_timeline BEGIN SELECT RAISE(ABORT, 'The equipment history is never deleted'); END;
CREATE INDEX IF NOT EXISTS ix_plt_documents_superseded_by ON plt_documents (superseded_by);
CREATE INDEX IF NOT EXISTS ix_plt_timeline_org_site_id ON plt_timeline (org_site_id);
CREATE INDEX IF NOT EXISTS ix_plt_timeline_company_id ON plt_timeline (company_id);
