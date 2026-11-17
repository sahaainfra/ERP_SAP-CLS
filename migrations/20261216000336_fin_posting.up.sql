-- Part 23.02: the posting engine. fin_posting_rules: the rule matrix — for an event type, a rule (code, priority, conditions on the event) gives the journal lines
-- (account code, debit or credit, amount expression of the calculation engine, dimension mapping, narration), versioned and in force from a date, approved (ACCMGR proposes,
-- the CFO approves); a row without a company is the template every company starts from. fin_posting_log: one row per event the engine took (posted with its journal, failed
-- with the reason, skipped, resolved), the queue of failed postings. fin_replay_runs: a replay of historical events — dry run, approval, commit, result.

CREATE TABLE IF NOT EXISTS fin_posting_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  rule_code       TEXT    NOT NULL,
  event_type      TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  action          TEXT    NOT NULL DEFAULT 'POST' CHECK (action IN ('POST', 'REVERSE')),
  reverses_event  TEXT,
  priority        INTEGER NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 999),
  condition_json  TEXT    NOT NULL DEFAULT '[]',
  lines_json      TEXT    NOT NULL DEFAULT '[]',
  narration_template TEXT NOT NULL DEFAULT '',
  voucher_type    TEXT    NOT NULL DEFAULT 'JV' CHECK (voucher_type IN ('JV', 'PV', 'RV', 'CV', 'PJ', 'SJ', 'DN', 'CN')),
  rule_version    INTEGER NOT NULL DEFAULT 1 CHECK (rule_version >= 1),
  effective_from  TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  change_reason   TEXT,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_posting_rules_doc ON fin_posting_rules (COALESCE(company_id, 0), doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_posting_rules_company_doc ON fin_posting_rules (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_posting_rules_version ON fin_posting_rules (COALESCE(company_id, 0), rule_code, rule_version);
CREATE INDEX IF NOT EXISTS ix_fin_posting_rules_company ON fin_posting_rules (company_id, status);
CREATE INDEX IF NOT EXISTS ix_fin_posting_rules_event ON fin_posting_rules (event_type, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_fin_posting_rules_wf ON fin_posting_rules (workflow_instance_id);

CREATE TABLE IF NOT EXISTS fin_replay_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  event_types_json TEXT   NOT NULL DEFAULT '[]',
  from_date       TEXT    NOT NULL,
  to_date         TEXT    NOT NULL,
  dry_run_json    TEXT    NOT NULL DEFAULT '{}',
  dry_run_hash    TEXT,
  result_json     TEXT,
  committed_at    TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_replay_runs_doc ON fin_replay_runs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_fin_replay_runs_list ON fin_replay_runs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_fin_replay_runs_wf ON fin_replay_runs (workflow_instance_id);

CREATE TABLE IF NOT EXISTS fin_posting_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  event_id        TEXT    NOT NULL,
  outbox_id       INTEGER,
  event_type      TEXT    NOT NULL,
  event_date      TEXT,
  doc_type        TEXT,
  doc_id          TEXT,
  doc_ref         TEXT,
  rule_id         INTEGER REFERENCES fin_posting_rules (id),
  journal_id      INTEGER REFERENCES fin_journals (id),
  log_status      TEXT    NOT NULL CHECK (log_status IN ('POSTED', 'FAILED', 'SKIPPED', 'RESOLVED', 'IGNORED')),
  error_code      TEXT,
  error           TEXT,
  attempts        INTEGER NOT NULL DEFAULT 1 CHECK (attempts >= 0),
  amount_paise    INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  payload_json    TEXT    NOT NULL DEFAULT '{}',
  posted_at       TEXT,
  resolved_by     TEXT,
  resolved_at     TEXT,
  resolution_note TEXT,
  replay_run_id   INTEGER REFERENCES fin_replay_runs (id),
  project_id  INTEGER,
  site_id     INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_fin_posting_log_event ON fin_posting_log (company_id, event_id);
CREATE INDEX IF NOT EXISTS ix_fin_posting_log_queue ON fin_posting_log (company_id, log_status, event_date);
CREATE INDEX IF NOT EXISTS ix_fin_posting_log_doc ON fin_posting_log (company_id, doc_type, doc_id);
CREATE INDEX IF NOT EXISTS ix_fin_posting_log_rule ON fin_posting_log (rule_id);
CREATE INDEX IF NOT EXISTS ix_fin_posting_log_journal ON fin_posting_log (journal_id);
CREATE INDEX IF NOT EXISTS ix_fin_posting_log_replay ON fin_posting_log (replay_run_id);
