// PACK-01: measures event-loop blocking in any Node process that preloads it, without changing the application.
//
//   PROBE_DIR=reports/probe NODE_OPTIONS=--import=./pack-reports/tools/event_loop_probe.mjs node <anything>
//
// Every 2 s, and at exit, it writes <PROBE_DIR>/<pid>.json: the process's command line, the event-loop delay over the whole run
// (mean, p50, p99, max, from perf_hooks.monitorEventLoopDelay at 10 ms resolution) and the worst 1-second windows (the longest
// stall seen in each window). A long stall means synchronous work (a SQLite query, a PDF, a spreadsheet) held the loop, and every
// other request on that process waited for it.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.PROBE_DIR;
if (dir) {
  mkdirSync(dir, { recursive: true });
  const all = monitorEventLoopDelay({ resolution: 10 }); all.enable();
  const win = monitorEventLoopDelay({ resolution: 10 }); win.enable();
  const windows = [];
  const ms = (ns) => Math.round((ns / 1e6) * 10) / 10;
  const startedAt = Date.now();
  const tick = setInterval(() => { windows.push({ t: Math.round((Date.now() - startedAt) / 1000), maxMs: ms(win.max), p99Ms: ms(win.percentile(99)) }); win.reset(); }, 1000);
  tick.unref();
  const write = () => {
    const worst = [...windows].sort((a, b) => b.maxMs - a.maxMs).slice(0, 20);
    writeFileSync(join(dir, `${process.pid}.json`), JSON.stringify({
      pid: process.pid, argv: process.argv.slice(1).join(' '), seconds: Math.round((Date.now() - startedAt) / 1000),
      meanMs: ms(all.mean), p50Ms: ms(all.percentile(50)), p99Ms: ms(all.percentile(99)), maxMs: ms(all.max),
      windowsOver100ms: windows.filter((w) => w.maxMs > 100).length, windowsOver1000ms: windows.filter((w) => w.maxMs > 1000).length, windows: windows.length, worst,
    }, null, 1));
  };
  const flush = setInterval(write, 2000); flush.unref();
  process.on('exit', write);
  // write on a signal, then leave the process to its own handlers; if the probe is the only listener, re-raise the signal so the
  // process still ends the way it would have without the probe
  for (const sig of ['SIGTERM', 'SIGINT']) {
    const onSig = () => { write(); if (process.listenerCount(sig) === 1) { process.removeListener(sig, onSig); process.kill(process.pid, sig); } };
    process.on(sig, onSig);
  }
}
