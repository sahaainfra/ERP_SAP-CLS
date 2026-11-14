DELETE FROM ntf_templates WHERE code IN ('ctr.contract.decided','ctr.amendment.decided','ctr.obligation.alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '21.01';
DELETE FROM ui_navigation_entries WHERE code IN ('ctr-contracts','ctr-obligations','ctr-amendments');
DELETE FROM core_feature_flags WHERE key = 'ff.ctr.p2101';
DELETE FROM proj_360_widgets WHERE widget_code = 'contract' AND company_id IS NULL AND source_type = 'reference_seed';
