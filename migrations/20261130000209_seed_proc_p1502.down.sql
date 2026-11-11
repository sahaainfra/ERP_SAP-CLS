DELETE FROM ntf_templates WHERE code IN ('proc.mrp.completed','proc.mrp.shortage','proc.mrp.late','proc.param.approved','proc.param.rejected') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '15.02';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-mrp','proc-mrp-proposals','proc-mrp-heatmap','proc-item-params');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1502';
