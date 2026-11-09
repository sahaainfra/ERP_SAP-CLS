-- Part 08.01: CRM, leads, clients, contacts, interactions and the opportunity pipeline (module bd).
-- bd_leads: a lead from a source with its BANT-like qualification (approved = qualified; converted to an opportunity). bd_opportunities: the pipeline record (client from the partner master, sector, value, probability, stage,
-- competitors); its approval status is the go-ahead for tendering, its stage the pipeline position; a win comes only through a tender award or an approved direct award. bd_interactions: calls, meetings, site visits, e-mails and
-- notes with the next action (and the task that reminds). bd_contacts: the influence map of the contacts of a client. bd_stage_log: every move of an opportunity. bd_amendments: the snapshot an amendment replaces.

CREATE TABLE IF NOT EXISTS bd_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  source         TEXT    NOT NULL CHECK (source IN ('TENDER_PORTAL', 'REFERRAL', 'CLIENT_ENQUIRY', 'WEBSITE', 'EVENT', 'OTHER')),
  source_ref     TEXT,
  title          TEXT    NOT NULL,
  client_partner_id INTEGER REFERENCES mdm_partners (id),
  client_name    TEXT,
  contact_name   TEXT,
  phone          TEXT,
  email          TEXT,
  sector         TEXT    NOT NULL CHECK (sector IN ('BUILDING', 'ROADS', 'BRIDGES', 'WATER', 'INDUSTRIAL', 'EPC', 'OTHER')),
  location       TEXT,
  region         TEXT,
  est_value_minor INTEGER NOT NULL DEFAULT 0 CHECK (est_value_minor >= 0),
  qualification_json TEXT NOT NULL DEFAULT '{}',
  qual_score     INTEGER NOT NULL DEFAULT 0 CHECK (qual_score BETWEEN 0 AND 100),
  owner          TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'CONVERTED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  amendment_no   INTEGER NOT NULL DEFAULT 0,
  opportunity_id INTEGER,
  converted_at   TEXT,
  converted_by   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bd_leads_doc ON bd_leads (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_bd_leads_company_id ON bd_leads (company_id);
CREATE INDEX IF NOT EXISTS ix_bd_leads_status ON bd_leads (company_id, status);
CREATE INDEX IF NOT EXISTS ix_bd_leads_owner ON bd_leads (company_id, owner);
CREATE INDEX IF NOT EXISTS ix_bd_leads_client ON bd_leads (client_partner_id);
CREATE INDEX IF NOT EXISTS ix_bd_leads_source ON bd_leads (company_id, source);

CREATE TABLE IF NOT EXISTS bd_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no         TEXT    NOT NULL COLLATE NOCASE,
  doc_date       TEXT    NOT NULL,
  lead_id        INTEGER REFERENCES bd_leads (id),
  client_partner_id INTEGER NOT NULL REFERENCES mdm_partners (id),
  name           TEXT    NOT NULL,
  sector         TEXT    NOT NULL CHECK (sector IN ('BUILDING', 'ROADS', 'BRIDGES', 'WATER', 'INDUSTRIAL', 'EPC', 'OTHER')),
  location       TEXT,
  region         TEXT,
  est_value_minor INTEGER NOT NULL DEFAULT 0 CHECK (est_value_minor >= 0),
  probability_pct INTEGER NOT NULL DEFAULT 0 CHECK (probability_pct BETWEEN 0 AND 100),
  probability_default_pct INTEGER NOT NULL DEFAULT 0 CHECK (probability_default_pct BETWEEN 0 AND 100),
  probability_reason TEXT,
  expected_tender_date TEXT,
  expected_award_date TEXT,
  stage          TEXT    NOT NULL DEFAULT 'IDENTIFIED' CHECK (stage IN ('IDENTIFIED', 'QUALIFIED', 'PRE_BID', 'TENDER_EXPECTED', 'BID_SUBMITTED', 'NEGOTIATION', 'WON', 'LOST')),
  competitors_json TEXT  NOT NULL DEFAULT '[]',
  owner          TEXT    NOT NULL,
  lost_reason_code TEXT,
  lost_reason    TEXT,
  lost_to        TEXT,
  won_via        TEXT    CHECK (won_via IS NULL OR won_via IN ('TENDER_AWARD', 'DIRECT_AWARD')),
  won_value_minor INTEGER CHECK (won_value_minor IS NULL OR won_value_minor >= 0),
  closed_on      TEXT,
  status         TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by   TEXT,
  amendment_no   INTEGER NOT NULL DEFAULT 0,
  award_status   TEXT    NOT NULL DEFAULT 'NONE' CHECK (award_status IN ('NONE', 'REQUESTED', 'APPROVED', 'REJECTED')),
  award_instance_id INTEGER,
  award_reason   TEXT,
  award_value_minor INTEGER CHECK (award_value_minor IS NULL OR award_value_minor >= 0),
  converted_at   TEXT,
  converted_by   TEXT,
  tender_ref     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_bd_opportunities_doc ON bd_opportunities (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_bd_opportunities_company_id ON bd_opportunities (company_id);
CREATE INDEX IF NOT EXISTS ix_bd_opportunities_stage ON bd_opportunities (company_id, stage);
CREATE INDEX IF NOT EXISTS ix_bd_opportunities_status ON bd_opportunities (company_id, status);
CREATE INDEX IF NOT EXISTS ix_bd_opportunities_owner ON bd_opportunities (company_id, owner);
CREATE INDEX IF NOT EXISTS ix_bd_opportunities_client ON bd_opportunities (client_partner_id);
CREATE INDEX IF NOT EXISTS ix_bd_opportunities_lead ON bd_opportunities (lead_id);
CREATE INDEX IF NOT EXISTS ix_bd_opportunities_award ON bd_opportunities (company_id, expected_award_date);
CREATE INDEX IF NOT EXISTS ix_bd_opportunities_sector ON bd_opportunities (company_id, sector, region);

CREATE TABLE IF NOT EXISTS bd_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  entity         TEXT    NOT NULL CHECK (entity IN ('LEAD', 'OPPORTUNITY', 'CLIENT')),
  entity_id      INTEGER NOT NULL,
  client_partner_id INTEGER REFERENCES mdm_partners (id),
  type           TEXT    NOT NULL CHECK (type IN ('CALL', 'MEETING', 'SITE_VISIT', 'EMAIL', 'NOTE')),
  interaction_date TEXT  NOT NULL,
  participants_json TEXT NOT NULL DEFAULT '[]',
  notes          TEXT    NOT NULL,
  email_ref      TEXT,
  next_action    TEXT,
  next_action_date TEXT,
  next_action_owner TEXT,
  next_done      INTEGER NOT NULL DEFAULT 0 CHECK (next_done IN (0, 1)),
  task_id        INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_bd_interactions_company_id ON bd_interactions (company_id);
CREATE INDEX IF NOT EXISTS ix_bd_interactions_entity ON bd_interactions (entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_bd_interactions_client ON bd_interactions (client_partner_id);
CREATE INDEX IF NOT EXISTS ix_bd_interactions_next ON bd_interactions (company_id, next_done, next_action_date);

CREATE TABLE IF NOT EXISTS bd_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  partner_id     INTEGER NOT NULL REFERENCES mdm_partners (id),
  name           TEXT    NOT NULL,
  designation    TEXT,
  email          TEXT,
  mobile         TEXT,
  influence_role TEXT    NOT NULL DEFAULT 'INFLUENCER' CHECK (influence_role IN ('DECISION_MAKER', 'INFLUENCER', 'TECHNICAL', 'FINANCE', 'USER', 'GATEKEEPER')),
  influence_level INTEGER NOT NULL DEFAULT 3 CHECK (influence_level BETWEEN 1 AND 5),
  stance         TEXT    NOT NULL DEFAULT 'NEUTRAL' CHECK (stance IN ('CHAMPION', 'SUPPORTER', 'NEUTRAL', 'SKEPTIC', 'BLOCKER')),
  reports_to_id  INTEGER REFERENCES bd_contacts (id),
  relationship_owner TEXT,
  mdm_contact_id INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_bd_contacts_company_id ON bd_contacts (company_id);
CREATE INDEX IF NOT EXISTS ix_bd_contacts_partner ON bd_contacts (partner_id);
CREATE INDEX IF NOT EXISTS ix_bd_contacts_reports ON bd_contacts (reports_to_id);

CREATE TABLE IF NOT EXISTS bd_stage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  opportunity_id INTEGER NOT NULL REFERENCES bd_opportunities (id),
  from_stage     TEXT,
  to_stage       TEXT    NOT NULL,
  probability_pct INTEGER NOT NULL,
  reason         TEXT,
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
CREATE INDEX IF NOT EXISTS ix_bd_stage_log_company_id ON bd_stage_log (company_id);
CREATE INDEX IF NOT EXISTS ix_bd_stage_log_opportunity ON bd_stage_log (opportunity_id);

CREATE TABLE IF NOT EXISTS bd_amendments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  entity         TEXT    NOT NULL CHECK (entity IN ('LEAD', 'OPPORTUNITY')),
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
CREATE INDEX IF NOT EXISTS ix_bd_amendments_company_id ON bd_amendments (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bd_amendments ON bd_amendments (entity, entity_id, amendment_no);
