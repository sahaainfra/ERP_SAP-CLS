-- PACK-10: the List Report's preview before a bulk action (who may act on each selected row, and why not), and captions on phone cards
-- for plain tables. Off by default; turned on per company after review.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.list.pack10', 'Bulk action preview and phone-card captions for plain tables (PACK-10)', 0, 0, 'migration', 'reference_seed');
