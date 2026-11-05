DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code IN ('msg.instruction', 'msg.instruction.acknowledged', 'msg.instruction.escalated', 'msg.announcement', 'msg.escalation', 'msg.autogroup.joined');
DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '05.04';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND code IN ('comm-center', 'comm-acks', 'comm-announcements', 'comm-announcement-new', 'comm-instructions', 'comm-autogroups');
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.msg.p0504';
