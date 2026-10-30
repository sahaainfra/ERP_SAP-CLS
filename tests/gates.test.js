import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkMigrations } from '../scripts/lib/migration_check.mjs';
import { scanRepository, scanText } from '../scripts/lib/secrets.mjs';
import { gateCoverage, parseLcov } from '../scripts/lib/coverage.mjs';
import { bumpVersion, flagList, parseCommits, renderChangelog, renderReleaseNotes } from '../scripts/lib/release.mjs';
import { createArtifact, verifyArtifact, writeSums } from '../scripts/lib/package.mjs';
import { MIGRATIONS_DIR, ROOT } from '../src/server/db.js';

const scratch = (prefix) => mkdtempSync(join(tmpdir(), prefix));

function copyMigrations(extra = {}) {
  const dir = scratch('erp-mig-');
  for (const f of readdirSync(MIGRATIONS_DIR)) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
  for (const [name, sql] of Object.entries(extra)) writeFileSync(join(dir, name), sql);
  return dir;
}

test('the repository migrations all pass the up/down check', () => {
  assert.deepEqual(checkMigrations(MIGRATIONS_DIR), []);
});

test('T-02 a migration without a down-migration fails the check', () => {
  const dir = copyMigrations({ '20261101000001_no_down.up.sql': 'CREATE TABLE core_no_down (id INTEGER);\n' });
  const problems = checkMigrations(dir);
  assert.ok(problems.some((p) => /no_down: missing \.down\.sql/.test(p)), problems.join('\n'));
});

test('T-02 a down-migration that does not restore the schema fails the check', () => {
  const dir = copyMigrations({
    '20261101000002_bad_down.up.sql': 'CREATE TABLE core_bad_down (id INTEGER);\n',
    '20261101000002_bad_down.down.sql': 'SELECT 1;\n',
  });
  assert.ok(checkMigrations(dir).some((p) => /does not restore the previous schema/.test(p)));
});

test('T-02 a failing or non-idempotent migration is reported', () => {
  const broken = copyMigrations({
    '20261101000003_broken.up.sql': 'THIS IS NOT SQL;\n',
    '20261101000003_broken.down.sql': 'SELECT 1;\n',
  });
  assert.ok(checkMigrations(broken).some((p) => /up failed/.test(p)));
  const notIdempotent = copyMigrations({
    '20261101000004_plain.up.sql': 'CREATE TABLE core_plain (id INTEGER);\n',
    '20261101000004_plain.down.sql': 'DROP TABLE core_plain;\n',
  });
  assert.ok(checkMigrations(notIdempotent).some((p) => /not idempotent/.test(p)));
});

// Fake credentials are assembled at run time so this file itself never contains one.
const fakes = {
  aws: ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join(''),
  github: ['gh', 'p_', 'a'.repeat(36)].join(''),
  privateKey: ['-----BEGIN ', 'RSA PRIVATE KEY-----'].join(''),
  assignment: ['pass', 'word = "', 'hunter2hunter2', '"'].join(''),
};

test('the secret scanner recognises each credential shape', () => {
  assert.equal(scanText(`const k = '${fakes.aws}';`)[0].id, 'aws-access-key');
  assert.equal(scanText(`const t = '${fakes.github}';`)[0].id, 'github-token');
  assert.equal(scanText(fakes.privateKey)[0].id, 'private-key');
  assert.equal(scanText(fakes.assignment)[0].id, 'credential-assignment');
  assert.equal(scanText('const secretKey = process.env.SECRET_KEY;').length, 0);
  assert.equal(scanText(`${fakes.aws} // secret-scan:allow documented example`).length, 0);
});

test('AC-02 a leaked test secret in a new file is caught before commit', () => {
  const repo = scratch('erp-secret-');
  spawnSync('git', ['init', '-q'], { cwd: repo });
  writeFileSync(join(repo, 'clean.js'), 'export const ok = 1;\n');
  assert.deepEqual(scanRepository(repo), []);
  writeFileSync(join(repo, 'config.js'), `export const key = '${fakes.aws}';\n`);
  const found = scanRepository(repo);
  assert.deepEqual(found.map((f) => [f.file, f.id]), [['config.js', 'aws-access-key']]);
});

test('the repository itself contains no secrets', () => {
  assert.deepEqual(scanRepository(ROOT), []);
});

const lcov = (rows) => rows.map(([f, found, hit]) => `SF:${f}\n${Array.from({ length: found }, (_, i) => `DA:${i + 1},${i < hit ? 1 : 0}`).join('\n')}\nend_of_record`).join('\n');

