# 07 — Cross-module integration (Phase 7)

Commit `ed225efd`. The repository's own integration model is the 15 threads of part 30.01 (`src/server/modules/tst/threads.js`): IT-01 … IT-15, each a chain of hand-offs (table to table by foreign key, carried-over fields, events).

`tests/tst-integration.test.js` T-01 checks every mandatory thread end to end and passed in the full regression. Per D-800, it builds each thread from seeded records of the owners' tables and verifies hand-offs, fields and events. It does not drive each step through the public API; each step's API is covered by that module's own tests. Of 363 producer-to-consumer edges, 141 have no test naming their event or consumer.

**Status of each flow below:**

- **Verified:** a test executed in this session passed, and the code path was read.
- **Not Verified:** no test exercises it, or the test failed.
- **Missing:** no code.

| # | Flow (audit prompt) | Repository thread | Steps and their tests | Status |
|---|---|---|---|---|
| 1 | Project creation → budget → procurement → inventory → accounting | IT-01 (tender → estimate → award → project → BOQ → budget → schedule → work authorisation); IT-12 (purchase order → budget commitment → actual cost); IT-02 (… GRN → vendor invoice → AP bill → payment) | Project and BOQ: `tests/proj*`, `tests/boq*`. Budget: `tests/bud*`. Procurement: `tests/proc-*` (`po-p1505`). Inventory: `tests/grn-p1603*`. Accounting: `tests/gl-p2301`, `tests/posting-p2302`, `tests/ap-p2303`. All passed in the full regression. | **Verified** at thread level (seeded records) and per-step API tests. Not driven end to end through the API in one test (D-800). |
| 2 | Staff onboarding → attendance → approval → payroll | IT-04 (attendance → payroll → posting and salary transfer) | Onboarding: `tests/onboarding*`, `tests/employees*`. Attendance: `tests/attendance*`, `tests/punch*`. Regularisation approval: `tests/att-requests*`. Payroll: `tests/pay-p2401`–`p2405`. All passed. | **Verified** (same caveat) |
| 3 | BOQ → measurement → RA bill → client receivable | IT-06 (inspection request → measurement → RA bill → certification → tax invoice → receivable → receipt); IT-15 (DPR → measurement book) | `tests/bill-mb*`, `tests/clientbill*`, `tests/bill-ledger.test.js`, `tests/ar-p2305*`. All passed. | **Verified** (same caveat) |
| 4 | Procurement request → approval → PO → GRN → vendor payment | IT-02 (11 hand-offs) | `tests/proc-*`, `tests/grn-*`, `tests/vinv*`, `tests/ap-p2303`, `tests/pmt*`. All passed. | **Verified** (same caveat) |
| 5 | Machinery operation → fuel → maintenance → cost allocation | IT-05 (plant allocation → log book → fuel → cost); IT-14 (hire agreement → hire bill → vendor invoice) | `tests/plant-fuel*`, `tests/plant-maint*`, `tests/plant-alloc*`, `tests/plant-log*`. All passed. | **Verified** (same caveat) |
| 6 | Planning → progress → S-curve → management report | IT-03 (work authorisation → material → DPR → reconciliation); progress and S-curve in `site-progress`, `plan-*`; reports in `bi-*` | `tests/site-progress.test.js`, `tests/plan-*`, `tests/bi-morning-report.test.js`, `tests/bi-*`. All passed. | **Verified** at module level. No thread links the S-curve to the management report. |
| 7 | WorkChat → notifications → tasks → approval workflow | none (not a thread) | `tests/comcenter*`, `tests/messages*`, `tests/notifications*`, `tests/tasks*`, `tests/workflow-*`. All passed. The 30.01 latency probe (event → bus → room → notification within 2 s) passed (`tst-integration` FR-02). | **Verified** per module. **Not Verified** as one flow: no test follows a chat message into a task and an approval. |

The E2E specs that touch these flows are listed in 02-gate-baseline with their result in this run. A failing spec there downgrades the browser side of its flow.

## Findings

- **AUD-DEF-021 (Low):** no integration test drives a whole thread through the public API (D-800), and flows 6 and 7 have no thread at all. Recommendation: add one API-driven happy path per thread, starting with IT-02 and IT-06 (money).
