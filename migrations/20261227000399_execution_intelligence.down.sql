DELETE FROM proj_360_widgets WHERE widget_code = 'bi.work_done_today' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_widgets WHERE code = 'bi.work_done_today' AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code = 'bi.execution' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'bi-execution' AND source_type = 'reference_seed';
DELETE FROM core_jobs WHERE type = 'bi.execution.capture';
DELETE FROM core_schedules WHERE code = 'bi.execution.capture';
DROP TABLE IF EXISTS dei_daily;
DELETE FROM core_feature_flags WHERE key = 'ff.bi.p2706' AND company_id IS NULL AND source_type = 'reference_seed';
