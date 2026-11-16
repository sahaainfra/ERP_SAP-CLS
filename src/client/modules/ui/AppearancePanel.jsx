import { useEffect, useState } from 'react';
import { allRoutes } from '../../platform/shell/registry.js';
import { announceAppearance, applyAppearance, storedAppearance } from '../../platform/design/appearance.js';
import { Field, QueryState, errorInfo } from '../core/pages/ui.jsx';
import { usePreferences, useSavePreferences } from './api.js';
import { useFlagOn } from '../../platform/shell/api.js';

const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['high-contrast', 'High contrast']];
const DENSITIES = [['comfortable', 'Comfortable: larger rows and controls, for touch screens'], ['compact', 'Compact: more rows on the screen, for a mouse and keyboard']];
const LANGUAGES = [['en', 'English'], ['hi', 'हिन्दी (Hindi)'], ['te', 'తెలుగు (Telugu)']];

/**
 * Appearance (part 03.01): theme, density, the language of the screens and the page to open after signing in. A choice shows at
 * once as a preview; Save keeps it on the server, so it follows the person to any device; Cancel goes back to what was saved.
 */
export default function AppearancePanel({ session }) {
  const prefs = usePreferences();
  const teluguOn = useFlagOn('ff.field.p16603');
  const save = useSavePreferences();
  const [form, setForm] = useState(null);
  const [baseline] = useState(() => ({ ...storedAppearance(), startPage: '' })); // the look before any preview
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const p = prefs.data;
  useEffect(() => {
    if (p && !form) setForm(p.saved ? { theme: p.theme, density: p.density, language: p.language, startPage: p.startPage ?? '' } : baseline);
  }, [p, form, baseline]);
  const pages = allRoutes().filter((r) => !r.permission || session?.permissions?.includes(r.permission)).filter((r) => !r.onboardingOnly && r.menu !== false);
  const preview = (next) => { setForm(next); applyAppearance(next, { remember: false }); setNotice(''); };
  const dirty = form && p && (!p.saved || form.theme !== p.theme || form.density !== p.density || form.language !== p.language || (form.startPage || null) !== (p.startPage ?? null));

  return (
    <form
      className="card"
      aria-labelledby="appearance-title"
      data-testid="appearance"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setNotice('');
        try {
          const out = await save.mutateAsync({ theme: form.theme, density: form.density, language: form.language, startPage: form.startPage || null, version: p.version });
          applyAppearance(out);
          announceAppearance({ theme: out.theme, density: out.density, language: out.language, fromServer: true });
          setNotice('Your appearance was saved. It applies on every device you sign in to.');
        } catch (err) { setError({ ...errorInfo(err), status: err?.status }); }
      }}
    >
      <h2 id="appearance-title">Appearance</h2>
      <QueryState query={prefs} what="your appearance settings" permission="a signed-in account" />
      {form && (
        <>
          <div className="form-grid">
            <fieldset className="field">
              <legend>Theme</legend>
              {THEMES.map(([v, l]) => <label key={v}><input type="radio" name="appearance-theme" value={v} checked={form.theme === v} onChange={() => preview({ ...form, theme: v })} /> {l}</label>)}
            </fieldset>
            <fieldset className="field">
              <legend>Density</legend>
              {DENSITIES.map(([v, l]) => <label key={v}><input type="radio" name="appearance-density" value={v} checked={form.density === v} onChange={() => preview({ ...form, density: v })} /> {l}</label>)}
            </fieldset>
            <Field label="Language of the screens" name="language" error={error} hint="Pages in Hindi use the Devanagari typeface and pages in Telugu the Telugu one; text not yet translated stays in English.">
              <select name="appearance-language" value={form.language} onChange={(e) => preview({ ...form, language: e.target.value })}>{LANGUAGES.filter(([v]) => v !== 'te' || teluguOn || form.language === 'te').map(([v, l]) => <option key={v} value={v} lang={v}>{l}</option>)}</select>
            </Field>
            <Field label="Open after signing in" name="startPage" error={error}>
              <select name="appearance-start" value={form.startPage} onChange={(e) => setForm({ ...form, startPage: e.target.value })}>
                <option value="">The first page I may see</option>
                {pages.map((r) => <option key={r.path} value={r.path}>{r.label}</option>)}
              </select>
            </Field>
          </div>
          <p role="status" className="notice" data-testid="appearance-notice">{notice}</p>
          {error?.form && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}{error.status === 409 && <> <button type="button" className="btn btn-small" onClick={() => { prefs.refetch(); setForm(null); setError(null); }}>Reload</button></>}</p>}
          <div className="actions">
            <button type="button" className="btn" disabled={!dirty} onClick={() => { const back = p.saved ? { theme: p.theme, density: p.density, language: p.language, startPage: p.startPage ?? '' } : baseline; preview(back); announceAppearance({ ...back, fromServer: true }); }}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={save.isPending || !dirty}>{save.isPending ? 'Saving...' : 'Save appearance'}</button>
          </div>
        </>
      )}
    </form>
  );
}
