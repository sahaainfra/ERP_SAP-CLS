-- Part 13.03: baselines of the programme and the exchange of schedules with MS Project and Primavera P6.
-- plan_baselines: a frozen picture of a schedule (dates, durations, logic, resources) with a number and an approval (FR-01, FR-02). Several are kept for a project (the original contract programme, then one for
-- each extension of time or re-sequencing); exactly one of the approved ones is the current baseline that variance and earned value read (BR-01). An approved baseline is never changed or removed:
-- two triggers refuse it whatever the code does. plan_imports: one row for each file read (MS Project XML, Primavera XML or XER) with its mapping and its validation report (FR-04); a file is
-- applied to the working schedule only, never to a baseline (BR-02).

CREATE TABLE IF NOT EXISTS plan_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  schedule_version_no INTEGER NOT NULL DEFAULT 1 CHECK (schedule_version_no >= 1),
  baseline_no     INTEGER NOT NULL CHECK (baseline_no >= 0),
  name            TEXT    NOT NULL,
  revision_type   TEXT    NOT NULL DEFAULT 'ORIGINAL' CHECK (revision_type IN ('ORIGINAL', 'EOT', 'RESEQUENCE', 'SCOPE', 'OTHER')),
  reason          TEXT    NOT NULL,
  change_summary  TEXT,
  reference_no    TEXT,
  previous_baseline_id INTEGER REFERENCES plan_baselines (id),
  snapshot_json   TEXT    NOT NULL,
  snapshot_hash   TEXT    NOT NULL,
  change_json     TEXT    NOT NULL DEFAULT '{}',
  start_date      TEXT,
  finish_date     TEXT,
  data_date       TEXT,
  activities_count INTEGER NOT NULL DEFAULT 0 CHECK (activities_count >= 0),
  critical_count  INTEGER NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
  links_count     INTEGER NOT NULL DEFAULT 0 CHECK (links_count >= 0),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED')),
  is_current      INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
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
  CHECK (is_current = 0 OR status = 'APPROVED')
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_baselines_doc ON plan_baselines (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_baselines_no ON plan_baselines (org_project_id, baseline_no) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_baselines_current ON plan_baselines (org_project_id) WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS ix_plan_baselines_company_id ON plan_baselines (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_baselines_project ON plan_baselines (org_project_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_baselines_schedule ON plan_baselines (schedule_id);
CREATE INDEX IF NOT EXISTS ix_plan_baselines_previous ON plan_baselines (previous_baseline_id);
CREATE INDEX IF NOT EXISTS ix_plan_baselines_date ON plan_baselines (company_id, doc_date);
CREATE TRIGGER IF NOT EXISTS trg_plan_baselines_frozen BEFORE UPDATE OF doc_no, doc_date, org_project_id, schedule_id, schedule_version_no, baseline_no, name, revision_type, reason, change_summary, reference_no, previous_baseline_id, snapshot_json, snapshot_hash, change_json, start_date, finish_date, data_date, activities_count, critical_count, links_count, status, requested_by, approved_by, approved_at, deleted_at, company_id ON plan_baselines WHEN OLD.status = 'APPROVED' BEGIN SELECT RAISE(ABORT, 'An approved baseline cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS trg_plan_baselines_no_delete BEFORE DELETE ON plan_baselines WHEN OLD.status = 'APPROVED' BEGIN SELECT RAISE(ABORT, 'An approved baseline cannot be removed'); END;

CREATE TABLE IF NOT EXISTS plan_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  file_id         INTEGER REFERENCES core_files (id),
  file_name       TEXT    NOT NULL,
  file_sha256     TEXT    NOT NULL,
  file_size       INTEGER NOT NULL CHECK (file_size > 0),
  format          TEXT    NOT NULL CHECK (format IN ('MSP_XML', 'P6_XML', 'P6_XER')),
  mode            TEXT    NOT NULL DEFAULT 'REPLACE' CHECK (mode IN ('REPLACE', 'MERGE')),
  mapping_json    TEXT    NOT NULL DEFAULT '{}',
  parsed_json     TEXT,
  result_json     TEXT    NOT NULL DEFAULT '{}',
  activities_count INTEGER NOT NULL DEFAULT 0 CHECK (activities_count >= 0),
  links_count     INTEGER NOT NULL DEFAULT 0 CHECK (links_count >= 0),
  errors_count    INTEGER NOT NULL DEFAULT 0 CHECK (errors_count >= 0),
  warnings_count  INTEGER NOT NULL DEFAULT 0 CHECK (warnings_count >= 0),
  status          TEXT    NOT NULL DEFAULT 'ANALYSED' CHECK (status IN ('ANALYSED', 'IMPORTED', 'DISCARDED')),
  imported_at     TEXT,
  imported_by     TEXT,
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
  CHECK ((status = 'IMPORTED') = (imported_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_plan_imports_company_id ON plan_imports (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_imports_project ON plan_imports (org_project_id, id);
CREATE INDEX IF NOT EXISTS ix_plan_imports_schedule ON plan_imports (schedule_id);
CREATE INDEX IF NOT EXISTS ix_plan_imports_file ON plan_imports (file_id);
