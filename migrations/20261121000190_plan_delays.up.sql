-- Part 13.05: the delay register and the time-impact records.
-- plan_delays: a delay event with its dates, cause, responsibility, the activities it touches, mitigation and concurrency notes; its classification is approved and then locked, and changed by a revision
-- (FR-01, FR-05). Drafts come from the RFIs answered with a time impact (src_entity, src_id) (FR-02).
-- plan_tia: a time-impact analysis: the fragnet put into a copy of the schedule as at a date, the completion before and after and the activities that moved; the schedule itself is never written (FR-03, BR-01).
-- plan_delay_evidence: the RFIs, letters, drawings, files and other records a delay rests on (FR-04).

CREATE TABLE IF NOT EXISTS plan_delays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  doc_no          TEXT    NOT NULL COLLATE NOCASE,
  doc_date        TEXT    NOT NULL,
  org_project_id  INTEGER NOT NULL REFERENCES org_projects (id),
  schedule_id     INTEGER REFERENCES plan_schedules (id),
  title           TEXT    NOT NULL,
  description     TEXT,
  cause_category  TEXT    NOT NULL CHECK (cause_category IN ('LATE_DRAWINGS', 'LATE_HANDOVER', 'CHANGE', 'WEATHER', 'FORCE_MAJEURE', 'CONTRACTOR_RESOURCES', 'STATUTORY', 'OTHER')),
  responsibility  TEXT    NOT NULL CHECK (responsibility IN ('EMPLOYER', 'CONTRACTOR', 'NEUTRAL')),
  start_date      TEXT    NOT NULL,
  end_date        TEXT    NOT NULL,
  delay_days      INTEGER NOT NULL CHECK (delay_days >= 1),
  affected_activities_json TEXT NOT NULL DEFAULT '[]',
  mitigation      TEXT,
  concurrency_note TEXT,
  impact_days     INTEGER,
  tia_id          INTEGER,
  revision_no     INTEGER NOT NULL DEFAULT 1 CHECK (revision_no >= 1),
  parent_delay_id INTEGER REFERENCES plan_delays (id),
  status          TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'RETURNED', 'REJECTED', 'CANCELLED', 'SUPERSEDED')),
  src_entity      TEXT,
  src_id          TEXT,
  reason          TEXT,
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
  CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_delays_doc ON plan_delays (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_plan_delays_company_id ON plan_delays (company_id, status);
CREATE INDEX IF NOT EXISTS ix_plan_delays_project ON plan_delays (org_project_id, status, start_date);
CREATE INDEX IF NOT EXISTS ix_plan_delays_class ON plan_delays (company_id, cause_category, responsibility, status);
CREATE INDEX IF NOT EXISTS ix_plan_delays_schedule ON plan_delays (schedule_id);
CREATE INDEX IF NOT EXISTS ix_plan_delays_parent ON plan_delays (parent_delay_id) WHERE parent_delay_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_plan_delays_source ON plan_delays (src_entity, src_id) WHERE src_entity IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_plan_delays_tia ON plan_delays (tia_id);

CREATE TABLE IF NOT EXISTS plan_tia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  delay_id        INTEGER NOT NULL REFERENCES plan_delays (id),
  schedule_id     INTEGER NOT NULL REFERENCES plan_schedules (id),
  schedule_copy_ref TEXT  NOT NULL,
  data_date       TEXT    NOT NULL,
  fragnet_json    TEXT    NOT NULL,
  completion_before TEXT  NOT NULL,
  completion_after TEXT   NOT NULL,
  impact_days     INTEGER NOT NULL,
  impact_working_days INTEGER NOT NULL,
  result_json     TEXT    NOT NULL DEFAULT '{}',
  analysed_by     TEXT    NOT NULL,
  analysed_at     TEXT    NOT NULL,
  note            TEXT,
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
CREATE INDEX IF NOT EXISTS ix_plan_tia_company_id ON plan_tia (company_id);
CREATE INDEX IF NOT EXISTS ix_plan_tia_delay ON plan_tia (delay_id, id);
CREATE INDEX IF NOT EXISTS ix_plan_tia_schedule ON plan_tia (schedule_id);

CREATE TABLE IF NOT EXISTS plan_delay_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  delay_id        INTEGER NOT NULL REFERENCES plan_delays (id),
  entity          TEXT    NOT NULL CHECK (entity IN ('engg_rfi', 'engg_letter', 'engg_drawing', 'core_file', 'plan_constraint', 'plan_weekly_plan')),
  entity_id       TEXT    NOT NULL,
  label           TEXT    NOT NULL,
  note            TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_plan_delay_evidence_link ON plan_delay_evidence (delay_id, entity, entity_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_plan_delay_evidence_company_id ON plan_delay_evidence (company_id);
CREATE INDEX IF NOT EXISTS ix_plan_delay_evidence_delay ON plan_delay_evidence (delay_id);
CREATE INDEX IF NOT EXISTS ix_plan_delay_evidence_entity ON plan_delay_evidence (entity, entity_id);
