-- Part 21.06: the claims engine: claim events, claims (approval-controlled) with notice and time-bar, quantum heads, immutable evidence snapshots, the submission and negotiation log, EOT awards, and disputes (approval-controlled) with their log.
CREATE TABLE IF NOT EXISTS ctr_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  claim_no        TEXT    NOT NULL COLLATE NOCASE,
  claim_type      TEXT    NOT NULL CHECK (claim_type IN ('EOT', 'COST', 'BOTH')),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  title           TEXT    NOT NULL,
  event_date      TEXT    NOT NULL,
  clause_refs     TEXT,
  entitlement     TEXT,
  time_bar_days   INTEGER NOT NULL DEFAULT 28 CHECK (time_bar_days >= 1),
  time_bar_date   TEXT    NOT NULL,
  notice_letter_id INTEGER REFERENCES engg_letters (id),
  notice_date     TEXT,
  bar_status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (bar_status IN ('OPEN', 'SERVED', 'LAPSED', 'WAIVED')),
  delay_id        INTEGER REFERENCES plan_delays (id),
  eot_claimed_days INTEGER NOT NULL DEFAULT 0 CHECK (eot_claimed_days >= 0),
  amount_claimed_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_claimed_paise >= 0),
  eot_granted_days INTEGER CHECK (eot_granted_days IS NULL OR eot_granted_days >= 0),
  amount_awarded_paise INTEGER CHECK (amount_awarded_paise IS NULL OR amount_awarded_paise >= 0),
  submission_no   INTEGER NOT NULL DEFAULT 0 CHECK (submission_no >= 0),
  claim_state     TEXT    NOT NULL DEFAULT 'PREPARING' CHECK (claim_state IN ('PREPARING', 'READY', 'SUBMITTED', 'NEGOTIATION', 'DETERMINED', 'CLOSED', 'WITHDRAWN')),
  determined_on   TEXT,
  determination_note TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_clm_doc ON ctr_claims (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_clm_no ON ctr_claims (company_id, claim_no);
CREATE INDEX IF NOT EXISTS ix_ctr_claims_org_project_id ON ctr_claims (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claims_org_site_id ON ctr_claims (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claims_contract_id ON ctr_claims (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claims_notice_letter_id ON ctr_claims (notice_letter_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claims_delay_id ON ctr_claims (delay_id);
CREATE INDEX IF NOT EXISTS ix_ctr_clm_bar ON ctr_claims (company_id, bar_status, time_bar_date);
CREATE TABLE IF NOT EXISTS ctr_claim_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  contract_id     INTEGER REFERENCES ctr_contracts (id),
  claim_id        INTEGER REFERENCES ctr_claims (id),
  event_kind      TEXT    NOT NULL CHECK (event_kind IN ('DELAY', 'HINDRANCE', 'INSTRUCTION', 'VARIATION_REJECTED', 'SUSPENSION', 'OTHER')),
  event_date      TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  ref_entity      TEXT,
  ref_id          INTEGER,
  ref_label       TEXT,
  time_bar_date   TEXT,
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
CREATE INDEX IF NOT EXISTS ix_ctr_claim_events_company_id ON ctr_claim_events (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claim_events_org_project_id ON ctr_claim_events (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claim_events_contract_id ON ctr_claim_events (contract_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claim_events_claim_id ON ctr_claim_events (claim_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_ce_ref ON ctr_claim_events (company_id, ref_entity, ref_id) WHERE ref_entity IS NOT NULL AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS ctr_claim_quantum (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  claim_id        INTEGER NOT NULL REFERENCES ctr_claims (id),
  line_no         INTEGER NOT NULL CHECK (line_no >= 1),
  head            TEXT    NOT NULL CHECK (head IN ('DIRECT', 'PROLONGATION', 'IDLE_LABOUR', 'IDLE_PLANT', 'DISRUPTION', 'FINANCE', 'ESCALATION', 'PROFIT')),
  basis           TEXT    NOT NULL,
  calculation_json TEXT   NOT NULL DEFAULT '{}',
  amount_paise    INTEGER NOT NULL CHECK (amount_paise >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_cq_line ON ctr_claim_quantum (claim_id, line_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ctr_claim_quantum_company_id ON ctr_claim_quantum (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claim_quantum_claim_id ON ctr_claim_quantum (claim_id);
CREATE TABLE IF NOT EXISTS ctr_claim_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  claim_id        INTEGER NOT NULL REFERENCES ctr_claims (id),
  entity          TEXT    NOT NULL CHECK (entity IN ('DPR', 'LETTER', 'RFI', 'DELAY', 'TIA', 'CHANGE', 'OTHER')),
  entity_id       INTEGER NOT NULL,
  label           TEXT    NOT NULL,
  snapshot_json   TEXT    NOT NULL,
  snapshot_hash   TEXT    NOT NULL,
  snapshot_file_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_cev_key ON ctr_claim_evidence (claim_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claim_evidence_company_id ON ctr_claim_evidence (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claim_evidence_claim_id ON ctr_claim_evidence (claim_id);
CREATE TRIGGER IF NOT EXISTS trg_ctr_claim_evidence_no_update BEFORE UPDATE ON ctr_claim_evidence BEGIN SELECT RAISE(ABORT, 'An evidence snapshot is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_ctr_claim_evidence_no_delete BEFORE DELETE ON ctr_claim_evidence BEGIN SELECT RAISE(ABORT, 'An evidence snapshot is immutable'); END;
CREATE TABLE IF NOT EXISTS ctr_claim_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  claim_id        INTEGER NOT NULL REFERENCES ctr_claims (id),
  seq             INTEGER NOT NULL CHECK (seq >= 1),
  log_kind        TEXT    NOT NULL CHECK (log_kind IN ('SUBMISSION', 'RESPONSE', 'NEGOTIATION', 'DETERMINATION', 'NOTICE')),
  on_date         TEXT    NOT NULL,
  eot_days        INTEGER NOT NULL DEFAULT 0 CHECK (eot_days >= 0),
  amount_paise    INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  reference_no    TEXT,
  note            TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_cl_seq ON ctr_claim_log (claim_id, seq);
CREATE INDEX IF NOT EXISTS ix_ctr_claim_log_company_id ON ctr_claim_log (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_claim_log_claim_id ON ctr_claim_log (claim_id);
CREATE TABLE IF NOT EXISTS ctr_eot_awards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  claim_id        INTEGER NOT NULL REFERENCES ctr_claims (id),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  days            INTEGER NOT NULL CHECK (days >= 1),
  completion_before TEXT,
  completion_after TEXT   NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_eot_claim ON ctr_eot_awards (claim_id);
CREATE INDEX IF NOT EXISTS ix_ctr_eot_awards_company_id ON ctr_eot_awards (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_eot_awards_contract_id ON ctr_eot_awards (contract_id);
CREATE TABLE IF NOT EXISTS ctr_disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  dispute_no      TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id     INTEGER REFERENCES org_sites (id),
  claim_id        INTEGER REFERENCES ctr_claims (id),
  contract_id     INTEGER NOT NULL REFERENCES ctr_contracts (id),
  title           TEXT    NOT NULL,
  forum           TEXT    NOT NULL CHECK (forum IN ('ENGINEER', 'DAB', 'ADJUDICATION', 'ARBITRATION', 'COURT', 'AMICABLE')),
  stage           TEXT    NOT NULL,
  amount_in_dispute_paise INTEGER NOT NULL DEFAULT 0 CHECK (amount_in_dispute_paise >= 0),
  next_hearing    TEXT,
  counsel         TEXT,
  cost_to_date_paise INTEGER NOT NULL DEFAULT 0 CHECK (cost_to_date_paise >= 0),
  dispute_state   TEXT    NOT NULL DEFAULT 'OPEN' CHECK (dispute_state IN ('OPEN', 'DECIDED', 'SETTLED', 'CLOSED')),
  outcome         TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_dsp_doc ON ctr_disputes (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ctr_dsp_no ON ctr_disputes (company_id, dispute_no);
CREATE INDEX IF NOT EXISTS ix_ctr_disputes_org_project_id ON ctr_disputes (org_project_id);
CREATE INDEX IF NOT EXISTS ix_ctr_disputes_org_site_id ON ctr_disputes (org_site_id);
CREATE INDEX IF NOT EXISTS ix_ctr_disputes_claim_id ON ctr_disputes (claim_id);
CREATE INDEX IF NOT EXISTS ix_ctr_disputes_contract_id ON ctr_disputes (contract_id);
CREATE TABLE IF NOT EXISTS ctr_dispute_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  dispute_id      INTEGER NOT NULL REFERENCES ctr_disputes (id),
  log_kind        TEXT    NOT NULL CHECK (log_kind IN ('HEARING', 'COST', 'STAGE', 'OUTCOME', 'NOTE')),
  on_date         TEXT    NOT NULL,
  amount_paise    INTEGER NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  note            TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_ctr_dispute_log_company_id ON ctr_dispute_log (company_id);
CREATE INDEX IF NOT EXISTS ix_ctr_dispute_log_dispute_id ON ctr_dispute_log (dispute_id);
