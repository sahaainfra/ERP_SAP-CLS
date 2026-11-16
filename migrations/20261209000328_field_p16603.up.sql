-- Part 166.3: the mobile site app for site teams, and Telugu.
--  1. the feature flag ff.field.p16603 (OFF by default; ON in development and test);
--  2. Telugu labels: label_te on the navigation registry and on the field tiles (FR-07);
--  3. the field tiles by role (FR-01): role_codes (comma list; NULL = every role), and feature_flag / retired_flag so the new tiles show and the
--     old sample tiles hide only while ff.field.p16603 is ON;
--  4. ui_bottom_bar: the bottom bar of a phone per role (FR-02);
--  5. ui_user_preferences and ui_translations rebuilt so that their language may be 'te' (no table references either; rows, ids and indexes kept).

-- 1 ------------------------------------------------------------------------------------------------------------------------------------------
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) VALUES ('ff.field.p16603', 'Mobile site app: role field home, bottom bar by role, one-hand forms, photo stamp, voice notes and Telugu (part 166.3)', 0, NULL, 0, 'migration', 'reference_seed');
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, environment, enabled, created_by, source_type) SELECT 'ff.field.p16603', 'Mobile site app: role field home, bottom bar by role, one-hand forms, photo stamp, voice notes and Telugu (part 166.3)', 0, env.name, 1, 'migration', 'reference_seed' FROM (SELECT 'development' AS name UNION ALL SELECT 'test') AS env;

-- 2 ------------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE ui_navigation_entries ADD COLUMN label_te TEXT; -- no column check, so that the down migration can drop it
ALTER TABLE ui_field_tiles ADD COLUMN label_te TEXT;
ALTER TABLE ui_field_tiles ADD COLUMN role_codes TEXT;
ALTER TABLE ui_field_tiles ADD COLUMN feature_flag TEXT;
ALTER TABLE ui_field_tiles ADD COLUMN retired_flag TEXT;
ALTER TABLE ui_field_tiles ADD COLUMN tone TEXT; -- navy, amber, green, blue, red or teal

UPDATE ui_navigation_entries SET label_te = CASE code
  WHEN 'g-home' THEN 'హోమ్' WHEN 'g-mywork' THEN 'నా పని' WHEN 'g-projects' THEN 'ప్రాజెక్టులు' WHEN 'g-engineering' THEN 'ఇంజనీరింగ్' WHEN 'g-planning' THEN 'ప్రణాళిక'
  WHEN 'g-site' THEN 'సైట్' WHEN 'g-procurement' THEN 'కొనుగోలు' WHEN 'g-stores' THEN 'స్టోర్స్' WHEN 'g-plant' THEN 'యంత్రాలు' WHEN 'g-rmc' THEN 'బ్యాచింగ్ ప్లాంట్'
  WHEN 'g-quality' THEN 'నాణ్యత' WHEN 'g-hse' THEN 'భద్రత (HSE)' WHEN 'g-contracts' THEN 'కాంట్రాక్టులు మరియు బిల్లింగ్' WHEN 'g-hr' THEN 'HR మరియు జీతాలు' WHEN 'g-reports' THEN 'నివేదికలు'
  WHEN 'g-messages' THEN 'సందేశాలు' WHEN 'g-account' THEN 'ఖాతా'
  WHEN 'home' THEN 'హోమ్' WHEN 'work' THEN 'నా పని' WHEN 'profile' THEN 'నా ప్రొఫైల్' WHEN 'messages' THEN 'సందేశాలు' WHEN 'notifications' THEN 'నోటిఫికేషన్లు'
  WHEN 'approvals-inbox' THEN 'నా ఆమోదాలు' WHEN 'tasks-my' THEN 'నా పనులు' WHEN 'account-drafts' THEN 'నా డ్రాఫ్ట్‌లు'
  WHEN 'field-home' THEN 'ఫీల్డ్ హోమ్' WHEN 'field-scan' THEN 'స్కాన్' WHEN 'field-approvals' THEN 'ఆమోదాలు (ఫోన్)' WHEN 'field-forms' THEN 'ఫీల్డ్ ఫారాలు' WHEN 'field-sync' THEN 'సింక్ స్థితి' WHEN 'field-conflicts' THEN 'విభేదాల పరిష్కారం'
  WHEN 'site-dpr-entry' THEN 'రోజువారీ ప్రగతి నివేదిక (DPR)' WHEN 'site-dprs' THEN 'DPR రిజిస్టర్' WHEN 'proc-mr-new' THEN 'కొత్త మెటీరియల్ అభ్యర్థన' WHEN 'qa-ir-raise' THEN 'తనిఖీ అభ్యర్థన'
  WHEN 'att-crew-punch' THEN 'గ్యాంగ్ హాజరు' WHEN 'att-today' THEN 'ఈ రోజు హాజరు' WHEN 'att-punch' THEN 'పంచ్ ఇన్/అవుట్' WHEN 'hse-toolbox' THEN 'టూల్‌బాక్స్ టాక్'
  WHEN 'plant-log-entry' THEN 'యంత్రాల రోజువారీ లాగ్' WHEN 'plant-fuel-issue' THEN 'ఇంధనం ఇవ్వడం' WHEN 'inv-gate-entry' THEN 'గేట్ ఎంట్రీ' WHEN 'inv-grn-new' THEN 'GRN సృష్టించండి'
  WHEN 'inv-issue-new' THEN 'మెటీరియల్ ఇవ్వడం' WHEN 'inv-blind-count' THEN 'స్టాక్ లెక్కింపు' WHEN 'inv-transfer-new' THEN 'బదిలీ అభ్యర్థన' WHEN 'qa-perform' THEN 'తనిఖీ చేయండి'
  WHEN 'qa-cubes' THEN 'క్యూబ్ రిజిస్టర్' WHEN 'qa-ncr-raise' THEN 'NCR నమోదు' WHEN 'hse-observation' THEN 'భద్రతా పరిశీలన' WHEN 'hse-permit-request' THEN 'వర్క్ పర్మిట్ అభ్యర్థన'
  WHEN 'hse-incident-report' THEN 'ప్రమాదం నివేదించండి'
  END
