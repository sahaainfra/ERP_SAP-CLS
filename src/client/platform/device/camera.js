import { exifSegment, readExif, withExif } from './exif.js';

// Photos from the camera (part 03.06, FR-04, BR-02): made smaller before they leave the device (longest side and JPEG quality are set per company,
// smaller again in low-bandwidth mode) while the time and position the camera wrote into the file stay in it as evidence.

const SMALL_ENOUGH = 300 * 1024; // a JPEG that is already within the limits and this small is sent as it is

/** Pick the limits: the company's, or the low-bandwidth ones. */
export const limitsFor = (settings, lowBandwidth) => (lowBandwidth ? settings.lowBandwidth : settings.image);

export const PHOTO_MAX_BYTES = 300 * 1024; // part 166.3, FR-03: a photo leaves the phone at 300 KB or less

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
/** 05-Nov-2026 14:05 IST: the stamp is written in India time whatever the phone's zone. */
export function stampTime(iso) {
  const t = new Date(new Date(iso).getTime() + 330 * 60_000);
  return `${pad(t.getUTCDate())}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())} IST`;
}
/** The words burnt into a photo: the time, and the position with its accuracy when there is one. */
export function stampText({ at, gps }) {
  const where = gps && Number.isFinite(gps.lat) && Number.isFinite(gps.lng) ? `${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}${Number.isFinite(gps.accuracy) ? ` ±${Math.round(gps.accuracy)} m` : ''}` : 'no position';
  return `${stampTime(at)} · ${where}`;
}

/** A dark band along the bottom of the photo with the stamp in white, made smaller until it fits the width. */
function drawStamp(ctx, width, height, text) {
  const band = Math.max(22, Math.round(Math.min(width, height) * 0.06));
  let size = Math.round(band * 0.5);
  ctx.font = `600 ${size}px sans-serif`;
  while (size > 9 && ctx.measureText(text).width > width - band) { size -= 1; ctx.font = `600 ${size}px sans-serif`; }
  // pixels of the photo itself, the same in every theme: black at 62 % under white letters
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = 'black';
  ctx.fillRect(0, height - band, width, band);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'white';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.round(band / 2), height - band / 2);
}

/**
 * Make a photo smaller. Returns { blob, name, width, height, originalBytes, bytes, takenAt, gps, keptExif, stamped }:
 * `takenAt` and `gps` are what the original file said (null when it said nothing), `keptExif` whether they are in the new file.
 * The result is at most `maxBytes` (300 KB): the JPEG quality is stepped down, then the size, until it fits (part 166.3). With `stamp`
 * ({ at, gps }) the time and position are burnt into the picture, so they stay with it whatever happens to the file's own data.
 */
export async function compressImage(file, { maxPx = 1600, quality = 0.8, maxBytes = PHOTO_MAX_BYTES, stamp = null } = {}) {
  if (!file.type?.startsWith('image/')) throw new Error('Choose a photo (JPEG, PNG or WebP).');
  const original = new Uint8Array(await file.arrayBuffer());
  const jpeg = file.type === 'image/jpeg';
  const facts = jpeg ? readExif(original) : null;
  const bitmap = await createImageBitmap(file); // the browser turns the picture upright using the orientation in the file
  if (!stamp && jpeg && Math.max(bitmap.width, bitmap.height) <= maxPx && file.size <= Math.min(SMALL_ENOUGH, maxBytes)) {
    const out = { blob: file, name: file.name, width: bitmap.width, height: bitmap.height, originalBytes: file.size, bytes: file.size, takenAt: facts?.takenAt ?? null, gps: facts?.gps ?? null, keptExif: Boolean(facts), stamped: false };
    bitmap.close?.();
    return out;
  }
  const segment = jpeg ? exifSegment(original) : null;
  const text = stamp ? stampText({ at: stamp.at ?? facts?.takenAt ?? new Date().toISOString(), gps: stamp.gps ?? facts?.gps ?? null }) : null;
  const canvas = document.createElement('canvas');
  let px = maxPx; let q = quality; let bytes; let width; let height;
  for (let attempt = 0; attempt < 16; attempt++) {
    const scale = Math.min(1, px / Math.max(bitmap.width, bitmap.height));
    width = Math.max(1, Math.round(bitmap.width * scale));
    height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (text) drawStamp(ctx, width, height, text);
    const drawn = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The photo could not be prepared.'))), 'image/jpeg', q));
    bytes = new Uint8Array(await drawn.arrayBuffer());
    if (segment) bytes = withExif(bytes, segment);
    if (bytes.length <= maxBytes || px <= 320) break;
    // first the quality (down to 0.5), then the size by a fifth with the quality back up a little
    if (q > 0.55) q = Math.round((q - 0.1) * 100) / 100; else { px = Math.max(320, Math.round(Math.max(width, height) * 0.8)); q = Math.max(0.5, quality - 0.15); }
  }
  bitmap.close?.();
  return {
    blob: new Blob([bytes], { type: 'image/jpeg' }),
    name: `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.jpg`,
    width, height, originalBytes: file.size, bytes: bytes.length,
    takenAt: facts?.takenAt ?? null, gps: facts?.gps ?? null, keptExif: Boolean(segment), stamped: Boolean(text), stampText: text,
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