test('coverage gate: changed files below the threshold fail, above pass', () => {
  const data = lcov([['D:\\repo\\src\\server\\a.js', 10, 7], ['D:\\repo\\src\\server\\b.js', 10, 5], ['D:\\repo\\scripts\\lib\\c.mjs', 4, 4]]);
  assert.deepEqual(parseLcov(data)['D:/repo/src/server/a.js'], { found: 10, hit: 7 });
  const r = gateCoverage({ lcov: data, changed: ['src/server/a.js', 'src/server/b.js', 'scripts/lib/c.mjs', 'README.md'], minPercent: 60 });
  assert.deepEqual(r.failures.map((f) => f.file), ['src/server/b.js']);
  assert.equal(r.checked.length, 3, 'only gated source files are judged');
});

test('coverage gate: a changed source file with no coverage data counts as 0 %', () => {
  const r = gateCoverage({ lcov: lcov([['/r/src/server/a.js', 2, 2]]), changed: ['src/server/new.js'], minPercent: 60 });
  assert.equal(r.failures[0].percent, 0);
});

test('T-01 a failing unit test makes the regression run fail and report it', () => {
  const dir = scratch('erp-failing-');
  writeFileSync(join(dir, 'failing.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('deliberate failure', () => assert.equal(1, 2));\n");
  const reportDir = scratch('erp-report-');
  const r = spawnSync(process.execPath, ['scripts/regression.mjs', '--only', 'unit-api'], {
    cwd: ROOT,
    encoding: 'utf8',
    // NODE_TEST_CONTEXT is set by the outer test runner; a nested `node --test` must not inherit it.
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, ERP_TEST_GLOB: join(dir, 'failing.test.js'), ERP_REPORT_DIR: reportDir },
  });
  assert.equal(r.status, 1);
  const report = JSON.parse(readFileSync(join(reportDir, 'report.json'), 'utf8'));
  assert.equal(report.passed, false);
  assert.equal(report.steps[0].passed, false);
});

test('release: version bumps follow semantic versioning', () => {
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.throws(() => bumpVersion('1.2', 'patch'));
  assert.throws(() => bumpVersion('1.2.3', 'huge'));
});

test('release: changelog and business-language notes come from commits, with the flag list', () => {
  const raw = [
    'aaaaaaa1\x1fP00.03: CI gates and release tooling (module prog)\x1fWhy.\nRelease-note: Administrators can now see the build version on the About page.\x1e',
    'bbbbbbb2\x1fP00.02: feature flags (module prog)\x1f\x1e',
    'ccccccc3\x1fmerge fixups\x1f\x1e',
  ].join('\n');
  const commits = parseCommits(raw);
  assert.equal(commits.length, 3);
  assert.deepEqual([commits[0].part, commits[0].summary, commits[2].part], ['00.03', 'CI gates and release tooling', null]);
  const log = renderChangelog({ version: '0.2.0', date: '2026-10-31', commits });
  assert.match(log, /## 0\.2\.0 - 2026-10-31/);
  assert.match(log, /\*\*00\.03\*\* CI gates and release tooling \(aaaaaaa\)/);
  const flags = flagList(MIGRATIONS_DIR);
  assert.ok(flags.find((f) => f.key === 'ff.prog.p0003' && f.defaultOn === false));
  const notes = renderReleaseNotes({ version: '0.2.0', date: '2026-10-31', commits, flags });
  assert.match(notes, /Administrators can now see the build version/);
  assert.match(notes, /\| ff\.prog\.p0003 \|/);
});

test('artefacts carry build info and checksums; tampering is detected', () => {
  const out = scratch('erp-art-');
  const { dir, info } = createArtifact({ root: ROOT, outRoot: out, buildId: 'test-1', version: '9.9.9', commit: 'abc1234', requireClient: false });
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8')).buildId, info.buildId);
  assert.deepEqual(verifyArtifact(dir), []);
  writeFileSync(join(dir, 'src', 'server', 'flags.js'), '// tampered\n');
  assert.ok(verifyArtifact(dir).some((p) => /checksum mismatch src\/server\/flags\.js/.test(p)));
  writeSums(dir);
  assert.deepEqual(verifyArtifact(dir), []);
  mkdirSync(join(dir, 'extra'));
  writeFileSync(join(dir, 'extra', 'x.txt'), 'x');
  assert.ok(verifyArtifact(dir).some((p) => /unlisted file extra\/x\.txt/.test(p)));
  assert.throws(() => createArtifact({ root: ROOT, outRoot: out, buildId: '../evil', version: '1', commit: 'x', requireClient: false }));
});
