// Photo metadata (FR-04). Reads the capture time and GPS position from a JPEG's EXIF block, and can remove every other
// piece of metadata (camera make and model, serial numbers, owner, thumbnails) from a JPEG or PNG on request. Only the
// orientation tag is kept in the file so the picture still shows the right way up; time and position stay in the record.

const TAGS = { orientation: 0x0112, exifPointer: 0x8769, gpsPointer: 0x8825, dateTimeOriginal: 0x9003, gpsLatRef: 1, gpsLat: 2, gpsLonRef: 3, gpsLon: 4 };

function segments(buf) {
  // [{ marker, start, end }] for JPEG segments before the image data; start is the marker byte offset.
  const out = [];
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xff) {
    const marker = buf[i + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = buf.readUInt16BE(i + 2);
    out.push({ marker, start: i, end: i + 2 + len });
    i += 2 + len;
  }
  return out;
}

const isExif = (buf, s) => s.marker === 0xe1 && buf.toString('latin1', s.start + 4, s.start + 10) === 'Exif\0\0';

function readIfd(tiff, offset, le) {
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const entries = new Map();
  if (offset + 2 > tiff.length) return { entries, u16, u32 };
  const n = u16(offset);
  for (let k = 0; k < n; k += 1) {
    const e = offset + 2 + k * 12;
    if (e + 12 > tiff.length) break;
    const tag = u16(e);
    const type = u16(e + 2);
    const count = u32(e + 4);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[type] ?? 1;
    const at = size * count > 4 ? u32(e + 8) : e + 8;
    entries.set(tag, { type, count, at });
  }
  return { entries, u16, u32 };
}

const rationals = (tiff, e, u32) => Array.from({ length: e.count }, (_, i) => u32(e.at + i * 8) / (u32(e.at + i * 8 + 4) || 1));
const degrees = (v) => (v.length === 3 ? v[0] + v[1] / 60 + v[2] / 3600 : null);

/** { capturedAt: 'YYYY-MM-DDTHH:MM:SS' (camera local time), gps: { lat, lon } | null, orientation } or null when there is no EXIF. */
export function readJpegExif(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const seg = segments(buf).find((s) => isExif(buf, s));
  if (!seg) return null;
  const tiff = buf.subarray(seg.start + 10, seg.end);
  if (tiff.length < 8) return null;
  const le = tiff.toString('latin1', 0, 2) === 'II';
  if (!le && tiff.toString('latin1', 0, 2) !== 'MM') return null;
  try {
    const ifd0 = readIfd(tiff, le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4), le);
    const out = { capturedAt: null, gps: null, orientation: null };
    const o = ifd0.entries.get(TAGS.orientation);
    if (o) out.orientation = ifd0.u16(o.at);
    const exifPtr = ifd0.entries.get(TAGS.exifPointer);
    if (exifPtr) {
      const sub = readIfd(tiff, ifd0.u32(exifPtr.at), le);
      const d = sub.entries?.get(TAGS.dateTimeOriginal);
      if (d) {
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(tiff.toString('latin1', d.at, d.at + d.count));
        if (m) out.capturedAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
      }
    }
    const gpsPtr = ifd0.entries.get(TAGS.gpsPointer);
    if (gpsPtr) {
      const g = readIfd(tiff, ifd0.u32(gpsPtr.at), le);
      const lat = g.entries?.get(TAGS.gpsLat);
      const lon = g.entries?.get(TAGS.gpsLon);
      const latRef = g.entries?.get(TAGS.gpsLatRef);
      const lonRef = g.entries?.get(TAGS.gpsLonRef);
      if (lat && lon && latRef && lonRef) {
        const la = degrees(rationals(tiff, lat, g.u32));
        const lo = degrees(rationals(tiff, lon, g.u32));
        if (la !== null && lo !== null) {
          out.gps = {
            lat: Math.round((tiff.toString('latin1', latRef.at, latRef.at + 1) === 'S' ? -la : la) * 1e6) / 1e6,
            lon: Math.round((tiff.toString('latin1', lonRef.at, lonRef.at + 1) === 'W' ? -lo : lo) * 1e6) / 1e6,
          };
        }
      }
    }
    return out.capturedAt || out.gps || out.orientation ? out : null;
  } catch {
    return null;
  }
}

/** A minimal EXIF block holding only the orientation. */
function orientationOnly(orientation) {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('MM', 0, 'latin1');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(TAGS.orientation, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = 0xe1;
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

/** A JPEG without EXIF, XMP, IPTC and comments; the orientation (if there was one) is kept. */
export function stripJpegMetadata(buf) {
  const info = readJpegExif(buf);
  const segs = segments(buf);
  const drop = segs.filter((s) => s.marker === 0xe1 || s.marker === 0xed || s.marker === 0xfe);
  if (drop.length === 0) return buf;
  const parts = [buf.subarray(0, 2)];
  if (info?.orientation && info.orientation > 1) parts.push(orientationOnly(info.orientation));
  let cursor = 2;
  for (const s of segs) {
    if (drop.includes(s)) {
      parts.push(buf.subarray(cursor, s.start));
      cursor = s.end;
    }
  }
  parts.push(buf.subarray(cursor));
  return Buffer.concat(parts);
}

/** A PNG without text and EXIF chunks. */
export function stripPngMetadata(buf) {
  const parts = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const end = i + 12 + len;
    if (!['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME'].includes(type)) parts.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

export const stripMetadata = (buf, extension) => (extension === 'png' ? stripPngMetadata(buf) : ['jpg', 'jpeg'].includes(extension) ? stripJpegMetadata(buf) : buf);
