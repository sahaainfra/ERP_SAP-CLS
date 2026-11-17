-- Part 166.8 down: the pages, the new tables, the 2025-Act rows and columns of the TDS sections (the key back to section), the 40 % rate and cement's
-- 18 % row (its 28 % row open again), and the flag.
DELETE FROM ui_navigation_entries WHERE code IN ('mdm-statutory', 'mdm-common-tds-forms', 'mdm-common-statutory-calendar', 'mdm-common-labour-rules', 'mdm-common-pay-components');
DELETE FROM alr_alerts WHERE rule_code = 'mdm.statutory_due';
DELETE FROM alr_rule_runs WHERE rule_code = 'mdm.statutory_due';
DELETE FROM alr_rules WHERE code = 'mdm.statutory_due';
DROP TABLE IF EXISTS hr_employee_pay;
DROP TABLE IF EXISTS mdm_pay_components;
DROP TABLE IF EXISTS mdm_labour_rules;
DROP TABLE IF EXISTS mdm_statutory_calendar;
DROP TABLE IF EXISTS mdm_tds_forms;
DELETE FROM mdm_tds_sections WHERE act_code = 'IT2025';
DROP INDEX IF EXISTS ix_mdm_tds_sections_nature;
DROP INDEX IF EXISTS ux_mdm_tds_sections_key;
ALTER TABLE mdm_tds_sections DROP COLUMN payment_code_other;
ALTER TABLE mdm_tds_sections DROP COLUMN payment_code;
ALTER TABLE mdm_tds_sections DROP COLUMN legal_ref;
ALTER TABLE mdm_tds_sections DROP COLUMN act_code;
ALTER TABLE mdm_tds_sections DROP COLUMN nature_code;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_tds_sections_key ON mdm_tds_sections (COALESCE(company_id, 0), section, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
DELETE FROM mdm_hsn_sac WHERE company_id IS NULL AND code = '2523' AND source_type = 'reference_seed_p16608';
UPDATE mdm_hsn_sac SET effective_to = NULL, updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), version = version + 1 WHERE company_id IS NULL AND code = '2523' AND effective_from = '2017-07-01' AND effective_to = '2025-09-21' AND source_type = 'reference_seed';
DELETE FROM mdm_gst_rates WHERE company_id IS NULL AND code = 'GST40' AND source_type = 'reference_seed_p16608';
DELETE FROM core_feature_flags WHERE key = 'ff.mdm.p16608';
