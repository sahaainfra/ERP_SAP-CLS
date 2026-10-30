// Usage: node scripts/deploy.mjs --env <name> --artifact <dir> --port <n> [--root .deploy] [--install]
// Deploys an artefact into <root>/<env>/releases/<buildId>; see docs/erp/RELEASE.md.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deploy } from './lib/deploy.mjs';

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
const r = await deploy({
  artifactDir: resolve(artifact),
  envName,
  deployRoot: resolve(repo, opt('root', '.deploy')),
  port: Number(opt('port', '3300')),
  nodeEnv: opt('node-env', 'test'),
  installDeps: args.includes('--install'),
  log: (m) => console.log(`  ${m}`),
});
console.log(r.ok ? `Deployed ${r.buildId} to ${envName} in ${r.durationMs} ms. Smoke test passed.` : `Deploy FAILED and was rolled back (${r.method}): ${r.reason}`);
process.exit(r.ok ? 0 : 1);
