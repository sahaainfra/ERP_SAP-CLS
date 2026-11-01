DELETE FROM ui_dashboards WHERE source_type = 'reference_seed';
DELETE FROM ui_widgets WHERE source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('work', 'admin-sample-requests-overview', 'admin-dashboards');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.ui.p0307';
