// Re-encrypts every stored connector credential under a new VAULT_KEY (see docs/erp/SECRETS.md).
// Usage: OLD_VAULT_KEY=... NEW_VAULT_KEY=... DATABASE_PATH=data/erp.sqlite node scripts/rotate_vault_key.mjs [--apply]
// Without --apply it only checks that every value decrypts with the old key and says how many it would change.
import { openDatabase } from '../src/server/platform/db/index.js';
import { rotateVaultKey } from '../src/server/platform/security/rotate.js';

const path = process.env.DATABASE_PATH;
if (!path) { console.error('Set DATABASE_PATH.'); process.exit(2); }
try {
  const out = rotateVaultKey({ db: openDatabase(path), oldKey: process.env.OLD_VAULT_KEY, newKey: process.env.NEW_VAULT_KEY, apply: process.argv.includes('--apply') });
  console.log(out.applied ? `Re-encrypted ${out.values} value(s). Now set VAULT_KEY to the new key on every instance and restart.` : `Dry run: ${out.values} value(s) would be re-encrypted. Run again with --apply.`);
} catch (err) {
  console.error(`Not rotated: ${err.message}`);
  process.exit(1);
}
