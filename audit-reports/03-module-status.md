# 03 — Module status (Phase 3)

Commit `ed225efd`. One row per programme module (M00–M30, `docs/erp/ARCHITECTURE.md`).

**Definitions.** A "feature" is a part in `docs/erp/PROGRESS.csv`. There are 236 distinct parts; the duplicate rows of 23.01–23.03 are counted once (AUD-DEF-002).

| Column | Meaning |
|---|---|
| Implemented | The part is "Ready for review", and its code and completion report exist |
| Partial | The part is "In progress" |
| Broken | The part has a test that failed in this audit's runs (unit stage 4 or E2E) |
| Missing | The part is "Not started" with no code. There are none. |
| Not verified | No test in the repository's test catalogue names the part (`partId`). Its status rests on its completion report alone. |

**Tests.** Tests are counted per catalogue entry (`scanCatalogue()` of part 30.04: one entry per `test(...)` in `tests/` and `e2e/`), and mapped to a module through their part. 89 catalogue entries have no part and are not in the table.

- **Unit columns:** results of stage 4 (`evidence/05-test-coverage.log`). The only failure is `tests/ops-zero-downtime.test.js`, under part 30.08.
- **E2E columns:** results of the E2E run (`evidence/19-test-e2e.log`). A catalogue entry counts once; the run executes it in the desktop and the mobile project. It counts as failed if either project failed it.
  - The line reporter names failures only, so "E2E passed" means *not failed*. It includes the tests skipped by a condition (55 `test.skip` calls by project or by the `SHOTS` switch).
  - The exact passed, skipped and flaky totals of the run are in 02-gate-baseline.
  - "E2E not executed" is non-zero only while the run is incomplete.
- **Not verified parts:** 166.6 (M07), 26.03 and 26.04 (M26), 27.01–27.03 (M27).

The open-defect counts per module (from `docs/erp/DEFECTS.md`, by target part) are in the last section.

| Module | Name | Features (parts) | Implemented | Partial | Broken | Missing | Not verified | Unit passed | Unit failed | E2E passed (not failed) | E2E failed | E2E not executed | Broken parts |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| M00 | Programme Discovery and Engineering Baseline | 4 | 4 | 0 | 0 | 0 | 0 | 79 | 0 | 8 | 0 | 0 | — |
| M01 | Core Architecture and Platform Services | 9 | 8 | 1 | 1 | 0 | 0 | 231 | 0 | 24 | 1 | 0 | 01.02 |
| M02 | Identity, Organisation, Security and Access Control | 7 | 7 | 0 | 1 | 0 | 0 | 127 | 0 | 27 | 1 | 0 | 02.03 |
| M03 | Design System, Application Shell and UX Framework | 13 | 13 | 0 | 1 | 0 | 0 | 159 | 0 | 62 | 1 | 0 | 03.10 |
| M04 | Shared Business Engines | 15 | 15 | 0 | 1 | 0 | 0 | 179 | 0 | 47 | 1 | 0 | 04.05 |
| M05 | Collaboration and Messaging | 5 | 5 | 0 | 0 | 0 | 0 | 40 | 0 | 15 | 0 | 0 | — |
| M06 | Master Data | 7 | 6 | 1 | 0 | 0 | 0 | 45 | 0 | 18 | 0 | 0 | — |
| M07 | HR and Workforce Management | 15 | 15 | 0 | 1 | 0 | 1 | 90 | 0 | 20 | 1 | 0 | 07.06 |
| M08 | CRM, Business Development and Tendering | 3 | 3 | 0 | 0 | 0 | 0 | 15 | 0 | 3 | 0 | 0 | — |
| M09 | Estimation and Quantity Take-off | 3 | 3 | 0 | 0 | 0 | 0 | 9 | 0 | 3 | 0 | 0 | — |
| M10 | Project Setup, WBS and BOQ | 8 | 8 | 0 | 0 | 0 | 0 | 33 | 0 | 8 | 0 | 0 | — |
| M11 | Engineering, Drawings and Technical Documents | 5 | 5 | 0 | 0 | 0 | 0 | 21 | 0 | 10 | 0 | 0 | — |
| M12 | Budgeting and Cost Control | 4 | 4 | 0 | 0 | 0 | 0 | 32 | 0 | 4 | 0 | 0 | — |
| M13 | Planning and Scheduling | 5 | 5 | 0 | 0 | 0 | 0 | 26 | 0 | 5 | 0 | 0 | — |
| M14 | Site Execution and Progress Control | 8 | 8 | 0 | 1 | 0 | 0 | 43 | 0 | 22 | 1 | 0 | 166.3 |
| M15 | Procurement | 10 | 10 | 0 | 0 | 0 | 0 | 60 | 0 | 14 | 0 | 0 | — |
| M16 | Stores, Inventory and Site Logistics | 11 | 11 | 0 | 0 | 0 | 0 | 66 | 0 | 12 | 0 | 0 | — |
| M17 | Plant, Machinery and Equipment | 8 | 8 | 0 | 0 | 0 | 0 | 47 | 0 | 8 | 0 | 0 | — |
| M18 | Quality Management | 7 | 7 | 0 | 0 | 0 | 0 | 25 | 0 | 7 | 0 | 0 | — |
| M19 | HSE and Site Security | 8 | 8 | 0 | 0 | 0 | 0 | 54 | 0 | 8 | 0 | 0 | — |
| M20 | Batching Plant and RMC | 3 | 3 | 0 | 0 | 0 | 0 | 11 | 0 | 3 | 0 | 0 | — |
| M21 | Contracts, Subcontracts and Commercial | 7 | 7 | 0 | 0 | 0 | 0 | 28 | 0 | 7 | 0 | 0 | — |
| M22 | Measurement and Billing | 9 | 9 | 0 | 0 | 0 | 0 | 43 | 0 | 9 | 0 | 0 | — |
| M23 | Finance and Accounting | 15 | 15 | 0 | 0 | 0 | 0 | 49 | 0 | 15 | 0 | 0 | — |
| M24 | Payroll and Statutory Compliance | 5 | 5 | 0 | 0 | 0 | 0 | 19 | 0 | 5 | 0 | 0 | — |
| M25 | External Portals | 4 | 0 | 4 | 0 | 0 | 0 | 6 | 0 | 1 | 0 | 0 | — |
| M26 | Commissioning, Handover and Closeout | 4 | 0 | 4 | 0 | 0 | 2 | 2 | 0 | 0 | 0 | 0 | — |
| M27 | Reporting, BI and Control Towers | 11 | 0 | 11 | 0 | 0 | 3 | 24 | 0 | 9 | 0 | 0 | — |
| M28 | AI and Intelligent Automation | 5 | 0 | 5 | 0 | 0 | 0 | 19 | 0 | 5 | 0 | 0 | — |
| M29 | Administration, Integration and Data Operations | 8 | 0 | 8 | 0 | 0 | 0 | 34 | 0 | 8 | 0 | 0 | — |
| M30 | System Integration, Quality Assurance and Go-Live | 10 | 0 | 10 | 4 | 0 | 0 | 61 | 1 | 5 | 3 | 0 | 30.01, 30.07, 30.08, 30.10 |
| **Total** | | **236** | **192** | **44** | **10** | **0** | **6** | **1677** | **1** | **392** | **9** | **0** | |


