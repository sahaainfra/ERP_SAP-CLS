-- Part 10.02: project creation from an awarded tender and the commercial baseline handover (module proj, tables proj_*). Money in paise (x 100), quantities x 1 000, rates x 10 000, percentages x 10 000, as in the estimate.
-- proj_baseline_packs: the signed-off snapshot of the commercial baseline of a project (the tender, the award, the approved estimate with its priced BOQ, norms, quoted rates, priced risks, escalation basis, inclusions and exclusions, key
-- contract clauses); frozen with a hash when it is sent for sign-off, immutable once approved (a correction is a superseding pack). proj_handover_meetings: the handover from the estimation team to the execution team with attendees,
-- questions and actions (the actions are tasks of the task service). proj_boq_items: the BOQ and rates of the estimate copied into the project, each line linked to its estimate line (the thin store that the BOQ part 10.04 takes over).
CREATE TABLE IF NOT EXISTS proj_baseline_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  pack_no         INTEGER NOT NULL DEFAULT 1 CHECK (pack_no >= 1),
  supersedes_id   INTEGER REFERENCES proj_baseline_packs (id),
  project_id      INTEGER NOT NULL REFERENCES org_projects (id),
  tender_id       INTEGER REFERENCES tdr_tenders (id),
  award_id        INTEGER REFERENCES tdr_awards (id),
  estimate_id     INTEGER REFERENCES est_estimates (id),
  contract_value  INTEGER NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  snapshot_json   TEXT    NOT NULL DEFAULT '{}',
  snapshot_hash   TEXT,
  clauses_json    TEXT    NOT NULL DEFAULT '[]',
  file_id         INTEGER,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  amend_reason    TEXT,
  signed_off_at   TEXT,
  signed_off_by   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_baseline_packs_doc ON proj_baseline_packs (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_baseline_packs_live ON proj_baseline_packs (project_id) WHERE deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED');
CREATE INDEX IF NOT EXISTS ix_proj_baseline_packs_company_id ON proj_baseline_packs (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_baseline_packs_status ON proj_baseline_packs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proj_baseline_packs_project ON proj_baseline_packs (project_id);
CREATE INDEX IF NOT EXISTS ix_proj_baseline_packs_tender ON proj_baseline_packs (tender_id);
CREATE INDEX IF NOT EXISTS ix_proj_baseline_packs_award ON proj_baseline_packs (award_id);
CREATE INDEX IF NOT EXISTS ix_proj_baseline_packs_estimate ON proj_baseline_packs (estimate_id);
CREATE INDEX IF NOT EXISTS ix_proj_baseline_packs_supersedes ON proj_baseline_packs (supersedes_id);

CREATE TABLE IF NOT EXISTS proj_handover_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  pack_id         INTEGER NOT NULL REFERENCES proj_baseline_packs (id),
  meeting_date    TEXT    NOT NULL,
  venue           TEXT,
  attendees_json  TEXT    NOT NULL DEFAULT '[]',
  questions_json  TEXT    NOT NULL DEFAULT '[]',
  minutes         TEXT,
  actions_json    TEXT    NOT NULL DEFAULT '[]',
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
CREATE INDEX IF NOT EXISTS ix_proj_handover_meetings_company_id ON proj_handover_meetings (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_handover_meetings_pack ON proj_handover_meetings (pack_id, meeting_date);

CREATE TABLE IF NOT EXISTS proj_boq_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  estimate_item_id INTEGER REFERENCES est_estimate_items (id),
  section_code    TEXT    NOT NULL,
  section_name    TEXT,
  item_no         TEXT    NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  description     TEXT    NOT NULL,
  uom             TEXT    NOT NULL,
  qty             INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  client_rate     INTEGER CHECK (client_rate IS NULL OR client_rate >= 0),
  cost_rate       INTEGER NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
  markup_pct      INTEGER NOT NULL DEFAULT 0 CHECK (markup_pct >= 0),
  selling_rate    INTEGER NOT NULL DEFAULT 0 CHECK (selling_rate >= 0),
  cost_amount     INTEGER NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
  amount          INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  project_id  INTEGER NOT NULL REFERENCES org_projects (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_boq_items_item ON proj_boq_items (project_id, section_code, item_no) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_proj_boq_items_company_id ON proj_boq_items (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_boq_items_project ON proj_boq_items (project_id, sort_order);
CREATE INDEX IF NOT EXISTS ix_proj_boq_items_estimate_item ON proj_boq_items (estimate_item_id);
