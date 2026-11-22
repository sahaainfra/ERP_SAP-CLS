-- Part 29.04: template packs and the bulk data entry workspace on the Excel engine (04.13). xl_packs keeps each published version of a
-- company's pack documentation (templates, instructions, examples); xl_bulk_batches holds a grid of rows typed or pasted in the browser,
-- checked by the engine, submitted as a whole and, for approval-controlled data, approved by the module approver through
-- core_change_requests (type xl_bulk_batch) before it is imported all or nothing as its preparer.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.admin.p2904', 'Template packs and bulk data entry workspace (part 29.04)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS xl_packs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  code TEXT NOT NULL,
  module TEXT NOT NULL,
  name TEXT NOT NULL,
  template_codes_json TEXT NOT NULL,
  pack_version INTEGER NOT NULL CHECK (pack_version >= 1),
  instructions TEXT NOT NULL DEFAULT '',
  examples_json TEXT,
  notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RETIRED')),
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_xl_packs_version ON xl_packs(company_id, code, pack_version);
CREATE UNIQUE INDEX IF NOT EXISTS ux_xl_packs_active ON xl_packs(company_id, code) WHERE status = 'ACTIVE' AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS xl_bulk_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  title TEXT NOT NULL,
  template_code TEXT NOT NULL,
  pack_code TEXT,
  rows_json TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  errors_json TEXT,
  on_existing TEXT NOT NULL DEFAULT 'ERROR' CHECK (on_existing IN ('ERROR', 'UPDATE', 'SKIP')),
  needs_approval INTEGER NOT NULL DEFAULT 1 CHECK (needs_approval IN (0,1)),
  approver_role TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'REJECTED', 'IMPORTED', 'FAILED', 'CANCELLED')),
  request_id INTEGER REFERENCES core_change_requests(id),
  actor_json TEXT NOT NULL,
  submitted_at TEXT,
  imported_at TEXT,
  result_json TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_xl_bulk_batches_doc ON xl_bulk_batches(company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_xl_bulk_batches_list ON xl_bulk_batches(company_id, created_by, status, id);
CREATE INDEX IF NOT EXISTS ix_xl_bulk_batches_status ON xl_bulk_batches(company_id, status, id);
CREATE INDEX IF NOT EXISTS ix_xl_bulk_batches_request ON xl_bulk_batches(request_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('admin-bulk','g-administration','page','sidebar','Template Packs & Bulk Entry','टेम्पलेट पैक और बल्क एंट्री','/admin/bulk','erp.insights.rb','adm.bulk.use','ff.admin.p2904',4,'template pack bulk data entry grid paste excel import batch approval masters items partners employees wbs boq budget',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('admin.bulk','ui','Template Packs & Bulk Entry','/admin/bulk','/admin/bulk','LIST','MIGRATED','ITADM','29.04','system','2026-11-22T00:00:00.000Z','[]','Template packs by module and the bulk data entry workspace with batch approval.','migration','reference_seed');
