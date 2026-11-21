CREATE TABLE IF NOT EXISTS rpt_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  owner_id INTEGER NOT NULL REFERENCES iam_users(id),
  saved_view_id INTEGER REFERENCES ui_saved_views(id),
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('DAILY','WEEKLY','MONTHLY')),
  format TEXT NOT NULL CHECK (format IN ('csv','xlsx','pdf')),
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP','EMAIL','WHATSAPP')),
  lifecycle_state TEXT,
  next_run_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT NOT NULL,
  updated_at TEXT,
  updated_by TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  source_type TEXT NOT NULL,
  source_id TEXT,
  remarks TEXT
);
CREATE INDEX IF NOT EXISTS ix_rpt_subscriptions_company_status ON rpt_subscriptions(company_id, status);
CREATE INDEX IF NOT EXISTS ix_rpt_subscriptions_owner ON rpt_subscriptions(owner_id, company_id);
CREATE INDEX IF NOT EXISTS ix_rpt_subscriptions_view ON rpt_subscriptions(saved_view_id);
CREATE INDEX IF NOT EXISTS ix_rpt_subscriptions_due ON rpt_subscriptions(status, next_run_at) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_rpt_subscriptions_name ON rpt_subscriptions(company_id, owner_id, name COLLATE NOCASE) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS rpt_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  subscription_id INTEGER NOT NULL REFERENCES rpt_subscriptions(id),
  subscription_version INTEGER NOT NULL,
  report_name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP','EMAIL','WHATSAPP')),
  export_id INTEGER REFERENCES ui_export_jobs(id),
  notification_id INTEGER REFERENCES ntf_notifications(id),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('QUEUED','READY','FAILED','SKIPPED')),
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT NOT NULL DEFAULT 'scheduler',
  updated_at TEXT,
  updated_by TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  source_type TEXT NOT NULL DEFAULT 'report_subscription',
  source_id TEXT,
  remarks TEXT
);
CREATE INDEX IF NOT EXISTS ix_rpt_runs_company_status ON rpt_runs(company_id, status);
CREATE INDEX IF NOT EXISTS ix_rpt_runs_company_date ON rpt_runs(company_id, scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rpt_runs_slot ON rpt_runs(subscription_id, scheduled_at);
CREATE INDEX IF NOT EXISTS ix_rpt_runs_export ON rpt_runs(export_id);
CREATE INDEX IF NOT EXISTS ix_rpt_runs_notification ON rpt_runs(notification_id);
CREATE INDEX IF NOT EXISTS ix_rpt_runs_pending ON rpt_runs(status, id);

INSERT OR IGNORE INTO ntf_templates
  (code, category, channel, lang, subject, body, variables_json, status, created_by, source_type)
VALUES
  ('bi.report.ready', 'system', 'IN_APP', 'en', 'Scheduled report ready', 'Your scheduled report is available in My Exports.', '[]', 'ACTIVE', 'migration', 'reference_seed'),
  ('bi.report.ready', 'system', 'EMAIL', 'en', 'Scheduled report ready', 'Sign in to ERP and open My Exports to download your scheduled report.', '[]', 'ACTIVE', 'migration', 'reference_seed'),
  ('bi.report.ready', 'system', 'WHATSAPP', 'en', 'Scheduled report ready', 'Sign in to ERP and open My Exports to download your scheduled report.', '[]', 'ACTIVE', 'migration', 'reference_seed');

INSERT OR IGNORE INTO ui_navigation_entries
  (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, created_by, source_type)
VALUES
  ('bi-report-subscriptions', 'g-reports', 'page', 'sidebar', 'Report Subscriptions', 'रिपोर्ट सदस्यताएँ', '/bi/subscriptions', 'erp.insights.rb', 'proj.project.export', 'ff.bi.p2701', 45, 'schedule subscriptions report delivery', 1, 'none', 'migration', 'reference_seed'),
  ('bi-report-usage', 'g-reports', 'page', 'sidebar', 'Report Usage', 'रिपोर्ट उपयोग', '/bi/usage', 'erp.insights.rb', 'core.audit.view', 'ff.bi.p2701', 50, 'report usage exports runs', 1, 'none', 'migration', 'reference_seed');

INSERT OR IGNORE INTO ui_page_migration
  (page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, migrated_by, migrated_at, defects_json, notes, created_by, source_type)
VALUES
  ('bi.subscriptions', 'ui', 'Report Subscriptions', '/bi/subscriptions', '/bi/subscriptions', 'FORM', 'MIGRATED', 'PD', '27.01', 'system', '2026-11-21T00:00:00.000Z', '[]', 'Personal report schedules and run history.', 'migration', 'reference_seed'),
  ('bi.usage', 'ui', 'Report Usage', '/bi/usage', '/bi/usage', 'REPORT', 'MIGRATED', 'AUD', '27.01', 'system', '2026-11-21T00:00:00.000Z', '[]', 'Company-level counts from export audits and scheduled runs.', 'migration', 'reference_seed');
