import { exifSegment, readExif, withExif } from './exif.js';

// Photos from the camera (part 03.06, FR-04, BR-02): made smaller before they leave the device (longest side and JPEG quality are set per company,
// smaller again in low-bandwidth mode) while the time and position the camera wrote into the file stay in it as evidence.

const SMALL_ENOUGH = 300 * 1024; // a JPEG that is already within the limits and this small is sent as it is

/** Pick the limits: the company's, or the low-bandwidth ones. */
export const limitsFor = (settings, lowBandwidth) => (lowBandwidth ? settings.lowBandwidth : settings.image);

/**
 * Make a photo smaller. Returns { blob, name, width, height, originalBytes, bytes, takenAt, gps, keptExif }:
 * `takenAt` and `gps` are what the original file said (null when it said nothing), `keptExif` whether they are in the new file.
 */
export async function compressImage(file, { maxPx = 1600, quality = 0.8 } = {}) {
  if (!file.type?.startsWith('image/')) throw new Error('Choose a photo (JPEG, PNG or WebP).');
  const original = new Uint8Array(await file.arrayBuffer());
  const jpeg = file.type === 'image/jpeg';
  const facts = jpeg ? readExif(original) : null;
  const bitmap = await createImageBitmap(file); // the browser turns the picture upright using the orientation in the file
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  if (jpeg && scale === 1 && file.size <= SMALL_ENOUGH) {
    const out = { blob: file, name: file.name, width: bitmap.width, height: bitmap.height, originalBytes: file.size, bytes: file.size, takenAt: facts?.takenAt ?? null, gps: facts?.gps ?? null, keptExif: Boolean(facts) };
    bitmap.close?.();
    return out;
  }
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const drawn = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The photo could not be prepared.'))), 'image/jpeg', quality));
  let bytes = new Uint8Array(await drawn.arrayBuffer());
  const segment = jpeg ? exifSegment(original) : null;
  if (segment) bytes = withExif(bytes, segment);
  return {
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    name: `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`,
    width, height, originalBytes: file.size, bytes: bytes.length,
    takenAt: facts?.takenAt ?? null, gps: facts?.gps ?? null, keptExif: Boolean(segment),
  };
}

/** A short line about a prepared photo for the person: size before and after, and the evidence it carries. */
export function describePhoto(p) {
  const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
  const parts = [p.bytes < p.originalBytes ? `${kb(p.originalBytes)} made ${kb(p.bytes)}` : kb(p.bytes), `${p.width} x ${p.height}`];
  if (p.takenAt) parts.push(`taken ${p.takenAt.replace('T', ' ').slice(0, 16)}`);
  if (p.gps) parts.push(`position ${p.gps.lat.toFixed(5)}, ${p.gps.lng.toFixed(5)}`);
  if (!p.takenAt && !p.gps) parts.push('no time or position in the file');
  return parts.join(', ');
}
