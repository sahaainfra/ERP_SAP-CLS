-- Part 03.08: global search. One row per searchable record (the record's title, code, a short subtitle, the words of its text, its place in the
-- organisation and the permission needed to see it), a full-text index over it (SQLite FTS5 with the trigram tokenizer: substring and partial-code
-- matching), a separate index of sensitive values that are searched only by people allowed to see them, and the log of searches (for the
-- analytics of queries that found nothing).

CREATE TABLE IF NOT EXISTS core_search_index (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  entity         TEXT    NOT NULL,
  entity_id      INTEGER NOT NULL,
  project_id     INTEGER,
  site_id        INTEGER,
  branch_id      INTEGER,
  department_id  INTEGER,
  owner_user_id  INTEGER,
  code           TEXT,
  code_key       TEXT,
  title          TEXT    NOT NULL,
  title_lc       TEXT    NOT NULL,
  subtitle       TEXT,
  body           TEXT    NOT NULL DEFAULT '',
  phon           TEXT    NOT NULL DEFAULT '',
  status         TEXT,
  doc_date       TEXT,
  permission_key TEXT    NOT NULL,
  route          TEXT    NOT NULL,
  indexed_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by     TEXT,
  updated_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at     TEXT,
  deleted_by     TEXT,
  source_type    TEXT,
  source_id      TEXT,
  remarks        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_core_search_index_record ON core_search_index (company_id, entity, entity_id);
CREATE INDEX IF NOT EXISTS ix_core_search_index_code ON core_search_index (company_id, code_key);
CREATE INDEX IF NOT EXISTS ix_core_search_index_title ON core_search_index (company_id, title_lc);
CREATE INDEX IF NOT EXISTS ix_core_search_index_scope ON core_search_index (company_id, permission_key, project_id, site_id);
CREATE INDEX IF NOT EXISTS ix_core_search_index_status ON core_search_index (company_id, entity, status);

-- The full-text index of the rows above (external content: it holds no second copy of the text).
CREATE VIRTUAL TABLE IF NOT EXISTS core_search_fts USING fts5 (code, title, subtitle, body, phon, content = 'core_search_index', content_rowid = 'id', tokenize = 'trigram');
CREATE TRIGGER IF NOT EXISTS trg_core_search_fts_ai AFTER INSERT ON core_search_index BEGIN
  INSERT INTO core_search_fts (rowid, code, title, subtitle, body, phon) VALUES (new.id, new.code, new.title, new.subtitle, new.body, new.phon);
END;
CREATE TRIGGER IF NOT EXISTS trg_core_search_fts_ad AFTER DELETE ON core_search_index BEGIN
  INSERT INTO core_search_fts (core_search_fts, rowid, code, title, subtitle, body, phon) VALUES ('delete', old.id, old.code, old.title, old.subtitle, old.body, old.phon);
END;
CREATE TRIGGER IF NOT EXISTS trg_core_search_fts_au AFTER UPDATE OF code, title, subtitle, body, phon ON core_search_index BEGIN
  INSERT INTO core_search_fts (core_search_fts, rowid, code, title, subtitle, body, phon) VALUES ('delete', old.id, old.code, old.title, old.subtitle, old.body, old.phon);
  INSERT INTO core_search_fts (rowid, code, title, subtitle, body, phon) VALUES (new.id, new.code, new.title, new.subtitle, new.body, new.phon);
END;

-- Sensitive values (a mobile number, a PAN, a commercial value): searched only by a person whose roles show that field unmasked (BR-01).
CREATE VIRTUAL TABLE IF NOT EXISTS core_search_secret USING fts5 (value, index_id UNINDEXED, field_key UNINDEXED, tokenize = 'trigram');

-- The searches people ran: what was typed, how many results, how long it took and what they opened. Kept for a retention period.
CREATE TABLE IF NOT EXISTS core_search_queries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  user_ref       TEXT    NOT NULL,
  q              TEXT    NOT NULL,
  q_norm         TEXT    NOT NULL,
  source         TEXT    NOT NULL DEFAULT 'palette' CHECK (source IN ('palette', 'page')),
  types          TEXT,
  result_count   INTEGER NOT NULL DEFAULT 0 CHECK (result_count >= 0),
  took_ms        INTEGER NOT NULL DEFAULT 0 CHECK (took_ms >= 0),
  clicked_entity TEXT,
  clicked_id     INTEGER,
  clicked_pos    INTEGER,
  project_id     INTEGER,
  site_id        INTEGER,
  created_by     TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by     TEXT,
  updated_at     TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at     TEXT,
  deleted_by     TEXT,
  source_type    TEXT,
  source_id      TEXT,
  remarks        TEXT
);
CREATE INDEX IF NOT EXISTS ix_core_search_queries_company ON core_search_queries (company_id, created_at);
CREATE INDEX IF NOT EXISTS ix_core_search_queries_user ON core_search_queries (company_id, user_ref, created_at);
CREATE INDEX IF NOT EXISTS ix_core_search_queries_norm ON core_search_queries (company_id, q_norm);
