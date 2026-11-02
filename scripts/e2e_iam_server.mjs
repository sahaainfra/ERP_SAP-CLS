// Starts the API in sign-in mode (AUTH_MODE=iam) on a fresh database for the sign-in E2E tests, with people to sign in as.
// Desktop and mobile runs share the database, so each gets its own company and its own users (suffix d and m).
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/server/app.js';
import { createUserStore } from '../src/server/modules/iam/users.js';
import { loadConfig } from '../src/server/platform/config/index.js';
import { identityOf } from '../src/server/platform/identity/index.js';
import { migrateUp, openDatabase } from '../src/server/platform/db/index.js';
import { startWorkers } from '../src/server/platform/runtime/index.js';
import '../src/server/modules/registry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const config = loadConfig();
// a fresh database each start: the one DATABASE_PATH names (never another run's file, which may be open in another server)
for (const suffix of ['', '-wal', '-shm']) rmSync(`${resolve(root, config.databasePath)}${suffix}`, { force: true });
const db = openDatabase(config.databasePath);
migrateUp(db);
const identity = identityOf(db, { authSecret: config.authSecret ?? undefined, vaultKey: config.vaultKey ?? undefined });
const users = createUserStore({ db, identity });
export const PASSWORD = 'Excavator-Test-9-Pw'; // secret-scan:allow label text, not a credential

for (const [suffix, companyId] of [['d', 1], ['m', 2]]) {
  // connector codes are unique across the system, so the second company names its own in its policy
  const mail = companyId === 1 ? 'mail.main' : 'mail.second';
  db.prepare("INSERT INTO core_connectors (company_id, code, name, type, provider, environment, config_json, status, created_by) VALUES (?, ?, 'Mail', 'email', 'sandbox', 'development', '{\"fromAddress\":\"noreply@example.com\"}', 'ENABLED', 'e2e')").run(companyId, mail);
  // a company needs its own record before its organisation data can be added (defect D-074)
  if (companyId !== 1) db.prepare("INSERT OR IGNORE INTO org_companies (id, company_id, code, legal_name, short_name, created_by, source_type) VALUES (?, ?, 'SECOND', 'Second Infra Pvt Ltd', 'Second', 'e2e', 'seed')").run(companyId, companyId);
  if (companyId !== 1) db.prepare("INSERT INTO iam_auth_policy (company_id, settings_json, created_by, source_type) VALUES (?, ?, 'e2e', 'seed')").run(companyId, JSON.stringify({ notify: { connector: mail } }));
  const people = [
    ['admin', ['SYSADM']], ['itadm', ['ITADM']], ['hr', ['HRMGR']], ['approver', ['SYSADM']], ['dir', ['DIR']], ['scoped', []], ['pmx', ['PM']], ['scopeadm', ['SYSADM']], ['scopeit', ['ITADM']], ['field', ['PM']], ['lock', ['PM']], ['reset', ['PM']], ['spare', ['PM']], ['watch', ['PM']], ['elev', ['PM']], ['elevit', ['ITADM']], ['appear', ['PM']], ['format', ['PM']],
  ];
  for (const [name, roles] of people) {
    await users.create({ companyId, username: `${name}-${suffix}`, email: `${name}-${suffix}@example.com`, displayName: `${name[0].toUpperCase()}${name.slice(1)} ${String(suffix).toUpperCase()}`, roles, password: PASSWORD });
  }
}

const app = createApp({ config, db });
app.listen(config.port, () => console.log(`ERP API (sign-in mode) listening on http://localhost:${config.port}`));
startWorkers(db, { intervalMs: 1000 });
