DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code IN ('pol.published', 'pol.ack.reminder', 'pol.ack.overdue', 'pol.review.due', 'pol.requirement.drafted');
DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '05.05';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('policy-register', 'policy-editor', 'my-policies', 'policy-drafts');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.msg.p0505';
