# Runbook: roll back a release

**Who:** DevOps (ITADM) through the pipeline's rollback job, or the on-call L2 in an incident. **Target:** service back on the previous build in under one minute, with no failed requests.

1. Open **Operations → Deployments**: the active build and the previous one (its slot is still running unless a newer deploy replaced it).
2. Run the rollback job (`node scripts/rollback.mjs --env production --blue-green`, the pipeline's *Roll back* button):
   - the job's shell holds the production secrets and `ERP_SMOKE_TOKEN` (a sign-in token of an IT administrator). The previous build restarts live (`AUTH_MODE=iam`) and is smoke-tested with that token. Without the token the smoke test fails (see RELEASE.md §4).
   - it starts the previous build again if it was stopped and smoke-tests it;
   - switches nginx back to its slot;
   - after the in-flight requests finish, stops the newer build and undoes its migrations (down-migrations; the restore point if they cannot run).
3. Check: the about page shows the previous build ID; the 5xx rate is back to normal.
4. Record the rollback (the job does it) and open an incident (**incident-response.md**) with the reason.

Data written while the newer build was active stays, because the migrations are additive and their down-migrations only remove what the newer build added. If the restore point had to be used, the data written since the deploy is listed from the audit trail and re-entered by the owners; the incident record says so.
