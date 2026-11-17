// Amount in words, Indian system (part 03.09, BR-02): crore, lakh, thousand, hundred; rupees and paise; English, Hindi and Telugu (166.3). Works on exact
// decimals (a string such as "12345678.90"), never on floating point.
import { dec } from '../decimal.js';

const EN_ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

// 0 to 99 in Hindi: every number has its own word.
const HI = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस', 'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चौवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास', 'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर', 'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी', 'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे'];

// Telugu (part 166.3): tens and units are said one after the other (ఇరవై ఒకటి). Before a noun or a place word a number takes its joining form:
// one is ఒక, hundred is నూట or వంద, and a place takes its plural joining form (వందల, వేల, లక్షల, కోట్ల): రెండు లక్షల యాభై వేల రూపాయలు.
const TE_ONES = ['సున్నా', 'ఒకటి', 'రెండు', 'మూడు', 'నాలుగు', 'ఐదు', 'ఆరు', 'ఏడు', 'ఎనిమిది', 'తొమ్మిది', 'పది', 'పదకొండు', 'పన్నెండు', 'పదమూడు', 'పద్నాలుగు', 'పదిహేను', 'పదహారు', 'పదిహేడు', 'పద్దెనిమిది', 'పందొమ్మిది'];
const TE_TENS = ['', '', 'ఇరవై', 'ముప్పై', 'నలభై', 'యాభై', 'అరవై', 'డెబ్బై', 'ఎనభై', 'తొంభై'];
const teUnit = (n) => (n === 1 ? 'ఒక' : TE_ONES[n]);
const teBelow100 = (n) => (n < 20 ? teUnit(n) : `${TE_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${teUnit(n % 10)}` : ''}`);
const teBelow1000 = (n) => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const hundred = h === 0 ? '' : h === 1 ? (r ? 'నూట' : 'వంద') : `${TE_ONES[h]} వందల`;
  return [hundred, r ? teBelow100(r) : ''].filter(Boolean).join(' ');
};
const teBelow1000Ext = (n) => (n < 1000 ? teBelow1000(n) : `${teBelow1000Ext(Math.floor(n / 1000))} వేల${n % 1000 ? ` ${teBelow1000(n % 1000)}` : ''}`);
const tePlace = (n, one, many) => (n === 1 ? one : `${teBelow100(n)} ${many}`);

const enBelow100 = (n) => (n < 20 ? EN_ONES[n] : `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? `-${EN_ONES[n % 10]}` : ''}`);
const enBelow1000 = (n) => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${EN_ONES[h]} Hundred` : '', r ? enBelow100(r) : ''].filter(Boolean).join(' ');
};
const hiBelow1000 = (n) => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${HI[h]} सौ` : '', r ? HI[r] : ''].filter(Boolean).join(' ');
};

/**
 * The whole number (below 1,00,00,00,00,00,000) in words by the Indian places: crore (10^7), lakh (10^5), thousand, then the last three digits.
 * More than 99 crore is said as that many crore ("One Hundred Twenty Crore").
 */
function wholeInWords(n, lang) {
  if (n === 0n) return lang === 'hi' ? HI[0] : lang === 'te' ? TE_ONES[0] : EN_ONES[0];
  const crore = Number(n / 10_000_000n);
  const lakh = Number((n / 100_000n) % 100n);
  const thousand = Number((n / 1000n) % 100n);
  const rest = Number(n % 1000n);
  const parts = [];
  if (lang === 'te') {
    if (crore) parts.push(crore === 1 ? 'ఒక కోటి' : `${teBelow1000Ext(crore)} కోట్ల`);
    if (lakh) parts.push(tePlace(lakh, 'ఒక లక్ష', 'లక్షల'));
    if (thousand) parts.push(tePlace(thousand, 'వెయ్యి', 'వేల'));
    if (rest) parts.push(teBelow1000(rest));
  } else if (lang === 'hi') {
    if (crore) parts.push(`${hiBelow1000Ext(crore)} करोड़`);
    if (lakh) parts.push(`${HI[lakh]} लाख`);
    if (thousand) parts.push(`${HI[thousand]} हज़ार`);
    if (rest) parts.push(hiBelow1000(rest));
  } else {
    if (crore) parts.push(`${enBelow1000Ext(crore)} Crore`);
    if (lakh) parts.push(`${enBelow100(lakh)} Lakh`);
    if (thousand) parts.push(`${enBelow100(thousand)} Thousand`);
    if (rest) parts.push(enBelow1000(rest));
  }
  return parts.join(' ');
}
// the number of crore may itself be large (a 250 crore contract): say it in thousands and lakhs of crore the same way
const enBelow1000Ext = (n) => (n < 1000 ? enBelow1000(n) : `${enBelow1000Ext(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${enBelow1000(n % 1000)}` : ''}`);
const hiBelow1000Ext = (n) => (n < 1000 ? hiBelow1000(n) : `${hiBelow1000Ext(Math.floor(n / 1000))} हज़ार${n % 1000 ? ` ${hiBelow1000(n % 1000)}` : ''}`);

const LIMIT = 10n ** 14n; // below ten lakh crore

/**
 * "Rupees One Crore Twenty-Three Lakh Forty-Five Thousand Six Hundred Seventy-Eight and Ninety Paise Only" for 12345678.90;
 * Hindi: "एक करोड़ तेईस लाख पैंतालीस हज़ार छह सौ अठहत्तर रुपये और नब्बे पैसे मात्र"; Telugu: "ఒక కోటి ఇరవై మూడు లక్షల నలభై ఐదు వేల ఆరు వందల
 * డెబ్బై ఎనిమిది రూపాయలు మరియు తొంభై పైసలు మాత్రమే". A negative amount says "Minus"/"ऋण"/"మైనస్".
 * @param {string | number | bigint} value an exact decimal; rounded half-up to paise
 * @param {'en' | 'hi' | 'te'} [lang]
 */
export function amountInWords(value, lang = 'en') {
  const d = dec(value).round(2);
  const fixed = d.toFixed(2);
  const negative = fixed.startsWith('-');
  const [rupeeText, paiseText] = fixed.replace('-', '').split('.');
  const rupees = BigInt(rupeeText);
  const paise = Number(paiseText);
  if (rupees >= LIMIT) throw new RangeError('The amount is too large to be put in words');
  const sign = negative && (rupees > 0n || paise > 0) ? (lang === 'hi' ? 'ऋण ' : lang === 'te' ? 'మైనస్ ' : 'Minus ') : '';
  if (lang === 'te') {
    const r = rupees > 0n || paise === 0 ? `${rupees === 0n ? TE_ONES[0] : wholeInWords(rupees, 'te')} ${rupees === 1n ? 'రూపాయి' : 'రూపాయలు'}` : '';
    const p = paise ? `${r ? ' మరియు ' : ''}${teBelow100(paise)} ${paise === 1 ? 'పైసా' : 'పైసలు'}` : '';
    return `${sign}${r}${p} మాత్రమే`;
  }
  if (lang === 'hi') {
    const r = rupees > 0n || paise === 0 ? `${wholeInWords(rupees, 'hi')} ${rupees === 1n ? 'रुपया' : 'रुपये'}` : '';
    const p = paise ? `${r ? ' और ' : ''}${HI[paise]} पैसे` : '';
    return `${sign}${r}${p} मात्र`;
  }
  const r = rupees > 0n || paise === 0 ? `Rupees ${wholeInWords(rupees, 'en')}` : '';
  const p = paise ? `${r ? ' and ' : ''}${enBelow100(paise)} Paise` : '';
  return `${sign}${r}${p} Only`;
}
