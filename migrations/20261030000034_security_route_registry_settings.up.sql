-- Part 02.07: the route registry snapshot and the security settings.
-- core_route_registry is rebuilt at every start-up from the live application and the route policy; the self-test writes its last
-- result per route. core_security_settings holds the one row of overrides to the built-in rate limits, headers, CORS list and
-- export thresholds; every change goes through an approved request and the audit trail keeps the history.
CREATE TABLE IF NOT EXISTS core_route_registry (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  method           TEXT    NOT NULL,
  path             TEXT    NOT NULL,
  module           TEXT    NOT NULL,
  guard            TEXT    NOT NULL CHECK (guard IN ('permission', 'self', 'record', 'public', 'infra')),
  permission_key   TEXT,
  scope_resolver   TEXT    NOT NULL DEFAULT 'company',
  schema_ref       TEXT,
  limit_class       TEXT    NOT NULL,
  is_public        INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  audit_flag       INTEGER NOT NULL DEFAULT 0 CHECK (audit_flag IN (0, 1)),
  last_test_at     TEXT,
  last_test_result TEXT CHECK (last_test_result IN ('pass', 'fail', 'skipped')),
  last_test_detail TEXT,
  registered_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_route_registry_route ON core_route_registry (method, path);
CREATE INDEX IF NOT EXISTS ix_core_route_registry_module ON core_route_registry (module, guard);

CREATE TABLE IF NOT EXISTS core_security_settings (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  version       INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT    NOT NULL,
  updated_by    TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
