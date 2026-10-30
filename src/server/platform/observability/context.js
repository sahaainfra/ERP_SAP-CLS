import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomBytes } from 'node:crypto';

// The context of the work being done: which request (correlation ID), which user (pseudonym), which trace span. It follows the
// work through awaits, timers and callbacks, so a log line written deep inside a service, a consumer or a job carries the same
// correlation ID as the browser request that started it (FR-01, BR-02) without passing it through every function.
const store = new AsyncLocalStorage();

/** Run `fn` with this context; nested calls inherit what they do not override. */
export function runWithContext(ctx, fn) {
  return store.run({ ...(store.getStore() ?? {}), ...ctx }, fn);
}
export const currentContext = () => store.getStore() ?? null;
export const currentCorrelationId = () => store.getStore()?.correlationId ?? null;

const SALT = process.env.LOG_PSEUDONYM_SECRET ?? randomBytes(16).toString('hex');

/**
 * A stable pseudonym for a user ID: the same person always gets the same value within one installation, but the log does not
 * name them. With LOG_PSEUDONYM_SECRET set (the same on every instance) the value is stable across restarts and servers.
 */
export function pseudonym(userId, secret = SALT) {
  if (userId === null || userId === undefined || userId === '') return null;
  return `u_${createHmac('sha256', secret).update(String(userId)).digest('hex').slice(0, 10)}`;
}
