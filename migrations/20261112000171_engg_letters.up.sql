-- Part 11.05: correspondence register (module engg, tables engg_*).
-- engg_letters: inward and outward letters, notices and instructions of a project with their reference, category, contract clause, response due date, assignee, confidentiality, thread parent, issue mode and acknowledgement proof; an outward letter is approved before it is numbered and issued.
-- engg_letter_links: the records a letter is evidence for (RFIs, variations, claims, site instructions, drawings, submittals, transmittals). engg_time_bars: notice obligations with a time limit (for example notice of claim within 28 days), their deadline, alert state and the letter that served them.
CREATE TABLE IF NOT EXISTS engg_letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  direction       TEXT    NOT NULL CHECK (direction IN ('IN', 'OUT')),
  letter_no       TEXT    COLLATE NOCASE,
  series_seq      INTEGER CHECK (series_seq IS NULL OR series_seq >= 1),
  their_ref       TEXT,
  letter_date     TEXT    NOT NULL,
  received_on     TEXT,
  issued_on       TEXT,
  party           TEXT    NOT NULL,
  party_contact   TEXT,
  subject         TEXT    NOT NULL,
  category        TEXT    NOT NULL CHECK (category IN ('INSTRUCTION', 'NOTICE', 'APPROVAL', 'QUERY', 'PAYMENT', 'OTHER')),
  clause_ref      TEXT,
  contractual     INTEGER NOT NULL DEFAULT 0 CHECK (contractual IN (0, 1)),
  confidentiality TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (confidentiality IN ('NORMAL', 'CONFIDENTIAL')),
  response_due    TEXT,
  assigned_to     TEXT,
  tags            TEXT,
  body_text       TEXT,
  template_code   TEXT,
  document_id     INTEGER REFERENCES doc_documents (id),
  parent_letter_id INTEGER REFERENCES engg_letters (id),
  time_bar_id     INTEGER,
  issue_mode      TEXT    CHECK (issue_mode IS NULL OR issue_mode IN ('EMAIL', 'COURIER', 'PORTAL', 'HAND')),
  delivery_ref    TEXT,
  ack_on          TEXT,
  ack_by          TEXT,
  ack_note        TEXT,
  overdue_alerted_on TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'ISSUED', 'ACKNOWLEDGED', 'REGISTERED', 'CLOSED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_letters_no ON engg_letters (company_id, letter_no) WHERE letter_no IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_letters_series ON engg_letters (org_project_id, direction, series_seq) WHERE series_seq IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_engg_letters_company_id ON engg_letters (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_letters_project ON engg_letters (org_project_id, direction, status);
CREATE INDEX IF NOT EXISTS ix_engg_letters_parent ON engg_letters (parent_letter_id);
CREATE INDEX IF NOT EXISTS ix_engg_letters_document ON engg_letters (document_id);
CREATE INDEX IF NOT EXISTS ix_engg_letters_due ON engg_letters (org_project_id, response_due);
CREATE INDEX IF NOT EXISTS ix_engg_letters_time_bar ON engg_letters (time_bar_id);

CREATE TABLE IF NOT EXISTS engg_letter_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  letter_id       INTEGER NOT NULL REFERENCES engg_letters (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  entity          TEXT    NOT NULL CHECK (entity IN ('RFI', 'VARIATION', 'CLAIM', 'SITE_INSTRUCTION', 'DRAWING', 'SUBMITTAL', 'TRANSMITTAL', 'OTHER')),
  entity_id       INTEGER,
  entity_ref      TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_letter_links_target ON engg_letter_links (letter_id, entity, entity_ref) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_engg_letter_links_company_id ON engg_letter_links (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_letter_links_entity ON engg_letter_links (org_project_id, entity, entity_id);

CREATE TABLE IF NOT EXISTS engg_time_bars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  bar_no          TEXT    NOT NULL COLLATE NOCASE,
  description     TEXT    NOT NULL,
  clause_ref      TEXT,
  trigger_letter_id INTEGER REFERENCES engg_letters (id),
  event_date      TEXT    NOT NULL,
  limit_days      INTEGER NOT NULL CHECK (limit_days >= 1),
  deadline        TEXT    NOT NULL,
  claim_ref       TEXT,
  owner_user      TEXT,
  last_alert_days INTEGER,
  served_letter_id INTEGER REFERENCES engg_letters (id),
  served_on       TEXT,
  bar_status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (bar_status IN ('OPEN', 'SERVED', 'LAPSED', 'WAIVED')),
  waive_reason    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_time_bars_no ON engg_time_bars (company_id, bar_no);
CREATE INDEX IF NOT EXISTS ix_engg_time_bars_company_id ON engg_time_bars (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_time_bars_project ON engg_time_bars (org_project_id, bar_status, deadline);
CREATE INDEX IF NOT EXISTS ix_engg_time_bars_trigger ON engg_time_bars (trigger_letter_id);
CREATE INDEX IF NOT EXISTS ix_engg_time_bars_served ON engg_time_bars (served_letter_id);
