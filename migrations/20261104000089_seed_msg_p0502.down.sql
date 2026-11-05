DELETE FROM ntf_templates WHERE source_type = 'reference_seed' AND code IN ('msg.call', 'msg.call.missed');
DELETE FROM ui_page_migration WHERE source_type = 'reference_seed' AND migrated_in_part = '05.02';
DELETE FROM ui_navigation_entries WHERE source_type = 'reference_seed' AND (code IN ('messaging-settings', 'messages-call') OR route IN ('/admin/messaging', '/collab/call'));
DELETE FROM core_feature_flags WHERE source_type = 'reference_seed' AND key = 'ff.msg.p0502';
