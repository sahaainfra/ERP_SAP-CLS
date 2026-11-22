-- Part 29.06: backup, restore and disaster recovery. ops_backups records every full and snapshot backup of the database (a platform
-- table: one database serves every company) with its size, local and off-site location, checksums, manifest and retention tiers;
-- ops_restore_tests every isolated restore test and DR drill with its checks and the measured restore time and data-loss window;
-- ops_backup_alerts the monitoring alerts; ops_restore_requests the production restores, approved by ITADM then DIR
-- (core_change_requests type ops_production_restore) and executed by the operator.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.admin.p2906', 'Backup, restore and disaster recovery (part 29.06)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS ops_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('FULL', 'SNAPSHOT')),
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  size_bytes INTEGER CHECK (size_bytes IS NULL OR size_bytes >= 0),
  location TEXT,
  offsite_location TEXT,
  checksum TEXT,
  offsite_checksum TEXT,
  encrypted INTEGER NOT NULL DEFAULT 0 CHECK (encrypted IN (0,1)),
  table_count INTEGER,
  row_count INTEGER,
  manifest_json TEXT,
  tiers_json TEXT,
  files_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'VERIFIED', 'FAILED', 'EXPIRED')),
  error TEXT,
  expired_at TEXT,
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
  remarks TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ops_backups_name ON ops_backups(name);
CREATE INDEX IF NOT EXISTS ix_ops_backups_status ON ops_backups(status, finished_at);
CREATE INDEX IF NOT EXISTS ix_ops_backups_type ON ops_backups(backup_type, status, started_at);

CREATE TABLE IF NOT EXISTS ops_restore_tests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_id INTEGER NOT NULL REFERENCES ops_backups(id),
  kind TEXT NOT NULL DEFAULT 'TEST' CHECK (kind IN ('TEST', 'DRILL')),
  environment TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  validated INTEGER NOT NULL DEFAULT 0 CHECK (validated IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'PASSED', 'FAILED')),
  checks_json TEXT,
  restore_minutes TEXT,
  data_loss_minutes TEXT,
  rto_target INTEGER,
  rpo_target INTEGER,
  report_file_id INTEGER REFERENCES core_files(id),
  note TEXT,
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
  remarks TEXT
);
CREATE INDEX IF NOT EXISTS ix_ops_restore_tests_backup ON ops_restore_tests(backup_id);
CREATE INDEX IF NOT EXISTS ix_ops_restore_tests_kind ON ops_restore_tests(kind, status, id);
CREATE INDEX IF NOT EXISTS ix_ops_restore_tests_report ON ops_restore_tests(report_file_id);

CREATE TABLE IF NOT EXISTS ops_backup_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_code TEXT NOT NULL CHECK (check_code IN ('full', 'rpo', 'failed', 'offsite', 'drill')),
  message TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
  fired_at TEXT NOT NULL,
  resolved_at TEXT,
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
  remarks TEXT
);
CREATE INDEX IF NOT EXISTS ix_ops_backup_alerts_open ON ops_backup_alerts(check_code, status);

CREATE TABLE IF NOT EXISTS ops_restore_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  backup_id INTEGER NOT NULL REFERENCES ops_backups(id),
  incident_ref TEXT NOT NULL,
  incident_summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'EXECUTED')),
  request_id INTEGER REFERENCES core_change_requests(id),
  approved_by TEXT,
  approved_at TEXT,
  executed_at TEXT,
  executed_by TEXT,
  safety_copy TEXT,
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
CREATE INDEX IF NOT EXISTS ix_ops_restore_requests_company ON ops_restore_requests(company_id, status);
CREATE INDEX IF NOT EXISTS ix_ops_restore_requests_backup ON ops_restore_requests(backup_id);
CREATE INDEX IF NOT EXISTS ix_ops_restore_requests_request ON ops_restore_requests(request_id);

INSERT OR IGNORE INTO ntf_templates
  (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type)
VALUES ('admin.backup.alert','alerts','IN_APP','en','Backup alert: {{check}}','{{message}}','["check","message"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('admin-backups','g-administration','page','sidebar','Backup & DR','बैकअप और डीआर','/admin/backups','erp.insights.rb','adm.backup.view','ff.admin.p2906',6,'backup restore disaster recovery dr drill rpo rto retention off-site encryption snapshot',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.backups','ui','Backup & DR','/admin/backups','/admin/backups','DASHBOARD','MIGRATED','ITADM','29.06','system','2026-11-22T00:00:00.000Z','[]','Backup and DR status with backups, restore tests and drills, alerts and production restores.','migration','reference_seed');
