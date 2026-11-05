import { dec } from '../../../shared/decimal.js';

// Amount in words for printed documents (part 04.11, FR-02), in the Indian system (thousand, lakh, crore) in English and in Hindi.
// The amount is read as an exact decimal; paise are read as "and Fifty Paise". A negative amount is "Minus ...".
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => (n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${below100(n % 100)}` : ''}` : below100(n));

/** A whole number (up to 99,99,99,99,999) in words, English Indian system. */
export function wholeInWords(n) {
  let rest = n;
  if (rest === 0) return 'Zero';
  const parts = [];
  /** @type {[number, string][]} */
  const units = [[10_000_000, 'Crore'], [100_000, 'Lakh'], [1000, 'Thousand']];
  for (const [unit, name] of units) {
    const q = Math.floor(rest / unit);
    if (q > 0) { parts.push(`${wholeInWords(q)} ${name}`); rest -= q * unit; }
  }
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' ');
}

const split = (amount) => {
  const d = dec(amount).round(2);
  const text = d.toFixed(2);
  const neg = text.startsWith('-');
  const [w, p] = text.replace('-', '').split('.');
  return { neg, whole: Number(w), paise: Number(p) };
};
const MAX = 99_999_999_999;

/** "Rupees One Lakh Twenty Three Thousand and Fifty Paise Only". */
export function amountInWords(amount) {
  const { neg, whole, paise } = split(amount);
  if (whole > MAX) throw new RangeError('The amount is too large to put in words');
  const r = whole > 0 || paise === 0 ? `Rupees ${wholeInWords(whole)}` : '';
  const p = paise > 0 ? `${r ? ' and ' : ''}${wholeInWords(paise)} Paise` : '';
  return `${neg ? 'Minus ' : ''}${r}${p} Only`;
}

// Hindi: every number below 100 has its own word.
const HI = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस', 'बीस',
  'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस', 'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस', 'चालीस',
  'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास', 'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ', 'साठ',
  'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर', 'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उनासी', 'अस्सी',
  'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी', 'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे'];

export function wholeInHindi(n) {
  let rest = n;
  if (rest === 0) return HI[0];
  const parts = [];
  /** @type {[number, string][]} */
  const units = [[10_000_000, 'करोड़'], [100_000, 'लाख'], [1000, 'हज़ार'], [100, 'सौ']];
  for (const [unit, name] of units) {
    const q = Math.floor(rest / unit);
    if (q > 0) { parts.push(`${wholeInHindi(q)} ${name}`); rest -= q * unit; }
  }
  if (rest > 0) parts.push(HI[rest]);
  return parts.join(' ');
}

/** "एक लाख तेईस हज़ार रुपये और पचास पैसे मात्र". */
export function amountInHindi(amount) {
  const { neg, whole, paise } = split(amount);
  if (whole > MAX) throw new RangeError('The amount is too large to put in words');
  const r = whole > 0 || paise === 0 ? `${wholeInHindi(whole)} रुपये` : '';
  const p = paise > 0 ? `${r ? ' और ' : ''}${wholeInHindi(paise)} पैसे` : '';
  return `${neg ? 'ऋण ' : ''}${r}${p} मात्र`;
}
