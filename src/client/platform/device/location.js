// The device's position (part 03.06, FR-04, BR-01). It is read once, on an explicit action (a punch, a DPR, an inspection), after the person has been
// told so. There is no background tracking: the position is never followed, and a test fails the build if the browser's continuous-watching call is used anywhere.

const TWO_MINUTES = 2 * 60 * 1000;

/**
 * Signs that a reading may not come from the device's own sensors. A browser cannot see whether a mock-location app is running, so these are
 * hints for the reviewer, never a verdict: the reading is kept and the hints are stored with it.
 * @returns {{ code: string, message: string }[]}
 */
export function mockHints(position, { nowMs = Date.now(), previous = null } = {}) {
  const hints = [];
  const { lat, lng, accuracy } = position;
  if (position.mocked === true) hints.push({ code: 'device_says_mocked', message: 'The device reports that the position is mocked.' });
  if (accuracy !== null && accuracy !== undefined && accuracy < 1) hints.push({ code: 'accuracy_exact', message: 'The position claims an accuracy better than one metre, which a phone seldom gives.' });
  const rounded = (v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-7;
  if (rounded(lat) && rounded(lng)) hints.push({ code: 'rounded', message: 'Both coordinates are round numbers to three decimals.' });
  if (nowMs - position.timestamp > TWO_MINUTES) hints.push({ code: 'stale', message: 'The position is more than two minutes old.' });
  if (position.timestamp - nowMs > 60_000) hints.push({ code: 'future', message: 'The position is stamped later than the device clock.' });
  if (previous && previous.lat === lat && previous.lng === lng && previous.accuracy === accuracy && previous.timestamp !== position.timestamp) hints.push({ code: 'repeat', message: 'The position is exactly the same as the previous reading, to the last decimal.' });
  return hints;
}

/** "good", "fair" or "poor" for an accuracy in metres, and what to tell the person about it. */
export function accuracyRating(accuracy) {
  if (accuracy === null || accuracy === undefined) return { level: 'poor', text: 'The accuracy is not known.' };
  if (accuracy <= 20) return { level: 'good', text: `Accurate to ${Math.round(accuracy)} m.` };
  if (accuracy <= 100) return { level: 'fair', text: `Accurate to ${Math.round(accuracy)} m. In the open, away from buildings, it gets better.` };
  return { level: 'poor', text: `Only accurate to ${Math.round(accuracy)} m. Move into the open and try again.` };
}

const REASONS = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
let lastReading = null;

/**
 * Read the position once. Rejects with an Error whose `reason` is 'unsupported', 'denied', 'unavailable' or 'timeout'.
 * Resolves { lat, lng, accuracy, altitude, timestamp, capturedAt, hints, rating }.
 */
export function readPosition({ timeoutMs = 15_000, geolocation = globalThis.navigator?.geolocation, nowMs = () => Date.now() } = {}) {
  return new Promise((resolve, reject) => {
    if (!geolocation) { reject(Object.assign(new Error('This device or browser cannot give a position.'), { reason: 'unsupported' })); return; }
    geolocation.getCurrentPosition(
      (p) => {
        const reading = {
          lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)),
          accuracy: p.coords.accuracy === null ? null : Math.round(p.coords.accuracy * 10) / 10, altitude: p.coords.altitude ?? null,
          timestamp: p.timestamp, mocked: p.coords.mocked === true || p.mocked === true,
        };
        const hints = mockHints(reading, { nowMs: nowMs(), previous: lastReading });
        lastReading = reading;
        resolve({ ...reading, capturedAt: new Date(nowMs()).toISOString(), hints, rating: accuracyRating(reading.accuracy) });
      },
      (err) => reject(Object.assign(new Error(err.message || 'The position could not be read.'), { reason: REASONS[err.code] ?? 'unavailable' })),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/** What to tell a person whose reading failed. */
export const positionProblem = (reason) => ({
  denied: 'Location permission was refused. Allow it for this site in the browser settings, or type the coordinates.',
  unavailable: 'The position could not be found. Move into the open and try again.',
  timeout: 'Finding the position took too long. Move into the open and try again.',
  unsupported: 'This device or browser cannot give a position. Type the coordinates instead.',
}[reason] ?? 'The position could not be read.');
