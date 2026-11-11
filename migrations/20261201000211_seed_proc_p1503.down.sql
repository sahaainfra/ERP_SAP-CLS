DELETE FROM ntf_templates WHERE code IN ('proc.rfq.quote_received','proc.rfq.due_soon','proc.rfq.justify_approved','proc.rfq.justify_rejected') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '15.03';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-rfqs','proc-rfq-new','proc-quotation-entry');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1503';
