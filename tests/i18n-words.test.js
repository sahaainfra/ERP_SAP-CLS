import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountInWords } from '../src/shared/i18n/words.js';
import { formatCompact, formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, formatQuantity, formatTime } from '../src/shared/i18n/format.js';
import { CATALOGUE, NAMESPACES } from '../src/shared/i18n/locales/index.js';
import { compareLanguages, createTranslator, interpolate, placeholdersOf, pluralSuffix } from '../src/shared/i18n/catalogue.js';

// Part 03.09: amount in words (T-02), formats (FR-03), the translator and the parity of the two languages.
test('T-02 BR-02 amount in words, Indian system, English and Hindi', () => {
  assert.equal(amountInWords('12345678.90', 'en'), 'Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Ninety Paise Only');
  assert.equal(amountInWords('12345678.90', 'hi'), 'एक करोड़ तेईस लाख पैंतालीस हज़ार छह सौ अठहत्तर रुपये और नब्बे पैसे मात्र');
  assert.equal(amountInWords('0', 'en'), 'Rupees Zero Only');
  assert.equal(amountInWords('0.50', 'en'), 'Fifty Paise Only');
  assert.equal(amountInWords('0.01', 'hi'), 'एक पैसे मात्र');
  assert.equal(amountInWords('1', 'hi'), 'एक रुपया मात्र');
  assert.equal(amountInWords('100000', 'en'), 'Rupees One Lakh Only');
  assert.equal(amountInWords('100000', 'hi'), 'एक लाख रुपये मात्र');
  assert.equal(amountInWords('25000000000', 'en'), 'Rupees Two Thousand Five Hundred Crore Only', 'a large contract is said in crore');
  assert.equal(amountInWords('-1500.25', 'en'), 'Minus Rupees One Thousand Five Hundred and Twenty-Five Paise Only');
  assert.equal(amountInWords('1000.005', 'en'), 'Rupees One Thousand and One Paise Only', 'rounded half-up to paise');
  assert.throws(() => amountInWords('1000000000000000', 'en'), RangeError);
  // every Hindi number 0-99 has its own word, none repeated
  const hi = Array.from({ length: 100 }, (_, n) => amountInWords(String(n), 'hi').replace(/ (रुपये|रुपया) मात्र$/, ''));
  assert.equal(new Set(hi).size, 100);
});

test('FR-03 money, compact amounts, quantities, dates and times follow the Indian formats and the preference', () => {
  assert.equal(formatMoney('123456789'), '₹ 12,34,56,789.00');
  assert.equal(formatMoney('123456789', { grouping: 'international' }), '₹ 123,456,789.00');
  assert.equal(formatMoney('-1234.5'), '-₹ 1,234.50');
  assert.equal(formatMoney(null), '-');
  assert.equal(formatNumber('1234567.891', { decimals: 3 }), '12,34,567.891');
  assert.equal(formatCompact('12500000'), '₹ 1.25 Cr');
  assert.equal(formatCompact('1250000'), '₹ 12.50 L');
  assert.equal(formatCompact('1250000', { lang: 'hi' }), '₹ 12.50 लाख');
  assert.equal(formatCompact('99999'), '₹ 99,999');
  assert.equal(formatCompact('12500000', { grouping: 'international' }), '₹ 12.50 M');
  assert.equal(formatQuantity('2500', 'MT'), '2,500.000 MT', 'a quantity always has its unit');
  assert.equal(formatPercent('18'), '18.00%');
  assert.equal(formatDate('2026-11-05'), '05-Nov-2026');
  assert.equal(formatDate('2026-11-05', { lang: 'hi' }), '05-नव॰-2026');
  assert.equal(formatDate('2026-11-05T20:00:00Z'), '06-Nov-2026', 'a timestamp is shown in India');
  assert.equal(formatTime('2026-11-05T08:35:00Z'), '14:05');
  assert.equal(formatTime('2026-11-05T08:35:00Z', { hour12: true }), '2:05 PM');
  assert.equal(formatTime('2026-11-05T18:30:00Z', { hour12: true }), '12:00 AM');
  assert.equal(formatDateTime('2026-11-05T08:35:00Z', { hour12: true }), '05-Nov-2026 2:05 PM');
  assert.equal(formatDate(''), '-');
});

test('FR-01 the translator interpolates, picks plural forms, falls back to English and reports what is missing', () => {
  const missing = [];
  const t = createTranslator({ catalogue: { en: { a: { x: 'Hello {name}', n_one: '{count} item', n_other: '{count} items', only: 'English only' } }, hi: { a: { x: 'नमस्ते {name}', n_one: '{count} वस्तु', n_other: '{count} वस्तुएँ' } } }, lang: 'hi', onMissing: (...m) => missing.push(m.join('.')) });
  assert.equal(t('a', 'x', { name: 'राम' }), 'नमस्ते राम');
  assert.equal(t('a', 'n', { count: 1 }), '1 वस्तु');
  assert.equal(t('a', 'n', { count: 0 }), '0 वस्तु', 'Hindi counts zero as one');
  assert.equal(t('a', 'n', { count: 5 }), '5 वस्तुएँ');
  assert.equal(t('a', 'only'), 'English only');
  assert.equal(t('a', 'nothing'), 'nothing');
  assert.deepEqual(missing, ['hi.a.only', 'hi.a.nothing']);
  assert.equal(interpolate('{a} and {b}', { a: 1 }), '1 and {b}', 'a placeholder without a value stays visible');
  assert.deepEqual(placeholdersOf('{b} {a} {b}'), ['a', 'b']);
  assert.deepEqual([pluralSuffix('en', 0), pluralSuffix('en', 1), pluralSuffix('hi', 0), pluralSuffix('hi', 2)], ['other', 'one', 'one', 'other']);
});

test('T-01 FR-01 every English text has a Hindi text with the same placeholders, and none is empty', () => {
  const r = compareLanguages(CATALOGUE);
  assert.deepEqual(r, { missing: [], extra: [], placeholders: [] });
  for (const lang of ['en', 'hi']) for (const ns of NAMESPACES) for (const [k, v] of Object.entries(CATALOGUE[lang][ns])) assert.ok(typeof v === 'string' && v.trim(), `${lang}.${ns}.${k} is empty`);
  for (const [k, v] of Object.entries(CATALOGUE.hi.field)) if (!/^(scanner\.example)$/.test(k)) assert.ok(/[ऀ-ॿ]|^[A-Z0-9 .:{}/-]+$/.test(v), `field.${k} is not Hindi: ${v}`);
});
