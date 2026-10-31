import { createHash, randomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, conflict, notFound, unprocessable } from '../../platform/http/errors.js';
import { newTotpSecret, otpauthUri, verifyTotp } from '../../platform/identity/totp.js';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const iso = (ms) => new Date(ms).toISOString();
const OTP_MINUTES = 10;
const ISSUER = 'Construction ERP';
const normCode = (c) => String(c ?? '').replace(/[\s-]/g, '').toUpperCase();

function backupCodes() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 10 }, () => {
    const pick = () => Array.from({ length: 4 }, () => a[randomInt(a.length)]).join('');
    return `${pick()}-${pick()}`;
  });
}

/**
 * Second factors (FR-02): an authenticator app (TOTP), a one-time code by text or WhatsApp, and ten single-use backup codes.
 * The TOTP seed is stored encrypted with the vault; it is shown once, at enrolment, so it can be typed in by hand.
 */
export function createMfaService({ db, identity, notifier }) {
  const now = () => identity.now();
  const slot = (userId) => `iam/${userId}/totp`;
  const factors = (userId) => db.prepare("SELECT * FROM iam_mfa_factors WHERE user_id = ? AND is_active = 1 AND type != 'backup'").all(userId);
  const backup = (userId) => db.prepare("SELECT * FROM iam_mfa_factors WHERE user_id = ? AND type = 'backup' AND is_active = 1").get(userId) ?? null;

  const svc = {
    verifiedFactors: (userId) => factors(userId).filter((f) => f.verified_at),
    hasBackupCodes: (userId) => JSON.parse(backup(userId)?.meta_json ?? '{"codes":[]}').codes.length > 0,

    summary(userId) {
      return {
        factors: svc.verifiedFactors(userId).map((f) => ({ id: f.id, type: f.type, phone: f.phone ? `${'*'.repeat(Math.max(0, f.phone.length - 3))}${f.phone.slice(-3)}` : null, verifiedAt: f.verified_at, lastUsedAt: f.last_used_at })),
        backupCodesLeft: JSON.parse(backup(userId)?.meta_json ?? '{"codes":[]}').codes.length,
      };
    },

    /** Start (or restart) authenticator enrolment: a new unconfirmed seed, its otpauth link and a QR image. */
    async totpBegin(user) {
      if (svc.verifiedFactors(user.id).some((f) => f.type === 'totp')) throw conflict('An authenticator app is already set up. Remove it first to set up another.');
      const secret = newTotpSecret();
      const encrypted = identity.vault.encrypt(secret, slot(user.id));
      transaction(db, () => {
        db.prepare("DELETE FROM iam_mfa_factors WHERE user_id = ? AND type = 'totp' AND verified_at IS NULL").run(user.id);
        db.prepare("INSERT INTO iam_mfa_factors (company_id, user_id, type, secret_encrypted, created_by, source_type) VALUES (?, ?, 'totp', ?, ?, 'mfa_enrolment')").run(user.company_id, user.id, encrypted, user.username);
      });
      const uri = otpauthUri({ issuer: ISSUER, account: user.email ?? user.username, secret });
      return { secret, uri, qr: `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(uri, { type: 'svg', margin: 1, width: 220 })).toString('base64')}` };
    },

    /** Confirm the first code from the app. Success makes the factor real and returns the backup codes, once. */
    totpConfirm(user, code, nowMs = now()) {
      const f = db.prepare("SELECT * FROM iam_mfa_factors WHERE user_id = ? AND type = 'totp' AND verified_at IS NULL AND is_active = 1").get(user.id);
      if (!f) throw unprocessable('Start the set-up first: there is no authenticator waiting to be confirmed.');
      const counter = verifyTotp(identity.vault.decrypt(f.secret_encrypted, slot(user.id)), code, { nowMs });
      if (counter === null) return null;
      const codes = backupCodes();
      transaction(db, () => {
        db.prepare('UPDATE iam_mfa_factors SET verified_at = ?, last_used_at = ?, last_counter = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(iso(nowMs), iso(nowMs), counter, user.username, iso(nowMs), f.id);
        svc.storeBackup(user, codes);
        writeAudit(db, { entity: 'iam_mfa_factors', entityId: f.id, action: 'enrolled', newValues: { user: user.username, type: 'totp' }, actor: user.username });
        publishEvent(db, { type: 'iam.mfa.enrolled', entity: 'user', entityId: user.id, actorId: user.username, companyId: user.company_id, data: { type: 'totp' } });
      });
      return { backupCodes: codes };
    },

    storeBackup(user, codes) {
      const meta = JSON.stringify({ codes: codes.map((c) => sha(normCode(c))) });
      const existing = backup(user.id);
      if (existing) db.prepare('UPDATE iam_mfa_factors SET meta_json = ?, verified_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(meta, iso(now()), user.username, iso(now()), existing.id);
      else db.prepare("INSERT INTO iam_mfa_factors (company_id, user_id, type, meta_json, verified_at, created_by, source_type) VALUES (?, ?, 'backup', ?, ?, ?, 'mfa_enrolment')").run(user.company_id, user.id, meta, iso(now()), user.username);
    },

    /** Replace the backup codes (a signed-in user who has a factor). */
    regenerateBackup(user) {
      if (svc.verifiedFactors(user.id).length === 0) throw unprocessable('Set up an authenticator first; backup codes belong to it.');
      const codes = backupCodes();
      svc.storeBackup(user, codes);
      writeAudit(db, { entity: 'iam_mfa_factors', entityId: user.id, action: 'backup_codes_regenerated', newValues: { user: user.username }, actor: user.username });
      return { backupCodes: codes };
    },

    /** Start a text or WhatsApp factor: the code goes to the phone, and the factor counts once it is confirmed. */
    async phoneBegin(user, { phone, channel }) {
      if (!/^\+?[0-9]{10,15}$/.test(phone)) throw unprocessable('Give the mobile number with country code, digits only, for example +919876543210.');
      const code = String(randomInt(100000, 1000000));
      transaction(db, () => {
        db.prepare("DELETE FROM iam_mfa_factors WHERE user_id = ? AND type = ? AND verified_at IS NULL").run(user.id, channel);
        db.prepare('INSERT INTO iam_mfa_factors (company_id, user_id, type, phone, meta_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(user.company_id, user.id, channel, phone, JSON.stringify({ otpHash: sha(code), expires: iso(now() + OTP_MINUTES * 60_000), tries: 0 }), user.username, 'mfa_enrolment');
      });
      const sent = await notifier.phone(user.company_id, channel, phone, `Your ERP verification code is ${code}. It works for ${OTP_MINUTES} minutes.`);
      if (!sent.delivered) throw new HttpError(503, 'SERVICE_UNAVAILABLE', `The ${channel === 'sms' ? 'text message' : 'WhatsApp'} could not be sent (${sent.reason}). Ask an administrator to check the ${channel} connector.`);
      return { sent: true, expiresInMinutes: OTP_MINUTES };
    },

    phoneConfirm(user, channel, code) {
      const f = db.prepare('SELECT * FROM iam_mfa_factors WHERE user_id = ? AND type = ? AND verified_at IS NULL AND is_active = 1').get(user.id, channel);
      if (!f) throw unprocessable('Start the phone verification first.');
      if (!svc.otpMatches(f, code)) return null;
      const stamp = iso(now());
      transaction(db, () => {
        db.prepare("UPDATE iam_mfa_factors SET verified_at = ?, meta_json = '{}', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(stamp, user.username, stamp, f.id);
        if (!backup(user.id)) svc.storeBackup(user, []);
        writeAudit(db, { entity: 'iam_mfa_factors', entityId: f.id, action: 'enrolled', newValues: { user: user.username, type: channel }, actor: user.username });
        publishEvent(db, { type: 'iam.mfa.enrolled', entity: 'user', entityId: user.id, actorId: user.username, companyId: user.company_id, data: { type: channel } });
      });
      return { ok: true };
    },

    otpMatches(factor, code) {
      const meta = JSON.parse(factor.meta_json);
      if (!meta.otpHash || meta.expires <= iso(now()) || meta.tries >= 5) return false;
      const ok = meta.otpHash === sha(String(code ?? '').trim());
      db.prepare('UPDATE iam_mfa_factors SET meta_json = ? WHERE id = ?').run(JSON.stringify({ ...meta, tries: meta.tries + 1, ...(ok ? { otpHash: null } : {}) }), factor.id);
      return ok;
    },

    /** At sign-in: send a fresh code to the chosen text or WhatsApp factor. */
    async sendCode(user, factorId) {
      const f = svc.verifiedFactors(user.id).find((x) => x.id === Number(factorId) && x.type !== 'totp');
      if (!f) throw notFound('That second step is not available.');
      const code = String(randomInt(100000, 1000000));
      db.prepare('UPDATE iam_mfa_factors SET meta_json = ? WHERE id = ?').run(JSON.stringify({ otpHash: sha(code), expires: iso(now() + OTP_MINUTES * 60_000), tries: 0 }), f.id);
      const sent = await notifier.phone(user.company_id, f.type, f.phone, `Your ERP sign-in code is ${code}. It works for ${OTP_MINUTES} minutes.`);
      return { sent: sent.delivered, message: sent.delivered ? 'A code has been sent.' : 'The code could not be sent. Use your authenticator app or a backup code.' };
    },

    /** Check a code for the second step. @param {string} method */
    async check(user, method, code, factorId, nowMs) {
      if (method === 'totp') {
        for (const f of svc.verifiedFactors(user.id).filter((x) => x.type === 'totp')) {
          const counter = verifyTotp(identity.vault.decrypt(f.secret_encrypted, slot(user.id)), code, { nowMs, lastCounter: f.last_counter });
          if (counter !== null) {
            db.prepare('UPDATE iam_mfa_factors SET last_counter = ?, last_used_at = ? WHERE id = ?').run(counter, iso(nowMs), f.id);
            return true;
          }
        }
        return false;
      }
      if (method === 'backup') {
        const b = backup(user.id);
        const meta = JSON.parse(b?.meta_json ?? '{"codes":[]}');
        const h = sha(normCode(code));
        if (!b || !meta.codes.includes(h)) return false;
        db.prepare('UPDATE iam_mfa_factors SET meta_json = ?, last_used_at = ? WHERE id = ?').run(JSON.stringify({ codes: meta.codes.filter((c) => c !== h) }), iso(nowMs), b.id);
        writeAudit(db, { entity: 'iam_mfa_factors', entityId: b.id, action: 'backup_code_used', newValues: { left: meta.codes.length - 1 }, actor: user.username });
        return true;
      }
      if (method === 'sms' || method === 'whatsapp') {
        const f = svc.verifiedFactors(user.id).find((x) => x.type === method && (factorId == null || x.id === Number(factorId)));
        return Boolean(f) && svc.otpMatches(f, code);
      }
      return false;
    },

    /** Remove a factor. A person whose role requires MFA cannot remove their last one. */
    remove(user, factorId, { required }) {
      const f = svc.verifiedFactors(user.id).find((x) => x.id === Number(factorId));
      if (!f) throw notFound('That second step does not exist.');
      if (required && svc.verifiedFactors(user.id).length <= 1) throw unprocessable('Your role needs a second step, so your last one cannot be removed. Set up another first.');
      transaction(db, () => {
        db.prepare('UPDATE iam_mfa_factors SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE id = ?').run(iso(now()), user.username, f.id);
        if (svc.verifiedFactors(user.id).length === 0) db.prepare("UPDATE iam_mfa_factors SET is_active = 0, deleted_at = ?, deleted_by = ? WHERE user_id = ? AND type = 'backup'").run(iso(now()), user.username, user.id);
        writeAudit(db, { entity: 'iam_mfa_factors', entityId: f.id, action: 'removed', newValues: { user: user.username, type: f.type }, actor: user.username });
      });
      return { removed: true };
    },
  };
  return svc;
}
