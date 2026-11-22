-- Part 29.07: data retention and archival. arc_policies (retention per record class with legal basis), arc_jobs (archival jobs approved
-- SYSADM -> AUD), arc_records (the archive: a snapshot of each archived row with its SHA-256; the row itself stays for references and
-- search and is made read-only by the triggers below), arc_holds (legal holds on a record or a project), arc_disposals (disposal after
-- retention, AUD -> DIR, with the certificate of destruction), arc_erasures (DPDP personal data erasure requests with their checks) and
-- arc_bypass (a technical marker that lifts the read-only triggers inside a disposal or an erasure transaction).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.admin.p2907', 'Data retention, archival, legal holds and disposal (part 29.07)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS arc_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  record_class TEXT NOT NULL,
  archive_after_months INTEGER NOT NULL CHECK (archive_after_months >= 0),
  retention_years INTEGER NOT NULL CHECK (retention_years >= 1),
  legal_basis TEXT NOT NULL,
  action_after TEXT NOT NULL CHECK (action_after IN ('DISPOSE', 'ANONYMISE', 'REVIEW')),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arc_policies_active ON arc_policies(company_id, record_class) WHERE status = 'ACTIVE' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_arc_policies_company ON arc_policies(company_id, status);

CREATE TABLE IF NOT EXISTS arc_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  record_class TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  records INTEGER NOT NULL DEFAULT 0 CHECK (records >= 0),
  held INTEGER NOT NULL DEFAULT 0 CHECK (held >= 0),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'DONE', 'REJECTED')),
  request_id INTEGER REFERENCES core_change_requests(id),
  approved_by TEXT,
  executed_at TEXT,
  file_name TEXT,
  file_sha256 TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_arc_jobs_company ON arc_jobs(company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_arc_jobs_request ON arc_jobs(request_id);

CREATE TABLE IF NOT EXISTS arc_disposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  record_class TEXT NOT NULL,
  record_ids_json TEXT NOT NULL,
  records INTEGER NOT NULL DEFAULT 0 CHECK (records >= 0),
  held INTEGER NOT NULL DEFAULT 0 CHECK (held >= 0),
  action_after TEXT NOT NULL CHECK (action_after IN ('DISPOSE', 'ANONYMISE')),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'DONE', 'REJECTED')),
  request_id INTEGER REFERENCES core_change_requests(id),
  disposed INTEGER NOT NULL DEFAULT 0 CHECK (disposed >= 0),
  anonymised INTEGER NOT NULL DEFAULT 0 CHECK (anonymised >= 0),
  certificate_no TEXT,
  certificate_sha256 TEXT,
  executed_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_arc_disposals_company ON arc_disposals(company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_arc_disposals_request ON arc_disposals(request_id);

CREATE TABLE IF NOT EXISTS arc_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  record_class TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  ref TEXT NOT NULL,
  project_ref INTEGER,
  record_date TEXT,
  payload_json TEXT,
  payload_sha256 TEXT NOT NULL,
  job_id INTEGER NOT NULL REFERENCES arc_jobs(id),
  archived_at TEXT NOT NULL,
  disposed_at TEXT,
  disposal_action TEXT CHECK (disposal_action IS NULL OR disposal_action IN ('DISPOSE', 'ANONYMISE', 'ERASED')),
  disposal_id INTEGER REFERENCES arc_disposals(id),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_arc_records_entity ON arc_records(entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_arc_records_search ON arc_records(company_id, record_class, ref);
CREATE INDEX IF NOT EXISTS ix_arc_records_job ON arc_records(job_id);
CREATE INDEX IF NOT EXISTS ix_arc_records_disposal ON arc_records(disposal_id);

CREATE TABLE IF NOT EXISTS arc_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  reason TEXT NOT NULL,
  placed_by TEXT NOT NULL,
  released_at TEXT,
  released_by TEXT,
  release_reason TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_arc_holds_entity ON arc_holds(company_id, entity, entity_id, released_at);

CREATE TABLE IF NOT EXISTS arc_erasures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  subject_type TEXT NOT NULL CHECK (subject_type IN ('EMPLOYEE')),
  subject_id INTEGER NOT NULL,
  subject_label TEXT NOT NULL,
  basis TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'REFUSED', 'REJECTED', 'DONE')),
  request_id INTEGER REFERENCES core_change_requests(id),
  executed_at TEXT,
  fields_json TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_arc_erasures_company ON arc_erasures(company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_arc_erasures_request ON arc_erasures(request_id);

CREATE TABLE IF NOT EXISTS arc_bypass (token INTEGER NOT NULL);

CREATE TRIGGER IF NOT EXISTS trg_arc_ro_site_dprs_u BEFORE UPDATE ON site_dprs
WHEN EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = 'site_dprs' AND a.entity_id = OLD.id AND a.disposed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM arc_bypass)
BEGIN SELECT RAISE(ABORT, 'ARCHIVED: this record is archived and read-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_arc_ro_site_dprs_d BEFORE DELETE ON site_dprs
WHEN EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = 'site_dprs' AND a.entity_id = OLD.id AND a.disposed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM arc_bypass)
BEGIN SELECT RAISE(ABORT, 'ARCHIVED: this record is archived and read-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_arc_ro_fin_journals_u BEFORE UPDATE ON fin_journals
WHEN EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = 'fin_journals' AND a.entity_id = OLD.id AND a.disposed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM arc_bypass)
BEGIN SELECT RAISE(ABORT, 'ARCHIVED: this record is archived and read-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_arc_ro_fin_journals_d BEFORE DELETE ON fin_journals
WHEN EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = 'fin_journals' AND a.entity_id = OLD.id AND a.disposed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM arc_bypass)
BEGIN SELECT RAISE(ABORT, 'ARCHIVED: this record is archived and read-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_arc_ro_proc_purchase_orders_u BEFORE UPDATE ON proc_purchase_orders
WHEN EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = 'proc_purchase_orders' AND a.entity_id = OLD.id AND a.disposed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM arc_bypass)
BEGIN SELECT RAISE(ABORT, 'ARCHIVED: this record is archived and read-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_arc_ro_proc_purchase_orders_d BEFORE DELETE ON proc_purchase_orders
WHEN EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = 'proc_purchase_orders' AND a.entity_id = OLD.id AND a.disposed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM arc_bypass)
BEGIN SELECT RAISE(ABORT, 'ARCHIVED: this record is archived and read-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_arc_ro_hr_employees_u BEFORE UPDATE ON hr_employees
WHEN EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = 'hr_employees' AND a.entity_id = OLD.id AND a.disposed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM arc_bypass)
BEGIN SELECT RAISE(ABORT, 'ARCHIVED: this record is archived and read-only'); END;
CREATE TRIGGER IF NOT EXISTS trg_arc_ro_hr_employees_d BEFORE DELETE ON hr_employees
WHEN EXISTS (SELECT 1 FROM arc_records a WHERE a.entity = 'hr_employees' AND a.entity_id = OLD.id AND a.disposed_at IS NULL) AND NOT EXISTS (SELECT 1 FROM arc_bypass)
BEGIN SELECT RAISE(ABORT, 'ARCHIVED: this record is archived and read-only'); END;

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('admin-archive','g-administration','page','sidebar','Retention & Archival','प्रतिधारण और संग्रह','/admin/archive','erp.insights.rb','adm.archive.view','ff.admin.p2907',7,'retention archive archival legal hold disposal destruction certificate dpdp personal data erasure policy',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.archive','ui','Retention & Archival','/admin/archive','/admin/archive','LIST','MIGRATED','SYSADM','29.07','system','2026-11-22T00:00:00.000Z','[]','Retention policies, archival jobs, legal holds, the archive, disposal and DPDP erasure.','migration','reference_seed');
