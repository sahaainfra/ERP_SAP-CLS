-- Part 26.03 (built on the owner's instruction of 2026-11-25, audit AUD-DEF-004): defects liability period and warranty management.
-- A period opens from an issued handover (26.02) for its area, from the effective date for the agreed months. Complaints (defects reported
-- in the period) carry a severity with its response time, the responsible party, the rectification with its evidence and an independent
-- verification; a back-charge to a subcontractor or supplier is announced for their bill. Warranty claims go to the supplier of a handed-over
-- asset. The completion certificate is approved PM -> COMMGR -> CFO once the period has ended and no complaint is open (BR-01); it releases
-- the retention through Billing (22.07).
CREATE TABLE IF NOT EXISTS dlp_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id INTEGER NOT NULL REFERENCES org_projects (id),
  org_site_id INTEGER REFERENCES org_sites (id),
  handover_id INTEGER NOT NULL REFERENCES ho_handovers (id),
  doc_no      TEXT    NOT NULL,
  area_label  TEXT,
  starts_on   TEXT    NOT NULL,
  ends_on     TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETION_REVIEW', 'COMPLETED', 'CANCELLED')),
  workflow_instance_id INTEGER,
  requested_by TEXT,
  completed_at TEXT,
  expiry_notified_on TEXT,
  readiness_json TEXT NOT NULL DEFAULT '{}',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_dlp_periods_doc ON dlp_periods (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_dlp_periods_handover ON dlp_periods (handover_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_dlp_periods_company_id ON dlp_periods (company_id);
CREATE INDEX IF NOT EXISTS ix_dlp_periods_project ON dlp_periods (org_project_id);
CREATE INDEX IF NOT EXISTS ix_dlp_periods_site ON dlp_periods (org_site_id);
CREATE INDEX IF NOT EXISTS ix_dlp_periods_handover ON dlp_periods (handover_id);
CREATE INDEX IF NOT EXISTS ix_dlp_periods_status ON dlp_periods (company_id, status, ends_on);

CREATE TABLE IF NOT EXISTS dlp_complaints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  period_id   INTEGER NOT NULL REFERENCES dlp_periods (id),
  asset_id    INTEGER REFERENCES ho_client_assets (id),
  doc_no      TEXT    NOT NULL,
  reported_on TEXT    NOT NULL,
  reported_by TEXT    NOT NULL,
  source      TEXT    NOT NULL DEFAULT 'CLIENT' CHECK (source IN ('CLIENT', 'INTERNAL')),
  location_text TEXT,
  description TEXT    NOT NULL,
  severity    TEXT    NOT NULL DEFAULT 'MINOR' CHECK (severity IN ('CRITICAL', 'MAJOR', 'MINOR')),
  due_at      TEXT    NOT NULL,
  responsible_type TEXT CHECK (responsible_type IN ('OWN_CREW', 'SUBCONTRACTOR', 'SUPPLIER')),
  partner_id  INTEGER REFERENCES mdm_partners (id),
  status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ASSIGNED', 'RECTIFIED', 'CLOSED', 'REJECTED')),
  rectified_by TEXT,
  rectified_at TEXT,
  rectification_note TEXT,
  rectify_file_id INTEGER REFERENCES core_files (id),
  verified_by TEXT,
  closed_at   TEXT,
  recovery_amount INTEGER NOT NULL DEFAULT 0 CHECK (recovery_amount >= 0),
  escalation_level INTEGER NOT NULL DEFAULT 0,
  escalated_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_dlp_complaints_doc ON dlp_complaints (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_dlp_complaints_company_id ON dlp_complaints (company_id);
CREATE INDEX IF NOT EXISTS ix_dlp_complaints_period ON dlp_complaints (period_id, status);
CREATE INDEX IF NOT EXISTS ix_dlp_complaints_status ON dlp_complaints (company_id, status, due_at);
CREATE INDEX IF NOT EXISTS ix_dlp_complaints_asset ON dlp_complaints (asset_id);
CREATE INDEX IF NOT EXISTS ix_dlp_complaints_partner ON dlp_complaints (partner_id);
CREATE INDEX IF NOT EXISTS ix_dlp_complaints_file ON dlp_complaints (rectify_file_id);

CREATE TABLE IF NOT EXISTS dlp_warranty_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  period_id   INTEGER NOT NULL REFERENCES dlp_periods (id),
  asset_id    INTEGER NOT NULL REFERENCES ho_client_assets (id),
  complaint_id INTEGER REFERENCES dlp_complaints (id),
  partner_id  INTEGER REFERENCES mdm_partners (id),
  doc_no      TEXT    NOT NULL,
  claimed_on  TEXT    NOT NULL,
  description TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ACCEPTED', 'REJECTED', 'RESOLVED')),
  resolution_note TEXT,
  resolved_on TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_dlp_warranty_claims_doc ON dlp_warranty_claims (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_dlp_warranty_claims_company_id ON dlp_warranty_claims (company_id);
CREATE INDEX IF NOT EXISTS ix_dlp_warranty_claims_period ON dlp_warranty_claims (period_id);
CREATE INDEX IF NOT EXISTS ix_dlp_warranty_claims_asset ON dlp_warranty_claims (asset_id);
CREATE INDEX IF NOT EXISTS ix_dlp_warranty_claims_complaint ON dlp_warranty_claims (complaint_id);
CREATE INDEX IF NOT EXISTS ix_dlp_warranty_claims_partner ON dlp_warranty_claims (partner_id);
CREATE INDEX IF NOT EXISTS ix_dlp_warranty_claims_status ON dlp_warranty_claims (company_id, status);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-dlp','g-closeout','page','sidebar','Defects Liability','दोष दायित्व','/close/dlp','erp.state.approved','dlp.view','ff.close.p2603',30,'defects liability period dlp expiry warranty completion certificate retention release',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-dlp-complaints','g-closeout','page','sidebar','DLP Complaints','दोष दायित्व शिकायतें','/close/dlp/complaints','erp.action.list','dlp.view','ff.close.p2603',32,'dlp complaints defects rectification sla overdue escalation back charge recovery warranty claim',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.dlp','close','Defects Liability','/close/dlp','/close/dlp','OVERVIEW','MIGRATED','PM','26.03','system','2026-11-25T00:00:00.000Z','[]','Defects liability periods with their end dates, open and overdue complaints and completion.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.dlp-period','close','Defects Liability Period','/close/dlp/period','/close/dlp/period','OBJECT','MIGRATED','PM','26.03','system','2026-11-25T00:00:00.000Z','[]','A period with its complaints, warranty claims and completion certificate.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.dlp-complaints','close','DLP Complaints','/close/dlp/complaints','/close/dlp/complaints','LIST','MIGRATED','PM','26.03','system','2026-11-25T00:00:00.000Z','[]','Complaints of every period with their response time, party and status.','migration','reference_seed');
INSERT OR IGNORE INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type) VALUES (NULL, 'dlp.complaint.overdue', 'alerts', 'IN_APP', 'en', 'Defects liability {{ref}}: {{subject}}', '{{detail}} {{link}}', '["ref", "subject", "detail", "link"]', 1, 'ACTIVE', 'migration', 'reference_seed');
INSERT OR IGNORE INTO ntf_templates (company_id, code, category, channel, lang, subject, body, variables_json, template_version, status, created_by, source_type) VALUES (NULL, 'dlp.period.ending', 'alerts', 'IN_APP', 'en', 'Defects liability {{ref}}: {{subject}}', '{{detail}} {{link}}', '["ref", "subject", "detail", "link"]', 1, 'ACTIVE', 'migration', 'reference_seed');
