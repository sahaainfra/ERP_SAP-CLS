import { loadConfig, ConfigError } from './config.js';
import { openDatabase, migrateUp } from './db.js';
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
