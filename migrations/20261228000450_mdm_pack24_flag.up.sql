-- PACK-24: the verification hooks of a partner's GSTIN and PAN are asked at registration when a provider is registered. Off by default; no
-- provider is shipped, so nothing leaves the application until a company signs one up.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.mdm.pack24', 'GSTIN and PAN verification hooks at partner registration (PACK-24)', 0, 0, 'migration', 'reference_seed');
