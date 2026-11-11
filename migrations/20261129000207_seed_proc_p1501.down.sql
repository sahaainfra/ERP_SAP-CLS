DELETE FROM ntf_templates WHERE code IN ('proc.mr.approved','proc.mr.rejected','proc.pr.approved','proc.pr.rejected','proc.pr.emergency','proc.pr.overdue') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '15.01';
DELETE FROM ui_navigation_entries WHERE code IN ('proc-mr-new','proc-mrs','proc-prs','proc-consolidate');
DELETE FROM core_feature_flags WHERE key = 'ff.proc.p1501';
