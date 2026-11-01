import tokens from './design-tokens.json' with { type: 'json' };

// What a status looks like (part 03.01, FR-06): Draft neutral, Submitted and In review info, Approved and Completed success,
// Returned and At risk warning, Rejected, Overdue and Critical error, Cancelled muted. One table, used by every list and badge.
const MAP = tokens.status.map;
export const STATUS_TONES = tokens.status.tones;

/** The tone of a status code (any case, spaces or dashes); unknown statuses are neutral. */
export function statusTone(status) {
  const key = String(status ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return MAP[key] ?? 'neutral';
}
