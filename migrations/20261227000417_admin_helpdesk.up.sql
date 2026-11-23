-- Part 29.08: help desk, knowledge base and in-app help. hd_tickets (raised from any page with the page, record, correlation ID, browser
-- and screenshot; category, team, priority, SLA, status, resolution, rating), hd_ticket_notes (the timeline), hd_corrections (data
-- correction requests approved by the module owner, then AUD for financial data, through core_change_requests type hd_data_correction,
-- and implemented through the module's own transaction), hd_articles (knowledge articles, tours and announcements linked to page routes)
-- and hd_tour_views (who has seen a tour).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.admin.p2908', 'Help desk, knowledge base and in-app help (part 29.08)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS hd_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  ticket_no TEXT NOT NULL,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('HOW_TO', 'BUG', 'ACCESS', 'DEVICE', 'DATA_CORRECTION', 'REQUEST', 'OTHER')),
  priority TEXT NOT NULL CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  team TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED', 'CANCELLED')),
  assigned_to TEXT,
  sla_due TEXT NOT NULL,
  escalation_level INTEGER NOT NULL DEFAULT 0 CHECK (escalation_level BETWEEN 0 AND 2),
  escalated_at TEXT,
  page_ref TEXT,
  page_title TEXT,
  entity TEXT,
  entity_id TEXT,
  correlation_id TEXT,
  failed_call_json TEXT,
  user_agent TEXT,
  screenshot_file_id INTEGER REFERENCES core_files(id),
  channels_json TEXT NOT NULL DEFAULT '[]',
  resolution TEXT,
  resolved_at TEXT,
  rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
  rating_comment TEXT,
  raised_by TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hd_tickets_no ON hd_tickets(company_id, ticket_no);
CREATE INDEX IF NOT EXISTS ix_hd_tickets_queue ON hd_tickets(company_id, status, team, sla_due);
CREATE INDEX IF NOT EXISTS ix_hd_tickets_mine ON hd_tickets(company_id, raised_by, id);
CREATE INDEX IF NOT EXISTS ix_hd_tickets_assigned ON hd_tickets(company_id, assigned_to, status);
CREATE INDEX IF NOT EXISTS ix_hd_tickets_sla ON hd_tickets(status, sla_due);
CREATE INDEX IF NOT EXISTS ix_hd_tickets_shot ON hd_tickets(screenshot_file_id);

CREATE TABLE IF NOT EXISTS hd_ticket_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  ticket_id INTEGER NOT NULL REFERENCES hd_tickets(id),
  kind TEXT NOT NULL CHECK (kind IN ('CREATED', 'NOTE', 'STATUS', 'ESCALATED', 'CORRECTION', 'RATING')),
  body TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 0 CHECK (internal IN (0,1)),
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
CREATE INDEX IF NOT EXISTS ix_hd_ticket_notes_ticket ON hd_ticket_notes(ticket_id, id);
CREATE INDEX IF NOT EXISTS ix_hd_ticket_notes_company ON hd_ticket_notes(company_id);

CREATE TABLE IF NOT EXISTS hd_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  ticket_id INTEGER NOT NULL REFERENCES hd_tickets(id),
  module TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  record_ref TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  owner_role TEXT NOT NULL,
  financial INTEGER NOT NULL DEFAULT 0 CHECK (financial IN (0,1)),
  status TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'IMPLEMENTED')),
  request_id INTEGER REFERENCES core_change_requests(id),
  approved_by TEXT,
  approved_at TEXT,
  transaction_ref TEXT,
  implemented_by TEXT,
  implemented_at TEXT,
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
CREATE INDEX IF NOT EXISTS ix_hd_corrections_company ON hd_corrections(company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_hd_corrections_ticket ON hd_corrections(ticket_id);
CREATE INDEX IF NOT EXISTS ix_hd_corrections_request ON hd_corrections(request_id);

CREATE TABLE IF NOT EXISTS hd_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  kind TEXT NOT NULL CHECK (kind IN ('ARTICLE', 'TOUR', 'ANNOUNCEMENT')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  module TEXT,
  page_codes_json TEXT NOT NULL DEFAULT '[]',
  roles_json TEXT NOT NULL DEFAULT '[]',
  steps_json TEXT,
  valid_from TEXT,
  valid_to TEXT,
  article_version INTEGER NOT NULL DEFAULT 1 CHECK (article_version >= 1),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'RETIRED')),
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
CREATE INDEX IF NOT EXISTS ix_hd_articles_company ON hd_articles(company_id, status, kind);

CREATE TABLE IF NOT EXISTS hd_tour_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  article_id INTEGER NOT NULL REFERENCES hd_articles(id),
  user_name TEXT NOT NULL,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_hd_tour_views ON hd_tour_views(company_id, article_id, user_name);
CREATE INDEX IF NOT EXISTS ix_hd_tour_views_article ON hd_tour_views(article_id);

INSERT OR IGNORE INTO ntf_templates (code,category,channel,lang,subject,body,variables_json,status,created_by,source_type) VALUES
  ('hd.ticket.updated','system','IN_APP','en','Ticket {{ticket}}: {{status}}','{{subject}} — {{message}}','["ticket","status","subject","message"]','ACTIVE','migration','reference_seed'),
  ('hd.ticket.updated','system','EMAIL','en','Your ticket {{ticket}}: {{status}}','{{subject}}\n\n{{message}}','["ticket","status","subject","message"]','ACTIVE','migration','reference_seed'),
  ('hd.ticket.updated','system','WHATSAPP','en','Ticket {{ticket}}','{{ticket}} ({{status}}): {{message}}','["ticket","status","message"]','ACTIVE','migration','reference_seed'),
  ('hd.ticket.escalated','alerts','IN_APP','en','Ticket {{ticket}} escalated (level {{level}})','{{subject}} — {{message}}','["ticket","level","subject","message"]','ACTIVE','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('help-raise','g-administration','page','sidebar','Help & Support','सहायता और समर्थन','/help','erp.insights.rb','hd.ticket.raise','ff.admin.p2908',8,'help support ticket raise problem issue bug knowledge base article tour release notes',1,'none','migration','reference_seed'),
  ('admin-support','g-administration','page','sidebar','Support Desk','सपोर्ट डेस्क','/admin/support','erp.insights.rb','hd.ticket.work','ff.admin.p2908',9,'support queue ticket sla escalation data correction knowledge base dashboard satisfaction',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('help.raise','ui','Help & Support','/help','/help','FORM','MIGRATED','ITADM','29.08','system','2026-11-22T00:00:00.000Z','[]','Raise a ticket, my tickets, the knowledge base and release notes.','migration','reference_seed'),
  ('admin.support','ui','Support Desk','/admin/support','/admin/support','WORKLIST','MIGRATED','ITADM','29.08','system','2026-11-22T00:00:00.000Z','[]','Support queue, data corrections, knowledge management and the support dashboard.','migration','reference_seed');
