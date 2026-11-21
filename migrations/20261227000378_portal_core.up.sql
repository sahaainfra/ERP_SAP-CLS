-- Part 25.01: external identities and sessions. The feature is disabled in every environment by default.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.portal.p2501', 'External portal framework (part 25.01)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS ptl_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  partner_id INTEGER REFERENCES mdm_partners(id),
  contact_id INTEGER REFERENCES mdm_partner_contacts(id),
  stakeholder_id INTEGER REFERENCES proj_stakeholders(id),
  portal_type TEXT NOT NULL CHECK (portal_type IN ('X-SUP','X-SUB','X-CLI','X-CON')),
  status TEXT NOT NULL CHECK (status IN ('INVITED','ACTIVE','REVOKED')),
  invite_hash TEXT,
  invite_expires_at INTEGER,
  password_hash TEXT,
  totp_enc TEXT,
  last_counter INTEGER,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until INTEGER,
  terms_version TEXT,
  terms_accepted_at TEXT,
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
  CHECK ((contact_id IS NOT NULL AND partner_id IS NOT NULL AND stakeholder_id IS NULL)
    OR (contact_id IS NULL AND stakeholder_id IS NOT NULL AND portal_type IN ('X-CLI','X-CON')))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptl_accounts_doc_no ON ptl_accounts(doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptl_accounts_invite ON ptl_accounts(invite_hash) WHERE invite_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptl_accounts_contact ON ptl_accounts(contact_id, portal_type) WHERE deleted_at IS NULL AND status != 'REVOKED';
CREATE UNIQUE INDEX IF NOT EXISTS ux_ptl_accounts_stakeholder ON ptl_accounts(stakeholder_id, portal_type) WHERE deleted_at IS NULL AND status != 'REVOKED';
CREATE INDEX IF NOT EXISTS ix_ptl_accounts_contact_id ON ptl_accounts(contact_id);
CREATE INDEX IF NOT EXISTS ix_ptl_accounts_partner_id ON ptl_accounts(partner_id);
CREATE INDEX IF NOT EXISTS ix_ptl_accounts_company_status ON ptl_accounts(company_id, status, created_at DESC, id DESC)
  WHERE is_active = 1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ptl_accounts_company_created ON ptl_accounts(company_id, created_at DESC, id DESC)
  WHERE is_active = 1 AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ptl_accounts_company_role ON ptl_accounts(company_id, portal_type, created_at DESC, id DESC)
  WHERE is_active = 1 AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS ptl_sessions (
  token_hash TEXT PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES ptl_accounts(id),
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ptl_sessions_account ON ptl_sessions(account_id, expires_at);
CREATE INDEX IF NOT EXISTS ix_ptl_sessions_expiry ON ptl_sessions(expires_at);

INSERT OR IGNORE INTO ui_navigation_entries
(code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, tile, created_by, source_type)
VALUES
('admin-portal-users', 'g-administration', 'page', 'sidebar', 'Portal users', 'पोर्टल उपयोगकर्ता', '/admin/portal-users', 'erp.admin.iam', 'portal.account.view', 'ff.portal.p2501', 101, 'external partner accounts', 1, 'none', 0, 'migration', 'ptl_p2501'),
('admin-portal-invite', 'g-administration', 'page', 'sidebar', 'Invite portal user', 'पोर्टल उपयोगकर्ता को आमंत्रित करें', '/admin/portal-invite', 'erp.admin.iam', 'portal.account.invite', 'ff.portal.p2501', 102, 'external partner invitation', 1, 'none', 0, 'migration', 'ptl_p2501');

INSERT OR IGNORE INTO ui_page_migration
(page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, created_by, source_type)
VALUES
('admin.portal-users', 'portal', 'Portal users', '/admin/portal-users', '/admin/portal-users', 'REPORT', 'MIGRATED', 'SYSADM', '25.01', 'migration', 'ptl_p2501'),
('admin.portal-invite', 'portal', 'Invite portal user', '/admin/portal-invite', '/admin/portal-invite', 'OBJECT', 'MIGRATED', 'PROCMGR', '25.01', 'migration', 'ptl_p2501');
