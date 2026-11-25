import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultNodeEnv, releaseEnv, smokeHeaders } from '../scripts/lib/release_env.mjs';
import { loadConfig } from '../src/server/platform/config/index.js';

// Audit AUD-DEF-007: the environment the deploy scripts start a release with.
const source = { PATH: '/bin', AUTH_SECRET: 'a'.repeat(40), FILE_URL_SECRET: 'f'.repeat(40), VAULT_KEY: 'v'.repeat(40), UNRELATED: 'x' };

test('BR-AUD-007 a live release signs people in, names its environment and takes its secrets from the deploying shell', () => {
  const env = releaseEnv({ nodeEnv: 'production', environment: 'production', port: 3300, dbPath: '/srv/erp.sqlite', source });
  assert.equal(env.AUTH_MODE, 'iam');
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.ERP_ENVIRONMENT, 'production');
  assert.equal(env.AUTH_SECRET, source.AUTH_SECRET);
  assert.equal(env.UNRELATED, undefined, 'only the listed settings pass through');
  assert.doesNotThrow(() => loadConfig(/** @type {any} */ (env)), 'the live environment passes the configuration checks');
  assert.equal(smokeHeaders(env, {}), null, 'no smoke token: the build cannot be confirmed');
  assert.deepEqual(smokeHeaders(env, { ERP_SMOKE_TOKEN: 't0k' }), { authorization: 'Bearer t0k' });
});

test('BR-AUD-007 a rehearsal uses the development headers and never calls itself staging or production', () => {
  const env = releaseEnv({ nodeEnv: 'test', environment: 'production', port: 3300, dbPath: '/tmp/x.sqlite', source });
  assert.equal(env.AUTH_MODE, 'dev-headers');
  assert.equal(env.ERP_ENVIRONMENT, 'test');
  assert.equal(env.AUTH_SECRET, undefined, 'a rehearsal gets no production secret');
  assert.doesNotThrow(() => loadConfig(/** @type {any} */ (env)));
  assert.equal(smokeHeaders(env)['x-erp-roles'], 'ITADM');
});

test('BR-AUD-007 the deploy command starts staging and production live unless --rehearsal', () => {
  assert.equal(defaultNodeEnv('production', []), 'production');
  assert.equal(defaultNodeEnv('staging', []), 'staging');
  assert.equal(defaultNodeEnv('production', ['--rehearsal']), 'test');
  assert.equal(defaultNodeEnv('uat', []), 'test');
});
