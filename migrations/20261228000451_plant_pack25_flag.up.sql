-- PACK-25: the cost of a machine reaches the project actual cost (12.03) through plant.cost.posted: a closed job card (repair, and for a
-- breakdown the hours lost at the owning cost per hour) and an internal hire charge. Off by default. ADR-787.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.plant.pack25', 'Repair, downtime and internal hire cost to the project actual cost (PACK-25)', 0, 0, 'migration', 'reference_seed');
