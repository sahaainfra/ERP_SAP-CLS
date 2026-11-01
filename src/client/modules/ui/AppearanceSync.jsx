import { useEffect, useRef } from 'react';
import { APPEARANCE_EVENT, announceAppearance, applyAppearance } from '../../platform/design/appearance.js';
import { usePreferences, useSavePreferences } from './api.js';

/**
 * Keeps the screen and the person's saved preferences in step (part 03.01, FR-02, T-02). When the person is known, their saved
 * theme, density and language are applied (so a new device looks the way they chose); when they change one anywhere (the shell's
 * theme menu, the Appearance panel), it is saved. Draws nothing.
 */
export default function AppearanceSync() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  const applied = useRef(false);
  const saved = prefs.data;

  useEffect(() => {
    if (!saved || applied.current) return;
    applied.current = true;
    if (saved.saved) {
      applyAppearance(saved);
      announceAppearance({ theme: saved.theme, density: saved.density, language: saved.language, fromServer: true });
    }
    // the page to open after signing in, when the person opened the application at its root
    if (saved.startPage && window.__erpOpenedAt === '/' && window.location.pathname !== saved.startPage) {
      window.history.pushState(null, '', saved.startPage);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
    window.__erpOpenedAt = null;
  }, [saved]);

  useEffect(() => {
    const onChange = (e) => {
      const d = e.detail ?? {};
      if (d.fromServer || !applied.current) return;
      const body = Object.fromEntries(['theme', 'density', 'language'].filter((k) => d[k]).map((k) => [k, d[k]]));
      if (Object.keys(body).length) save.mutate(body);
    };
    window.addEventListener(APPEARANCE_EVENT, onChange);
    return () => window.removeEventListener(APPEARANCE_EVENT, onChange);
  }, [save]);
  return null;
}
