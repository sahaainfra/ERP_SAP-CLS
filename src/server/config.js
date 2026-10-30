import { z } from 'zod';

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

const schema = z.object({
  NODE_ENV: z.enum(ENVIRONMENTS),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().min(1),
  ERP_ENVIRONMENT: z.enum(ENVIRONMENTS).optional(),
  AUTH_MODE: z.enum(['dev-headers', 'iam']).default('dev-headers'),
  ERP_DEMO_SEED: z.enum(['true', 'false']).default('false'),
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
  if (config.authMode === 'iam') {
    problems.push('AUTH_MODE=iam is not available yet: the IAM module (part 02.x) has not been built.');
  }
  if (config.databasePath === ':memory:' && nodeEnv !== 'test') {
    problems.push('DATABASE_PATH=:memory: is only allowed when NODE_ENV=test.');
  }
  if (problems.length) throw new ConfigError(problems);
  return Object.freeze(config);
}

export { ENVIRONMENTS };
