DELETE FROM ntf_templates WHERE code IN ('site.control.alloc_approved','site.control.alloc_rejected','site.control.unallocated','site.control.recon_alert') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '14.07';
DELETE FROM ui_navigation_entries WHERE code IN ('site-control','site-control-variance','site-control-unallocated');
DELETE FROM core_feature_flags WHERE key = 'ff.site.p1407';
