-- Part 26.02 (built on the owner's instruction of 2026-11-25, audit AUD-DEF-004): project handover, as-builts, O&M manuals and the
-- client asset register. A handover covers the whole project or an area (a location or a named area) with an effective date and a defects
-- liability period; its checklist (as-builts, O&M manuals, warranties, statutory approvals, spares, training, commissioning certificates,
-- snags, keys ...) links each item to its evidence (a file, a document revision or an issued commissioning certificate); the client asset
-- register lists what is handed over. The handover certificate is approved PM -> PD, then signed by the client (recorded with the signatory
-- and the signed copy). A certificate is refused while a mandatory item is open or a class A snag of the area is open (BR-01).
CREATE TABLE IF NOT EXISTS ho_handovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id INTEGER REFERENCES org_sites (id),
  location_id INTEGER REFERENCES proj_locations (id),
  doc_no      TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  scope_type  TEXT    NOT NULL DEFAULT 'PROJECT' CHECK (scope_type IN ('PROJECT', 'AREA')),
  area_label  TEXT,
  planned_on  TEXT,
  effective_on TEXT,
  dlp_months  INTEGER NOT NULL DEFAULT 12 CHECK (dlp_months BETWEEN 0 AND 120),
  status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by TEXT,
  approved_at TEXT,
  client_signatory TEXT,
  client_signed_on TEXT,
  client_file_id INTEGER REFERENCES core_files (id),
  issued_by   TEXT,
  issued_at   TEXT,
  readiness_json TEXT NOT NULL DEFAULT '{}',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ho_handovers_doc ON ho_handovers (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_ho_handovers_company_id ON ho_handovers (company_id);
CREATE INDEX IF NOT EXISTS ix_ho_handovers_project ON ho_handovers (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ho_handovers_site ON ho_handovers (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ho_handovers_location ON ho_handovers (location_id);
CREATE INDEX IF NOT EXISTS ix_ho_handovers_status ON ho_handovers (company_id, status);
CREATE INDEX IF NOT EXISTS ix_ho_handovers_client_file_id ON ho_handovers (client_file_id);

CREATE TABLE IF NOT EXISTS ho_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  handover_id INTEGER NOT NULL REFERENCES ho_handovers (id),
  category    TEXT    NOT NULL CHECK (category IN ('AS_BUILT', 'OM_MANUAL', 'WARRANTY', 'STATUTORY', 'SPARES', 'TRAINING', 'TEST_CERTIFICATE', 'COMMISSIONING', 'SNAGS', 'KEYS', 'OTHER')),
  title       TEXT    NOT NULL,
  mandatory   INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
  status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'NOT_APPLICABLE')),
  file_id     INTEGER REFERENCES core_files (id),
  doc_revision_id INTEGER REFERENCES doc_versions (id),
  tnc_certificate_id INTEGER REFERENCES tnc_certificates (id),
  note        TEXT,
  done_by     TEXT,
  done_at     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_ho_checklist_items_company_id ON ho_checklist_items (company_id);
CREATE INDEX IF NOT EXISTS ix_ho_checklist_items_handover ON ho_checklist_items (handover_id);
CREATE INDEX IF NOT EXISTS ix_ho_checklist_items_status ON ho_checklist_items (company_id, status);
CREATE INDEX IF NOT EXISTS ix_ho_checklist_items_file_id ON ho_checklist_items (file_id);
CREATE INDEX IF NOT EXISTS ix_ho_checklist_items_certificate ON ho_checklist_items (tnc_certificate_id);
CREATE INDEX IF NOT EXISTS ix_ho_checklist_items_revision ON ho_checklist_items (doc_revision_id);

CREATE TABLE IF NOT EXISTS ho_client_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  handover_id INTEGER NOT NULL REFERENCES ho_handovers (id),
  org_project_id INTEGER NOT NULL REFERENCES org_projects (id),
  tnc_system_id INTEGER REFERENCES tnc_systems (id),
  tag_no      TEXT    NOT NULL COLLATE NOCASE,
  description TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT 'EQUIPMENT' CHECK (category IN ('EQUIPMENT', 'SYSTEM', 'FIXTURE', 'STRUCTURE', 'OTHER')),
  location_text TEXT,
  make        TEXT,
  model       TEXT,
  serial_no   TEXT,
  capacity    TEXT,
  warranty_until TEXT,
  maintenance_note TEXT,
  status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ho_client_assets_tag ON ho_client_assets (handover_id, tag_no);
CREATE INDEX IF NOT EXISTS ix_ho_client_assets_company_id ON ho_client_assets (company_id);
CREATE INDEX IF NOT EXISTS ix_ho_client_assets_handover ON ho_client_assets (handover_id);
CREATE INDEX IF NOT EXISTS ix_ho_client_assets_project ON ho_client_assets (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ho_client_assets_system ON ho_client_assets (tnc_system_id);
CREATE INDEX IF NOT EXISTS ix_ho_client_assets_status ON ho_client_assets (company_id, status);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-handovers','g-closeout','page','sidebar','Handovers','हस्तांतरण','/close/handovers','erp.state.approved','ho.view','ff.close.p2602',20,'handover area partial dossier as built om manual warranty statutory handover certificate client',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-client-assets','g-closeout','page','sidebar','Client Asset Register','ग्राहक परिसंपत्ति रजिस्टर','/close/client-assets','erp.action.list','ho.view','ff.close.p2602',22,'client asset register equipment serial warranty maintenance facility management export',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.handovers','close','Handovers','/close/handovers','/close/handovers','LIST','MIGRATED','PM','26.02','system','2026-11-25T00:00:00.000Z','[]','Handovers of the projects and areas with their status, effective date and defects liability period.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.handover','close','Handover','/close/handover','/close/handover','OBJECT','MIGRATED','PM','26.02','system','2026-11-25T00:00:00.000Z','[]','A handover with its checklist and evidence, dossier index, client assets and certificate.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.client-assets','close','Client Asset Register','/close/client-assets','/close/client-assets','LIST','MIGRATED','PM','26.02','system','2026-11-25T00:00:00.000Z','[]','The assets handed over to the client, exportable for their facility management.','migration','reference_seed');
