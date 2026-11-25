import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../../platform/config/index.js';

// Part 30.08 FR-01: environment parity. Every environment file of infra/environments names the same keys, carries no secret, differs from
// production only in the keys allowed to differ, and is accepted by the application's own configuration check (loadConfig) once the vault's
// secrets are added. Read by the Operations page and scripts/env_parity.mjs (CI).
export const ENV_DIR = 'infra/environments';
export const SECRET_KEYS = ['AUTH_SECRET', 'VAULT_KEY', 'FILE_URL_SECRET', 'HEALTH_TOKEN', 'BACKUP_KEY', 'PUSH_VAPID_PRIVATE_KEY'];
/** Keys that may differ between environments (everything else must be the same as production). */
export const MAY_DIFFER = ['NODE_ENV', 'ERP_ENVIRONMENT', 'AUTH_MODE', 'DATABASE_PATH', 'ERP_DEMO_SEED', 'ERP_SANDBOX', 'PUBLIC_URL', 'APP_URL', 'BACKUP_OFFSITE_DIR'];
export const parseEnv = (text) => Object.fromEntries(text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; }));

export function checkParity(root = process.cwd()) {
  try { readdirSync(join(root, ENV_DIR)); } catch { return { environments: [], keys: [], problems: ['infra/environments is not on this machine'], envs: {} }; }
  const dir = join(root, ENV_DIR);
  const envs = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.env')).map((f) => [f.replace(/\.env$/, ''), parseEnv(readFileSync(join(dir, f), 'utf8'))]));
  const problems = [];
  const prod = envs.production;
  if (!prod) problems.push('there is no production environment file');
  const keys = new Set(Object.values(envs).flatMap((e) => Object.keys(e)));
  for (const [name, e] of Object.entries(envs)) {
    for (const k of keys) if (!(k in e)) problems.push(`${name}: ${k} is missing (every environment names the same keys)`);
    for (const k of SECRET_KEYS) if (k in e) problems.push(`${name}: ${k} is a secret; it comes from the vault, never from a file`);
    if (prod) for (const k of Object.keys(e)) if (!MAY_DIFFER.includes(k) && e[k] !== prod[k]) problems.push(`${name}: ${k} differs from production (${e[k]} ≠ ${prod[k]}) and may not`);
    const expected = { dev: 'development', sandbox: 'development' }[name] ?? name; // the application knows four environments; a sandbox is a development installation
    if (e.ERP_ENVIRONMENT !== expected) problems.push(`${name}: ERP_ENVIRONMENT is ${e.ERP_ENVIRONMENT}, expected ${expected}`);
    // the application's own check, with stand-ins for the vault's secrets
    try { loadConfig({ ...e, AUTH_SECRET: 'x'.repeat(48), VAULT_KEY: 'k'.repeat(64), FILE_URL_SECRET: 'f'.repeat(48), HEALTH_TOKEN: 'h'.repeat(32), BACKUP_KEY: 'b'.repeat(64), PORT: '3000' }); } catch (err) { problems.push(`${name}: the application refuses this configuration: ${String(err.message).split('\n').slice(0, 3).join(' ')}`); }
  }
  return { environments: Object.keys(envs).sort(), keys: [...keys].sort(), problems, envs };
}

