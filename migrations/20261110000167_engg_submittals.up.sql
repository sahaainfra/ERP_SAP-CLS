-- Part 11.03: submittals (module engg, tables engg_*).
-- engg_submittals: a material approval request, method statement, shop drawing, sample, mock-up, product data or quality plan with its spec section, activity, item, make and model, required-by date, current revision, status and last response.
-- engg_submittal_revisions: the review cycles (each submission to the consultant and its response code A to D). engg_approved_makes: the makes and models approved by a material approval, read by procurement (15.03, 15.05) and receiving inspection (18.03).
CREATE TABLE IF NOT EXISTS engg_submittals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  submittal_no    TEXT    NOT NULL COLLATE NOCASE,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  submittal_type  TEXT    NOT NULL CHECK (submittal_type IN ('MAR', 'METHOD_STATEMENT', 'SHOP_DRAWING', 'SAMPLE', 'MOCK_UP', 'PRODUCT_DATA', 'QUALITY_PLAN')),
  title           TEXT    NOT NULL,
  spec_section    TEXT,
  activity_ref    TEXT,
  wbs_id          INTEGER REFERENCES proj_wbs (id),
  item_id         INTEGER REFERENCES mdm_items (id),
  material_ref    TEXT,
  make            TEXT,
  model           TEXT,
  supplier        TEXT,
  drawing_id      INTEGER REFERENCES engg_drawings (id),
  hse_ref         TEXT,
  consultant      TEXT,
  need_date       TEXT,
  lead_time_days  INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  review_days     INTEGER NOT NULL DEFAULT 14 CHECK (review_days >= 0),
  required_by     TEXT    NOT NULL,
  current_rev     INTEGER NOT NULL DEFAULT 0 CHECK (current_rev >= 0),
  submitted_on    TEXT,
  response_code   TEXT    CHECK (response_code IS NULL OR response_code IN ('A', 'B', 'C', 'D')),
  response_on     TEXT,
  response_text   TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'WITH_CONSULTANT', 'APPROVED', 'REVISE', 'REJECTED', 'RETURNED', 'CANCELLED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_submittals_no ON engg_submittals (company_id, submittal_no);
CREATE INDEX IF NOT EXISTS ix_engg_submittals_company_id ON engg_submittals (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_submittals_project ON engg_submittals (org_project_id, status, submittal_type);
CREATE INDEX IF NOT EXISTS ix_engg_submittals_wbs ON engg_submittals (wbs_id);
CREATE INDEX IF NOT EXISTS ix_engg_submittals_item ON engg_submittals (item_id);
CREATE INDEX IF NOT EXISTS ix_engg_submittals_drawing ON engg_submittals (drawing_id);
CREATE INDEX IF NOT EXISTS ix_engg_submittals_required ON engg_submittals (org_project_id, required_by);

CREATE TABLE IF NOT EXISTS engg_submittal_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  submittal_id    INTEGER NOT NULL REFERENCES engg_submittals (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  rev_no          INTEGER NOT NULL CHECK (rev_no >= 1),
  change_note     TEXT,
  submitted_on    TEXT,
  response_code   TEXT    CHECK (response_code IS NULL OR response_code IN ('A', 'B', 'C', 'D')),
  response_on     TEXT,
  response_by     TEXT,
  response_text   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_submittal_revisions_rev ON engg_submittal_revisions (submittal_id, rev_no);
CREATE INDEX IF NOT EXISTS ix_engg_submittal_revisions_company_id ON engg_submittal_revisions (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_submittal_revisions_project ON engg_submittal_revisions (org_project_id);

CREATE TABLE IF NOT EXISTS engg_approved_makes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  submittal_id    INTEGER NOT NULL REFERENCES engg_submittals (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  item_id         INTEGER REFERENCES mdm_items (id),
  material_ref    TEXT,
  make            TEXT    NOT NULL COLLATE NOCASE,
  model           TEXT    COLLATE NOCASE,
  supplier        TEXT,
  approved_on     TEXT    NOT NULL,
  approval_code   TEXT    NOT NULL CHECK (approval_code IN ('A', 'B')),
  make_status     TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (make_status IN ('ACTIVE', 'WITHDRAWN')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_engg_approved_makes_submittal ON engg_approved_makes (submittal_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_engg_approved_makes_company_id ON engg_approved_makes (company_id);
CREATE INDEX IF NOT EXISTS ix_engg_approved_makes_project ON engg_approved_makes (org_project_id, make_status);
CREATE INDEX IF NOT EXISTS ix_engg_approved_makes_item ON engg_approved_makes (item_id);
