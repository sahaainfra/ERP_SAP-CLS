// Vibration feedback (part 03.06, FR-04): a short pulse for a scan that worked, a double pulse for a warning, a long one for an error. Browsers
// that cannot vibrate (iOS Safari, most computers) do nothing, and a person who asked for reduced motion gets none.
export const PATTERNS = Object.freeze({ success: [30], warning: [60, 40, 60], error: [140], tap: [10] });

/** Vibrate for a kind of event. Returns whether the device was asked to vibrate. */
export function vibrate(kind, { nav = globalThis.navigator, reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches } = {}) {
  const pattern = PATTERNS[kind];
  if (!pattern || reduced || !nav || typeof nav.vibrate !== 'function') return false;
  try {
    return nav.vibrate(pattern) === true;
  } catch {
    return false;
  }
}
