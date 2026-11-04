DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code IN ('xl.job.checked', 'xl.job.committed');
DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.13';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('import-center', 'import-job', 'admin-import-templates');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0413';
