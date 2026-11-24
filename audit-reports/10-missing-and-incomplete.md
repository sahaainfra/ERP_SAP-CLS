# 10 — Missing and incomplete items

Commit `ed225efd`. "Missing" means no code was found. "Incomplete" means code exists, but a part of the requirement, its interface, or its proof does not.

## Missing

| Item | Evidence | Reference |
|---|---|---|
| Staging and production hosts | No host is configured; the deploy is rehearsed in directories on one machine | D-009 |
| API and pages for project closeout (M26) | `src/server/modules/close/` is not registered; no route or page | AUD-DEF-004, D-762–D-765 |
| Subcontractor portal functions (work orders, measurements, bills, compliance) | "await implementation" | D-759 |
| Client and consultant portal functions (dashboards, certification, snag review) | "await implementation" | D-761 |
| Governed BI datasets, pivots, report publishing | "await implementation" | D-767, D-768 |
| Real anti-virus (ClamAV) | The built-in scanner finds only the EICAR string | D-031 |
| Alert delivery by email and WhatsApp | Alerts are recorded, not sent | D-047 |
| Integration test driving a thread through the API | Threads are checked on seeded records | D-800, AUD-DEF-021 |
| Thread for planning → management report, and for WorkChat → approval | Not in `tst/threads.js` | AUD-DEF-021 |
| Gate evidence files for G5–G8 | `docs/erp/GATES/` has G1–G4 only; `hr_gates` accepts G1–G4 | D-817 |
| `docs/erp/PHASED_WORKFLOW.md` (named in the audit prompt) | File does not exist | 01-repository-inventory §8 |
| OpenAPI for 1,522 routes | Drift check | AUD-DEF-005 |

## Incomplete

| Item | What is missing | Reference |
|---|---|---|
| Parts 25.01–30.10 (44 parts, gates G6–G8 and two G5 parts) | "In progress" in PROGRESS.csv | 03-module-status |
| Translation | About 5,410 hard-coded English strings | AUD-DEF-016, D-163 |
| CI | Defined, but has not completed since 2026-10-31 | AUD-DEF-001, AUD-DEF-020 |
| Branch protection | Not enforced | D-010 |
| Gate sign-off | G1–G4 evidence exists but none is signed | D-693 |
| Feature-flag maker-checker | Only when the Control Center is on | AUD-DEF-009, D-002 |
| Five-layer architecture | Repositories in 11 of 32 services | AUD-DEF-003 |
| Offline field forms | GRN at the gate and gang attendance online only | D-674 |
| Statutory payroll | Rates and due dates seeded as TO_CONFIRM; payment release integration pending | D-747, D-748 |
| e-Invoice / e-way bill | Tested against a simulated portal only | D-744 |
| Performance targets | 166.4 T-02 and 30.06 T-01 not met on the lab machine; k6 not run | D-683, D-814, D-811 |
| Security review | No independent penetration test | D-812 |
| UAT and cut-over | Customer event, not done | D-818 |
| Threat model | Out of date | AUD-DEF-006 |
| Visual baselines | Drift on this run | 02-gate-baseline, AUD-DEF-022 on |

## Not verified in this audit

| Item | Why |
|---|---|
| Behaviour on real Android and iOS devices | Only emulated devices are available (D-146) |
| Production data quality | No production database exists; `db-check --fresh` ran on an empty database |
| Every one of the 1,331 interpolated SQL statements | A sample of the riskiest was traced (04 check 11) |
| Duplicate code | No detector installed; installing one would change the lockfile |
| The cause of the CI start failures since 2026-11-16 | Account and billing settings are not readable from here |
| The load SLOs | See 02-gate-baseline for the perf baseline run on this machine |
