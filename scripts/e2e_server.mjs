// Starts the API on a fresh database for the E2E run (deletes the previous e2e database first).
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const database = process.env.DATABASE_PATH ?? 'data/e2e.sqlite'; // the one the run names, so a second run can use its own file
for (const suffix of ['', '-wal', '-shm']) rmSync(join(root, `${database}${suffix}`), { force: true });
await import('../src/server/index.js');
