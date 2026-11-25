DELETE FROM ui_page_migration WHERE page_code = 'help.documentation' AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code = 'help-documentation' AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code IN ('man.manual.review', 'man.package.ready', 'man.drift.flagged') AND source_type = 'reference_seed';
DROP TABLE IF EXISTS man_manuals;
DROP TABLE IF EXISTS man_packages;
DROP TABLE IF EXISTS man_screens;
DROP TABLE IF EXISTS man_captures;
DELETE FROM core_feature_flags WHERE key = 'ff.qa.p3009' AND source_type = 'reference_seed';