## Notes per module

- **M23:** all 15 parts are implemented. PROGRESS.csv also has stale "Not started" copies of 23.01–23.03 (AUD-DEF-002).
- **M25–M30:** every part is In progress, as recorded. M26 (closeout) has evidence-reading code in `src/server/modules/close/`, but no registered module, route or page (AUD-DEF-004).
- **M30:** these parts were built in this session (conflict of interest, see README). Four of its parts are broken in this audit's runs:
  - 30.08: the unit zero-downtime drill (AUD-DEF-015);
  - 30.01, 30.07 and 30.10: E2E specs (02-gate-baseline).
- **Broken parts elsewhere:** they come from E2E failures, and several of those look like data left by earlier tests in the shared E2E database (02-gate-baseline). "Broken" here means a test failed in this run. It does not mean the feature was confirmed broken.
- **Unmapped failure:** `e2e/operations-health.spec.js` also failed, on mobile. It names no part, so it is not in any row.
- **Not verified:** six parts have no catalogue test: one in M07, two in M26, three in M27. Their status rests on their completion report.

## Open defects by module (docs/erp/DEFECTS.md, by target part)

| Module | Open | Module | Open | Module | Open |
|---|---|---|---|---|---|
| M00 | 6 | M01 | 13 | M02 | 31 |
| M03 | 59 | M04 | 80 | M05 | 26 |
| M06 | 34 | M07 | 40 | M08 | 5 |
| M09 | 5 | M10 | 15 | M11 | 2 |
| M12 | 11 | M13 | 5 | M14 | 11 |
| M15 | 12 | M16 | 1 | M17 | 3 |
| M18 | 0 | M19 | 5 | M20 | 0 |
| M21 | 5 | M22 | 2 | M23 | 33 |
| M24 | 9 | M25 | 6 | M26 | 4 |
| M27 | 6 | M28 | 1 | M29 | 0 |
| M30 | 0 | cross-module | 209 | steady-state | 61 |
| other | 60 |  |  |  |  |
