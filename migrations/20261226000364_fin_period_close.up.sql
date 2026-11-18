-- Part 23.14: the close of a month (approval-controlled, ACCMGR → CFO): its checklist of tasks across the modules (owners, due dates, dependencies, evidence,
-- the automatic check of each), the module locks and the GL soft and hard close; the reopen of a closed month (approval-controlled, ACCMGR → CFO → DIR).
-- The period statuses themselves stay on core_periods.module_status_json (01.03); these tables hold the close and its evidence.
CREATE TABLE IF NOT EXISTS close_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  version_no      INTEGER NOT NULL DEFAULT 1 CHECK (version_no >= 1),
  period_id       INTEGER NOT NULL REFERENCES core_periods (id),
  period          TEXT    NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  close_state     TEXT    NOT NULL DEFAULT 'IN_PROGRESS' CHECK (close_state IN ('IN_PROGRESS', 'SOFT_CLOSED', 'CLOSED', 'REOPENED')),
  checklist_json  TEXT    NOT NULL DEFAULT '{}',
  figures_json    TEXT    NOT NULL DEFAULT '{}',
  soft_closed_at  TEXT,
  locked_at       TEXT,
  reopened_at     TEXT,
  commentary      TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES close_periods (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_close_periods_doc ON close_periods (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_close_periods_open ON close_periods (company_id, period_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_close_periods_list ON close_periods (company_id, period, status);
CREATE INDEX IF NOT EXISTS ix_close_periods_period_id ON close_periods (period_id);
CREATE INDEX IF NOT EXISTS ix_close_periods_wf ON close_periods (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_close_periods_amends ON close_periods (amends_id);

CREATE TABLE IF NOT EXISTS close_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  close_id        INTEGER NOT NULL REFERENCES close_periods (id),
  task_code       TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  module          TEXT    NOT NULL,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  mandatory       INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
  depends_on_json TEXT    NOT NULL DEFAULT '[]',
  owner_role      TEXT,
  owner_id        TEXT,
  due_date        TEXT,
  task_status     TEXT    NOT NULL DEFAULT 'OPEN' CHECK (task_status IN ('OPEN', 'IN_PROGRESS', 'DONE', 'NOT_APPLICABLE')),
  check_json      TEXT    NOT NULL DEFAULT '{}',
  evidence_note   TEXT,
  evidence_file_ids TEXT  NOT NULL DEFAULT '[]',
  done_by         TEXT,
  done_at         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_close_tasks_code ON close_tasks (close_id, task_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_close_tasks_close_id ON close_tasks (close_id);
CREATE INDEX IF NOT EXISTS ix_close_tasks_company_id ON close_tasks (company_id, task_status, due_date);
CREATE INDEX IF NOT EXISTS ix_close_tasks_owner ON close_tasks (company_id, owner_id);

CREATE TABLE IF NOT EXISTS close_reopens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL,
  close_id        INTEGER NOT NULL REFERENCES close_periods (id),
  period_id       INTEGER NOT NULL REFERENCES core_periods (id),
  modules_json    TEXT    NOT NULL DEFAULT '[]',
  target_status   TEXT    NOT NULL DEFAULT 'Soft-closed' CHECK (target_status IN ('Open', 'Soft-closed')),
  reason          TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  requested_by    TEXT,
  approved_by     TEXT,
  approved_at     TEXT,
  workflow_instance_id INTEGER,
  cancel_reason   TEXT,
  amends_id       INTEGER REFERENCES close_reopens (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_close_reopens_doc ON close_reopens (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_close_reopens_open ON close_reopens (close_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_close_reopens_close_id ON close_reopens (close_id);
CREATE INDEX IF NOT EXISTS ix_close_reopens_period_id ON close_reopens (period_id);
CREATE INDEX IF NOT EXISTS ix_close_reopens_list ON close_reopens (company_id, status);
CREATE INDEX IF NOT EXISTS ix_close_reopens_wf ON close_reopens (workflow_instance_id);
CREATE INDEX IF NOT EXISTS ix_close_reopens_amends ON close_reopens (amends_id);
