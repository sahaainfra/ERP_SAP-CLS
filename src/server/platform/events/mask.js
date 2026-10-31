// Event payloads shown to administrators are masked: figures and identifiers that only some roles may see never
// appear in the monitor, the dead-letter viewer or an export (standards section 8).
const SENSITIVE = /(^|_)(pan|gstin|aadhaar|aadhar|account|ifsc|salary|wage|rate|cost|margin|password|secret|token|bank|mobile|phone|email)(_|$)|pan$|gstin$/i;
const snake = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

export function maskPayload(value) {
  if (Array.isArray(value)) return value.map(maskPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(snake(k)) && v !== null && typeof v !== 'object' ? '***' : maskPayload(v)]));
  }
  return value;
}

/** Is this (snake_case) field name one whose value must not be shown? */
export const isSensitiveKey = (key) => SENSITIVE.test(key);
