-- Part 23.10: project accounting. The revenue recognised over time for a project and a month (percentage of completion by cost to cost or by output; Ind AS 115 /
-- AS 7), with the unbilled revenue (contract asset), the billing in excess (contract liability) and the provision for a foreseeable loss; and the overhead of the
-- department pools (12.04) posted to the projects.
CREATE TABLE IF NOT EXISTS pa_revenue_recognition (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  period_id       INTEGER REFERENCES core_periods (id),
  method          TEXT    NOT NULL DEFAULT 'COST_TO_COST' CHECK (method IN ('COST_TO_COST', 'OUTPUT')),
  survey_pct_ppm  INTEGER CHECK (survey_pct_ppm IS NULL OR survey_pct_ppm BETWEEN 0 AND 1000000),
  survey_note     TEXT,
  cost_to_date_paise INTEGER NOT NULL DEFAULT 0 CHECK (cost_to_date_paise >= 0),
  eac_paise       INTEGER NOT NULL DEFAULT 0 CHECK (eac_paise >= 0),
  eac_source      TEXT    NOT NULL DEFAULT 'BUDGET' CHECK (eac_source IN ('FORECAST', 'BUDGET')),
  eac_ref         TEXT,
  output_paise    INTEGER NOT NULL DEFAULT 0 CHECK (output_paise >= 0),
  poc_ppm         INTEGER NOT NULL DEFAULT 0 CHECK (poc_ppm BETWEEN 0 AND 1000000),
  contract_revenue_paise INTEGER NOT NULL DEFAULT 0 CHECK (contract_revenue_paise >= 0),
  recognised_cum_paise INTEGER NOT NULL DEFAULT 0 CHECK (recognised_cum_paise >= 0),
  recognised_prev_paise INTEGER NOT NULL DEFAULT 0 CHECK (recognised_prev_paise >= 0),
  recognised_period_paise INTEGER NOT NULL DEFAULT 0,
  billed_cum_paise INTEGER NOT NULL DEFAULT 0 CHECK (billed_cum_paise >= 0),
  unbilled_paise  INTEGER NOT NULL DEFAULT 0 CHECK (unbilled_paise >= 0),
  excess_billing_paise INTEGER NOT NULL DEFAULT 0 CHECK (excess_billing_paise >= 0),
  expected_loss_paise INTEGER NOT NULL DEFAULT 0 CHECK (expected_loss_paise >= 0),
  loss_provision_paise INTEGER NOT NULL DEFAULT 0 CHECK (loss_provision_paise >= 0),
  prev_unbilled_paise INTEGER NOT NULL DEFAULT 0 CHECK (prev_unbilled_paise >= 0),
  prev_excess_paise INTEGER NOT NULL DEFAULT 0 CHECK (prev_excess_paise >= 0),
  prev_provision_paise INTEGER NOT NULL DEFAULT 0 CHECK (prev_provision_paise >= 0),
  calc_json       TEXT    NOT NULL DEFAULT '{}',
  journal_id      INTEGER REFERENCES fin_journals (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES pa_revenue_recognition (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pa_revenue_recognition_doc ON pa_revenue_recognition (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pa_revenue_recognition_open ON pa_revenue_recognition (org_project_id, period) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pa_revenue_recognition_list ON pa_revenue_recognition (company_id, period, status);
CREATE INDEX IF NOT EXISTS ix_pa_revenue_recognition_project ON pa_revenue_recognition (org_project_id, period);
CREATE INDEX IF NOT EXISTS ix_pa_revenue_recognition_period ON pa_revenue_recognition (period_id);
CREATE INDEX IF NOT EXISTS ix_pa_revenue_recognition_wf ON pa_revenue_recognition (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_pa_revenue_recognition_journal ON pa_revenue_recognition (journal_id);
CREATE INDEX IF NOT EXISTS ix_pa_revenue_recognition_amends ON pa_revenue_recognition (amends_id);

CREATE TABLE IF NOT EXISTS pa_overhead_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  run_id          INTEGER NOT NULL REFERENCES bud_alloc_runs (id),
  pool            TEXT    NOT NULL,
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  period_id       INTEGER REFERENCES core_periods (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  basis_value_paise INTEGER NOT NULL DEFAULT 0,
  amount_paise    INTEGER NOT NULL CHECK (amount_paise >= 0),
  journal_id      INTEGER REFERENCES fin_journals (id),
  alloc_status    TEXT    NOT NULL DEFAULT 'POSTED' CHECK (alloc_status IN ('POSTED', 'REVERSED')),
  reversal_journal_id INTEGER REFERENCES fin_journals (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_pa_overhead_allocations_run ON pa_overhead_allocations (run_id, org_project_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_pa_overhead_allocations_list ON pa_overhead_allocations (company_id, period);
CREATE INDEX IF NOT EXISTS ix_pa_overhead_allocations_project ON pa_overhead_allocations (org_project_id, period);
CREATE INDEX IF NOT EXISTS ix_pa_overhead_allocations_period ON pa_overhead_allocations (period_id);
CREATE INDEX IF NOT EXISTS ix_pa_overhead_allocations_journal ON pa_overhead_allocations (journal_id);
CREATE INDEX IF NOT EXISTS ix_pa_overhead_allocations_rev ON pa_overhead_allocations (reversal_journal_id);
