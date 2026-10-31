# Secrets: where they live and how to rotate them

Part 02.07, FR-05. Secrets come from the environment of the server (or a vault that fills the environment) and nowhere else: never from the database, the code, the tests, the logs or the browser. The Security Settings page shows only whether each is set. `npm run erp:secret-scan` (in every CI run) fails the build if a credential is committed.

| Secret | What it protects | Required in staging and production | If it leaks |
|---|---|---|---|
| `AUTH_SECRET` | Signs sign-in tokens, captcha and challenge tokens | Yes, when `AUTH_MODE=iam` (at least 32 characters) | Anyone can mint a token: rotate at once |
| `VAULT_KEY` | Encrypts connector credentials (AES-256-GCM) | Yes (at least 32 characters) | Stored credentials can be read by whoever also holds the database: rotate the key, then rotate the credentials themselves |
| `FILE_URL_SECRET` | Signs the short-lived download links | Yes (at least 32 characters) | Links can be forged: rotate at once |
| `HEALTH_TOKEN` | Lets monitoring read readiness and metrics | Optional (at least 16 characters) | Readiness details are exposed: rotate |
| `LOG_PSEUDONYM_SECRET` | Makes log user pseudonyms stable across restarts | Recommended | Pseudonyms can be reversed by guessing user ids: rotate (old log lines no longer match) |

The application refuses to start in staging or production without the required ones (`platform/config`). Use a different value in each environment, generate each with a password manager or `openssl rand -base64 48`, and give each only to the people who deploy.

## Rotation procedures

**Every rotation:** change the value in the secret store of the environment, deploy it to every instance at the same time (they must agree), and write the date and the person in the change log. A rotation that is not finished within a day is a defect.

1. **`FILE_URL_SECRET`**: set the new value and restart. Links already issued stop working; people ask for a new link. No data is affected.
2. **`HEALTH_TOKEN`**: set the new value, restart, give it to the monitoring system.
3. **`AUTH_SECRET`**: set the new value and restart. Every person is signed out once and signs in again (tokens signed with the old value no longer verify). Do this in a quiet hour; this is also the emergency procedure if the secret leaks, together with a forced sign-out of everyone from Users and Sessions.
4. **`VAULT_KEY`**: the stored credentials must be re-encrypted first.
   1. Take a copy of the database.
   2. Generate the new key (at least 32 characters).
   3. Check: `OLD_VAULT_KEY=... NEW_VAULT_KEY=... DATABASE_PATH=... npm run erp:rotate-vault-key`. It decrypts every stored credential with the old key and says how many it would change; it changes nothing, and fails if any credential does not decrypt with the old key.
   4. Apply: the same command with `-- --apply`. Every value is re-encrypted and checked in one transaction.
   5. Set `VAULT_KEY` to the new key on every instance and restart. Between steps 4 and 5 connectors cannot decrypt their credentials: do both inside the same maintenance window.
   6. If the old key leaked, also change the credentials themselves at each provider (Integration hub, connector, change credentials: an approved request), because anyone who copied the database earlier holds them.
5. **Connector credentials** (an email provider password, an API key): rotate from the Integration hub. The new value is staged, approved by a second person, then replaces the old one; the old one is retired and kept only as history.

## If a secret is found in the repository

Treat it as leaked even if the repository is private: rotate it first, then remove it (a later commit does not remove it from history), then ask whether it was used (Security Events, Audit Explorer).

## What is not done yet

Secrets are read at start-up, so a rotation needs a restart (D-108); there is no integration with a managed vault service that rotates on a schedule (D-108). `AUTH_SECRET` has no overlap period in which the old and the new value are both accepted, so its rotation signs everyone out.
