-- Part 30.10: UAT, production cut-over and hypercare. golive_checklist is the readiness checklist (FR-02: gates, security, performance,
-- backups, documentation, support, training, UAT, dry run), evaluated from the records of the earlier parts or confirmed with evidence;
-- uat_scripts are the UAT scripts per module and role (FR-01), uat_defects the defects found in UAT and in hypercare with their triage,
-- uat_signoffs the sign-off of each module by its owner; golive_cutover_runs and golive_cutover_steps the cut-over runbook (FR-03: timeline,
-- owners, rollback point; dry run and production); golive_decisions the go/no-go meeting and its approval (FR-04, BR-01: programme manager,
-- CFO, DIR); golive_hypercare the hypercare period and its handover, golive_hypercare_days the daily report (FR-05).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.qa.p3010', 'UAT, production cut-over and hypercare (part 30.10)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS golive_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  criterion TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('GATES', 'SECURITY', 'PERFORMANCE', 'OPERATIONS', 'DOCUMENTATION', 'SUPPORT', 'TRAINING', 'UAT', 'CUTOVER')),
  mandatory INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0,1)),
  evaluation TEXT NOT NULL CHECK (evaluation IN ('AUTO', 'MANUAL')),
  owner_role TEXT NOT NULL,
  owner_id TEXT,
  evidence_links TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'NOT_MET', 'MET', 'WAIVED')),
  detail TEXT,
  measured_value NUMERIC(18,4),
  target_value NUMERIC(18,4),
  checked_by TEXT,
  checked_at TEXT,
  waiver_reason TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_golive_checklist_criterion ON golive_checklist(company_id, criterion);
CREATE INDEX IF NOT EXISTS ix_golive_checklist_status ON golive_checklist(company_id, status);

CREATE TABLE IF NOT EXISTS uat_scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  code TEXT NOT NULL,
  module TEXT NOT NULL,
  role_code TEXT NOT NULL,
  title TEXT NOT NULL,
  scenario_source TEXT NOT NULL CHECK (scenario_source IN ('WORKFLOW', 'PAGE', 'MANUAL')),
  steps_json TEXT NOT NULL DEFAULT '[]',
  expected TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NOT_RUN' CHECK (status IN ('NOT_RUN', 'PASS', 'FAIL', 'BLOCKED')),
  executed_by TEXT,
  executed_at TEXT,
  notes TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_uat_scripts_code ON uat_scripts(company_id, code);
CREATE INDEX IF NOT EXISTS ix_uat_scripts_module ON uat_scripts(company_id, module, status);

CREATE TABLE IF NOT EXISTS uat_defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  defect_no TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('UAT', 'HYPERCARE')),
  module TEXT NOT NULL,
  script_id INTEGER REFERENCES uat_scripts(id),
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('S1', 'S2', 'S3', 'S4')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'TRIAGED', 'FIXED', 'CLOSED', 'DEFERRED')),
  owner_id TEXT,
  reported_by TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  triaged_by TEXT,
  triaged_at TEXT,
  fixed_in TEXT,
  fixed_at TEXT,
  closed_by TEXT,
  closed_at TEXT,
  deferred_reason TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_uat_defects_no ON uat_defects(company_id, defect_no);
CREATE INDEX IF NOT EXISTS ix_uat_defects_open ON uat_defects(company_id, status, severity);
CREATE INDEX IF NOT EXISTS ix_uat_defects_module ON uat_defects(company_id, module);
CREATE INDEX IF NOT EXISTS ix_uat_defects_script ON uat_defects(script_id);

CREATE TABLE IF NOT EXISTS uat_signoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  module TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'SIGNED', 'REJECTED', 'SUPERSEDED')),
  scripts_total INTEGER NOT NULL DEFAULT 0 CHECK (scripts_total >= 0),
  scripts_passed INTEGER NOT NULL DEFAULT 0 CHECK (scripts_passed >= 0),
  open_defects INTEGER NOT NULL DEFAULT 0 CHECK (open_defects >= 0),
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  signed_by TEXT,
  signed_at TEXT,
  request_id INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_uat_signoffs_module ON uat_signoffs(company_id, module, status);
CREATE INDEX IF NOT EXISTS ix_uat_signoffs_request ON uat_signoffs(request_id);

CREATE TABLE IF NOT EXISTS golive_cutover_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_no TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DRY_RUN', 'PRODUCTION')),
  window_minutes INTEGER NOT NULL CHECK (window_minutes > 0),
  planned_start TEXT,
  status TEXT NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'ROLLED_BACK')),
  rollback_point TEXT,
  decision_id INTEGER,
  started_at TEXT,
  finished_at TEXT,
  elapsed_minutes NUMERIC(18,2),
  within_window INTEGER CHECK (within_window IS NULL OR within_window IN (0,1)),
  started_by TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_golive_cutover_runs_no ON golive_cutover_runs(company_id, run_no);
