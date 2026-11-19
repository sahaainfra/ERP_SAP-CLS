import { use, useMemo, useSyncExternalStore } from 'react';
import common from '../../../shared/i18n/locales/en/common.js';
import ess from '../../../shared/i18n/locales/en/ess.js';
import field from '../../../shared/i18n/locales/en/field.js';
import format from '../../../shared/i18n/locales/en/format.js';
import notify from '../../../shared/i18n/locales/en/notify.js';
import palette from '../../../shared/i18n/locales/en/palette.js';
import shell from '../../../shared/i18n/locales/en/shell.js';
import { LANGS, cleanLang, createTranslator } from '../../../shared/i18n/catalogue.js';
import { amountInWords } from '../../../shared/i18n/words.js';
import { DEFAULT_PREFS, formatCompact, formatDate, formatDateTime, formatMoney, formatNumber, formatPercent, formatQuantity, formatTime } from '../../../shared/i18n/format.js';

// The language and formats of the screens (part 03.09, FR-01, FR-03). The built-in text is bundled; a company's own wording and a person's number
// and hour format arrive from the server (I18nSync) and replace what is bundled without a reload. Components use useT('area') and useFormat();
// no component carries its own text.

const clean = cleanLang;

// Part 166.4: English is in the first download; Hindi and Telugu are fetched the first time a screen is in that language (the Hindi text alone is
// about as large as the rest of the shell). Until the language has arrived the screen stays in English, then draws again in it.
// D-682: of the English text only the areas of the shell and the field home are in the first download (about 22 KB of 570 KB); the area of a module
// is fetched the first time a screen asks for it (useT suspends the page meanwhile, inside the page's own skeleton), and the remaining areas once the
// first screen is drawn, so text asked for outside a screen (a toast in a handler) is there too.
const BUILT_IN = { en: { common, ess, field, format, notify, palette, shell }, hi: null, te: null };
// D-743: outside Vite (Node's test runner) there is no import.meta.glob; the areas are then not lazily loadable and only the bundled ones exist
const AREA_LOADERS = Object.fromEntries(Object.entries(import.meta.env ? import.meta.glob('../../../shared/i18n/locales/en/*.js') : {}).map(([path, load]) => [path.replace(/^.*\/|\.js$/g, ''), load]));
const areaLoading = {};
/** The English text of one area: resolves once it is here (at once for an area of the first download or one without a file). */
export function loadArea(ns) {
  if (BUILT_IN.en[ns] || !AREA_LOADERS[ns]) return Promise.resolve(true);
  areaLoading[ns] ??= AREA_LOADERS[ns]().then((m) => { BUILT_IN.en = { ...BUILT_IN.en, [ns]: m.default }; emit(); return true; }).catch(() => { areaLoading[ns] = null; return false; });
  return areaLoading[ns];
}
/** Fetch every English area not yet here (after the first screen; a failure is fetched again when a screen asks). */
export const loadAllAreas = () => Promise.all(Object.keys(AREA_LOADERS).map(loadArea));
const LOADERS = { hi: () => import('../../../shared/i18n/locales/hi.js'), te: () => import('../../../shared/i18n/locales/te.js') };
const loading = {};
/** The built-in text of a language: resolves once it is here (at once for English). */
export function loadLanguage(lang) {
  const l = clean(lang);
  if (BUILT_IN[l]) return Promise.resolve(true);
  loading[l] ??= LOADERS[l]().then((m) => { BUILT_IN[l] = m.default; emit(); return true; }).catch(() => { loading[l] = null; return false; });
  return loading[l];
}
/** The language the screens are drawn in now: the chosen one once its text is here, English until then. */
const active = () => (BUILT_IN[state.lang] ? state.lang : 'en');
const state = { lang: typeof document === 'undefined' ? 'en' : clean(document.documentElement.lang), overrides: { en: {}, hi: {}, te: {} }, prefs: { grouping: 'indian', hour12: false }, version: 0, merged: null };
const listeners = new Set();
const emit = () => { state.version += 1; state.merged = null; listeners.forEach((l) => l()); };
const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
const snapshot = () => state.version;

// the page's language is the attribute of <html> (set by the appearance code from the saved preference); follow it
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  new MutationObserver(() => { const l = clean(document.documentElement.lang); if (l !== state.lang) { state.lang = l; loadLanguage(l); emit(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
}

/** The keys a screen asked for that had no text in its language (for the missing-key checks of the tests). */
export const missingKeys = new Set();
if (typeof window !== 'undefined') window.__erpMissingKeys = missingKeys; // read by the end-to-end tests: a screen that asked for a text with none in its language

const catalogue = () => {
  if (state.merged) return state.merged;
  const merged = {};
  for (const lang of LANGS) {
    merged[lang] = {};
    const builtIn = BUILT_IN[lang] ?? {};
    for (const ns of new Set([...Object.keys(builtIn), ...Object.keys(state.overrides[lang])])) merged[lang][ns] = { ...(builtIn[ns] ?? {}), ...(state.overrides[lang][ns] ?? {}) };
  }
  state.merged = merged;
  return merged;
};

/** Text of the company's own wording, as the server returns it (all areas of one language). */
export function setOverrides(lang, namespaces) {
  const builtIn = BUILT_IN[clean(lang)] ?? {};
  const next = {};
  for (const [ns, strings] of Object.entries(namespaces ?? {})) next[ns] = Object.fromEntries(Object.entries(strings).filter(([k, v]) => builtIn[ns]?.[k] !== v));
  if (JSON.stringify(state.overrides[clean(lang)]) !== JSON.stringify(next)) { state.overrides[clean(lang)] = next; emit(); }
}
export function setFormatPrefs(prefs) {
  const next = { grouping: prefs.grouping === 'international' ? 'international' : 'indian', hour12: Boolean(prefs.hour12) };
  if (next.grouping !== state.prefs.grouping || next.hour12 !== state.prefs.hour12) { state.prefs = next; emit(); }
}
/** Switch the language without waiting for the attribute (the appearance code sets both). */
export function setLang(lang) { if (clean(lang) !== state.lang) { state.lang = clean(lang); loadLanguage(state.lang); emit(); } }

export const getLang = () => state.lang;
/** The language and number and hour preference in force, for code outside a component (the date and money helpers of platform/format.js). */
export const currentPrefs = () => ({ ...DEFAULT_PREFS, ...state.prefs, lang: state.lang });
/** Translate outside a component (a toast raised in a handler): same text and fallbacks as useT. */
export const translate = (ns, key, params) => (loadArea(ns), createTranslator({ catalogue: catalogue(), lang: active(), onMissing: (l, n, k) => missingKeys.add(`${l}.${n}.${k}`) })(ns, key, params));

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
  if (!BUILT_IN.en[ns] && AREA_LOADERS[ns]) use(loadArea(ns)); // the area's English text is fetched once; the page shows its skeleton meanwhile
  const lang = active();
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

// a screen opened in Hindi or Telugu fetches its text at once (part 166.4)
if (state.lang !== 'en') loadLanguage(state.lang);
// the other English areas once the first screen is drawn and the browser is idle (D-682)
if (typeof window !== 'undefined') {
  const later = () => (window.requestIdleCallback ?? ((f) => setTimeout(f, 1)))(() => loadAllAreas(), { timeout: 10_000 });
  if (document.readyState === 'complete') setTimeout(later, 3_000); else window.addEventListener('load', () => setTimeout(later, 3_000), { once: true });
}
