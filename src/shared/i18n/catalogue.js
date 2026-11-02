// The translation catalogue and the translator (part 03.09, FR-01). Strings live in src/shared/i18n/locales/<lang>.js, grouped by namespace (one
// per area: common, shell, palette, field, notify); a company may override a string in the database (ui_translations), which is merged over the
// file text. English is complete; when a Hindi string is missing the English one is shown and the key is reported, never an empty label.
export const LANGS = Object.freeze(['en', 'hi']);

/** Which plural form of a key a count takes: `key_one` for 1 (and, in Hindi, 0) and `key_other` for the rest. */
export const pluralSuffix = (lang, count) => ((lang === 'hi' ? Math.abs(count) <= 1 : Math.abs(count) === 1) ? 'one' : 'other');

/** Put {name} placeholders' values in the text; a placeholder with no value stays visible, so a mistake shows. */
export const interpolate = (text, params) => String(text).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] !== undefined && params[k] !== null ? String(params[k]) : m));

/** The placeholders of a text, sorted: a translation must use the same ones as the English. */
export const placeholdersOf = (text) => [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

/**
 * @param {{ catalogue: Record<string, Record<string, Record<string, string>>>, lang: 'en' | 'hi', onMissing?: (lang: string, ns: string, key: string) => void }} options
 * `catalogue[lang][namespace][key]` is the text.
 */
export function createTranslator({ catalogue, lang, onMissing = () => {} }) {
  const find = (l, ns, key) => catalogue[l]?.[ns]?.[key];
  /** @param {string} ns @param {string} key @param {Record<string, any>} [params] */
  return function t(ns, key, params) {
    const keys = params && typeof params.count === 'number' ? [`${key}_${pluralSuffix(lang, params.count)}`, key] : [key];
    for (const k of keys) {
      const own = find(lang, ns, k);
      if (own !== undefined) return interpolate(own, params);
    }
    for (const k of keys) {
      const base = find('en', ns, k);
      if (base !== undefined) { onMissing(lang, ns, k); return interpolate(base, params); }
    }
    onMissing(lang, ns, key);
    return key;
  };
}

/** Every [namespace, key, text] of a language, in a stable order. */
export const entriesOf = (catalogue, lang) => Object.entries(catalogue[lang] ?? {}).flatMap(([ns, keys]) => Object.entries(keys).map(([key, text]) => [ns, key, text])).sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));

/** English keys with no Hindi text, and Hindi keys that are not in the English (a leftover), and placeholders that differ. */
export function compareLanguages(catalogue) {
  const out = { missing: [], extra: [], placeholders: [] };
  for (const [ns, keys] of Object.entries(catalogue.en ?? {})) {
    for (const [key, text] of Object.entries(keys)) {
      const hi = catalogue.hi?.[ns]?.[key];
      if (hi === undefined || String(hi).trim() === '') out.missing.push({ ns, key });
      else if (placeholdersOf(text).join() !== placeholdersOf(hi).join()) out.placeholders.push({ ns, key });
    }
  }
  for (const [ns, keys] of Object.entries(catalogue.hi ?? {})) for (const key of Object.keys(keys)) if (catalogue.en?.[ns]?.[key] === undefined) out.extra.push({ ns, key });
  return out;
}
