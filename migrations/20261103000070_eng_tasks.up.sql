-- Part 04.08: task management. tsk_tasks are the things people must do, linked to any record, from any module or raised by a senior; tsk_assignees say who does them and who watches;
-- tsk_checklist_items and tsk_dependencies break a task up and order it; tsk_comments are the discussion; tsk_escalations are the levels a late task has climbed;
-- tsk_routing_matrix is the department responsibility matrix that turns the topic of a senior's instruction into a department, a role and a person (a change waits for approval).

CREATE TABLE IF NOT EXISTS tsk_tasks (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            INTEGER NOT NULL REFERENCES org_companies (id),
  task_no               TEXT    NOT NULL,
  title                 TEXT    NOT NULL,
  description           TEXT,
  entity                TEXT,
  entity_id             TEXT,
  entity_label          TEXT,
  department_id         INTEGER REFERENCES org_departments (id),
  topic_code            TEXT,
  priority              TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  start_date            TEXT,
  due_date              TEXT,
  status                TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACCEPTED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'VERIFIED', 'CLOSED', 'CANCELLED')),
  blocked_reason        TEXT,
  recurrence_rule       TEXT,
  series_id             INTEGER,
  requires_acceptance   INTEGER NOT NULL DEFAULT 0 CHECK (requires_acceptance IN (0, 1)),
  requires_evidence     INTEGER NOT NULL DEFAULT 0 CHECK (requires_evidence IN (0, 1)),
  requires_verification INTEGER NOT NULL DEFAULT 0 CHECK (requires_verification IN (0, 1)),
  verified_by           TEXT,
  verified_at           TEXT,
  completed_by          TEXT,
  completed_at          TEXT,
  closed_at             TEXT,
  origin                TEXT    NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'auto', 'instruction')),
  assigner              TEXT    NOT NULL,
  routing_json          TEXT,
  escalation_level      INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 2),
  last_reminded_at      TEXT,
  last_escalated_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tsk_tasks_no ON tsk_tasks (company_id, task_no);
CREATE INDEX IF NOT EXISTS ix_tsk_tasks_list ON tsk_tasks (company_id, status, due_date);
CREATE INDEX IF NOT EXISTS ix_tsk_tasks_log ON tsk_tasks (company_id, id);
CREATE INDEX IF NOT EXISTS ix_tsk_tasks_record ON tsk_tasks (company_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_tsk_tasks_project ON tsk_tasks (company_id, project_id, status);
CREATE INDEX IF NOT EXISTS ix_tsk_tasks_department ON tsk_tasks (department_id);
CREATE INDEX IF NOT EXISTS ix_tsk_tasks_assigner ON tsk_tasks (company_id, assigner, status);
CREATE INDEX IF NOT EXISTS ix_tsk_tasks_series ON tsk_tasks (series_id);
CREATE INDEX IF NOT EXISTS ix_tsk_tasks_source ON tsk_tasks (company_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS tsk_assignees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  task_id     INTEGER NOT NULL REFERENCES tsk_tasks (id),
  user_ref    TEXT    NOT NULL,
  role        TEXT    NOT NULL CHECK (role IN ('ASSIGNEE', 'WATCHER')),
  accepted_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_tsk_assignees ON tsk_assignees (task_id, user_ref, role);
CREATE INDEX IF NOT EXISTS ix_tsk_assignees_user ON tsk_assignees (company_id, user_ref, role, is_active);

CREATE TABLE IF NOT EXISTS tsk_checklist_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  task_id     INTEGER NOT NULL REFERENCES tsk_tasks (id),
  position    INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  text        TEXT    NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_by     TEXT,
  done_at     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_tsk_checklist_items_company_id ON tsk_checklist_items (company_id);
CREATE INDEX IF NOT EXISTS ix_tsk_checklist_task ON tsk_checklist_items (task_id, position);

CREATE TABLE IF NOT EXISTS tsk_dependencies (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES org_companies (id),
  task_id             INTEGER NOT NULL REFERENCES tsk_tasks (id),
  depends_on_task_id  INTEGER NOT NULL REFERENCES tsk_tasks (id),
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
  CHECK (task_id != depends_on_task_id)
);
CREATE INDEX IF NOT EXISTS ix_tsk_dependencies_company_id ON tsk_dependencies (company_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tsk_dependencies ON tsk_dependencies (task_id, depends_on_task_id);
CREATE INDEX IF NOT EXISTS ix_tsk_dependencies_on ON tsk_dependencies (depends_on_task_id);

CREATE TABLE IF NOT EXISTS tsk_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  task_id     INTEGER NOT NULL REFERENCES tsk_tasks (id),
  body        TEXT    NOT NULL,
  author_ref  TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_tsk_comments_company_id ON tsk_comments (company_id);
CREATE INDEX IF NOT EXISTS ix_tsk_comments_task ON tsk_comments (task_id, id);

CREATE TABLE IF NOT EXISTS tsk_escalations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  task_id     INTEGER NOT NULL REFERENCES tsk_tasks (id),
  level       INTEGER NOT NULL CHECK (level BETWEEN 1 AND 2),
  to_role     TEXT,
  to_user     TEXT,
  days_late   INTEGER NOT NULL DEFAULT 0 CHECK (days_late >= 0),
  at          TEXT    NOT NULL,
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
CREATE INDEX IF NOT EXISTS ix_tsk_escalations_company_id ON tsk_escalations (company_id);
CREATE INDEX IF NOT EXISTS ix_tsk_escalations_task ON tsk_escalations (task_id, level);

CREATE TABLE IF NOT EXISTS tsk_routing_matrix (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id            INTEGER NOT NULL REFERENCES org_companies (id),
  topic_code            TEXT    NOT NULL,
  topic_name            TEXT    NOT NULL,
  department_id         INTEGER NOT NULL REFERENCES org_departments (id),
  role_code             TEXT    NOT NULL,
  fallback_user_ref     TEXT,
  raci_process_code     TEXT,
  default_priority      TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (default_priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  default_due_days      INTEGER NOT NULL DEFAULT 7 CHECK (default_due_days BETWEEN 0 AND 365),
  requires_evidence     INTEGER NOT NULL DEFAULT 0 CHECK (requires_evidence IN (0, 1)),
  requires_verification INTEGER NOT NULL DEFAULT 0 CHECK (requires_verification IN (0, 1)),
  effective_from        TEXT    NOT NULL,
  effective_to          TEXT,
  matrix_version        INTEGER NOT NULL DEFAULT 1 CHECK (matrix_version >= 1),
  status                TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  batch_id              INTEGER,
  instance_id           INTEGER,
  reason                TEXT,
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
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS ix_tsk_routing_topic ON tsk_routing_matrix (company_id, topic_code, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_tsk_routing_department ON tsk_routing_matrix (department_id);
CREATE INDEX IF NOT EXISTS ix_tsk_routing_batch ON tsk_routing_matrix (batch_id);
