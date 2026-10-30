// Demo/sandbox seed (FR-04). Never loaded in production: loadConfig() refuses ERP_DEMO_SEED=true there,
// and this script refuses to run unless the guard is explicitly set.
import { loadConfig, ConfigError } from '../src/server/platform/config/index.js';
import { migrateUp, openDatabase } from '../src/server/platform/db/index.js';
import { seedDemo } from '../seeds/demo/index.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
if (!config.demoSeed) {
  console.error('Refusing to load demo data: set ERP_DEMO_SEED=true (development or test only).');
  process.exit(1);
}
const db = openDatabase(config.databasePath);
migrateUp(db);
console.log(`Demo seed: ${seedDemo(db)} row(s) inserted.`);
