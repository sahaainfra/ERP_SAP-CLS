DELETE FROM ui_widgets WHERE code = 'lab.licences_expiring';
DELETE FROM ntf_templates WHERE code IN ('lab.decided', 'lab.licence.expiring') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.08';
DELETE FROM ui_navigation_entries WHERE code IN ('lab-workers','lab-register','lab-contractors','lab-wages','lab-cards');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0708';
