import { z } from 'zod';

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

const schema = z.object({
  NODE_ENV: z.enum(ENVIRONMENTS),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1),
  ERP_ENVIRONMENT: z.enum(ENVIRONMENTS).optional(),
  AUTH_MODE: z.enum(['dev-headers', 'iam']).default('dev-headers'),
  ERP_DEMO_SEED: z.enum(['true', 'false']).default('false'),
  // part 30.04: the simulation sandbox (its own database; nothing leaves it)
  ERP_SANDBOX: z.enum(['true', 'false']).default('false'),
  STORAGE_PATH: z.string().min(1).optional(),
  HEALTH_TOKEN: z.string().min(16, 'must be at least 16 characters').optional(),
  FILE_URL_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  PUBLIC_URL: z.string().url('must be a web address such as https://erp.example.com').optional(),
  VAULT_KEY: z.string().min(32, 'must be at least 32 characters').optional(),
  // part 29.06: the second location backups are copied to (another disk, mount or region), and the key their copies are encrypted with
  BACKUP_OFFSITE_DIR: z.string().min(1).optional(),
  BACKUP_KEY: z.string().min(32, 'must be at least 32 characters').optional(),
  AUTH_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  APP_URL: z.string().url('must be a full URL such as https://erp.example.com').optional(),
  CLAMAV_HOST: z.string().min(1).optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  PUSH_VAPID_PUBLIC_KEY: z.string().regex(/^[A-Za-z0-9_-]{86,90}$/, 'must be the public VAPID key (65 bytes, base64url)').optional(),
  PUSH_VAPID_PRIVATE_KEY: z.string().regex(/^[A-Za-z0-9_-]{42,46}$/, 'must be the private VAPID key (32 bytes, base64url)').optional(),
  PUSH_SUBJECT: z.string().min(8).optional(),
});

export class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** Validate environment variables; throws ConfigError listing every problem (fail fast). */
export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  const problems = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const name = issue.path.join('.');
      const missing = env[name] === undefined;
      problems.push(`${name}: ${missing ? 'is required but not set' : issue.message}. See .env.example.`);
    }
    throw new ConfigError(problems);
  }
  const c = parsed.data;
  const nodeEnv = c.NODE_ENV;
  const config = {
    nodeEnv,
    environment: c.ERP_ENVIRONMENT ?? nodeEnv,
    port: c.PORT,
    databasePath: c.DATABASE_PATH,
    authMode: c.AUTH_MODE,
    demoSeed: c.ERP_DEMO_SEED === 'true',
    sandbox: c.ERP_SANDBOX === 'true',
    storagePath: c.STORAGE_PATH ?? null,
    healthToken: c.HEALTH_TOKEN ?? null,
    fileUrlSecret: c.FILE_URL_SECRET ?? null,
    publicUrl: c.PUBLIC_URL ?? null,
    vaultKey: c.VAULT_KEY ?? null,
    backupOffsiteDir: c.BACKUP_OFFSITE_DIR ?? null,
    backupKey: c.BACKUP_KEY ?? null,
    authSecret: c.AUTH_SECRET ?? null,
    appUrl: (c.APP_URL ?? '').replace(/\/+$/, '') || null,
    clamav: c.CLAMAV_HOST ? { host: c.CLAMAV_HOST, port: c.CLAMAV_PORT } : null,
    // Web Push (part 03.06): the application's VAPID key pair; without it a production system offers no push, development makes its own
    push: c.PUSH_VAPID_PUBLIC_KEY && c.PUSH_VAPID_PRIVATE_KEY ? { publicKey: c.PUSH_VAPID_PUBLIC_KEY, privateKey: c.PUSH_VAPID_PRIVATE_KEY, subject: c.PUSH_SUBJECT ?? c.APP_URL ?? 'mailto:admin@example.com' } : null,
  };
  // Audit AUD-DEF-007: an installation is production-like when NODE_ENV or the environment it calls itself (ERP_ENVIRONMENT) is staging
  // or production, so NODE_ENV=test with ERP_ENVIRONMENT=production does not slip past the checks below.
  const prodLike = [nodeEnv, config.environment].some((e) => e === 'production' || e === 'staging');
  const where = ['production', 'staging'].includes(nodeEnv) ? `when NODE_ENV=${nodeEnv}` : `when ERP_ENVIRONMENT=${config.environment}`;
  if (config.demoSeed && prodLike) {
    problems.push(
      `ERP_DEMO_SEED=true is not allowed ${where}: demo data must never be loaded into staging or production. Set ERP_DEMO_SEED=false.`,
    );
  }
  // part 30.04 BR-01: a sandbox never runs on production data: not in production, and only on a database of its own named as one
  if (config.sandbox && (nodeEnv === 'production' || config.environment === 'production')) problems.push(`ERP_SANDBOX=true is not allowed ${nodeEnv === 'production' ? 'when NODE_ENV=production' : 'when ERP_ENVIRONMENT=production'}: the sandbox runs on its own installation with synthetic data.`);
  if (config.sandbox && config.databasePath !== ':memory:' && !/sandbox/i.test(config.databasePath)) problems.push(`ERP_SANDBOX=true needs a database of its own whose file name says so (for example data/sandbox.sqlite); DATABASE_PATH is ${config.databasePath}.`);
  if (config.authMode === 'dev-headers' && prodLike) {
    problems.push(
      `AUTH_MODE=dev-headers is not allowed ${where} (NODE_ENV=${nodeEnv}, ERP_ENVIRONMENT=${config.environment}): it trusts client-supplied identity headers. Set AUTH_MODE=iam.`,
    );
  }
  if (config.authMode === 'iam' && !config.authSecret && prodLike) {
    problems.push(`AUTH_SECRET is required when AUTH_MODE=iam ${where}: it signs the sign-in tokens and must be the same on every instance (at least 32 characters).`);
  }
  if (prodLike && !config.fileUrlSecret) {
    problems.push(`FILE_URL_SECRET is required ${where}: it signs the short-lived download links and must be the same on every instance (at least 32 characters).`);
  }
  if (prodLike && !config.vaultKey) {
    problems.push(`VAULT_KEY is required ${where}: it encrypts the credentials of external connectors and must be the same on every instance (at least 32 characters). Losing it makes the stored credentials unreadable.`);
  }
  if (Boolean(c.PUSH_VAPID_PUBLIC_KEY) !== Boolean(c.PUSH_VAPID_PRIVATE_KEY)) {
    problems.push('PUSH_VAPID_PUBLIC_KEY and PUSH_VAPID_PRIVATE_KEY must be set together.');
  }
  if (config.databasePath === ':memory:' && nodeEnv !== 'test') {
    problems.push('DATABASE_PATH=:memory: is only allowed when NODE_ENV=test.');
  }
  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}

export { ENVIRONMENTS };
