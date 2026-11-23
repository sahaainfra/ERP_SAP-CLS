DELETE FROM ui_page_migration WHERE page_code = 'admin.operations' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'ops-runbooks' AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code = 'ops.oncall.page' AND source_type = 'reference_seed';
DROP TABLE IF EXISTS ops_pages;
DROP TABLE IF EXISTS ops_oncall;
DROP TABLE IF EXISTS ops_runbooks;
DROP TABLE IF EXISTS ops_deployments;
DROP TABLE IF EXISTS ops_environments;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3008' AND source_type = 'reference_seed';
