-- Part 28.03: forecasting, anomaly detection and rate intelligence. aif_models is the registry of forecast model versions (method, parameters,
-- back-test; activation approved model owner → CFO/PCMGR); aif_forecasts keeps the official forecasts, apart from every actual (BR-01);
-- aif_anomalies holds the statistical outliers flagged for review, each naming its source record.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.ai.p2803', 'Forecasting, anomaly detection and rate intelligence (part 28.03)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS aif_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  code TEXT NOT NULL CHECK (code GLOB '[A-Z]*'),
  name TEXT NOT NULL,
  use_case TEXT NOT NULL CHECK (use_case IN ('RATE', 'COLLECTIONS', 'PRODUCTIVITY', 'COMPLETION')),
  method TEXT NOT NULL CHECK (method IN ('MOVING_AVERAGE', 'HOLT', 'REGRESSION')),
  params_json TEXT NOT NULL DEFAULT '{}',
  horizon INTEGER NOT NULL DEFAULT 6 CHECK (horizon BETWEEN 1 AND 24),
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  parent_id INTEGER REFERENCES aif_models(id),
  backtest_json TEXT,
  backtest_at TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','RETURNED','APPROVED','REJECTED','CANCELLED','SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  cancel_reason TEXT,
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
  site_id INTEGER,
  UNIQUE (company_id, doc_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_aif_models_version ON aif_models(company_id, code, version_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_aif_models_use_case ON aif_models(company_id, use_case, status);
CREATE INDEX IF NOT EXISTS ix_aif_models_parent ON aif_models(parent_id);
CREATE INDEX IF NOT EXISTS ix_aif_models_workflow ON aif_models(workflow_instance_id);

CREATE TABLE IF NOT EXISTS aif_forecasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  model_id INTEGER NOT NULL REFERENCES aif_models(id),
  use_case TEXT NOT NULL CHECK (use_case IN ('RATE', 'COLLECTIONS', 'PRODUCTIVITY', 'COMPLETION')),
  subject_key TEXT NOT NULL,
  subject_label TEXT NOT NULL,
  as_of TEXT NOT NULL,
  points_json TEXT NOT NULL,
  next_value NUMERIC(18,4),
  next_low NUMERIC(18,4),
  next_high NUMERIC(18,4),
  completion_json TEXT,
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
  project_id INTEGER REFERENCES org_projects(id),
  site_id INTEGER,
  UNIQUE (company_id, model_id, subject_key, as_of)
);
CREATE INDEX IF NOT EXISTS ix_aif_forecasts_model ON aif_forecasts(model_id, subject_key);
CREATE INDEX IF NOT EXISTS ix_aif_forecasts_project ON aif_forecasts(project_id);
CREATE INDEX IF NOT EXISTS ix_aif_forecasts_company_as_of ON aif_forecasts(company_id, as_of);

CREATE TABLE IF NOT EXISTS aif_anomalies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  kind TEXT NOT NULL CHECK (kind IN ('RATE', 'CONSUMPTION', 'ATTENDANCE', 'PAYMENT', 'PAYROLL_NO_ATTENDANCE')),
  subject TEXT NOT NULL,
  observed NUMERIC(18,4),
  expected NUMERIC(18,4),
  score NUMERIC(18,4),
  detail TEXT NOT NULL,
  route TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CONFIRMED', 'DISMISSED')),
  detected_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  source_ref TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  remarks TEXT,
  project_id INTEGER REFERENCES org_projects(id),
  site_id INTEGER REFERENCES org_sites(id),
  UNIQUE (company_id, kind, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS ix_aif_anomalies_status ON aif_anomalies(company_id, status, kind);
CREATE INDEX IF NOT EXISTS ix_aif_anomalies_project ON aif_anomalies(project_id);
CREATE INDEX IF NOT EXISTS ix_aif_anomalies_site ON aif_anomalies(site_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('ai-forecasts','g-reports','page','sidebar','Forecasts & Anomalies','पूर्वानुमान एवं विसंगतियाँ','/ai/forecasts','erp.insights.rb','ai.forecast.view','ff.ai.p2803',53,'forecast prediction rate cash collections productivity completion anomaly outlier back-test model',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('ai.forecasts','ui','Forecasts & Anomalies','/ai/forecasts','/ai/forecasts','DASHBOARD','MIGRATED','PCMGR','28.03','system','2026-11-22T00:00:00.000Z','[]','Forecasts with ranges and drivers, anomalies to review, the model registry and the back-testing report.','migration','reference_seed');
INSERT OR IGNORE INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type) VALUES
  (NULL, 'ai.model.decided', 'approvals', 'IN_APP', 'en', 'Forecast model {{ref}}: {{subject}}', '{{detail}} {{link}}', '["ref","subject","detail","link"]', 1, 'ACTIVE', 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES ('ai.forecast_anomalies','ai','Anomalies to review','समीक्षा हेतु विसंगतियाँ','Open statistical anomalies and the latest official forecasts.','kpi','/api/v1/ui/widgets/ai.forecast_anomalies/data','ai.forecast.view',3,1,600,'/ai/forecasts?tab=anomalies',545,'migration','reference_seed');
INSERT OR IGNORE INTO proj_360_widgets
  (company_id,widget_code,module,tab,slot,sort_order,permission_key,owner_part,title,title_hi,created_by,source_type)
VALUES (NULL,'ai.forecast_anomalies','ai','cost','side',98,'ai.forecast.view','28.03','Forecasts and anomalies','पूर्वानुमान एवं विसंगतियाँ','migration','reference_seed');
