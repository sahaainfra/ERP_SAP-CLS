-- PACK-09: the shared Indian identifier fields and the drafts and unsaved-changes guard on the long site forms (DPR entry, Record
-- Measurement, Import Client BOQ). Off by default; turned on per company after review.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.forms.pack09', 'Indian identifier fields, drafts and the unsaved-changes guard on long forms (PACK-09)', 0, 0, 'migration', 'reference_seed');
