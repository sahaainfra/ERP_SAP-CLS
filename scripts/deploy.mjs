// Usage: node scripts/deploy.mjs --env <name> --artifact <dir> --port <n> [--root .deploy] [--install] [--blue-green] [--rehearsal] [--node-env <e>]
// For --env staging or production the release starts live (NODE_ENV of the environment, AUTH_MODE=iam, secrets from this shell, the
// smoke test signs in with ERP_SMOKE_TOKEN) unless --rehearsal is given, which starts it with NODE_ENV=test and the development headers.
// With --blue-green (part 30.08) the artefact goes to the idle slot (port, or port + 1) and the proxy is switched to it with no downtime.
// Deploys an artefact into <root>/<env>/releases/<buildId>; see docs/erp/RELEASE.md.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy } from './lib/deploy.mjs';
import { deployBlueGreen } from './lib/bluegreen.mjs';
import { defaultNodeEnv } from './lib/release_env.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const envName = opt('env');
const artifact = opt('artifact');
if (!envName || !artifact) {
  console.error('Usage: deploy.mjs --env <name> --artifact <dir> --port <n> [--root .deploy] [--install]');
  process.exit(2);
}
if (args.includes('--blue-green')) {
  const r = await deployBlueGreen({ artifactDir: resolve(artifact), envName, deployRoot: resolve(repo, opt('root', '.deploy')), basePort: Number(opt('port', '3301')), nodeEnv: opt('node-env', defaultNodeEnv(envName, args)), log: (m) => console.log(`  ${m}`) });
  console.log(r.ok ? `Deployed ${r.buildId} to the ${r.slot} slot of ${envName} and switched at ${r.switchedAt} (${r.durationMs} ms).` : `Deploy FAILED; ${r.kept ?? 'nothing'} keeps serving (${r.reason}; migrations ${r.undone}).`);
  process.exit(r.ok ? 0 : 1);
}
const r = await deploy({
  artifactDir: resolve(artifact),
  envName,
  deployRoot: resolve(repo, opt('root', '.deploy')),
  port: Number(opt('port', '3300')),
  nodeEnv: opt('node-env', defaultNodeEnv(envName, args)),
  installDeps: args.includes('--install'),
  log: (m) => console.log(`  ${m}`),
});
console.log(r.ok ? `Deployed ${r.buildId} to ${envName} in ${r.durationMs} ms. Smoke test passed.` : `Deploy FAILED and was rolled back (${r.method}): ${r.reason}`);
process.exit(r.ok ? 0 : 1);
