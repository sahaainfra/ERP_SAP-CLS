// Part 30.06 FR-01 FR-02: the load models in k6, for a staging installation seeded like scripts/load_test.mjs (2,000 employees lw0…,
// a site for punches, DPR sites). Environment: BASE_URL, SITE_ID, DPR_SITES (comma-separated ids), PROFILE (smoke|load|stress),
// TOKEN (a bearer token) or, on a development or sandbox installation, the development headers.
//   k6 run -e BASE_URL=https://staging.example.com -e SITE_ID=1 -e DPR_SITES=2,3,4 -e PROFILE=load perf/k6/models.js
// The summary (k6 --summary-export=k6.json) becomes a load report with: node perf/k6/summary.mjs k6.json > reports/load-k6.json
/* global __ENV, __VU, __ITER */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:3000';
const SITE = Number(__ENV.SITE_ID || 1);
const DPR_SITES = (__ENV.DPR_SITES || '2').split(',').map(Number);
const PROFILE = (__ENV.PROFILE || 'smoke').toLowerCase();
const SCALE = { smoke: 0.02, load: 1, stress: 2 }[PROFILE] ?? 0.02;
const TODAY = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const list = new Trend('erp_list', true); export const record = new Trend('erp_record', true); export const save = new Trend('erp_save', true);
export const report = new Trend('erp_report', true); export const punch = new Trend('erp_punch', true); export const errors = new Counter('erp_errors');

export const options = {
  scenarios: {
    users: { executor: 'constant-vus', exec: 'users', vus: Math.max(1, Math.round(1000 * SCALE)), duration: PROFILE === 'smoke' ? '30s' : '4m' },
    punch_burst: { executor: 'shared-iterations', exec: 'punchIn', vus: Math.max(1, Math.round(200 * SCALE)), iterations: Math.max(1, Math.round(2000 * SCALE)), maxDuration: '60s', startTime: '10s' },
    dpr_burst: { executor: 'shared-iterations', exec: 'dpr', vus: Math.max(1, Math.round(20 * SCALE)), iterations: Math.max(1, Math.round(200 * SCALE)), maxDuration: '60s', startTime: '80s' },
    month_end: { executor: 'constant-vus', exec: 'monthEnd', vus: Math.max(1, Math.round(10 * SCALE)), duration: '60s', startTime: '150s' },
  },
  thresholds: { erp_list: ['p(95)<500'], erp_record: ['p(95)<300'], erp_save: ['p(95)<800'], erp_report: ['p(95)<3000'], erp_punch: ['p(95)<800'], erp_errors: ['count<1'] },
};
const headers = (user, roles) => (__ENV.TOKEN ? { authorization: `Bearer ${__ENV.TOKEN}`, 'content-type': 'application/json' } : { 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': __ENV.COMPANY || '1', 'content-type': 'application/json' });
const ok = (r) => { const good = check(r, { 'no error': (x) => x.status < 400 }); if (!good) errors.add(1); return r; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function users() {
  const h = { headers: headers(`k6u${__VU}`, 'PM,CM,HRMGR') };
  const lists = ['/api/v1/core/sample-documents?page=1&pageSize=25', '/api/v1/hr/employees?page=1&pageSize=25', '/api/v1/site/dprs?page=1&pageSize=25', `/api/v1/att/punches?siteId=${SITE}&date=${TODAY}`, '/api/v1/workflow/tasks?mine=assigned'];
  const records = ['/api/v1/core/session', '/api/v1/ui/navigation', `/api/v1/hr/employees/${1 + Math.floor(Math.random() * 2000)}`];
  if (Math.random() < 0.6) list.add(ok(http.get(BASE + pick(lists), h)).timings.duration); else record.add(ok(http.get(BASE + pick(records), h)).timings.duration);
  sleep(PROFILE === 'smoke' ? 1 : 5 + Math.random() * 10);
}
export function punchIn() {
  const i = __ITER + (__VU - 1) * 1000;
  const r = ok(http.post(`${BASE}/api/v1/att/punches`, JSON.stringify({ siteId: SITE, punchType: 'IN', deviceTime: new Date().toISOString(), lat: 17.385, lng: 78.4867, accuracyM: 12, deviceId: `k6-${i}`, clientUuid: `k6-${Date.now()}-${i}` }), { headers: { ...headers(`lw${i % 2000}`, 'EMP'), 'idempotency-key': `k6p-${Date.now()}-${i}` } }));
  punch.add(r.timings.duration);
}
export function dpr() {
  const r = ok(http.post(`${BASE}/api/v1/site/dprs`, JSON.stringify({ siteId: DPR_SITES[(__ITER + __VU) % DPR_SITES.length], dprDate: TODAY, supervisor: `k6 ${__VU}` }), { headers: { ...headers(`k6se${__VU}`, 'SE'), 'idempotency-key': `k6d-${Date.now()}-${__VU}-${__ITER}` } }));
  save.add(r.timings.duration);
}
export function monthEnd() {
  const h = { headers: headers(`k6me${__VU}`, 'SYSADM,CFO,HRMGR,PM') };
  const paths = [`/api/v1/att/register?period=${TODAY.slice(0, 7)}-01&siteId=${SITE}`, '/api/v1/fin/trial-balance', `/api/v1/att/daily?date=${TODAY}`, '/api/v1/core/events?page=1&pageSize=100'];
  report.add(ok(http.get(BASE + pick(paths), h)).timings.duration);
}
