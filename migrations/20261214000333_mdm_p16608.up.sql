-- Part 166.8: statutory updates retrofit (GST rate rationalisation from 22-09-2025, the four Labour Codes from 21-11-2025, the Income-tax Act 2025 from
-- 01-04-2026). Every rate, section, form and due date stays a dated master row (never a constant in code); the values and their sources are in
-- DECISIONS.md (ADR-624). Rows of the 1961 Act are not ended here: with ff.mdm.p16608 OFF the sub bill still reads section 194C as before; with it ON
-- the section is resolved by the nature of the payment and the date, and the row of the 2025 Act (from 01-04-2026) is the one in force.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) VALUES ('ff.mdm.p16608', 'Statutory updates: GST rates from 22-09-2025, Labour Codes wages, Income-tax Act 2025 sections and forms, statutory calendar, migration report (part 166.8)', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) SELECT 'ff.mdm.p16608', 'Statutory updates: GST rates from 22-09-2025, Labour Codes wages, Income-tax Act 2025 sections and forms, statutory calendar, migration report (part 166.8)', 0, env.name, 1, 'migration', 'reference_seed' FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;

-- S-01: the 40 % slab, and cement (HSN 2523) from 28 % to 18 % from 22-09-2025 (Notification 9/2025-Central Tax (Rate) of 17-09-2025).
INSERT OR IGNORE INTO mdm_gst_rates (code, description, igst_pct, cgst_pct, sgst_pct, cess_pct, effective_from, created_by, source_type, remarks) VALUES ('GST40', '40% (Notification 9/2025-CT(Rate), Schedule III)', 400000, 200000, 200000, 0, '2025-09-22', 'migration', 'reference_seed_p16608', 'ADR-624');
UPDATE mdm_hsn_sac SET effective_to = '2025-09-21', updated_by = 'migration', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), version = version + 1 WHERE company_id IS NULL AND code = '2523' AND effective_from = '2017-07-01' AND effective_to IS NULL AND source_type = 'reference_seed';
INSERT OR IGNORE INTO mdm_hsn_sac (code, code_type, description, default_gst_code, reverse_charge, effective_from, created_by, source_type, remarks) VALUES ('2523', 'HSN', 'Portland cement and other hydraulic cements', 'GST18', 0, '2025-09-22', 'migration', 'reference_seed_p16608', 'Notification 9/2025-CT(Rate): 28% to 18% from 22-09-2025 (ADR-624)');