WHERE code IN ('g-home', 'g-mywork', 'g-projects', 'g-engineering', 'g-planning', 'g-site', 'g-procurement', 'g-stores', 'g-plant', 'g-rmc', 'g-quality', 'g-hse', 'g-contracts', 'g-hr', 'g-reports', 'g-messages', 'g-account',
  'home', 'work', 'profile', 'messages', 'notifications', 'approvals-inbox', 'tasks-my', 'account-drafts', 'field-home', 'field-scan', 'field-approvals', 'field-forms', 'field-sync', 'field-conflicts',
  'site-dpr-entry', 'site-dprs', 'proc-mr-new', 'qa-ir-raise', 'att-crew-punch', 'att-today', 'att-punch', 'hse-toolbox', 'plant-log-entry', 'plant-fuel-issue', 'inv-gate-entry', 'inv-grn-new',
  'inv-issue-new', 'inv-blind-count', 'inv-transfer-new', 'qa-perform', 'qa-cubes', 'qa-ncr-raise', 'hse-observation', 'hse-permit-request', 'hse-incident-report');

-- 3 ------------------------------------------------------------------------------------------------------------------------------------------
-- the 03.06 tiles: the sample "Material Request" and the administrators' approvals give way to the real daily tasks while the part is ON
UPDATE ui_field_tiles SET retired_flag = 'ff.field.p16603' WHERE code IN ('material-request', 'approvals') AND source_type = 'reference_seed';
UPDATE ui_field_tiles SET label_te = 'స్కాన్' WHERE code = 'scan' AND source_type = 'reference_seed';
UPDATE ui_field_tiles SET label_te = 'నా డ్రాఫ్ట్‌లు' WHERE code = 'drafts' AND source_type = 'reference_seed';
-- a tile shows when its page is in the person's menu (permission and flag) and, if it names roles, the person holds one of them
INSERT OR IGNORE INTO ui_field_tiles (code, nav_code, label, label_hi, label_te, sort_order, role_codes, feature_flag, tone, created_by, source_type) VALUES
  ('dpr', 'site-dpr-entry', 'Daily progress report', 'दैनिक प्रगति रिपोर्ट', 'రోజువారీ ప్రగతి నివేదిక', 1, 'SE,CSUP,WSUP,CM,PM', 'ff.field.p16603', 'amber', 'migration', 'reference_seed'),
  ('phone-approvals', 'field-approvals', 'Approvals', 'स्वीकृतियाँ', 'ఆమోదాలు', 2, NULL, 'ff.field.p16603', 'navy', 'migration', 'reference_seed'),
  ('dpr-register', 'site-dprs', 'DPRs to approve', 'स्वीकृति हेतु DPR', 'ఆమోదించవలసిన DPR లు', 3, 'CM,PM,PD', 'ff.field.p16603', 'blue', 'migration', 'reference_seed'),
  ('crew-attendance', 'att-crew-punch', 'Gang attendance', 'गैंग हाज़िरी', 'గ్యాంగ్ హాజరు', 4, 'CSUP,WSUP,SE', 'ff.field.p16603', 'green', 'migration', 'reference_seed'),
  ('my-punch', 'att-punch', 'My punch', 'मेरा पंच', 'నా పంచ్', 30, NULL, 'ff.field.p16603', 'teal', 'migration', 'reference_seed'),
  ('mr-new', 'proc-mr-new', 'Material request', 'सामग्री अनुरोध', 'మెటీరియల్ అభ్యర్థన', 10, 'SE,SK,STOREMGR', 'ff.field.p16603', 'blue', 'migration', 'reference_seed'),
  ('ir-new', 'qa-ir-raise', 'Inspection request', 'निरीक्षण अनुरोध', 'తనిఖీ అభ్యర్థన', 11, 'SE', 'ff.field.p16603', 'blue', 'migration', 'reference_seed'),
  ('toolbox', 'hse-toolbox', 'Toolbox talk', 'टूलबॉक्स टॉक', 'టూల్‌బాక్స్ టాక్', 12, 'CSUP,WSUP,HSEE,HSEO', 'ff.field.p16603', 'green', 'migration', 'reference_seed'),
  ('equipment-log', 'plant-log-entry', 'Equipment log', 'उपकरण लॉग', 'యంత్రాల లాగ్', 5, 'PMSUP,PLANTMGR', 'ff.field.p16603', 'amber', 'migration', 'reference_seed'),
  ('fuel-issue', 'plant-fuel-issue', 'Fuel issue', 'ईंधन निकासी', 'ఇంధనం ఇవ్వడం', 13, 'PMSUP,SK', 'ff.field.p16603', 'teal', 'migration', 'reference_seed'),
  ('gate-entry', 'inv-gate-entry', 'Gate entry', 'गेट प्रवेश', 'గేట్ ఎంట్రీ', 6, 'SK,STOREMGR', 'ff.field.p16603', 'navy', 'migration', 'reference_seed'),
  ('grn', 'inv-grn-new', 'GRN', 'GRN', 'GRN', 7, 'SK,STOREMGR', 'ff.field.p16603', 'amber', 'migration', 'reference_seed'),
  ('issue-slip', 'inv-issue-new', 'Issue slip', 'निकासी पर्ची', 'ఇష్యూ స్లిప్', 14, 'SK,STOREMGR', 'ff.field.p16603', 'blue', 'migration', 'reference_seed'),
  ('stock-count', 'inv-blind-count', 'Stock count', 'स्टॉक गिनती', 'స్టాక్ లెక్కింపు', 15, 'SK,STOREMGR', 'ff.field.p16603', 'green', 'migration', 'reference_seed'),
  ('transfer', 'inv-transfer-new', 'Transfer', 'स्थानांतरण', 'బదిలీ', 16, 'SK,STOREMGR', 'ff.field.p16603', 'teal', 'migration', 'reference_seed'),
  ('inspection', 'qa-perform', 'Checklist inspection', 'चेकलिस्ट निरीक्षण', 'చెక్‌లిస్ట్ తనిఖీ', 8, 'QCE,QCMGR', 'ff.field.p16603', 'amber', 'migration', 'reference_seed'),
  ('cubes', 'qa-cubes', 'Cube register', 'क्यूब रजिस्टर', 'క్యూబ్ రిజిస్టర్', 17, 'QCE', 'ff.field.p16603', 'blue', 'migration', 'reference_seed'),
  ('ncr', 'qa-ncr-raise', 'NCR with photos', 'फ़ोटो सहित NCR', 'ఫోటోలతో NCR', 18, 'QCE,QCMGR', 'ff.field.p16603', 'red', 'migration', 'reference_seed'),
  ('observation', 'hse-observation', 'Safety observation', 'सुरक्षा अवलोकन', 'భద్రతా పరిశీలన', 9, 'HSEE,HSEO,SE,CSUP,WSUP', 'ff.field.p16603', 'amber', 'migration', 'reference_seed'),
  ('permit', 'hse-permit-request', 'Permit to work', 'कार्य परमिट', 'వర్క్ పర్మిట్', 19, 'HSEE,HSEO,SE', 'ff.field.p16603', 'navy', 'migration', 'reference_seed'),
  ('incident', 'hse-incident-report', 'Incident', 'घटना', 'ప్రమాదం', 20, 'HSEE,HSEO', 'ff.field.p16603', 'red', 'migration', 'reference_seed');

-- 4 ------------------------------------------------------------------------------------------------------------------------------------------
-- slot 1-4 of the phone's bottom bar (More is always the fifth). item: 'home' (the person's home), 'work' (My Work), 'scan', 'messages', or 'page'
-- with nav_code. A role's own rows replace the default (role_code NULL) whole; a company's rows replace the built-in ones.
CREATE TABLE ui_bottom_bar (
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
CREATE UNIQUE INDEX ux_ui_bottom_bar_slot ON ui_bottom_bar (COALESCE(company_id, 0), COALESCE(role_code, ''), slot) WHERE deleted_at IS NULL;
INSERT INTO ui_bottom_bar (company_id, role_code, slot, item, nav_code, label, label_hi, label_te, icon, created_by, source_type) VALUES
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
