// Runs the unit and API tests with coverage; writes coverage/lcov.info for the coverage gate.
import { mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'coverage'), { recursive: true });
const r = spawnSync(
  process.execPath,
  [
    '--test',
    '--experimental-test-coverage',
    '--test-coverage-include=src/server/**',
    '--test-coverage-include=scripts/lib/**',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=lcov',
    '--test-reporter-destination=coverage/lcov.info',
    ...(process.env.ERP_TEST_GLOB ? [process.env.ERP_TEST_GLOB] : ['tests/*.test.js']),
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } },
);
process.exit(r.status ?? 1);
