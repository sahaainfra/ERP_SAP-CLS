-- Part 08.02: the tender register (module bd, tables tdr_*).
-- tdr_tenders: the tender with its key dates, money, bid capacity (computed by the calculation engine) and stage; its approval status is the registration, its stage the progress from open to ready for submission. tdr_eligibility: the eligibility checklist with
-- pass or fail and evidence. tdr_bid_decisions: the scored bid or no-bid evaluation, approved by the chain. tdr_addenda: addenda and corrigenda with their impact (and the new dates). tdr_queries: pre-bid queries and the clarifications received.
-- tdr_team_tasks: the tasks of the tender team. tdr_date_log: every change of a key date.

CREATE TABLE IF NOT EXISTS tdr_tenders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  opportunity_id INTEGER REFERENCES bd_opportunities (id),
  client_partner_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  reference_no   TEXT,
  portal         TEXT    NOT NULL DEFAULT 'OTHER' CHECK (portal IN ('CPPP', 'GEM', 'STATE_PORTAL', 'CLIENT_SITE', 'OTHER')),
  portal_name    TEXT,
  name_of_work   TEXT    NOT NULL,
  location       TEXT,
  region         TEXT,
  est_cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (est_cost_minor >= 0),
  emd_minor      INTEGER NOT NULL DEFAULT 0 CHECK (emd_minor >= 0),
  tender_fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (tender_fee_minor >= 0),
  bid_type       TEXT    NOT NULL DEFAULT 'ITEM_RATE' CHECK (bid_type IN ('ITEM_RATE', 'PERCENTAGE', 'LUMP_SUM', 'EPC', 'HAM')),
  period_months  INTEGER NOT NULL DEFAULT 12 CHECK (period_months >= 1),
  publish_date   TEXT,
  prebid_date    TEXT,
  submission_at  TEXT,
  opening_at     TEXT,
  owner          TEXT    NOT NULL,
  bc_turnover_minor INTEGER CHECK (bc_turnover_minor IS NULL OR bc_turnover_minor >= 0),
  bc_commitments_minor INTEGER CHECK (bc_commitments_minor IS NULL OR bc_commitments_minor >= 0),
  bc_factor      INTEGER NOT NULL DEFAULT 2 CHECK (bc_factor >= 1),
  bid_capacity_minor INTEGER,
  capacity_json  TEXT,
  stage          TEXT    NOT NULL DEFAULT 'OPEN' CHECK (stage IN ('OPEN', 'NO_BID', 'BID', 'READY', 'SUBMITTED', 'AWARDED', 'LOST', 'CLOSED')),
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  amendment_no   INTEGER NOT NULL DEFAULT 0,
  ready_at       TEXT,
  ready_by       TEXT,
  submitted_on   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_tenders_doc ON tdr_tenders (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_tenders_ref ON tdr_tenders (company_id, client_partner_id, reference_no) WHERE reference_no IS NOT NULL AND deleted_at IS NULL AND status <> 'CANCELLED';
CREATE INDEX IF NOT EXISTS ix_tdr_tenders_company_id ON tdr_tenders (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_tenders_stage ON tdr_tenders (company_id, stage);
CREATE INDEX IF NOT EXISTS ix_tdr_tenders_status ON tdr_tenders (company_id, status);
CREATE INDEX IF NOT EXISTS ix_tdr_tenders_owner ON tdr_tenders (company_id, owner);
CREATE INDEX IF NOT EXISTS ix_tdr_tenders_client ON tdr_tenders (client_partner_id);
CREATE INDEX IF NOT EXISTS ix_tdr_tenders_opportunity ON tdr_tenders (opportunity_id);
CREATE INDEX IF NOT EXISTS ix_tdr_tenders_submission ON tdr_tenders (company_id, submission_at);

CREATE TABLE IF NOT EXISTS tdr_eligibility (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  seq            INTEGER NOT NULL,
  criterion      TEXT    NOT NULL CHECK (criterion IN ('TURNOVER', 'SIMILAR_WORK', 'NET_WORTH', 'BID_CAPACITY', 'REGISTRATION_CLASS', 'JV', 'OTHER')),
  title          TEXT    NOT NULL,
  requirement_text TEXT,
  requirement_minor INTEGER CHECK (requirement_minor IS NULL OR requirement_minor >= 0),
  our_minor      INTEGER,
  our_text       TEXT,
  result         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (result IN ('PENDING', 'PASS', 'FAIL', 'WAIVED')),
  result_mode    TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (result_mode IN ('AUTO', 'MANUAL')),
  waive_reason   TEXT,
  notes          TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_eligibility_seq ON tdr_eligibility (tender_id, seq);
CREATE INDEX IF NOT EXISTS ix_tdr_eligibility_company_id ON tdr_eligibility (company_id);

CREATE TABLE IF NOT EXISTS tdr_bid_decisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  scores_json    TEXT    NOT NULL DEFAULT '{}',
  total_score    INTEGER NOT NULL DEFAULT 0 CHECK (total_score BETWEEN 0 AND 100),
  threshold      INTEGER NOT NULL DEFAULT 60 CHECK (threshold BETWEEN 0 AND 100),
  recommendation TEXT    NOT NULL DEFAULT 'NO_BID' CHECK (recommendation IN ('BID', 'NO_BID')),
  decision       TEXT    NOT NULL CHECK (decision IN ('BID', 'NO_BID')),
  reasons        TEXT,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  amendment_no   INTEGER NOT NULL DEFAULT 0,
  decided_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_bid_decisions_doc ON tdr_bid_decisions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_tdr_bid_decisions_company_id ON tdr_bid_decisions (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_bid_decisions_tender ON tdr_bid_decisions (tender_id, status);

CREATE TABLE IF NOT EXISTS tdr_addenda (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  number         INTEGER NOT NULL,
  kind           TEXT    NOT NULL DEFAULT 'ADDENDUM' CHECK (kind IN ('ADDENDUM', 'CORRIGENDUM')),
  addendum_date  TEXT    NOT NULL,
  summary        TEXT    NOT NULL,
  impact         TEXT    NOT NULL DEFAULT 'NONE' CHECK (impact IN ('NONE', 'DATES', 'SCOPE', 'VALUE', 'DOCUMENTS')),
  impact_note    TEXT,
  new_prebid_date TEXT,
  new_submission_at TEXT,
  new_opening_at TEXT,
  ack_by         TEXT,
  ack_at         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_addenda_number ON tdr_addenda (tender_id, number);
CREATE INDEX IF NOT EXISTS ix_tdr_addenda_company_id ON tdr_addenda (company_id);

CREATE TABLE IF NOT EXISTS tdr_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  seq            INTEGER NOT NULL,
  clause_ref     TEXT,
  query_text     TEXT    NOT NULL,
  addendum_number INTEGER,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'ANSWERED', 'NO_RESPONSE')),
  submitted_on   TEXT,
  response       TEXT,
  response_date  TEXT,
  raised_by      TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_queries_seq ON tdr_queries (tender_id, seq);
CREATE INDEX IF NOT EXISTS ix_tdr_queries_company_id ON tdr_queries (company_id);

CREATE TABLE IF NOT EXISTS tdr_team_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  kind           TEXT    NOT NULL CHECK (kind IN ('ESTIMATION', 'TECHNICAL_DOCS', 'FINANCIAL_DOCS', 'SITE_VISIT', 'OTHER')),
  title          TEXT    NOT NULL,
  assignee       TEXT    NOT NULL,
  due_date       TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'CANCELLED')),
  task_id        INTEGER,
  done_at        TEXT,
  notes          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_tdr_team_tasks_company_id ON tdr_team_tasks (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_team_tasks_tender ON tdr_team_tasks (tender_id, status);
CREATE INDEX IF NOT EXISTS ix_tdr_team_tasks_due ON tdr_team_tasks (company_id, status, due_date);

CREATE TABLE IF NOT EXISTS tdr_date_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  tender_id      INTEGER NOT NULL REFERENCES tdr_tenders (id),
  field          TEXT    NOT NULL,
  old_value      TEXT,
  new_value      TEXT,
  reason         TEXT,
  addendum_number INTEGER,
  changed_by     TEXT    NOT NULL,
  changed_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
CREATE INDEX IF NOT EXISTS ix_tdr_date_log_company_id ON tdr_date_log (company_id);
CREATE INDEX IF NOT EXISTS ix_tdr_date_log_tender ON tdr_date_log (tender_id);

CREATE TABLE IF NOT EXISTS tdr_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  entity         TEXT    NOT NULL CHECK (entity IN ('TENDER', 'BID_DECISION')),
  entity_id      INTEGER NOT NULL,
  amendment_no   INTEGER NOT NULL,
  snapshot_json  TEXT    NOT NULL,
  reason         TEXT    NOT NULL,
  amended_by     TEXT    NOT NULL,
  amended_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
CREATE INDEX IF NOT EXISTS ix_tdr_amendments_company_id ON tdr_amendments (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tdr_amendments ON tdr_amendments (entity, entity_id, amendment_no);
