// Starts the API on a fresh database for the E2E run (deletes the previous e2e database first).
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
for (const suffix of ['', '-wal', '-shm']) rmSync(join(root, `data/e2e.sqlite${suffix}`), { force: true });
await import('../src/server/index.js');
