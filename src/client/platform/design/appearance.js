// The theme, density and language of the screens (part 03.01, FR-02, FR-03). They are applied to <html> (data-theme,
// data-density, lang), so every component follows at once without a reload. A person's choice is saved on the server (ui
// preferences) and so follows them to another device; this browser also remembers it for the moment before the server answers.
// On a first visit the device decides: dark or more contrast if it asks for them, comfortable density on a touch screen.

export const THEMES = ['light', 'dark', 'high-contrast'];
export const DENSITIES = ['comfortable', 'compact'];
export const LANGUAGES = ['en', 'hi'];
const KEY = 'erp.appearance';
const OLD_THEME_KEY = 'erp.theme';
export const APPEARANCE_EVENT = 'erp-appearance';

const media = (q) => { try { return window.matchMedia?.(q).matches ?? false; } catch { return false; } };

/** What the device asks for, before anyone chooses. */
export function deviceDefaults() {
  const theme = media('(prefers-contrast: more)') ? 'high-contrast' : media('(prefers-color-scheme: dark)') ? 'dark' : 'light';
  return { theme, density: 'comfortable', language: 'en' };
}

/** What this browser last used (or the device defaults). */
export function storedAppearance() {
  const base = deviceDefaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    const oldTheme = localStorage.getItem(OLD_THEME_KEY);
    const out = { ...base, ...(saved ?? {}), ...(saved?.theme ? {} : oldTheme && THEMES.includes(oldTheme) ? { theme: oldTheme } : {}) };
    return { theme: THEMES.includes(out.theme) ? out.theme : base.theme, density: DENSITIES.includes(out.density) ? out.density : base.density, language: LANGUAGES.includes(out.language) ? out.language : base.language, chosen: Boolean(saved || oldTheme) };
  } catch {
    return { ...base, chosen: false };
  }
}

/** Apply to the page now and, unless it is only a preview, remember it in this browser. */
export function applyAppearance({ theme, density, language }, { remember = true } = {}) {
  const el = document.documentElement;
  if (theme && THEMES.includes(theme)) el.dataset.theme = theme;
  if (density && DENSITIES.includes(density)) el.dataset.density = density;
  if (language && LANGUAGES.includes(language)) el.lang = language;
  if (!remember) return;
  try {
    const now = storedAppearance();
    localStorage.setItem(KEY, JSON.stringify({ theme: theme ?? now.theme, density: density ?? now.density, language: language ?? now.language }));
    if (theme) localStorage.setItem(OLD_THEME_KEY, theme);
  } catch { /* still applies for this page */ }
}

/** Tell the shell (and anything else listening) that the appearance changed. */
export const announceAppearance = (detail) => window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail }));
