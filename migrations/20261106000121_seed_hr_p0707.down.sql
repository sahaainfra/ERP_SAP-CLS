DELETE FROM ui_widgets WHERE code = 'lv.approvals_waiting';
DELETE FROM ntf_templates WHERE code = 'lv.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.07';
DELETE FROM ui_navigation_entries WHERE code IN ('lv-apply','lv-my','lv-approvals','lv-calendar','lv-balances','lv-types','lv-yearend');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0707';
