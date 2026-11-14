DELETE FROM ntf_templates WHERE code IN ('rmc.production.alert','rmc.requisition.decided','rmc.delivery_ticket.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '20.02';
DELETE FROM ui_navigation_entries WHERE code IN ('rmc-requisitions','rmc-production','rmc-batches','rmc.delivery-tickets','rmc-receipt','rmc-consumption');
DELETE FROM core_feature_flags WHERE key = 'ff.rmc.p2002';
