# Release, deploy and rollback runbook

Everything below runs from the repository root. Commands marked (GitHub) need the repository on GitHub and have not been run there yet (defect D-010).

## 1. Quality gates (every pull request and every merge to main)
`npm run erp:regression` runs, in order: lint, type check, unit/API/permission tests with coverage, coverage gate for changed files (60 %, to be raised to 80 %), migration up/down check, schema-diff, golden outputs, secret scan, client build, installable-app check, bundle budget, Playwright E2E on desktop (1280x800) and mobile (360x740), then the cross-company probe on the E2E database (`npm run erp:scope-probe`). Add `-- --with-audit` for the dependency audit.

**In CI** (`.github/workflows/ci.yml`, audit AUD-DEF-020) the same stages run as parallel jobs that fit their time limits:

| Job | Runs | Time limit |
|---|---|---|
| `unit` | `erp:regression -- --skip-e2e` | 75 min |
| `client` | build, installable-app check, bundle budget | — |
| `e2e` | Playwright in 8 shards, each followed by the scope probe | 120 min per shard |
| `verify` | Passes only when all three pass | — |

`verify` stays the required check. `security` (dependency audit, secret scan) and `codeql` (static analysis) run beside it.

A failing stage exits 1 and the report (`reports/regression/report.html`) names it. A migration without a working down-migration fails the migration check; a leaked credential fails the secret scan.

## 2. Make the gates mandatory (GitHub, once, by a repository admin)
On the current free plan this cannot be enforced for a private repository (defect D-010): GitHub shows "rulesets won't be enforced on this private repository until you move to GitHub Team". Do this after the plan changes or the repository becomes public.

`.github/CODEOWNERS` already requests review from `@sahaainfra`. After `gh auth login`, protect main:

```bash
gh api -X PUT repos/sahaainfra/ERP_SAP-CLS/branches/main/protection --input - <<'EOF'
{
  "required_status_checks": { "strict": true, "contexts": ["verify", "security"] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1, "require_code_owner_reviews": true },
  "restrictions": null
}
EOF
```
Add `"codeql"` to `contexts` once code scanning is enabled (D-012). With one owner, GitHub will not let the author approve their own pull request; add a second reviewer or relax `enforce_admins` knowingly and record that in DECISIONS.md.

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
