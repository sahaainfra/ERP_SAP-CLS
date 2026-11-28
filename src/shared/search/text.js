// Text helpers of global search (part 03.08), shared by the index (what is stored) and the query (what is asked) so the two always agree:
// normalising, document-number keys, Devanagari and Telugu to Latin transliteration, a phonetic key for names (so "शर्मा", "Sharma" and
// "Sarma" meet, and so do "కాకినాడ" and "Kakinada"), and edit distance for typo tolerance.

/** Lower case, accents removed, one space between words. */
export function normalise(text) {
  return String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The key of a document number or code: letters and digits only, so "PO/2026-27/000123", "po 2026 27 000123" and "PO202627000123" agree. */
export const codeKey = (text) => String(text ?? '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9\p{Script=Devanagari}\p{Script=Telugu}]+/gu, '');

const DEVANAGARI = {
  consonants: {
    क: 'k', ख: 'kh', ग: 'g', घ: 'gh', ङ: 'n', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh', ञ: 'n', ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
    प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v', श: 'sh', ष: 'sh', स: 's', ह: 'h', ळ: 'l', ड़: 'd', ढ़: 'dh',
  },
  vowels: { अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo', ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', ऑ: 'o' },
  matras: { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ॉ': 'o' },
  digits: '०१२३४५६७८९', virama: '्', nasal: ['ं', 'ँ'], visarga: 'ः', block: /[ऀ-ॿ]/,
  finalA: false, // Hindi drops the inherent a at the end of a word (राम is "raam", not "raama")
};
// PACK-08: Telugu. Telugu words end in a vowel as they are spoken and typed (కాకినాడ is "Kakinada"), so the inherent a stays at the end.
const TELUGU = {
  consonants: {
    క: 'k', ఖ: 'kh', గ: 'g', ఘ: 'gh', ఙ: 'n', చ: 'ch', ఛ: 'chh', జ: 'j', ఝ: 'jh', ఞ: 'n', ట: 't', ఠ: 'th', డ: 'd', ఢ: 'dh', ణ: 'n', త: 't', థ: 'th', ద: 'd', ధ: 'dh', న: 'n',
    ప: 'p', ఫ: 'ph', బ: 'b', భ: 'bh', మ: 'm', య: 'y', ర: 'r', ఱ: 'r', ల: 'l', ళ: 'l', వ: 'v', శ: 'sh', ష: 'sh', స: 's', హ: 'h',
  },
  vowels: { అ: 'a', ఆ: 'aa', ఇ: 'i', ఈ: 'ee', ఉ: 'u', ఊ: 'oo', ఋ: 'ri', ఎ: 'e', ఏ: 'e', ఐ: 'ai', ఒ: 'o', ఓ: 'o', ఔ: 'au' },
  matras: { 'ా': 'aa', 'ి': 'i', 'ీ': 'ee', 'ు': 'u', 'ూ': 'oo', 'ృ': 'ri', 'ె': 'e', 'ే': 'e', 'ై': 'ai', 'ొ': 'o', 'ో': 'o', 'ౌ': 'au' },
  digits: '౦౧౨౩౪౫౬౭౮౯', virama: '్', nasal: ['ం', 'ఁ'], visarga: 'ః', block: /[ఀ-౿]/,
  finalA: true,
};
const SCRIPTS = [DEVANAGARI, TELUGU];
const scriptOf = (ch) => SCRIPTS.find((sc) => sc.block.test(ch));

/** True when the text has any Devanagari letter. */
export const hasDevanagari = (text) => /[ऀ-ॿ]/.test(String(text ?? ''));
/** True when the text has any Telugu letter (PACK-08). */
export const hasTelugu = (text) => /[ఀ-౿]/.test(String(text ?? ''));
/** True when the text has any letter this module can read into Latin (Devanagari or Telugu). */
export const hasIndic = (text) => hasDevanagari(text) || hasTelugu(text);

/** A plain Latin reading of Devanagari and Telugu text (शर्मा becomes "sharmaa", కాకినాడ "kaakinaada"). Other characters pass through. */
export function transliterate(text) {
  const s = String(text ?? '').normalize('NFC').replace(/[़఼]/g, '');
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    const sc = scriptOf(ch);
    if (!sc) { out += ch; continue; }
    if (sc.consonants[ch]) {
      const next = s[i + 1];
      out += sc.consonants[ch];
      if (next === sc.virama) { i += 1; continue; }
      if (sc.matras[next]) { out += sc.matras[next]; i += 1; continue; }
      const nasal = sc.nasal.includes(next);
      const wordEnds = next === undefined || !sc.block.test(next) || nasal || next === sc.visarga;
      if (!wordEnds || nasal || sc.finalA) out += 'a'; // the inherent a (Hindi drops it at the end of a word)
    } else if (sc.vowels[ch]) out += sc.vowels[ch];
    else if (sc.nasal.includes(ch)) out += 'n';
    else if (ch === sc.visarga) out += 'h';
    else if (sc.digits.includes(ch)) out += String(sc.digits.indexOf(ch));
    else if (ch === sc.virama || sc.matras[ch]) continue;
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

/** Words of a text (letters and digits, Devanagari and Telugu included). */
export const words = (text) => normalise(text).split(/[^a-z0-9\p{Script=Devanagari}\p{Script=Telugu}]+/u).filter(Boolean);

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
