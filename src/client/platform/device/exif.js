// EXIF of a JPEG photo (part 03.06, BR-02): when it was taken and where, read from the file, and kept in the file when the photo is made smaller.
// A photo from a phone camera carries these as evidence of an inspection or a delivery; redrawing it on a canvas drops them, so the original
// EXIF segment is put back into the smaller file (with the orientation set to "upright", because the canvas has already turned the pixels).
// Pure functions on bytes, so they run in Node for the tests.

const TAGS = { orientation: 0x0112, dateTime: 0x0132, make: 0x010f, model: 0x0110, exifIfd: 0x8769, gpsIfd: 0x8825, dateTimeOriginal: 0x9003, offsetTimeOriginal: 0x9011 };
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

/** The position and length of the Exif APP1 segment of a JPEG: { start, end } (the marker included), or null. */
function findExif(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1];
    if (marker === 0xda || marker === 0xd9) return null; // start of scan: no more headers
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xe1 && length >= 8 && bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 && bytes[i + 7] === 0x66 && bytes[i + 8] === 0 && bytes[i + 9] === 0) return { start: i, end: Math.min(i + 2 + length, bytes.length) };
    i += 2 + length;
  }
  return null;
}

/** A reader over the TIFF structure inside the segment. */
function tiff(bytes, seg) {
  const base = seg.start + 10; // after the marker, the length and "Exif\0\0"
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const little = bytes[base] === 0x49;
  if (!(bytes[base] === 0x49 || bytes[base] === 0x4d) || view.getUint16(base + 2, little) !== 42) return null;
  const u16 = (o) => view.getUint16(base + o, little);
  const u32 = (o) => view.getUint32(base + o, little);
  const within = (o, n) => o >= 0 && base + o + n <= seg.end;
  /** Entries of the IFD at an offset: [{ tag, type, count, at }] where `at` is where the value is (inline or pointed to). */
  const ifd = (offset) => {
    if (!within(offset, 2)) return [];
    const n = u16(offset);
    const out = [];
    for (let k = 0; k < n; k += 1) {
      const e = offset + 2 + k * 12;
      if (!within(e, 12)) break;
      const type = u16(e + 2);
      const count = u32(e + 4);
      const size = (TYPE_SIZE[type] ?? 1) * count;
      const at = size <= 4 ? e + 8 : u32(e + 8);
      if (within(at, size)) out.push({ tag: u16(e), type, count, at, valueAt: e + 8 });
    }
    return out;
  };
  const ascii = (e) => String.fromCharCode(...bytes.subarray(base + e.at, base + e.at + e.count)).replace(/\0.*$/, '').trim();
  const rationals = (e) => Array.from({ length: e.count }, (_, k) => { const d = u32(e.at + k * 8 + 4); return d === 0 ? 0 : u32(e.at + k * 8) / d; });
  return { base, little, u16, u32, ifd, ascii, rationals, view };
}

const degrees = (parts) => (parts.length === 3 ? parts[0] + parts[1] / 60 + parts[2] / 3600 : null);

/**
 * What the photo says about itself: { takenAt: 'YYYY-MM-DDTHH:MM:SS[+05:30]', gps: { lat, lng, altitude } | null, orientation, make, model }.
 * Null when the file is not a JPEG with EXIF. The time is the camera's own clock as written (usually local time, without an offset).
 */
export function readExif(bytes) {
  const seg = findExif(bytes);
  if (!seg) return null;
  const t = tiff(bytes, seg);
  if (!t) return null;
  const out = { takenAt: null, gps: null, orientation: null, make: null, model: null };
  try {
    readFacts(t, out);
  } catch {
    // a damaged segment gives what was read before the damage
  }
  return out;
}

