// Part 30.08 T-01: the zero-downtime deploy and rollback rehearsal. A blue-green environment behind the switching proxy takes steady traffic
// (clients calling the health check and the about page through the proxy, as users would) while:
//   1. build A is deployed (first deploy, blue);
//   2. build B, with an additive migration, is deployed to green and switched to — under traffic;
//   3. the deploy is rolled back to A — under traffic, B's migration undone;
//   4. drill: a build whose migration fails leaves A serving and its migration undone;
//   5. drill: a build that does not start leaves A serving.
// Every request during the rehearsal must succeed (zero failed requests), and the build the clients see must change exactly at the switches.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createArtifact, writeSums } from './package.mjs';
import { deployBlueGreen, envPaths, readBlueGreen, rollbackBlueGreen, stopBlueGreen } from './bluegreen.mjs';
import { createSwitchProxy } from './proxy.mjs';

const H = { 'x-erp-user': 'rehearsal', 'x-erp-roles': 'ITADM', 'x-erp-company': '1' };
function variant(srcDir, outRoot, buildId, version, patch) {
  const dir = join(outRoot, buildId);
  rmSync(dir, { recursive: true, force: true });
  cpSync(srcDir, dir, { recursive: true });
  const infoPath = join(dir, 'build-info.json');
  writeFileSync(infoPath, `${JSON.stringify({ ...JSON.parse(readFileSync(infoPath, 'utf8')), buildId, version }, null, 2)}\n`);
  patch?.(dir); writeSums(dir);
  return dir;
}

/** Steady traffic through the proxy: `clients` loops, each a request every `gapMs`; every answer and the build it came from is kept. */
function traffic(port, { clients = 8, gapMs = 25 } = {}) {
  let on = true; const seen = []; const failures = []; let requests = 0;
  const loops = Array.from({ length: clients }, async (_, i) => {
    while (on) {
      const path = i % 2 ? '/api/health' : '/api/v1/core/about';
      try {
        const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: H });
        const body = await r.text(); requests += 1;
        if (!r.ok) failures.push({ at: Date.now(), path, status: r.status, body: body.slice(0, 120) });
        else if (path !== '/api/health') { const b = JSON.parse(body).data.buildId; if (seen.at(-1)?.buildId !== b) seen.push({ buildId: b, at: Date.now() }); }
      } catch (err) { requests += 1; failures.push({ at: Date.now(), path, status: 0, body: String(err.cause?.code ?? err.message) }); }
      await new Promise((r) => setTimeout(r, gapMs));
    }
  });
  return { stop: async () => { on = false; await Promise.all(loops); return { requests, failures, seen }; } };
}

