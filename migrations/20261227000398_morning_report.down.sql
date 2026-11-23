DELETE FROM ntf_templates WHERE code = 'bi.morning_report.ready' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code IN ('bi.morning-report', 'bi.morning-reports') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('bi-morning-report', 'bi-morning-reports') AND source_type = 'reference_seed';
DELETE FROM core_jobs WHERE type = 'bi.morning_report.deliver';
DELETE FROM core_schedules WHERE code = 'bi.morning_report.deliver';
DROP TABLE IF EXISTS mr_reports;
DROP TABLE IF EXISTS mr_configs;
DELETE FROM core_feature_flags WHERE key = 'ff.bi.p2705' AND company_id IS NULL AND source_type = 'reference_seed';
