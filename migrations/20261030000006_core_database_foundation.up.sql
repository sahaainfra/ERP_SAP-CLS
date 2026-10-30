-- Database foundation (part 01.02): idempotency store, integrity-check history, back-fill ledger.
-- Money, rates, quantities and percentages in later tables are stored as INTEGER minor units (see ADR-14).

CREATE TABLE IF NOT EXISTS core_idempotency_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  key             TEXT    NOT NULL,
  user_id         TEXT    NOT NULL,
  endpoint        TEXT    NOT NULL,
  request_hash    TEXT    NOT NULL,
  response_status INTEGER,
  response_body   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at      TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_idempotency_scope ON core_idempotency_keys (user_id, endpoint, key);
CREATE INDEX IF NOT EXISTS ix_core_idempotency_expiry ON core_idempotency_keys (expires_at);

CREATE TABLE IF NOT EXISTS core_integrity_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT    NOT NULL,
  run_at         TEXT    NOT NULL,
  check_code     TEXT    NOT NULL,
  severity       TEXT    NOT NULL CHECK (severity IN ('Critical','High','Medium','Low')),
  status         TEXT    NOT NULL CHECK (status IN ('pass','fail','not_applicable')),
  failures_count INTEGER NOT NULL DEFAULT 0 CHECK (failures_count >= 0),
  checked_count  INTEGER NOT NULL DEFAULT 0 CHECK (checked_count >= 0),
  sample_json    TEXT,
  duration_ms    INTEGER,
  triggered_by   TEXT,
  company_id     INTEGER,
  created_by     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by     TEXT,
  updated_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at     TEXT,
  deleted_by     TEXT,
  source_type    TEXT,
  source_id      TEXT,
  remarks        TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_integrity_runs_run ON core_integrity_runs (run_id);
CREATE INDEX IF NOT EXISTS ix_core_integrity_runs_check ON core_integrity_runs (check_code, run_at);
CREATE INDEX IF NOT EXISTS ix_core_integrity_runs_company ON core_integrity_runs (company_id);

CREATE TABLE IF NOT EXISTS core_backfill_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL CHECK (status IN ('running','completed','failed')),
  cursor      TEXT,
  processed   INTEGER NOT NULL DEFAULT 0 CHECK (processed >= 0),
  batches     INTEGER NOT NULL DEFAULT 0 CHECK (batches >= 0),
  started_at  TEXT    NOT NULL,
  finished_at TEXT,
  last_error  TEXT,
  company_id  INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_backfill_runs_name ON core_backfill_runs (name);
CREATE INDEX IF NOT EXISTS ix_core_backfill_runs_company ON core_backfill_runs (company_id);
