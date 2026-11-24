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
| 22 | e2e | `npm run test:e2e -- --trace off --reporter=line` (desktop and mobile projects, 866 tests) | E2E_EXIT | E2E_RESULT | E2E_DURATION | `evidence/19-test-e2e.log` |

**Overall: the regression gate does not pass at this commit** (stages 4, 21 E2E_OVERALL).

## Other checks run in this phase

| Check | Command | Exit | Result | Log |
|---|---|---|---|---|
| Unit suite without coverage, run 2026-11-23 about 22:31–23:01 UTC on commit `32396af4` (its code is identical to `ed225efd`; the later commit changes only `docs/erp`) | `node --test` | 0 | 1,736 / 1,736 pass, 1,775 s. The zero-downtime test passed in that run, so its failure in stage 4 is a timing race under coverage load, not a constant failure. | `evidence/04-unit-no-coverage.log` |
| DAST (CI `dast` job) | `node scripts/dast_scan.mjs` | 0 | 5,670 requests, 0 findings | `evidence/p5-dast.log` |
| Backup and restore rehearsal | `npm run db:rehearse` | 0 | Checksums identical | `evidence/p4-db-rehearse.log` |
| Performance baseline (D-007) | `npm run erp:perf-baseline` | PERF_EXIT | PERF_RESULT | `evidence/p8-perf-baseline.log` |

## Coverage (stage 4)

All files: lines 97.71 %, branches 77.04 %, functions 88.04 %. These are Node's built-in coverage figures over the files the tests load. A file that no test loads is not counted.

## CI comparison

CI's `verify` job runs the same `erp:regression`. It has not completed since run #12 on 2026-10-31 (AUD-DEF-001). Its 20-minute timeout is shorter than stage 4 alone (34 minutes here) (AUD-DEF-020).

## E2E failures

E2E_FAILS
