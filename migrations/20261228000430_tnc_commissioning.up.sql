-- Part 26.01 (built on the owner's instruction of 2026-11-25, audit AUD-DEF-004): testing, pre-commissioning and commissioning.
-- A project is split into systems (and subsystems) and their tags; each tag has check sheets of class A (mechanical completion),
-- B (pre-commissioning) and C (commissioning), optionally linked to a QA inspection (18.01); a system has test packs and punch items
-- (QA snags of 18.06, linked here); certificates MC, RFC and RFSU are approved commissioning lead -> QCMGR -> PM, then signed by the
-- client (recorded with the signatory and the signed copy). A certificate is refused while its system is not ready (BR-01).
CREATE TABLE IF NOT EXISTS tnc_systems (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id INTEGER REFERENCES org_sites (id),
  parent_id   INTEGER REFERENCES tnc_systems (id),
  code        TEXT    NOT NULL COLLATE NOCASE,
  name        TEXT    NOT NULL,
  discipline  TEXT    NOT NULL DEFAULT 'GENERAL' CHECK (discipline IN ('GENERAL', 'CIVIL', 'MECHANICAL', 'ELECTRICAL', 'INSTRUMENTATION', 'PIPING', 'HVAC', 'FIRE', 'PLUMBING')),
  stage       TEXT    NOT NULL DEFAULT 'CONSTRUCTION' CHECK (stage IN ('CONSTRUCTION', 'MC', 'RFC', 'RFSU')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tnc_systems_code ON tnc_systems (company_id, org_project_id, code);
CREATE INDEX IF NOT EXISTS ix_tnc_systems_company_id ON tnc_systems (company_id);
CREATE INDEX IF NOT EXISTS ix_tnc_systems_project ON tnc_systems (org_project_id);
CREATE INDEX IF NOT EXISTS ix_tnc_systems_site ON tnc_systems (org_site_id);
CREATE INDEX IF NOT EXISTS ix_tnc_systems_parent ON tnc_systems (parent_id);
CREATE INDEX IF NOT EXISTS ix_tnc_systems_status ON tnc_systems (company_id, status);

CREATE TABLE IF NOT EXISTS tnc_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  system_id   INTEGER NOT NULL REFERENCES tnc_systems (id),
  tag_no      TEXT    NOT NULL COLLATE NOCASE,
  description TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tnc_tags_no ON tnc_tags (system_id, tag_no);
CREATE INDEX IF NOT EXISTS ix_tnc_tags_company_id ON tnc_tags (company_id);
CREATE INDEX IF NOT EXISTS ix_tnc_tags_system ON tnc_tags (system_id);
CREATE INDEX IF NOT EXISTS ix_tnc_tags_status ON tnc_tags (company_id, status);

CREATE TABLE IF NOT EXISTS tnc_checksheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tag_id      INTEGER NOT NULL REFERENCES tnc_tags (id),
  sheet_class TEXT    NOT NULL CHECK (sheet_class IN ('A', 'B', 'C')),
  title       TEXT    NOT NULL,
  inspection_id INTEGER REFERENCES qa_inspections (id),
  status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PASSED', 'FAILED', 'CANCELLED')),
  result_note TEXT,
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
CREATE INDEX IF NOT EXISTS ix_tnc_checksheets_company_id ON tnc_checksheets (company_id);
CREATE INDEX IF NOT EXISTS ix_tnc_checksheets_tag ON tnc_checksheets (tag_id);
CREATE INDEX IF NOT EXISTS ix_tnc_checksheets_inspection ON tnc_checksheets (inspection_id);
CREATE INDEX IF NOT EXISTS ix_tnc_checksheets_status ON tnc_checksheets (company_id, status);

CREATE TABLE IF NOT EXISTS tnc_test_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  system_id   INTEGER NOT NULL REFERENCES tnc_systems (id),
  doc_no      TEXT    NOT NULL COLLATE NOCASE,
  pack_type   TEXT    NOT NULL CHECK (pack_type IN ('HYDROTEST', 'PNEUMATIC', 'LOOP_CHECK', 'INSULATION', 'FUNCTION', 'PERFORMANCE', 'OTHER')),
  procedure_ref TEXT  NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'PASSED', 'FAILED', 'CANCELLED')),
  witnessed_by TEXT,
  witness_party TEXT,
  tested_on   TEXT,
  result_note TEXT,
  evidence_file_id INTEGER REFERENCES core_files (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tnc_test_packs_doc ON tnc_test_packs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_tnc_test_packs_company_id ON tnc_test_packs (company_id);
CREATE INDEX IF NOT EXISTS ix_tnc_test_packs_system ON tnc_test_packs (system_id);
CREATE INDEX IF NOT EXISTS ix_tnc_test_packs_status ON tnc_test_packs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_tnc_test_packs_evidence_file_id ON tnc_test_packs (evidence_file_id);

CREATE TABLE IF NOT EXISTS tnc_punch_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  system_id   INTEGER NOT NULL REFERENCES tnc_systems (id),
  snag_id     INTEGER NOT NULL REFERENCES qa_snags (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tnc_punch_links ON tnc_punch_links (system_id, snag_id);
CREATE INDEX IF NOT EXISTS ix_tnc_punch_links_company_id ON tnc_punch_links (company_id);
CREATE INDEX IF NOT EXISTS ix_tnc_punch_links_snag ON tnc_punch_links (snag_id);

CREATE TABLE IF NOT EXISTS tnc_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  system_id   INTEGER NOT NULL REFERENCES tnc_systems (id),
  doc_no      TEXT    NOT NULL COLLATE NOCASE,
  kind        TEXT    NOT NULL CHECK (kind IN ('MC', 'RFC', 'RFSU')),
  status      TEXT    NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'ISSUED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by TEXT   NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tnc_certificates_doc ON tnc_certificates (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tnc_certificates_open ON tnc_certificates (system_id, kind) WHERE status IN ('SUBMITTED', 'APPROVED', 'ISSUED');
CREATE INDEX IF NOT EXISTS ix_tnc_certificates_company_id ON tnc_certificates (company_id);
CREATE INDEX IF NOT EXISTS ix_tnc_certificates_system ON tnc_certificates (system_id);
CREATE INDEX IF NOT EXISTS ix_tnc_certificates_status ON tnc_certificates (company_id, status);
CREATE INDEX IF NOT EXISTS ix_tnc_certificates_client_file_id ON tnc_certificates (client_file_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('g-closeout',NULL,'group','sidebar','Commissioning & Closeout','कमीशनिंग एवं समापन',NULL,'erp.state.approved',NULL,NULL,125,'commissioning handover defect liability closeout',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-commissioning','g-closeout','page','sidebar','Commissioning','कमीशनिंग','/close/commissioning','erp.state.approved','tnc.view','ff.close.p2601',10,'commissioning systems subsystems tags check sheets mechanical completion pre-commissioning rfc rfsu progress',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-test-packs','g-closeout','page','sidebar','Test Packs','परीक्षण पैक','/close/test-packs','erp.action.list','tnc.view','ff.close.p2601',12,'test packs hydrotest loop check insulation function performance witnessed',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-certificates','g-closeout','page','sidebar','Commissioning Certificates','कमीशनिंग प्रमाणपत्र','/close/certificates','erp.state.approved','tnc.view','ff.close.p2601',14,'certificates mc rfc rfsu mechanical completion ready for commissioning ready for start up client sign off',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.commissioning','close','Commissioning','/close/commissioning','/close/commissioning','OVERVIEW','MIGRATED','QCMGR','26.01','system','2026-11-25T00:00:00.000Z','[]','The completion of every system by check-sheet class, punches and certificates, and the systems register.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.commissioning-system','close','Commissioning System','/close/commissioning/system','/close/commissioning/system','OBJECT','MIGRATED','QCMGR','26.01','system','2026-11-25T00:00:00.000Z','[]','A system with its tags, check sheets, test packs, punches and certificates.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.test-packs','close','Test Packs','/close/test-packs','/close/test-packs','LIST','MIGRATED','QCMGR','26.01','system','2026-11-25T00:00:00.000Z','[]','The test packs of the company with their result and witness.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.certificates','close','Commissioning Certificates','/close/certificates','/close/certificates','LIST','MIGRATED','QCMGR','26.01','system','2026-11-25T00:00:00.000Z','[]','MC, RFC and RFSU certificates with their approval and client sign-off.','migration','reference_seed');
