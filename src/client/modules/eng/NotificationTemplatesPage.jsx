import { useEffect, useRef, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { usePreviewTemplate, useProposeTemplate, useTemplate, useTemplates } from '../../platform/notifications/api.js';
import { Field, Link, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { CATEGORY } from './NotificationsPage.jsx';

// Notification Templates (part 04.06, section 7.3): the words of each notification per channel and language, with the facts a template may carry, a preview in either language, and a new
// version that is a change the IT administrator approves. The version in force stays until then.
const CHANNEL = { IN_APP: 'In the centre', EMAIL: 'E-mail', SMS: 'Text message', WHATSAPP: 'WhatsApp', PUSH: 'Push' };
const LANG = { en: 'English', hi: 'हिन्दी (Hindi)' };

function Editor({ code, canEdit, onDone }) {
  const q = useTemplate(code);
  const preview = usePreviewTemplate();
  const propose = useProposeTemplate();
  const [channel, setChannel] = useState('IN_APP');
  const [lang, setLang] = useState('en');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const text = useRef(null);
  const t = q.data;
  const entry = t?.entries.find((e) => e.channel === channel && e.lang === lang);
  useEffect(() => { if (entry) { setSubject(entry.subject); setBody(entry.body); setError(null); } }, [entry?.id]);
  useEffect(() => {
    if (!t || !entry) return undefined;
    const timer = setTimeout(() => preview.mutate({ code, channel, lang, subject, body, variables: t.variables }), 300);
    return () => clearTimeout(timer);
  }, [code, channel, lang, subject, body, t?.variables?.join()]);
  if (q.isPending) return <Skeleton label="Loading the template" rows={4} />;
  if (q.isError) return <ErrorState title="The template could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  const changed = entry && (subject !== entry.subject || body !== entry.body);
  const insert = (v) => { const el = text.current; const at = el?.selectionStart ?? body.length; setBody(`${body.slice(0, at)}{{${v}}}${body.slice(at)}`); };
  const send = (e) => {
    e.preventDefault();
    setError(null);
    propose.mutate({ code, reason, changes: [{ channel, lang, ...(['EMAIL', 'IN_APP', 'PUSH'].includes(channel) ? { subject } : {}), body }] }, {
      onSuccess: () => { setNotice('Sent for approval by the IT administrator. The version in force is unchanged until then.'); setReason(''); onDone?.(); },
      onError: (er) => setError(errorInfo(er)),
    });
  };
  const p = preview.data;
  return (
    <section className="card" aria-label={`Template ${code}`} data-testid="tpl-editor">
      <h2>{code}</h2>
      <p className="muted">{CATEGORY[t.category]}. Facts it may carry: {t.variables.map((v) => <code key={v} className="small">{`{{${v}}}`} </code>)}</p>
      {notice && <p role="status" className="notice" data-testid="tpl-notice">{notice}</p>}
      {t.pending.length > 0 && <p role="status" className="notice" data-testid="tpl-pending">A change of this template is waiting for approval ({t.pending.length} text(s), version {t.pending[0].version}). Nothing else can be changed until it is decided.</p>}
      <div className="wf-inline">
        <label className="field"><span>Channel</span><select value={channel} onChange={(e) => setChannel(e.target.value)}>{Object.entries(CHANNEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Language</span><select value={lang} onChange={(e) => setLang(e.target.value)}>{Object.entries(LANG).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {entry && <p className="muted small">Version {entry.version} ({entry.scope === 'shared' ? 'shared by every company' : 'this company'})</p>}
      </div>
      {!entry ? <p className="muted">This template has no text for that channel and language.</p> : (
        <form className="form-grid" onSubmit={send} aria-label="Change the text">
          {['EMAIL', 'IN_APP', 'PUSH'].includes(channel) && <Field label="Subject or title" name="changes.0.subject" error={error}><input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} disabled={!canEdit || t.pending.length > 0} /></Field>}
          <Field label="Text" name="changes.0.body" error={error}><textarea ref={text} rows="5" value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} disabled={!canEdit || t.pending.length > 0} /></Field>
          {canEdit && t.pending.length === 0 && <div className="wf-inline" role="group" aria-label="Insert a fact">{t.variables.map((v) => <button type="button" key={v} className="btn btn-small" onClick={() => insert(v)}>{v}</button>)}</div>}
          <div className="card" aria-live="polite" data-testid="tpl-preview">
            <h3>Preview in {LANG[lang]}, {CHANNEL[channel]}</h3>
            {p ? <>{p.subject && <p><strong>{p.subject}</strong></p>}<p style={{ whiteSpace: 'pre-wrap' }}>{p.body}</p><p className="muted small">{p.characters} characters{p.unknownVariables.length ? '' : ''}</p>{p.unknownVariables.length > 0 && <p role="alert" className="error">Not a fact of this template: {p.unknownVariables.join(', ')}</p>}</> : <p className="muted">Preparing the preview...</p>}
          </div>
          {canEdit && t.pending.length === 0 && (
            <>
              <Field label="Reason for the change" name="reason" error={error}><input value={reason} required minLength={5} maxLength={500} onChange={(e) => setReason(e.target.value)} /></Field>
              {error && <div role="alert" className="error" data-testid="tpl-error"><p>{error.form}</p>{Object.entries(error.fields ?? {}).map(([k, m]) => <p key={k} className="small">{m}</p>)}{error.correlationId && <p className="small">Correlation ID: <code>{error.correlationId}</code></p>}</div>}
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={!changed || reason.trim().length < 5 || propose.isPending}>Send for approval</button></div>
            </>
          )}
        </form>
      )}
      {t.pending[0]?.status === 'PENDING' && <p className="small"><Link to="/approvals">My Approvals</Link></p>}
    </section>
  );
}

export default function NotificationTemplatesPage({ session }) {
  usePageTitle('Notification Templates');
  const [filters, setFilters] = useState({ category: '', q: '' });
  const [open, setOpen] = useState(null);
  const q = useTemplates(filters);
  if (q.error?.status === 403) return <NoPermission what="the notification templates" permission="ntf.template.view" />;
  const d = q.data;
  return (
    <section aria-labelledby="nt-title" data-testid="notification-templates">
      <h1 id="nt-title">Notification Templates</h1>
      <p className="muted">The words of each notification, per channel and language. A change is a new version that the IT administrator approves; every change is in the audit trail.</p>
      <form className="srch-form" role="search" aria-label="Filter the templates" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Kind</span><select value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}><option value="">All kinds</option>{Object.entries(CATEGORY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Code</span><input type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} /></label>
      </form>
      {q.isPending && <Skeleton label="Loading the templates" rows={4} />}
      {q.isError && q.error?.status !== 403 && <ErrorState title="The templates could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {open && <Editor key={open} code={open} canEdit={can(session, 'ntf.template.edit')} onDone={() => q.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No template matches" message="Change the filters." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Templates">
          <table className="grid">
            <thead><tr><th>Code</th><th>Kind</th><th className="num">Version</th><th className="num">Texts</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.code} data-testid={`tpl-row-${r.code}`}>
                <th scope="row" data-label="Code"><code>{r.code}</code></th><td data-label="Kind">{CATEGORY[r.category]}</td><td className="num" data-label="Version">{r.version}</td><td className="num" data-label="Texts">{r.texts}</td>
                <td data-label="State">{r.pending ? <StatusBadge status="submitted" label="Change waiting" /> : r.changedHere ? <StatusBadge status="approved" label="Changed here" /> : <StatusBadge status="draft" label="Shared" />}</td>
                <td data-label="Actions"><button type="button" className="btn btn-small" onClick={() => setOpen(r.code)}>{can(session, 'ntf.template.edit') ? 'Open' : 'View'}<span className="sr-only"> {r.code}</span></button></td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
