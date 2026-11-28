// Indian identifiers (PACK-09): one definition of each format, used by the browser (the field checks and tidies the value when the person
// leaves it) and by the server (the zod schema checks it again). Each check returns a problem code, which is also the catalogue key of
// the text the person sees (`format` area: `id.<kind>.<problem>`), and an English message for API errors.
//
// Kinds: gstin, pan, tan, ifsc, uan, esic (10-digit insurance number), esicEmployer (17-digit employer code), aadhaar, aadhaarMasked,
// vehicle (registration number, state series and BH series), pincode, mobile.
//
// Aadhaar: only the last four digits are ever stored (the Aadhaar Act and UIDAI's storage rules). Two kinds:
//   aadhaar        the full 12 digits, sent only where the server keeps a keyed hash and the last four (HR, ADR-779). The browser also
//                  runs the Verhoeff check; the server checks the shape only (D-847: test data and older imports are not checksummed).
//   aadhaarMasked  the last four digits (XXXXXXXX1234). The browser masks a full number before sending; the server refuses a full one.
import { z } from 'zod';
import { gstinCheckChar, isStateCode } from '../gst.js';

const RTO_STATES = new Set(['AN', 'AP', 'AR', 'AS', 'BR', 'CH', 'CG', 'DD', 'DL', 'DN', 'GA', 'GJ', 'HR', 'HP', 'JK', 'JH', 'KA', 'KL', 'LA', 'LD', 'MP', 'MH', 'MN', 'ML', 'MZ', 'NL', 'OD', 'OR', 'PY', 'PB', 'RJ', 'SK', 'TN', 'TS', 'TG', 'TR', 'UP', 'UK', 'UA', 'WB']);

// Verhoeff check digit (the algorithm UIDAI publishes for Aadhaar), used only in the browser before masking.
const D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
const P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
/** True when a string of digits passes the Verhoeff check (its last digit is the check digit). */
export function verhoeffValid(digits) {
  let c = 0;
  const rev = String(digits).split('').reverse();
  for (let i = 0; i < rev.length; i += 1) c = D[c][P[i % 8][Number(rev[i])]];
  return c === 0;
}

const squash = (v) => String(v ?? '').trim().toUpperCase().replace(/[\s.-]+/g, '');

/**
 * Each kind: `normalise` gives the value as it is stored (capitals, no spaces), `problem` the code of what is wrong with a normalised
 * value or null, and `hint` an example. `messages` holds the English text of each problem code.
 */
export const INDIAN_IDS = Object.freeze({
  gstin: {
    label: 'GSTIN', hint: '15 characters, for example 36AABCS1429B1ZV', normalise: squash,
    problem: (v) => (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v) ? 'shape' : !isStateCode(v.slice(0, 2)) ? 'state' : gstinCheckChar(v.slice(0, 14)) !== v[14] ? 'check' : null),
    messages: { shape: 'A GSTIN has 15 characters: 2 digits of state code, the 10-character PAN, an entity number, Z and a check character.', state: 'The first two digits of this GSTIN are not a GST state code.', check: 'The check character of this GSTIN is wrong; re-check the number.' },
  },
  pan: {
    label: 'PAN', hint: 'five letters, four digits and a letter, for example ABCDE1234F', normalise: squash,
    problem: (v) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? null : 'shape'),
    messages: { shape: 'A PAN is five letters, four digits and a letter, for example ABCDE1234F.' },
  },
  tan: {
    label: 'TAN', hint: 'four letters, five digits and a letter, for example HYDA12345B', normalise: squash,
    problem: (v) => (/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(v) ? null : 'shape'),
    messages: { shape: 'A TAN is four letters, five digits and a letter, for example HYDA12345B.' },
  },
  ifsc: {
    label: 'IFSC', hint: 'four letters, a zero and six letters or digits, for example SBIN0001234', normalise: squash,
    problem: (v) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v) ? null : 'shape'),
    messages: { shape: 'An IFSC is four letters, a zero and six letters or digits, for example SBIN0001234.' },
  },
  uan: {
    label: 'UAN', hint: '12 digits', normalise: squash,
    problem: (v) => (/^[0-9]{12}$/.test(v) ? null : 'shape'),
    messages: { shape: 'A UAN (EPF universal account number) is 12 digits.' },
  },
  esic: {
    label: 'ESIC number', hint: '10 digits', normalise: squash,
    problem: (v) => (/^[0-9]{10}$/.test(v) ? null : 'shape'),
    messages: { shape: 'An ESIC insurance number is 10 digits.' },
  },
  esicEmployer: {
    label: 'ESIC employer code', hint: '17 digits', normalise: squash,
    problem: (v) => (/^[0-9]{17}$/.test(v) ? null : 'shape'),
    messages: { shape: 'An ESIC employer code is 17 digits.' },
  },
  aadhaar: {
    // the full number, in transit only: HR keeps a keyed hash (to find the same person twice) and the last four digits, never the number
    label: 'Aadhaar number', hint: '12 digits; only the last four are kept', normalise: squash,
    problem: (v) => (/^[0-9]{12}$/.test(v) ? null : 'shape'),
    messages: { shape: 'An Aadhaar number is 12 digits.', invalid: 'This is not a valid Aadhaar number (its check digit is wrong); re-check it.' },
  },
  aadhaarMasked: {
    label: 'Aadhaar (last 4 digits)', hint: 'only the last four digits are kept, for example XXXX XXXX 1234',
    normalise: (v) => {
      const s = squash(v).replace(/[*•]/g, 'X');
      if (/^[0-9]{4}$/.test(s)) return `XXXXXXXX${s}`;
      return s;
    },
    problem: (v) => (/^[0-9]{12}$/.test(v) ? 'full' : /^X{8}[0-9]{4}$/.test(v) ? null : 'shape'),
    messages: { full: 'Do not send the full Aadhaar number: only the last four digits are kept (XXXX XXXX 1234).', shape: 'Give the last four digits of the Aadhaar number, for example XXXX XXXX 1234.', invalid: 'This is not a valid Aadhaar number; re-check it.' },
  },
  vehicle: {
    label: 'vehicle number', hint: 'for example TS09EA1234 or 22BH1234AB', normalise: squash,
    problem: (v) => {
      if (/^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$/.test(v)) return null; // Bharat series
      if (!/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{1,4}$/.test(v)) return 'shape';
      return RTO_STATES.has(v.slice(0, 2)) ? null : 'state';
    },
    messages: { shape: 'A vehicle number is the state letters, the RTO number, the series and up to four digits, for example TS09EA1234.', state: 'The first two letters are not an Indian state or union territory code.' },
  },
  pincode: {
    label: 'PIN code', hint: 'six digits, not starting with 0', normalise: (v) => String(v ?? '').replace(/\s+/g, ''),
    problem: (v) => (/^[1-9][0-9]{5}$/.test(v) ? null : 'shape'),
    messages: { shape: 'A PIN code is six digits and does not start with 0.' },
  },
  mobile: {
    label: 'mobile number', hint: 'ten digits starting with 6, 7, 8 or 9',
    normalise: (v) => String(v ?? '').trim().replace(/[\s()-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ''),
    problem: (v) => (/^[6-9][0-9]{9}$/.test(v) ? null : 'shape'),
    messages: { shape: 'A mobile number is ten digits starting with 6, 7, 8 or 9 (+91 may be left out).' },
  },
});

