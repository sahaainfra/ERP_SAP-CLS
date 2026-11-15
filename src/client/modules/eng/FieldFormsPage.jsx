import { useMemo, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { useLang } from '../../platform/i18n/index.js';
import { enqueue, sync, useOffline } from '../../platform/offline/engine.js';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CMD_STATUS } from './offline-common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Field Forms (Mobile, part 04.15, FR-08): the forms that can be filled in with no connection. The list comes from the registry (what the person may use, and which forms wait for their part); a form is checked with the
// rules kept on the phone, saved in the encrypted queue and sent when there is a connection. Photos are made smaller and sent after the record.
const params = () => new URLSearchParams(window.location.search);

function Capture({ form, off }) {
  const [values, setValues] = useState({});
  const [photos, setPhotos] = useState([]);
  const [errors, setErrors] = useState([]);
  const [saved, setSaved] = useState(null);
  const [busy, setBusy] = useState(false);
  const language = useLang();
  const projects = off.masters.projects ?? [];
  const label = (f) => (language === 'hi' && f.labelHi) || f.label;
  const set = (k, v) => setValues((cur) => ({ ...cur, [k]: v }));
  const err = (k) => errors.find((e) => e.field === k)?.message;
  const submit = async (e) => {
    e.preventDefault(); setErrors([]); setBusy(true);
    try {
      const cmd = await enqueue({ type: form.code, values: { ...values, projectId: values.projectId ? Number(values.projectId) : undefined }, label: `${form.label}: ${values.title ?? ''}`.trim(), photos });
      setSaved(cmd); setValues({}); setPhotos([]); e.target.reset();
    } catch (er) { setErrors(er.errors?.length ? er.errors : [{ field: '_', message: er.message }]); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="card form-grid field-form" noValidate aria-label={form.label} data-testid="field-form">
      <h2>{(language === 'hi' && form.labelHi) || form.label}</h2>
      {off.locked && <p role="alert" className="error">The offline copy has expired. Connect once to refresh it.</p>}
      {form.fields.map((f) => (
        <label className="field" key={f.key}><span>{label(f)}{f.required ? ' *' : ''}</span>
          {f.type === 'project' ? (
            <select value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} data-testid={`ff-${f.key}`}><option value="">Choose the project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select>
          ) : <input value={values[f.key] ?? ''} inputMode={f.type === 'money' ? 'decimal' : 'text'} maxLength={f.max ?? 40} onChange={(e) => set(f.key, e.target.value)} aria-invalid={err(f.key) ? true : undefined} data-testid={`ff-${f.key}`} />}
          {err(f.key) && <span className="field-error" role="alert">{err(f.key)}</span>}
        </label>
      ))}
      <label className="field"><span>Photos (optional)</span>
        <input type="file" accept="image/*" capture="environment" multiple onChange={(e) => setPhotos([...e.target.files])} data-testid="ff-photos" />
        {photos.length > 0 && <span className="muted small">{photos.length} photo(s) will be made smaller and sent after the record.</span>}
      </label>
      {err('_') && <p className="field-error" role="alert">{err('_')}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary btn-large" disabled={busy || off.locked} data-testid="ff-save">{off.online ? 'Save and send' : 'Save on this phone'}</button></div>
      {saved && <p role="status" className="notice" data-testid="ff-saved">{off.online ? 'Saved. It is being sent now.' : 'Saved on this phone. It will be sent when there is a connection.'}</p>}
    </form>
  );
}

export default function FieldFormsPage() {
  usePageTitle('Field Forms');
  const off = useOffline();
  const [code, setCode] = useState(() => params().get('form'));
  const choose = (c) => { window.history.pushState(null, '', c ? `/field/forms?form=${c}` : '/field/forms'); setCode(c); };
  const form = off.forms.find((f) => f.code === code && f.available);
  const mine = useMemo(() => [...off.queue].reverse().slice(0, 8), [off.queue]);
  return (
    <section aria-labelledby="ff-title" className="field-forms" data-testid="field-forms">
      <PageHeader id="ff-title" title={"Field Forms"} />
      <ul className="field-status" aria-label="Connection">
        <li data-testid="ff-online" data-online={off.online}><Icon name={off.online ? 'erp.state.sync' : 'erp.action.offline'} size={18} /> {off.online ? 'Online' : 'Offline: forms are saved on this phone'}</li>
        <li data-testid="ff-queue" data-count={off.queue.length}><Icon name="erp.action.inbox" size={18} /> {off.queue.length === 0 ? 'Nothing is waiting to be sent' : `${off.queue.length} waiting to be sent`} · <Link to="/field/sync">Sync status</Link></li>
      </ul>
      {!off.supported && <p role="alert" className="error">This browser cannot keep an encrypted offline copy (IndexedDB and WebCrypto are needed).</p>}
      {off.supported && !off.ready && !off.revoked && <p className="muted" role="status">Preparing the offline copy...</p>}
      {off.revoked && <p role="alert" className="error" data-testid="ff-revoked">This device was revoked. Its offline data was removed. Ask the IT administrator if this is a mistake.</p>}
      {form ? (
        <>
          <p><button type="button" className="btn" onClick={() => choose(null)}>All forms</button></p>
          <Capture form={form} off={off} />
        </>
      ) : off.ready && (
        <ul className="field-tiles" aria-label="Forms">
          {off.forms.map((f) => (
            <li key={f.code}>
              {f.available && f.route
                ? <a href={f.route} onClick={(e) => { e.preventDefault(); navigateTo(f.route); }} data-testid={`form-${f.code}`}><Icon name="erp.field.field" size={32} /><strong>{f.label}</strong></a>
                : f.available
                ? <a href={`/field/forms?form=${f.code}`} onClick={(e) => { e.preventDefault(); choose(f.code); }} data-testid={`form-${f.code}`}><Icon name="erp.field.field" size={32} /><strong>{f.label}</strong></a>
                : <span className="is-disabled" data-testid={`form-${f.code}`} aria-disabled="true"><Icon name="erp.field.field" size={32} /><strong>{f.label}</strong><span className="muted small">{f.planned ? `Available with part ${f.module}` : 'You may not use this form'}</span></span>}
            </li>
          ))}
        </ul>
      )}
      {off.ready && off.forms.length === 0 && <EmptyState title="No forms yet" message="Connect once so the forms and the rules can be kept on this phone." />}
      {mine.length > 0 && (
        <>
          <h2>Waiting and recent</h2>
          <ul className="op-comments" aria-label="Queued forms">
            {mine.map((c) => <li key={c.id} data-testid="ff-item"><strong>{c.label}</strong> <StatusBadge status={(CMD_STATUS[c.status] ?? CMD_STATUS.PENDING)[0]} label={(CMD_STATUS[c.status] ?? CMD_STATUS.PENDING)[1]} /> <span className="muted small">{formatDateTime(c.createdAt)}{c.files?.length ? ` · ${c.files.length} photo(s)` : ''}</span>{c.error && <p className="field-error">{c.error}</p>}</li>)}
          </ul>
          {off.online && <button type="button" className="btn" onClick={() => sync({ force: true })} disabled={off.syncing}>Send now</button>}
        </>
      )}
    </section>
  );
}
