// The environment a deployed release is started with (scripts/lib/deploy.mjs and scripts/lib/bluegreen.mjs).
// Audit AUD-DEF-007: a live start (NODE_ENV staging or production) signs people in (AUTH_MODE=iam) and takes its secrets from the
// environment of the deploying shell; a rehearsal (NODE_ENV test or development) uses the development headers and names itself after
// NODE_ENV, never "staging" or "production", because the configuration refuses development headers for an environment of that name.

export const LIVE = Object.freeze(['staging', 'production']);

/** Settings a live release needs from the deploying shell (values are never written to disk or logged). */
export const PASS_THROUGH = Object.freeze([
  'AUTH_SECRET', 'FILE_URL_SECRET', 'VAULT_KEY', 'HEALTH_TOKEN', 'PUBLIC_URL', 'APP_URL', 'STORAGE_PATH', 'CLAMAV_HOST', 'CLAMAV_PORT',
  'BACKUP_OFFSITE_DIR', 'BACKUP_KEY', 'PUSH_VAPID_PUBLIC_KEY', 'PUSH_VAPID_PRIVATE_KEY', 'PUSH_SUBJECT', 'REDIS_URL',
]);

const DEV_SMOKE = Object.freeze({ 'x-erp-user': 'smoke-test', 'x-erp-roles': 'ITADM', 'x-erp-company': '1' });

/** @param {{ nodeEnv: string, environment: string, port: number, dbPath: string, extra?: Record<string, string>, source?: NodeJS.ProcessEnv }} o */
export function releaseEnv({ nodeEnv, environment, port, dbPath, extra = {}, source = process.env }) {
  const live = LIVE.includes(nodeEnv);
  /** @type {Record<string, string | undefined>} */
  const env = {
    PATH: source.PATH,
    SystemRoot: source.SystemRoot,
    NODE_ENV: nodeEnv,
    ERP_ENVIRONMENT: live ? environment : nodeEnv,
    PORT: String(port),
    DATABASE_PATH: dbPath,
    AUTH_MODE: live ? 'iam' : 'dev-headers',
    ERP_DEMO_SEED: 'false',
    ...extra,
  };
  if (live) for (const k of PASS_THROUGH) if (source[k] !== undefined) env[k] = source[k];
  return env;
}

/** Headers of the post-deploy smoke test: a sign-in token on a live release (ERP_SMOKE_TOKEN), the development headers on a rehearsal. */
export function smokeHeaders(env, source = process.env) {
  if (env?.AUTH_MODE !== 'iam') return DEV_SMOKE;
  return source.ERP_SMOKE_TOKEN ? { authorization: `Bearer ${source.ERP_SMOKE_TOKEN}` } : null;
}

/** The NODE_ENV a CLI deploy uses when --node-env is not given: a live start for staging and production unless --rehearsal. */
export const defaultNodeEnv = (envName, args) => (LIVE.includes(envName) && !args.includes('--rehearsal') ? envName : 'test');
