# 11 — Production readiness

## There is no staging and no production environment

D-009 (Open, High) says so, and the repository agrees.

- `infra/environments/` holds environment *files*: `production.env`, `staging.env`, and others.
- No host, DNS name, cloud account or deployment target is configured anywhere in the repository or CI.
- `npm run deploy` and the 30.08 blue-green deploy run against directories on one machine (`.deploy-rehearsal/`, git-ignored).
- The CI jobs `deploy-rehearsal` and `staging-rehearsal` rehearse in the runner, and have not run since 2026-10-31 (AUD-DEF-001).

So this audit could not connect to production, and did not try (audit rule). Nothing below was observed on a live system.

## Verdict

**Not ready for production.** Three findings block go-live on their own, even before the missing environment:

1. **AUD-DEF-012:** cross-company personal-data leak.
2. **AUD-DEF-007:** the deploy scripts start with header identity (no sign-in).
3. **AUD-DEF-001:** no working CI.

The local gate is not green either:

- the bundle budget fails;
- one unit test is flaky under load;
- E2E has failures (see 02).

The programme's own records agree: 44 parts are In progress, G1–G8 are unsigned, and UAT is not done (D-818).

## What exists and was verified on this machine

| Area | Result | Evidence |
|---|---|---|
| Backup and restore | Backup, destroy and restore of a 349,779-row copy: checksums identical | `p4-db-rehearse.log` |
| Migrations | 427 pairs, each down restores the schema and re-up applies | `07-migration-check.log` |
| Configuration refuses unsafe production settings | Yes for `NODE_ENV=production`; **no** for `ERP_ENVIRONMENT=production` with `NODE_ENV=test` | `p5-config-refusal.log` |
| Secrets | Environment only; secret scan clean | `16-secret-scan.log` |
| Dependencies | `npm audit`: 3 moderate (`minimatch`, a dev dependency through eslint), 0 high | `20-npm-audit.log` |
| Container | `Dockerfile` sets `NODE_ENV=production`; the image scan was not run here (the Docker CLI is installed but no daemon runs here) | code reading |
| Runbooks | 30.08 runbooks exist (deploy, rollback, restore, rotate secrets, incident) | `docs/erp/runbooks/` |
| Performance | See `p8-perf-baseline.log` (lab machine, not a production host) | 02-gate-baseline |

## What would be needed before go-live

1. **Fix the step 0 items** of 09-remediation-plan:
   - the two leaks;
   - the dev-headers guard;
   - CI;
   - a green local gate.
2. **Choose and provision hosts** for staging and production (D-009):
   - application server(s) and storage for the SQLite file and uploads, with a backup target off the host;
   - TLS and DNS;
   - Redis, if more than one instance is to run (sockets);
   - ClamAV (D-031);
   - SMTP and WhatsApp senders (D-047).
3. **Wire the promotion:** CI builds the image, deploys to staging, a manual approval follows, then production (RELEASE.md). Turn on branch protection with required checks (D-010).
4. **On staging, with production-like data:**
   - deploy, then roll back;
   - restore from an off-host backup;
   - load test with k6 (D-811, D-814);
   - independent penetration test (D-812);
   - device tests on real phones (D-146);
   - run `erp:db-check` on the restored data rather than on an empty database.
5. **Business acceptance** (D-818):
   - UAT per module with the owners' sign-off;
   - data migration rehearsal and sign-off (D-169);
   - statutory rates confirmed (D-748);
   - gates G1–G8 signed in the application (D-693, D-817);
   - cut-over plan executed, with hypercare staffed.
