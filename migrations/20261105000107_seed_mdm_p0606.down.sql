-- Removes what the 06.06 seed added.
DELETE FROM ntf_templates WHERE code = 'mdm.analysis.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '06.06';
DELETE FROM ui_navigation_entries WHERE code IN ('mdm-rate-library', 'mdm-sor', 'mdm-rate-analyses', 'mdm-rate-analysis', 'mdm-rate-impact');
DELETE FROM core_feature_flags WHERE key = 'ff.mdm.p0606';
