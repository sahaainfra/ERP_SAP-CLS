// Five-field cron expressions ("minute hour day-of-month month day-of-week") evaluated in Indian Standard Time
// (UTC+05:30, no daylight saving), so "0 2 * * *" means 02:00 IST. Shared by the scheduler and by the browser's
// next-run preview, so the preview shows what the scheduler will do.

const IST_OFFSET_MS = 330 * 60_000;
const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

function parseField(text, { name, min, max }) {
  const values = new Set();
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new RangeError(`The ${name} field "${text}" is not valid`);
    const step = m[2] === undefined ? 1 : Number(m[2]);
    if (step < 1) throw new RangeError(`The ${name} step must be at least 1`);
    let from = min;
    let to = max;
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number);
      from = a;
      to = b ?? (m[2] === undefined ? a : max);
    }
    if (from < min || to > max || from > to) throw new RangeError(`The ${name} field must be between ${min} and ${max}`);
    for (let v = from; v <= to; v += step) values.add(name === 'day of week' && v === 7 ? 0 : v);
  }
  return values;
}

/** Parse an expression into sets of allowed values, or throw a RangeError that says what is wrong. */
export function parseCron(expression) {
  const parts = String(expression ?? '').trim().split(/\s+/);
  if (parts.length !== 5) throw new RangeError('A schedule has five fields: minute hour day-of-month month day-of-week');
  const [minute, hour, dom, month, dow] = parts.map((p, i) => parseField(p, FIELDS[i]));
  return { minute, hour, dom, month, dow, domAny: parts[2] === '*', dowAny: parts[4] === '*' };
}

export const cronProblem = (expression) => {
  try {
    parseCron(expression);
    return null;
  } catch (err) {
    return err.message;
  }
};

/** The first run strictly after `after` (a Date or ISO string), as an ISO UTC string. Searches up to four years ahead. */
export function nextRun(expression, after) {
  const cron = parseCron(expression);
  const start = new Date(typeof after === 'string' ? Date.parse(after) : after.getTime());
  // Work in "IST wall clock" by shifting the instant, then read the fields with the UTC getters.
  const t = new Date(Math.floor((start.getTime() + IST_OFFSET_MS) / 60_000) * 60_000 + 60_000);
  const limit = t.getTime() + 4 * 366 * 86_400_000;
  while (t.getTime() <= limit) {
    if (!cron.month.has(t.getUTCMonth() + 1)) {
      t.setUTCMonth(t.getUTCMonth() + 1, 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    const dayOk = cron.domAny && cron.dowAny
      ? true
      : cron.domAny
        ? cron.dow.has(t.getUTCDay())
        : cron.dowAny
          ? cron.dom.has(t.getUTCDate())
          : cron.dom.has(t.getUTCDate()) || cron.dow.has(t.getUTCDay());
    if (!dayOk) {
      t.setUTCDate(t.getUTCDate() + 1);
      t.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hour.has(t.getUTCHours())) {
      t.setUTCHours(t.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (!cron.minute.has(t.getUTCMinutes())) {
      t.setUTCMinutes(t.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(t.getTime() - IST_OFFSET_MS).toISOString();
  }
  throw new RangeError('This schedule never runs within the next four years');
}

/** The next `count` run times after `after`. */
export function nextRuns(expression, after, count = 5) {
  const out = [];
  let cursor = after;
  for (let i = 0; i < count; i += 1) {
    const next = nextRun(expression, cursor);
    out.push(next);
    cursor = next;
  }
  return out;
}
