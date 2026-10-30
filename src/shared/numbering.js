// Document-number formats such as "{PREFIX}/{PROJECT}/{FY}/{SEQ:6}". One implementation, used by the server to
// issue numbers and by the browser for the live preview in the format builder, so the preview cannot differ
// from the number actually issued (acceptance criterion AC-02).

export const TOKENS = Object.freeze({
  PREFIX: 'the series prefix, for example INV',
  BRANCH: 'the branch code of the series',
  PROJECT: 'the project code of the document',
  FY: 'the financial year, for example 2026-27',
  FYS: 'the short financial year, for example 2627',
  YYYY: 'the four-digit year of the document date',
  YY: 'the two-digit year of the document date',
  MM: 'the month of the document date',
  DD: 'the day of the document date',
  'SEQ:n': 'the running number, padded to n digits (1 to 10)',
});

const LITERAL = /^[A-Za-z0-9/_.#-]*$/;
const TOKEN = /\{([A-Z]+)(?::(\d+))?\}/g;
export const STATUTORY_MAX_LENGTH = 16; // GST rule 46: an invoice number has at most 16 characters
const STATUTORY_CHARS = /^[A-Za-z0-9/-]+$/;

/** Split a format into literal and token parts, or report why it is not valid. */
export function parseFormat(format) {
  const problems = [];
  const parts = [];
  let last = 0;
  let seqCount = 0;
  const text = String(format ?? '');
  for (const m of text.matchAll(TOKEN)) {
    const literal = text.slice(last, m.index);
    if (literal) parts.push({ literal });
    last = m.index + m[0].length;
    const [, name, width] = m;
    if (name === 'SEQ') {
      seqCount += 1;
      const n = Number(width);
      if (!width || n < 1 || n > 10) problems.push('{SEQ:n} needs a width from 1 to 10, for example {SEQ:6}');
      parts.push({ token: 'SEQ', width: n });
    } else if (['PREFIX', 'BRANCH', 'PROJECT', 'FY', 'FYS', 'YYYY', 'YY', 'MM', 'DD'].includes(name) && !width) {
      parts.push({ token: name });
    } else {
      problems.push(`{${name}${width ? `:${width}` : ''}} is not a known token`);
    }
  }
  const tail = text.slice(last);
  if (tail) parts.push({ literal: tail });
  for (const p of parts) {
    if (p.literal !== undefined && !LITERAL.test(p.literal)) problems.push(`"${p.literal}" has characters that are not allowed; use letters, digits and / _ . # -`);
  }
  if (/[{}]/.test(parts.filter((p) => p.literal !== undefined).map((p) => p.literal).join(''))) problems.push('A { or } is not part of a complete token');
  if (seqCount !== 1) problems.push('The format must contain exactly one {SEQ:n} token');
  return { parts, problems };
}

const has = (parts, ...names) => parts.some((p) => names.includes(p.token));

/**
 * Validate a format against its series rules. Returns a list of problems (empty means valid).
 * - a series that resets every financial year needs {FY}, {FYS} or {YYYY} in the number, or the numbers repeat;
 * - a monthly series needs the year and the month;
 * - a statutory series may only use letters, digits, "/" and "-" and must not exceed 16 characters.
 */
export function formatProblems(format, { resetRule = 'never', statutory = false, sample = /** @type {{ prefix?: string, branch?: string, project?: string }} */ ({}) } = {}) {
  const { parts, problems } = parseFormat(format);
  if (problems.length) return problems;
  const out = [];
  if (resetRule === 'financial_year' && !has(parts, 'FY', 'FYS', 'YYYY')) out.push('A series that restarts every financial year needs {FY}, {FYS} or {YYYY} in its format, or numbers would repeat');
  if (resetRule === 'monthly' && !(has(parts, 'YYYY', 'YY', 'FY', 'FYS') && has(parts, 'MM'))) out.push('A monthly series needs the year ({YYYY} or {YY}) and {MM} in its format, or numbers would repeat');
  if (statutory) {
    let widest = null;
    try {
      widest = formatNumber(format, { prefix: sample.prefix ?? '', branch: sample.branch ?? 'XXXXXX', project: sample.project ?? 'XXXXXX', fy: '2026-27', date: '2026-12-31', seq: 10 ** Math.max(...parts.filter((p) => p.token === 'SEQ').map((p) => p.width)) - 1 });
    } catch {
      /* a missing prefix is reported by the caller; the length cannot be judged without it */
    }
    if (widest !== null) {
      if (!STATUTORY_CHARS.test(widest)) out.push('A statutory number may only contain letters, digits, "/" and "-"');
      if (widest.length > STATUTORY_MAX_LENGTH) out.push(`A statutory number may have at most ${STATUTORY_MAX_LENGTH} characters; this format can reach ${widest.length}`);
    }
  }
  return out;
}

/** Build the number text. `v` = { prefix, branch, project, fy, date: 'YYYY-MM-DD', seq }. A missing value throws. */
export function formatNumber(format, v) {
  const { parts, problems } = parseFormat(format);
  if (problems.length) throw new RangeError(problems[0]);
  const need = (name, value) => {
    if (value === undefined || value === null || value === '') throw new RangeError(`The format needs ${name}, which was not supplied`);
    return String(value);
  };
  return parts
    .map((p) => {
      if (p.literal !== undefined) return p.literal;
      switch (p.token) {
        case 'PREFIX': return need('the series prefix', v.prefix);
        case 'BRANCH': return need('a branch code', v.branch);
        case 'PROJECT': return need('a project code', v.project);
        case 'FY': return need('a financial year', v.fy);
        case 'FYS': return need('a financial year', v.fy).replace('-', '').replace(/^(\d{2})(\d{2})(\d{2})$/, '$2$3');
        case 'YYYY': return need('a date', v.date).slice(0, 4);
        case 'YY': return need('a date', v.date).slice(2, 4);
        case 'MM': return need('a date', v.date).slice(5, 7);
        case 'DD': return need('a date', v.date).slice(8, 10);
        default: return String(v.seq).padStart(p.width, '0');
      }
    })
    .join('');
}

/** The key under which a series counter restarts: '' (never), the financial year code, or 'YYYY-MM'. */
export function periodKeyFor(resetRule, { fy, date }) {
  if (resetRule === 'financial_year') return fy ?? '';
  if (resetRule === 'monthly') return date.slice(0, 7);
  return '';
}

/** Which tokens a format uses; the issuer asks for exactly these from the caller. */
export const tokensUsed = (format) => new Set(parseFormat(format).parts.filter((p) => p.token).map((p) => p.token));
