DELETE FROM ui_widgets WHERE code = 'bd.weighted_forecast';
DELETE FROM ntf_templates WHERE code IN ('bd.decided', 'bd.followup') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '08.01';
DELETE FROM ui_navigation_entries WHERE code IN ('bd-dashboard','bd-leads','bd-pipeline','bd-opportunities','bd-clients','g-bd');
DELETE FROM core_feature_flags WHERE key = 'ff.bd.p0801';
