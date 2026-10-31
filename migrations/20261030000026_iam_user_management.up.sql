-- User management, employee linking and the onboarding state (part 02.03). iam_users (the thin store of part 02.01, defect D-059) keeps
-- its meaning: `status` is "may this person sign in" (ACTIVE or DISABLED). The rest of the user record is completed in a one-to-one
-- table, so no locked object is altered and the new columns can have real foreign keys to the organisation master (02.02).
-- `lifecycle` is the person's state in the user-management process; the service keeps it and iam_users.status in step in one place.
-- A user created before this part has no profile row; reads fall back to the status of iam_users, and the backfill below adds one.

CREATE TABLE IF NOT EXISTS iam_user_profiles (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL,
  user_id           INTEGER NOT NULL REFERENCES iam_users (id),
  lifecycle         TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('INVITED', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
  user_type         TEXT    NOT NULL DEFAULT 'INTERNAL' CHECK (user_type IN ('INTERNAL', 'EXTERNAL_PORTAL', 'SERVICE_ACCOUNT')),
  language          TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
  employee_id       INTEGER,
  employee_code     TEXT,
  department_id     INTEGER REFERENCES org_departments (id),
  home_project_id   INTEGER REFERENCES org_projects (id),
  photo_file_id     INTEGER REFERENCES core_files (id),
  signature_file_id INTEGER REFERENCES core_files (id),
  preferences_json  TEXT    NOT NULL DEFAULT '{}',
  lifecycle_at      TEXT,
  lifecycle_reason  TEXT,
  project_id        INTEGER,
  site_id           INTEGER,
  created_by        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by        TEXT,
  updated_at        TEXT,
  version           INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at        TEXT,
  deleted_by        TEXT,
  source_type       TEXT,
  source_id         TEXT,
  remarks           TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_user_profiles_user ON iam_user_profiles (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_user_profiles_employee ON iam_user_profiles (company_id, employee_code) WHERE employee_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_iam_user_profiles_lifecycle ON iam_user_profiles (company_id, lifecycle);
CREATE INDEX IF NOT EXISTS ix_iam_user_profiles_type ON iam_user_profiles (company_id, user_type);
CREATE INDEX IF NOT EXISTS ix_iam_user_profiles_department ON iam_user_profiles (department_id);
CREATE INDEX IF NOT EXISTS ix_iam_user_profiles_project ON iam_user_profiles (home_project_id);
CREATE INDEX IF NOT EXISTS ix_iam_user_profiles_photo ON iam_user_profiles (photo_file_id);
CREATE INDEX IF NOT EXISTS ix_iam_user_profiles_signature ON iam_user_profiles (signature_file_id);

-- Users that exist today: a person who could sign in is Active, one who could not is Suspended (an administrator decides later).
INSERT OR IGNORE INTO iam_user_profiles (company_id, user_id, lifecycle, created_by, source_type)
SELECT company_id, id, CASE status WHEN 'ACTIVE' THEN 'ACTIVE' ELSE 'SUSPENDED' END, 'migration', 'user_profile' FROM iam_users;

CREATE INDEX IF NOT EXISTS ix_iam_users_company_name ON iam_users (company_id, display_name);

-- An invitation to set a password and join. Only the hash of the token is stored; at most one invitation per person is pending.
CREATE TABLE IF NOT EXISTS iam_invitations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES iam_users (id),
  token_hash    TEXT    NOT NULL,
  channel       TEXT    NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
  sent_to       TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED', 'SUPERSEDED')),
  expires_at    TEXT    NOT NULL,
  accepted_at   TEXT,
  sent_by       TEXT,
  resend_count  INTEGER NOT NULL DEFAULT 0 CHECK (resend_count >= 0),
  delivered     INTEGER NOT NULL DEFAULT 0 CHECK (delivered IN (0, 1)),
  delivery_note TEXT,
  project_id    INTEGER,
  site_id       INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_invitations_token ON iam_invitations (token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_invitations_pending ON iam_invitations (user_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS ix_iam_invitations_user ON iam_invitations (user_id, status);
CREATE INDEX IF NOT EXISTS ix_iam_invitations_company ON iam_invitations (company_id, status, expires_at);

-- Who was given or lost a role, by which approval (the history behind iam_users.roles_json until the assignments of part 02.04).
CREATE TABLE IF NOT EXISTS iam_role_grants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES iam_users (id),
  role_code     TEXT    NOT NULL,
  action        TEXT    NOT NULL CHECK (action IN ('GRANTED', 'REVOKED')),
  request_id    INTEGER REFERENCES core_change_requests (id),
  reason        TEXT,
  granted_by    TEXT,
  project_id    INTEGER,
  site_id       INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_iam_role_grants_user ON iam_role_grants (user_id, id);
CREATE INDEX IF NOT EXISTS ix_iam_role_grants_request ON iam_role_grants (request_id);
CREATE INDEX IF NOT EXISTS ix_iam_role_grants_company ON iam_role_grants (company_id);
