-- Reference seed: flag definitions (base rows, default OFF) for the parts built so far.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES
  ('ff.prog.p0001', 'Part 00.01 discovery audit outputs', 0, NULL, 0, 'migration', 'reference_seed'),
  ('ff.prog.p0002', 'Part 00.02 engineering baseline and feature flags', 0, NULL, 0, 'migration', 'reference_seed');
-- Development and test environments run the baseline parts ON.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT key, description, 0, env.name, 1, 'migration', 'reference_seed'
FROM core_feature_flags, (SELECT 'development' AS name UNION ALL SELECT 'test') AS env
WHERE environment IS NULL AND key IN ('ff.prog.p0001', 'ff.prog.p0002');
