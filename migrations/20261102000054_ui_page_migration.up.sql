-- Part 03.10: the migration tracker of the existing screens. One row for each page of the application: its module, label, the address it had (old_route) and
-- has (new_route; when they differ the old address redirects), its page type, the state of its migration onto the design system, the role that signs it off,
-- who migrated and who verified it, where it is scheduled if another part will rebuild it, and the defects found on it. The rows are the system's own
-- (no company). A page is Verified only by a person who is not the one who migrated it (BR-02).

CREATE TABLE IF NOT EXISTS ui_page_migration (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER REFERENCES org_companies (id),
  page_code        TEXT    NOT NULL UNIQUE,
  module           TEXT    NOT NULL CHECK (module IN ('core', 'iam', 'ui')),
  label            TEXT    NOT NULL,
  old_route        TEXT    NOT NULL CHECK (old_route GLOB '/*'),
  new_route        TEXT    NOT NULL CHECK (new_route GLOB '/*'),
  page_type        TEXT    NOT NULL CHECK (page_type IN ('DASHBOARD', 'LIST', 'OBJECT', 'FORM', 'WORKLIST', 'REPORT')),
  status           TEXT    NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'MIGRATED', 'VERIFIED', 'SCHEDULED')),
  owner_role       TEXT    NOT NULL,
  migrated_in_part TEXT,
  migrated_by      TEXT,
  migrated_at      TEXT,
  verified_by      TEXT,
  verified_at      TEXT,
  scheduled_part   TEXT,
  defects_json     TEXT    NOT NULL DEFAULT '[]',
  notes            TEXT,
  project_id       INTEGER,
  site_id          INTEGER,
  created_by       TEXT,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by       TEXT,
  updated_at       TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at       TEXT,
  deleted_by       TEXT,
  source_type      TEXT,
  source_id        TEXT,
  remarks          TEXT,
  CHECK (status != 'VERIFIED' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK (status != 'SCHEDULED' OR scheduled_part IS NOT NULL),
  CHECK (verified_by IS NULL OR migrated_by IS NULL OR verified_by != migrated_by)
);
CREATE INDEX IF NOT EXISTS ix_ui_page_migration_module ON ui_page_migration (module, status);
CREATE INDEX IF NOT EXISTS ix_ui_page_migration_status ON ui_page_migration (status);
CREATE INDEX IF NOT EXISTS ix_ui_page_migration_company ON ui_page_migration (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_page_migration_new_route ON ui_page_migration (new_route);
CREATE INDEX IF NOT EXISTS ix_ui_page_migration_old_route ON ui_page_migration (old_route);
