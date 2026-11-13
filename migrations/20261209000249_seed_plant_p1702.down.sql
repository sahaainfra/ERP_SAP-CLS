DELETE FROM ntf_templates WHERE code IN ('plant.requisition.decided','plant.allocation.decided','plant.allocation.moved','plant.operator.blocked') AND source_type = 'reference_seed';
DELETE FROM ui_page_migration WHERE migrated_in_part = '17.02';
DELETE FROM ui_navigation_entries WHERE code IN ('plant-requisitions','plant-requisition-new','plant-allocations','plant-allocation-new','plant-gantt');
DELETE FROM core_feature_flags WHERE key = 'ff.plant.p1702';
