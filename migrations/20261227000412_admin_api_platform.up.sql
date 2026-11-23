-- Part 29.03: public API, webhooks and developer portal. api_clients are service accounts (OAuth2 client credentials) with scopes mapped to
-- permissions and an optional project scope; api_tokens are the short-lived access tokens they get; api_webhooks subscribe a client to
-- domain events, signed with HMAC; api_webhook_deliveries is each attempt's log (retries, replay); api_usage counts calls per day and
-- endpoint for the usage analytics and rate-limit tiers.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.admin.p2903', 'Public API, webhooks and developer portal (part 29.03)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS api_clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_partner_id INTEGER REFERENCES mdm_partners(id),
  service_user_id INTEGER REFERENCES iam_users(id),
  role_code TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  project_ids_json TEXT,
  tier_code TEXT NOT NULL DEFAULT 'STANDARD' CHECK (tier_code IN ('BASIC', 'STANDARD', 'PREMIUM')),
  environment TEXT NOT NULL DEFAULT 'SANDBOX' CHECK (environment IN ('SANDBOX', 'LIVE')),
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'REJECTED')),
  secret_hash TEXT NOT NULL,
  secret_hint TEXT NOT NULL,
  secret_rotated_at TEXT,
  prev_secret_hash TEXT,
  prev_secret_expires_at TEXT,
  request_id INTEGER REFERENCES core_change_requests(id),
  approved_by TEXT,
  approved_at TEXT,
  last_used_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_clients_client_id ON api_clients(client_id);
CREATE INDEX IF NOT EXISTS ix_api_clients_list ON api_clients(company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_api_clients_partner ON api_clients(owner_partner_id);
CREATE INDEX IF NOT EXISTS ix_api_clients_user ON api_clients(service_user_id);
CREATE INDEX IF NOT EXISTS ix_api_clients_request ON api_clients(request_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  client_ref INTEGER NOT NULL REFERENCES api_clients(id),
  token_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS ix_api_tokens_client ON api_tokens(client_ref, expires_at);
CREATE INDEX IF NOT EXISTS ix_api_tokens_company ON api_tokens(company_id);

CREATE TABLE IF NOT EXISTS api_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  client_ref INTEGER NOT NULL REFERENCES api_clients(id),
  url TEXT NOT NULL,
  event_types_json TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  secret_hint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  failure_streak INTEGER NOT NULL DEFAULT 0 CHECK (failure_streak >= 0),
  last_delivery_at TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE INDEX IF NOT EXISTS ix_api_webhooks_list ON api_webhooks(company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_api_webhooks_client ON api_webhooks(client_ref);

CREATE TABLE IF NOT EXISTS api_webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  webhook_id INTEGER NOT NULL REFERENCES api_webhooks(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DELIVERED', 'FAILED', 'DEAD')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  response_code INTEGER,
  last_error TEXT,
  next_attempt_at TEXT NOT NULL,
  delivered_at TEXT,
  duration_ms INTEGER,
  replay_of INTEGER REFERENCES api_webhook_deliveries(id),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_webhook_deliveries_event ON api_webhook_deliveries(webhook_id, event_id) WHERE replay_of IS NULL;
CREATE INDEX IF NOT EXISTS ix_api_webhook_deliveries_due ON api_webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS ix_api_webhook_deliveries_list ON api_webhook_deliveries(company_id, webhook_id, status, id);
CREATE INDEX IF NOT EXISTS ix_api_webhook_deliveries_replay ON api_webhook_deliveries(replay_of);

CREATE TABLE IF NOT EXISTS api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  client_ref INTEGER NOT NULL REFERENCES api_clients(id),
  day TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  errors INTEGER NOT NULL DEFAULT 0 CHECK (errors >= 0),
  throttled INTEGER NOT NULL DEFAULT 0 CHECK (throttled >= 0),
  total_ms INTEGER NOT NULL DEFAULT 0 CHECK (total_ms >= 0),
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'api',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER,
  site_id INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_api_usage_day ON api_usage(client_ref, day, endpoint_id);
CREATE INDEX IF NOT EXISTS ix_api_usage_company ON api_usage(company_id, day);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('admin-api','g-administration','page','sidebar','API Clients & Webhooks','एपीआई क्लाइंट और वेबहुक','/admin/api','erp.insights.rb','adm.api.view','ff.admin.p2903',3,'api client key oauth token scope webhook delivery retry replay developer portal sandbox sdk changelog rate limit usage',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.api','ui','API Clients & Webhooks','/admin/api','/admin/api','LIST','MIGRATED','ITADM','29.03','system','2026-11-22T00:00:00.000Z','[]','API clients and keys, webhooks with delivery logs, developer portal and usage.','migration','reference_seed');
