-- Part 27.06: daily execution intelligence and work-done / WIP valuation. Money in paise, hours in thousandths (the DPR convention).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bi.p2706', 'Daily execution intelligence and work-done / WIP valuation (part 27.06)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS dei_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  project_id INTEGER NOT NULL REFERENCES org_projects(id),
  site_id INTEGER REFERENCES org_sites(id),
  site_key INTEGER NOT NULL DEFAULT 0,
  snap_date TEXT NOT NULL CHECK (snap_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  planned_value INTEGER NOT NULL DEFAULT 0 CHECK (planned_value >= 0),
  executed_value INTEGER NOT NULL DEFAULT 0 CHECK (executed_value >= 0),
  cost_value INTEGER CHECK (cost_value IS NULL OR cost_value >= 0),
  wip_value INTEGER CHECK (wip_value IS NULL OR wip_value >= 0),
  cum_value INTEGER CHECK (cum_value IS NULL OR cum_value >= 0),
  billed_gap_value INTEGER CHECK (billed_gap_value IS NULL OR billed_gap_value >= 0),
  balance_value INTEGER CHECK (balance_value IS NULL OR balance_value >= 0),
  labour_count INTEGER NOT NULL DEFAULT 0 CHECK (labour_count >= 0),
  plant_hours INTEGER NOT NULL DEFAULT 0 CHECK (plant_hours >= 0),
  idle_hours INTEGER NOT NULL DEFAULT 0 CHECK (idle_hours >= 0),
  hindrances_open INTEGER NOT NULL DEFAULT 0 CHECK (hindrances_open >= 0),
  rfis_raised INTEGER CHECK (rfis_raised IS NULL OR rfis_raised >= 0),
  rfis_answered INTEGER CHECK (rfis_answered IS NULL OR rfis_answered >= 0),
  rfis_open INTEGER CHECK (rfis_open IS NULL OR rfis_open >= 0),
  snapshot_json TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CAPTURED' CHECK (status = 'CAPTURED'),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'site_dprs',
  source_id TEXT,
  remarks TEXT,
  UNIQUE (company_id, project_id, site_key, snap_date),
  CHECK ((site_id IS NULL AND site_key = 0) OR site_key = site_id)
);
CREATE INDEX IF NOT EXISTS ix_dei_daily_company_status ON dei_daily(company_id, status);
CREATE INDEX IF NOT EXISTS ix_dei_daily_date ON dei_daily(company_id, snap_date, site_key);
CREATE INDEX IF NOT EXISTS ix_dei_daily_project ON dei_daily(project_id, snap_date);
CREATE INDEX IF NOT EXISTS ix_dei_daily_site ON dei_daily(site_id, snap_date);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('bi-execution','g-reports','page','sidebar','Daily Execution Intelligence','दैनिक निष्पादन विश्लेषण','/bi/execution','erp.insights.rb','bi.execution.view','ff.bi.p2706',47,'work done value wip valuation execution daily site labour plant',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('bi.execution','ui','Daily Execution Intelligence','/bi/execution','/bi/execution','DASHBOARD','MIGRATED','PM','27.06','system','2026-11-21T00:00:00.000Z','[]','Daily work done, WIP valuation and site comparison.','migration','reference_seed');
INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES ('bi.work_done_today','bi','Work done today','आज का कार्य मूल्य','Value of today''s approved DPR quantities at contract rates.','kpi','/api/v1/ui/widgets/bi.work_done_today/data','bi.execution.view',3,1,300,'/bi/execution',520,'migration','reference_seed');
INSERT OR IGNORE INTO proj_360_widgets
  (company_id,widget_code,module,tab,slot,sort_order,permission_key,owner_part,title,title_hi,created_by,source_type)
VALUES (NULL,'bi.work_done_today','bi','time','main',95,'bi.execution.view','27.06','Work done today','आज का कार्य मूल्य','migration','reference_seed');
