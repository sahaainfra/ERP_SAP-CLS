-- Restores the constraint on the request types. Requests of the types it does not allow (part 01.04's
-- 'schedule_change') and their steps cannot be kept and are removed.

CREATE TABLE core_change_request_steps_bak AS SELECT * FROM core_change_request_steps;
CREATE TABLE core_change_requests_bak AS SELECT * FROM core_change_requests;
DROP TABLE core_change_request_steps;
DROP TABLE core_change_requests;

CREATE TABLE IF NOT EXISTS core_change_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL,
  type         TEXT    NOT NULL CHECK (type IN ('period_reopen', 'number_series_change')),
  title        TEXT    NOT NULL,
  target_type  TEXT    NOT NULL,
  target_id    INTEGER NOT NULL,
  payload_json TEXT    NOT NULL,
  reason       TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED')),
  chain_json   TEXT    NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 1,
  requested_by TEXT    NOT NULL,
  project_id   INTEGER,
  site_id      INTEGER,
  created_by   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by   TEXT,
  updated_at   TEXT,
  version      INTEGER NOT NULL DEFAULT 1,
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at   TEXT,
  deleted_by   TEXT,
  source_type  TEXT,
  source_id    TEXT,
  remarks      TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_change_requests_company_status ON core_change_requests (company_id, status);
CREATE INDEX IF NOT EXISTS ix_core_change_requests_type ON core_change_requests (type, status);
CREATE INDEX IF NOT EXISTS ix_core_change_requests_target ON core_change_requests (target_type, target_id);

CREATE TABLE IF NOT EXISTS core_change_request_steps (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES core_change_requests(id),
  step_no    INTEGER NOT NULL,
  role_code  TEXT    NOT NULL,
  decision   TEXT    NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'RETURNED')),
  decided_by TEXT    NOT NULL,
  decided_at TEXT    NOT NULL,
  comment    TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_change_request_steps_request ON core_change_request_steps (request_id);

INSERT INTO core_change_requests SELECT * FROM core_change_requests_bak WHERE type IN ('period_reopen', 'number_series_change');
INSERT INTO core_change_request_steps SELECT * FROM core_change_request_steps_bak WHERE request_id IN (SELECT id FROM core_change_requests);
DROP TABLE core_change_request_steps_bak;
DROP TABLE core_change_requests_bak;
