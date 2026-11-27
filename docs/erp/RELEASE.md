# Release, deploy and rollback runbook

Everything below runs from the repository root. Commands marked (GitHub) need the repository on GitHub. The ruleset of §2 is proposed and not yet applied (D-010).

## 1. Quality gates (every pull request and every merge to main)
`npm run erp:regression` runs, in order: lint, type check, unit/API/permission tests with coverage, coverage gate for changed files (60 %, to be raised to 80 %), migration up/down check, schema-diff, golden outputs, secret scan, client build, installable-app check, bundle budget, Playwright E2E on desktop (1280x800) and mobile (360x740), then the cross-company probe on the E2E database (`npm run erp:scope-probe`). Add `-- --with-audit` for the dependency audit.

**In CI** (`.github/workflows/ci.yml`, audit AUD-DEF-020, PACK-W0-01) the same stages run as parallel jobs that fit their time limits, and one gate decides:

| Job | Runs | Pull request | Push to main, manual run, `full-ci` label | Time limit | Usual duration (run #160) |
|---|---|---|---|---|---|
| `unit` | `erp:regression -- --skip-e2e` (lint, types, unit/API tests with coverage, gates, migration check, secret scan) | yes | yes | 75 min | 38 min |
| `client` | build, installable-app check, bundle budget | yes | yes | 15 min | 1 min |
| `security` | dependency audit, secret scan | yes | yes | 10 min | under 1 min |
| `dependency-review` | new dependencies with a known High vulnerability or a licence we cannot ship | yes | — | 5 min | under 1 min |
| `e2e` (8 shards) | Playwright desktop and mobile, then the cross-company probe | skipped | yes | 120 min per shard | 6–110 min (shards 3, 4 and 8 carry the page crawl, a11y sweep and UI v3 suites) |
| `clock` (2) | the unit suite on a Sunday and on 31 March, test process and server on the same fixed clock | skipped | yes | 75 min | about 35 min (not yet seen complete on GitHub) |
| `dast` | dynamic scan of the running app | skipped | yes | 15 min | under 1 min |
| `perf-smoke` | small load test judged against the SLOs | skipped | yes | 15 min | 1 min |
| `container-scan` | image build, compose check, Trivy (a HIGH/CRITICAL finding with a fix blocks) | skipped | yes | 15 min | 2 min |
| `deploy-rehearsal` | environment parity, zero-downtime deploy and rollback drills | skipped | yes | 15 min | under 1 min |
| `codeql` | static analysis (non-blocking until code scanning is enabled, D-012) | skipped | yes | 20 min | 7 min |
| `verify` | **the required gate**: `scripts/ci_gate.mjs` | yes | yes | 5 min | seconds |

`verify` needs `unit`, `client`, `e2e`, `clock`, `dast`, `perf-smoke`, `container-scan` and `deploy-rehearsal`. It checks each job's result on its own and fails closed: a failed, cancelled, missing or unknown result fails it. On an ordinary pull request the long jobs are `skipped`, and that is accepted. On main, on a manual run and on a `full-ci` pull request every one of them must succeed. `tests/ci-gate.test.js` (part of `unit`) proves this and fails if the workflow's `verify` job drifts from the script. The required checks for `main` are `verify` and `security` (§2).

A failing stage exits 1 and the report (`reports/regression/report.html`) names it. A migration without a working down-migration fails the migration check; a leaked credential fails the secret scan.

### 1a. CI health: reading and re-running a run (PACK-W0-01)
- **Where to look.** The `verify` log lists every needed job as PASS or FAIL with its result. Open the failing job. E2E shards upload `e2e-shard-N` (Playwright report, `test-results/`, scope probe), `unit` uploads `regression-report-unit`, `dast` uploads `dast-report` and `perf-smoke` uploads `perf-smoke`.
- **Re-run one shard.** In the run, open the failed `E2E shard N of 8` job and choose *Re-run this job* (or *Re-run failed jobs*); `verify` runs again when it finishes. Locally the same shard is `npm run build && npx playwright test --shard=N/8 --trace off`. Where Chrome is not installed as a channel, add `-c playwright.local.config.js` and set `PW_EXE=<path to chrome>`.
- **Run the long jobs on a pull request.** Add the label `full-ci` to the pull request: the `labeled` event starts the full run straight away, and `verify` then requires every long job. Use it for any change to the client, shared components, the API client, the workflow or the Dockerfile. PR #25 merged without it, and two client regressions reached main unseen (PACK-W0-01).
- **Clock jobs locally.** `NODE_ENV=test TZ=Asia/Kolkata ERP_TEST_NOW=2027-03-31T06:00:00Z NODE_OPTIONS=--import=./tests/helpers/test_clock.mjs npm test`.
- **Flaky or slow tests.** A wall-clock budget in a unit test uses `timeBudget(ms)` from `tests/helpers.js` (CI multiplies it by `ERP_TEST_TIME_FACTOR=3`). A test that starts a server closes it in `t.after(() => api.close())`. A test is quarantined only with a DEFECTS.md row that names an owner and an expiry date.
- **Main runs are never cancelled by a newer push** (only pull requests are), so every commit on main keeps its own verdict.

## 2. Make the gates mandatory (GitHub, once, by a repository admin)
**Status (PACK-W0-01, 2026-11-27): proposed, not applied.** The repository is now public, so GitHub enforces rulesets on the free plan and D-010's blocker is gone. The settings below need the owner's approval before anyone applies them. Until then "no direct push to main, one reviewer" (BR-01) is still a habit: Parts 13, 14 and 15 were pushed straight to main.

Ruleset for `main` (Settings → Rules → Rulesets → New branch ruleset, or the API call below):

| Setting | Value | Why |
|---|---|---|
| Target | default branch (`main`) | |
| Enforcement | Active | |
| Restrict deletions | on | |
| Block force pushes | on | history on main is never rewritten |
| Require a pull request before merging | on: 1 approval, dismiss stale approvals on push, require review from Code Owners, require conversation resolution | BR-01 |
| Require status checks to pass | `verify`, `security`; branches must be up to date | `verify` aggregates every regression job |
| Bypass list | Repository admin, **for pull requests only** | one maintainer cannot approve their own pull request; this lets the admin merge an unreviewed pull request knowingly, never push to main directly |

```bash
gh api -X POST repos/sahaainfra/ERP_SAP-CLS/rulesets --input - <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" } ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 1, "dismiss_stale_reviews_on_push": true, "require_code_owner_review": true, "require_last_push_approval": false, "required_review_thread_resolution": true } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": true, "required_status_checks": [ { "context": "verify" }, { "context": "security" } ] } }
  ]
}
JSON
```
(`actor_id` 5 is GitHub's built-in *Repository admin* role.) Add `codeql` to the required checks once code scanning is enabled (D-012). If a second reviewer joins, remove the bypass entry. Record the decision and the date it was applied in DECISIONS.md, and close D-010 with the ruleset's URL.

## 3. Cut a release
1. Write the commit subjects as `P<part>: summary (module code)`. Add a line `Release-note: <what changed, in business language>` to the body of any commit users will notice.
2. `npm run release -- minor --dry-run` shows the version, changelog entry, release notes and the feature-flag list.
3. `npm run release -- minor --commit` writes `CHANGELOG.md` and `docs/erp/releases/v<version>.md`, bumps `package.json`, commits and tags `v<version>`. Nothing is pushed: `git push origin main --follow-tags` (GitHub).

## 4. Package, promote, deploy
```bash
npm run package                      # artifacts/<buildId>/ with build-info.json and SHA256SUMS
npm run deploy -- --env staging --artifact artifacts/<buildId> --port 3300 --install
```
The same artefact goes to every environment; only configuration differs. `deploy` verifies the checksums, takes a database restore point (`<root>/<env>/backups/`), stops the old build, runs the migrations in transactions, starts the new build and runs the smoke test (liveness, and the running build ID must equal the deployed one). A failed migration or smoke test rolls back automatically (BR-02). The state of an environment is in `<root>/<env>/state.json`; releases are kept under `<root>/<env>/releases/`. `--root` defaults to `.deploy`.

A real staging or production host is not chosen yet (defect D-009); today the environment is a directory on one machine.

**Live start or rehearsal (audit AUD-DEF-007).**

- **Live start.** For `--env staging` or `--env production` the release starts live: `NODE_ENV` of the environment, and `AUTH_MODE=iam`. The secrets come from the shell that runs the deploy: `AUTH_SECRET`, `FILE_URL_SECRET`, `VAULT_KEY` and the others in `scripts/lib/release_env.mjs`. The smoke test signs in with `ERP_SMOKE_TOKEN`, a sign-in token of an IT administrator. Without that token the smoke test fails and the deploy rolls back.
- **Rehearsal.** Add `--rehearsal` (or `--node-env test`) to rehearse on one machine. The release starts with `NODE_ENV=test`, the development headers and `ERP_ENVIRONMENT=test`.
- **The guard.** The configuration refuses the development headers whenever `NODE_ENV` *or* `ERP_ENVIRONMENT` is staging or production.

## 5. Roll back (one command)
```bash
npm run rollback -- --env staging            # add --rehearsal for a rehearsal environment
```
It stops the current build, reverses the database through the down-migrations of the build being removed (data written since is kept), and starts the previous build. If a down-migration fails it restores the restore point taken before that deploy (data written since is lost) and says so. Target time: 60 seconds in staging; measured about 1 second.

## 6. Rehearse
`npm run rehearse` deploys build A, writes data, deploys build B with an extra migration, writes more data, rolls back, checks both data rows survived, then drills a failing migration and a crashing build. Results go to `reports/rehearsal.json`. Run it before the first real production deploy and after any change to `scripts/lib/deploy.mjs`.

## 7. Security exceptions (BR-03)
Critical or High dependency vulnerabilities block the release. A time-boxed exception is a dated entry in `DECISIONS.md` naming the advisory, the reason, the owner and the expiry; remove it at expiry.

## 8. Production approval
Production deploy needs a manual approval. Configure it as a required reviewer on a GitHub `production` environment once a hosting target exists (D-009). It is not wired today.
