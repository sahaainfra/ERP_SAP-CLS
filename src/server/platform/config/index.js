import { z } from 'zod';

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

const schema = z.object({
  NODE_ENV: z.enum(ENVIRONMENTS),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1),
  ERP_ENVIRONMENT: z.enum(ENVIRONMENTS).optional(),
  AUTH_MODE: z.enum(['dev-headers', 'iam']).default('dev-headers'),
  ERP_DEMO_SEED: z.enum(['true', 'false']).default('false'),
  STORAGE_PATH: z.string().min(1).optional(),
  HEALTH_TOKEN: z.string().min(16, 'must be at least 16 characters').optional(),
  FILE_URL_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  VAULT_KEY: z.string().min(32, 'must be at least 32 characters').optional(),
  AUTH_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
  CLAMAV_HOST: z.string().min(1).optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
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
    storagePath: c.STORAGE_PATH ?? null,
    healthToken: c.HEALTH_TOKEN ?? null,
    fileUrlSecret: c.FILE_URL_SECRET ?? null,
    vaultKey: c.VAULT_KEY ?? null,
    authSecret: c.AUTH_SECRET ?? null,
    clamav: c.CLAMAV_HOST ? { host: c.CLAMAV_HOST, port: c.CLAMAV_PORT } : null,
  };
  const prodLike = nodeEnv === 'production' || nodeEnv === 'staging';
  if (config.demoSeed && prodLike) {
    problems.push(
      `ERP_DEMO_SEED=true is not allowed when NODE_ENV=${nodeEnv}: demo data must never be loaded into staging or production. Set ERP_DEMO_SEED=false.`,
    );
  }
  if (config.authMode === 'dev-headers' && prodLike) {
    problems.push(
      `AUTH_MODE=dev-headers is not allowed when NODE_ENV=${nodeEnv}: it trusts client-supplied identity headers. The IAM module (part 02.x) must provide AUTH_MODE=iam first.`,
    );
  }
  if (config.authMode === 'iam' && !config.authSecret && prodLike) {
    problems.push(`AUTH_SECRET is required when AUTH_MODE=iam and NODE_ENV=${nodeEnv}: it signs the sign-in tokens and must be the same on every instance (at least 32 characters).`);
  }
  if (prodLike && !config.fileUrlSecret) {
    problems.push(`FILE_URL_SECRET is required when NODE_ENV=${nodeEnv}: it signs the short-lived download links and must be the same on every instance (at least 32 characters).`);
  }
  if (prodLike && !config.vaultKey) {
    problems.push(`VAULT_KEY is required when NODE_ENV=${nodeEnv}: it encrypts the credentials of external connectors and must be the same on every instance (at least 32 characters). Losing it makes the stored credentials unreadable.`);
  }
  if (config.databasePath === ':memory:' && nodeEnv !== 'test') {
    problems.push('DATABASE_PATH=:memory: is only allowed when NODE_ENV=test.');
  }
  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}

export { ENVIRONMENTS };
