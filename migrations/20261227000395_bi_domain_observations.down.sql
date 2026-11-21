DELETE FROM ntf_templates WHERE code = 'bi.domain_metric.decided' AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_widgets WHERE code IN ('bi.spi','bi.cpi','bi.eac','bi.gross_margin') AND source_type = 'reference_seed';
DELETE FROM proj_360_widgets WHERE widget_code IN ('bi.spi','bi.cpi','bi.eac','bi.gross_margin') AND company_id IS NULL AND source_type = 'reference_seed';
DROP TABLE IF EXISTS bi_domain_observations;
DROP TABLE IF EXISTS bi_domain_refreshes;
