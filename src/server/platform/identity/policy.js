import { createHash } from 'node:crypto';

/** The authentication policy of a company (FR-03, FR-04, FR-06). Every value is configuration; changes are maker-checker. */
export const DEFAULT_POLICY = Object.freeze({
  password: { minLength: 10, expiryDays: 90, historyCount: 5, breachedCheck: 'local' },
  lockout: { threshold: 5, baseDelayMinutes: 1, maxDelayMinutes: 60, captchaAfter: 3 },
  mfa: { enforced: true, requiredRoles: ['SYSADM', 'ITADM', 'CFO', 'DIR'], rememberDeviceDays: 30, rememberForPrivileged: false, challengeMinutes: 5 },
  session: { idleMinutes: 30, absoluteHours: 12, maxConcurrent: 5, accessMinutes: 10 },
  alerts: { newDevice: true, newCountry: true, impossibleTravelHours: 2 },
  sso: { enabled: false, providers: [] },
  notify: { connector: 'mail.main', smsConnector: 'sms.otp', whatsappConnector: 'whatsapp.otp' },
});

export const MIN_PASSWORD_LENGTH = 10;
const SECTIONS = Object.keys(DEFAULT_POLICY);

/** Stored values over the defaults, section by section, so a new setting added later still has a value. */
export function mergePolicy(stored, changes = {}) {
  const out = {};
  for (const s of SECTIONS) {
    out[s] = { ...structuredClone(DEFAULT_POLICY[s]), ...(stored?.[s] ?? {}), ...(changes[s] ?? {}) };
  }
  return out;
}

