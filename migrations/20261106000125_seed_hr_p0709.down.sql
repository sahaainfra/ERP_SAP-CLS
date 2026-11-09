DELETE FROM ui_widgets WHERE code = 'ess.team_present';
DELETE FROM ntf_templates WHERE code = 'ess.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.09';
DELETE FROM ui_navigation_entries WHERE code IN ('ess-home','ess-attendance','ess-profile','ess-letters','ess-team');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0709';
