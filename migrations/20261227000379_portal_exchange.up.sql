-- Portal messages are addressed to one external account. A share points to one issued revision.
CREATE TABLE IF NOT EXISTS ptl_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  account_id INTEGER NOT NULL REFERENCES ptl_accounts(id),
  doc_no TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('NOTICE','PROFILE_REQUEST')),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('UNREAD','READ','REQUESTED','CLOSED')),
  submission_key TEXT,
  project_id INTEGER,
  site_id INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  deleted_at TEXT,
  deleted_by TEXT,
  source_type TEXT,
  source_id TEXT,
  remarks TEXT,
  UNIQUE(company_id, doc_no),
  UNIQUE(account_id, submission_key)
);
CREATE INDEX IF NOT EXISTS ix_ptl_messages_account ON ptl_messages(account_id, id);
CREATE INDEX IF NOT EXISTS ix_ptl_messages_company_status ON ptl_messages(company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_ptl_messages_company_kind ON ptl_messages(company_id, kind, id);

CREATE TABLE IF NOT EXISTS ptl_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  account_id INTEGER NOT NULL REFERENCES ptl_accounts(id),
  version_id INTEGER NOT NULL REFERENCES doc_versions(id),
  doc_no TEXT NOT NULL,
  project_id INTEGER,
  site_id INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  deleted_at TEXT,
  deleted_by TEXT,
  source_type TEXT,
  source_id TEXT,
  remarks TEXT,
  UNIQUE(company_id, doc_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptl_shares_active ON ptl_shares(account_id, version_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ptl_shares_version ON ptl_shares(version_id);
CREATE INDEX IF NOT EXISTS ix_ptl_shares_account ON ptl_shares(account_id, id);
CREATE INDEX IF NOT EXISTS ix_ptl_shares_company ON ptl_shares(company_id, id);

CREATE TABLE IF NOT EXISTS ptl_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  partner_id INTEGER NOT NULL REFERENCES mdm_partners(id),
  doc_no TEXT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE,
  submission_hash TEXT NOT NULL,
  project_id INTEGER,
  site_id INTEGER,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  deleted_at TEXT,
  deleted_by TEXT,
  source_type TEXT,
  source_id TEXT,
  remarks TEXT,
  UNIQUE(company_id, doc_no),
  UNIQUE(company_id, receipt_hash)
);
CREATE INDEX IF NOT EXISTS ix_ptl_registrations_partner ON ptl_registrations(partner_id);

INSERT OR IGNORE INTO ntf_templates
(company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type)
VALUES (NULL, 'portal.profile.requested', 'alerts', 'IN_APP', 'en', 'Portal profile change requested',
  'Review request {{reference}} in Portal Users.', '["reference"]', 1, 'ACTIVE', 'migration', 'ptl_p2501');
