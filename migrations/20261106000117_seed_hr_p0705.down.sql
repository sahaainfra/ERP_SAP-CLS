DELETE FROM ntf_templates WHERE code = 'att.punch.decided' AND company_id IS NULL;
DELETE FROM ui_page_migration WHERE migrated_in_part = '07.05';
DELETE FROM ui_navigation_entries WHERE code IN ('att-punch','att-crew-punch','att-kiosk','att-anomalies','att-today');
DELETE FROM core_feature_flags WHERE key = 'ff.hr.p0705';
