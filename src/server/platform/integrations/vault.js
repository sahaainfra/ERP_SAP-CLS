import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { transaction } from '../db/index.js';
import { writeAudit } from '../audit/index.js';
import { unprocessable } from '../http/errors.js';

/** Used only when no VAULT_KEY is configured, which config.js refuses in staging and production. */
export const DEV_VAULT_KEY = 'development-only-vault-key-do-not-use-for-real-secrets';
const VERSION = 'v1';

/**
 * Encryption at rest for connector credentials (FR-02): AES-256-GCM with a random nonce per value. The slot a secret
 * belongs to (connector and key name) is bound in as additional data, so a ciphertext copied to another row will not
 * decrypt. Output: `v1.<nonce>.<tag>.<ciphertext>`, base64url.
 */
export function createVault({ secret = DEV_VAULT_KEY } = {}) {
  const key = createHash('sha256').update(`erp-vault:${secret}`).digest();
  return {
    encrypt(plain, slot) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(slot));
      const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
    },
    decrypt(blob, slot) {
      const [version, iv, tag, body] = String(blob).split('.');
      if (version !== VERSION || !iv || !tag || !body) throw new Error('The stored secret is not in a known format.');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(slot));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
    },
  };
}

const slotOf = (companyId, connectorId, key) => `${companyId}/${connectorId}/${key}`;
const iso = (ms) => new Date(ms).toISOString();

/**
 * The credentials store. Values go in encrypted and come out only through `read`, which the integration service alone
 * calls (BR-01); every other function returns names and dates. A new value is staged as PENDING until the approval of the
 * change request that carries it promotes it to ACTIVE and retires the one it replaces.
 */
export function createSecretStore({ db, vault, now = () => Date.now() }) {
  return {
    /** Stage a new value for approval. Replaces an earlier staged value for the same key. */
    stage(actor, connector, key, value, { expiresAt = null } = {}) {
      const encrypted = vault.encrypt(value, slotOf(connector.company_id, connector.id, key));
      transaction(db, () => {
        db.prepare("DELETE FROM core_connector_secrets WHERE connector_id = ? AND key = ? AND status = 'PENDING'").run(connector.id, key);
        db.prepare("INSERT INTO core_connector_secrets (company_id, connector_id, key, encrypted_value, status, expires_at, created_by, source_type) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, 'connector_secret')")
          .run(connector.company_id, connector.id, key, encrypted, expiresAt, actor.user);
        writeAudit(db, { entity: 'core_connector_secrets', entityId: `${connector.id}/${key}`, action: 'staged', newValues: { connector: connector.code, key, expiresAt }, actor: actor.user });
      });
    },

    /** Make the staged values for these keys current. Runs in the approver's transaction. */
    promote(connector, keys, actor) {
      const stamp = iso(now());
      for (const key of keys) {
        const staged = db.prepare("SELECT id FROM core_connector_secrets WHERE connector_id = ? AND key = ? AND status = 'PENDING'").get(connector.id, key);
        if (!staged) throw unprocessable(`The new value for "${key}" is no longer staged. Ask for the change again.`);
        db.prepare("UPDATE core_connector_secrets SET status = 'RETIRED', updated_by = ?, updated_at = ?, version = version + 1, is_active = 0 WHERE connector_id = ? AND key = ? AND status = 'ACTIVE'").run(actor.user, stamp, connector.id, key);
        db.prepare("UPDATE core_connector_secrets SET status = 'ACTIVE', rotated_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, actor.user, stamp, staged.id);
        writeAudit(db, { entity: 'core_connector_secrets', entityId: `${connector.id}/${key}`, action: 'rotated', newValues: { connector: connector.code, key, rotatedAt: stamp }, actor: actor.user });
      }
    },

    /** Names, dates and state only. There is no function that returns a value except `read`. */
    describe(connectorId) {
      return db
        .prepare("SELECT key, status, rotated_at, expires_at, created_at FROM core_connector_secrets WHERE connector_id = ? AND status IN ('ACTIVE', 'PENDING') ORDER BY key, status")
        .all(connectorId)
        .map((s) => ({ key: s.key, status: s.status, isSet: true, rotatedAt: s.rotated_at, expiresAt: s.expires_at, expired: Boolean(s.expires_at && s.expires_at < iso(now())) }));
    },

    has(connectorId, key, { includePending = false } = {}) {
      const statuses = includePending ? "('ACTIVE', 'PENDING')" : "('ACTIVE')";
      return Boolean(db.prepare(`SELECT 1 FROM core_connector_secrets WHERE connector_id = ? AND key = ? AND status IN ${statuses}`).get(connectorId, key));
    },

    /** Decrypt the current values for the integration service. One audit row records which keys were opened and why. */
    read(connector, keys, /** @type {{ purpose?: string, actor?: string, correlationId?: string | null }} */ { purpose, actor = 'system', correlationId = null } = {}) {
      const out = {};
      const expired = [];
      for (const key of keys) {
        const row = db.prepare("SELECT encrypted_value, expires_at FROM core_connector_secrets WHERE connector_id = ? AND key = ? AND status = 'ACTIVE'").get(connector.id, key);
        if (!row) continue;
        if (row.expires_at && row.expires_at < iso(now())) {
          expired.push(key);
          continue;
        }
        out[key] = vault.decrypt(row.encrypted_value, slotOf(connector.company_id, connector.id, key));
      }
      if (keys.length) {
        writeAudit(db, { entity: 'core_connector_secrets', entityId: connector.id, action: 'access', newValues: { connector: connector.code, keys: Object.keys(out), purpose }, actor, correlationId });
      }
      return { values: out, expired };
    },
  };
}
