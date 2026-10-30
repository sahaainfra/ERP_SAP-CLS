import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { listMigrations } from '../../src/server/platform/db/index.js';
import { verifyArtifact } from './package.mjs';

const SMOKE_HEADERS = { 'x-erp-user': 'smoke-test', 'x-erp-roles': 'ITADM', 'x-erp-company': '1' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const paths = (deployRoot, envName) => {
  const base = join(deployRoot, envName);
  return {
    base,
    releases: join(base, 'releases'),
    backups: join(base, 'backups'),
    logs: join(base, 'logs'),
    db: join(base, 'data', 'erp.sqlite'),
    state: join(base, 'state.json'),
  };
};

export const readState = (p) => (existsSync(p.state) ? JSON.parse(readFileSync(p.state, 'utf8')) : { current: null, previous: null, history: [], backups: {} });
const writeState = (p, s) => {
  mkdirSync(p.base, { recursive: true });
  writeFileSync(p.state, `${JSON.stringify(s, null, 2)}\n`);
};

const readInfo = (releaseDir) => JSON.parse(readFileSync(join(releaseDir, 'build-info.json'), 'utf8'));

function appliedMigrationIds(dbPath) {
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath);
  try {
    return db.prepare('SELECT id FROM core_schema_migrations ORDER BY id').all().map((r) => r.id);
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Consistent copy of the database (restore point) taken before any migration. */
export function backupDatabase(dbPath, dest) {
  mkdirSync(join(dest, '..'), { recursive: true });
  rmSync(dest, { force: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

export function restoreDatabase(backup, dbPath) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
  cpSync(backup, dbPath);
}

/** The most useful line of a failed command's output: the first line that names an error. */
const errorLine = (output) => {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /error/i.test(l)) ?? lines.at(-1) ?? 'no output';
};

function runMigrate(releaseDir, args, env) {
  const r = spawnSync(process.execPath, ['scripts/migrate.mjs', ...args], { cwd: releaseDir, encoding: 'utf8', env });
  return { ok: r.status === 0, output: `${r.stdout}${r.stderr}` };
}

function serverEnv({ nodeEnv, environment, port, dbPath, deployedAt }) {
  return {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    NODE_ENV: nodeEnv,
    ERP_ENVIRONMENT: environment,
    PORT: String(port),
    DATABASE_PATH: dbPath,
    AUTH_MODE: 'dev-headers',
    ERP_DEMO_SEED: 'false',
    ...(deployedAt ? { ERP_DEPLOYED_AT: deployedAt } : {}),
  };
}

function startRelease({ releaseDir, p, env }) {
  mkdirSync(p.logs, { recursive: true });
  const out = openSync(join(p.logs, `${readInfo(releaseDir).buildId}.log`), 'a');
  const child = spawn(process.execPath, ['src/server/index.js'], { cwd: releaseDir, env, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  return child.pid;
}

async function stopProcess(pid) {
  if (!pid) return;
  try {
    process.kill(pid);
  } catch {
    return;
  }
  for (let i = 0; i < 50; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await sleep(100);
  }
}

async function waitForHealth(port, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  return false;
}

/** Post-deploy smoke test: liveness, and the running build must be the one just deployed. */
export async function smokeTest({ port, expectBuildId, timeoutMs = 15000 }) {
  const problems = [];
  if (!(await waitForHealth(port, timeoutMs))) return { ok: false, problems: ['the server did not become healthy in time'] };
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/core/about`, { headers: SMOKE_HEADERS });
    const body = await res.json();
    if (res.status !== 200) problems.push(`about returned HTTP ${res.status}`);
    else if (body.data.buildId !== expectBuildId) problems.push(`running build is ${body.data.buildId}, expected ${expectBuildId}`);
    else if (!body.data.migrations.length) problems.push('no migrations are applied');
  } catch (err) {
    problems.push(`about request failed: ${err.message}`);
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Move an environment from `fromDir` (whose migrations are applied) back to `toDir`.
 * Prefers the down-migrations of `fromDir` (keeps data written since); falls back to the restore point.
 */
async function revert({ p, fromDir, toDir, backup, env, port, log }) {
  const toIds = toDir ? listMigrations(join(toDir, 'migrations')).map((m) => m.id) : [];
  const applied = appliedMigrationIds(p.db);
  const extra = applied.filter((id) => !toIds.includes(id));
  let method = 'none';
  if (extra.length) {
    const down = runMigrate(fromDir, ['down', String(extra.length)], env);
    const after = appliedMigrationIds(p.db);
    if (down.ok && after.every((id) => toIds.includes(id))) {
      method = 'down-migrations';
    } else if (backup && existsSync(backup)) {
      log(`down-migrations failed (${errorLine(down.output)}); restoring the restore point`);
      restoreDatabase(backup, p.db);
      method = 'restore-point';
    } else {
      throw new Error(`Rollback failed: down-migrations failed and there is no restore point.\n${down.output}`);
    }
  }
  if (!toDir) return { method, pid: null };
  const pid = startRelease({ releaseDir: toDir, p, env });
  const smoke = await smokeTest({ port, expectBuildId: readInfo(toDir).buildId });
  if (!smoke.ok) throw new Error(`Rolled-back version failed its smoke test: ${smoke.problems.join('; ')}`);
  return { method, pid };
}

/**
 * Deploy an artefact to an environment directory: verify checksums, back up the database, migrate,
 * start, smoke-test. A failed migration or smoke test rolls back automatically (BR-02).
 */
export async function deploy({ artifactDir, envName, deployRoot, port, nodeEnv = 'test', environment = envName, installDeps = false, smokeTimeoutMs = 15000, log = (_message) => {} }) {
  const started = Date.now();
  const bad = verifyArtifact(artifactDir);
  if (bad.length) throw new Error(`Artefact failed verification: ${bad.join('; ')}`);
  const info = readInfo(artifactDir);
  const p = paths(deployRoot, envName);
  const state = readState(p);
  if (state.current === info.buildId) throw new Error(`Build ${info.buildId} is already deployed to ${envName}.`);

  const releaseDir = join(p.releases, info.buildId);
  rmSync(releaseDir, { recursive: true, force: true });
  mkdirSync(p.releases, { recursive: true });
  cpSync(artifactDir, releaseDir, { recursive: true });
  mkdirSync(join(p.base, 'data'), { recursive: true });

  const oldDir = state.current ? join(p.releases, state.current) : null;
  let backup = null;
  if (existsSync(p.db)) {
    backup = join(p.backups, `${info.buildId}.pre-deploy.sqlite`);
    backupDatabase(p.db, backup);
    log(`restore point: ${backup}`);
  }
  await stopProcess(state.pid);

  const deployedAt = new Date().toISOString();
  const env = serverEnv({ nodeEnv, environment, port, dbPath: p.db, deployedAt });
  const failAndRevert = async (reason) => {
    log(`deploy failed: ${reason}; rolling back`);
    let reverted = { method: 'none', pid: null };
    if (oldDir) {
      const prevEnv = serverEnv({ nodeEnv, environment, port, dbPath: p.db, deployedAt: state.deployedAt });
      reverted = await revert({ p, fromDir: releaseDir, toDir: oldDir, backup, env: prevEnv, port, log });
    } else if (backup) {
      restoreDatabase(backup, p.db);
      reverted.method = 'restore-point';
    } else {
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${p.db}${suffix}`, { force: true });
    }
    writeState(p, { ...state, pid: reverted.pid, lastFailure: { buildId: info.buildId, reason, at: new Date().toISOString() } });
    return { ok: false, rolledBack: true, method: reverted.method, reason, durationMs: Date.now() - started };
  };

  if (installDeps) {
    const npm = spawnSync('npm', ['ci', '--omit=dev'], { cwd: releaseDir, encoding: 'utf8', shell: true });
    if (npm.status !== 0) return failAndRevert(`npm ci failed: ${errorLine(npm.stderr)}`);
  }

  const migrated = runMigrate(releaseDir, ['up'], env);
  if (!migrated.ok) return failAndRevert(`migration failed: ${errorLine(migrated.output)}`);
  const pid = startRelease({ releaseDir, p, env });
  const smoke = await smokeTest({ port, expectBuildId: info.buildId, timeoutMs: smokeTimeoutMs });
  if (!smoke.ok) {
    await stopProcess(pid);
    return failAndRevert(`smoke test failed: ${smoke.problems.join('; ')}`);
  }
  writeState(p, {
    current: info.buildId,
    previous: state.current,
    pid,
    port,
    deployedAt,
    backups: { ...state.backups, ...(backup ? { [info.buildId]: backup } : {}) },
    history: [...state.history, { buildId: info.buildId, version: info.version, at: deployedAt }],
  });
  return { ok: true, buildId: info.buildId, durationMs: Date.now() - started };
}

/** One-command rollback of the application and its database to the previous build (FR-05). */
export async function rollback({ envName, deployRoot, nodeEnv = 'test', environment = envName, log = (_message) => {} }) {
  const started = Date.now();
  const p = paths(deployRoot, envName);
  const state = readState(p);
  if (!state.current) throw new Error(`${envName} has nothing deployed.`);
  if (!state.previous) throw new Error(`${envName} has no previous build to roll back to.`);
  const fromDir = join(p.releases, state.current);
  const toDir = join(p.releases, state.previous);
  if (!existsSync(toDir)) throw new Error(`Previous release ${state.previous} is no longer on disk.`);
  await stopProcess(state.pid);
  const env = serverEnv({ nodeEnv, environment, port: state.port, dbPath: p.db, deployedAt: new Date().toISOString() });
  const result = await revert({ p, fromDir, toDir, backup: state.backups[state.current], env, port: state.port, log });
  writeState(p, {
    ...state,
    current: state.previous,
    previous: null,
    pid: result.pid,
    deployedAt: env.ERP_DEPLOYED_AT,
    history: [...state.history, { buildId: state.previous, at: env.ERP_DEPLOYED_AT, rolledBackFrom: state.current }],
  });
  return { ok: true, restored: state.previous, from: state.current, method: result.method, durationMs: Date.now() - started };
}

export async function stopEnvironment({ envName, deployRoot }) {
  const p = paths(deployRoot, envName);
  await stopProcess(readState(p).pid);
}

export { paths as environmentPaths };
