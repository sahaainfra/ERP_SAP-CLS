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

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message ?? 'The server could not complete the request.');
    this.status = status;
    this.code = body?.error?.code ?? 'UNKNOWN';
    this.details = body?.error?.details ?? [];
    this.correlationId = body?.error?.correlationId ?? null;
  }
}

/** JSON call with the dev identity headers (AUTH_MODE=dev-headers, development/test only). */
export async function api(method, path, body) {
  const id = loadIdentity();
  let res;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-erp-user': id.user,
        'x-erp-roles': id.roles,
        'x-erp-company': id.company,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and try again.' } });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}
