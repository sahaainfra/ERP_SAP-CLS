-- Reference seed (part 02.03): the feature flag, OFF by default and ON in development and test.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES ('ff.iam.p0203', 'Part 02.03 user management, employee linking, invitations and the onboarding state', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT 'ff.iam.p0203', 'Part 02.03 user management, employee linking, invitations and the onboarding state', 0, env.name, 1, 'migration', 'reference_seed'
FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;
