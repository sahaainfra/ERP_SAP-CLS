import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createArtifact, writeSums } from './package.mjs';
import { deploy, rollback, stopEnvironment } from './deploy.mjs';

export const ROLLBACK_TARGET_MS = 60_000;

const ADMIN = { 'content-type': 'application/json', 'x-erp-user': 'rehearsal', 'x-erp-roles': 'SYSADM', 'x-erp-company': '1' };

async function api(port, method, path, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { method, headers: ADMIN, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

/** Derive a variant of an artefact: new build ID, optional patch of its files, fresh checksums. */
function variant(srcDir, outRoot, buildId, version, patch) {
  const dir = join(outRoot, buildId);
  rmSync(dir, { recursive: true, force: true });
  cpSync(srcDir, dir, { recursive: true });
  const infoPath = join(dir, 'build-info.json');
  const info = { ...JSON.parse(readFileSync(infoPath, 'utf8')), buildId, version };
  writeFileSync(infoPath, `${JSON.stringify(info, null, 2)}\n`);
  patch?.(dir);
  writeSums(dir);
  return dir;
}

/**
 * Rehearse a staging deploy and rollback on a directory-based environment (FR-05, T-03):
 * deploy A, deploy B with a new migration, roll back to A, then prove the two automatic-rollback
 * drills (a failing migration and a failing smoke test). Returns { ok, steps }.
 */
export async function rehearse({ root, workDir, port, log = (_message) => {} }) {
  const steps = [];
  const record = async (name, fn) => {
    const t = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, ok: true, ms: Date.now() - t, detail: detail ?? '' });
    } catch (err) {
      steps.push({ name, ok: false, ms: Date.now() - t, detail: err.message });
      throw err;
    }
  };
  const expect = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const outRoot = join(workDir, 'artifacts');
  const deployRoot = join(workDir, 'env');
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(outRoot, { recursive: true });
  const common = { envName: 'staging', deployRoot, port, nodeEnv: 'test', environment: 'staging', log };

  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const { dir: dirA } = createArtifact({ root, outRoot, buildId: 'rehearsal-A', version: pkg.version, commit: 'rehearsal', requireClient: false });
    const dirB = variant(dirA, outRoot, 'rehearsal-B', `${pkg.version}-next`, (d) => {
      writeFileSync(join(d, 'migrations', '20261231000001_rehearsal_table.up.sql'), 'CREATE TABLE IF NOT EXISTS rehearsal_notes (id INTEGER PRIMARY KEY, note TEXT);\n');
      writeFileSync(join(d, 'migrations', '20261231000001_rehearsal_table.down.sql'), 'DROP TABLE IF EXISTS rehearsal_notes;\n');
    });
    const dirBadMigration = variant(dirA, outRoot, 'rehearsal-C-bad-migration', `${pkg.version}-bad`, (d) => {
      writeFileSync(join(d, 'migrations', '20261231000002_broken.up.sql'), 'CREATE TABLE ok_first (id INTEGER); THIS IS NOT SQL;\n');
      writeFileSync(join(d, 'migrations', '20261231000002_broken.down.sql'), 'DROP TABLE IF EXISTS ok_first;\n');
    });
    const dirCrash = variant(dirA, outRoot, 'rehearsal-D-crashes', `${pkg.version}-crash`, (d) => {
      writeFileSync(join(d, 'src', 'server', 'index.js'), "console.error('simulated crash on start');\nprocess.exit(1);\n");
    });

    await record('deploy build A to staging', async () => {
      const r = await deploy({ ...common, artifactDir: dirA });
      expect(r.ok, `deploy A failed: ${r.reason}`);
      return `${r.durationMs} ms`;
    });
    await record('write data on A (flag override, audited)', async () => {
      const r = await api(port, 'PATCH', '/core/feature-flags/ff.prog.p0003', {
        scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'rehearsal data written on build A',
      });
      expect(r.status === 200, `PATCH on A returned ${r.status}`);
    });
    await record('deploy build B (adds a migration)', async () => {
      const r = await deploy({ ...common, artifactDir: dirB });
      expect(r.ok, `deploy B failed: ${r.reason}`);
      const about = await api(port, 'GET', '/core/about');
      expect(about.json.data.buildId === 'rehearsal-B', 'B is not the running build');
      expect(about.json.data.migrations.some((m) => m.id.includes('rehearsal_table')), 'B migration not applied');
      return `${r.durationMs} ms`;
    });
    await record('write data on B', async () => {
      const r = await api(port, 'PATCH', '/core/feature-flags/ff.prog.p0002', {
        scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'rehearsal data written on build B',
      });
      expect(r.status === 200, `PATCH on B returned ${r.status}`);
    });
    await record('roll back to build A (one command)', async () => {
      const r = await rollback({ ...common });
      expect(r.ok && r.restored === 'rehearsal-A', 'rollback did not restore A');
      expect(r.method === 'down-migrations', `expected down-migrations, got ${r.method}`);
      expect(r.durationMs <= ROLLBACK_TARGET_MS, `rollback took ${r.durationMs} ms, target ${ROLLBACK_TARGET_MS} ms`);
      const about = await api(port, 'GET', '/core/about');
      expect(about.json.data.buildId === 'rehearsal-A', 'A is not the running build');
      expect(!about.json.data.migrations.some((m) => m.id.includes('rehearsal_table')), 'B migration still applied');
      return `${r.durationMs} ms via ${r.method} (target ${ROLLBACK_TARGET_MS} ms)`;
    });
    await record('data written on A and B survived the rollback', async () => {
      const list = await api(port, 'GET', '/core/feature-flags?q=ff.prog&pageSize=100');
      const mine = list.json.data.filter((r) => r.level === 'company' && r.companyId === 1);
      expect(mine.some((r) => r.key === 'ff.prog.p0003' && r.remarks.includes('build A')), 'data from A was lost');
      expect(mine.some((r) => r.key === 'ff.prog.p0002' && r.remarks.includes('build B')), 'data from B was lost');
    });
    await record('drill: failing migration is rolled back automatically', async () => {
      await deploy({ ...common, artifactDir: dirB }); // move to B first so there is something to lose
      await rollback({ ...common });
      const r = await deploy({ ...common, artifactDir: dirBadMigration });
      expect(!r.ok && r.rolledBack, 'a broken migration was not rolled back');
      const about = await api(port, 'GET', '/core/about');
      expect(about.json.data.buildId === 'rehearsal-A', 'A is not serving after the failed deploy');
      expect(!about.json.data.migrations.some((m) => m.id.includes('broken')), 'broken migration left applied');
      return `${r.durationMs} ms, ${r.reason}`;
    });
    await record('drill: failing smoke test is rolled back automatically (BR-02)', async () => {
      const r = await deploy({ ...common, artifactDir: dirCrash, smokeTimeoutMs: 5000 });
      expect(!r.ok && r.rolledBack, 'a crashing build was not rolled back');
      const about = await api(port, 'GET', '/core/about');
      expect(about.json.data.buildId === 'rehearsal-A', 'A is not serving after the failed deploy');
      return `${r.durationMs} ms, ${r.reason}`;
    });
  } catch {
    /* the failing step is already recorded */
  } finally {
    await stopEnvironment({ envName: 'staging', deployRoot });
  }
  return { ok: steps.length > 0 && steps.every((s) => s.ok) && steps.length === 8, steps };
}
