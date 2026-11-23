# Runbook: rotate secrets

**Secrets:** `AUTH_SECRET` (sign-in tokens), `FILE_URL_SECRET` (signed file links), `HEALTH_TOKEN` (monitoring), `BACKUP_KEY` (off-site copies), `VAULT_KEY` (encrypted values in the database), connector credentials (vault), the VAPID key pair. They live in the vault; the host reads them from `/etc/erp/secrets.env` (0600, root), written by the vault agent. Never in a repository, an environment file or a ticket.

**When:** every 90 days, at once when a person with access leaves, and at once on any suspicion of exposure.

1. Create the new value in the vault (a new version; keep the old one).
2. Deploy the same build again (**deploy.md**): the idle slot starts with the new value, then the switch. The secrets are read at start, so this is the rotation (D-108).
3. `AUTH_SECRET`: signed-in people sign in again — rotate out of hours and announce it. `FILE_URL_SECRET`: old download links stop working (they expire in minutes anyway). `HEALTH_TOKEN`: update the monitoring at the same time.
4. `VAULT_KEY`: values are written with key version 1; a rotation needs the re-encryption job, which is not built yet (D-054): until then rotate only on exposure, with the vendor's help.
5. Revoke the old version in the vault after one day; record the rotation (who, which secret, when) in the change record.
