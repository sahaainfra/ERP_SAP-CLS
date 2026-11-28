-- PACK-07: the working contexts (project, site) a person chose most recently, newest first, for the shell's context switcher; at most
-- five are kept per person and company (src/server/modules/ui/shell.js). One row per person, company and context.
CREATE TABLE IF NOT EXISTS ui_context_recent (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref      TEXT    NOT NULL,
  project_id    INTEGER,
  site_id       INTEGER,
  status        TEXT    NOT NULL DEFAULT 'DRAFT',
  workflow_instance_id INTEGER,
  context_project_id INTEGER REFERENCES org_projects(id),
  context_site_id INTEGER REFERENCES org_sites(id),
  used_at       TEXT    NOT NULL,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE INDEX IF NOT EXISTS ix_ui_context_recent_company_status ON ui_context_recent (company_id, status);
CREATE INDEX IF NOT EXISTS ix_ui_context_recent_context_project_id ON ui_context_recent (context_project_id);
CREATE INDEX IF NOT EXISTS ix_ui_context_recent_context_site_id ON ui_context_recent (context_site_id);
CREATE INDEX IF NOT EXISTS ix_ui_context_recent_project ON ui_context_recent (project_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_context_recent_person_context ON ui_context_recent (company_id, user_ref, COALESCE(context_project_id, 0), COALESCE(context_site_id, 0));
CREATE INDEX IF NOT EXISTS ix_ui_context_recent_person_used ON ui_context_recent (company_id, user_ref, used_at);

-- the switcher's recent contexts and keyboard (client) ship behind this flag, OFF by default
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.ui.pack07', 'Context switcher: recent contexts and keyboard choice (PACK-07)', 0, 0, 'migration', 'reference_seed');
