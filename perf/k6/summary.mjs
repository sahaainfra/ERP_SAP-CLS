#!/usr/bin/env node
// Part 30.06: turns a k6 summary (k6 run --summary-export=k6.json perf/k6/models.js) into a load report that scripts/perf_verdict.mjs
// judges and POST /api/v1/tst/perf/runs records (tool K6).   node perf/k6/summary.mjs k6.json [profile] > reports/load-k6.json
import { readFileSync } from 'node:fs';
const [file, profile = 'LOAD'] = process.argv.slice(2);
const k = JSON.parse(readFileSync(file, 'utf8'));
const m = k.metrics ?? {};
const trend = (name, model, journey, sloKind) => { const t = m[name]; if (!t) return null; return { model, journey, sloKind, requests: t.count ?? 0, errors: 0, p50: t.med ?? 0, p95: t['p(95)'] ?? 0, p99: t['p(99)'] ?? t['p(95)'] ?? 0, max: t.max ?? 0, throughputRps: t.rate ?? 0 }; };
const results = [trend('erp_list', 'USERS', 'Lists (k6)', 'LIST'), trend('erp_record', 'USERS', 'Records (k6)', 'RECORD'), trend('erp_punch', 'PUNCH_BURST', 'Punch in (k6)', 'BURST'), trend('erp_save', 'DPR_BURST', 'Create a DPR (k6)', 'SAVE'), trend('erp_report', 'MONTH_END', 'Month-end reports (k6)', 'REPORT')].filter(Boolean);
const errors = m.erp_errors?.count ?? 0; if (errors && results[0]) results[0].errors = errors;
const now = new Date().toISOString();
process.stdout.write(`${JSON.stringify({ profile: profile.toUpperCase(), tool: 'K6', environment: 'staging', machine: 'k6', startedAt: now, finishedAt: now, users: m.vus_max?.max ?? 0, results }, null, 2)}\n`);
