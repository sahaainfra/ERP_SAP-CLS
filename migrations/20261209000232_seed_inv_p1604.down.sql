DELETE FROM ntf_templates WHERE code IN ('inv.issue.decided','inv.issue.otp','inv.return.decided','inv.free_issue.excess') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '16.04';
DELETE FROM ui_navigation_entries WHERE code IN ('inv-issue-new','inv-issues','inv-site-returns','inv-free-issue');
DELETE FROM core_feature_flags WHERE key = 'ff.inv.p1604';
