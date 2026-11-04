import { useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { useConsentHistory, useConsents, useImportConsents, useSetConsent } from '../../platform/comm/api.js';
import { Field, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANNEL } from './CommunicationLogPage.jsx';

// Consent Register (part 04.07, section 7.3): who agreed to receive messages on which channel, who opted out (including by replying STOP), and when and how it changed. Commercial messages go only to
// people who opted in; a message the person must have (a code, a statutory notice) is not stopped by an opt-out.
const SOURCE = { ADMIN: 'Set by an administrator', IMPORT: 'Imported', STOP_KEYWORD: 'Replied STOP', START_KEYWORD: 'Replied START', FORM: 'On a form', PORTAL: 'On the portal' };
const EMPTY = { channel: '', status: '', q: '' };
const PAGE = 25;

function History({ id }) {
  const q = useConsentHistory(id);
  if (q.isPending) return <Skeleton label="Loading the history" rows={2} />;
  if (q.isError) return <ErrorState title="The history could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  return <ol aria-label="Consent history" data-testid="cr-history">{q.data.map((h, i) => <li key={i}>{formatDateTime(h.at)}: {h.to.status === 'OPT_IN' ? 'opted in' : 'opted out'} ({SOURCE[h.to.source] ?? h.to.source}) by {h.by}</li>)}</ol>;
}

export default function ConsentRegisterPage({ session }) {
  usePageTitle('Consent Register');
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ channel: 'WHATSAPP', address: '', status: 'OPT_IN', contactType: 'OTHER', contactName: '' });
  const [csv, setCsv] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const list = useConsents({ ...filters, limit: PAGE, offset: (page - 1) * PAGE });
  const save = useSetConsent();
  const imp = useImportConsents();
  const edit = can(session, 'comm.consent.edit');
  if (list.error?.status === 403) return <NoPermission what="the consent register" permission="comm.consent.view" />;
  const d = list.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / PAGE)) : 1;
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const submit = (e) => {
    e.preventDefault();
    setError(null);
    save.mutate({ ...form, contactName: form.contactName || undefined }, { onSuccess: () => { setNotice('Saved.'); setForm({ ...form, address: '', contactName: '' }); }, onError: (er) => setError(errorInfo(er)) });
  };
  const doImport = () => {
    setError(null);
    const rows = csv.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [channel, address, status, name] = l.split(',').map((x) => x.trim()); return { channel, address, status, ...(name ? { contactName: name } : {}) }; });
    imp.mutate({ rows }, { onSuccess: (r) => { setNotice(`${r.imported} row(s) imported.`); setCsv(''); }, onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <section aria-labelledby="cr-title" data-testid="consent-register">
      <h1 id="cr-title">Consent Register</h1>
      <p className="muted">Who agreed to receive messages, and who asked to stop. Commercial messages go only to people who opted in.</p>
      {notice && <p role="status" className="notice" data-testid="cr-notice">{notice}</p>}
      <form className="srch-form" role="search" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Channel</span><select value={filters.channel} onChange={(e) => set({ channel: e.target.value })}><option value="">All channels</option>{Object.entries(CHANNEL).filter(([k]) => k !== 'PUSH').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Status</span><select value={filters.status} onChange={(e) => set({ status: e.target.value })}><option value="">Any</option><option value="OPT_IN">Opted in</option><option value="OPT_OUT">Opted out</option></select></label>
        <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
        {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
      </form>
      {edit && <form className="card form-grid" onSubmit={submit} aria-label="Record a consent" data-testid="cr-form">
        <h2>Record a consent</h2>
        <div className="wf-inline">
          <label className="field"><span>Channel</span><select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>{Object.entries(CHANNEL).filter(([k]) => k !== 'PUSH').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <Field label="Number or address" name="address" error={error}><input value={form.address} maxLength={120} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          <label className="field"><span>Choice</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="OPT_IN">Opt in</option><option value="OPT_OUT">Opt out</option></select></label>
          <label className="field"><span>Kind of contact</span><select value={form.contactType} onChange={(e) => setForm({ ...form, contactType: e.target.value })}>{['USER', 'EMPLOYEE', 'VENDOR', 'CLIENT', 'SUBCONTRACTOR', 'OTHER'].map((k) => <option key={k} value={k}>{k.charAt(0) + k.slice(1).toLowerCase()}</option>)}</select></label>
          <Field label="Name" name="contactName" error={error}><input value={form.contactName} maxLength={120} onChange={(e) => setForm({ ...form, contactName: e.target.value })} /></Field>
        </div>
        {error?.form && <p role="alert" className="error">{error.form}</p>}
        <button type="submit" className="btn btn-primary" disabled={save.isPending || form.address.length < 3}>Save</button>
        <details><summary>Import many</summary>
          <label className="field"><span>Lines to import: channel, mobile or e-mail, OPT_IN or OPT_OUT, name</span><textarea rows="4" value={csv} onChange={(e) => setCsv(e.target.value)} /></label>
          <button type="button" className="btn" disabled={imp.isPending || !csv.trim()} onClick={doImport}>Import</button>
        </details>
      </form>}
      {list.isPending && <Skeleton label="Loading the register" rows={4} />}
      {list.isError && list.error?.status !== 403 && <ErrorState title="The register could not be loaded" error={list.error} onRetry={() => list.refetch()} />}
      {d && (d.rows.length === 0 ? <EmptyState title="No consent is recorded" message="Consent is recorded as people reply STOP or START, or when an administrator records it." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Consents">
          <table className="grid">
            <thead><tr><th>Address</th><th>Channel</th><th>Contact</th><th>Choice</th><th>How</th><th>Changed</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{d.rows.map((r) => (
              <tr key={r.id} data-testid={`cr-row-${r.id}`}>
                <th scope="row" data-label="Address">{r.address}</th><td data-label="Channel">{CHANNEL[r.channel]}</td><td data-label="Contact">{r.contactName ?? ''}<br /><span className="muted small">{r.contactType}</span></td>
                <td data-label="Choice"><StatusBadge status={r.status === 'OPT_IN' ? 'approved' : 'rejected'} label={r.status === 'OPT_IN' ? 'Opted in' : 'Opted out'} /></td>
                <td data-label="How">{SOURCE[r.source] ?? r.source}</td><td data-label="Changed">{formatDateTime(r.changedAt)}</td>
                <td data-label="Actions"><button type="button" className="btn btn-small" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>History</button>{open === r.id && <History id={r.id} />}</td>
              </tr>))}</tbody>
          </table>
        </div>
      ))}
      <div className="pager"><span>{d?.total ?? 0} consent(s), page {page} of {pages}</span>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
    </section>
  );
}
