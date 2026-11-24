# 09 — Remediation plan (aligned to gates G1–G8)

The programme's gates are the eight in `docs/erp/PROGRESS.csv`. No other gate system is used here. `docs/erp/GATES/` holds evidence files for G1–G4 only, and none is signed (D-693).

| Gate | Parts (distinct) | Status |
|---|---|---|
| G1 — Platform | 54 | All Ready for review |
| G2 — Workforce-First | 14 | All Ready for review |
| G3 — Project Baseline | 28 | All Ready for review |
| G4 — Execution | 54 | All Ready for review |
| G5 — Commercial & Finance | 44 | 42 Ready for review, 2 In progress |
| G6 — Extended Enterprise | 8 | All In progress |
| G7 — Intelligence | 16 | All In progress |
| G8 — Go-Live | 18 | All In progress |

The plan orders the work by what blocks a gate sign-off. It does not fix anything: fixes wait for approval of this audit (audit rule). Effort estimates are rough (S < 1 day, M 1–3 days, L > 3 days), for one developer who knows the code.

## Step 0 — before any further gate is signed (blocks every gate)

| # | Finding | Action | Effort |
|---|---|---|---|
| 0.1 | AUD-DEF-012 (High) | Fix the cross-company leak in `hr/performance.js`. Add a scope test for the route. | S |
| 0.2 | AUD-DEF-013 | Fix the expense policy history leak. Then re-run the cross-company probe (`evidence/p5-cross-company-probe.mjs.txt`) over every `/:id` route and make it a permanent test. | S |
| 0.3 | AUD-DEF-007 (High) | The configuration guard must refuse dev-headers when `ERP_ENVIRONMENT` is staging or production. The deploy scripts must take `AUTH_MODE` and `NODE_ENV` from the target environment file. | S |
| 0.4 | AUD-DEF-001, AUD-DEF-020 (High) | Make CI run again: restore Actions minutes or add a runner, and split `verify` into jobs that fit their timeouts. Until CI passes, no completion report should say "CI runs the gate". | M |
| 0.5 | AUD-DEF-014, AUD-DEF-015, AUD-DEF-022–035 (14 E2E failures) | Make the local gate green:<br>• split the Hindi catalogue;<br>• fix the backup check race;<br>• re-run each failing E2E test alone, then fix it or record it in `DEFECTS.md` with an owner. Start with test isolation in the shared E2E database. | M |
| 0.6 | AUD-DEF-018 | Make the performance baseline measure again: suspend the rate limiter in the harness, then store a reviewed new baseline. | S |

## G1 — Platform Gate (Ready for review; sign-off pending, D-693)

- AUD-DEF-003: extend the architecture test to `index.js` route blocks and service files. Move SQL out of mount files over time. (M)
- AUD-DEF-008: the permission baseline needs a separate reviewed change, through CODEOWNERS or an approval record. (S)
- AUD-DEF-009 / D-002: make flag maker-checker unconditional in staging and production. (S)
- AUD-DEF-010 / D-031: connect ClamAV, and refuse PDFs with active content. (M)
- AUD-DEF-016 / D-163: translate the platform and IAM pages first: core 654 strings, iam 648, ui 414. (L)
- AUD-DEF-006: re-review the threat model, including sockets and portals. (S)
- AUD-DEF-017: write E2E screenshots to an ignored folder. (S)

## G2–G4 (Ready for review)

- AUD-DEF-016: translate the hr (722) and eng (1,471) strings. Field pages are already mostly translated. (L)
- AUD-DEF-019: add a permission to `/admin/holidays`, `/controls/exceptions` and `/bi/leakage`. (S)
- AUD-DEF-005: document the hse, plant, site and qa routes in OpenAPI, or generate it from `ROUTE_POLICY`. (M)

## G5 — Commercial & Finance

- AUD-DEF-002: remove the duplicate 23.01–23.03 rows in PROGRESS.csv. (S)
- AUD-DEF-011: cap `pageSize` at 200 in bill and fin. (S)
- AUD-DEF-005: document the bill, fin, ctr and rmc routes in OpenAPI. (M)
- AUD-DEF-021: add API-driven integration tests for IT-02 and IT-06 (procure-to-pay, measure-to-cash). (M)
- Existing D-744: run the IRP / e-way bill integration against the real portal sandbox. (M)
- Existing D-747 and D-748: confirm the statutory rates, with the customer's payroll consultant. (M)

## G6 — Extended Enterprise (portals, commissioning, closeout)

- AUD-DEF-004 and D-762–D-765: register the `close/` module, then build the routes and pages of M26. (L)
- D-759 and D-761: build the subcontractor and client portal functions. (L)
- D-756 and D-758: portal production acceptance. (M)

## G7 — Intelligence (BI, AI)

- D-766–D-768: governed datasets, scheduling, certification workflows. (L)
- Hindi chunk size (AUD-DEF-014) grows with every BI page; plan the per-module catalogue first. (S)

## G8 — Go-Live

- **D-009: there is no staging or production host** (see 11-production-readiness). Choose and provision hosts, then run the deploy, the backup, `db:restore` and the rollback on them. (L)
- D-010 and AUD-DEF-001: branch protection with required checks. (S, plan change)
- D-812: independent penetration test and mobile review. (external)
- D-814 and D-811: load test on the real host with k6. (M)
- D-818: UAT by business users with owners' sign-off, cut-over, and hypercare. (customer event)
- Sign G1–G8 in the application by the named reviewers (D-693, D-817). (M)
