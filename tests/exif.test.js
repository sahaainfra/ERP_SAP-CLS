import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExifSegment, exifSegment, readExif, withExif } from '../src/client/platform/device/exif.js';

// Part 03.06, BR-02: the time and position a camera wrote into a photo are read, and survive the photo being made smaller.
const SOI = [0xff, 0xd8];
const APP0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
const SCAN = [0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9];
const jpeg = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

const facts = { takenAt: '2026-10-30T10:15:42', gps: { lat: 18.520431, lng: 73.856744 }, orientation: 6, make: 'Samsung', model: 'Galaxy A14' };

test('the time, position, orientation and camera are read from a photo', () => {
  const photo = jpeg(SOI, buildExifSegment(facts), APP0, SCAN);
  const e = readExif(photo);
  assert.equal(e.takenAt, '2026-10-30T10:15:42');
  assert.ok(Math.abs(e.gps.lat - 18.520431) < 0.00001 && Math.abs(e.gps.lng - 73.856744) < 0.00001, JSON.stringify(e.gps));
  assert.deepEqual([e.orientation, e.make, e.model], [6, 'Samsung', 'Galaxy A14']);
  // south and west are negative
  const south = readExif(jpeg(SOI, buildExifSegment({ ...facts, gps: { lat: -33.8688, lng: -70.6693 } }), SCAN));
  assert.ok(south.gps.lat < -33.86 && south.gps.lng < -70.66);
  // a photo without a position, and files that are not photos with EXIF
  assert.equal(readExif(jpeg(SOI, buildExifSegment({ takenAt: facts.takenAt }), SCAN)).gps, null);
  assert.equal(readExif(jpeg(SOI, APP0, SCAN)), null, 'a JPEG without EXIF');
  assert.equal(readExif(Uint8Array.from([1, 2, 3, 4, 5])), null, 'not a JPEG');
  assert.equal(readExif(new Uint8Array(0)), null);
});

test('a damaged EXIF segment is read as far as it goes, never thrown on', () => {
  const seg = buildExifSegment(facts);
  for (const cut of [12, 20, 40, 80]) assert.doesNotThrow(() => readExif(jpeg(SOI, seg.slice(0, cut), SCAN)));
  const lie = seg.slice();
  new DataView(lie.buffer).setUint32(14, 0xfffffff0, true); // IFD0 pointer far outside the segment
  assert.doesNotThrow(() => readExif(jpeg(SOI, lie, SCAN)));
});

test('BR-02 the original EXIF goes into the smaller copy, with the orientation set upright', () => {
  const original = jpeg(SOI, buildExifSegment(facts), APP0, SCAN);
  const redrawn = jpeg(SOI, APP0, SCAN); // what a canvas gives back: no EXIF
  assert.equal(readExif(redrawn), null);
  const kept = withExif(redrawn, exifSegment(original));
  const e = readExif(kept);
  assert.equal(e.takenAt, facts.takenAt, 'the time is kept');
  assert.ok(Math.abs(e.gps.lat - facts.gps.lat) < 0.00001, 'the position is kept');
  assert.equal(e.orientation, 1, 'upright, because the pixels were already turned');
  assert.deepEqual([...kept.subarray(0, 2)], SOI);
  assert.deepEqual([...kept.subarray(-8)], SCAN, 'the picture data is untouched');
  assert.equal(readExif(original).orientation, 6, 'the original segment is not changed');
  // an existing EXIF in the target is replaced, not doubled
  const twice = withExif(kept, exifSegment(original));
  assert.equal(twice.length, kept.length);
  // nothing to keep, or not a JPEG: the target comes back as it was
  assert.equal(withExif(redrawn, null), redrawn);
  assert.deepEqual(withExif(Uint8Array.from([1, 2, 3]), exifSegment(original)), Uint8Array.from([1, 2, 3]));
});