CREATE INDEX IF NOT EXISTS ix_golive_cutover_runs_status ON golive_cutover_runs(company_id, kind, status);
CREATE INDEX IF NOT EXISTS ix_golive_cutover_runs_decision ON golive_cutover_runs(decision_id);

CREATE TABLE IF NOT EXISTS golive_cutover_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  run_id INTEGER NOT NULL REFERENCES golive_cutover_runs(id),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('AUTO', 'MANUAL')),
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED')),
  started_at TEXT,
  finished_at TEXT,
  done_by TEXT,
  detail TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_golive_cutover_steps_seq ON golive_cutover_steps(run_id, seq);
CREATE INDEX IF NOT EXISTS ix_golive_cutover_steps_company ON golive_cutover_steps(company_id, status);

CREATE TABLE IF NOT EXISTS golive_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  decision_no TEXT NOT NULL,
  meeting_at TEXT NOT NULL,
  attendees_json TEXT NOT NULL DEFAULT '[]',
  recommendation TEXT NOT NULL CHECK (recommendation IN ('GO', 'NO_GO')),
  go_live_at TEXT,
  criteria_json TEXT NOT NULL DEFAULT '[]',
  minutes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED')),
  request_id INTEGER,
  decided_at TEXT,
  communicated_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_golive_decisions_no ON golive_decisions(company_id, decision_no);
CREATE INDEX IF NOT EXISTS ix_golive_decisions_status ON golive_decisions(company_id, status);
CREATE INDEX IF NOT EXISTS ix_golive_decisions_request ON golive_decisions(request_id);

CREATE TABLE IF NOT EXISTS golive_hypercare (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  decision_id INTEGER REFERENCES golive_decisions(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'HANDOVER_REQUESTED', 'HANDED_OVER')),
  war_room_json TEXT NOT NULL DEFAULT '[]',
  handover_notes TEXT,
  handover_request_id INTEGER,
  handed_over_by TEXT,
  handed_over_at TEXT,
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
CREATE INDEX IF NOT EXISTS ix_golive_hypercare_status ON golive_hypercare(company_id, status);
CREATE INDEX IF NOT EXISTS ix_golive_hypercare_decision ON golive_hypercare(decision_id);

CREATE TABLE IF NOT EXISTS golive_hypercare_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  hypercare_id INTEGER NOT NULL REFERENCES golive_hypercare(id),
  report_date TEXT NOT NULL,
  opened_count INTEGER NOT NULL DEFAULT 0 CHECK (opened_count >= 0),
  closed_count INTEGER NOT NULL DEFAULT 0 CHECK (closed_count >= 0),
  open_by_severity_json TEXT NOT NULL DEFAULT '{}',
  kpis_json TEXT NOT NULL DEFAULT '{}',
  triage_notes TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
  published_by TEXT,
  published_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_golive_hypercare_days_date ON golive_hypercare_days(hypercare_id, report_date);
CREATE INDEX IF NOT EXISTS ix_golive_hypercare_days_company ON golive_hypercare_days(company_id, report_date);

INSERT OR IGNORE INTO ntf_templates (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type) VALUES
  ('golive.announcement','system','IN_APP','en','The ERP goes live on {{goLiveAt}}','{{message}}','["goLiveAt","message"]','ACTIVE','migration','reference_seed'),
  ('golive.announcement','system','EMAIL','en','The ERP goes live on {{goLiveAt}}','{{message}} Your manuals are in Help › Documentation Library.','["goLiveAt","message"]','ACTIVE','migration','reference_seed'),
  ('golive.hypercare.daily','system','IN_APP','en','Hypercare day {{date}}: {{open}} open defects','{{opened}} opened, {{closed}} closed; S1 {{s1}}, S2 {{s2}}.','["date","open","opened","closed","s1","s2"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('golive-readiness','g-administration','page','sidebar','Go-Live Readiness','गो-लाइव तैयारी','/admin/go-live','erp.state.approved','golive.view','ff.qa.p3010',28,'go live readiness checklist uat user acceptance test sign-off cut-over dry run rollback go no-go decision hypercare war room daily report handover',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.go-live','ui','Go-Live Readiness','/admin/go-live','/admin/go-live','WORKLIST','MIGRATED','PCMGR','30.10','system','2026-11-24T00:00:00.000Z','[]','The readiness checklist as a board, UAT status by module, the cut-over runbook and dry run, the go/no-go decision and the hypercare daily report.','migration','reference_seed');
