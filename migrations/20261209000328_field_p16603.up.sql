-- Part 166.3: the mobile site app for site teams, and Telugu.
--  1. the feature flag ff.field.p16603 (OFF by default; ON in development and test);
--  2. Telugu labels of the navigation registry (FR-07's label_te): the table ui_navigation_labels, one row per entry and language. Every migration
--     here must run twice without failing (scripts/lib/migration_check.mjs) and SQLite cannot add a column only when it is missing, so the Telugu
--     label lives beside the entry instead of in a new column; the API gives it as labelTe, like labelHi;
--  3. the field tiles by role (FR-01): ui_field_tile_rules gives a tile its roles (comma list; NULL = every role), its colour, its Telugu label,
--     and feature_flag / retired_flag so the new tiles show and the old sample tiles hide only while ff.field.p16603 is ON;
--  4. ui_bottom_bar: the bottom bar of a phone per role (FR-02);
--  5. ui_user_preferences and ui_translations rebuilt so that their language may be 'te' (no table references either; rows, ids and indexes kept).

-- 1 ------------------------------------------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) VALUES ('ff.field.p16603', 'Mobile site app: role field home, bottom bar by role, one-hand forms, photo stamp, voice notes and Telugu (part 166.3)', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) SELECT 'ff.field.p16603', 'Mobile site app: role field home, bottom bar by role, one-hand forms, photo stamp, voice notes and Telugu (part 166.3)', 0, env.name, 1, 'migration', 'reference_seed' FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;

