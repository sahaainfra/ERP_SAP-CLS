# Capacity plan (part 30.06 FR-04)

2026-11-23 · Measured with `scripts/load_test.mjs` against the real server (`src/server/index.js`, one process, SQLite in WAL mode on a local file). Lab machine: Linux, 4 vCPU shared by the server and the load generator, Node 24. Reports: `reports/load-*.json`; recorded runs: **Administration → Performance Test Results**.

## 1. What one API process carries (measured)

| Model | Load | Result |
|---|---|---|
| USERS alone | 1,000 people, one request every 5–15 s (about 100 requests/s) | p50 2–18 ms, p95 150–570 ms, no errors |
| PUNCH_BURST alone | 2,000 punches in 60 s, each from its own phone | p50 9 ms, p95 186 ms, 33.3 punches/s |
| LOAD (USERS + the burst, then DPRs, then month-end) | as above, together | users p50 7–22 ms, **p95 670–770 ms**; punch p95 814 ms; DPR p95 29 ms; month-end reports p95 45–872 ms; posting 84 ms; real-time 984 ms; no errors |
| Memory | LOAD | 366 MB at start, 730 MB at peak |

One process serves the users or the burst within the SLOs, but not both at once on this machine: the tails come from requests queueing behind the punch burst and the register recompute it triggers (D-814).

## 2. Fixes made in 30.06 (FR-03)

Each was found with a CPU profile of the server under load (`LOAD_CPU_PROF=<dir> node scripts/load_test.mjs --profile burst`). All are in the platform, and the schema change is one additive index (BR-01).

| Finding | Fix | Effect |
|---|---|---|
| Compiling statements: 8 of 40 busy seconds | Bounded cache of compiled statements in `instrumentDb`; `iterate` gets its own | removed from the profile |
| Attendance register recomputed for 2,000 people in one block | Worked off in slices of 20 people, with requests running between slices | punch p95 1.3 s → 186 ms (burst alone) |
| Attendance period label (`toLocaleString`) per person and day | Memo | 1 s → 0 |
| Navigation read and labelled on every request: 16 of 80 s | Rows kept per company while the registry is unchanged (checked each call) | menu p50 147 → 18 ms |
| 20,000-row list counted through the table | Index `core_sample_documents (company_id, is_active, id)` | list p50 225 → 4 ms |
| Bulk personal-data export answered 500 | Approval wired into the list exports (D-809) | 422 with the approval request |
| One address hit the per-address limit | The generator gives each phone its own address; sites sharing an address need a higher write limit (D-813) | — |

Result: under the full load, user p95 went from 25 s (first run) to 0.7 s, punch p95 from 7 s to 0.8 s, and errors from thousands to none.

## 3. Production sizing

| Item | Plan |
|---|---|
| API processes | **2** on a dedicated 4-vCPU host (no load generator on it), behind the reverse proxy with sticky sessions for sockets. SQLite in WAL allows concurrent readers; writes serialise (busy timeout 10 s). This gives roughly twice the measured throughput of one process. |
| Background work | Move the register recompute and the nightly jobs to a worker process (`startWorkers` only there), so that a burst never shares the event loop with user requests (D-814, 30.08). |
| Memory | 1 GB per API process (peak 730 MB under the load), plus 1 GB for the worker and the page cache of the database file. Host: 8 GB. |
| Database | WAL; `synchronous` stays FULL (a power loss must not lose a committed punch). Checkpoint after the morning burst. Disk: SSD with at least 3× the database size free for backups (`VACUUM INTO`). |
| Rate limits | Writes 900 a minute per address by default. A site whose phones share one address (site Wi-Fi) has its limit raised to 3,000 by a security settings change at cut-over (D-813). |
| Growth | Every 500 more concurrent users or 1,000 more punches a minute: one more API process, up to the 4 vCPU; beyond that a larger host. When writes reach about 300 a second sustained, plan the move to a server database. |
| Imports | Excel files above 2,000 rows run as background jobs; the streaming reader is D-248 (30.08). |

## 4. How it is kept true

- **Every change:** the CI job `perf-smoke` runs the smoke profile and `scripts/perf_verdict.mjs` fails the build on a missed SLO.
- **Every night:** `.github/workflows/perf.yml` runs the load profile, and every Sunday the 8-hour soak (D-810). The results are posted to the Performance Test Results page of the installation named by `ERP_PERF_URL`.
- **SLOs:** these are parameters `tst.perf.*`, changed only through a Control Center change that a second administrator approves.
- **Staging:** the k6 scripts (`perf/k6/models.js`) run the same models against a staging installation once one exists (D-009, D-811).
