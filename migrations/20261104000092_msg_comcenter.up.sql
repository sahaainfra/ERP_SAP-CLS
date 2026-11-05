-- Part 05.04: the Communication Center. msg_auto_group_rules / msg_auto_group_links: which team and discipline groups are kept from the organisation and assignments (versioned, changed only by an approved change).
-- msg_instructions / msg_acknowledgements: a message marked as an instruction and who must acknowledge it. msg_announcements / msg_announcement_reads: broadcasts with read and confirmation tracking.
-- msg_escalations: a conversation flagged by a person as unresolved and climbed to managers. msg_actions: what a message was turned into (a task, and later RFI, NCR, site instruction, material request, HSE observation).

CREATE TABLE IF NOT EXISTS msg_auto_group_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rule_version    INTEGER NOT NULL,
  group_type      TEXT    NOT NULL CHECK (group_type IN ('PROJECT', 'SITE', 'DEPARTMENT', 'TEAM', 'DISCIPLINE')),
  scope_type      TEXT    NOT NULL DEFAULT 'COMPANY' CHECK (scope_type IN ('COMPANY', 'PROJECT', 'SITE', 'DEPARTMENT')),
  scope_id        INTEGER,
  role_filter_json TEXT   NOT NULL DEFAULT '[]',
  title           TEXT    NOT NULL DEFAULT '',
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  rule_status     TEXT    NOT NULL DEFAULT 'PENDING' CHECK (rule_status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  instance_id     INTEGER,
  reason          TEXT,
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
CREATE INDEX IF NOT EXISTS ix_msg_rules_status ON msg_auto_group_rules (company_id, rule_status, rule_version);
CREATE INDEX IF NOT EXISTS ix_msg_rules_company_id ON msg_auto_group_rules (company_id);

CREATE TABLE IF NOT EXISTS msg_auto_group_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  rule_id         INTEGER NOT NULL REFERENCES msg_auto_group_rules (id),
  scope_key       TEXT    NOT NULL,
  conversation_id INTEGER NOT NULL REFERENCES msg_conversations (id),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_links_rule_scope ON msg_auto_group_links (rule_id, scope_key);
CREATE INDEX IF NOT EXISTS ix_msg_links_conversation ON msg_auto_group_links (conversation_id);
CREATE INDEX IF NOT EXISTS ix_msg_links_company_id ON msg_auto_group_links (company_id);

CREATE TABLE IF NOT EXISTS msg_instructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  message_id      INTEGER NOT NULL REFERENCES msg_messages (id),
  conversation_id INTEGER NOT NULL REFERENCES msg_conversations (id),
  sender_ref      TEXT    NOT NULL,
  title           TEXT    NOT NULL DEFAULT '',
  priority        TEXT    NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  due_at          TEXT,
  requires_ack    INTEGER NOT NULL DEFAULT 1 CHECK (requires_ack IN (0, 1)),
  instruction_status TEXT NOT NULL DEFAULT 'OPEN' CHECK (instruction_status IN ('OPEN', 'COMPLETED', 'ESCALATED', 'CANCELLED')),
  escalated_at    TEXT,
  escalation_level INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level >= 0),
  completed_at    TEXT,
  cancel_reason   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_instr_message ON msg_instructions (message_id);
CREATE INDEX IF NOT EXISTS ix_msg_instr_conversation ON msg_instructions (conversation_id);
CREATE INDEX IF NOT EXISTS ix_msg_instr_list ON msg_instructions (company_id, instruction_status, due_at);
CREATE INDEX IF NOT EXISTS ix_msg_instr_sender ON msg_instructions (company_id, sender_ref);

CREATE TABLE IF NOT EXISTS msg_acknowledgements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  instruction_id  INTEGER NOT NULL REFERENCES msg_instructions (id),
  user_ref        TEXT    NOT NULL,
  acknowledged_at TEXT,
  response        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_ack_one ON msg_acknowledgements (instruction_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_msg_ack_user ON msg_acknowledgements (company_id, user_ref, acknowledged_at);
CREATE INDEX IF NOT EXISTS ix_msg_ack_company_id ON msg_acknowledgements (company_id);

CREATE TABLE IF NOT EXISTS msg_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  title           TEXT    NOT NULL,
  body            TEXT    NOT NULL,
  sender_ref      TEXT    NOT NULL,
  audience_json   TEXT    NOT NULL DEFAULT '{}',
  require_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (require_confirmation IN (0, 1)),
  quiz_json       TEXT    NOT NULL DEFAULT '[]',
  publish_at      TEXT,
  expires_at      TEXT,
  announcement_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (announcement_status IN ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'EXPIRED', 'CANCELLED')),
  published_at    TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
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
CREATE INDEX IF NOT EXISTS ix_msg_ann_status ON msg_announcements (company_id, announcement_status, publish_at);
CREATE INDEX IF NOT EXISTS ix_msg_ann_sender ON msg_announcements (company_id, sender_ref);

CREATE TABLE IF NOT EXISTS msg_announcement_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  announcement_id INTEGER NOT NULL REFERENCES msg_announcements (id),
  user_ref        TEXT    NOT NULL,
  read_at         TEXT,
  confirmed_at    TEXT,
  quiz_score      INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_msg_annread_one ON msg_announcement_reads (announcement_id, user_ref);
CREATE INDEX IF NOT EXISTS ix_msg_annread_user ON msg_announcement_reads (company_id, user_ref, read_at);
CREATE INDEX IF NOT EXISTS ix_msg_annread_company_id ON msg_announcement_reads (company_id);

CREATE TABLE IF NOT EXISTS msg_escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  conversation_id INTEGER NOT NULL REFERENCES msg_conversations (id),
  message_id      INTEGER REFERENCES msg_messages (id),
  raised_by       TEXT    NOT NULL,
  reason          TEXT    NOT NULL,
  escalation_status TEXT  NOT NULL DEFAULT 'OPEN' CHECK (escalation_status IN ('OPEN', 'ESCALATED', 'RESOLVED')),
  escalate_at     TEXT    NOT NULL,
  escalated_at    TEXT,
  escalated_to_json TEXT  NOT NULL DEFAULT '[]',
  resolved_by     TEXT,
  resolved_at     TEXT,
  resolution      TEXT,
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
CREATE INDEX IF NOT EXISTS ix_msg_esc_status ON msg_escalations (company_id, escalation_status, escalate_at);
CREATE INDEX IF NOT EXISTS ix_msg_esc_conversation ON msg_escalations (conversation_id);
CREATE INDEX IF NOT EXISTS ix_msg_esc_message ON msg_escalations (message_id);

CREATE TABLE IF NOT EXISTS msg_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  message_id      INTEGER NOT NULL REFERENCES msg_messages (id),
  conversation_id INTEGER NOT NULL REFERENCES msg_conversations (id),
  action_type     TEXT    NOT NULL,
  target_entity   TEXT    NOT NULL,
  target_id       TEXT    NOT NULL,
  target_label    TEXT    NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS ix_msg_actions_message ON msg_actions (message_id);
CREATE INDEX IF NOT EXISTS ix_msg_actions_conversation ON msg_actions (conversation_id);
CREATE INDEX IF NOT EXISTS ix_msg_actions_company_id ON msg_actions (company_id);

