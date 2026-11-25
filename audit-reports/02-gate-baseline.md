# 02 — Gate baseline (Phase 2)

Commit `ed225efd`, Node 24.22.3, npm 11.19.1, on a 4-vCPU Linux container.

**How the stages were run.** Each stage of `npm run erp:regression` (`scripts/regression.mjs:21-45`) was run as its own command, with `NODE_ENV=test` as the regression sets it. That way each stage has its own exit code, duration and log. `erp:regression` as one command was not run, so no `reports/regression` summary exists. Every stage the regression runs is below.

| # | Stage (regression id) | Command | Exit | Result | Duration | Log |
|---|---|---|---|---|---|---|
| 1 | install | `npm ci` | 0 | Pass | 15 s | `evidence/01-npm-ci.log` |
| 2 | lint | `node node_modules/eslint/bin/eslint.js .` | 0 | Pass | 41 s | `evidence/02-lint.log` |
| 3 | typecheck | `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | 0 | Pass | 6 s | `evidence/03-typecheck.log` |
| 4 | unit-api | `node scripts/test_coverage.mjs` | 1 | **Fail**: 1,736 tests, 1,735 pass, 1 fail (`tests/ops-zero-downtime.test.js`, AUD-DEF-015) | 2,029 s (34 min) | `evidence/05-test-coverage.log` |
| 5 | coverage-gate | `node scripts/coverage_gate.mjs` | 0 | Pass (49 changed files, each ≥ 60 %) | < 1 s | `evidence/06-coverage-gate.log` |
| 6 | migration-check | `node scripts/migration_check.mjs` | 0 | Pass (427 pairs) | 86 s | `evidence/07-migration-check.log` |
| 7 | db-lint | `node scripts/db_lint.mjs` | 0 | Pass (952 tables, 0 errors, 147 warnings) | 4 s | `evidence/08-db-lint.log` |
| 8 | design-tokens | `node scripts/build_tokens.mjs --check` | 0 | Pass (135 pairs AA) | < 1 s | `evidence/18c-tokens.log` |
| 9 | icon-map | `node scripts/build_icons.mjs --check` | 0 | Pass (68 glyphs) | < 1 s | `evidence/18d-icons.log` |
| 10 | nav-check | `node scripts/nav_check.mjs` | 0 | Pass (741 pages, 699 entries) | 2 s | `evidence/14-nav-check.log` |
| 11 | route-check | `node scripts/route_check.mjs` | 0 | Pass (5,186 routes declared) | 4 s | `evidence/12-route-check.log` |
| 12 | permission-audit | `node scripts/permission_audit.mjs` | 0 | Pass (117 permissions); see AUD-DEF-008 | < 1 s | `evidence/13-permission-audit.log` |
| 13 | defects | `node scripts/defects_by_part.mjs --check` | 0 | Pass (818 rows, 756 open) | < 1 s | `evidence/15-defects-check.log` |
| 14 | db-check | `node scripts/db_check.mjs --fresh` | 0 | Pass, **on an empty in-memory database** | 4 s | `evidence/09-db-check.log` |
| 15 | schema-diff | `node scripts/schema_diff.mjs` | 0 | Pass | 2 s | `evidence/10-schema-diff.log` |
| 16 | golden | `node scripts/golden.mjs` | 0 | Pass (8 outputs) | 3 s | `evidence/11-golden.log` |
| 17 | secret-scan | `node scripts/secret_scan.mjs` | 0 | Pass | 2 s | `evidence/16-secret-scan.log` |
| 18 | audit (`--with-audit`) | `npm audit --audit-level=high` | 0 | Pass: 0 high or critical; 3 moderate (`minimatch` through eslint, dev only) | < 1 s | `evidence/20-npm-audit.log` |
| 19 | build | `node node_modules/vite/bin/vite.js build` | 0 | Pass | 20 s | `evidence/17-build.log` |
| 20 | pwa-check | `node scripts/pwa_check.mjs` | 0 | Pass | 1 s | `evidence/18b-pwa-check.log` |
| 21 | bundle-budget | `node scripts/bundle_budget.mjs` | 1 | **Fail**: `assets/hi-*.js` 259.5 KB gzip > 250 KB (AUD-DEF-014) | < 1 s | `evidence/18-bundle-budget.log` |
| 22 | e2e | `npm run test:e2e -- --trace off --reporter=line` (desktop and mobile projects, 866 tests) | 1 | **Fail**: 866 tests (desktop and mobile); 785 passed, 14 failed, 67 skipped; none flaky, none interrupted | 20,052 s (5 h 34 min) | `evidence/19-test-e2e.log` |

**Overall: the regression gate does not pass at this commit.** Stages 4 (unit), 21 (bundle budget) and 22 (E2E) fail.

## Other checks run in this phase

| Check | Command | Exit | Result | Log |
|---|---|---|---|---|
| Unit suite without coverage, run 2026-11-23 about 22:31–23:01 UTC on commit `32396af4` (its code is identical to `ed225efd`; the later commit changes only `docs/erp`) | `node --test` | 0 | 1,736 / 1,736 pass, 1,775 s. The zero-downtime test passed in that run, so its failure in stage 4 is a timing race under coverage load, not a constant failure. | `evidence/04-unit-no-coverage.log` |
| DAST (CI `dast` job) | `node scripts/dast_scan.mjs` | 0 | 5,670 requests, 0 findings | `evidence/p5-dast.log` |
| Backup and restore rehearsal | `npm run db:rehearse` | 0 | Checksums identical | `evidence/p4-db-rehearse.log` |
| Performance baseline (D-007) | `npm run erp:perf-baseline` | 1 | **Not a valid measurement.** 8 of 9 journeys get 70–100 % HTTP 429 from the account rate limit (1,800 reads a minute), so their latencies measure the refusal (AUD-DEF-018). Only `session` ran clean: p95 29.45 ms against 10.49 ms in the stored baseline of 2026-11-12, inside its 300 ms standard. The run wrote only `reports/` (git-ignored); `--save` was not used. | `evidence/p8-perf-baseline.log` |

## Coverage (stage 4)

All files: lines 97.71 %, branches 77.04 %, functions 88.04 %. These are Node's built-in coverage figures over the files the tests load. A file that no test loads is not counted.

## CI comparison

CI's `verify` job runs the same `erp:regression`. It has not completed since run #12 on 2026-10-31 (AUD-DEF-001). Its 20-minute timeout is shorter than stage 4 alone (34 minutes here) (AUD-DEF-020).

## E2E failures

| # | Register ID | Project | Test | Title | Error (first lines) |
|---|---|---|---|---|---|
| 1 | AUD-DEF-022 | desktop | `e2e/a0-visual.spec.js:28` | T-01 FR-05 visual baseline of every page, light theme, at 360, 768 and 1280 px | Error: expect(page).toHaveScreenshot(expected) failed; 8547 pixels (ratio 0.02 of all image pixels) are different.; Expected: e2e/a0-visual.spec.js-snapshots/admin-users-light-768-desktop-linux.png |
| 2 | AUD-DEF-023 | desktop | `e2e/a0-visual.spec.js:28` | T-01 FR-05 visual baseline of every page, dark theme, at 360, 768 and 1280 px | Error: expect(page).toHaveScreenshot(expected) failed; 8376 pixels (ratio 0.02 of all image pixels) are different.; Expected: e2e/a0-visual.spec.js-snapshots/admin-users-dark-768-desktop-linux.png |
| 3 | AUD-DEF-024 | desktop | `e2e/a0-visual.spec.js:28` | T-01 FR-05 visual baseline of every page, high-contrast theme, at 360, 768 and 1280 px | Error: expect(page).toHaveScreenshot(expected) failed; 9173 pixels (ratio 0.02 of all image pixels) are different.; Expected: e2e/a0-visual.spec.js-snapshots/admin-integrations-high-contrast-768-desktop-linux.png |
| 4 | AUD-DEF-025 | desktop | `e2e/accountability.spec.js:59` | AC-01 FR-01 FR-02 FR-04 FR-06 the standard processes are applied to a project, the gap check empties, an actor | Test timeout of 180000ms exceeded.; Error: locator.fill: Target page, context or browser has been closed |
| 5 | AUD-DEF-026 | desktop | `e2e/data-health.spec.js:31` | ITADM runs the checks: the summary updates, nothing fails, tables with nothing to check say so | Error: expect(locator).toHaveText(expected) failed; Expected: "0"; Received: "1" |
| 6 | AUD-DEF-027 | desktop | `e2e/field-p16603.spec.js:112` | FR-01 the field home on a desktop: the same band, cards and tiles, laid out wide | Error: database is locked |
| 7 | AUD-DEF-028 | desktop | `e2e/tst-golive.spec.js:24` | Go-live consoles: integration matrix green with a latency probe, reconciliation health, page completion audit | Error: expect(locator).toHaveCount(expected) failed; Expected: 3; Received: 10 |
| 8 | AUD-DEF-029 | mobile | `e2e/data-health.spec.js:31` | ITADM runs the checks: the summary updates, nothing fails, tables with nothing to check say so | Error: expect(locator).toHaveText(expected) failed; Expected: "0"; Received: "2" |
| 9 | AUD-DEF-030 | mobile | `e2e/operations-health.spec.js:24` | Operations Health: figures, objectives, alert rules, baseline; a forced error is followed end to end by its co | Error: expect(locator).toBeVisible() failed; Expected: visible; Error: element(s) not found |
| 10 | AUD-DEF-031 | mobile | `e2e/register.spec.js:68` | AC-01 the register, a regularisation from the employee to the supervisor, the overtime request and the lock of | Error: expect(locator).toContainText(expected) failed; Expected substring: "was sent for approval"; Error: element(s) not found |
| 11 | AUD-DEF-032 | mobile | `e2e/tst-device-matrix.spec.js:40` | T-01 FR-01 FR-03 the device matrix: field, language, offline, approvals, keyboard and screen-reader journeys o | Error: expect(received).toEqual(expected) // deep equality |
| 12 | AUD-DEF-033 | mobile | `e2e/tst-golive-readiness.spec.js:23` | Go-live readiness board, UAT, dry run and the go/no-go decision | Error: expect(locator).toHaveAttribute(expected) failed; Expected: "RUNNING"; Received: "PENDING" |
| 13 | AUD-DEF-034 | mobile | `e2e/tst-golive.spec.js:24` | Go-live consoles: integration matrix green with a latency probe, reconciliation health, page completion audit | Error: expect(locator).toHaveCount(expected) failed; Expected: 3; Received: 10 |
| 14 | AUD-DEF-035 | mobile | `e2e/users.spec.js:32` | Users: invite, find, filter, save a view, import with row errors, hand over and deactivate | Error: expect(locator).toHaveCount(expected) failed; Expected: 0; Received: 1 |

**Reading the failures.** Root causes were not investigated: the audit rules forbid fixing during the audit, and a rerun of each test alone was not done.

- **Shared data from earlier tests.** Several failures see more rows than the test expects:
  - `pa-row` count 10 instead of 3;
  - `count-fail` 1 or 2 instead of 0;
  - a user still listed after deactivation.
  
  That points to records left in the shared E2E database by earlier tests. One failure is "database is locked" from a test that writes to the database directly while the server runs.
- **Visual drift.** The three `a0-visual` failures are pixel drift against the committed snapshots (D-430 records earlier drift on this suite).
- **Parts built in this session.** Four failing specs belong to parts 30.01, 30.07 and 30.10. The session's build records say they passed when run on their own during the build. The audit did not re-run them alone, so that is **Not Verified** here.
- **No part.** `operations-health.spec.js` is not mapped to any part in the test catalogue.

## Tracked files the E2E gate rewrote, and their restoration

The run rewrote 1,676 tracked files under `docs/erp/` (AUD-DEF-017):

- 1,673 screenshots;
- `a11y/a11y-360.json`;
- `a11y/devices.json`;
- `manuals/capture.json`.

The list is in `evidence/p2-e2e-tracked-files-rewritten.txt`. This run's two accessibility JSON files were kept as evidence (`evidence/p6-run-a11y-360.json`, `evidence/p6-run-devices.json`). All 1,676 files were then restored from the commit with `git checkout -- docs/erp`, and `git status` showed `docs/erp` clean afterwards.
