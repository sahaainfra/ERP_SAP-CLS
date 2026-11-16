import { useMemo, useSyncExternalStore } from 'react';
import { CATALOGUE } from '../../../shared/i18n/locales/index.js';
import { LANGS, cleanLang, createTranslator } from '../../../shared/i18n/catalogue.js';
import { amountInWords } from '../../../shared/i18n/words.js';
import { DEFAULT_PREFS, formatCompact, formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, formatQuantity, formatTime } from '../../../shared/i18n/format.js';

// The language and formats of the screens (part 03.09, FR-01, FR-03). The built-in text is bundled; a company's own wording and a person's number
// and hour format arrive from the server (I18nSync) and replace what is bundled without a reload. Components use useT('area') and useFormat();
// no component carries its own text.

const clean = cleanLang;
const state = { lang: typeof document === 'undefined' ? 'en' : clean(document.documentElement.lang), overrides: { en: {}, hi: {}, te: {} }, prefs: { grouping: 'indian', hour12: false }, version: 0, merged: null };
const listeners = new Set();
const emit = () => { state.version += 1; state.merged = null; listeners.forEach((l) => l()); };
const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
const snapshot = () => state.version;

// the page's language is the attribute of <html> (set by the appearance code from the saved preference); follow it
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => { const l = clean(document.documentElement.lang); if (l !== state.lang) { state.lang = l; emit(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

/** The keys a screen asked for that had no text in its language (for the missing-key checks of the tests). */
export const missingKeys = new Set();
if (typeof window !== 'undefined') window.__erpMissingKeys = missingKeys; // read by the end-to-end tests: a screen that asked for a text with none in its language

const catalogue = () => {
  if (state.merged) return state.merged;
  const merged = {};
  for (const lang of LANGS) {
    merged[lang] = {};
    for (const ns of new Set([...Object.keys(CATALOGUE[lang]), ...Object.keys(state.overrides[lang])])) merged[lang][ns] = { ...(CATALOGUE[lang][ns] ?? {}), ...(state.overrides[lang][ns] ?? {}) };
  }
  state.merged = merged;
  return merged;
};

/** Text of the company's own wording, as the server returns it (all areas of one language). */
export function setOverrides(lang, namespaces) {
  const builtIn = CATALOGUE[clean(lang)];
  const next = {};
  for (const [ns, strings] of Object.entries(namespaces ?? {})) next[ns] = Object.fromEntries(Object.entries(strings).filter(([k, v]) => builtIn[ns]?.[k] !== v));
  if (JSON.stringify(state.overrides[clean(lang)]) !== JSON.stringify(next)) { state.overrides[clean(lang)] = next; emit(); }
}
export function setFormatPrefs(prefs) {
  const next = { grouping: prefs.grouping === 'international' ? 'international' : 'indian', hour12: Boolean(prefs.hour12) };
  if (next.grouping !== state.prefs.grouping || next.hour12 !== state.prefs.hour12) { state.prefs = next; emit(); }
}
/** Switch the language without waiting for the attribute (the appearance code sets both). */
export function setLang(lang) { if (clean(lang) !== state.lang) { state.lang = clean(lang); emit(); } }

export const getLang = () => state.lang;
/** The language and number and hour preference in force, for code outside a component (the date and money helpers of platform/format.js). */
export const currentPrefs = () => ({ ...DEFAULT_PREFS, ...state.prefs, lang: state.lang });
/** Translate outside a component (a toast raised in a handler): same text and fallbacks as useT. */
export const translate = (ns, key, params) => createTranslator({ catalogue: catalogue(), lang: state.lang, onMissing: (l, n, k) => missingKeys.add(`${l}.${n}.${k}`) })(ns, key, params);

/** The label of a registry entry (navigation, field tile, form) in the language of the screens: labelHi / labelTe when there is one, else English. */
export const labelIn = (item, lang) => (item ? (lang === 'hi' && item.labelHi) || (lang === 'te' && item.labelTe) || item.label : '');

/** The current language, 'en', 'hi' or 'te'; the component draws again when it changes. */
export function useLang() {
  useSyncExternalStore(subscribe, snapshot);
  return state.lang;
}

/** t(key, params) for one area of text: `const t = useT('shell'); t('menu.open')`. Plural forms: t('bell.waiting', { count }). */
export function useT(ns) {
  useSyncExternalStore(subscribe, snapshot);
  const lang = state.lang;
  return useMemo(() => {
    const tr = createTranslator({ catalogue: catalogue(), lang, onMissing: (l, n, k) => missingKeys.add(`${l}.${n}.${k}`) });
    return (key, params) => tr(ns, key, params);
  }, [ns, lang, state.version]);
}

/** The formatters of the person's language and number and hour preference (FR-03). */
export function useFormat() {
  useSyncExternalStore(subscribe, snapshot);
  const prefs = { ...DEFAULT_PREFS, ...state.prefs, lang: state.lang };
  return useMemo(() => ({
    prefs,
    number: (v, o) => formatNumber(v, { grouping: prefs.grouping, ...o }),
    money: (v, o) => formatMoney(v, prefs, o),
    compact: (v) => formatCompact(v, prefs),
    quantity: (v, unit, o) => formatQuantity(v, unit, prefs, o),
    percent: (v, o) => formatPercent(v, prefs, o),
    date: (v) => formatDate(v, prefs),
    time: (v) => formatTime(v, prefs),
    dateTime: (v) => formatDateTime(v, prefs),
    words: (v, lang) => amountInWords(v, lang ?? prefs.lang),
  }), [prefs.grouping, prefs.hour12, prefs.lang]);
}
