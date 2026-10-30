/**
 * The most recent log entries, already redacted, kept in memory so an administrator can follow one correlation ID through the
 * Operations page without access to the server's log files. It is a convenience, not the log of record: the JSON lines on
 * standard output (collected by whatever runs the process) are.
 */
export function createLogBuffer(capacity = 2000) {
  const entries = [];
  return {
    push(entry) {
      entries.push(entry);
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
    },
    /** Entries with this correlation ID, oldest first. */
    byCorrelation: (id) => entries.filter((e) => e.correlationId === id),
    recent: (n = 100, minLevel = 'info') => {
      const rank = { info: 0, warn: 1, error: 2 };
      return entries.filter((e) => rank[e.level] >= rank[minLevel]).slice(-n);
    },
    size: () => entries.length,
    clear: () => entries.splice(0, entries.length),
  };
}

export const logBuffer = createLogBuffer();
