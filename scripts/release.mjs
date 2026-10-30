// Usage: node scripts/release.mjs <patch|minor|major> [--dry-run] [--commit]
// Bumps the version, prepends CHANGELOG.md and writes docs/erp/releases/v<version>.md from the commits
// since the last v* tag. Commit bodies may carry "Release-note: <business language>".
// --commit also commits the files and creates the annotated tag v<version>. Nothing is pushed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_LOG_FORMAT, bumpVersion, flagList, parseCommits, renderChangelog, renderReleaseNotes } from './lib/release.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [kind, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

if (!kind) {
  console.error('Usage: release.mjs <patch|minor|major> [--dry-run] [--commit]');
  process.exit(2);
}
const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const next = bumpVersion(pkg.version, kind);
let lastTag = null;
try {
  lastTag = git('describe', '--tags', '--abbrev=0', '--match', 'v*');
} catch {
  /* first release: use the whole history */
}
const raw = git('log', `--format=${GIT_LOG_FORMAT}`, lastTag ? `${lastTag}..HEAD` : 'HEAD');
const commits = parseCommits(raw);
const date = new Date().toISOString().slice(0, 10);
const changelogEntry = renderChangelog({ version: next, date, commits });
const notes = renderReleaseNotes({ version: next, date, commits, flags: flagList(join(root, 'migrations')) });

console.log(`Release ${pkg.version} -> ${next}: ${commits.length} commit(s) since ${lastTag ?? 'the beginning'}.`);
if (dryRun) {
  console.log(`\n${changelogEntry}\n${notes}`);
  process.exit(0);
}
pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
const lockPath = join(root, 'package-lock.json');
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}
const logPath = join(root, 'CHANGELOG.md');
const old = existsSync(logPath) ? readFileSync(logPath, 'utf8').replace(/^# Changelog\n+/, '') : '';
writeFileSync(logPath, `# Changelog\n\n${changelogEntry}\n${old}`);
mkdirSync(join(root, 'docs', 'erp', 'releases'), { recursive: true });
writeFileSync(join(root, 'docs', 'erp', 'releases', `v${next}.md`), notes);
console.log(`Wrote CHANGELOG.md and docs/erp/releases/v${next}.md`);
if (flags.includes('--commit')) {
  git('add', 'package.json', 'package-lock.json', 'CHANGELOG.md', `docs/erp/releases/v${next}.md`);
  git('commit', '-m', `Release ${next}`);
  git('tag', '-a', `v${next}`, '-m', `Release ${next}`);
  console.log(`Committed and tagged v${next}. Push with: git push origin main --follow-tags`);
}
