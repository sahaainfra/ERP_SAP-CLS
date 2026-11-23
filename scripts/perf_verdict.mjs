#!/usr/bin/env node
// Part 30.06 T-01: the verdict of a load report (scripts/load_test.mjs or perf/k6/summary.mjs) against the default SLOs — list 500 ms,
// record 300 ms, save 800 ms, report 3 s, real-time 2 s at p95, the punch burst 2,000 a minute, a soak growing less than 10 %.
// Usage: node scripts/perf_verdict.mjs reports/load-load.json   (exit 1 when a journey misses its SLO)
import { readFileSync } from 'node:fs';
import { judgeRun } from '../src/server/modules/tst/perf.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/perf_verdict.mjs <report.json>'); process.exit(2); }
const report = JSON.parse(readFileSync(file, 'utf8'));
const { judged, mem, result } = judgeRun(report);
for (const x of judged) console.log(`${x.status === 'PASS' ? 'PASS' : 'FAIL'}  ${x.model.padEnd(12)} ${x.journey.padEnd(54)} p95 ${String(x.p95).padStart(8)} ms / ${x.sloMs} ms  errors ${x.errors}${x.targetRps ? `  rate ${x.throughputRps}/s of ${x.targetRps}/s` : ''}`);
if (mem) console.log(`memory ${report.memory.startMb} → ${report.memory.endMb} MB (max ${report.memory.maxMb}); growth after warm-up ${mem.growthPct ?? '—'} %, ${mem.slopeMbPerHour ?? '—'} MB/h`);
console.log(`${report.profile}: ${result}`);
process.exit(result === 'PASS' ? 0 : 1);
