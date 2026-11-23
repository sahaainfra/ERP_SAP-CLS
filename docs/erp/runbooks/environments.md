# Environments

| Environment | Purpose | Data | Sign-in | Deploys |
|---|---|---|---|---|
| dev | Developers' shared environment | Demo seed | Development headers | Every merge to main |
| test | Automated and manual testing (CI) | Created by the tests | Development headers | Every pipeline run |
| staging | The release candidate, as production | A masked copy of production, refreshed monthly | IAM (sign-in) | Every release, before production |
| production | The business | Real | IAM (sign-in) | Approved releases, through the pipeline only (BR-01) |
| sandbox | Training and scenario packs (30.04) | Synthetic; reset in one click | Development headers | With staging |

**As code:** `infra/environments/<env>.env` (non-secret settings), `docker-compose.yml` (two slots and nginx), `Dockerfile` (one image for all), `infra/ansible/site.yml` (the host), `infra/monitoring` (alerts and on-call routing). Secrets come from the vault.

**Parity:** every environment names the same keys; only these may differ from production: `NODE_ENV`, `ERP_ENVIRONMENT`, `AUTH_MODE`, `DATABASE_PATH`, `ERP_DEMO_SEED`, `ERP_SANDBOX`, `PUBLIC_URL`, `APP_URL`, `BACKUP_OFFSITE_DIR`. `node scripts/env_parity.mjs` checks it in CI and the Operations page shows it.

**Logs:** container logs rotate at 50 MB × 10 files per slot; system logs are kept 90 days; the audit trail is kept by its own retention (29.07). Access to logs: ITADM only; logs carry correlation IDs and no personal data (redaction, 01.07).
