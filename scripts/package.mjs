// Usage: node scripts/package.mjs [--no-build]
// Builds the client (unless --no-build) and writes artifacts/<buildId>/ with build-info.json and SHA256SUMS.
// BUILD_ID (CI run number) and GIT_COMMIT can be supplied; otherwise they are derived.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArtifact } from './lib/package.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

if (!process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
let commit = process.env.GIT_COMMIT;
try {
  commit ??= git('rev-parse', '--short', 'HEAD');
} catch {
  commit ??= 'unknown';
}
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const buildId = process.env.BUILD_ID ?? `${stamp}-${commit}`;
const { dir, info } = createArtifact({ root, outRoot: join(root, 'artifacts'), buildId, version, commit });
console.log(`Packaged ${info.version} build ${info.buildId} (commit ${info.commit}) at ${dir}`);
