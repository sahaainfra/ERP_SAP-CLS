DELETE FROM ntf_templates WHERE code IN ('proc.po.approved','proc.po.rejected','proc.po.acknowledged','proc.po.overdue','proc.po.advance_decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '15.05';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-purchase-orders','proc-po-new','proc-po-amend','proc-po-tracker');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1505';
