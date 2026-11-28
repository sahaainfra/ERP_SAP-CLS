import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ID_KINDS, idForSending, idProblem, isValidId, normaliseId, verhoeffValid, zIndianId } from '../src/shared/forms/indian-ids.js';
import { FORMATS } from '../src/server/platform/mdm/index.js';

// PACK-09: the shared Indian identifier checks. Every sample here is made up (check characters computed, not copied from real records).
const SAMPLES = {
  gstin: { valid: ['36AABCS1429B1ZV', '27aapfu0939f1zv', ' 29ABCDE1234F1ZW '], invalid: [['36AABCS1429B1Z5', 'check'], ['00AABCS1429B1ZV', 'state'], ['36AABCS1429B1Y5', 'shape'], ['36AABCS1429', 'shape']] },
  pan: { valid: ['ABCDE1234F', 'abcde 1234 f'], invalid: [['ABCD1234F', 'shape'], ['ABCDE12345', 'shape'], ['1BCDE1234F', 'shape']] },
  tan: { valid: ['HYDA12345B', 'hyda 12345 b'], invalid: [['HYD12345B', 'shape'], ['HYDA1234BB', 'shape']] },
  ifsc: { valid: ['SBIN0001234', 'hdfc0abc123'], invalid: [['SBIN1001234', 'shape'], ['SBI0001234', 'shape']] },
  uan: { valid: ['100123456789', '1001 2345 6789'], invalid: [['10012345678', 'shape'], ['1001234567AB', 'shape']] },
  esic: { valid: ['3112345678'], invalid: [['311234567', 'shape'], ['31123456789', 'shape']] },
  esicEmployer: { valid: ['31000123450001001'], invalid: [['3100012345000100', 'shape']] },
  aadhaar: { valid: ['2341 2341 2346', '234123412346'], invalid: [['23412341234', 'shape'], ['XXXXXXXX2346', 'shape']] },
  aadhaarMasked: { valid: ['XXXX XXXX 1234', 'xxxxxxxx1234', '1234', '**** **** 1234'], invalid: [['234123412346', 'full'], ['XXXX 1234', 'shape'], ['12345', 'shape']] },
  vehicle: { valid: ['TS09EA1234', 'ts 09 ea 1234', 'DL3CAB1234', 'AP-28-Z-99', '22BH1234AB', 'TG07X4321'], invalid: [['ZZ09EA1234', 'state'], ['TS0EA1234X', 'shape'], ['22BH12AB', 'shape']] },
  pincode: { valid: ['500032', '110 001'], invalid: [['050032', 'shape'], ['50003', 'shape'], ['5000321', 'shape']] },
  mobile: { valid: ['9876543210', '+91 98765 43210', '09876543210', '919876543210'], invalid: [['5876543210', 'shape'], ['987654321', 'shape']] },
};

test('PACK-09 every kind accepts its valid samples and names the problem of each invalid one', () => {
  assert.deepEqual(Object.keys(SAMPLES).sort(), [...ID_KINDS].sort(), 'every kind has samples');
  for (const [kind, s] of Object.entries(SAMPLES)) {
    for (const v of s.valid) assert.equal(idProblem(kind, v), null, `${kind} ${v} should be valid`);
    for (const [v, code] of s.invalid) {
      const p = idProblem(kind, v);
      assert.equal(p?.code, code, `${kind} ${v} should fail with ${code}`);
      assert.equal(p.key, `id.${kind}.${code}`);
      assert.ok(p.message.length > 10);
    }
  }
  assert.equal(idProblem('gstin', ''), null, 'empty is not a problem (required is the form\'s business)');
  assert.equal(isValidId('gstin', ''), false);
});

