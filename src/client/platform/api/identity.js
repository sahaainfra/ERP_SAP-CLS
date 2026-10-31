// Development identity (AUTH_MODE=dev-headers). Replaced by real sign-in in the IAM module (defect D-001).
// This is the only file that knows how the API is authenticated; everything else goes through the client.
import { accessToken, authMode } from './auth.js';
const IDENTITY_KEY = 'erp.dev.identity';
export const DEFAULT_IDENTITY = { user: 'sysadmin', roles: 'SYSADM', company: '1' };

export function loadIdentity() {
  try {
    return { ...DEFAULT_IDENTITY, ...JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? '{}') };
  } catch {
    return DEFAULT_IDENTITY;
  }
}

export function saveIdentity(identity) {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* storage unavailable: identity lasts for this page load only */
  }
}

export function authHeaders() {
  if (authMode() === 'iam') return accessToken() ? { authorization: `Bearer ${accessToken()}` } : {};
  const id = loadIdentity();
  return { 'x-erp-user': id.user, 'x-erp-roles': id.roles, 'x-erp-company': id.company };
}
