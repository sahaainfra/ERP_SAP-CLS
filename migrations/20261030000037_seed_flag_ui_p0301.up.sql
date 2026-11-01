-- Reference seed (part 03.01): the feature flag, OFF by default and ON in development and test.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES ('ff.ui.p0301', 'Part 03.01 design tokens, themes, typography and iconography', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT 'ff.ui.p0301', 'Part 03.01 design tokens, themes, typography and iconography', 0, env.name, 1, 'migration', 'reference_seed'
FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
