# Runbook: deploy a release (blue-green, zero downtime)

**Who:** the pipeline (`pipeline:release`), started by DevOps (ITADM) after the release is approved (RELEASE.md §8). **When:** a release window agreed with the business; never on payroll day or during the month-end close (see those runbooks). **BR-01:** production changes only through the pipeline; the Operations page refuses a production deployment recorded by a person.

## Before
1. The release is green in CI (`verify`, `security`, `dast`, `perf-smoke`) and its artefact checksum is in the release record.
2. Staging runs the same build: the zero-downtime rehearsal passed (`node scripts/rehearse_zero_downtime.mjs --post <staging>`) and the smoke test of staging is green.
3. **Operations → Environments**: production shows parity **OK** and its active slot (blue or green).
4. The on-call L2 for the window is on the rota.

## Steps (what the pipeline runs)
1. Verify the artefact (`verifyArtifact`: every file against `SHA256SUMS`).
2. Back up the database to a restore point and verify the copy (integrity check, same row count in every table).
3. Apply the new migrations while the active slot serves (migrations are additive: the old build works on the new schema).
4. Start the new build on the idle slot; smoke-test it there (health, build ID, migrations).
5. Switch nginx: rewrite `active-upstream.conf`, `nginx -s reload` (in-flight requests finish on the old workers).
6. Keep the old slot running until the next deploy, so a rollback is a switch.
7. Record the deployment: `POST /api/v1/tst/ops/deployments` with the pipeline run and the artefact's SHA-256.

## After
- Watch **Operations** and the alert dashboard for 30 minutes: 5xx rate, p95, memory.
- If anything is wrong: **rollback.md** (one command; under a minute).

## If a step fails
The pipeline stops before the switch: the active slot keeps serving, the new migrations are undone (down-migrations, else the restore point), and the failed deployment is recorded with its reason. Nothing else to do but read the reason in the deployment's steps.
