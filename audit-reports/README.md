# Technical audit — ERP_SAP-CLS

## Scope

A read-only technical audit of the whole repository, run in 10 phases:

- repository;
- gates;
- modules;
- database and API;
- security;
- frontend and UX;
- integration;
- defects;
- remediation;
- readiness.

The phases follow the uploaded "Corrected Audit Prompt". Start with [00-executive-summary.md](00-executive-summary.md).

| Item | Value |
|---|---|
| Repository | `sahaainfra/erp_sap-cls` |
| Commit audited | `ed225efd45f3040962958aac97a491c4ed38575f` (branch `ccr-a3b3ce3d-65llwf`), 21 commits after `main` `e0c6c22` named in the prompt |
| Date | 2026-11-24 |
| Auditor | Claude Code, in the same cloud session that built parts 30.01–30.10 |
| Where | An ephemeral Linux cloud container: 4 vCPU, the session's checkout at `/home/user/ERP_SAP-CLS` |

## Conflict of interest

The session that audits also wrote the last 21 commits (parts 30.01–30.10). Those parts were audited with the same checks as the rest. Several findings land on them (AUD-DEF-014, AUD-DEF-015, AUD-DEF-017). An independent reviewer should still check the findings and especially the absence of findings in those parts.

## Tools and versions

| Tool | Version |
|---|---|
| Node.js | 24.22.3 |
| npm | 11.19.1 |
| Playwright | 1.64.1, with its bundled Chromium |
| axe-core | 4.11.0 |
| Python | 3.13.18 (counting scripts only) |
| git | 2.43.0 |
| GitHub | read through the GitHub MCP tools: Actions run list, job logs, branches |

All gates are the repository's own npm scripts. No tool was installed. `npm ci` was run from the lockfile.

## Files

| File | Phase |
|---|---|
| `00-executive-summary.md` | Summary |
| `01-repository-inventory.md` | 1 |
| `02-gate-baseline.md` | 2 |
| `03-module-status.md` | 3 |
| `04-database-api.md` | 4 |
| `05-security.md` | 5 |
| `06-frontend-ux.md` | 6 |
| `07-integration.md` | 7 |
| `08-defect-register.md`, `08-defect-register.csv` | 8 |
| `09-remediation-plan.md` | 9 |
| `10-missing-and-incomplete.md`, `11-production-readiness.md` | 10 |
| `PROGRESS.md` | Phase status |
| `evidence/` | Logs of every command quoted in the reports |

## Rules followed, and where they were bent

**Only `audit-reports/` was committed.** No file under `src/`, `docs/erp/`, `tests/`, `e2e/` or `migrations/` was changed in a commit. `PROGRESS.csv`, `DEFECTS.md` and `DECISIONS.md` were not edited. No snapshot was updated.

**No destructive command was run.** That means no `rm -rf`, `git clean`, `git reset`, `db:restore`, `db:rollback`, `deploy`, `rollback`, `release`, `erp:rotate-vault-key`, `seed:demo` or `gen-data` against a real database.

**Side effects of running the gates, and how they were undone:**

1. **The E2E gate rewrites tracked files.** `npm run test:e2e` rewrote 1,676 tracked files under `docs/erp/` (AUD-DEF-017): 1,673 screenshots, `a11y/a11y-360.json`, `a11y/devices.json` and `manuals/capture.json`. The list is in `evidence/p2-e2e-tracked-files-rewritten.txt`. After the run they were put back with `git checkout -- docs/erp`, which restores those tracked files from the commit; it is not a reset. While the run lasted, they were never staged or committed.
2. **Generated reports.** Gates write `reports/` and `test-results/`, which are git-ignored, and they regenerate `docs/erp/UI_V3_PAGE_AUDIT.md` with identical content.
3. **A temporary probe file in `tests/`.** The cross-company probe was run once as `tests/_audit_xco_probe.mjs`, so that it could import the app. It ran against a `VACUUM INTO` scratch copy of the development database (`probe.sqlite` in the session scratchpad), then it was deleted. A copy is kept as `evidence/p5-cross-company-probe.mjs.txt`.
4. **The development database was only read.** `data/erp.dev.sqlite` was read through `VACUUM INTO`, which reads.

**No secret is quoted.** Where a credential or test password is relevant, the report cites the file and line only.

## What was inaccessible

- **The prompt's path does not exist.** The path given in the audit prompt, `/home/claude/erp_sap-cls`, is not in this environment; the session's checkout was used instead.
- **No staging or production system exists** (D-009). Nothing was connected to, and nothing live was observed.
- **GitHub account settings could not be read:** billing, Actions minutes, rulesets. So the cause of the CI start failures is Not Verified.
- **Job logs for the failed runs since 2026-11-16** return HTTP 404: the jobs never started.
- **Docker:** the CLI is installed but no daemon runs, so the container image scan was not run.
- **Real phones:** no physical Android or iOS device is available, only emulation (D-146).

## Not Executed, and why

| Item | Why |
|---|---|
| `npm run erp:regression` as one command | Its stages were run one by one, so that each has its own exit code, duration and log (02-gate-baseline). The final regression report under `reports/regression` was therefore not produced. |
| Integrity checks on real data | `erp:db-check --fresh` runs on an empty database, and no production database exists |
| Container image scan (Trivy) | No Docker daemon |
| DAST against a running installation | The repository's DAST (`scripts/dast_scan.mjs`) **was** run, in-process on an empty in-memory database (as CI does): 5,670 requests, 0 findings (`evidence/p5-dast.log`). No installation exists to scan with `--base`. |
| CodeQL | Runs only in CI, which does not run |
| k6 load scripts | k6 is not installed (D-811). The repository's Node load runner is used instead (perf baseline) |
| Duplicate-code scan | No detector installed |
| `db:restore`, `deploy`, `rollback` against any real target | Forbidden by the audit rules; `db:rehearse` was run on a scratch copy instead |
