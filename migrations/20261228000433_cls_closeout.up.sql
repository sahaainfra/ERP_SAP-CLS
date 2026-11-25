-- Part 26.04 (built on the owner's instruction of 2026-11-25, audit AUD-DEF-004): project closeout, final account, lessons learned and the
-- knowledge base. A closeout carries the checklist (automatic checks read from the owning modules: handovers, defects liability, work orders,
-- snags, the approved P&L snapshot; manual items with their evidence), the agreed final account with the client, the final P&L figures and
-- the performance of the project; it is approved PM -> PD -> CFO -> DIR (BR-01: every mandatory item met). Lessons are reviewed (author ->
-- PCMGR) before they are published to the knowledge base; benchmarks proposed with the closeout are approved with it.
CREATE TABLE IF NOT EXISTS cls_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id INTEGER NOT NULL REFERENCES org_projects (id),
  doc_no      TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED')),
  final_account_paise INTEGER CHECK (final_account_paise IS NULL OR final_account_paise >= 0),
  final_account_agreed_on TEXT,
  final_account_file_id INTEGER REFERENCES core_files (id),
  pl_snapshot_id INTEGER REFERENCES pl_snapshots (id),
  revenue_paise INTEGER,
  cost_paise  INTEGER,
  performance_json TEXT NOT NULL DEFAULT '{}',
  summary     TEXT,
  workflow_instance_id INTEGER,
  requested_by TEXT,
  closed_at   TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_cls_closures_doc ON cls_closures (company_id, doc_no);
CREATE UNIQUE INDEX IF NOT EXISTS ux_cls_closures_live ON cls_closures (org_project_id) WHERE status IN ('DRAFT', 'SUBMITTED', 'APPROVED') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_cls_closures_company_id ON cls_closures (company_id);
CREATE INDEX IF NOT EXISTS ix_cls_closures_project ON cls_closures (org_project_id);
CREATE INDEX IF NOT EXISTS ix_cls_closures_status ON cls_closures (company_id, status);
CREATE INDEX IF NOT EXISTS ix_cls_closures_file ON cls_closures (final_account_file_id);
CREATE INDEX IF NOT EXISTS ix_cls_closures_snapshot ON cls_closures (pl_snapshot_id);

CREATE TABLE IF NOT EXISTS cls_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  closure_id  INTEGER NOT NULL REFERENCES cls_closures (id),
  code        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  kind        TEXT    NOT NULL DEFAULT 'MANUAL' CHECK (kind IN ('AUTO', 'MANUAL')),
  mandatory   INTEGER NOT NULL DEFAULT 1 CHECK (mandatory IN (0, 1)),
  status      TEXT    NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'DONE', 'NOT_APPLICABLE')),
  file_id     INTEGER REFERENCES core_files (id),
  note        TEXT,
  done_by     TEXT,
  done_at     TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_cls_checklist_code ON cls_checklist_items (closure_id, code);
CREATE INDEX IF NOT EXISTS ix_cls_checklist_items_company_id ON cls_checklist_items (company_id);
CREATE INDEX IF NOT EXISTS ix_cls_checklist_items_closure ON cls_checklist_items (closure_id);
CREATE INDEX IF NOT EXISTS ix_cls_checklist_items_status ON cls_checklist_items (company_id, status);
CREATE INDEX IF NOT EXISTS ix_cls_checklist_items_file ON cls_checklist_items (file_id);

CREATE TABLE IF NOT EXISTS kb_lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id INTEGER REFERENCES org_projects (id),
  doc_no      TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  category    TEXT    NOT NULL CHECK (category IN ('DESIGN', 'PROCUREMENT', 'EXECUTION', 'QUALITY', 'SAFETY', 'COMMERCIAL', 'CONTRACT', 'PLANNING', 'OTHER')),
  impact      TEXT    NOT NULL DEFAULT 'NEGATIVE' CHECK (impact IN ('POSITIVE', 'NEGATIVE')),
  what_happened TEXT  NOT NULL,
  recommendation TEXT NOT NULL,
  tags        TEXT,
  status      TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'PUBLISHED', 'REJECTED', 'WITHDRAWN')),
  author      TEXT    NOT NULL,
  workflow_instance_id INTEGER,
  published_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_kb_lessons_doc ON kb_lessons (company_id, doc_no);
CREATE INDEX IF NOT EXISTS ix_kb_lessons_company_id ON kb_lessons (company_id);
CREATE INDEX IF NOT EXISTS ix_kb_lessons_project ON kb_lessons (org_project_id);
CREATE INDEX IF NOT EXISTS ix_kb_lessons_status ON kb_lessons (company_id, status, category);
CREATE INDEX IF NOT EXISTS ix_kb_lessons_author ON kb_lessons (company_id, author);

CREATE TABLE IF NOT EXISTS kb_benchmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  org_project_id INTEGER NOT NULL REFERENCES org_projects (id),
  closure_id  INTEGER REFERENCES cls_closures (id),
  metric_code TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  unit        TEXT    NOT NULL,
  value_milli INTEGER NOT NULL,
  basis       TEXT,
  status      TEXT    NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'APPROVED', 'REJECTED')),
  approved_at TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_kb_benchmarks_metric ON kb_benchmarks (closure_id, metric_code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_kb_benchmarks_company_id ON kb_benchmarks (company_id);
CREATE INDEX IF NOT EXISTS ix_kb_benchmarks_project ON kb_benchmarks (org_project_id);
CREATE INDEX IF NOT EXISTS ix_kb_benchmarks_closure ON kb_benchmarks (closure_id);
CREATE INDEX IF NOT EXISTS ix_kb_benchmarks_status ON kb_benchmarks (company_id, status, metric_code);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-closures','g-closeout','page','sidebar','Project Closeout','परियोजना समापन','/close/closures','erp.state.approved','cls.view','ff.close.p2604',40,'project closeout closure final account final p&l performance checklist archive',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-lessons','g-closeout','page','sidebar','Lessons Learned','सीखे गए सबक','/close/lessons','erp.action.list','kb.lesson.view','ff.close.p2604',42,'lessons learned knowledge base what went well recommendation',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('close-benchmarks','g-closeout','page','sidebar','Benchmarks','बेंचमार्क','/close/benchmarks','erp.insights.rb','kb.benchmark.view','ff.close.p2604',44,'benchmarks cost per square metre duration productivity margin closed projects estimating',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.closures','close','Project Closeout','/close/closures','/close/closures','LIST','MIGRATED','PM','26.04','system','2026-11-25T00:00:00.000Z','[]','Closeouts of the projects with their checklist, final account and approval.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.closure','close','Project Closeout Record','/close/closure','/close/closure','OBJECT','MIGRATED','PM','26.04','system','2026-11-25T00:00:00.000Z','[]','A closeout: checklist with automatic checks, final account, final P&L, performance, benchmarks and approval.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.lessons','close','Lessons Learned','/close/lessons','/close/lessons','LIST','MIGRATED','PCMGR','26.04','system','2026-11-25T00:00:00.000Z','[]','The knowledge base of published lessons, with drafts and reviews.','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('close.benchmarks','close','Benchmarks','/close/benchmarks','/close/benchmarks','REPORT','MIGRATED','PCMGR','26.04','system','2026-11-25T00:00:00.000Z','[]','Approved benchmarks of closed projects for estimating and planning.','migration','reference_seed');
