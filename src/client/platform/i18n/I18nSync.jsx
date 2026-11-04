import { useEffect } from 'react';
import { useFlagOn } from '../shell/api.js';
import { setFormatPrefs, setOverrides, useLang } from './index.js';
import { useCatalogue, useLocalePrefs } from './api.js';

/**
 * Keeps the screens' text and formats in step with the server (part 03.09): the company's own wording for the language in use, and the person's
 * number grouping and hour format. It draws nothing. With the flag off the bundled English and Hindi and the Indian defaults apply.
 */
export default function I18nSync() {
  const on = useFlagOn('ff.ui.p0309');
  const lang = useLang();
  const catalogue = useCatalogue(lang, on);
  const prefs = useLocalePrefs(on);
  useEffect(() => { if (catalogue.data) setOverrides(lang, catalogue.data.namespaces); }, [catalogue.data, lang]);
  useEffect(() => { if (prefs.data) setFormatPrefs({ grouping: prefs.data.effective.numberStyle, hour12: prefs.data.effective.timeFormat === '12' }); }, [prefs.data]);
  return null;
}
