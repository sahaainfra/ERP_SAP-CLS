DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code IN ('msg.message', 'msg.mention');
DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '05.01';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND (code = 'messages' OR route IN ('/collab/messages', '/collab/messages/new'));
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.msg.p0501';
