-- Audit trail and transactional outbox used by every later part (part 00.02).
CREATE TABLE IF NOT EXISTS core_audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity         TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  action         TEXT NOT NULL,
  old_values     TEXT,
  new_values     TEXT,
  reason         TEXT,
  actor          TEXT NOT NULL,
  correlation_id TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_core_audit_log_entity ON core_audit_log (entity, entity_id);
CREATE TABLE IF NOT EXISTS core_outbox (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type   TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  payload      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_outbox_unpublished ON core_outbox (published_at);
