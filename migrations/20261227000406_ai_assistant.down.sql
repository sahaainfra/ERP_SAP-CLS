DELETE FROM ui_page_migration WHERE page_code = 'ai.assistant' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'ai-assistant' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS ai_feedback;
DROP TABLE IF EXISTS ai_drafts;
DELETE FROM core_feature_flags WHERE key = 'ff.ai.p2802' AND company_id IS NULL AND source_type = 'reference_seed';
