DROP TABLE IF EXISTS sig_config;
DROP TABLE IF EXISTS sig_profiles;
DROP TABLE IF EXISTS sig_verifications;
DROP TABLE IF EXISTS sig_copies;
DROP TRIGGER IF EXISTS trg_sig_signatures_no_delete;
DROP TRIGGER IF EXISTS trg_sig_signatures_immutable;
DROP TABLE IF EXISTS sig_signatures;
