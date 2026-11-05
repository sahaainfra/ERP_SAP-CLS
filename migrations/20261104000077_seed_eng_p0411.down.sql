DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '04.11';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('admin-templates','admin-templates-editor','documents-generated');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.eng.p0411';
DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code = 'tpl.bulk.done';
