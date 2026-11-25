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

## Step 0 outcome (approved by the owner after the audit, 2026-11-24)

Each fix has a test that fails on the code before it, and each is recorded in `docs/erp/DEFECTS.md`. Commits are on `ccr-a3b3ce3d-65llwf`.

| # | Finding | Fix | Commit | Record |
|---|---|---|---|---|
| 0.1 | AUD-DEF-012 cross-company leak of a team member. The audit missed the KPI history, which leaked the same way. | The person or KPI is read in the caller's company first (404 otherwise). | `9a02d0f5` | D-819 |
| 0.2 | AUD-DEF-013 expense policy history | Same fix. A permanent probe, `npm run erp:scope-probe`, asks every `/:id` and list route as a new company on a copy of the E2E database. It is a regression stage and a CI step. It found all three leaks on the old code and none after the fix. | `9a02d0f5` | D-820 |
| 0.3 | AUD-DEF-007 dev-headers in production | The configuration refuses dev-headers when `NODE_ENV` or `ERP_ENVIRONMENT` is staging or production. Staging and production deploys start live (`AUTH_MODE=iam`, secrets from the shell, smoke test with `ERP_SMOKE_TOKEN`) unless `--rehearsal`. | `9a02d0f5` | D-821 |
| 0.4 | AUD-DEF-020 CI timeout | `unit`, `client` and 8 `e2e` shards run as separate jobs; `verify` gates on all of them. **Not yet run on GitHub**: Actions jobs of the repository fail before starting (AUD-DEF-001, an account matter). | `9a02d0f5` | D-822 |
| 0.5 | AUD-DEF-014 bundle budget | The Hindi text is one file per area, fetched in parallel. The bundle budget passes. | `9a02d0f5` | D-823 |
| 0.5 | AUD-DEF-015 backup race | Counts are taken before and after the copy. Passed 3 of 3 runs under full CPU load with coverage. | `9a02d0f5` | D-824 |
| 0.6 | AUD-DEF-018 perf harness | The limiter is suspended in the harness. New baseline: 0 errors, every journey within its standard. | `9a02d0f5` | D-825 |
| 0.5 | AUD-DEF-022–035, the 14 E2E failures | See below | `7131c966`, `f8c7edbb`, `3634472a`, `b8d22a90` | D-826–D-832 |

### E2E triage

**Root causes found and fixed:**

- **Fixture leaving dangling references.** The integration-thread fixture, `bill-vinv` and `ctr-variations` wrote rows pointing at records they never created. The data-health check of later specs then failed. A unit test now keeps the thread fixture clean.
- **Real defect: self-service request form.** The form sent no employee when typed into before the person's profile arrived, and the refusal was silent (D-827).
- **Out-of-date specs.**
  - The page-audit row count had not followed the 30.04–30.10 pages.
  - The dry-run start runs a full backup, which can take longer than 5 seconds.
- **Timing.**
  - The device matrix pressed Tab while the home page was still drawing. The focus loss itself stays open as D-828 (Low).
  - The field spec wrote to the database without waiting for the server's lock.

**Found during the re-runs:**

- Two React key warnings: the dashboard inventory listed the role dashboard twice (D-831), and the claim evidence fragment had no key (D-832). Both fixed.

**Not reproduced:**

- Accountability, operations health and users passed in every run since the triage.

**Still open:**

- The three visual-baseline failures (D-830). The baselines were last recorded on 2026-11-17, and 16 later commits changed the styles. Re-recording them accepts every visual change since that date at once, so a person must review the diffs. The audit session built several of those parts and did not approve its own changes.

### Gate after step 0

Code at `48f3002f`, the same 4-vCPU machine and Node 24.22.3 as the audit. Logs are in `evidence/s0-*`.

