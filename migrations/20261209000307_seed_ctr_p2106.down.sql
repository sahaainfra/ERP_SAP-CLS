DELETE FROM ntf_templates WHERE code IN ('ctr.claim.decided','ctr.claim.alert','ctr.dispute.decided') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '21.06';
DELETE FROM ui_navigation_entries WHERE code IN ('ctr-claims','ctr-claim-watchlist','ctr-disputes');
DELETE FROM core_feature_flags WHERE key = 'ff.ctr.p2106';
