DELETE FROM ui_widgets WHERE code = 'grv.overdue';
DELETE FROM ntf_templates WHERE code IN ('sep.decided', 'sep.clearance', 'grv.update') AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.13';
DELETE FROM ui_navigation_entries WHERE code IN ('exit-resign','exit-separations','exit-clearances','grievances','grievance-new','disciplinary');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0713';
