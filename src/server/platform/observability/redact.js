// What may never reach a log line (BR-01): passwords, tokens, secrets, full bank, Aadhaar and PAN numbers, identity
// numbers, GST numbers and the contents of documents. Redaction runs on every log entry before it is written, on both the
// field names (a value under "password" is hidden whatever it holds) and the text itself (a PAN written inside a message is
// masked wherever it sits). Identifiers keep their last four characters so an engineer can still tell two apart.

const MAX_TEXT = 500;
const MAX_DEPTH = 6;
const MAX_KEYS = 60;

/** Keys whose value is removed entirely. */
const SECRET_KEY = /(^|_|-)(password|passwd|pwd|secret|token|authorization|cookie|apikey|api_key|credential|otp|pin|signature|sig|salary|wage|wages|ctc|pay)(_|-|$)/i;
/** Keys whose value is a personal or financial identifier: masked to its last four characters. */
const IDENTIFIER_KEY = /(^|_|-)(pan|aadhaar|aadhar|uan|gstin|account|accountno|accountnumber|bankaccount|ifsc|passport|voter|licence|license|mobile|phone|email)(_|-|$)|pan$|gstin$|account(no|number)$/i;
/** Keys that hold what a document says: never logged. */
const CONTENT_KEY = /^(content|contents|body|text|document|doc|payload|html|markdown|file|data_url|dataurl|attachment|base64)$/i;

/** @type {[RegExp, any][]} */
const PATTERNS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]'],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, '[jwt redacted]'],
  [/\b([A-Z]{5}[0-9]{4})([A-Z])\b/g, (_m, a, b) => `XXXXXX${a.slice(-3)}${b}`],
  [/\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g, (m) => `XXXXXXXXXXX${m.slice(-4)}`],
  [/\b(\d{4})[ -]?(\d{4})[ -]?(\d{4})\b/g, (_m, _a, _b, c) => `XXXXXXXX${c}`],
  [/\b([A-Z]{4}0[A-Z0-9]{6})\b/g, 'XXXX0XXXXXX'],
  [/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '***@$1'],
];

/** Mask a value to its last four characters. */
export const maskTail = (value) => {
  const s = String(value);
  return s.length <= 4 ? '****' : `${'X'.repeat(Math.min(s.length - 4, 12))}${s.slice(-4)}`;
};

/** Mask the identifiers inside free text and cut it to a sensible length. */
export function redactText(text) {
  let out = String(text);
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  // A long run of digits that looks like a bank account number (9 to 18 digits).
  out = out.replace(/\b\d{9,18}\b/g, (m) => maskTail(m));
  return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}...[cut]` : out;
}

/** A copy of any value that is safe to write to a log. Never throws; handles cycles, Errors, Buffers and huge objects. */
export function redact(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `[${value.length} bytes omitted]`;
  if (value instanceof Error) return { name: value.name, message: redactText(value.message), ...(value.stack ? { stack: redactText(value.stack.split('\n').slice(0, 8).join('\n')) } : {}) };
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[too deep]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => redact(v, depth + 1, seen));
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, MAX_KEYS)) {
    if (SECRET_KEY.test(k)) out[k] = '[redacted]';
    else if (CONTENT_KEY.test(k)) out[k] = '[content omitted]';
    else if (IDENTIFIER_KEY.test(k) && v !== null && typeof v !== 'object') out[k] = maskTail(v);
    else out[k] = redact(v, depth + 1, seen);
  }
  return out;
}
