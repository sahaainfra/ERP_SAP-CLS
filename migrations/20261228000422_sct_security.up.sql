-- Part 30.05: security hardening and penetration testing. sct_scan_runs keeps each scan (authorisation matrix, SAST, secrets, dependencies, DAST);
-- sct_findings keeps every finding of a scan or of a tester with its remediation (fixed in, re-tested by someone else) or its accepted risk
-- (maker-checker through core_change_requests type sct_risk_acceptance); sct_reviews keeps the review of each DPDP and sensitive-path control.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3005', 'Security findings and remediation (part 30.05)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS sct_scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  scan_kind TEXT NOT NULL CHECK (scan_kind IN ('AUTHZ', 'SAST', 'SECRETS', 'DEPENDENCIES', 'DAST')),
  status TEXT NOT NULL DEFAULT 'DONE' CHECK (status IN ('DONE', 'FAILED')),
  checked_count INTEGER NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  findings_count INTEGER NOT NULL DEFAULT 0 CHECK (findings_count >= 0),
  summary_json TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  requested_by TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_sct_scan_runs_no ON sct_scan_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_sct_scan_runs_kind ON sct_scan_runs(company_id, scan_kind, id);
CREATE INDEX IF NOT EXISTS ix_sct_scan_runs_status ON sct_scan_runs(company_id, status);

CREATE TABLE IF NOT EXISTS sct_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  finding_no TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('AUTHZ', 'SAST', 'SECRETS', 'DEPENDENCIES', 'DAST', 'PENTEST', 'MOBILE', 'REVIEW')),
  severity TEXT NOT NULL CHECK (severity IN ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO')),
  title TEXT NOT NULL,
  description TEXT,
  endpoint TEXT,
  cwe TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FIXED', 'CLOSED', 'RISK_PENDING', 'ACCEPTED', 'FALSE_POSITIVE')),
  scan_run_id INTEGER REFERENCES sct_scan_runs(id),
  reported_by TEXT NOT NULL,
  fixed_in TEXT,
  fixed_by TEXT,
  fixed_at TEXT,
  retested_by TEXT,
  retested_at TEXT,
  retest_note TEXT,
  request_id INTEGER REFERENCES core_change_requests(id),
  last_seen_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_sct_findings_no ON sct_findings(company_id, finding_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sct_findings_fp ON sct_findings(company_id, fingerprint);
CREATE INDEX IF NOT EXISTS ix_sct_findings_status ON sct_findings(company_id, status, severity);
CREATE INDEX IF NOT EXISTS ix_sct_findings_source ON sct_findings(company_id, source);
CREATE INDEX IF NOT EXISTS ix_sct_findings_run ON sct_findings(scan_run_id);
CREATE INDEX IF NOT EXISTS ix_sct_findings_request ON sct_findings(request_id);

CREATE TABLE IF NOT EXISTS sct_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  control_code TEXT NOT NULL,
  area TEXT NOT NULL CHECK (area IN ('DPDP', 'PATH')),
  status TEXT NOT NULL CHECK (status IN ('PASS', 'GAP', 'NA')),
  evidence TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_sct_reviews_control ON sct_reviews(company_id, control_code, id);
CREATE INDEX IF NOT EXISTS ix_sct_reviews_status ON sct_reviews(company_id, status);

INSERT OR IGNORE INTO ntf_templates (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type) VALUES
  ('sct.finding.raised','security','IN_APP','en','Security finding {{finding}} ({{severity}})','{{title}} — {{source}}.','["finding","severity","title","source"]','ACTIVE','migration','reference_seed'),
  ('sct.finding.raised','security','EMAIL','en','Security finding {{finding}} ({{severity}})','{{title}} — {{source}}. Open Security Findings & Remediation.','["finding","severity","title","source"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('sct-security-findings','g-administration','page','sidebar','Security Findings','सुरक्षा निष्कर्ष','/admin/security-findings','erp.insights.rb','sct.finding.view','ff.qa.p3005',24,'security findings remediation penetration test pen test dast sast secrets dependencies authorisation idor dpdp retest go-live',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.security-findings','ui','Security Findings & Remediation','/admin/security-findings','/admin/security-findings','REPORT','MIGRATED','ITADM','30.05','system','2026-11-24T00:00:00.000Z','[]','Scans, findings, remediation and re-test, the DPDP and sensitive-path reviews (restricted).','migration','reference_seed');
