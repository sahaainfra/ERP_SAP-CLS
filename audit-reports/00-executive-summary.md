# 00 — Executive summary

**Audit details**

- Repository: `sahaainfra/erp_sap-cls`
- Commit: `ed225efd` (branch `ccr-a3b3ce3d-65llwf`, 21 commits after `main`)
- Audited: 2026-11-24, read-only
- Auditor: Claude Code. The same session built parts 30.01–30.10, so this is not an independent review (see README).

## Verdict

**Not ready for production, and the regression gate does not pass at this commit.**

The application is large and mostly well built:

| Measure | Value |
|---|---|
| Distinct parts | 236 |
| Parts Ready for review | 192 |
| Routes | 5,186, every one declared with a permission |
| Tables | 952 |
| Migration pairs | 427 |
| Unit and API tests | 1,736 |
| E2E tests | 866 |

Its foundations hold up under test:

- integer money;
- reversible migrations;
- an append-only audit log;
- parameterised SQL;
- idempotent payments;
- Argon2id passwords;
- strict cookies and headers;
- log redaction;
- a clean in-process DAST scan;
- a verified backup and restore of a 350,000-row copy.

Three findings block go-live on their own, and there is no environment to go live to.

## Blocking findings (High)

| ID | Finding |
|---|---|
| **AUD-DEF-012** | **Cross-company personal-data leak.** `GET /api/v1/hr/performance/team/:id` returns another company's employee name, code, designation and department (`hr/performance.js:124`). A second, smaller leak returns another company's expense-policy history (AUD-DEF-013, Medium). Both were found by a probe of every `/:id` route on a copy of the development database. The other routes held. |
| **AUD-DEF-007** | **The deploy scripts start the server with header identity (no sign-in).** They set `NODE_ENV=test` and `ERP_ENVIRONMENT=production`, and the configuration guard checks only `NODE_ENV`. |
| **AUD-DEF-001** | **CI has not passed since 2026-10-31,** and no branch is protected. Since 2026-11-16, jobs fail in seconds without starting. The `verify` job's 20-minute limit could not hold the suite anyway (AUD-DEF-020). |

**There is no staging or production environment** (D-009). See 11-production-readiness for what is needed.

## Gate results (all executed in this audit)

| Stage | Result |
|---|---|
| lint, typecheck, migrations, schema, routes, permissions, navigation, defects, integrity (empty DB), golden, secrets, build, PWA, tokens, icons, npm audit | Pass |
| Unit and API with coverage | **1,735 / 1,736.** `ops-zero-downtime` fails under load: a backup check races the live server (AUD-DEF-015). It passed without coverage. Line coverage 97.7 %, branch coverage 77.0 %. |
| Bundle budget | **Fail.** The Hindi locale chunk is 259.5 KB against a 250 KB limit (AUD-DEF-014). |
| E2E (desktop and mobile) | **785 passed, 14 failed, 67 skipped** (5 h 34 min). Failures: visual drift (3); state left by earlier tests in the shared database (several); a database lock; the 30.07 device-matrix focus ring on desktop profiles. AUD-DEF-022–035. |
| DAST (in-process) | 5,670 requests, 0 findings |
| Performance baseline | **Not a valid measurement.** The harness hits the account rate limit and 8 of 9 journeys get 429 (AUD-DEF-018). |

## Findings by severity

The audit raised **35 findings**: 3 High, 25 Medium, 7 Low. They are in `08-defect-register.md` / `.csv`. Fourteen of the Medium ones are individual E2E failures.

The programme's own register adds 756 open defects, 31 of them High. Those are mostly unbuilt scope in M25–M27, and external work such as the penetration test, real devices, UAT and hosting.

Other notable findings:

- **AUD-DEF-002:** PROGRESS.csv lists 23.01–23.03 twice, once as "Not started". The code, tests and reports exist.
- **AUD-DEF-004:** project closeout (M26) has code but no API or page.
- **AUD-DEF-005:** 29 % of routes are missing from OpenAPI.
- **AUD-DEF-008:** the permission baseline certifies itself.
- **AUD-DEF-009:** feature-flag maker-checker applies only when the Control Center is on.
- **AUD-DEF-016:** about 5,400 hard-coded English strings.
- **AUD-DEF-017:** the E2E gate rewrote 1,676 tracked files.

## Module status (03-module-status)

| Status | Parts |
|---|---|
| Implemented (Ready for review) | 192 |
| In progress (M25–M30 and 2 others) | 44 |
| Missing | 0 |
| No test naming the part | 6 |
| A test failed in this audit's runs | 10: one through the unit failure (30.08), nine through E2E failures, several of which may be test-isolation problems |

## What to do first (09-remediation-plan, step 0)

1. Fix the two leaks, then make the cross-company probe a permanent test.
2. Make the configuration guard refuse dev-headers by `ERP_ENVIRONMENT`, and fix the deploy scripts.
3. Get CI running, with the suite split into jobs that fit their time limits.
4. Make the local gate green: the Hindi chunk, the backup race, the 14 E2E failures and the perf harness.

Then provision staging and production (D-009). Sign gates G1–G8, and run UAT with the business owners (D-818).

## Limits of this audit

- No production system exists to observe.
- GitHub account settings, real phones, a Docker daemon, k6 and CodeQL were not available.
- Root causes of the E2E failures were not investigated, and no failing test was re-run alone.
- The integrity suite ran on an empty database.
- Of the 1,331 interpolated SQL statements, a sample of the riskiest was traced.

See README, "Not Executed".

## After the audit: remediation step 0 (approved by the owner, 2026-11-24)

| Item | Result |
|---|---|
| Cross-company leaks | Fixed: the two audited leaks and a third in the KPI history. A permanent probe of every `/:id` and list route runs in the regression and in CI; on the data of a full E2E run it finds 0 leaks. |
| Dev-headers guard | Fixed: refused whenever the environment is staging or production. Deploys start live with real sign-in. |
| CI | Split into jobs that fit their limits. It still cannot run until GitHub Actions starts jobs on the account (AUD-DEF-001). |
| Local gate | The bundle budget, the backup race and the perf harness are fixed. E2E went from 14 failures to 8 in one full run; 5 of those 8 were fixed during that run and all pass when re-run, so only the 3 visual-baseline tests remain. |
| Fixed along the way | Three real defects: a silent failure of the self-service request form, a dashboard listed twice, and an unkeyed claim evidence list. |
| Still red | The three visual-baseline tests (D-830), which need a reviewed re-baseline. |

Details: `09-remediation-plan.md`, "Step 0 outcome". Status per finding: `08-defect-register.md`.
