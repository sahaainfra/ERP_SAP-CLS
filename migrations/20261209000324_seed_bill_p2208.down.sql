DELETE FROM ntf_templates WHERE code = 'bill.qs.alert' AND source_type = 'reference_seed';
DELETE FROM proj_360_widgets WHERE widget_code = 'qs' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_widgets WHERE code IN ('bill.unbilled_wip','bill.certified_not_billed') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '22.08';
DELETE FROM ui_navigation_entries WHERE code = 'bill-qs-dashboard';
DELETE FROM core_feature_flags WHERE key = 'ff.bill.p2208';