export async function rehearseZeroDowntime({ root, workDir, basePort = 3392, log = /** @type {(m: string) => void} */ (() => {}) }) {
  const steps = [];
  const expect = (c, m) => { if (!c) throw new Error(m); };
  let lastTraffic = null;
  const record = async (name, fn) => { const t = Date.now(); lastTraffic = null; try { const detail = await fn(); steps.push({ name, ok: true, ms: Date.now() - t, detail: detail ?? '', ...(lastTraffic ? { traffic: lastTraffic } : {}) }); } catch (err) { steps.push({ name, ok: false, ms: Date.now() - t, detail: err.message, ...(lastTraffic ? { traffic: lastTraffic } : {}) }); throw err; } };
  const outRoot = join(workDir, 'artifacts'); const deployRoot = join(workDir, 'env');
  rmSync(workDir, { recursive: true, force: true }); mkdirSync(outRoot, { recursive: true });
  const common = { envName: 'staging', deployRoot, basePort, nodeEnv: 'test', environment: 'staging', log };
  const p = envPaths(deployRoot, 'staging');
  mkdirSync(p.base, { recursive: true });
  const proxy = createSwitchProxy({ stateFile: p.state });
  const port = await proxy.listen();
  let load = null; let totals = { requests: 0, failures: [] };
  const under = async (fn) => { load = traffic(port); try { return await fn(); } finally { const t = await load.stop(); load = null; totals = { requests: totals.requests + t.requests, failures: [...totals.failures, ...t.failures] }; lastTraffic = { requests: t.requests, failed: t.failures.length, builds: t.seen.map((x) => x.buildId) }; } };
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const { dir: dirA } = createArtifact({ root, outRoot, buildId: 'zd-A', version: pkg.version, commit: 'rehearsal', requireClient: false });
    const dirB = variant(dirA, outRoot, 'zd-B', `${pkg.version}-next`, (d) => {
      writeFileSync(join(d, 'migrations', '20261231000011_zd_notes.up.sql'), 'CREATE TABLE IF NOT EXISTS zd_notes (id INTEGER PRIMARY KEY, note TEXT);\n');
      writeFileSync(join(d, 'migrations', '20261231000011_zd_notes.down.sql'), 'DROP TABLE IF EXISTS zd_notes;\n');
    });
    const dirBad = variant(dirA, outRoot, 'zd-C-bad-migration', `${pkg.version}-bad`, (d) => {
      writeFileSync(join(d, 'migrations', '20261231000012_zd_broken.up.sql'), 'CREATE TABLE zd_ok (id INTEGER); THIS IS NOT SQL;\n');
      writeFileSync(join(d, 'migrations', '20261231000012_zd_broken.down.sql'), 'DROP TABLE IF EXISTS zd_ok;\n');
    });
    const dirCrash = variant(dirA, outRoot, 'zd-D-crashes', `${pkg.version}-crash`, (d) => { writeFileSync(join(d, 'src', 'server', 'index.js'), "console.error('simulated crash on start');\nprocess.exit(1);\n"); });
    const about = async () => (await (await fetch(`http://127.0.0.1:${port}/api/v1/core/about`, { headers: H })).json()).data;

    await record('deploy build A (first deploy, blue)', async () => { const r = await deployBlueGreen({ ...common, artifactDir: dirA }); expect(r.ok, r.reason); expect((await about()).buildId === 'zd-A', 'A is not served'); return `${r.durationMs} ms on ${r.slot}`; });
    await record('deploy build B to green and switch, under traffic (zero downtime)', () => under(async () => {
      const r = await deployBlueGreen({ ...common, artifactDir: dirB }); expect(r.ok, r.reason);
      await new Promise((res) => setTimeout(res, 1500));
      const a = await about(); expect(a.buildId === 'zd-B', 'B is not served'); expect(a.migrations.some((m) => m.id.includes('zd_notes')), 'B migration not applied');
      return `${r.durationMs} ms; switched to ${r.slot} at ${r.switchedAt}`;
    }));
    await record('roll back to A, under traffic (zero downtime)', () => under(async () => {
      const r = await rollbackBlueGreen({ ...common }); expect(r.ok && r.restored === 'zd-A', 'A not restored'); expect(r.undone === 'down-migrations', `expected down-migrations, got ${r.undone}`);
      const a = await about(); expect(a.buildId === 'zd-A', 'A is not served'); expect(!a.migrations.some((m) => m.id.includes('zd_notes')), 'B migration still applied');
      return `${r.durationMs} ms back to ${r.slot}, migrations ${r.undone}`;
    }));
    await record('drill: a failing migration leaves A serving, under traffic', () => under(async () => {
      const r = await deployBlueGreen({ ...common, artifactDir: dirBad }); expect(!r.ok && r.kept === 'zd-A', 'the failed deploy did not keep A');
      const a = await about(); expect(a.buildId === 'zd-A', 'A is not served'); expect(!a.migrations.some((m) => m.id.includes('zd_broken')), 'the broken migration is left applied');
      return `${r.durationMs} ms: ${r.reason.slice(0, 120)}`;
    }));
    await record('drill: a build that does not start leaves A serving, under traffic', () => under(async () => {
      const r = await deployBlueGreen({ ...common, artifactDir: dirCrash, smokeTimeoutMs: 5000 }); expect(!r.ok && r.kept === 'zd-A', 'the crashing deploy did not keep A');
      expect((await about()).buildId === 'zd-A', 'A is not served');
      return `${r.durationMs} ms: ${r.reason.slice(0, 120)}`;
    }));
    await record('zero failed requests through every switch', async () => {
      expect(totals.failures.length === 0, `${totals.failures.length} of ${totals.requests} requests failed: ${JSON.stringify(totals.failures.slice(0, 3))}`);
      return `${totals.requests} requests, 0 failed; ${readBlueGreen(p).history.length} switches`;
    });
  } catch { /* recorded */ } finally {
    if (load) await load.stop();
    await stopBlueGreen({ envName: 'staging', deployRoot });
    await proxy.close();
  }
  return { ok: steps.length === 6 && steps.every((s) => s.ok), steps, requests: totals.requests, failed: totals.failures.length };
}
