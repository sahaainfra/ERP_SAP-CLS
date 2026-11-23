// Part 30.08 FR-02: zero-downtime (blue-green) deployment of one environment.
//
// An environment has two slots, blue and green, each a release directory with its own server process on its own port, behind a proxy that
// sends every request to the active slot (nginx in production: infra/nginx/erp.conf includes `active-upstream.conf`, which the switch
// rewrites before `nginx -s reload`; the rehearsal uses scripts/lib/proxy.mjs, which reads the same state file). A deploy:
//   1. verifies the artefact (checksums);
//   2. backs up the database (VACUUM INTO) and verifies the copy (integrity check and table counts) — the restore point;
//   3. applies the new release's migrations while the active slot keeps serving (migrations are additive: expand, never contract — BR-01
//      of every part), so the old build still works on the new schema;
//   4. starts the new release on the idle slot and smoke-tests it there (health, the build ID, migrations applied);
//   5. switches the proxy to it, then drains the old slot (in-flight requests finish) and stops it.
// Any failure before the switch leaves the active slot serving and undoes the new migrations (down-migrations, else the restore point).
// Rollback switches back to the previous slot's build (started again if it was stopped) and undoes the newer migrations.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { listMigrations } from '../../src/server/platform/db/index.js';
import { backupDatabase, restoreDatabase } from './backup.mjs';
import { smokeTest } from './deploy.mjs';
import { verifyArtifact } from './package.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const SLOTS = { blue: 0, green: 1 };
const other = (slot) => (slot === 'blue' ? 'green' : 'blue');

export const envPaths = (deployRoot, envName) => {
  const base = join(deployRoot, envName);
  return { base, slots: join(base, 'slots'), backups: join(base, 'backups'), logs: join(base, 'logs'), db: join(base, 'data', 'erp.sqlite'), state: join(base, 'bluegreen.json'), upstream: join(base, 'active-upstream.conf') };
};
export const readBlueGreen = (p) => (existsSync(p.state) ? JSON.parse(readFileSync(p.state, 'utf8')) : { active: null, slots: {}, history: [] });
function writeBlueGreen(p, s) {
  mkdirSync(p.base, { recursive: true });
  writeFileSync(`${p.state}.tmp`, `${JSON.stringify(s, null, 2)}\n`);
  // the nginx include of production: the one line that names the active slot (written first, then the state the rehearsal proxy reads)
  if (s.active) writeFileSync(p.upstream, `# written by scripts/lib/bluegreen.mjs — the active slot of ${p.base}\nserver 127.0.0.1:${s.slots[s.active].port};\n`);
  cpSync(`${p.state}.tmp`, p.state); rmSync(`${p.state}.tmp`, { force: true });
}

