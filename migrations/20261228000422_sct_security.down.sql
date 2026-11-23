DELETE FROM ui_page_migration WHERE page_code = 'admin.security-findings' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'sct-security-findings' AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code = 'sct.finding.raised' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS sct_reviews;
DROP TABLE IF EXISTS sct_findings;
DROP TABLE IF EXISTS sct_scan_runs;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3005' AND company_id IS NULL AND source_type = 'reference_seed';
