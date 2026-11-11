-- Part 14.04: site instructions and site memos.
-- site_instructions (approval-controlled when a back-charge is raised): instructions received from the engineer or client (EI, CI), internal site instructions issued to subcontractors or crews (ISI) and site memos;
-- cost and time implication flags, the notice due date, the variation decision that must exist before a costly instruction closes (BR-01), the back-charge (amount in paise) and the letter.
-- site_instruction_acks: one row for each party an issued instruction goes to: its acknowledgement and its compliance with the evidence (files of the file service).

CREATE TABLE IF NOT EXISTS site_instructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  ins_site_id     INTEGER NOT NULL REFERENCES org_sites (id),
  ins_type        TEXT    NOT NULL CHECK (ins_type IN ('EI', 'CI', 'ISI', 'MEMO')),
  ins_date        TEXT    NOT NULL,
  their_ref       TEXT,
  from_party      TEXT    NOT NULL,
  to_party        TEXT,
  subject         TEXT    NOT NULL,
  description     TEXT,
  location_id     INTEGER REFERENCES proj_locations (id),
  activity_id     INTEGER REFERENCES plan_activities (id),
  due_date        TEXT,
  cost_implication INTEGER NOT NULL DEFAULT 0 CHECK (cost_implication IN (0, 1)),
  time_implication INTEGER NOT NULL DEFAULT 0 CHECK (time_implication IN (0, 1)),
  backcharge      INTEGER NOT NULL DEFAULT 0 CHECK (backcharge IN (0, 1)),
  backcharge_amount INTEGER CHECK (backcharge_amount IS NULL OR backcharge_amount >= 0),
  backcharge_partner_id INTEGER REFERENCES mdm_partners (id),
  letter_id       INTEGER REFERENCES engg_letters (id),
  notice_due_date TEXT,
  variation_decision TEXT CHECK (variation_decision IS NULL OR variation_decision IN ('ACCEPTED', 'REJECTED', 'WITHDRAWN')),
  variation_ref   TEXT,
  variation_note  TEXT,
  variation_by    TEXT,
  variation_at    TEXT,
  parties_json    TEXT    NOT NULL DEFAULT '[]',
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'OPEN', 'RETURNED', 'REJECTED', 'CANCELLED', 'CLOSED', 'SUPERSEDED')),
  revision_no     INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  parent_instruction_id INTEGER REFERENCES site_instructions (id),
  closure_notes   TEXT,
  closed_at       TEXT,
  closed_by       TEXT,
  reminded_at     TEXT,
  reminder_level  INTEGER NOT NULL DEFAULT 0 CHECK (reminder_level >= 0),
  reason          TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  issued_at       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_site_instructions_doc ON site_instructions (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_site_instructions_company ON site_instructions (company_id, status);
CREATE INDEX IF NOT EXISTS ix_site_instructions_project ON site_instructions (org_project_id, ins_date);
CREATE INDEX IF NOT EXISTS ix_site_instructions_site ON site_instructions (ins_site_id, status, ins_date);
CREATE INDEX IF NOT EXISTS ix_site_instructions_type ON site_instructions (company_id, ins_type, status);
CREATE INDEX IF NOT EXISTS ix_site_instructions_due ON site_instructions (company_id, due_date) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS ix_site_instructions_location ON site_instructions (location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_instructions_activity ON site_instructions (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_instructions_partner ON site_instructions (backcharge_partner_id) WHERE backcharge_partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_instructions_letter ON site_instructions (letter_id) WHERE letter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_site_instructions_parent ON site_instructions (parent_instruction_id) WHERE parent_instruction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS site_instruction_acks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  instruction_id  INTEGER NOT NULL REFERENCES site_instructions (id),
  party_type      TEXT    NOT NULL CHECK (party_type IN ('SUBCONTRACTOR', 'CREW', 'PERSON')),
  party_id        INTEGER,
  party_name      TEXT    NOT NULL,
  acknowledged_at TEXT,
  acknowledged_by TEXT,
  compliance_note TEXT,
  closed_at       TEXT,
  closed_by       TEXT,
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
CREATE INDEX IF NOT EXISTS ix_site_instruction_acks_instruction ON site_instruction_acks (instruction_id);
CREATE INDEX IF NOT EXISTS ix_site_instruction_acks_open ON site_instruction_acks (company_id, party_type, party_id) WHERE closed_at IS NULL;
