-- PACK-18: the money of the quantity reconciliation tied to the approved client bills, and the measurement book on a phone (deduction lines,
-- position, photos). Off by default; turned on per company after review.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.bill.pack18', 'Reconciliation money tied to bills, measurement book deduction lines, position and photos (PACK-18)', 0, 0, 'migration', 'reference_seed');
