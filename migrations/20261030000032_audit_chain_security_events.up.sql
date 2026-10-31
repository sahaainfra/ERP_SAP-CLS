-- Part 02.06: the tamper-evident audit trail and the security event log.
-- core_audit_log (part 00.02) is not altered: each row gets a companion row in core_audit_chain holding its sequence number,
-- the field-level changes, who and where from, and a hash that includes the previous row's hash. Triggers refuse any UPDATE or
-- DELETE on the audit tables, whoever the application user is (BR-01).
CREATE TABLE IF NOT EXISTS core_audit_chain (
  audit_id       INTEGER PRIMARY KEY REFERENCES core_audit_log (id),
  seq            INTEGER NOT NULL UNIQUE,
  company_id     INTEGER REFERENCES org_companies (id),
  occurred_at    TEXT    NOT NULL,
  actor_id       INTEGER,
  on_behalf_of   TEXT,
  ip             TEXT,
  device         TEXT,
  changes_json   TEXT    NOT NULL DEFAULT '{}',
  prev_hash      TEXT    NOT NULL,
  hash           TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_core_audit_chain_company ON core_audit_chain (company_id, seq);

CREATE TABLE IF NOT EXISTS core_security_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES org_companies (id),
  occurred_at    TEXT    NOT NULL,
  user_id        INTEGER,
  username       TEXT,
  type           TEXT    NOT NULL,
  severity       TEXT    NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'HIGH', 'CRITICAL')),
  details_json   TEXT    NOT NULL DEFAULT '{}',
  ip             TEXT,
  correlation_id TEXT,
  source_type    TEXT,
  source_id      TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_security_events_company ON core_security_events (company_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_core_security_events_type ON core_security_events (type, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_security_events_source ON core_security_events (source_type, source_id) WHERE source_type IS NOT NULL;

CREATE TABLE IF NOT EXISTS core_audit_verifications (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at     TEXT    NOT NULL,
  finished_at    TEXT    NOT NULL,
  trigger        TEXT    NOT NULL,
  checked        INTEGER NOT NULL,
  ok             INTEGER NOT NULL CHECK (ok IN (0, 1)),
  broken_seq     INTEGER,
  problem        TEXT,
  head_hash      TEXT
);

CREATE TABLE IF NOT EXISTS core_audit_segments (
  period         TEXT    PRIMARY KEY,
  first_seq      INTEGER NOT NULL,
  last_seq       INTEGER NOT NULL,
  entry_count    INTEGER NOT NULL,
  head_hash      TEXT    NOT NULL,
  sealed_at      TEXT    NOT NULL
);

CREATE TRIGGER IF NOT EXISTS trg_core_audit_log_no_update BEFORE UPDATE ON core_audit_log BEGIN SELECT RAISE(ABORT, 'The audit trail is append-only: rows cannot be changed.'); END;
CREATE TRIGGER IF NOT EXISTS trg_core_audit_log_no_delete BEFORE DELETE ON core_audit_log BEGIN SELECT RAISE(ABORT, 'The audit trail is append-only: rows cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS trg_core_audit_chain_no_update BEFORE UPDATE ON core_audit_chain BEGIN SELECT RAISE(ABORT, 'The audit trail is append-only: rows cannot be changed.'); END;
CREATE TRIGGER IF NOT EXISTS trg_core_audit_chain_no_delete BEFORE DELETE ON core_audit_chain BEGIN SELECT RAISE(ABORT, 'The audit trail is append-only: rows cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS trg_core_security_events_no_update BEFORE UPDATE ON core_security_events BEGIN SELECT RAISE(ABORT, 'The security event log is append-only: rows cannot be changed.'); END;
CREATE TRIGGER IF NOT EXISTS trg_core_security_events_no_delete BEFORE DELETE ON core_security_events BEGIN SELECT RAISE(ABORT, 'The security event log is append-only: rows cannot be deleted.'); END;
CREATE TRIGGER IF NOT EXISTS trg_core_audit_segments_no_update BEFORE UPDATE ON core_audit_segments BEGIN SELECT RAISE(ABORT, 'A sealed audit segment cannot be changed.'); END;
CREATE TRIGGER IF NOT EXISTS trg_core_audit_segments_no_delete BEFORE DELETE ON core_audit_segments BEGIN SELECT RAISE(ABORT, 'A sealed audit segment cannot be deleted.'); END;
