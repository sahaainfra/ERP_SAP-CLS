-- Part 04.01: the workflow engine. Versioned definitions per document type (wf_definitions), one instance per submission of a document
-- (wf_instances; it keeps the version it started with), the tasks of its steps (wf_tasks), attachments added at approval
-- (wf_task_attachments), the append-only history (wf_history), people who watch a document (wf_watchers), and the sample document type that
-- exercises every path (eng_sample_docs). Money is stored in minor units (integer paise), as everywhere else.

CREATE TABLE IF NOT EXISTS wf_definitions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  doc_type          TEXT    NOT NULL CHECK (doc_type GLOB '[A-Za-z]*' AND length(doc_type) <= 60),
  version           INTEGER NOT NULL CHECK (version >= 1),
  name              TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  steps_json        TEXT    NOT NULL,
  activation_instance_id INTEGER,
  activated_at      TEXT,
  activated_by      TEXT,
  retired_at        TEXT,
  project_id        INTEGER,
  site_id           INTEGER,
  created_by        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by        TEXT,
  updated_at        TEXT,
  row_version       INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at        TEXT,
  deleted_by        TEXT,
  source_type       TEXT,
  source_id         TEXT,
  remarks           TEXT,
  CHECK (status != 'ACTIVE' OR activated_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_definitions_version ON wf_definitions (company_id, doc_type, version);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_definitions_active ON wf_definitions (company_id, doc_type) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS ix_wf_definitions_activation ON wf_definitions (activation_instance_id);
CREATE INDEX IF NOT EXISTS ix_wf_definitions_status ON wf_definitions (company_id, status);

CREATE TABLE IF NOT EXISTS wf_instances (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES org_companies (id),
  doc_type             TEXT    NOT NULL,
  doc_id               TEXT    NOT NULL,
  doc_ref              TEXT,
  title                TEXT,
  definition_id        INTEGER NOT NULL REFERENCES wf_definitions (id),
  definition_version   INTEGER NOT NULL,
  steps_json           TEXT    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED', 'WITHDRAWN')),
  current_step         TEXT,
  cycle                INTEGER NOT NULL DEFAULT 1 CHECK (cycle >= 1),
  context_json         TEXT    NOT NULL DEFAULT '{}',
  previous_instance_id INTEGER REFERENCES wf_instances (id),
  needs_admin          INTEGER NOT NULL DEFAULT 0 CHECK (needs_admin IN (0, 1)),
  submitted_by         TEXT    NOT NULL,
  submitted_at         TEXT    NOT NULL,
  completed_at         TEXT,
  completed_reason     TEXT,
  project_id           INTEGER,
  site_id              INTEGER,
  created_by           TEXT,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by           TEXT,
  updated_at           TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at           TEXT,
  deleted_by           TEXT,
  source_type          TEXT,
  source_id            TEXT,
  remarks              TEXT,
  CHECK (status = 'RUNNING' OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_wf_instances_doc ON wf_instances (company_id, doc_type, doc_id);
CREATE INDEX IF NOT EXISTS ix_wf_instances_status ON wf_instances (company_id, status, doc_type);
CREATE INDEX IF NOT EXISTS ix_wf_instances_definition ON wf_instances (definition_id);
CREATE INDEX IF NOT EXISTS ix_wf_instances_submitter ON wf_instances (company_id, submitted_by);
CREATE INDEX IF NOT EXISTS ix_wf_instances_previous ON wf_instances (previous_instance_id);
-- one running instance for a document at a time
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_instances_running ON wf_instances (company_id, doc_type, doc_id) WHERE status = 'RUNNING';

CREATE TABLE IF NOT EXISTS wf_tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  instance_id       INTEGER NOT NULL REFERENCES wf_instances (id),
  step_code         TEXT    NOT NULL,
  step_no           INTEGER NOT NULL CHECK (step_no >= 1),
  cycle             INTEGER NOT NULL DEFAULT 1,
  kind              TEXT    NOT NULL DEFAULT 'APPROVAL' CHECK (kind IN ('APPROVAL', 'REVIEW', 'NOTIFY', 'SYSTEM')),
  assignee_user_id  TEXT,
  assignee_role     TEXT,
  scope_json        TEXT    NOT NULL DEFAULT '{}',
  status            TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'SKIPPED', 'CANCELLED', 'ADMIN_QUEUE')),
  due_at            TEXT,
  acted_at          TEXT,
  action            TEXT    CHECK (action IS NULL OR action IN ('approve', 'reject', 'return', 'acknowledge')),
  comment           TEXT,
  on_behalf_of      TEXT,
  delegated_from    TEXT,
  clarification     TEXT    NOT NULL DEFAULT 'NONE' CHECK (clarification IN ('NONE', 'ASKED')),
  reminded_at       TEXT,
  escalated_at      TEXT,
  superseded        INTEGER NOT NULL DEFAULT 0 CHECK (superseded IN (0, 1)),
  project_id        INTEGER,
  site_id           INTEGER,
  created_by        TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by        TEXT,
  updated_at        TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at        TEXT,
  deleted_by        TEXT,
  source_type       TEXT,
  source_id         TEXT,
  remarks           TEXT,
  CHECK (assignee_user_id IS NOT NULL OR assignee_role IS NOT NULL OR status IN ('ADMIN_QUEUE', 'CANCELLED', 'SKIPPED')),
  CHECK (status != 'DONE' OR (acted_at IS NOT NULL AND action IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ix_wf_tasks_instance ON wf_tasks (instance_id, step_no, status);
CREATE INDEX IF NOT EXISTS ix_wf_tasks_user ON wf_tasks (company_id, assignee_user_id, status);
CREATE INDEX IF NOT EXISTS ix_wf_tasks_role ON wf_tasks (company_id, assignee_role, status);
CREATE INDEX IF NOT EXISTS ix_wf_tasks_due ON wf_tasks (status, due_at);

CREATE TABLE IF NOT EXISTS wf_task_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  task_id     INTEGER NOT NULL REFERENCES wf_tasks (id),
  file_id     INTEGER NOT NULL REFERENCES core_files (id),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_task_attachments ON wf_task_attachments (task_id, file_id);
CREATE INDEX IF NOT EXISTS ix_wf_task_attachments_file ON wf_task_attachments (file_id);

-- The history is append-only: a row is never changed or removed.
CREATE TABLE IF NOT EXISTS wf_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  instance_id INTEGER NOT NULL REFERENCES wf_instances (id),
  task_id     INTEGER REFERENCES wf_tasks (id),
  cycle       INTEGER NOT NULL DEFAULT 1,
  step_code   TEXT,
  event       TEXT    NOT NULL,
  actor       TEXT    NOT NULL,
  comment     TEXT,
  data_json   TEXT    NOT NULL DEFAULT '{}',
  at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE INDEX IF NOT EXISTS ix_wf_history_instance ON wf_history (instance_id, id);
CREATE INDEX IF NOT EXISTS ix_wf_history_task ON wf_history (task_id);
CREATE TRIGGER IF NOT EXISTS trg_wf_history_no_update BEFORE UPDATE ON wf_history BEGIN SELECT RAISE(ABORT, 'The workflow history cannot be changed'); END;
CREATE TRIGGER IF NOT EXISTS trg_wf_history_no_delete BEFORE DELETE ON wf_history BEGIN SELECT RAISE(ABORT, 'The workflow history cannot be removed'); END;

CREATE TABLE IF NOT EXISTS wf_watchers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  instance_id INTEGER NOT NULL REFERENCES wf_instances (id),
  user_ref    TEXT    NOT NULL,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_watchers ON wf_watchers (instance_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_wf_watchers_user ON wf_watchers (company_id, user_ref);

-- The sample document type: a small purchase-style request that runs every path of the engine and shows how a module integrates.
CREATE TABLE IF NOT EXISTS eng_sample_docs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no               TEXT    NOT NULL,
  title                TEXT    NOT NULL,
  amount               INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status               TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED')),
  locked               INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
  amends_id            INTEGER REFERENCES eng_sample_docs (id),
  requested_by         TEXT    NOT NULL,
  instance_id          INTEGER REFERENCES wf_instances (id),
  project_id           INTEGER,
  site_id              INTEGER,
  created_by           TEXT,
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by           TEXT,
  updated_at           TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at           TEXT,
  deleted_by           TEXT,
  source_type          TEXT,
  source_id            TEXT,
  remarks              TEXT,
  CHECK (status != 'APPROVED' OR locked = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_eng_sample_docs_no ON eng_sample_docs (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_eng_sample_docs_status ON eng_sample_docs (company_id, status);
CREATE INDEX IF NOT EXISTS ix_eng_sample_docs_instance ON eng_sample_docs (instance_id);
CREATE INDEX IF NOT EXISTS ix_eng_sample_docs_amends ON eng_sample_docs (amends_id);
