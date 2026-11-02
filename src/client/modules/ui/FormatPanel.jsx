import { useEffect, useState } from 'react';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { useFlagOn } from '../../platform/shell/api.js';
import { useLocalePrefs, useSaveLocalePrefs } from '../../platform/i18n/api.js';
import { useT } from '../../platform/i18n/index.js';
import { formatMoney, formatTime } from '../../../shared/i18n/format.js';

// Number and time format (part 03.09, FR-03): a person's own grouping of amounts (Indian or international) and 12- or 24-hour time, or the company's
// setting. The examples are drawn with the choice itself, so the person sees what they will get.
const SAMPLE_AMOUNT = '123456789';
const SAMPLE_TIME = '2026-11-05T08:35:00Z';

export default function FormatPanel() {
  const on = useFlagOn('ff.ui.p0309');
  const t = useT('format');
  const prefs = useLocalePrefs(on);
  const save = useSaveLocalePrefs();
  const [form, setForm] = useState(null);
  const [notice, setNotice] = useState('');
  const p = prefs.data;
  useEffect(() => { if (p && !form) setForm({ numberStyle: p.numberStyle ?? '', timeFormat: p.timeFormat ?? '' }); }, [p, form]);
  if (!on) return null;
  if (prefs.isPending) return <Skeleton label={t('title')} rows={2} />;
  if (prefs.isError) return <ErrorState title={t('title')} error={prefs.error} onRetry={() => prefs.refetch()} />;
  if (!form) return null;
  const money = (grouping) => formatMoney(SAMPLE_AMOUNT, { grouping });
  const time = (h12) => formatTime(SAMPLE_TIME, { hour12: h12 });
  const current = { n: p.defaults.numberStyle, t: p.defaults.timeFormat };
  const dirty = (form.numberStyle || null) !== p.numberStyle || (form.timeFormat || null) !== p.timeFormat;
  const submit = async (e) => {
    e.preventDefault();
    setNotice('');
    try { await save.mutateAsync({ numberStyle: form.numberStyle || null, timeFormat: form.timeFormat || null, version: p.version }); setNotice(t('saved')); } catch { /* shown below */ }
  };
  return (
    <form className="card" aria-labelledby="format-title" data-testid="format-panel" onSubmit={submit}>
      <h2 id="format-title">{t('title')}</h2>
      <p className="muted">{t('intro')}</p>
      <div className="form-grid">
        <fieldset className="field">
          <legend>{t('number.legend')}</legend>
          <label><input type="radio" name="fmt-number" checked={form.numberStyle === 'indian'} onChange={() => setForm({ ...form, numberStyle: 'indian' })} /> {t('number.indian', { example: money('indian') })}</label>
          <label><input type="radio" name="fmt-number" checked={form.numberStyle === 'international'} onChange={() => setForm({ ...form, numberStyle: 'international' })} /> {t('number.international', { example: money('international') })}</label>
          <label><input type="radio" name="fmt-number" checked={form.numberStyle === ''} onChange={() => setForm({ ...form, numberStyle: '' })} /> {t('number.default', { current: t(`style.${current.n}`) })}</label>
        </fieldset>
        <fieldset className="field">
          <legend>{t('time.legend')}</legend>
          <label><input type="radio" name="fmt-time" checked={form.timeFormat === '24'} onChange={() => setForm({ ...form, timeFormat: '24' })} /> {t('time.24', { example: time(false) })}</label>
          <label><input type="radio" name="fmt-time" checked={form.timeFormat === '12'} onChange={() => setForm({ ...form, timeFormat: '12' })} /> {t('time.12', { example: time(true) })}</label>
          <label><input type="radio" name="fmt-time" checked={form.timeFormat === ''} onChange={() => setForm({ ...form, timeFormat: '' })} /> {t('time.default', { current: t(`hour.${current.t}`) })}</label>
        </fieldset>
      </div>
      {save.isError && <p role="alert" className="error">{save.error.message}{save.error.correlationId && <> (<code>{save.error.correlationId}</code>)</>}</p>}
      {notice && <p role="status" data-testid="format-notice">{notice}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={!dirty || save.isPending}>{t('save')}</button></div>
    </form>
  );
}
