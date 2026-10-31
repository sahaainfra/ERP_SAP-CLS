import { createVault } from '../integrations/vault.js';

/**
 * Rotating VAULT_KEY (part 02.07, FR-05): every stored connector credential is decrypted with the old key and encrypted again with
 * the new one, in one transaction, and checked by decrypting it with the new key. Nothing is written unless every value
 * decrypts with the old key, so a wrong old key changes nothing. With apply = false it only reports what it would do.
 */
export function rotateVaultKey({ db, oldKey, newKey, apply = false }) {
  if (!oldKey || !newKey) throw new Error('Both the old and the new key are needed.');
  if (oldKey === newKey) throw new Error('The new key is the same as the old one.');
  if (newKey.length < 32) throw new Error('The new key must be at least 32 characters.');
  const from = createVault({ secret: oldKey });
  const to = createVault({ secret: newKey });
  const rows = db.prepare('SELECT id, company_id, connector_id, key, encrypted_value FROM core_connector_secrets').all();
  const next = rows.map((r) => {
    const slot = `${r.company_id}/${r.connector_id}/${r.key}`;
    const plain = from.decrypt(r.encrypted_value, slot); // throws, naming nothing secret, when the old key is wrong
    const blob = to.encrypt(plain, slot);
    if (to.decrypt(blob, slot) !== plain) throw new Error(`Row ${r.id} did not survive re-encryption.`);
    return { id: r.id, blob };
  });
  if (!apply) return { values: rows.length, applied: false };
  db.exec('BEGIN IMMEDIATE');
  try {
    const upd = db.prepare('UPDATE core_connector_secrets SET encrypted_value = ?, updated_at = ? WHERE id = ?');
    const at = new Date().toISOString();
    for (const n of next) upd.run(n.blob, at, n.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { values: rows.length, applied: true };
}
