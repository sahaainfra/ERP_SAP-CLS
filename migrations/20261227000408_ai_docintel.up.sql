-- Part 28.04: document and contract intelligence. di_extractions holds, per uploaded file, the text read from it (searchable), its type, the
-- suggested fields with their confidence and source position, contract clauses, duplicates, and the review: suggestions are applied only when a
-- person accepts them, through the owner module (22.06 vendor invoice, 11.05 letter, 21.01 clauses, 04.10 validity).
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.ai.p2804', 'Document and contract intelligence (part 28.04)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS di_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES core_files(id),
  file_name TEXT NOT NULL,
  linked_entity TEXT,
  linked_id INTEGER,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('INVOICE', 'CERTIFICATE', 'LETTER', 'CONTRACT', 'OTHER')),
  class_confidence NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (class_confidence BETWEEN 0 AND 1),
  engine TEXT NOT NULL CHECK (engine IN ('PDF_TEXT', 'TEXT', 'OCR', 'NONE')),
  ocr_confidence NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (ocr_confidence BETWEEN 0 AND 1),
  pages INTEGER NOT NULL DEFAULT 0 CHECK (pages >= 0),
  text_content TEXT NOT NULL DEFAULT '',
  simhash TEXT,
  sha256 TEXT,
  fields_json TEXT NOT NULL DEFAULT '{}',
  clauses_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  duplicate_of_file_id INTEGER REFERENCES core_files(id),
  duplicate_json TEXT,
  status TEXT NOT NULL DEFAULT 'EXTRACTED' CHECK (status IN ('EXTRACTED', 'NO_TEXT', 'ACCEPTED', 'REJECTED', 'FAILED')),
  reason TEXT,
  extracted_at TEXT NOT NULL,
  final_json TEXT,
  changed_json TEXT,
  applied_json TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT,
  updated_at TEXT,
  deleted_by TEXT,
  deleted_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  source_type TEXT NOT NULL DEFAULT 'core_files',
  source_id TEXT,
  remarks TEXT,
  project_id INTEGER REFERENCES org_projects(id),
  site_id INTEGER REFERENCES org_sites(id),
  UNIQUE (company_id, doc_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_di_extractions_file ON di_extractions(company_id, file_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_di_extractions_queue ON di_extractions(company_id, status, extracted_at);
CREATE INDEX IF NOT EXISTS ix_di_extractions_type ON di_extractions(company_id, doc_type, status);
CREATE INDEX IF NOT EXISTS ix_di_extractions_sha ON di_extractions(company_id, sha256);
CREATE INDEX IF NOT EXISTS ix_di_extractions_file ON di_extractions(file_id);
CREATE INDEX IF NOT EXISTS ix_di_extractions_dup ON di_extractions(duplicate_of_file_id);
CREATE INDEX IF NOT EXISTS ix_di_extractions_project ON di_extractions(project_id);
CREATE INDEX IF NOT EXISTS ix_di_extractions_site ON di_extractions(site_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('ai-documents','g-mywork','page','sidebar','Extraction Review','निष्कर्षण समीक्षा','/ai/documents','erp.insights.rb','ai.docintel.view','ff.ai.p2804',96,'ocr extraction document intelligence invoice certificate letter contract clause duplicate review',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('ai.documents','ui','Extraction Review','/ai/documents','/ai/documents','WORKLIST','MIGRATED','DOC','28.04','system','2026-11-22T00:00:00.000Z','[]','The review worklist of document extractions with the document and its suggested fields side by side.','migration','reference_seed');
INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES ('ai.docintel_queue','ai','Documents to review','समीक्षा हेतु दस्तावेज़','Document extractions waiting for a person to review.','kpi','/api/v1/ui/widgets/ai.docintel_queue/data','ai.docintel.view',3,1,600,'/ai/documents',546,'migration','reference_seed');
