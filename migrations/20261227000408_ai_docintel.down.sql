DELETE FROM ui_widgets WHERE code = 'ai.docintel_queue' AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code = 'ai.documents' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'ai-documents' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS di_extractions;
DELETE FROM core_feature_flags WHERE key = 'ff.ai.p2804' AND company_id IS NULL AND source_type = 'reference_seed';
