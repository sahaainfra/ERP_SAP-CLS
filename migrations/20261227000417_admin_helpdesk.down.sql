DELETE FROM ui_page_migration WHERE page_code IN ('help.raise', 'admin.support') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('help-raise', 'admin-support') AND source_type = 'reference_seed';
DELETE FROM ntf_templates WHERE code IN ('hd.ticket.updated', 'hd.ticket.escalated') AND source_type = 'reference_seed';
DROP TABLE IF EXISTS hd_tour_views;
DROP TABLE IF EXISTS hd_articles;
DROP TABLE IF EXISTS hd_corrections;
DROP TABLE IF EXISTS hd_ticket_notes;
DROP TABLE IF EXISTS hd_tickets;
DELETE FROM core_feature_flags WHERE key = 'ff.admin.p2908' AND company_id IS NULL AND source_type = 'reference_seed';
