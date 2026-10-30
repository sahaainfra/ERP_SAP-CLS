// Usage: node scripts/migrate.mjs up | down [steps]
import { loadConfig } from '../src/server/platform/config/index.js';
import { migrateDown, migrateUp, openDatabase } from '../src/server/platform/db/index.js';

const [direction = 'up', steps = '1'] = process.argv.slice(2);
const config = loadConfig();
const db = openDatabase(config.databasePath);
if (direction === 'up') {
  const applied = migrateUp(db);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply.');
} else if (direction === 'down') {
  const reverted = migrateDown(db, Number.parseInt(steps, 10));
  console.log(reverted.length ? `Reverted: ${reverted.join(', ')}` : 'Nothing to revert.');
} else {
  console.error('Usage: migrate.mjs up | down [steps]');
  process.exit(2);
}
