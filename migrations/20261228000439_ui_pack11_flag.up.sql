-- PACK-11: typed confirmation before a salary transfer is released to the bank (src/client/modules/pay/SettlePages.jsx). Off by default.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.ui.pack11', 'Typed confirmation for postings that cannot be reversed (PACK-11)', 0, 0, 'migration', 'reference_seed');
