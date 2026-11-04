// Number, money, date and time formats for the screens, reports and messages (part 03.09, FR-03). One place, so every page shows ₹ 12,34,56,789.00
// and 05-Nov-2026 the same way, whatever the language. Digits stay 0-9 in Hindi (the convention of Indian business software and of the
// printed documents); the words around them are translated.
import { dec } from '../decimal.js';
import { groupDigits, SCALE } from '../money.js';
import { formatBusinessDate, formatDate as formatStamp } from '../dates.js';

/** @typedef {{ grouping?: 'indian' | 'international', hour12?: boolean, lang?: 'en' | 'hi' }} LocalePrefs */
export const DEFAULT_PREFS = Object.freeze({ grouping: 'indian', hour12: false, lang: 'en' });
const prefsOf = (p) => ({ ...DEFAULT_PREFS, ...(p ?? {}) });

const HI_MONTHS = ['जन॰', 'फ़र॰', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुल॰', 'अग॰', 'सित॰', 'अक्तू॰', 'नव॰', 'दिस॰'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');

/** A plain number with grouping and a fixed number of decimals: 1234567.5 becomes 12,34,567.50 (or 1,234,567.50). */
export function formatNumber(value, { decimals = 2, grouping = 'indian' } = {}) {
  if (value === null || value === undefined || value === '') return '-';
  const fixed = dec(value).toFixed(decimals);
  const negative = fixed.startsWith('-');
  const [whole, frac] = fixed.replace('-', '').split('.');
  return `${negative ? '-' : ''}${groupDigits(whole, grouping)}${frac ? `.${frac}` : ''}`;
}

/** Rupees with the symbol and the preferred grouping: ₹ 12,34,56,789.00. */
export function formatMoney(value, prefs, { decimals = SCALE.money, symbol = true } = {}) {
  if (value === null || value === undefined || value === '') return '-';
  const { grouping } = prefsOf(prefs);
  const n = formatNumber(value, { decimals, grouping });
  if (!symbol) return n;
  return n.startsWith('-') ? `-₹ ${n.slice(1)}` : `₹ ${n}`;
}

/**
 * The short form for dashboards: ₹ 1.25 Cr, ₹ 12.50 L (lakh); below one lakh the whole amount. Hindi writes करोड़ and लाख. International grouping
 * uses M and K (₹ 12.50 M).
 */
export function formatCompact(value, prefs) {
  if (value === null || value === undefined || value === '') return '-';
  const { grouping, lang } = prefsOf(prefs);
  const d = dec(value);
  const negative = d.cmp(dec(0)) < 0;
  const abs = negative ? dec(0).sub(d) : d;
  const steps = grouping === 'international'
    ? [[dec('1000000000'), 'B', 'अरब'], [dec('1000000'), 'M', 'मिलियन'], [dec('1000'), 'K', 'हज़ार']]
    : [[dec('10000000'), 'Cr', 'करोड़'], [dec('100000'), 'L', 'लाख']];
  for (const [size, en, hi] of steps) {
    if (abs.cmp(size) >= 0) return `${negative ? '-' : ''}₹ ${abs.div(size, 6).round(2).toFixed(2)} ${lang === 'hi' ? hi : en}`;
  }
  return formatMoney(value, prefs, { decimals: 0 });
}

/** A quantity or measure always with its unit: 2,500.000 MT. */
export function formatQuantity(value, unit, prefs, { decimals = SCALE.quantity } = {}) {
  if (value === null || value === undefined || value === '') return '-';
  return `${formatNumber(value, { decimals, grouping: prefsOf(prefs).grouping })}${unit ? ` ${unit}` : ''}`;
}

/** A percentage with its sign: 18.00%. */
export const formatPercent = (value, prefs, { decimals = 2 } = {}) => (value === null || value === undefined || value === '' ? '-' : `${formatNumber(value, { decimals, grouping: prefsOf(prefs).grouping })}%`);

/** DD-MMM-YYYY for a business date (YYYY-MM-DD) or a timestamp; the month in the language of the screen. */
export function formatDate(value, prefs) {
  if (!value) return '-';
  const { lang } = prefsOf(prefs);
  const text = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? formatBusinessDate(value) : formatStamp(value);
  if (lang !== 'hi' || text === '-') return text;
  const [d, m, y] = text.split('-');
  return `${d}-${HI_MONTHS[EN_MONTHS.indexOf(m)]}-${y}`;
}

/** The time of a timestamp in Asia/Kolkata, 24-hour (14:05) or 12-hour (2:05 PM) by preference. */
export function formatTime(iso, prefs) {
  if (!iso) return '-';
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '-';
  const d = new Date(t.getTime() + IST_OFFSET_MS);
  const h = d.getUTCHours();
  const m = pad(d.getUTCMinutes());
  if (!prefsOf(prefs).hour12) return `${pad(h)}:${m}`;
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? 'AM' : 'PM'}`;
}

/** 05-Nov-2026 14:05 (or 2:05 PM). */
export const formatDateTime = (iso, prefs) => (iso ? `${formatDate(iso, prefs)} ${formatTime(iso, prefs)}` : '-');

export const MONTHS = Object.freeze({ en: EN_MONTHS, hi: HI_MONTHS });
