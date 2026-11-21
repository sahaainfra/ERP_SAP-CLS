DELETE FROM proj_360_widgets WHERE widget_code IN ('bi.dso','bi.stock_turns','bi.ltifr') AND company_id IS NULL AND source_type = 'reference_seed';
DELETE FROM ui_widgets WHERE code IN ('bi.dso','bi.stock_turns','bi.ltifr') AND source_type = 'reference_seed';
