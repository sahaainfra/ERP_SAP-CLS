import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedEdits, codeKey, distance, fuzzyHit, ftsPhrase, normalise, phoneticKey, phoneticText, transliterate, words } from '../src/shared/search/text.js';

// Part 03.08: the text rules shared by the index and the query.
test('document numbers are compared by their letters and digits only', () => {
  assert.equal(codeKey('PO/2026-27/000123'), 'po202627000123');
  assert.equal(codeKey('po 2026 27 000123'), codeKey('PO/2026-27/000123'));
  assert.equal(codeKey(null), '');
});

test('normalise drops accents and case; words splits on anything that is not a letter or digit', () => {
  assert.equal(normalise('  Café   BAR '), 'cafe bar');
  assert.deepEqual(words('NH-48, Phase_2'), ['nh', '48', 'phase', '2']);
  assert.deepEqual(words('सुरेश कुमार'), ['सुरेश', 'कुमार']);
});

test('Devanagari is read as Latin and names that sound alike share one key', () => {
  assert.equal(transliterate('शर्मा'), 'sharmaa');
  assert.equal(transliterate('कुमार'), 'kumaar');
  assert.equal(transliterate('१२३'), '123');
  for (const [a, b] of [['शर्मा', 'Sharma'], ['Sharma', 'Sarma'], ['राजेश', 'Rajesh'], ['कुमार', 'Kumar'], ['सिंह', 'Singh'], ['Mohammed', 'Mohamed'], ['Vikas', 'Wikas']]) assert.equal(phoneticKey(a), phoneticKey(b), `${a} and ${b}`);
  assert.notEqual(phoneticKey('Sharma'), phoneticKey('Verma'));
  assert.equal(phoneticText('Rajesh Sharma 2026'), 'rajas sarma', 'digits and short keys are not kept');
});

test('typing mistakes: one edit in a short word, two in a long one, a swap counts as one', () => {
  assert.equal(distance('footing', 'fotting'), 1);
  assert.equal(distance('footing', 'fooitng'), 1);
  assert.equal(distance('abc', 'abc'), 0);
  assert.deepEqual([3, 4, 5, 6, 12].map(allowedEdits), [0, 1, 1, 2, 2]);
  assert.equal(fuzzyHit('shuttring', ['shuttering', 'plates']), true);
  assert.equal(fuzzyHit('cat', ['cot']), false, 'a three letter word is never guessed');
  assert.equal(fuzzyHit('conc', ['concrete']), true, 'the start of a word with a mistake allowed');
});

test('a full-text phrase is quoted so a query cannot inject syntax', () => {
  assert.equal(ftsPhrase('a "b" OR c*'), '"a ""b"" OR c*"');
});