const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Human-readable problems with a complete policy; empty when it can be saved. */
export function policyProblems(p) {
  const problems = [];
  const need = (ok, message) => ok || problems.push(message);
  need(int(p.password.minLength, MIN_PASSWORD_LENGTH, 128), `The minimum password length is ${MIN_PASSWORD_LENGTH} to 128 characters.`);
  need(int(p.password.expiryDays, 0, 730), 'Password expiry is 0 (never) to 730 days.');
  need(int(p.password.historyCount, 5, 24), 'Remember at least the last 5 passwords (up to 24).');
  need(['off', 'local', 'hibp'].includes(p.password.breachedCheck), 'The breached-password check is off, local or hibp.');
  need(int(p.lockout.threshold, 3, 20), 'Lock the account after 3 to 20 failed attempts.');
  need(int(p.lockout.baseDelayMinutes, 1, 60) && int(p.lockout.maxDelayMinutes, 1, 1440) && p.lockout.baseDelayMinutes <= p.lockout.maxDelayMinutes, 'The first lock is 1 to 60 minutes and no longer than the longest lock (up to 1440).');
  need(int(p.lockout.captchaAfter, 1, 20) && p.lockout.captchaAfter <= p.lockout.threshold, 'Ask for a CAPTCHA from 1 failure up to the lockout threshold.');
  need(typeof p.mfa.enforced === 'boolean', 'MFA enforcement is on or off.');
  need(Array.isArray(p.mfa.requiredRoles) && p.mfa.requiredRoles.every((r) => /^[A-Z][A-Z0-9_]{1,20}$/.test(r)), 'List role codes such as SYSADM.');
  need(int(p.mfa.rememberDeviceDays, 0, 30), 'A device can be remembered for 0 to 30 days.');
  need(typeof p.mfa.rememberForPrivileged === 'boolean', 'Remembering a device for privileged roles is on or off.');
  need(int(p.mfa.challengeMinutes, 2, 15), 'The MFA step must be completed within 2 to 15 minutes.');
  need(int(p.session.idleMinutes, 5, 480), 'Sign out after 5 to 480 idle minutes.');
  need(int(p.session.absoluteHours, 1, 72) && p.session.absoluteHours * 60 >= p.session.idleMinutes, 'A session lasts 1 to 72 hours and at least as long as the idle time.');
  need(int(p.session.maxConcurrent, 1, 20), 'Allow 1 to 20 sessions at once.');
  need(int(p.session.accessMinutes, 2, 60), 'Access tokens last 2 to 60 minutes.');
  need(typeof p.alerts.newDevice === 'boolean' && typeof p.alerts.newCountry === 'boolean' && int(p.alerts.impossibleTravelHours, 0, 48), 'Check the suspicious-login settings.');
  need(typeof p.sso.enabled === 'boolean' && Array.isArray(p.sso.providers) && p.sso.providers.length <= 5, 'SSO is on or off with at most 5 providers.');
  for (const sp of p.sso.providers) {
    need(/^[a-z][a-z0-9_-]{1,30}$/.test(String(sp.id ?? '')) && ['oidc', 'saml'].includes(sp.type) && /^https:\/\//.test(String(sp.issuer ?? '')) && String(sp.clientId ?? '').length >= 3, 'Each SSO provider needs an id, a type (oidc or saml), an https issuer and a client ID.');
  }
  for (const k of ['connector', 'smsConnector', 'whatsappConnector']) need(/^[a-z][a-z0-9_.-]{2,40}$/.test(String(p.notify[k] ?? '')), 'Name the email, SMS and WhatsApp connectors that carry sign-in codes and alerts.');
  return problems;
}

const COMMON = new Set(
  ('password password1 password123 passw0rd p@ssw0rd p@ssword admin admin123 administrator welcome welcome1 welcome123 letmein qwerty qwerty123 qwertyuiop abc123 abcd1234 1234567890 123456789 12345678 111111 000000 iloveyou monkey dragon master sunshine princess football baseball superman trustno1 changeme changeme123 default secret secret123 login login123 india123 india@123 sahaa123 sahaainfra construction erp12345 erp@12345 test1234 temp1234 user1234 guest1234')
    .split(' '),
);

/**
 * Problems with a new password, empty when it is acceptable (FR-03). `breached` is the result of the optional k-anonymity check, `reused`
 * whether it matches one of the last passwords; both are decided by the caller, which owns the database and the network.
 */
export function passwordProblems(plain, policy, { username = '', email = '', breached = false, reused = false } = {}) {
  const problems = [];
  const pw = String(plain ?? '');
  if (pw.length < policy.password.minLength) problems.push(`Use at least ${policy.password.minLength} characters.`);
  if (pw.length > 128) problems.push('Use at most 128 characters.');
  const lower = pw.toLowerCase();
  const user = username.toLowerCase();
  if (user && lower.includes(user) && user.length >= 4) problems.push('Do not include your username.');
  if (email && lower.includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length >= 4) problems.push('Do not include your email name.');
  if (policy.password.breachedCheck !== 'off' && (COMMON.has(lower) || /^(.)\1+$/.test(pw) || /^(0123456789|1234567890|abcdefghij)/i.test(pw))) problems.push('That password is too common. Choose something harder to guess.');
  if (breached) problems.push('That password has appeared in a known data breach. Choose another.');
  if (reused) problems.push(`Do not reuse one of your last ${policy.password.historyCount} passwords.`);
  return problems;
}

/**
 * Pwned Passwords k-anonymity check: only the first five characters of the SHA-1 leave this server, and the answer is searched here.
 * Any failure to ask is treated as "not breached": a down service must not stop people changing their password.
 */
export async function isBreached(plain, fetchImpl = globalThis.fetch) {
  try {
    const sha = createHash('sha1').update(plain).digest('hex').toUpperCase();
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${sha.slice(0, 5)}`, { headers: { 'add-padding': 'true' }, signal: AbortSignal.timeout(2500) });
    if (!res.ok) return false;
    return (await res.text()).split('\n').some((line) => {
      const [suffix, count] = line.trim().split(':');
      return suffix === sha.slice(5) && Number(count) > 0;
    });
  } catch {
    return false;
  }
}
