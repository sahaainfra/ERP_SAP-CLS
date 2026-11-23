-- Part 27.11: scenario and what-if simulation. A scenario keeps its drivers and the results computed on copies of the approved forecast (23.11),
-- the current schedule (13.01) and the approved 13-week cash forecast (23.13) with the references of those sources; it never changes them (BR-01).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bi.p2711', 'Scenario and what-if simulation (part 27.11)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS scn_scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  name TEXT NOT NULL,
  project_id INTEGER REFERENCES org_projects(id),
  scope_json TEXT NOT NULL DEFAULT '{}',
  drivers_json TEXT NOT NULL DEFAULT '[]',
  results_json TEXT,
  base_json TEXT,
  overhead_per_day INTEGER NOT NULL DEFAULT 0 CHECK (overhead_per_day >= 0),
  eac_delta INTEGER,
  margin_delta INTEGER,
  finish_delta_days INTEGER,
  cash_low_delta INTEGER,
  computed_at TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SAVED', 'ARCHIVED')),
  shared_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
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
  site_id INTEGER,
  UNIQUE (company_id, doc_no)
);
CREATE INDEX IF NOT EXISTS ix_scn_scenarios_company_status ON scn_scenarios(company_id, status);
CREATE INDEX IF NOT EXISTS ix_scn_scenarios_project ON scn_scenarios(project_id);
CREATE INDEX IF NOT EXISTS ix_scn_scenarios_owner ON scn_scenarios(company_id, created_by);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('bi-scenarios','g-reports','page','sidebar','Scenario Builder','परिदृश्य निर्माता','/bi/scenarios','erp.insights.rb','bi.scenario.view','ff.bi.p2711',52,'scenario what if simulation price wage productivity delay cash eac margin completion compare',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('bi.scenarios','ui','Scenario Builder','/bi/scenarios','/bi/scenarios','FORM','MIGRATED','CFO','27.11','system','2026-11-21T00:00:00.000Z','[]','What-if scenarios on copies of the forecast, schedule and cash forecast, and the scenario comparison.','migration','reference_seed');
INSERT OR IGNORE INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type)
VALUES (NULL, 'bi.scenario.shared', 'mentions', 'IN_APP', 'en', 'Scenario {{docNo}} shared with you', '{{actor}} shared the what-if scenario {{docNo}}: {{name}}.', '["docNo","name","actor"]', 1, 'ACTIVE', 'migration', 'reference_seed');
