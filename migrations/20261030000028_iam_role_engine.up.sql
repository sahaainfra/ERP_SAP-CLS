-- Role and permission engine (part 02.04). The permission registry, roles (locked system templates and editable custom copies),
-- their allow and deny grants, field masks, scoped and dated assignments, and the mapping of the roles that existed before.
-- System rows have no company (company_id IS NULL); custom roles belong to one company. Nothing existing is altered.

CREATE TABLE IF NOT EXISTS iam_permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER,
  perm_key      TEXT    NOT NULL,
  module        TEXT    NOT NULL,
  entity        TEXT    NOT NULL,
  action        TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  sensitive     INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_permissions_key ON iam_permissions (perm_key);
CREATE INDEX IF NOT EXISTS ix_iam_permissions_module ON iam_permissions (module, entity);

CREATE TABLE IF NOT EXISTS iam_roles (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id         INTEGER REFERENCES org_companies (id),
  code               TEXT    NOT NULL COLLATE NOCASE,
  name               TEXT    NOT NULL,
  description        TEXT    NOT NULL DEFAULT '',
  kind               TEXT    NOT NULL DEFAULT 'CUSTOM' CHECK (kind IN ('SYSTEM', 'CUSTOM')),
  category           TEXT    NOT NULL DEFAULT 'CUSTOM',
  is_system          INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  status             TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  department_id      INTEGER REFERENCES org_departments (id),
  parent_template_id INTEGER REFERENCES iam_roles (id),
  clearance          TEXT    NOT NULL DEFAULT 'internal' CHECK (clearance IN ('public', 'internal', 'confidential', 'restricted')),
  authority_json     TEXT    NOT NULL DEFAULT '{}',
  grants_hash        TEXT,
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
  remarks       TEXT,
  CHECK ((kind = 'SYSTEM') = (is_system = 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_roles_code ON iam_roles (COALESCE(company_id, 0), code);
CREATE INDEX IF NOT EXISTS ix_iam_roles_company ON iam_roles (company_id, status);
CREATE INDEX IF NOT EXISTS ix_iam_roles_department ON iam_roles (department_id);
CREATE INDEX IF NOT EXISTS ix_iam_roles_template ON iam_roles (parent_template_id);

CREATE TABLE IF NOT EXISTS iam_role_permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER,
  role_id       INTEGER NOT NULL REFERENCES iam_roles (id),
  perm_key      TEXT    NOT NULL,
  effect        TEXT    NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_role_permissions ON iam_role_permissions (role_id, perm_key);
CREATE INDEX IF NOT EXISTS ix_iam_role_permissions_key ON iam_role_permissions (perm_key);

CREATE TABLE IF NOT EXISTS iam_field_masks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER,
  role_id       INTEGER NOT NULL REFERENCES iam_roles (id),
  entity        TEXT    NOT NULL,
  field         TEXT    NOT NULL,
  rule          TEXT    NOT NULL CHECK (rule IN ('hide', 'partial', 'show')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_field_masks ON iam_field_masks (role_id, entity, field);
CREATE INDEX IF NOT EXISTS ix_iam_field_masks_field ON iam_field_masks (entity, field);

CREATE TABLE IF NOT EXISTS iam_assignments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  user_id        INTEGER NOT NULL REFERENCES iam_users (id),
  role_id        INTEGER NOT NULL REFERENCES iam_roles (id),
  scope_type     TEXT    NOT NULL DEFAULT 'COMPANY' CHECK (scope_type IN ('COMPANY', 'BRANCH', 'DEPARTMENT', 'PROJECT', 'SITE', 'OWN')),
  scope_ids_json TEXT    NOT NULL DEFAULT '[]',
  effective_from TEXT,
  effective_to   TEXT,
  status         TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  reason         TEXT,
  request_id     INTEGER REFERENCES core_change_requests (id),
  ended_at       TEXT,
  ended_by       TEXT,
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
  remarks       TEXT,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ix_iam_assignments_user ON iam_assignments (user_id, status);
CREATE INDEX IF NOT EXISTS ix_iam_assignments_role ON iam_assignments (role_id, status);
CREATE INDEX IF NOT EXISTS ix_iam_assignments_request ON iam_assignments (request_id);
CREATE INDEX IF NOT EXISTS ix_iam_assignments_company ON iam_assignments (company_id, status);

CREATE TABLE IF NOT EXISTS iam_role_mapping (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER,
  legacy_role   TEXT    NOT NULL,
  new_role_id   INTEGER REFERENCES iam_roles (id),
  mapping_type  TEXT    NOT NULL DEFAULT 'ALIAS' CHECK (mapping_type IN ('ALIAS', 'DISTINCT', 'UNMAPPED')),
  notes         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_iam_role_mapping ON iam_role_mapping (legacy_role);
CREATE INDEX IF NOT EXISTS ix_iam_role_mapping_role ON iam_role_mapping (new_role_id);
