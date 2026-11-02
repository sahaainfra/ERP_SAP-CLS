import { createTranslator } from '../../../shared/i18n/catalogue.js';
import { CATALOGUE } from '../../../shared/i18n/locales/index.js';
import { createParameterStore } from '../parameters/index.js';
import { todayIST } from '../../../shared/dates.js';

/**
 * Server-side localisation (part 03.09, FR-04): the same catalogue the screens use, with the company's overrides (ui_translations) merged over it,
 * for messages, templates and documents written in the language of their recipient. One instance per database.
 */
const instances = new WeakMap();

export function localisationOf(db) {
  let inst = instances.get(db);
  if (inst) return inst;
  /** @type {Map<number, { stamp: string, catalogue: any }>} */
  const cache = new Map();
  const has = () => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ui_translations'").get());

  const stampOf = (companyId) => {
    const r = db.prepare('SELECT COUNT(*) AS n, MAX(COALESCE(updated_at, created_at)) AS at FROM ui_translations WHERE company_id = ? AND deleted_at IS NULL').get(companyId);
    return `${r.n}|${r.at ?? ''}`;
  };

  /** The built-in text with the company's overrides on top: { en: { ns: { key: text } }, hi: ... }. Rebuilt when an override changes. */
  function catalogue(companyId) {
    if (!has() || companyId === null || companyId === undefined) return CATALOGUE;
    const stamp = stampOf(companyId);
    const hit = cache.get(companyId);
    if (hit && hit.stamp === stamp) return hit.catalogue;
    const merged = Object.fromEntries(Object.entries(CATALOGUE).map(([lang, namespaces]) => [lang, Object.fromEntries(Object.entries(namespaces).map(([ns, keys]) => [ns, { ...keys }]))]));
    for (const o of db.prepare('SELECT namespace, msg_key, lang, text FROM ui_translations WHERE company_id = ? AND deleted_at IS NULL AND is_active = 1').all(companyId)) {
      if (merged[o.lang]?.[o.namespace]) merged[o.lang][o.namespace][o.msg_key] = o.text;
    }
    cache.set(companyId, { stamp, catalogue: merged });
    return merged;
  }

  /** @returns {(ns: string, key: string, params?: Record<string, any>) => string} */
  const translator = (companyId, lang) => createTranslator({ catalogue: catalogue(companyId), lang: lang === 'hi' ? 'hi' : 'en' });

  /** The language of a person's screens and messages: their saved preference, else the language of their profile, else English. */
  function languageOf({ companyId, userId = null, username = null }) {
    if (username) {
      const p = db.prepare('SELECT language FROM ui_user_preferences WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL').get(companyId, username);
      if (p?.language) return p.language;
    }
    if (userId) {
      const p = db.prepare('SELECT language FROM iam_user_profiles WHERE user_id = ? AND deleted_at IS NULL').get(userId);
      if (p?.language === 'hi') return 'hi';
    }
    return 'en';
  }

  /** Number grouping and hour format for a person: their own choice, else the company's parameters. */
  function formatPrefs({ companyId, userRef = null, lang = 'en' }) {
    const store = createParameterStore(db);
    const date = todayIST();
    const own = userRef && has() ? db.prepare('SELECT number_style, time_format FROM ui_locale_preferences WHERE company_id = ? AND user_ref = ? AND deleted_at IS NULL').get(companyId, userRef) : null;
    const grouping = own?.number_style ?? String(store.get('ui.locale.number_style', { companyId, date }));
    const time = own?.time_format ?? String(store.get('ui.locale.time_format', { companyId, date }));
    return { grouping: grouping === 'international' ? 'international' : 'indian', hour12: time === '12', lang: lang === 'hi' ? 'hi' : 'en' };
  }

  inst = { catalogue, translator, languageOf, formatPrefs, invalidate: (companyId) => cache.delete(companyId) };
  instances.set(db, inst);
  return inst;
}
