-- Part 05.02: messaging features.
-- msg_receipts: when each recipient had a message delivered and read (the sender sees sent, delivered, read; a group shows who and when). msg_stars: a person's saved messages. msg_pins: messages pinned in a conversation.
-- msg_hidden: "delete for me". msg_voice: the length and waveform of a voice note. msg_user_settings: a person's privacy (last seen, read receipts). msg_presence: the last heartbeat of a person.
-- msg_holds: legal hold on a conversation. msg_member_periods: the periods in which a person was a member, kept by triggers on msg_members, so that what was said while they were out is never shown to them (search and history).
-- msg_calls: voice and video calls with their participants. msg_config: the company's messaging settings, versioned and changed only by an approved change.

CREATE TABLE IF NOT EXISTS msg_receipts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  message_id   INTEGER NOT NULL REFERENCES msg_messages (id),
  user_ref     TEXT    NOT NULL,
  delivered_at TEXT,
  read_at      TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_receipts_one ON msg_receipts (message_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_msg_receipts_user ON msg_receipts (company_id, user_ref, message_id);

CREATE TABLE IF NOT EXISTS msg_stars (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  message_id INTEGER NOT NULL REFERENCES msg_messages (id),
  user_ref   TEXT    NOT NULL,
  starred_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_stars_one ON msg_stars (message_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_msg_stars_user ON msg_stars (company_id, user_ref, starred_at);

CREATE TABLE IF NOT EXISTS msg_pins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id INTEGER NOT NULL REFERENCES msg_conversations (id),
  message_id      INTEGER NOT NULL REFERENCES msg_messages (id),
  pinned_by       TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_pins_one ON msg_pins (conversation_id, message_id);
CREATE INDEX IF NOT EXISTS ix_msg_pins_message ON msg_pins (message_id);
CREATE INDEX IF NOT EXISTS ix_msg_pins_company_id ON msg_pins (company_id);

CREATE TABLE IF NOT EXISTS msg_hidden (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  message_id INTEGER NOT NULL REFERENCES msg_messages (id),
  user_ref   TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_hidden_one ON msg_hidden (message_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_msg_hidden_company_id ON msg_hidden (company_id);

CREATE TABLE IF NOT EXISTS msg_voice (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  message_id    INTEGER NOT NULL REFERENCES msg_messages (id),
  duration_ms   INTEGER NOT NULL CHECK (duration_ms >= 0),
  waveform_json TEXT    NOT NULL DEFAULT '[]',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_voice_message ON msg_voice (message_id);
CREATE INDEX IF NOT EXISTS ix_msg_voice_company_id ON msg_voice (company_id);

CREATE TABLE IF NOT EXISTS msg_user_settings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref             TEXT    NOT NULL,
  show_last_seen       INTEGER NOT NULL DEFAULT 1 CHECK (show_last_seen IN (0, 1)),
  share_read_receipts  INTEGER NOT NULL DEFAULT 1 CHECK (share_read_receipts IN (0, 1)),
  show_online          INTEGER NOT NULL DEFAULT 1 CHECK (show_online IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_user_settings_one ON msg_user_settings (company_id, user_ref);

CREATE TABLE IF NOT EXISTS msg_presence (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id   INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'ONLINE' CHECK (status IN ('ONLINE', 'AWAY')),
  last_seen_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_presence_one ON msg_presence (company_id, user_ref);

CREATE TABLE IF NOT EXISTS msg_holds (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id INTEGER NOT NULL REFERENCES msg_conversations (id),
  reason          TEXT    NOT NULL,
  released_at     TEXT,
  released_by     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_holds_active ON msg_holds (conversation_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_msg_holds_company_id ON msg_holds (company_id);

CREATE TABLE IF NOT EXISTS msg_member_periods (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id INTEGER NOT NULL REFERENCES msg_conversations (id),
  user_ref        TEXT    NOT NULL,
  started_at      TEXT    NOT NULL,
  ended_at        TEXT,
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
CREATE INDEX IF NOT EXISTS ix_msg_periods_member ON msg_member_periods (conversation_id, user_ref, started_at);
CREATE INDEX IF NOT EXISTS ix_msg_periods_company_id ON msg_member_periods (company_id);
INSERT INTO msg_member_periods (company_id, conversation_id, user_ref, started_at, ended_at) SELECT company_id, conversation_id, user_ref, joined_at, left_at FROM msg_members;
CREATE TRIGGER IF NOT EXISTS trg_msg_members_joined AFTER INSERT ON msg_members
BEGIN
  INSERT INTO msg_member_periods (company_id, conversation_id, user_ref, started_at, ended_at) VALUES (NEW.company_id, NEW.conversation_id, NEW.user_ref, NEW.joined_at, NEW.left_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_msg_members_left AFTER UPDATE OF left_at ON msg_members WHEN OLD.left_at IS NULL AND NEW.left_at IS NOT NULL
BEGIN
  UPDATE msg_member_periods SET ended_at = NEW.left_at WHERE conversation_id = NEW.conversation_id AND user_ref = NEW.user_ref AND ended_at IS NULL;
END;
CREATE TRIGGER IF NOT EXISTS trg_msg_members_back AFTER UPDATE OF left_at ON msg_members WHEN OLD.left_at IS NOT NULL AND NEW.left_at IS NULL
BEGIN
  INSERT INTO msg_member_periods (company_id, conversation_id, user_ref, started_at) VALUES (NEW.company_id, NEW.conversation_id, NEW.user_ref, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;

CREATE TABLE IF NOT EXISTS msg_calls (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id  INTEGER NOT NULL REFERENCES msg_conversations (id),
  initiated_by     TEXT    NOT NULL,
  call_type        TEXT    NOT NULL CHECK (call_type IN ('AUDIO', 'VIDEO')),
  status           TEXT    NOT NULL DEFAULT 'RINGING' CHECK (status IN ('RINGING', 'ACTIVE', 'ENDED', 'MISSED', 'DECLINED')),
  provider         TEXT    NOT NULL DEFAULT 'WEBRTC',
  provider_room_id TEXT,
  started_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  answered_at      TEXT,
  ended_at         TEXT,
  participants_json TEXT   NOT NULL DEFAULT '[]',
  invited_json     TEXT    NOT NULL DEFAULT '[]',
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
CREATE INDEX IF NOT EXISTS ix_msg_calls_conv ON msg_calls (conversation_id, id);
CREATE INDEX IF NOT EXISTS ix_msg_calls_company ON msg_calls (company_id, status, id);

CREATE TABLE IF NOT EXISTS msg_config (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  config_json    TEXT    NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1,
  status         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SCHEDULED', 'ACTIVE', 'RETIRED', 'REJECTED')),
  instance_id    INTEGER,
  effective_from TEXT,
  reason         TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_config_version ON msg_config (company_id, config_version);
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_config_active ON msg_config (company_id) WHERE status = 'ACTIVE' AND is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_config_pending ON msg_config (company_id) WHERE status = 'PENDING' AND is_active = 1;
CREATE INDEX IF NOT EXISTS ix_msg_config_instance ON msg_config (instance_id);
CREATE INDEX IF NOT EXISTS ix_msg_calls_company_id ON msg_calls (company_id);
CREATE INDEX IF NOT EXISTS ix_msg_user_settings_company_id ON msg_user_settings (company_id);
