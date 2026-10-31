import { useEffect } from 'react';
import { useMe } from '../api/index.js';

const THEME_EVENT = 'erp-theme';

/** Applies the theme saved in the person's profile once their profile is known (so a new device looks the way they chose). Draws nothing. */
export default function ThemeSync() {
  const me = useMe();
  const theme = me.data?.preferences?.theme;
  useEffect(() => {
    if (theme) window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: theme }));
  }, [theme, me.data?.id]);
  return null;
}
