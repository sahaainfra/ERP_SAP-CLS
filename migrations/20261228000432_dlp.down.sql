DELETE FROM ntf_templates WHERE code IN ('dlp.complaint.overdue', 'dlp.period.ending') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE page_code IN ('close.dlp', 'close.dlp-period', 'close.dlp-complaints') AND source_type = 'reference_seed';
DELETE FROM ui_navigation_entries WHERE code IN ('close-dlp', 'close-dlp-complaints') AND source_type = 'reference_seed';
DROP TABLE IF EXISTS dlp_warranty_claims;
DROP TABLE IF EXISTS dlp_complaints;
DROP TABLE IF EXISTS dlp_periods;
