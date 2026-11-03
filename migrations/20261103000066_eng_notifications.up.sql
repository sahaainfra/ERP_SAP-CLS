-- Part 04.06: the notification engine. ntf_templates are the words of a notification per code, channel and language (shared rows have no company; a change is a new
-- version that waits for approval); ntf_notifications are what a person sees in the notification centre; ntf_preferences are a person's choices (channel by category,
-- quiet hours, digest); ntf_deliveries are the log of each channel's attempt; ntf_realtime_events is the log the socket layer replays from after a reconnect.

CREATE TABLE IF NOT EXISTS ntf_templates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER REFERENCES org_companies (id),
  code           TEXT    NOT NULL,
  category       TEXT    NOT NULL CHECK (category IN ('approvals','tasks','alerts','mentions','system','security','statutory')),
  channel        TEXT    NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  lang           TEXT    NOT NULL CHECK (lang IN ('en', 'hi')),
  subject        TEXT    NOT NULL DEFAULT '',
  body           TEXT    NOT NULL,
  variables_json TEXT    NOT NULL DEFAULT '[]',
  template_version INTEGER NOT NULL DEFAULT 1 CHECK (template_version >= 1),
  status         TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  reason         TEXT,
  instance_id    INTEGER REFERENCES wf_instances (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ntf_templates ON ntf_templates (COALESCE(company_id, 0), code, channel, lang, template_version);
CREATE INDEX IF NOT EXISTS ix_ntf_templates_lookup ON ntf_templates (code, channel, lang, status);
CREATE INDEX IF NOT EXISTS ix_ntf_templates_company ON ntf_templates (company_id);
CREATE INDEX IF NOT EXISTS ix_ntf_templates_instance ON ntf_templates (instance_id);

CREATE TABLE IF NOT EXISTS ntf_notifications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref      TEXT    NOT NULL,
  template_code TEXT    NOT NULL,
  title         TEXT    NOT NULL,
  body          TEXT    NOT NULL DEFAULT '',
  link          TEXT,
  category      TEXT    NOT NULL CHECK (category IN ('approvals','tasks','alerts','mentions','system','security','statutory')),
  priority      TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  in_app        INTEGER NOT NULL DEFAULT 1 CHECK (in_app IN (0, 1)),
  read_at       TEXT,
  archived_at   TEXT,
  event_key     TEXT,
  data_json     TEXT    NOT NULL DEFAULT '{}',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ntf_notifications_key ON ntf_notifications (company_id, user_ref, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ntf_notifications_user ON ntf_notifications (company_id, user_ref, in_app, archived_at, read_at, created_at);
CREATE INDEX IF NOT EXISTS ix_ntf_notifications_category ON ntf_notifications (company_id, user_ref, category);

CREATE TABLE IF NOT EXISTS ntf_preferences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref          TEXT    NOT NULL,
  category          TEXT    NOT NULL CHECK (category = 'ALL' OR category IN ('approvals','tasks','alerts','mentions','system','security','statutory')),
  channels_json     TEXT    NOT NULL DEFAULT '{}',
  digest            TEXT    NOT NULL DEFAULT 'INSTANT' CHECK (digest IN ('INSTANT', 'HOURLY', 'DAILY')),
  quiet_hours_json  TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_ntf_preferences ON ntf_preferences (company_id, user_ref, category);

CREATE TABLE IF NOT EXISTS ntf_deliveries (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  notification_id  INTEGER NOT NULL REFERENCES ntf_notifications (id),
  user_ref         TEXT    NOT NULL,
  channel          TEXT    NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL', 'SMS', 'WHATSAPP', 'PUSH')),
  address          TEXT,
  subject          TEXT    NOT NULL DEFAULT '',
  body             TEXT    NOT NULL DEFAULT '',
  status           TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DEFERRED', 'SENT', 'DELIVERED', 'FAILED', 'SKIPPED')),
  provider_msg_id  TEXT,
  attempts         INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error       TEXT,
  delivered_at     TEXT,
  next_attempt_at  TEXT,
  deliver_after    TEXT,
  digest_id        INTEGER REFERENCES ntf_notifications (id),
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
CREATE INDEX IF NOT EXISTS ix_ntf_deliveries_notification ON ntf_deliveries (notification_id);
CREATE INDEX IF NOT EXISTS ix_ntf_deliveries_status ON ntf_deliveries (company_id, status, channel, created_at);
CREATE INDEX IF NOT EXISTS ix_ntf_deliveries_due ON ntf_deliveries (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_ntf_deliveries_digest ON ntf_deliveries (status, user_ref, deliver_after);
CREATE INDEX IF NOT EXISTS ix_ntf_deliveries_digest_id ON ntf_deliveries (digest_id);

CREATE TABLE IF NOT EXISTS ntf_realtime_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  room        TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  data_json   TEXT    NOT NULL DEFAULT '{}',
  occurred_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
CREATE INDEX IF NOT EXISTS ix_ntf_realtime_room ON ntf_realtime_events (company_id, room, id);
CREATE INDEX IF NOT EXISTS ix_ntf_realtime_time ON ntf_realtime_events (occurred_at);
