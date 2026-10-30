/**
 * Structured logging: one JSON object per line. Request logs never include bodies or query strings,
 * so they cannot leak personal or financial data.
 */
export function createLogger({ write = (line) => process.stdout.write(`${line}\n`), clock = () => new Date() } = {}) {
  const emit = (level) => (fields) => write(JSON.stringify({ time: clock().toISOString(), level, ...fields }));
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export const silentLogger = { info() {}, warn() {}, error() {} };

/** Collects log entries in memory (tests). */
export function createMemoryLogger() {
  const entries = [];
  const add = (level) => (fields) => entries.push({ level, ...fields });
  return { entries, info: add('info'), warn: add('warn'), error: add('error') };
}
