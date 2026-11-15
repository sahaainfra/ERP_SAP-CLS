import './platform/runtime/node-check.js';
import { loadConfig, ConfigError } from './platform/config/index.js';
import { openDatabase, migrateUp } from './platform/db/index.js';
import { createApp } from './app.js';
import { startWorkers } from './platform/runtime/index.js';

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

const app = createApp({ config, db });
app.listen(config.port, () => {
  console.log(`ERP API listening on http://localhost:${config.port} (${config.environment})`);
});
startWorkers(db, { intervalMs: 1000 });
