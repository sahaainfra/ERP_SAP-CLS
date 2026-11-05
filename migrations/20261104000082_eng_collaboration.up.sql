-- Part 04.14: comments, mentions, reactions and record trace links.
-- col_comments hold the threaded discussion of any record (entity = the object type, entity_id = its id). A comment is edited only inside the edit window and, once deleted, keeps its row (status DELETED, the reason and who did it).
-- col_mentions are the people named with @ in a comment (one row per person and comment) and their read state for the mentions inbox. col_reactions are the optional one-click reactions. Attachments of a comment are files stored by the file service and linked to the entity col_comment.
-- col_trace_links connect a source record to the record derived from it (MR to PR to PO to GRN to ...): created by services (link_kind SERVICE) or, rarely, by a person with a documented reason (MANUAL).

CREATE TABLE IF NOT EXISTS col_comments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER NOT NULL REFERENCES org_companies (id),
  entity        TEXT    NOT NULL,
  entity_id     TEXT    NOT NULL,
  entity_label  TEXT,
  parent_id     INTEGER REFERENCES col_comments (id),
  body          TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DELETED')),
  edited_at     TEXT,
  edit_count    INTEGER NOT NULL DEFAULT 0,
  delete_reason TEXT,
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
CREATE INDEX IF NOT EXISTS ix_col_comments_record ON col_comments (company_id, entity, entity_id, id);
CREATE INDEX IF NOT EXISTS ix_col_comments_parent ON col_comments (parent_id);
CREATE INDEX IF NOT EXISTS ix_col_comments_project ON col_comments (company_id, project_id, id);

CREATE TABLE IF NOT EXISTS col_mentions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  comment_id     INTEGER NOT NULL REFERENCES col_comments (id),
  mentioned_user TEXT    NOT NULL,
  read_at        TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_col_mentions_comment_user ON col_mentions (comment_id, mentioned_user);
CREATE INDEX IF NOT EXISTS ix_col_mentions_inbox ON col_mentions (company_id, mentioned_user, read_at, id);

CREATE TABLE IF NOT EXISTS col_reactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  comment_id INTEGER NOT NULL REFERENCES col_comments (id),
  reaction   TEXT    NOT NULL CHECK (reaction IN ('like', 'ack', 'eyes', 'thanks')),
  reacted_by TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_col_reactions_one ON col_reactions (comment_id, reacted_by, reaction);

CREATE TABLE IF NOT EXISTS col_trace_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  from_entity TEXT    NOT NULL,
  from_id     TEXT    NOT NULL,
  to_entity   TEXT    NOT NULL,
  to_id       TEXT    NOT NULL,
  relation    TEXT    NOT NULL DEFAULT 'DERIVED' CHECK (relation IN ('DERIVED', 'AMENDS', 'FULFILS', 'SETTLES', 'REFERS')),
  link_kind   TEXT    NOT NULL DEFAULT 'SERVICE' CHECK (link_kind IN ('SERVICE', 'MANUAL')),
  reason      TEXT,
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
  CHECK (link_kind = 'SERVICE' OR (reason IS NOT NULL AND length(trim(reason)) >= 10)),
  CHECK (NOT (from_entity = to_entity AND from_id = to_id))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_col_trace_pair ON col_trace_links (company_id, from_entity, from_id, to_entity, to_id, relation) WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS ix_col_trace_from ON col_trace_links (company_id, from_entity, from_id);
CREATE INDEX IF NOT EXISTS ix_col_trace_to ON col_trace_links (company_id, to_entity, to_id);
CREATE INDEX IF NOT EXISTS ix_col_reactions_company_id ON col_reactions (company_id);
