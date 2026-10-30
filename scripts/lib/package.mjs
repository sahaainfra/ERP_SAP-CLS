import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const INCLUDE = ['dist', 'src/server', 'migrations', 'scripts/migrate.mjs', 'package.json', 'package-lock.json'];

function listFiles(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** SHA256SUMS content for every file of a directory except SHA256SUMS itself. */
export function checksums(dir) {
  return `${listFiles(dir)
    .filter((f) => f !== 'SHA256SUMS')
    .map((f) => `${sha(join(dir, f))}  ${f}`)
    .join('\n')}\n`;
}

/** Re-check an artefact against its SHA256SUMS; returns problems (empty = intact, FR-07). */
export function verifyArtifact(dir) {
  const sums = join(dir, 'SHA256SUMS');
  if (!existsSync(sums)) return ['SHA256SUMS is missing'];
  if (!existsSync(join(dir, 'build-info.json'))) return ['build-info.json is missing'];
  const problems = [];
  const expected = new Map(
    readFileSync(sums, 'utf8').split('\n').filter(Boolean).map((l) => {
      const [hash, ...rest] = l.split('  ');
      return [rest.join('  '), hash];
    }),
  );
  for (const [file, hash] of expected) {
    if (!existsSync(join(dir, file))) problems.push(`missing file ${file}`);
    else if (sha(join(dir, file)) !== hash) problems.push(`checksum mismatch ${file}`);
  }
  for (const f of listFiles(dir)) if (f !== 'SHA256SUMS' && !expected.has(f)) problems.push(`unlisted file ${f}`);
  return problems;
}

export function writeSums(dir) {
  writeFileSync(join(dir, 'SHA256SUMS'), checksums(dir));
}

/**
 * Assemble a release artefact: client build, server, migrations, build-info.json and SHA256SUMS.
 * The same artefact is promoted through every environment (FR-07); only configuration differs.
 */
export function createArtifact({ root, outRoot, buildId, version, commit, requireClient = true }) {
  if (!/^[A-Za-z0-9._-]+$/.test(buildId)) throw new Error(`Invalid build ID "${buildId}"`);
  if (requireClient && !existsSync(join(root, 'dist', 'index.html'))) {
    throw new Error('dist/ is missing: run `npm run build` first (or use `npm run package`).');
  }
  const dir = join(outRoot, buildId);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const item of INCLUDE) {
    const from = join(root, item);
    if (!existsSync(from)) continue;
    mkdirSync(join(dir, item, '..'), { recursive: true });
    cpSync(from, join(dir, item), { recursive: true });
  }
  const info = { version, buildId, commit, builtAt: new Date().toISOString() };
  writeFileSync(join(dir, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
  writeSums(dir);
  return { dir, info };
}