test('PACK-09 values are stored in one form: capitals, no spaces, mobile without +91, Aadhaar masked', () => {
  assert.equal(normaliseId('pan', ' abcde 1234 f '), 'ABCDE1234F');
  assert.equal(normaliseId('vehicle', 'ts-09-ea-1234'), 'TS09EA1234');
  assert.equal(normaliseId('mobile', '+91 98765-43210'), '9876543210');
  assert.equal(normaliseId('aadhaarMasked', '1234'), 'XXXXXXXX1234');
  assert.equal(idForSending('aadhaarMasked', '2341 2341 2346'), 'XXXXXXXX2346', 'a masked field never sends the full number');
  assert.equal(idForSending('aadhaar', '2341 2341 2346'), '234123412346', 'the full-number field sends it whole (the server hashes it)');
});

test('PACK-09 Aadhaar: the browser runs the Verhoeff check; a masked field refuses a full number on the server', () => {
  assert.equal(verhoeffValid('234123412346'), true);
  assert.equal(verhoeffValid('234123412341'), false);
  assert.equal(idProblem('aadhaarMasked', '234123412346', { client: true }), null, 'valid: the browser masks it');
  assert.equal(idProblem('aadhaarMasked', '234123412341', { client: true })?.code, 'invalid');
  assert.equal(idProblem('aadhaarMasked', '234123412346')?.code, 'full', 'the server never takes a full number in a masked field');
  assert.equal(idProblem('aadhaar', '234123412341', { client: true })?.code, 'invalid', 'the browser flags a wrong check digit');
  assert.equal(idProblem('aadhaar', '134123412346', { client: true })?.code, 'invalid', 'an Aadhaar number does not start with 0 or 1');
  assert.equal(idProblem('aadhaar', '123456789012'), null, 'the server checks the shape only (D-847)');
});

test('PACK-09 the zod schema normalises, refuses with the same message, and lets an empty optional value through as null', () => {
  assert.equal(zIndianId('gstin').parse(' 36aabcs1429b1zv '), '36AABCS1429B1ZV');
  const bad = zIndianId('gstin').safeParse('36AABCS1429B1Z5');
  assert.equal(bad.success, false);
  assert.match(bad.error.issues[0].message, /check character/);
  assert.equal(zIndianId('pan').safeParse('').success, false, 'required by default');
  assert.equal(zIndianId('pan', { optional: true }).parse(''), null);
  assert.equal(zIndianId('pan', { optional: true }).parse(undefined), null);
  assert.equal(zIndianId('aadhaarMasked').safeParse('234123412346').success, false, 'a masked field never takes a full Aadhaar number');
  assert.throws(() => zIndianId('passport'), /Unknown identifier kind/);
});

test('PACK-09 the server master-data formats and the shared checks agree on every sample', () => {
  const pairs = { PAN: 'pan', GSTIN: 'gstin', IFSC: 'ifsc', PIN: 'pincode', MOBILE: 'mobile' };
  for (const [format, kind] of Object.entries(pairs)) {
    for (const v of [...SAMPLES[kind].valid, ...SAMPLES[kind].invalid.map(([x]) => x)]) {
      const n = normaliseId(kind, v);
      assert.equal(FORMATS[format].test(n), !idProblem(kind, n), `${format} and ${kind} disagree on ${v}`);
    }
  }
});

test('PACK-09 every label, hint and problem of every kind has text in English, Hindi and Telugu', async () => {
  const { INDIAN_IDS } = await import('../src/shared/forms/indian-ids.js');
  const en = (await import('../src/shared/i18n/locales/en/format.js')).default;
  const hi = (await import('../src/shared/i18n/locales/hi/format.js')).default;
  const te = (await import('../src/shared/i18n/locales/te.js')).default.format;
  for (const [kind, d] of Object.entries(INDIAN_IDS)) {
    for (const k of ['label', 'hint', ...Object.keys(d.messages)].map((x) => `id.${kind}.${x}`)) {
      for (const [lang, cat] of [['en', en], ['hi', hi], ['te', te]]) assert.ok(cat[k], `${lang} is missing ${k}`);
    }
  }
});
