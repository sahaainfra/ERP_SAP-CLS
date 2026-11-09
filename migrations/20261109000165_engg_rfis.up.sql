-- Part 11.02: RFI management (module engg, tables engg_*).
-- engg_rfis: a request for information with its links (location, activity, BOQ item, drawing and revision, specification clause), priority, required-by date, ball in court, the response, the impacts and its place in the issue and closure approvals.
-- engg_rfi_routing: the routing timeline (who held it, when, what happened). engg_rfi_delay_drafts: the delay-register draft that a time-impact response creates until the delay register (13.05) takes it over.
CREATE TABLE IF NOT EXISTS engg_rfis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rfi_no          TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  subject         TEXT    NOT NULL,
  question        TEXT    NOT NULL,
  discipline      TEXT    NOT NULL CHECK (discipline IN ('ARCHITECTURAL', 'STRUCTURAL', 'MEP', 'CIVIL', 'LANDSCAPE')),
  rfi_site_id     INTEGER REFERENCES org_sites (id),
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  location_id     INTEGER REFERENCES proj_locations (id),
  activity_ref    TEXT,
  activity_critical INTEGER NOT NULL DEFAULT 0 CHECK (activity_critical IN (0, 1)),
  hold_activity   INTEGER NOT NULL DEFAULT 0 CHECK (hold_activity IN (0, 1)),
  boq_item_id     INTEGER,
  drawing_id      INTEGER REFERENCES engg_drawings (id),
  drawing_revision_id INTEGER REFERENCES engg_drawing_revisions (id),
  spec_ref        TEXT,
  proposed_solution TEXT,
  priority        TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  required_by     TEXT    NOT NULL,
  cost_impact_flag INTEGER NOT NULL DEFAULT 0 CHECK (cost_impact_flag IN (0, 1)),
  time_impact_flag INTEGER NOT NULL DEFAULT 0 CHECK (time_impact_flag IN (0, 1)),
  ball_in_court   TEXT    NOT NULL DEFAULT 'RAISER' CHECK (ball_in_court IN ('RAISER', 'DESIGN', 'CONSULTANT', 'VERIFIER', 'NONE')),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'ISSUED', 'RESPONDED', 'CLOSE_REQUESTED', 'CLOSED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  issued_on       TEXT,
  consultant      TEXT,
  response_type   TEXT    CHECK (response_type IS NULL OR response_type IN ('CLARIFICATION', 'DESIGN_CHANGE', 'INSTRUCTION')),
  response_text   TEXT,
  responded_on    TEXT,
  responded_by    TEXT,
  response_revision_id INTEGER REFERENCES engg_drawing_revisions (id),
  instruction_ref TEXT,
  cost_impact     INTEGER NOT NULL DEFAULT 0 CHECK (cost_impact >= 0),
  time_impact_days INTEGER NOT NULL DEFAULT 0 CHECK (time_impact_days >= 0),
  variation_ref   TEXT,
  verified_by     TEXT,
  verified_on     TEXT,
  closed_at       TEXT,
  escalated_at    TEXT,
  issue_workflow_id INTEGER,
  close_workflow_id INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_rfis_no ON engg_rfis (company_id, rfi_no);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_company_id ON engg_rfis (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_project ON engg_rfis (org_project_id, status, priority);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_site ON engg_rfis (rfi_site_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_wbs ON engg_rfis (wbs_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_location ON engg_rfis (location_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_drawing ON engg_rfis (drawing_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_revision ON engg_rfis (drawing_revision_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_response_revision ON engg_rfis (response_revision_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_required ON engg_rfis (org_project_id, required_by);
CREATE INDEX IF NOT EXISTS ix_engg_rfis_ball ON engg_rfis (company_id, ball_in_court, status);

CREATE TABLE IF NOT EXISTS engg_rfi_routing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rfi_id          INTEGER NOT NULL REFERENCES engg_rfis (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  seq             INTEGER NOT NULL CHECK (seq >= 1),
  event           TEXT    NOT NULL,
  from_party      TEXT,
  to_party        TEXT    NOT NULL,
  note            TEXT,
  at              TEXT    NOT NULL,
  by_user         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_rfi_routing_seq ON engg_rfi_routing (rfi_id, seq);
CREATE INDEX IF NOT EXISTS ix_engg_rfi_routing_company_id ON engg_rfi_routing (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfi_routing_project ON engg_rfi_routing (org_project_id);

CREATE TABLE IF NOT EXISTS engg_rfi_delay_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rfi_id          INTEGER NOT NULL REFERENCES engg_rfis (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  delay_days      INTEGER NOT NULL CHECK (delay_days >= 1),
  activity_ref    TEXT,
  reason          TEXT    NOT NULL,
  draft_status    TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (draft_status IN ('DRAFT', 'TAKEN_OVER', 'DISCARDED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_rfi_delay_drafts_rfi ON engg_rfi_delay_drafts (rfi_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_engg_rfi_delay_drafts_company_id ON engg_rfi_delay_drafts (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_rfi_delay_drafts_project ON engg_rfi_delay_drafts (org_project_id, draft_status);
