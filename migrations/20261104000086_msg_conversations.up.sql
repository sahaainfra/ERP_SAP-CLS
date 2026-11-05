-- Part 05.01: the unified Messages app.
-- msg_conversations is the one thread index: direct, group, department, project, site, team, record-linked conversations made here, and the external threads (WhatsApp, e-mail, SMS of part 04.07) that are indexed
-- from comm_messages and read through it without being copied (external_key = the gateway's conversation_key). msg_members says who is in a conversation (BR-01) and each person's own settings of it
-- (pin, mute, mention-only, archive, how far they have read). msg_messages holds the messages made here; a deleted message keeps its row and is shown as "message deleted" (BR-02). msg_reactions are emoji reactions.

CREATE TABLE IF NOT EXISTS msg_conversations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  conv_type        TEXT    NOT NULL CHECK (conv_type IN ('DIRECT', 'GROUP', 'DEPARTMENT', 'PROJECT', 'SITE', 'TEAM', 'RECORD', 'EXTERNAL')),
  title            TEXT    NOT NULL DEFAULT '',
  direct_key       TEXT,
  department_id    INTEGER REFERENCES org_departments (id),
  entity           TEXT,
  entity_id        TEXT,
  external_key     TEXT,
  external_channel TEXT,
  auto_membership  INTEGER NOT NULL DEFAULT 0 CHECK (auto_membership IN (0, 1)),
  is_archived      INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
  last_message_id  INTEGER,
  last_activity_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  message_count    INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_external_id INTEGER NOT NULL DEFAULT 0,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_conv_direct ON msg_conversations (company_id, direct_key) WHERE direct_key IS NOT NULL AND is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_conv_record ON msg_conversations (company_id, entity, entity_id) WHERE conv_type = 'RECORD' AND is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_conv_external ON msg_conversations (company_id, external_key) WHERE external_key IS NOT NULL AND is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_conv_place ON msg_conversations (company_id, conv_type, COALESCE(project_id, 0), COALESCE(site_id, 0), COALESCE(department_id, 0)) WHERE conv_type IN ('PROJECT', 'SITE', 'DEPARTMENT') AND is_active = 1;
CREATE INDEX IF NOT EXISTS ix_msg_conv_activity ON msg_conversations (company_id, conv_type, last_activity_at);
CREATE INDEX IF NOT EXISTS ix_msg_conv_project ON msg_conversations (company_id, project_id);
CREATE INDEX IF NOT EXISTS ix_msg_conv_department ON msg_conversations (department_id);

CREATE TABLE IF NOT EXISTS msg_members (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id      INTEGER NOT NULL REFERENCES msg_conversations (id),
  user_ref             TEXT    NOT NULL,
  member_role          TEXT    NOT NULL DEFAULT 'MEMBER' CHECK (member_role IN ('ADMIN', 'MEMBER')),
  member_source        TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (member_source IN ('MANUAL', 'AUTO')),
  joined_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  left_at              TEXT,
  muted_until          TEXT,
  mention_only         INTEGER NOT NULL DEFAULT 0 CHECK (mention_only IN (0, 1)),
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  pinned               INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  archived             INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_members_conv_user ON msg_members (conversation_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_msg_members_user ON msg_members (company_id, user_ref, left_at);
CREATE INDEX IF NOT EXISTS ix_msg_members_company_id ON msg_members (company_id);

CREATE TABLE IF NOT EXISTS msg_messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id   INTEGER NOT NULL REFERENCES msg_conversations (id),
  sender_ref        TEXT    NOT NULL,
  kind              TEXT    NOT NULL DEFAULT 'TEXT' CHECK (kind IN ('TEXT', 'FILE', 'VOICE', 'SYSTEM')),
  body              TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  reply_to_id       INTEGER REFERENCES msg_messages (id),
  forwarded_from_id INTEGER REFERENCES msg_messages (id),
  mentions_json     TEXT    NOT NULL DEFAULT '[]',
  attachments_json  TEXT    NOT NULL DEFAULT '[]',
  record_links_json TEXT    NOT NULL DEFAULT '[]',
  client_id         TEXT,
  edited_at         TEXT,
  delete_reason     TEXT,
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
CREATE INDEX IF NOT EXISTS ix_msg_messages_conv ON msg_messages (conversation_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_messages_client ON msg_messages (conversation_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_msg_messages_reply ON msg_messages (reply_to_id);
CREATE INDEX IF NOT EXISTS ix_msg_messages_forward ON msg_messages (forwarded_from_id);
CREATE INDEX IF NOT EXISTS ix_msg_messages_company_id ON msg_messages (company_id);

CREATE TABLE IF NOT EXISTS msg_reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  message_id INTEGER NOT NULL REFERENCES msg_messages (id),
  user_ref   TEXT    NOT NULL,
  emoji      TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_reactions_one ON msg_reactions (message_id, user_ref, emoji);
CREATE INDEX IF NOT EXISTS ix_msg_reactions_company_id ON msg_reactions (company_id);
