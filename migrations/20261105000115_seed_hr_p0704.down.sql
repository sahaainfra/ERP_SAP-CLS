DELETE FROM ui_widgets WHERE code = 'att.roster_waiting';
DELETE FROM ntf_templates WHERE code = 'att.config.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.04';
DELETE FROM ui_navigation_entries WHERE code IN ('hr-shifts','hr-shift','hr-roster','hr-att-policies','hr-att-policy','hr-att-assignment');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0704';
