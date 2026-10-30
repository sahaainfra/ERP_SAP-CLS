import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from '../src/server/platform/config/index.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { seedDemo } from '../seeds/demo/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = { NODE_ENV: 'development', DATABASE_PATH: 'data/x.sqlite' };

test('fails fast and lists every missing variable', () => {
  assert.throws(() => loadConfig({}), (e) => e instanceof ConfigError && /NODE_ENV/.test(e.message) && /DATABASE_PATH/.test(e.message));
});

test('rejects an unknown environment value with a pointer to .env.example', () => {
  assert.throws(() => loadConfig({ ...base, NODE_ENV: 'prod' }), /\.env\.example/);
});

test('BR-02 production refuses the demo seed flag', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', DATABASE_PATH: 'x', ERP_DEMO_SEED: 'true', AUTH_MODE: 'iam' }),
    /ERP_DEMO_SEED=true is not allowed when NODE_ENV=production/,
  );
});

test('staging also refuses the demo seed, development allows it', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'staging', DATABASE_PATH: 'x', ERP_DEMO_SEED: 'true' }), /not allowed/);
  assert.equal(loadConfig({ ...base, ERP_DEMO_SEED: 'true' }).demoSeed, true);
});

test('dev-headers auth is refused outside development and test', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', DATABASE_PATH: 'x' }), /AUTH_MODE=dev-headers is not allowed/);
});

test('T-02 starting the server as production with the demo seed on exits non-zero with a clear message', () => {
  const r = spawnSync(process.execPath, ['src/server/index.js'], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'production', DATABASE_PATH: 'data/prod-test.sqlite', ERP_DEMO_SEED: 'true' },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ERP_DEMO_SEED=true is not allowed when NODE_ENV=production/);
});

test('the demo seed script refuses to run without the explicit guard', () => {
  const r = spawnSync(process.execPath, ['scripts/seed_demo.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_PATH: ':memory:' },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Refusing to load demo data/);
});

test('demo seed is idempotent and kept apart from reference seed rows', () => {
  const db = new DatabaseSync(':memory:');
  migrateUp(db);
  assert.ok(seedDemo(db) > 0);
  assert.equal(seedDemo(db), 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_feature_flags WHERE source_type = 'demo_seed'").get().n, 2);
});
