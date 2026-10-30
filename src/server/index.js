import { loadConfig, ConfigError } from './platform/config/index.js';
import { openDatabase, migrateUp } from './platform/db/index.js';
import { createApp } from './app.js';

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

const db = openDatabase(config.databasePath);
const applied = migrateUp(db);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

createApp({ config, db }).listen(config.port, () => {
  console.log(`ERP API listening on http://localhost:${config.port} (${config.environment})`);
});