export const ID_KINDS = Object.freeze(Object.keys(INDIAN_IDS));
const def = (kind) => {
  const d = INDIAN_IDS[kind];
  if (!d) throw new Error(`Unknown identifier kind ${kind}`);
  return d;
};

/** The value as it is stored ('' for nothing). */
export const normaliseId = (kind, value) => (value === null || value === undefined ? '' : def(kind).normalise(value));

/**
 * What is wrong with a value, after normalising: null when it is fine (or empty), else { code, key, message }. `key` is the catalogue
 * key (`format` area). With `{ client: true }` (the browser) a full Aadhaar number is Verhoeff-checked, and in a masked field it is
 * accepted when valid, because the browser masks it before sending.
 */
export function idProblem(kind, value, { client = false } = {}) {
  const d = def(kind);
  const v = normaliseId(kind, value);
  if (!v) return null;
  let code = d.problem(v);
  const checksumOk = () => /^[2-9]/.test(v) && verhoeffValid(v);
  if (client && kind === 'aadhaarMasked' && code === 'full') code = checksumOk() ? null : 'invalid';
  if (client && kind === 'aadhaar' && !code && !checksumOk()) code = 'invalid';
  return code ? { code, key: `id.${kind}.${code}`, message: d.messages[code] } : null;
}

/** True when the value is a well-formed identifier of that kind (empty is not valid). */
export const isValidId = (kind, value) => Boolean(normaliseId(kind, value)) && !idProblem(kind, value);

/** What the browser sends: normalised, and a full Aadhaar number in a masked field reduced to its last four digits. */
export function idForSending(kind, value) {
  const v = normaliseId(kind, value);
  if (kind === 'aadhaarMasked' && /^[0-9]{12}$/.test(v)) return `XXXXXXXX${v.slice(-4)}`;
  return v;
}

/**
 * The zod schema of an identifier: normalises, then refuses a bad value with the English message (the API's 422 lists it by field).
 * `optional: true` lets an empty value through as null.
 */
export function zIndianId(kind, { optional = false } = {}) {
  def(kind);
  const base = z.string().max(40).transform((v) => normaliseId(kind, v));
  const checked = base.superRefine((v, ctx) => {
    if (!v) { if (!optional) ctx.addIssue({ code: 'custom', message: `Give the ${INDIAN_IDS[kind].label}.` }); return; }
    const p = idProblem(kind, v);
    if (p) ctx.addIssue({ code: 'custom', message: p.message });
  }).transform((v) => v || null);
  return optional ? checked.nullish().transform((v) => v ?? null) : checked;
}
