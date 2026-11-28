-- PACK-26: concrete traceability shows each truck's batch (plant, mix, weights flag) and cube results; a cost period shows the cost per m3
-- against the budget per m3 and the cement drawn against the mix designs; a batching plant shows the downtime log of its machine. Off by default.
INSERT OR IGNORE INTO core_feature_flags (key, description, default_enabled, enabled, created_by, source_type)
VALUES ('ff.rmc.pack26', 'RMC batch-to-cube traceability, cost per m3 and cement against budget and mix, plant downtime log (PACK-26)', 0, 0, 'migration', 'reference_seed');