| Stage | Audit (`ed225efd`) | After step 0 | Evidence |
|---|---|---|---|
| Lint, type check, coverage gate, migrations, schema lint, tokens, icons, navigation, routes, permissions, defect register, integrity suite, schema-diff, golden, secret scan | Pass | Pass | `s0-regression-no-e2e.log` |
| Unit, API and permission tests with coverage | 1,735 / 1,736 (zero-downtime race) | 1 failure: the style-guide test, which still simulated production with header identities that the new guard refuses. It was fixed and passes. The zero-downtime test passed. Coverage: lines 97.72 %, branches 77.06 %. | `s0-regression-no-e2e.log` |
| Client build, installable app | Pass | Pass | full regression run |
| Bundle budget | **Fail** (Hindi 259.5 KB) | **Pass** (largest chunk 171.7 KB) | full regression run |
| E2E, 866 tests | 785 passed, **14 failed**, 67 skipped | 791 passed, **8 failed**, 67 skipped | `s0-e2e-full.log` |
| E2E, the 5 of those 8 whose fixes came during that run, re-run | — | data-health, operations health, plant hire, bill-vinv and ctr-variations: **32 / 32 passed** on desktop and mobile. ui-v3 sweep on desktop: **passed** (25.4 min). **All 5 confirmed.** | `s0-e2e-confirm.log`, `s0-e2e-uiv3.log` |
| Scope probe (new stage) on the data of the full run | — (the audit's one-off probe found 2 leaks) | **0 leaks**: 837 detail routes × ids 1–3, 1,445 list routes | `s0-scope-probe.log` |
| Performance baseline | Not a valid measurement (429s) | 0 errors; every journey within its standard | `docs/erp/perf/baseline.json` |

**What remains red:**

- The **three visual-baseline tests** (D-830). They need a person to review a re-baseline.
- **CI on GitHub**, which does not start jobs (AUD-DEF-001). This is an account matter.

**Still open:**

- the High findings outside step 0: AUD-DEF-001;
- the steps of G1–G8 above;
- D-828 (focus during first render);
- D-833 (dead letter or unbudgeted actual, an owner decision).


### Visual baselines (D-830), re-recorded 2026-11-25 at the owner's request

`npx playwright test e2e/a0-visual.spec.js --update-snapshots` (4.2 h) re-recorded the baselines.

**What changed:** 61 of the 6,642 images, on 13 pages. The largest change covers 6.5 % of a page. Every change starts below a row of controls that grew to the 44 px touch target, so the content below moves down by about 20 px. There is no change of content.

**Evidence:**

- `evidence/d830-visual-rebaseline-diff.tsv`: one line per image, with the changed pixels and region;
- `evidence/d830-notifications-light-768-before-after.png`: the largest change, before and after;
- `evidence/d830-visual-update.log`: the recording run.

**Check run** (without `--update-snapshots`): **the suite passes against the new baselines in all three themes.**

- Light and dark passed in one run, which a container restart then stopped during the high-contrast theme: `evidence/d830-visual-check-light-dark.log`.
- High contrast was re-run on its own and passed (1.4 h): `evidence/d830-visual-check-high-contrast.log`.

The E2E suite therefore has no known failure left from the audit.

**Before merging:** the reviewer of the pull request checks the 61 changed images.

## Small fixes and D-833 (approved by the owner, 2026-11-25)

| Item | Fix | Commit | Proof |
|---|---|---|---|
| AUD-DEF-002 | The stale "Not started" rows of 23.01–23.03 are removed, and `defects --check` refuses a part listed twice. D-001 is closed and D-002 annotated. | `452a70d0` | The check fails on the old file |
| AUD-DEF-011 | The MB abstract and the GL ledger allow at most 200 rows a page; the ledger export reads 500 internally. A test refuses any validator above 200. | `452a70d0` | The test fails on the old limits |
| AUD-DEF-019 | `/bi/leakage` and its menu entry declare `bi.leakage.view` (a data migration with a down script). A test guards the pages that are open by design. | `452a70d0`, `0249739d` | The tests and nav-check |
| AUD-DEF-003 | A test caps the database calls in each mount file. Moving the existing SQL stays planned. | `9c81b566` | The test trips when a call is added |
| AUD-DEF-010 | PDFs carrying JavaScript or a launch action are quarantined, compressed object streams included. | `9c81b566` | The files tests and 108 PDF tests pass |
| D-828 | No provisional header is drawn before the session arrives, so keyboard focus is kept. | `22b87986` | Reproduced: focus lost on the old build, kept on the new; an E2E test |
| AUD-DEF-006 | The threat model is reviewed. Token links and portal isolation are listed to verify. | `f1bd8d99` | Each new claim checked against the code |
| D-833 | The owner's decision: payroll cost goes to the allocated project, even before the project's set-up is complete. Commitments still need the set-up. | `21e1c07b` | The payroll test fails on the old ledger; 59 budget and payroll tests pass |

**Regression on `0249739d`, without E2E: all 16 stages pass** (`evidence/s1-regression-no-e2e.log`).

**E2E run for these changes:** the specs they touch:

- shell, sign-in and the new focus test: 23 passed;
- leakage: 2 passed.

## Administrator controls (owner: "take your own decision as per requirements", 2026-11-25)

Both decisions follow `07_APPROVAL_WORKFLOW_REFERENCE.md` and `06_ROLE_CATALOGUE.md`; the reasoning is in `DECISIONS.md`, "Audit remediation".

| Item | Decision and fix | Commits |
|---|---|---|
| AUD-DEF-009, D-002 | In staging and production a flag change is a request, approved on the Feature Flags page:<br>• by an IT administrator, never the requester;<br>• for a financial or security flag, also by a different CFO or director.<br>Built in the flag module, because the workflow engine is itself behind a flag. Development and test still change at once. | `23f92361`, `505b60f2`, `aef770c6`, `f7c1b04b`, `5a19c2d1` |
| AUD-DEF-008 | Each version of the permission baseline is recorded with its maker and checker (`PERMISSION_REVIEWS.json`). The audit fails on an unrecorded change. **The first version awaits its checker, an IT administrator or director:** `node scripts/permission_audit.mjs --record-check --checker <name> --checker-role ITADM\|DIR` | `23f92361` |

**Found and fixed on the way:**

- the waiting-changes list called a map as a function and blanked the page (found by the new E2E test);
- the legacy access comparison now accepts the intended `core.flag.view` of CFO and DIR, and reports any other gain;
- the statuses of the new table are registered with the integrity check.

**Regression on `5a19c2d1`, without E2E: all 16 stages pass** (`evidence/s2-regression-no-e2e.log`). E2E flag specs: 18 passed.