function serverEnv({ nodeEnv, environment, port, dbPath }) {
  return { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: nodeEnv, ERP_ENVIRONMENT: environment, PORT: String(port), DATABASE_PATH: dbPath, AUTH_MODE: 'dev-headers', ERP_DEMO_SEED: 'false', ERP_DEPLOYED_AT: new Date().toISOString() };
}
// run asynchronously: the process that drives the deploy (the rehearsal's proxy, a deploy agent) keeps answering while the schema changes
const migrate = (dir, args, env) => new Promise((resolve) => { const c = spawn(process.execPath, ['scripts/migrate.mjs', ...args], { cwd: dir, env }); let output = ''; c.stdout.on('data', (d) => { output += d; }); c.stderr.on('data', (d) => { output += d; }); c.on('close', (code) => resolve({ ok: code === 0, output })); });
const appliedIds = (dbPath) => { if (!existsSync(dbPath)) return []; const db = new DatabaseSync(dbPath); try { return db.prepare('SELECT id FROM core_schema_migrations ORDER BY id').all().map((r) => r.id); } catch { return []; } finally { db.close(); } };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
async function stop(pid) { if (!alive(pid)) return; try { process.kill(pid, 'SIGTERM'); } catch { return; } for (let i = 0; i < 60 && alive(pid); i += 1) await sleep(100); if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
function start(dir, p, env) {
  mkdirSync(p.logs, { recursive: true });
  const out = openSync(join(p.logs, `${JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8')).buildId}.log`), 'a');
  const child = spawn(process.execPath, ['src/server/index.js'], { cwd: dir, env, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  return child.pid;
}

/** The restore point, verified: the copy opens, passes the integrity check and has the same tables with the same row counts. */
export function verifiedBackup(dbPath, target) {
  backupDatabase(dbPath, target);
  const a = new DatabaseSync(dbPath, { readOnly: true }); const b = new DatabaseSync(target, { readOnly: true });
  try {
    const ok = b.prepare('PRAGMA integrity_check').get();
    if (Object.values(ok)[0] !== 'ok') throw new Error(`the backup failed its integrity check: ${Object.values(ok)[0]}`);
    const tables = a.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
    const diff = tables.filter((t) => a.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n !== b.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n);
    if (diff.length) throw new Error(`the backup differs from the database in ${diff.slice(0, 5).join(', ')}`);
    return { tables: tables.length };
  } finally { a.close(); b.close(); }
}

/** Undo the migrations a release added that `keepDir` does not know (down-migrations of `fromDir`), else restore the restore point. */
async function undoMigrations({ p, fromDir, keepDir, env, backup }) {
  const keep = new Set(keepDir ? listMigrations(join(keepDir, 'migrations')).map((m) => m.id) : []);
  const extra = appliedIds(p.db).filter((id) => !keep.has(id));
  if (!extra.length) return 'none';
  const down = await migrate(fromDir, ['down', String(extra.length)], env);
  if (down.ok && !appliedIds(p.db).some((id) => !keep.has(id))) return 'down-migrations';
  if (backup) { restoreDatabase(backup, p.db); return 'restore-point'; }
  throw new Error(`could not undo migrations ${extra.join(', ')}`);
}

/**
 * Deploy an artefact to the idle slot and switch to it without stopping the service. `basePort`: blue listens on it, green on basePort + 1.
 * Returns { ok, buildId, slot, durationMs, switchedAt } or { ok: false, reason, kept } (the active slot kept serving).
 */
export async function deployBlueGreen({ artifactDir, envName, deployRoot, basePort, nodeEnv = 'test', environment = envName, smokeTimeoutMs = 20_000, drainMs = 1500, log = /** @type {(m: string) => void} */ (() => {}) }) {
  const started = Date.now();
  const bad = verifyArtifact(artifactDir);
  if (bad.length) throw new Error(`Artefact failed verification: ${bad.join('; ')}`);
  const info = JSON.parse(readFileSync(join(artifactDir, 'build-info.json'), 'utf8'));
  const p = envPaths(deployRoot, envName);
  const state = readBlueGreen(p);
  const active = state.active; const slot = active ? other(active) : 'blue'; const port = basePort + SLOTS[slot];
  if (active && state.slots[active]?.buildId === info.buildId) throw new Error(`Build ${info.buildId} is already active in ${envName}.`);
  const dir = join(p.slots, slot);
  await stop(state.slots[slot]?.pid); // the idle slot may still hold the build before last
  rmSync(dir, { recursive: true, force: true }); mkdirSync(p.slots, { recursive: true }); cpSync(artifactDir, dir, { recursive: true });
  mkdirSync(join(p.base, 'data'), { recursive: true });
  const env = serverEnv({ nodeEnv, environment, port, dbPath: p.db });
  let backup = null;
  if (existsSync(p.db)) {
    backup = join(p.backups, `${info.buildId}.pre-deploy.sqlite`); mkdirSync(p.backups, { recursive: true });
    const v = verifiedBackup(p.db, backup);
    log(`restore point ${backup} verified (${v.tables} tables)`);
  }
  const keepDir = active ? join(p.slots, active) : null;
  const fail = async (reason, pid) => {
    log(`deploy failed: ${reason}`);
    await stop(pid);
    let undone;
    try { undone = await undoMigrations({ p, fromDir: dir, keepDir, env, backup }); } catch (err) { undone = `failed: ${err.message}`; }
    writeBlueGreen(p, { ...state, lastFailure: { buildId: info.buildId, reason, undone, at: new Date().toISOString() } });
    return { ok: false, reason, kept: active ? state.slots[active].buildId : null, undone, durationMs: Date.now() - started };
  };
  const m = await migrate(dir, ['up'], env);
  if (!m.ok) return fail(`migration failed: ${m.output.split('\n').find((l) => /error/i.test(l)) ?? m.output.slice(-200)}`);
  const pid = start(dir, p, env);
  const smoke = await smokeTest({ port, expectBuildId: info.buildId, timeoutMs: smokeTimeoutMs });
  if (!smoke.ok) return fail(`smoke test failed: ${smoke.problems.join('; ')}`, pid);
  // the switch: one write of the state (and the nginx include); the proxy sends the next request to the new slot
  const switchedAt = new Date().toISOString();
  const next = { active: slot, slots: { ...state.slots, [slot]: { buildId: info.buildId, version: info.version, pid, port, startedAt: switchedAt } }, previous: active ?? null, history: [...(state.history ?? []), { buildId: info.buildId, slot, at: switchedAt, kind: 'deploy' }], backups: { ...(state.backups ?? {}), ...(backup ? { [info.buildId]: backup } : {}) } };
  writeBlueGreen(p, next);
  log(`switched ${envName} to ${slot} (${info.buildId}); draining ${active ?? 'nothing'}`);
  // the old slot keeps running (stopped by the next deploy) so a rollback is a switch; its in-flight requests finish
  await sleep(drainMs);
  return { ok: true, buildId: info.buildId, slot, switchedAt, durationMs: Date.now() - started };
}

/** Roll back to the previous slot's build: start it again if needed, switch to it, then undo the newer build's migrations. */
export async function rollbackBlueGreen({ envName, deployRoot, nodeEnv = 'test', environment = envName, smokeTimeoutMs = 20_000, log = /** @type {(m: string) => void} */ (() => {}) }) {
  const started = Date.now();
  const p = envPaths(deployRoot, envName);
  const state = readBlueGreen(p);
  if (!state.active || !state.previous || !state.slots[state.previous]) throw new Error(`Nothing to roll back to in ${envName}.`);
  const from = state.active; const to = state.previous; const target = state.slots[to];
  const toDir = join(p.slots, to); const fromDir = join(p.slots, from);
  const env = serverEnv({ nodeEnv, environment, port: target.port, dbPath: p.db });
  let pid = target.pid;
  if (!alive(pid)) { pid = start(toDir, p, env); log(`started ${to} again`); }
  const smoke = await smokeTest({ port: target.port, expectBuildId: target.buildId, timeoutMs: smokeTimeoutMs });
  if (!smoke.ok) throw new Error(`the previous build does not answer: ${smoke.problems.join('; ')}`);
  const at = new Date().toISOString();
  writeBlueGreen(p, { ...state, active: to, previous: from, slots: { ...state.slots, [to]: { ...target, pid } }, history: [...state.history, { buildId: target.buildId, slot: to, at, kind: 'rollback' }] });
  log(`switched back to ${to} (${target.buildId})`);
  await sleep(1000); // in-flight requests on the newer build finish
  await stop(state.slots[from].pid);
  const undone = await undoMigrations({ p, fromDir, keepDir: toDir, env, backup: state.backups?.[state.slots[from].buildId] ?? null });
  writeBlueGreen(p, { ...readBlueGreen(p), slots: { ...readBlueGreen(p).slots, [from]: { ...state.slots[from], pid: null } } });
  return { ok: true, restored: target.buildId, slot: to, undone, durationMs: Date.now() - started };
}

export async function stopBlueGreen({ envName, deployRoot }) {
  const p = envPaths(deployRoot, envName);
  const s = readBlueGreen(p);
  for (const x of Object.values(s.slots ?? {})) await stop(x.pid);
}
