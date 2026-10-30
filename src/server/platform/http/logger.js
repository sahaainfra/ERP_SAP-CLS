import { currentContext } from '../observability/context.js';
import { logBuffer } from '../observability/logbuffer.js';
import { redact } from '../observability/redact.js';

/**
 * Structured logging: one JSON object per line (FR-01). Every entry is redacted before it is written (BR-01), takes the
 * correlation ID of the work in progress when the caller did not give one, and is kept in the recent-log buffer the
 * Operations page searches. Request logs never include bodies or query strings.
 */
export function createLogger({ write = (line) => process.stdout.write(`${line}\n`), clock = () => new Date(), buffer = logBuffer } = {}) {
  const emit = (level) => (fields) => {
    const ctx = currentContext();
    const withContext = { time: clock().toISOString(), level, ...(ctx?.correlationId ? { correlationId: ctx.correlationId } : {}), ...(ctx?.user ? { user: ctx.user } : {}), ...fields };
    const safe = redact(withContext);
    buffer?.push(safe);
    write(JSON.stringify(safe));
  };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

/** @typedef {{ info: (fields?: any) => void, warn: (fields?: any) => void, error: (fields?: any) => void }} Logger */
/** @type {Logger} */
export const silentLogger = { info: () => {}, warn: () => {}, error: () => {} };

/** Collects redacted log entries in memory (tests). */
export function createMemoryLogger() {
  const entries = [];
  const add = (level) => (fields) => {
    const ctx = currentContext();
    entries.push({ level, ...(ctx?.correlationId && !fields.correlationId ? { correlationId: ctx.correlationId } : {}), ...redact(fields) });
  };
  return { entries, info: add('info'), warn: add('warn'), error: add('error') };
}

// The application's own logger, for code far from the request (consumers, jobs, the alert evaluator). createApp sets it.
/** @type {Logger} */
let appLogger = silentLogger;
export const setAppLogger = (logger) => {
  appLogger = logger ?? silentLogger;
};
export const log = {
  info: (f) => appLogger.info(f),
  warn: (f) => appLogger.warn(f),
  error: (f) => appLogger.error(f),
};
