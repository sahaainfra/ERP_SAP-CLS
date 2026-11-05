-- Part 04.12: digital signature and QR verification.
-- sig_signatures are the signatures of a generated document (electronic approval, image from the profile, eSign or DSC through a provider); each carries the hash of the document and a digest chained to the one before it,
-- so a changed row is found. sig_copies are the stamped copies (the original file is never changed). sig_verifications is one row for each document with the count of checks and the cancellation. sig_profiles holds
-- the signature picture of a person. sig_config is the public fields and the placement of the signature stamps, changed only by an approved change.

CREATE TABLE IF NOT EXISTS sig_signatures (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id        INTEGER NOT NULL REFERENCES org_companies (id),
  generated_doc_id  INTEGER NOT NULL REFERENCES tpl_generated_docs (id),
  signer_user_id    INTEGER REFERENCES iam_users (id),
  signer_name       TEXT    NOT NULL,
  signer_label      TEXT,
  method            TEXT    NOT NULL CHECK (method IN ('APPROVAL', 'IMAGE', 'ESIGN', 'DSC')),
  signed_at         TEXT    NOT NULL,
  hash              TEXT    NOT NULL,
  digest            TEXT    NOT NULL,
  prev_digest       TEXT,
  certificate_ref   TEXT,
  workflow_instance_id INTEGER,
  ip                TEXT,
  status            TEXT    NOT NULL DEFAULT 'SIGNED' CHECK (status IN ('SIGNED', 'REVOKED')),
  revoked_at        TEXT,
  revoked_by        TEXT,
  revoke_reason     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_sig_signatures_signer ON sig_signatures (generated_doc_id, signer_name, method) WHERE status = 'SIGNED';
CREATE INDEX IF NOT EXISTS ix_sig_signatures_doc ON sig_signatures (generated_doc_id, id);
CREATE INDEX IF NOT EXISTS ix_sig_signatures_user ON sig_signatures (signer_user_id);
CREATE INDEX IF NOT EXISTS ix_sig_signatures_list ON sig_signatures (company_id, signed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_sig_signatures_filter ON sig_signatures (company_id, method, status);
CREATE INDEX IF NOT EXISTS ix_sig_signatures_project ON sig_signatures (company_id, project_id, signed_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_sig_signatures_immutable BEFORE UPDATE OF generated_doc_id, signer_name, method, signed_at, hash, digest, prev_digest, certificate_ref, company_id ON sig_signatures
BEGIN SELECT RAISE(ABORT, 'A signature cannot be changed; revoke it instead.'); END;
CREATE TRIGGER IF NOT EXISTS trg_sig_signatures_no_delete BEFORE DELETE ON sig_signatures
BEGIN SELECT RAISE(ABORT, 'A signature cannot be deleted; revoke it instead.'); END;

CREATE TABLE IF NOT EXISTS sig_copies (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  generated_doc_id INTEGER NOT NULL REFERENCES tpl_generated_docs (id),
  file_id          INTEGER NOT NULL REFERENCES core_files (id),
  hash             TEXT    NOT NULL,
  signature_count  INTEGER NOT NULL CHECK (signature_count >= 0),
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
CREATE INDEX IF NOT EXISTS ix_sig_copies_company_id ON sig_copies (company_id);
CREATE INDEX IF NOT EXISTS ix_sig_copies_doc ON sig_copies (generated_doc_id, id DESC);
CREATE INDEX IF NOT EXISTS ix_sig_copies_file ON sig_copies (file_id);
CREATE INDEX IF NOT EXISTS ix_sig_copies_hash ON sig_copies (hash);

CREATE TABLE IF NOT EXISTS sig_verifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id       INTEGER NOT NULL REFERENCES org_companies (id),
  code             TEXT    NOT NULL,
  generated_doc_id INTEGER NOT NULL REFERENCES tpl_generated_docs (id),
  verify_count     INTEGER NOT NULL DEFAULT 0 CHECK (verify_count >= 0),
  mismatch_count   INTEGER NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  last_verified_at TEXT,
  status           TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  cancelled_at     TEXT,
  cancelled_by     TEXT,
  cancel_reason    TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_sig_verifications_code ON sig_verifications (code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sig_verifications_doc ON sig_verifications (generated_doc_id);
CREATE INDEX IF NOT EXISTS ix_sig_verifications_company ON sig_verifications (company_id, status);

CREATE TABLE IF NOT EXISTS sig_profiles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  user_name   TEXT    NOT NULL,
  image_data  TEXT    NOT NULL,
  image_hash  TEXT    NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_sig_profiles_user ON sig_profiles (company_id, user_name);

CREATE TABLE IF NOT EXISTS sig_config (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id     INTEGER NOT NULL REFERENCES org_companies (id),
  config_json    TEXT    NOT NULL,
  config_version INTEGER NOT NULL DEFAULT 1 CHECK (config_version >= 1),
  status         TEXT    NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'RETIRED', 'REJECTED')),
  instance_id    INTEGER,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_sig_config_version ON sig_config (company_id, config_version);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sig_config_active ON sig_config (company_id) WHERE status = 'ACTIVE' AND is_active = 1;
CREATE INDEX IF NOT EXISTS ix_sig_config_instance ON sig_config (instance_id);
