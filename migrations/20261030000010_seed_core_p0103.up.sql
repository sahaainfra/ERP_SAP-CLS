-- Reference seed (part 01.03): the feature flag (OFF by default, ON in development and test) and the one document
-- type this part owns, the sample document. Modules register their own document types in their own migrations.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
VALUES ('ff.core.p0103', 'Part 01.03 system configuration, financial years and numbering series', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type)
SELECT 'ff.core.p0103', 'Part 01.03 system configuration, financial years and numbering series', 0, env.name, 1, 'migration', 'reference_seed'
FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;

INSERT OR IGNORE INTO core_document_types (code, name, module, retention_class, statutory, assign_at, created_by, source_type)
VALUES ('SAMPLE_DOC', 'Sample document', 'core', 'short', 0, 'create', 'migration', 'reference_seed');
