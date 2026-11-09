-- Part 09.03: the review, the bid price summary and the assumptions register of an estimate (module est). Money in paise (x 100), percentages x 10 000, as in 09.01.
-- est_reviews: a review of an estimate version by the commercial manager or the director: the checklist ticked, the comments and the verdict (it also completes the reviewer's approval task when there is one).
-- est_bid_summary: the bid price of an estimate version: the components from the estimate, the discount or rebate (approved by the director above the threshold), GST and the final bid price.
-- est_assumptions: the assumptions, inclusions, exclusions and qualifications that go with the estimate and its bid.
CREATE TABLE IF NOT EXISTS est_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  estimate_id     INTEGER NOT NULL REFERENCES est_estimates (id),
  reviewer        TEXT    NOT NULL,
  checklist_json  TEXT    NOT NULL,
  comments        TEXT,
  verdict         TEXT    NOT NULL CHECK (verdict IN ('APPROVE', 'RETURN', 'NOTE')),
  review_status   TEXT    NOT NULL DEFAULT 'RECORDED' CHECK (review_status IN ('RECORDED', 'ACTED')),
  workflow_task_id INTEGER,
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
CREATE INDEX IF NOT EXISTS ix_est_reviews_company_id ON est_reviews (company_id);
CREATE INDEX IF NOT EXISTS ix_est_reviews_estimate ON est_reviews (estimate_id);
CREATE TABLE IF NOT EXISTS est_bid_summary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  estimate_id     INTEGER NOT NULL REFERENCES est_estimates (id),
  direct_cost     INTEGER NOT NULL DEFAULT 0,
  indirect_cost   INTEGER NOT NULL DEFAULT 0,
  overhead_amount INTEGER NOT NULL DEFAULT 0,
  contingency_amount INTEGER NOT NULL DEFAULT 0,
  escalation_amount INTEGER NOT NULL DEFAULT 0,
  total_cost      INTEGER NOT NULL DEFAULT 0,
  profit_amount   INTEGER NOT NULL DEFAULT 0,
  selling_amount  INTEGER NOT NULL DEFAULT 0 CHECK (selling_amount >= 0),
  discount_pct    INTEGER NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 1000000),
  discount_amount INTEGER NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  net_price       INTEGER NOT NULL DEFAULT 0 CHECK (net_price >= 0),
  gst_pct         INTEGER NOT NULL DEFAULT 0 CHECK (gst_pct >= 0),
  gst_amount      INTEGER NOT NULL DEFAULT 0 CHECK (gst_amount >= 0),
  bid_price       INTEGER NOT NULL DEFAULT 0 CHECK (bid_price >= 0),
  discount_reason TEXT,
  discount_status TEXT    NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (discount_status IN ('NOT_REQUIRED', 'DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  decided_at      TEXT,
  calculated_at   TEXT,
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
  remarks     TEXT,
  CHECK (profit_amount + total_cost = selling_amount)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_est_bid_summary_estimate ON est_bid_summary (estimate_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_est_bid_summary_company_id ON est_bid_summary (company_id);
CREATE INDEX IF NOT EXISTS ix_est_bid_summary_status ON est_bid_summary (company_id, discount_status);
CREATE TABLE IF NOT EXISTS est_assumptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  estimate_id     INTEGER NOT NULL REFERENCES est_estimates (id),
  kind            TEXT    NOT NULL CHECK (kind IN ('ASSUMPTION', 'INCLUSION', 'EXCLUSION', 'QUALIFICATION')),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  text            TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_est_assumptions_company_id ON est_assumptions (company_id);
CREATE INDEX IF NOT EXISTS ix_est_assumptions_estimate ON est_assumptions (estimate_id, kind, sort_order);
