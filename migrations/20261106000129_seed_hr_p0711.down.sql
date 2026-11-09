DELETE FROM ui_widgets WHERE code = 'perf.calibration_waiting';
DELETE FROM ntf_templates WHERE code IN ('perf.decided', 'perf.cycle_open', 'perf.feedback') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.11';
DELETE FROM ui_navigation_entries WHERE code IN ('perf-home','perf-team','perf-goals','perf-reviews','perf-feedback','perf-kpis');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0711';
