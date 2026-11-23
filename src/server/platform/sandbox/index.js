// The simulation sandbox (part 30.04, FR-05 and BR-01). A sandbox is an installation started with ERP_SANDBOX=true on a database of its own
// (loadConfig refuses a sandbox whose database file is not named as one, and a sandbox in production). In a sandbox nothing leaves the
// system: the integration hub's HTTP calls are refused (e-mail, SMS, WhatsApp, bank, GST, AI providers), webhooks are not delivered and web
// push is off; each refused call is counted so the sandbox page can show what would have gone out. The shell shows a SANDBOX banner.

const marked = new WeakMap();

export class SandboxBlocked extends Error {
  constructor(what) {
    super(`Sandbox: ${what} is not sent from the sandbox (synthetic data never leaves it).`);
    this.code = 'SANDBOX_BLOCKED';
  }
}

/** Mark a database as the sandbox's (the application does it at start when config.sandbox is on). */
export function markSandbox(db, { databasePath = null } = {}) {
  const state = { on: true, since: new Date().toISOString(), databasePath, blocked: { http: 0, webhooks: 0, push: 0 }, last: [], wired: [] };
  marked.set(db, state);
  return state;
}

/** The sandbox state of a database, or null outside a sandbox. */
export const sandboxOf = (db) => marked.get(db) ?? null;

function note(db, kind, target) {
  const s = marked.get(db);
  if (!s) return;
  s.blocked[kind] += 1;
  s.last.unshift({ kind, target: String(target ?? '').slice(0, 200), at: new Date().toISOString() });
  s.last.length = Math.min(s.last.length, 20);
}

/** The fetch the integration hub uses in a sandbox: every outbound call is refused and counted. */
export const blockedFetch = (db) => async (url) => {
  note(db, 'http', (() => { try { return new URL(String(url)).host; } catch { return 'unknown'; } })());
  throw new SandboxBlocked(`the call to ${(() => { try { return new URL(String(url)).host; } catch { return 'an outside system'; } })()}`);
};

/** Guard for the paths that call out directly (webhook delivery). Throws in a sandbox. */
export function assertOutboundAllowed(db, kind, target) {
  if (!marked.get(db)) return;
  note(db, kind, target);
  throw new SandboxBlocked(kind === 'webhooks' ? `the webhook to ${target}` : kind);
}