function readFacts(t, out) {
  const ifd0 = t.ifd(t.u32(4));
  const find = (list, tag) => list.find((e) => e.tag === tag);
  const o = find(ifd0, TAGS.orientation);
  if (o) out.orientation = t.u16(o.at);
  const make = find(ifd0, TAGS.make);
  const model = find(ifd0, TAGS.model);
  if (make) out.make = t.ascii(make);
  if (model) out.model = t.ascii(model);
  const exifPtr = find(ifd0, TAGS.exifIfd);
  const exif = exifPtr ? t.ifd(t.u32(exifPtr.at)) : [];
  const taken = find(exif, TAGS.dateTimeOriginal) ?? find(ifd0, TAGS.dateTime);
  if (taken) {
    const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(t.ascii(taken));
    if (m) {
      const offset = find(exif, TAGS.offsetTimeOriginal);
      out.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset && /^[+-]\d{2}:\d{2}$/.test(t.ascii(offset)) ? t.ascii(offset) : ''}`;
    }
  }
  const gpsPtr = find(ifd0, TAGS.gpsIfd);
  if (gpsPtr) {
    const g = t.ifd(t.u32(gpsPtr.at));
    const latRef = find(g, 1);
    const lat = find(g, 2);
    const lngRef = find(g, 3);
    const lng = find(g, 4);
    if (latRef && lat && lngRef && lng) {
      const la = degrees(t.rationals(lat));
      const ln = degrees(t.rationals(lng));
      if (la !== null && ln !== null) {
        const alt = find(g, 6);
        const altRef = find(g, 5);
        out.gps = {
          lat: Number(((t.ascii(latRef) === 'S' ? -1 : 1) * la).toFixed(6)),
          lng: Number(((t.ascii(lngRef) === 'W' ? -1 : 1) * ln).toFixed(6)),
          altitude: alt ? Number(((altRef && t.view.getUint8(t.base + altRef.at) === 1 ? -1 : 1) * t.rationals(alt)[0]).toFixed(1)) : null,
        };
      }
    }
  }
}

/** The Exif APP1 segment of a JPEG, as bytes (marker and length included), or null. */
export function exifSegment(bytes) {
  const seg = findExif(bytes);
  return seg ? bytes.slice(seg.start, seg.end) : null;
}

/**
 * Put a photo's original EXIF segment into another JPEG (the smaller copy), right after the start marker. The orientation is set to 1:
 * the pixels of the smaller copy were already turned upright when the picture was redrawn.
 */
export function withExif(jpeg, segment) {
  if (!segment || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const copy = segment.slice();
  const t = tiff(copy, { start: 0, end: copy.length });
  const o = t?.ifd(t.u32(4)).find((e) => e.tag === TAGS.orientation);
  if (o) t.view.setUint16(t.base + o.valueAt, 1, t.little);
  const existing = findExif(jpeg);
  const rest = existing ? Uint8Array.from([...jpeg.subarray(2, existing.start), ...jpeg.subarray(existing.end)]) : jpeg.subarray(2);
  const out = new Uint8Array(2 + copy.length + rest.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(copy, 2);
  out.set(rest, 2 + copy.length);
  return out;
}

/** An EXIF APP1 segment for the given facts (the photo's time, position, orientation): for tests and for fixtures. Little-endian. */
export function buildExifSegment({ takenAt, gps = null, orientation = 1, make = 'ERP', model = 'Field phone' }) {
  const enc = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)).concat([0]));
  const stamp = takenAt.replace(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2}).*$/, '$1:$2:$3 $4:$5:$6');
  const parts = [];
  let size = 8; // TIFF header
  const place = (bytes) => { const at = size; parts.push([at, bytes]); size += bytes.length + (bytes.length % 2); return at; };
  const entry = (tag, type, count, valueOrOffset) => { const b = new Uint8Array(12); const v = new DataView(b.buffer); v.setUint16(0, tag, true); v.setUint16(2, type, true); v.setUint32(4, count, true); if (type === 3 && count === 1) v.setUint16(8, valueOrOffset, true); else v.setUint32(8, valueOrOffset, true); return b; };
  const ifdBytes = (entries) => { const b = new Uint8Array(2 + entries.length * 12 + 4); new DataView(b.buffer).setUint16(0, entries.length, true); entries.forEach((e, i) => b.set(e, 2 + i * 12)); return b; };
  const makeAt = place(enc(make));
  const modelAt = place(enc(model));
  const stampAt = place(enc(stamp));
  const rationals = (vals) => { const b = new Uint8Array(vals.length * 8); const v = new DataView(b.buffer); vals.forEach(([n, d], i) => { v.setUint32(i * 8, n, true); v.setUint32(i * 8 + 4, d, true); }); return b; };
  const dms = (deg) => { const a = Math.abs(deg); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const s = Math.round(((a - d) * 60 - m) * 60 * 10000); return rationals([[d, 1], [m, 1], [s, 10000]]); };
  // the sub-IFDs go first so their offsets are known, then IFD0 points at them
  const exifIfdAt = place(ifdBytes([entry(TAGS.dateTimeOriginal, 2, 20, stampAt)]));
  let gpsIfdAt = null;
  if (gps) {
    const latAt = place(dms(gps.lat));
    const lngAt = place(dms(gps.lng));
    gpsIfdAt = place(ifdBytes([
      entry(1, 2, 2, gps.lat < 0 ? 0x53 : 0x4e), entry(2, 5, 3, latAt), entry(3, 2, 2, gps.lng < 0 ? 0x57 : 0x45), entry(4, 5, 3, lngAt),
    ]));
  }
  const entries0 = [entry(TAGS.make, 2, make.length + 1, makeAt), entry(TAGS.model, 2, model.length + 1, modelAt), entry(TAGS.orientation, 3, 1, orientation), entry(TAGS.exifIfd, 4, 1, exifIfdAt)];
  if (gpsIfdAt !== null) entries0.push(entry(TAGS.gpsIfd, 4, 1, gpsIfdAt));
  const ifd0At = place(ifdBytes(entries0));
  const tiffBytes = new Uint8Array(size);
  tiffBytes.set([0x49, 0x49, 42, 0], 0);
  new DataView(tiffBytes.buffer).setUint32(4, ifd0At, true);
  for (const [at, bytes] of parts) tiffBytes.set(bytes, at);
  const header = Uint8Array.from([0xff, 0xe1, 0, 0, 0x45, 0x78, 0x69, 0x66, 0, 0]);
  const out = new Uint8Array(header.length + tiffBytes.length);
  out.set(header, 0);
  out.set(tiffBytes, header.length);
  new DataView(out.buffer).setUint16(2, out.length - 2, false);
  return out;
}
