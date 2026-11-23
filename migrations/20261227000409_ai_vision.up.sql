-- Part 28.05: computer vision decision support. cv_results holds, per analysed site photograph, the model that looked at it, its suggestions
-- (label, confidence, box, and what a person decided: confirmed into an observation or NCR, a progress note, or a false positive) and the
-- blurred copy that hides faces and people. Nobody is identified; nothing is applied without a person.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.ai.p2805', 'Computer vision decision support (part 28.05)', 0, 0, 'migration', 'reference_seed');

CREATE TABLE IF NOT EXISTS cv_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies(id),
  doc_no TEXT NOT NULL,
  file_id INTEGER NOT NULL REFERENCES core_files(id),
  file_name TEXT NOT NULL,
  linked_entity TEXT,
  linked_id INTEGER,
  model TEXT NOT NULL,
  labels_json TEXT NOT NULL DEFAULT '[]',
  confidence NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REVIEWED', 'NO_FINDINGS', 'FAILED')),
  reason TEXT,
  blurred_file_id INTEGER REFERENCES core_files(id),
  blur_regions_json TEXT,
  analysed_at TEXT NOT NULL,
  confirmed_by TEXT,
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_cv_results_file ON cv_results(company_id, file_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_cv_results_queue ON cv_results(company_id, status, analysed_at);
CREATE INDEX IF NOT EXISTS ix_cv_results_file ON cv_results(file_id);
CREATE INDEX IF NOT EXISTS ix_cv_results_blurred ON cv_results(blurred_file_id);
CREATE INDEX IF NOT EXISTS ix_cv_results_project ON cv_results(project_id);
CREATE INDEX IF NOT EXISTS ix_cv_results_site ON cv_results(site_id);

INSERT OR IGNORE INTO ui_navigation_entries
  (code,parent_code,kind,placement,label,label_hi,route,icon,permission_key,feature_flag,sort_order,keywords,mobile_visible,onboarding,created_by,source_type)
VALUES ('ai-vision','g-mywork','page','sidebar','Vision Suggestions','दृश्य सुझाव','/ai/vision','erp.insights.rb','ai.vision.view','ff.ai.p2805',97,'vision photo ppe helmet vest crack honeycomb slab defect suggestion blur',1,'none','migration','reference_seed');
INSERT OR IGNORE INTO ui_page_migration
  (page_code,module,label,old_route,new_route,page_type,status,owner_role,migrated_in_part,migrated_by,migrated_at,defects_json,notes,created_by,source_type)
VALUES ('ai.vision','ui','Vision Suggestions','/ai/vision','/ai/vision','WORKLIST','MIGRATED','HSEE','28.05','system','2026-11-22T00:00:00.000Z','[]','The review worklist of vision suggestions on site photographs: boxes, confidence, confirm into observations or NCRs, false positives, blurring.','migration','reference_seed');
INSERT OR IGNORE INTO ui_widgets
  (code,module,title,title_hi,description,type,data_endpoint,permission_key,default_w,default_h,refresh_sec,drill_route,sort_order,created_by,source_type)
VALUES ('ai.vision_queue','ai','Vision suggestions to review','समीक्षा हेतु दृश्य सुझाव','Site photographs with vision suggestions waiting for a person.','kpi','/api/v1/ui/widgets/ai.vision_queue/data','ai.vision.view',3,1,600,'/ai/vision',547,'migration','reference_seed');
