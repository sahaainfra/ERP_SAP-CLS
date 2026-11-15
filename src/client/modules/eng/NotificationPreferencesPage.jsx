import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { usePreferences, useSavePreferences, useSendTest } from '../../platform/notifications/api.js';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { CATEGORY } from './NotificationsPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Notification Preferences (part 04.06, section 7.2): for each kind of notification the channels it may use, the quiet hours in which only urgent ones come through at once, how the
// rest are gathered (at once, hourly or daily), and the language of the messages. Security and statutory notices always reach the centre and the e-mail.
const CHANNEL = { IN_APP: 'In the centre', EMAIL: 'E-mail', SMS: 'Text message', WHATSAPP: 'WhatsApp', PUSH: 'Push on my phone' };
const DIGEST = { INSTANT: 'At once', HOURLY: 'An hourly digest', DAILY: 'A daily digest' };

export default function NotificationPreferencesPage() {
  usePageTitle('Notification Preferences');
  const q = usePreferences();
  const save = useSavePreferences();
  const test = useSendTest();
  const qc = useQueryClient();
  const language = useMutation({ mutationFn: (value) => api.patch('/ui/preferences', { language: value }), onSuccess: () => qc.invalidateQueries({ queryKey: ['ntf'] }) });
  const [cats, setCats] = useState(null);
  const [digest, setDigest] = useState('INSTANT');
  const [quiet, setQuiet] = useState({ on: false, start: '22:00', end: '07:00' });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const d = q.data;
  useEffect(() => { if (d) { setCats(d.categories); setDigest(d.digest); setQuiet(d.quietHours ? { on: true, ...d.quietHours } : { on: false, start: '22:00', end: '07:00' }); } }, [d]);
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    save.mutate({ categories: cats, digest, quietHours: quiet.on ? { start: quiet.start, end: quiet.end } : null, ...(d.version ? { version: d.version } : {}) }, { onSuccess: () => setNotice('Your preferences are saved.'), onError: (er) => { setNotice(''); setError(errorInfo(er)); } });
  };
  if (q.isPending) return <Skeleton label="Loading your preferences" rows={5} />;
  if (q.isError) return <ErrorState title="Your preferences could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  return (
    <section aria-labelledby="np-title" data-testid="notification-preferences">
      <PageHeader id="np-title" title={"Notification Preferences"} />
      {notice && <p role="status" className="notice" data-testid="np-notice">{notice}</p>}
      <form className="form-grid" onSubmit={submit} aria-label="Notification preferences">
        {cats && (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Channels by kind">
            <table className="grid">
              <thead><tr><th>Kind</th>{d.channels.map((c) => <th key={c} scope="col">{CHANNEL[c]}</th>)}</tr></thead>
              <tbody>{d.categoryList.map((k) => (
                <tr key={k} data-testid={`np-row-${k}`}>
                  <th scope="row" data-label="Kind">{CATEGORY[k]}{d.mandatory.includes(k) && <><br /><span className="muted small">Always reaches the centre and your e-mail</span></>}</th>
                  {d.channels.map((c) => {
                    const forced = d.mandatory.includes(k) && (c === 'IN_APP' || c === 'EMAIL');
                    return <td key={c} data-label={CHANNEL[c]}><input type="checkbox" aria-label={`${CATEGORY[k]}: ${CHANNEL[c]}`} checked={forced || Boolean(cats[k][c])} disabled={forced} onChange={(e) => setCats({ ...cats, [k]: { ...cats[k], [c]: e.target.checked } })} /></td>;
                  })}
                </tr>))}</tbody>
            </table>
          </div>
        )}
        <fieldset>
          <legend>Quiet hours and digest</legend>
          <label className="check"><input type="checkbox" checked={quiet.on} onChange={(e) => setQuiet({ ...quiet, on: e.target.checked })} /> Hold back messages by e-mail, text, WhatsApp and push during quiet hours (India time). The centre still shows them; urgent ones, security and statutory notices come through.</label>
          {quiet.on && (
            <div className="wf-inline">
              <Field label="From" name="quietStart" error={error}><input type="time" value={quiet.start} onChange={(e) => setQuiet({ ...quiet, start: e.target.value })} /></Field>
              <Field label="Until" name="quietEnd" error={error}><input type="time" value={quiet.end} onChange={(e) => setQuiet({ ...quiet, end: e.target.value })} /></Field>
            </div>
          )}
          <Field label="Other messages are sent" name="digest" error={error}>
            <select value={digest} onChange={(e) => setDigest(e.target.value)}>{Object.entries(DIGEST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
        </fieldset>
        <Field label="Language of the messages" name="language" error={error} hint="The same choice as the language of the screens.">
          <select value={d.language} onChange={(e) => language.mutate(e.target.value)}><option value="en">English</option><option value="hi">हिन्दी (Hindi)</option></select>
        </Field>
        {error && <div role="alert" className="error" data-testid="np-error"><p>{error.form}</p>{Object.entries(error.fields ?? {}).map(([k, m]) => <p key={k} className="small">{m}</p>)}{error.correlationId && <p className="small">Correlation ID: <code>{error.correlationId}</code></p>}</div>}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>Save</button>
          <button type="button" className="btn" disabled={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: () => setNotice('A test notification was sent to you.') })}>Send me a test</button>
        </div>
      </form>
    </section>
  );
}
