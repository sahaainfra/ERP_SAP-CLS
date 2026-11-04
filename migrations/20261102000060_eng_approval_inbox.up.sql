-- Part 04.03: what the approval inbox needs to store. wf_approval_policies says, per document type, whether its tasks may be approved in bulk (and up to what
-- amount) and whether they may be approved from a secure link (how long the link lives and above what amount the approver must sign in again). A change is a
-- row waiting with status PENDING until its approval chain has approved it. wf_link_tokens holds the links: only the hash of the token is kept, a link is for one
-- task and one person, lives for a short time and is used once. Money is integer paise.

CREATE TABLE IF NOT EXISTS wf_approval_policies (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id           INTEGER NOT NULL REFERENCES org_companies (id),
  doc_type             TEXT    NOT NULL,
  bulk_eligible        INTEGER NOT NULL DEFAULT 0 CHECK (bulk_eligible IN (0, 1)),
  bulk_max_amount      INTEGER CHECK (bulk_max_amount IS NULL OR bulk_max_amount >= 0),
  link_eligible        INTEGER NOT NULL DEFAULT 0 CHECK (link_eligible IN (0, 1)),
  link_reauth_amount   INTEGER CHECK (link_reauth_amount IS NULL OR link_reauth_amount >= 0),
  link_expiry_minutes  INTEGER NOT NULL DEFAULT 60 CHECK (link_expiry_minutes >= 5 AND link_expiry_minutes <= 1440),
  status               TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  effective_from       TEXT    NOT NULL,
  effective_to         TEXT,
  batch_id             INTEGER,
  reason               TEXT,
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
CREATE INDEX IF NOT EXISTS ix_wf_policies_resolve ON wf_approval_policies (company_id, doc_type, status, effective_from);
CREATE INDEX IF NOT EXISTS ix_wf_policies_batch ON wf_approval_policies (batch_id);

CREATE TABLE IF NOT EXISTS wf_link_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id      INTEGER NOT NULL REFERENCES org_companies (id),
  task_id         INTEGER NOT NULL REFERENCES wf_tasks (id),
  instance_id     INTEGER NOT NULL REFERENCES wf_instances (id),
  user_ref        TEXT    NOT NULL,
  roles_json      TEXT    NOT NULL DEFAULT '[]',
  token_hash      TEXT    NOT NULL,
  channel         TEXT    NOT NULL DEFAULT 'SELF' CHECK (channel IN ('SELF', 'EMAIL', 'WHATSAPP')),
  status          TEXT    NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED', 'USED', 'EXPIRED', 'REVOKED')),
  reauth_required INTEGER NOT NULL DEFAULT 0 CHECK (reauth_required IN (0, 1)),
  expires_at      TEXT    NOT NULL,
  used_at         TEXT,
  used_action     TEXT,
  used_via        TEXT,
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
  CHECK (status != 'USED' OR used_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_wf_link_tokens_hash ON wf_link_tokens (token_hash);
CREATE INDEX IF NOT EXISTS ix_wf_link_tokens_task ON wf_link_tokens (task_id, status);
CREATE INDEX IF NOT EXISTS ix_wf_link_tokens_instance ON wf_link_tokens (instance_id);
CREATE INDEX IF NOT EXISTS ix_wf_link_tokens_company ON wf_link_tokens (company_id, user_ref, status);
