// Text helpers of global search (part 03.08), shared by the index (what is stored) and the query (what is asked) so the two always agree:
// normalising, document-number keys, Devanagari to Latin transliteration, a phonetic key for names (so "शर्मा", "Sharma" and "Sarma" meet),
// and edit distance for typo tolerance.

/** Lower case, accents removed, one space between words. */
export function normalise(text) {
  return String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The key of a document number or code: letters and digits only, so "PO/2026-27/000123", "po 2026 27 000123" and "PO202627000123" agree. */
export const codeKey = (text) => String(text ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9\p{Script=Devanagari}]+/gu, '');

const CONSONANTS = {
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h', ळ: 'l', ड़: 'd', ढ़: 'dh',
};
const VOWELS = { अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o' };
const MATRAS = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o' };
const DIGITS = '०१२३४५६७८९';
const VIRAMA = '्';

/** True when the text has any Devanagari letter. */
export const hasDevanagari = (text) => /[ऀ-ॿ]/.test(String(text ?? ''));

/** A plain Latin reading of Devanagari text (शर्मा becomes "sharmaa"). Other characters pass through unchanged. */
export function transliterate(text) {
  const s = String(text ?? '').normalize('NFC').replace(/़/g, '');
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (CONSONANTS[ch]) {
      const next = s[i + 1];
      out += CONSONANTS[ch];
      if (next === VIRAMA) { i += 1; continue; }
      if (MATRAS[next]) { out += MATRAS[next]; i += 1; continue; }
      const wordEnds = next === undefined || !/[ऀ-ॿ]/.test(next) || next === 'ं' || next === 'ँ' || next === 'ः';
      if (!wordEnds || next === 'ं' || next === 'ँ') out += 'a'; // the inherent a, except at the end of a word
    } else if (VOWELS[ch]) out += VOWELS[ch];
    else if (ch === 'ं' || ch === 'ँ') out += 'n';
    else if (ch === 'ः') out += 'h';
    else if (DIGITS.includes(ch)) out += String(DIGITS.indexOf(ch));
    else if (ch === VIRAMA || MATRAS[ch]) continue;
    else out += ch;
  }
  return out;
}

/** The sound-alike key of one word: shapes that sound the same give the same key (vowels fold together, aspirates and sh/ch/ph simplify). */
export function phoneticKey(word) {
  let s = normalise(transliterate(word)).replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s.replace(/chh|ch/g, 'C').replace(/sh|ss/g, 's').replace(/ph|f/g, 'f').replace(/([kgtdbj])h/g, '$1').replace(/nh/g, 'ng').replace(/w/g, 'v').replace(/z/g, 'j').replace(/q|c/g, 'k').replace(/x/g, 'ks').replace(/C/g, 'c');
  s = s.replace(/[aeiou]+/g, 'a').replace(/(.)\1+/g, '$1');
  return s;
}

/** Words of a text (letters and digits, Devanagari included). */
export const words = (text) => normalise(text).split(/[^a-z0-9\p{Script=Devanagari}]+/u).filter(Boolean);

/** The phonetic keys of every word of a text that is long enough to be matched (3 characters or more), without repeats. */
export function phoneticText(text) {
  return [...new Set(words(text).filter((w) => !/^\d+$/.test(w)).map(phoneticKey).filter((k) => k.length >= 3))].join(' ');
}

/** Edit distance between two short words (insert, delete, change, or swap of neighbours). */
export function distance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 4;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The most edits a word of this length may differ by and still count as a typing mistake of the query word. */
export const allowedEdits = (len) => (len <= 3 ? 0 : len <= 5 ? 1 : 2);

/** Whether the query word is a typing mistake of one of the words (or a prefix of one, with mistakes allowed in the prefix). */
export function fuzzyHit(queryWord, candidateWords) {
  const max = allowedEdits(queryWord.length);
  if (max === 0) return false;
  return candidateWords.some((w) => distance(queryWord, w) <= max || (w.length > queryWord.length && distance(queryWord, w.slice(0, queryWord.length)) <= max));
}

/** The text of a trigram query for one phrase: quoted, with quotes inside doubled. */
export const ftsPhrase = (text) => `"${String(text).replace(/"/g, '""')}"`;