-- S-02 / S-03: the nature of the payment, the Act, the legal reference and the TRACES payment codes on each TDS row; the key becomes section + nature.
ALTER TABLE mdm_tds_sections ADD COLUMN nature_code TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE mdm_tds_sections ADD COLUMN act_code TEXT NOT NULL DEFAULT 'IT1961' CHECK (act_code IN ('IT1961', 'IT2025'));
ALTER TABLE mdm_tds_sections ADD COLUMN legal_ref TEXT;
ALTER TABLE mdm_tds_sections ADD COLUMN payment_code TEXT;
ALTER TABLE mdm_tds_sections ADD COLUMN payment_code_other TEXT;
UPDATE mdm_tds_sections SET nature_code = CASE section WHEN '194C' THEN 'CONTRACTOR' WHEN '194J' THEN 'PROFESSIONAL' WHEN '194Q' THEN 'PURCHASE_GOODS' WHEN '194I(a)' THEN 'RENT_PLANT' WHEN '194I(b)' THEN 'RENT_LAND' WHEN '194H' THEN 'COMMISSION' WHEN '206C(1H)' THEN 'SALE_GOODS' ELSE 'OTHER' END;
UPDATE mdm_tds_sections SET legal_ref = 'Section ' || section || ', Income-tax Act, 1961' WHERE legal_ref IS NULL;
UPDATE mdm_tds_sections SET payment_code = '94C', payment_code_other = '94C' WHERE section = '194C' AND company_id IS NULL;
DROP INDEX IF EXISTS ux_mdm_tds_sections_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_tds_sections_key ON mdm_tds_sections (COALESCE(company_id, 0), section, nature_code, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_tds_sections_nature ON mdm_tds_sections (nature_code, effective_from);
-- the 2025 Act (from 01-04-2026): section 393(1) for residents; the rates and thresholds carry over unchanged (ADR-624)
INSERT OR IGNORE INTO mdm_tds_sections (section, nature_code, act_code, tax_kind, description, legal_ref, payment_code, payment_code_other, rate_individual, rate_company, threshold_single, threshold_annual, effective_from, created_by, source_type, remarks) VALUES ('393(1)', 'CONTRACTOR', 'IT2025', 'TDS', 'Payment to contractors and sub-contractors', 'Section 393(1), Table, Sl. No. 6(i), Income-tax Act, 2025', '1023', '1024', 10000, 20000, 3000000, 10000000, '2026-04-01', 'migration', 'reference_seed_p16608', 'ADR-624');
INSERT OR IGNORE INTO mdm_tds_sections (section, nature_code, act_code, tax_kind, description, legal_ref, rate_individual, rate_company, threshold_single, threshold_annual, effective_from, created_by, source_type, remarks) VALUES ('393(1)', 'PROFESSIONAL', 'IT2025', 'TDS', 'Fees for professional or technical services', 'Section 393(1), Income-tax Act, 2025', 100000, 100000, 3000000, 0, '2026-04-01', 'migration', 'reference_seed_p16608', 'ADR-624; table serial and payment code to be confirmed (D-698)');
INSERT OR IGNORE INTO mdm_tds_sections (section, nature_code, act_code, tax_kind, description, legal_ref, rate_individual, rate_company, threshold_single, threshold_annual, effective_from, created_by, source_type, remarks) VALUES ('393(1)', 'PURCHASE_GOODS', 'IT2025', 'TDS', 'Purchase of goods (above ₹50 lakh in a year)', 'Section 393(1), Income-tax Act, 2025', 1000, 1000, 0, 500000000, '2026-04-01', 'migration', 'reference_seed_p16608', 'ADR-624; table serial and payment code to be confirmed (D-698)');
INSERT OR IGNORE INTO mdm_tds_sections (section, nature_code, act_code, tax_kind, description, legal_ref, rate_individual, rate_company, threshold_single, threshold_annual, effective_from, created_by, source_type, remarks) VALUES ('393(1)', 'RENT_PLANT', 'IT2025', 'TDS', 'Rent of plant, machinery or equipment', 'Section 393(1), Income-tax Act, 2025', 20000, 20000, 0, 24000000, '2026-04-01', 'migration', 'reference_seed_p16608', 'ADR-624; table serial and payment code to be confirmed (D-698)');
INSERT OR IGNORE INTO mdm_tds_sections (section, nature_code, act_code, tax_kind, description, legal_ref, rate_individual, rate_company, threshold_single, threshold_annual, effective_from, created_by, source_type, remarks) VALUES ('393(1)', 'RENT_LAND', 'IT2025', 'TDS', 'Rent of land, building or furniture', 'Section 393(1), Income-tax Act, 2025', 100000, 100000, 0, 24000000, '2026-04-01', 'migration', 'reference_seed_p16608', 'ADR-624; table serial and payment code to be confirmed (D-698)');
INSERT OR IGNORE INTO mdm_tds_sections (section, nature_code, act_code, tax_kind, description, legal_ref, rate_individual, rate_company, threshold_single, threshold_annual, effective_from, created_by, source_type, remarks) VALUES ('393(1)', 'COMMISSION', 'IT2025', 'TDS', 'Commission or brokerage', 'Section 393(1), Income-tax Act, 2025', 50000, 50000, 1500000, 0, '2026-04-01', 'migration', 'reference_seed_p16608', 'ADR-624; table serial and payment code to be confirmed (D-698)');

-- S-03: the certificate and return forms, old and new, by date (Income-tax Rules 2026: certificates rule 215, returns rule 219).
CREATE TABLE IF NOT EXISTS mdm_tds_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  purpose         TEXT    NOT NULL CHECK (purpose IN ('SALARY_CERT', 'NON_SALARY_CERT', 'SALARY_RETURN', 'NON_SALARY_RETURN')),
  form_code       TEXT    NOT NULL,
  act_code        TEXT    NOT NULL CHECK (act_code IN ('IT1961', 'IT2025')),
  replaces        TEXT,
  legal_ref       TEXT,
  description     TEXT    NOT NULL,
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_tds_forms_key ON mdm_tds_forms (COALESCE(company_id, 0), purpose, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_tds_forms_company ON mdm_tds_forms (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_tds_forms_cr ON mdm_tds_forms (change_request_id);
INSERT OR IGNORE INTO mdm_tds_forms (purpose, form_code, act_code, replaces, legal_ref, description, effective_from, effective_to, created_by, source_type) VALUES ('SALARY_CERT', '16', 'IT1961', NULL, 'Rule 31, Income-tax Rules, 1962', 'TDS certificate for salary', '2000-01-01', '2026-03-31', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_tds_forms (purpose, form_code, act_code, replaces, legal_ref, description, effective_from, effective_to, created_by, source_type) VALUES ('NON_SALARY_CERT', '16A', 'IT1961', NULL, 'Rule 31, Income-tax Rules, 1962', 'TDS certificate for payments other than salary', '2000-01-01', '2026-03-31', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_tds_forms (purpose, form_code, act_code, replaces, legal_ref, description, effective_from, effective_to, created_by, source_type) VALUES ('SALARY_RETURN', '24Q', 'IT1961', NULL, 'Rule 31A, Income-tax Rules, 1962', 'Quarterly TDS statement for salary', '2000-01-01', '2026-03-31', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_tds_forms (purpose, form_code, act_code, replaces, legal_ref, description, effective_from, effective_to, created_by, source_type) VALUES ('NON_SALARY_RETURN', '26Q', 'IT1961', NULL, 'Rule 31A, Income-tax Rules, 1962', 'Quarterly TDS statement for payments to residents other than salary', '2000-01-01', '2026-03-31', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_tds_forms (purpose, form_code, act_code, replaces, legal_ref, description, effective_from, created_by, source_type) VALUES ('SALARY_CERT', '130', 'IT2025', '16', 'Rule 215, Income-tax Rules, 2026', 'TDS certificate for salary', '2026-04-01', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_tds_forms (purpose, form_code, act_code, replaces, legal_ref, description, effective_from, created_by, source_type) VALUES ('NON_SALARY_CERT', '131', 'IT2025', '16A', 'Rule 215, Income-tax Rules, 2026', 'TDS certificate for payments other than salary', '2026-04-01', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_tds_forms (purpose, form_code, act_code, replaces, legal_ref, description, effective_from, created_by, source_type) VALUES ('SALARY_RETURN', '138', 'IT2025', '24Q', 'Rule 219, Income-tax Rules, 2026', 'Quarterly TDS statement for salary', '2026-04-01', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_tds_forms (purpose, form_code, act_code, replaces, legal_ref, description, effective_from, created_by, source_type) VALUES ('NON_SALARY_RETURN', '140', 'IT2025', '26Q', 'Rule 219, Income-tax Rules, 2026', 'Quarterly TDS statement for payments to residents other than salary', '2026-04-01', 'migration', 'reference_seed_p16608');

-- FR-03: the statutory calendar: when each return or deposit is due, by period, as dated rows; the daily job raises an alert ahead of each due date.
CREATE TABLE IF NOT EXISTS mdm_statutory_calendar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  obligation      TEXT    NOT NULL,
  purpose         TEXT    CHECK (purpose IS NULL OR purpose IN ('SALARY_CERT', 'NON_SALARY_CERT', 'SALARY_RETURN', 'NON_SALARY_RETURN', 'TDS_DEPOSIT')),
  period_kind     TEXT    NOT NULL CHECK (period_kind IN ('MONTH', 'QUARTER', 'YEAR')),
  period_no       INTEGER NOT NULL DEFAULT 0 CHECK (period_no BETWEEN 0 AND 12),
  due_months_after INTEGER NOT NULL DEFAULT 1 CHECK (due_months_after BETWEEN 0 AND 12),
  due_day         INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  alert_days      INTEGER NOT NULL DEFAULT 7 CHECK (alert_days BETWEEN 0 AND 60),
  owner_role      TEXT    NOT NULL DEFAULT 'ACCMGR',
  legal_ref       TEXT,
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_statutory_calendar_key ON mdm_statutory_calendar (COALESCE(company_id, 0), code, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_statutory_calendar_company ON mdm_statutory_calendar (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_statutory_calendar_cr ON mdm_statutory_calendar (change_request_id);
-- quarterly TDS statements: Q1 (Apr-Jun) by 31 Jul, Q2 by 31 Oct, Q3 by 31 Jan, Q4 (Jan-Mar) by 31 May; monthly deposit by the 7th, March's by 30 April
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, effective_to, created_by, source_type) VALUES ('TDS_RET_Q1', 'Quarterly TDS statements, April to June', 'NON_SALARY_RETURN', 'QUARTER', 1, 1, 31, 10, 'ACCMGR', 'Rule 31A, Income-tax Rules, 1962', '2000-01-01', '2026-03-31', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, effective_to, created_by, source_type) VALUES ('TDS_RET_Q2', 'Quarterly TDS statements, July to September', 'NON_SALARY_RETURN', 'QUARTER', 2, 1, 31, 10, 'ACCMGR', 'Rule 31A, Income-tax Rules, 1962', '2000-01-01', '2026-03-31', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, effective_to, created_by, source_type) VALUES ('TDS_RET_Q3', 'Quarterly TDS statements, October to December', 'NON_SALARY_RETURN', 'QUARTER', 3, 1, 31, 10, 'ACCMGR', 'Rule 31A, Income-tax Rules, 1962', '2000-01-01', '2026-03-31', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, effective_to, created_by, source_type) VALUES ('TDS_RET_Q4', 'Quarterly TDS statements, January to March', 'NON_SALARY_RETURN', 'QUARTER', 4, 2, 31, 10, 'ACCMGR', 'Rule 31A, Income-tax Rules, 1962', '2000-01-01', '2026-03-31', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, created_by, source_type) VALUES ('TDS_RET_Q1', 'Quarterly TDS statements (Forms 138 and 140), April to June', 'NON_SALARY_RETURN', 'QUARTER', 1, 1, 31, 10, 'ACCMGR', 'Rule 219, Income-tax Rules, 2026', '2026-04-01', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, created_by, source_type) VALUES ('TDS_RET_Q2', 'Quarterly TDS statements (Forms 138 and 140), July to September', 'NON_SALARY_RETURN', 'QUARTER', 2, 1, 31, 10, 'ACCMGR', 'Rule 219, Income-tax Rules, 2026', '2026-04-01', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, created_by, source_type) VALUES ('TDS_RET_Q3', 'Quarterly TDS statements (Forms 138 and 140), October to December', 'NON_SALARY_RETURN', 'QUARTER', 3, 1, 31, 10, 'ACCMGR', 'Rule 219, Income-tax Rules, 2026', '2026-04-01', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, created_by, source_type) VALUES ('TDS_RET_Q4', 'Quarterly TDS statements (Forms 138 and 140), January to March', 'NON_SALARY_RETURN', 'QUARTER', 4, 2, 31, 10, 'ACCMGR', 'Rule 219, Income-tax Rules, 2026', '2026-04-01', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, created_by, source_type) VALUES ('TDS_DEPOSIT', 'Deposit of the tax deducted in the month', 'TDS_DEPOSIT', 'MONTH', 0, 1, 7, 3, 'ACCMGR', 'Rule 30, Income-tax Rules, 1962', '2000-01-01', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_statutory_calendar (code, obligation, purpose, period_kind, period_no, due_months_after, due_day, alert_days, owner_role, legal_ref, effective_from, created_by, source_type) VALUES ('TDS_DEPOSIT_MAR', 'Deposit of the tax deducted in March', 'TDS_DEPOSIT', 'MONTH', 3, 1, 30, 5, 'ACCMGR', 'Rule 30, Income-tax Rules, 1962', '2000-01-01', 'migration', 'reference_seed_p16608');

-- the alert centre (04.09): a library rule over the statutory due dates; a company enables it (the dataset is offered by the master data module)
INSERT OR IGNORE INTO alr_rules (company_id, code, name, description, trigger_type, event_type, schedule, dataset, condition_json, actions_json, message_template, throttle_minutes, severity, owner_module, owner_role, external, enabled, rule_version, status, created_by, source_type) VALUES (NULL, 'mdm.statutory_due', 'Statutory return or deposit due', 'A TDS statement, certificate or deposit of the statutory calendar is due within its alert days.', 'SCHEDULE', NULL, 'DAILY@08', 'mdm.statutory_due', '{"all": [{"field": "withinAlert", "op": "eq", "value": true}]}', '[{"type": "notify", "to": ["owner"]}]', '{{obligation}} for {{period}} is due on {{dueDate}} ({{form}}): {{daysToDue}} days left.', 1440, 'WARNING', 'mdm', 'ACCMGR', 0, 0, 1, 'LIBRARY', 'migration', 'reference_seed_p16608');

-- S-05: the rules under the Labour Codes, by state (or CENTRAL), from the date each was notified; states notify on different dates.
CREATE TABLE IF NOT EXISTS mdm_labour_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  state_code      TEXT    NOT NULL,
  code_kind       TEXT    NOT NULL CHECK (code_kind IN ('WAGES', 'SOCIAL_SECURITY', 'INDUSTRIAL_RELATIONS', 'OSH')),
  rule_ref        TEXT    NOT NULL,
  notified_on     TEXT,
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_labour_rules_key ON mdm_labour_rules (COALESCE(company_id, 0), state_code, code_kind, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_labour_rules_company ON mdm_labour_rules (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_labour_rules_cr ON mdm_labour_rules (change_request_id);
INSERT OR IGNORE INTO mdm_labour_rules (state_code, code_kind, rule_ref, notified_on, effective_from, created_by, source_type) VALUES ('CENTRAL', 'WAGES', 'Code on Wages, 2019 in force (Ministry of Labour and Employment, 21-11-2025)', '2025-11-21', '2025-11-21', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_labour_rules (state_code, code_kind, rule_ref, notified_on, effective_from, created_by, source_type) VALUES ('CENTRAL', 'SOCIAL_SECURITY', 'Code on Social Security, 2020 in force (Ministry of Labour and Employment, 21-11-2025)', '2025-11-21', '2025-11-21', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_labour_rules (state_code, code_kind, rule_ref, notified_on, effective_from, created_by, source_type) VALUES ('CENTRAL', 'INDUSTRIAL_RELATIONS', 'Industrial Relations Code, 2020 in force (Ministry of Labour and Employment, 21-11-2025)', '2025-11-21', '2025-11-21', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_labour_rules (state_code, code_kind, rule_ref, notified_on, effective_from, created_by, source_type) VALUES ('CENTRAL', 'OSH', 'Occupational Safety, Health and Working Conditions Code, 2020 in force (Ministry of Labour and Employment, 21-11-2025)', '2025-11-21', '2025-11-21', 'migration', 'reference_seed_p16608');

-- S-04: pay components classified for the Code on Wages (section 2(y)), and an employee's monthly pay by component from a date.
CREATE TABLE IF NOT EXISTS mdm_pay_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER REFERENCES org_companies (id),
  code            TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  wage_class      TEXT    NOT NULL CHECK (wage_class IN ('WAGES', 'EXCLUDED', 'NOT_REMUNERATION')),
  legal_ref       TEXT,
  effective_from  TEXT    NOT NULL DEFAULT '2000-01-01',
  effective_to    TEXT,
  row_status      TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (row_status IN ('PENDING', 'ACTIVE', 'REJECTED', 'RETIRED')),
  change_request_id INTEGER REFERENCES mdm_change_requests (id),
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_mdm_pay_components_key ON mdm_pay_components (COALESCE(company_id, 0), code, effective_from) WHERE row_status IN ('PENDING', 'ACTIVE') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mdm_pay_components_company ON mdm_pay_components (company_id, row_status);
CREATE INDEX IF NOT EXISTS ix_mdm_pay_components_cr ON mdm_pay_components (change_request_id);
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('BASIC', 'Basic pay', 'WAGES', 'Code on Wages, s.2(y)', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('DA', 'Dearness allowance', 'WAGES', 'Code on Wages, s.2(y)', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('RETAINING', 'Retaining allowance', 'WAGES', 'Code on Wages, s.2(y)', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('SPECIAL', 'Special allowance', 'WAGES', 'Code on Wages, s.2(y): not among the exclusions', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('HRA', 'House rent allowance', 'EXCLUDED', 'Code on Wages, s.2(y)(f)', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('CONVEYANCE', 'Conveyance allowance', 'EXCLUDED', 'Code on Wages, s.2(y)(d)', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('OVERTIME', 'Overtime allowance', 'EXCLUDED', 'Code on Wages, s.2(y)(h)', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('COMMISSION', 'Commission', 'EXCLUDED', 'Code on Wages, s.2(y)(i)', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('BONUS', 'Bonus not part of the terms of employment', 'EXCLUDED', 'Code on Wages, s.2(y)(a)', 'migration', 'reference_seed_p16608');
INSERT OR IGNORE INTO mdm_pay_components (code, name, wage_class, legal_ref, created_by, source_type) VALUES ('GRATUITY', 'Gratuity on termination', 'NOT_REMUNERATION', 'Code on Wages, s.2(y)(j)', 'migration', 'reference_seed_p16608');

CREATE TABLE IF NOT EXISTS hr_employee_pay (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES org_companies (id),
  employee_id     INTEGER NOT NULL REFERENCES hr_employees (id),
  component_code  TEXT    NOT NULL,
  monthly_paise   INTEGER NOT NULL CHECK (monthly_paise >= 0),
  effective_from  TEXT    NOT NULL,
  effective_to    TEXT,
  project_id  INTEGER,
  site_id     INTEGER,
  created_by  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  TEXT,
  updated_at  TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at  TEXT,
  deleted_by  TEXT,
  source_type TEXT,
  source_id   TEXT,
  remarks     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_hr_employee_pay_key ON hr_employee_pay (employee_id, component_code, effective_from) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_hr_employee_pay_company ON hr_employee_pay (company_id, employee_id);

-- the pages: the four new masters and the statutory changes page (rates by date, sections by nature and date, forms, calendar, migration report)
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES ('mdm-statutory', 'g-administration', 'page', 'sidebar', 'Statutory Changes', 'वैधानिक परिवर्तन', '/admin/master-data/statutory', 'erp.action.settings', 'mdm.record.view', 'ff.mdm.p16608', 412, 'gst 2.0 40% cement labour codes wages income-tax act 2025 393 form 130 131 138 140 calendar', 1, 0, NULL, 0, NULL, NULL, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES ('mdm-common-tds-forms', 'g-administration', 'page', 'sidebar', 'TDS Forms', 'टीडीएस फ़ॉर्म', '/admin/master-data/common/tds-forms', 'erp.action.settings', 'mdm.record.view', 'ff.mdm.p16608', 413, 'form 16 16a 24q 26q 130 131 138 140', 0, 0, NULL, 0, NULL, NULL, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES ('mdm-common-statutory-calendar', 'g-administration', 'page', 'sidebar', 'Statutory Calendar', 'वैधानिक कैलेंडर', '/admin/master-data/common/statutory-calendar', 'erp.action.settings', 'mdm.record.view', 'ff.mdm.p16608', 414, 'due dates tds return deposit', 0, 0, NULL, 0, NULL, NULL, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES ('mdm-common-labour-rules', 'g-administration', 'page', 'sidebar', 'Labour Code Rules', 'श्रम संहिता नियम', '/admin/master-data/common/labour-rules', 'erp.action.settings', 'mdm.record.view', 'ff.mdm.p16608', 415, 'labour codes state rules osh wages', 0, 0, NULL, 0, NULL, NULL, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_navigation_entries (code, parent_code, kind, placement, label, label_hi, route, icon, permission_key, feature_flag, sort_order, keywords, mobile_visible, onboarding, shortcut, tile, quick_create_label, quick_create_route, created_by, source_type) VALUES ('mdm-common-pay-components', 'g-administration', 'page', 'sidebar', 'Pay Components', 'वेतन घटक', '/admin/master-data/common/pay-components', 'erp.action.settings', 'mdm.record.view', 'ff.mdm.p16608', 416, 'wages basic hra allowance code on wages 50%', 0, 0, NULL, 0, NULL, NULL, 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_page_migration (page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, migrated_by, migrated_at, defects_json, notes, created_by, source_type) VALUES ('mdm.statutory', 'mdm', 'Statutory Changes', '/admin/master-data/statutory', '/admin/master-data/statutory', 'REPORT', 'MIGRATED', 'ACCMGR', '166.8', 'system', '2026-11-17T00:00:00.000Z', '[]', 'Built in part 166.8: the GST rates, TDS sections and forms on a date, the statutory calendar and the documents to review.', 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_page_migration (page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, migrated_by, migrated_at, defects_json, notes, created_by, source_type) VALUES ('mdm.common.tds-forms', 'mdm', 'TDS Forms', '/admin/master-data/common/tds-forms', '/admin/master-data/common/tds-forms', 'LIST', 'MIGRATED', 'ACCMGR', '166.8', 'system', '2026-11-17T00:00:00.000Z', '[]', 'Built in part 166.8: the certificate and return forms by date.', 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_page_migration (page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, migrated_by, migrated_at, defects_json, notes, created_by, source_type) VALUES ('mdm.common.statutory-calendar', 'mdm', 'Statutory Calendar', '/admin/master-data/common/statutory-calendar', '/admin/master-data/common/statutory-calendar', 'LIST', 'MIGRATED', 'ACCMGR', '166.8', 'system', '2026-11-17T00:00:00.000Z', '[]', 'Built in part 166.8: the due dates of returns and deposits by period.', 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_page_migration (page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, migrated_by, migrated_at, defects_json, notes, created_by, source_type) VALUES ('mdm.common.labour-rules', 'mdm', 'Labour Code Rules', '/admin/master-data/common/labour-rules', '/admin/master-data/common/labour-rules', 'LIST', 'MIGRATED', 'ACCMGR', '166.8', 'system', '2026-11-17T00:00:00.000Z', '[]', 'Built in part 166.8: the rules under the four Labour Codes, central and by state, from their dates.', 'migration', 'reference_seed');
INSERT OR IGNORE INTO ui_page_migration (page_code, module, label, old_route, new_route, page_type, status, owner_role, migrated_in_part, migrated_by, migrated_at, defects_json, notes, created_by, source_type) VALUES ('mdm.common.pay-components', 'mdm', 'Pay Components', '/admin/master-data/common/pay-components', '/admin/master-data/common/pay-components', 'LIST', 'MIGRATED', 'ACCMGR', '166.8', 'system', '2026-11-17T00:00:00.000Z', '[]', 'Built in part 166.8: the pay components and their class under the Code on Wages.', 'migration', 'reference_seed');
