// Usage: node scripts/rollback.mjs --env <name> [--root .deploy] [--blue-green] [--rehearsal] [--node-env <e>]
// staging and production roll back live (as scripts/deploy.mjs) unless --rehearsal.
// With --blue-green (part 30.08) the environment is a blue-green pair behind the proxy: the previous slot is switched back to with no downtime.
// One-command rollback to the previous build; the database goes back through down-migrations,
// or through the restore point if those fail.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollback } from './lib/deploy.mjs';
import { rollbackBlueGreen } from './lib/bluegreen.mjs';
import { defaultNodeEnv } from './lib/release_env.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const envName = opt('env');
if (!envName) {
  console.error('Usage: rollback.mjs --env <name> [--root .deploy]');
  process.exit(2);
}
if (args.includes('--blue-green')) {
  try {
    const r = await rollbackBlueGreen({ envName, deployRoot: resolve(repo, opt('root', '.deploy')), nodeEnv: opt('node-env', defaultNodeEnv(envName, args)), log: (m) => console.log(`  ${m}`) });
    console.log(`Switched ${envName} back to ${r.restored} on ${r.slot} in ${r.durationMs} ms (migrations: ${r.undone}).`);
    process.exit(0);
  } catch (err) { console.error(err.message); process.exit(1); }
}
try {
  const r = await rollback({ envName, deployRoot: resolve(repo, opt('root', '.deploy')), nodeEnv: opt('node-env', defaultNodeEnv(envName, args)), log: (m) => console.log(`  ${m}`) });
  console.log(`Rolled ${envName} back from ${r.from} to ${r.restored} via ${r.method} in ${r.durationMs} ms.`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
