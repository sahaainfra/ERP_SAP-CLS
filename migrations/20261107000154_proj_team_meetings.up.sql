-- Part 10.05: the project team, stakeholders, communication matrix, meetings, minutes and action items (module proj, tables proj_*).
-- proj_team: a member of the project with a project role (an active role of the role engine) and dates; adding one is approved (PM, then PD) and then asks the role engine (02.04) for the scoped assignment. proj_stakeholders: the people and
-- organisations around the project with influence and interest. proj_comm_matrix: what is reported to whom, how often. proj_meetings: a meeting with attendees, agenda, minutes and decisions; the minutes are issued (locked) when the chair approves; a
-- correction is a revision. proj_meeting_actions: the actions of a meeting; each becomes a task (04.08) when the minutes are issued.
CREATE TABLE IF NOT EXISTS proj_team (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  user_id         INTEGER NOT NULL REFERENCES iam_users (id),
  username        TEXT    NOT NULL,
  project_role    TEXT    NOT NULL,
  from_date       TEXT    NOT NULL,
  to_date         TEXT,
  team_status     TEXT    NOT NULL DEFAULT 'REQUESTED' CHECK (team_status IN ('REQUESTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'ENDED')),
  reason          TEXT,
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  assignment_request_id INTEGER,
  assignment_id   INTEGER,
  access_note     TEXT,
  decided_at      TEXT,
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
  CHECK (to_date IS NULL OR to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS ix_proj_team_company_id ON proj_team (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_team_project ON proj_team (org_project_id, team_status);
CREATE INDEX IF NOT EXISTS ix_proj_team_user ON proj_team (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_team_open ON proj_team (org_project_id, user_id, project_role) WHERE deleted_at IS NULL AND team_status IN ('REQUESTED', 'APPROVED');

CREATE TABLE IF NOT EXISTS proj_stakeholders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  skind           TEXT    NOT NULL CHECK (skind IN ('CLIENT', 'CONSULTANT', 'AUTHORITY', 'FUNDER', 'SUBCONTRACTOR', 'SUPPLIER', 'COMMUNITY', 'OTHER')),
  organisation    TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  role_title      TEXT,
  influence       TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (influence IN ('LOW', 'MEDIUM', 'HIGH')),
  interest        TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (interest IN ('LOW', 'MEDIUM', 'HIGH')),
  email           TEXT,
  phone           TEXT,
  partner_id      INTEGER REFERENCES mdm_partners (id),
  sstatus         TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (sstatus IN ('ACTIVE', 'INACTIVE')),
  notes           TEXT,
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
CREATE INDEX IF NOT EXISTS ix_proj_stakeholders_company_id ON proj_stakeholders (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_stakeholders_project ON proj_stakeholders (org_project_id, skind);
CREATE INDEX IF NOT EXISTS ix_proj_stakeholders_partner ON proj_stakeholders (partner_id);

CREATE TABLE IF NOT EXISTS proj_comm_matrix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  info            TEXT    NOT NULL,
  stakeholder_id  INTEGER REFERENCES proj_stakeholders (id),
  audience        TEXT,
  frequency       TEXT    NOT NULL CHECK (frequency IN ('DAILY', 'WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'QUARTERLY', 'ON_EVENT')),
  channel         TEXT    NOT NULL CHECK (channel IN ('EMAIL', 'MEETING', 'PORTAL', 'REPORT', 'LETTER', 'PHONE')),
  owner_user      TEXT,
  notes           TEXT,
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
CREATE INDEX IF NOT EXISTS ix_proj_comm_matrix_company_id ON proj_comm_matrix (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_comm_matrix_project ON proj_comm_matrix (org_project_id);
CREATE INDEX IF NOT EXISTS ix_proj_comm_matrix_stakeholder ON proj_comm_matrix (stakeholder_id);

CREATE TABLE IF NOT EXISTS proj_meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  rev_no          INTEGER NOT NULL DEFAULT 0 CHECK (rev_no >= 0),
  supersedes_id   INTEGER REFERENCES proj_meetings (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  mtype           TEXT    NOT NULL CHECK (mtype IN ('KICKOFF', 'WEEKLY_PROGRESS', 'COORDINATION', 'SAFETY', 'CLIENT_REVIEW', 'OTHER')),
  title           TEXT    NOT NULL,
  meeting_date    TEXT    NOT NULL,
  start_time      TEXT,
  location        TEXT,
  chair_user      TEXT    NOT NULL,
  minute_taker    TEXT    NOT NULL,
  attendees_json  TEXT    NOT NULL DEFAULT '[]',
  agenda_json     TEXT    NOT NULL DEFAULT '[]',
  minutes         TEXT,
  decisions_json  TEXT    NOT NULL DEFAULT '[]',
  distribution_json TEXT,
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  workflow_instance_id INTEGER,
  requested_by    TEXT,
  revision_reason TEXT,
  issued_at       TEXT,
  issued_by       TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_proj_meetings_doc ON proj_meetings (company_id, doc_no, rev_no);
CREATE INDEX IF NOT EXISTS ix_proj_meetings_company_id ON proj_meetings (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_meetings_project ON proj_meetings (org_project_id, meeting_date);
CREATE INDEX IF NOT EXISTS ix_proj_meetings_status ON proj_meetings (company_id, status);
CREATE INDEX IF NOT EXISTS ix_proj_meetings_supersedes ON proj_meetings (supersedes_id);

CREATE TABLE IF NOT EXISTS proj_meeting_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  meeting_id      INTEGER NOT NULL REFERENCES proj_meetings (id),
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  action_no       INTEGER NOT NULL CHECK (action_no >= 1),
  description     TEXT    NOT NULL,
  owner_user      TEXT    NOT NULL,
  due_date        TEXT    NOT NULL,
  priority        TEXT    NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  task_id         INTEGER,
  action_status   TEXT    NOT NULL DEFAULT 'OPEN' CHECK (action_status IN ('OPEN', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED')),
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
CREATE INDEX IF NOT EXISTS ix_proj_meeting_actions_company_id ON proj_meeting_actions (company_id);
CREATE INDEX IF NOT EXISTS ix_proj_meeting_actions_meeting ON proj_meeting_actions (meeting_id, action_no);
CREATE INDEX IF NOT EXISTS ix_proj_meeting_actions_project ON proj_meeting_actions (org_project_id, action_status);
CREATE INDEX IF NOT EXISTS ix_proj_meeting_actions_owner ON proj_meeting_actions (company_id, owner_user, due_date);
CREATE INDEX IF NOT EXISTS ix_proj_meeting_actions_task ON proj_meeting_actions (task_id);