-- 2 ------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ui_navigation_labels (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES org_companies (id),
  nav_code      TEXT    NOT NULL REFERENCES ui_navigation_entries (code),
  lang          TEXT    NOT NULL CHECK (lang IN ('te')),
  label         TEXT    NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_navigation_labels ON ui_navigation_labels (COALESCE(company_id, 0), nav_code, lang) WHERE deleted_at IS NULL;
INSERT OR IGNORE INTO ui_navigation_labels (nav_code, lang, label, created_by, source_type)
SELECT e.code, 'te', v.label, 'migration', 'reference_seed' FROM (
  SELECT 'g-home' AS code, 'హోమ్' AS label UNION ALL SELECT 'g-mywork', 'నా పని' UNION ALL SELECT 'g-projects', 'ప్రాజెక్టులు' UNION ALL SELECT 'g-engineering', 'ఇంజనీరింగ్'
  UNION ALL SELECT 'g-planning', 'ప్రణాళిక' UNION ALL SELECT 'g-site', 'సైట్' UNION ALL SELECT 'g-procurement', 'కొనుగోలు' UNION ALL SELECT 'g-stores', 'స్టోర్స్'
  UNION ALL SELECT 'g-plant', 'యంత్రాలు' UNION ALL SELECT 'g-rmc', 'బ్యాచింగ్ ప్లాంట్' UNION ALL SELECT 'g-quality', 'నాణ్యత' UNION ALL SELECT 'g-hse', 'భద్రత (HSE)'
  UNION ALL SELECT 'g-contracts', 'కాంట్రాక్టులు మరియు బిల్లింగ్' UNION ALL SELECT 'g-hr', 'HR మరియు జీతాలు' UNION ALL SELECT 'g-reports', 'నివేదికలు' UNION ALL SELECT 'g-messages', 'సందేశాలు'
  UNION ALL SELECT 'g-account', 'ఖాతా' UNION ALL SELECT 'home', 'హోమ్' UNION ALL SELECT 'work', 'నా పని' UNION ALL SELECT 'profile', 'నా ప్రొఫైల్' UNION ALL SELECT 'messages', 'సందేశాలు'
  UNION ALL SELECT 'notifications', 'నోటిఫికేషన్లు' UNION ALL SELECT 'approvals-inbox', 'నా ఆమోదాలు' UNION ALL SELECT 'tasks-my', 'నా పనులు' UNION ALL SELECT 'account-drafts', 'నా డ్రాఫ్ట్‌లు'
  UNION ALL SELECT 'field-home', 'ఫీల్డ్ హోమ్' UNION ALL SELECT 'field-scan', 'స్కాన్' UNION ALL SELECT 'field-approvals', 'ఆమోదాలు (ఫోన్)' UNION ALL SELECT 'field-forms', 'ఫీల్డ్ ఫారాలు'
  UNION ALL SELECT 'field-sync', 'సింక్ స్థితి' UNION ALL SELECT 'field-conflicts', 'విభేదాల పరిష్కారం' UNION ALL SELECT 'site-dpr-entry', 'రోజువారీ ప్రగతి నివేదిక (DPR)'
  UNION ALL SELECT 'site-dprs', 'DPR రిజిస్టర్' UNION ALL SELECT 'proc-mr-new', 'కొత్త మెటీరియల్ అభ్యర్థన' UNION ALL SELECT 'qa-ir-raise', 'తనిఖీ అభ్యర్థన' UNION ALL SELECT 'att-crew-punch', 'గ్యాంగ్ హాజరు'
  UNION ALL SELECT 'att-today', 'ఈ రోజు హాజరు' UNION ALL SELECT 'att-punch', 'పంచ్ ఇన్/అవుట్' UNION ALL SELECT 'hse-toolbox', 'టూల్‌బాక్స్ టాక్' UNION ALL SELECT 'plant-log-entry', 'యంత్రాల రోజువారీ లాగ్'
  UNION ALL SELECT 'plant-fuel-issue', 'ఇంధనం ఇవ్వడం' UNION ALL SELECT 'inv-gate-entry', 'గేట్ ఎంట్రీ' UNION ALL SELECT 'inv-grn-new', 'GRN సృష్టించండి' UNION ALL SELECT 'inv-issue-new', 'మెటీరియల్ ఇవ్వడం'
  UNION ALL SELECT 'inv-blind-count', 'స్టాక్ లెక్కింపు' UNION ALL SELECT 'inv-transfer-new', 'బదిలీ అభ్యర్థన' UNION ALL SELECT 'qa-perform', 'తనిఖీ చేయండి' UNION ALL SELECT 'qa-cubes', 'క్యూబ్ రిజిస్టర్'
  UNION ALL SELECT 'qa-ncr-raise', 'NCR నమోదు' UNION ALL SELECT 'hse-observation', 'భద్రతా పరిశీలన' UNION ALL SELECT 'hse-permit-request', 'వర్క్ పర్మిట్ అభ్యర్థన' UNION ALL SELECT 'hse-incident-report', 'ప్రమాదం నివేదించండి'
) AS v JOIN ui_navigation_entries e ON e.code = v.code;

-- 3 ------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ui_field_tile_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES org_companies (id),
  tile_code     TEXT    NOT NULL,
  role_codes    TEXT,
  feature_flag  TEXT,
  retired_flag  TEXT,
  tone          TEXT    CHECK (tone IS NULL OR tone IN ('navy', 'amber', 'green', 'blue', 'red', 'teal')),
  label_te      TEXT    CHECK (label_te IS NULL OR length(label_te) <= 60),
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_field_tile_rules ON ui_field_tile_rules (COALESCE(company_id, 0), tile_code) WHERE deleted_at IS NULL;
-- the new tiles (a tile shows when its page is in the person's menu, by permission and flag, and its rule lets the person's role have it)
INSERT INTO ui_field_tiles (code, nav_code, label, label_hi, sort_order, created_by, source_type)
SELECT v.code, v.nav, v.label, v.hi, v.sort, 'migration', 'reference_seed' FROM (
  SELECT 'dpr' AS code, 'site-dpr-entry' AS nav, 'Daily progress report' AS label, 'दैनिक प्रगति रिपोर्ट' AS hi, 1 AS sort
  UNION ALL SELECT 'phone-approvals', 'field-approvals', 'Approvals', 'स्वीकृतियाँ', 2
  UNION ALL SELECT 'dpr-register', 'site-dprs', 'DPRs to approve', 'स्वीकृति हेतु DPR', 3
  UNION ALL SELECT 'crew-attendance', 'att-crew-punch', 'Gang attendance', 'गैंग हाज़िरी', 4
  UNION ALL SELECT 'equipment-log', 'plant-log-entry', 'Equipment log', 'उपकरण लॉग', 5
  UNION ALL SELECT 'gate-entry', 'inv-gate-entry', 'Gate entry', 'गेट प्रवेश', 6
  UNION ALL SELECT 'grn', 'inv-grn-new', 'GRN', 'GRN', 7
  UNION ALL SELECT 'inspection', 'qa-perform', 'Checklist inspection', 'चेकलिस्ट निरीक्षण', 8
  UNION ALL SELECT 'observation', 'hse-observation', 'Safety observation', 'सुरक्षा अवलोकन', 9
  UNION ALL SELECT 'mr-new', 'proc-mr-new', 'Material request', 'सामग्री अनुरोध', 10
  UNION ALL SELECT 'ir-new', 'qa-ir-raise', 'Inspection request', 'निरीक्षण अनुरोध', 11
  UNION ALL SELECT 'toolbox', 'hse-toolbox', 'Toolbox talk', 'टूलबॉक्स टॉक', 12
  UNION ALL SELECT 'fuel-issue', 'plant-fuel-issue', 'Fuel issue', 'ईंधन निकासी', 13
  UNION ALL SELECT 'issue-slip', 'inv-issue-new', 'Issue slip', 'निकासी पर्ची', 14
  UNION ALL SELECT 'stock-count', 'inv-blind-count', 'Stock count', 'स्टॉक गिनती', 15
  UNION ALL SELECT 'transfer', 'inv-transfer-new', 'Transfer', 'स्थानांतरण', 16
  UNION ALL SELECT 'cubes', 'qa-cubes', 'Cube register', 'क्यूब रजिस्टर', 17
  UNION ALL SELECT 'ncr', 'qa-ncr-raise', 'NCR with photos', 'फ़ोटो सहित NCR', 18
  UNION ALL SELECT 'permit', 'hse-permit-request', 'Permit to work', 'कार्य परमिट', 19
  UNION ALL SELECT 'incident', 'hse-incident-report', 'Incident', 'घटना', 20
  UNION ALL SELECT 'my-punch', 'att-punch', 'My punch', 'मेरा पंच', 30
) AS v JOIN ui_navigation_entries e ON e.code = v.nav
WHERE NOT EXISTS (SELECT 1 FROM ui_field_tiles t WHERE t.code = v.code AND t.company_id IS NULL AND t.deleted_at IS NULL);
INSERT OR IGNORE INTO ui_field_tile_rules (tile_code, role_codes, feature_flag, retired_flag, tone, label_te, created_by, source_type) VALUES
  ('dpr', 'SE,CSUP,WSUP,CM,PM', 'ff.field.p16603', NULL, 'amber', 'రోజువారీ ప్రగతి నివేదిక', 'migration', 'reference_seed'),
  ('phone-approvals', NULL, 'ff.field.p16603', NULL, 'navy', 'ఆమోదాలు', 'migration', 'reference_seed'),
  ('dpr-register', 'CM,PM,PD', 'ff.field.p16603', NULL, 'blue', 'ఆమోదించవలసిన DPR లు', 'migration', 'reference_seed'),
  ('crew-attendance', 'CSUP,WSUP,SE', 'ff.field.p16603', NULL, 'green', 'గ్యాంగ్ హాజరు', 'migration', 'reference_seed'),
  ('equipment-log', 'PMSUP,PLANTMGR', 'ff.field.p16603', NULL, 'amber', 'యంత్రాల లాగ్', 'migration', 'reference_seed'),
  ('gate-entry', 'SK,STOREMGR', 'ff.field.p16603', NULL, 'navy', 'గేట్ ఎంట్రీ', 'migration', 'reference_seed'),
  ('grn', 'SK,STOREMGR', 'ff.field.p16603', NULL, 'amber', 'GRN', 'migration', 'reference_seed'),
  ('inspection', 'QCE,QCMGR', 'ff.field.p16603', NULL, 'amber', 'చెక్‌లిస్ట్ తనిఖీ', 'migration', 'reference_seed'),
  ('observation', 'HSEE,HSEO,SE,CSUP,WSUP', 'ff.field.p16603', NULL, 'amber', 'భద్రతా పరిశీలన', 'migration', 'reference_seed'),
  ('mr-new', 'SE,SK,STOREMGR', 'ff.field.p16603', NULL, 'blue', 'మెటీరియల్ అభ్యర్థన', 'migration', 'reference_seed'),
  ('ir-new', 'SE', 'ff.field.p16603', NULL, 'blue', 'తనిఖీ అభ్యర్థన', 'migration', 'reference_seed'),
  ('toolbox', 'CSUP,WSUP,HSEE,HSEO', 'ff.field.p16603', NULL, 'green', 'టూల్‌బాక్స్ టాక్', 'migration', 'reference_seed'),
  ('fuel-issue', 'PMSUP,SK', 'ff.field.p16603', NULL, 'teal', 'ఇంధనం ఇవ్వడం', 'migration', 'reference_seed'),
  ('issue-slip', 'SK,STOREMGR', 'ff.field.p16603', NULL, 'blue', 'ఇష్యూ స్లిప్', 'migration', 'reference_seed'),
  ('stock-count', 'SK,STOREMGR', 'ff.field.p16603', NULL, 'green', 'స్టాక్ లెక్కింపు', 'migration', 'reference_seed'),
  ('transfer', 'SK,STOREMGR', 'ff.field.p16603', NULL, 'teal', 'బదిలీ', 'migration', 'reference_seed'),
  ('cubes', 'QCE', 'ff.field.p16603', NULL, 'blue', 'క్యూబ్ రిజిస్టర్', 'migration', 'reference_seed'),
  ('ncr', 'QCE,QCMGR', 'ff.field.p16603', NULL, 'red', 'ఫోటోలతో NCR', 'migration', 'reference_seed'),
  ('permit', 'HSEE,HSEO,SE', 'ff.field.p16603', NULL, 'navy', 'వర్క్ పర్మిట్', 'migration', 'reference_seed'),
  ('incident', 'HSEE,HSEO', 'ff.field.p16603', NULL, 'red', 'ప్రమాదం', 'migration', 'reference_seed'),
  ('my-punch', NULL, 'ff.field.p16603', NULL, 'teal', 'నా పంచ్', 'migration', 'reference_seed'),
  -- the 03.06 tiles: the sample "Material Request" and the administrators' approvals give way to the daily tasks while the part is ON
  ('material-request', NULL, NULL, 'ff.field.p16603', NULL, 'మెటీరియల్ అభ్యర్థన', 'migration', 'reference_seed'),
  ('approvals', NULL, NULL, 'ff.field.p16603', NULL, 'ఆమోదాలు', 'migration', 'reference_seed'),
  ('scan', NULL, NULL, NULL, 'navy', 'స్కాన్', 'migration', 'reference_seed'),
  ('drafts', NULL, NULL, NULL, 'navy', 'నా డ్రాఫ్ట్‌లు', 'migration', 'reference_seed');

-- 4 ------------------------------------------------------------------------------------------------------------------------------------------
-- slot 1-4 of the phone's bottom bar (More is always the fifth). item: 'home' (the person's home), 'work' (My Work), 'scan', 'messages', or 'page'
-- with nav_code. A role's own rows replace the default (role_code NULL) whole; a company's rows replace the built-in ones.
CREATE TABLE IF NOT EXISTS ui_bottom_bar (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id    INTEGER REFERENCES org_companies (id),
  role_code     TEXT    CHECK (role_code IS NULL OR length(role_code) BETWEEN 1 AND 20),
  slot          INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 4),
  item          TEXT    NOT NULL CHECK (item IN ('home', 'work', 'scan', 'messages', 'page')),
  nav_code      TEXT    REFERENCES ui_navigation_entries (code),
  label         TEXT,
  label_hi      TEXT,
  label_te      TEXT,
  icon          TEXT,
  project_id    INTEGER,
  site_id       INTEGER,
  created_by    TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by    TEXT,
  updated_at    TEXT,
  version       INTEGER NOT NULL DEFAULT 1,
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at    TEXT,
  deleted_by    TEXT,
  source_type   TEXT,
  source_id     TEXT,
  remarks       TEXT,
  CHECK (item <> 'page' OR nav_code IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ui_bottom_bar_slot ON ui_bottom_bar (COALESCE(company_id, 0), COALESCE(role_code, ''), slot) WHERE deleted_at IS NULL;
INSERT OR IGNORE INTO ui_bottom_bar (company_id, role_code, slot, item, nav_code, label, label_hi, label_te, icon, created_by, source_type) VALUES
  (NULL, NULL, 1, 'home', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  (NULL, NULL, 2, 'work', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  (NULL, NULL, 3, 'scan', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  (NULL, NULL, 4, 'messages', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  -- the site and project managers decide on the phone: Approvals in place of My Work
  (NULL, 'CM', 1, 'home', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  (NULL, 'CM', 2, 'page', 'field-approvals', 'Approvals', 'स्वीकृतियाँ', 'ఆమోదాలు', 'erp.action.inbox', 'migration', 'reference_seed'),
  (NULL, 'CM', 3, 'scan', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  (NULL, 'CM', 4, 'messages', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  (NULL, 'PM', 1, 'home', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  (NULL, 'PM', 2, 'page', 'field-approvals', 'Approvals', 'स्वीकृतियाँ', 'ఆమోదాలు', 'erp.action.inbox', 'migration', 'reference_seed'),
  (NULL, 'PM', 3, 'scan', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed'),
  (NULL, 'PM', 4, 'messages', NULL, NULL, NULL, NULL, NULL, 'migration', 'reference_seed');

-- 5 ------------------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE ui_user_preferences_p16603 (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id          INTEGER NOT NULL REFERENCES org_companies (id),
  user_id             INTEGER REFERENCES iam_users (id),
  user_ref            TEXT    NOT NULL,
  theme               TEXT    NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'high-contrast')),
  density             TEXT    NOT NULL DEFAULT 'comfortable' CHECK (density IN ('comfortable', 'compact')),
  language            TEXT    NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'te')),
  start_page          TEXT,
  table_settings_json TEXT    NOT NULL DEFAULT '{}',
  project_id          INTEGER,
  site_id             INTEGER,
  created_by          TEXT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by          TEXT,
  updated_at          TEXT,
  version             INTEGER NOT NULL DEFAULT 1,
  is_active           INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  deleted_at          TEXT,
  deleted_by          TEXT,
  source_type         TEXT,
  source_id           TEXT,
  remarks             TEXT
);
INSERT INTO ui_user_preferences_p16603 SELECT * FROM ui_user_preferences;
DROP TABLE ui_user_preferences;
ALTER TABLE ui_user_preferences_p16603 RENAME TO ui_user_preferences;
CREATE UNIQUE INDEX ux_ui_user_preferences_person ON ui_user_preferences (company_id, user_ref);
CREATE INDEX ix_ui_user_preferences_user ON ui_user_preferences (user_id);

CREATE TABLE ui_translations_p16603 (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES org_companies (id),
  namespace   TEXT    NOT NULL CHECK (namespace GLOB '[a-z]*' AND length(namespace) <= 40),
  msg_key     TEXT    NOT NULL CHECK (length(msg_key) BETWEEN 1 AND 120),
  lang        TEXT    NOT NULL CHECK (lang IN ('en', 'hi', 'te')),
  text        TEXT    NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
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
INSERT INTO ui_translations_p16603 SELECT * FROM ui_translations;
DROP TABLE ui_translations;
ALTER TABLE ui_translations_p16603 RENAME TO ui_translations;
CREATE UNIQUE INDEX ux_ui_translations_key ON ui_translations (company_id, namespace, msg_key, lang);
CREATE INDEX ix_ui_translations_lang ON ui_translations (company_id, lang, namespace);
