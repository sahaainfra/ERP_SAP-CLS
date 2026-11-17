import en from './en.js';
import hi from './hi.js';
import te from './te.js';

/** The built-in text: CATALOGUE[lang][namespace][key]. Company overrides (ui_translations) are merged over it by the server. */
export const CATALOGUE = Object.freeze({ en, hi, te });
export const NAMESPACES = Object.freeze(Object.keys(en));
