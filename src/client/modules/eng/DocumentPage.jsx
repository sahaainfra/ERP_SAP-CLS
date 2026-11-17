import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { fetchContent, saveBlob, useCompare, useDocAction, useDocument, useShare, useUnshare, useUpdateDocument, useVersionLocate } from '../../platform/documents/api.js';
import { useRecordHistory } from '../core/api/audit.js';
import { Field, Link, can, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from './common.js';
import DocumentViewer from './DocumentViewer.jsx';
import { LEVELS, RETENTION, STATUS, VERSION_STATUS } from './documents-common.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Document (part 04.10, section 7.2): one controlled document as an Object Page. The header says where it stands (issued revision, who holds it) and offers what this person may do; the tabs
// hold the details, the revisions with a comparison and downloads (an old revision carries a watermark), the viewer with markups, the approvals, who it was sent to and who acknowledged it,
// who it is shared with, the records it belongs to, and its history.
const TABS = [['details', 'Details'], ['versions', 'Revisions'], ['viewer', 'Viewer'], ['approvals', 'Approvals'], ['distribution', 'Distribution'], ['sharing', 'Sharing'], ['related', 'Related'], ['history', 'History']];

function Details({ d, onSave, saving, error }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({});
  useEffect(() => setF({ title: d.title, discipline: d.discipline ?? '', confidentiality: d.confidentiality, validUntil: d.validUntil ?? '', wbsRef: d.wbsRef ?? '', locationRef: d.locationRef ?? '', tags: d.tags.join(', ') }), [d.version]);
  if (!edit) {
    return (
      <div data-testid="doc-details">
        <dl className="kv">
          <dt>Number</dt><dd>{d.docNo}</dd><dt>Title</dt><dd>{d.title}</dd><dt>Type</dt><dd>{d.typeName}</dd><dt>Discipline</dt><dd>{d.discipline ?? '—'}</dd>
          <dt>Folder</dt><dd>{d.folderPath ?? '—'}</dd><dt>WBS and location</dt><dd>{[d.wbsRef, d.locationRef].filter(Boolean).join(', ') || '—'}</dd><dt>Confidentiality</dt><dd>{LEVELS[d.confidentiality]}</dd>
          <dt>Owner</dt><dd>{d.owner}</dd><dt>Retention</dt><dd>{RETENTION[d.retentionClass]}</dd><dt>Valid until</dt><dd>{d.validUntil ? formatDate(d.validUntil) : 'Not time-limited'}</dd><dt>Tags</dt><dd>{d.tags.length ? d.tags.join(', ') : '—'}</dd>
        </dl>
        {d.allowed.edit && <button type="button" className="btn" onClick={() => setEdit(true)}>Change the details</button>}
      </div>
    );
  }
  return (
    <form className="form-grid" aria-label="Change the details" onSubmit={(e) => { e.preventDefault(); onSave({ id: d.id, title: f.title, discipline: f.discipline, confidentiality: f.confidentiality, validUntil: f.validUntil || undefined, wbsRef: f.wbsRef, locationRef: f.locationRef, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), version: d.version }, () => setEdit(false)); }}>
      <Field label="Title" name="title" error={error}><input value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <div className="wf-inline">
        <Field label="Discipline" name="discipline" error={error}><input value={f.discipline} maxLength={60} onChange={(e) => setF({ ...f, discipline: e.target.value })} /></Field>
        <label className="field"><span>Confidentiality</span><select value={f.confidentiality} onChange={(e) => setF({ ...f, confidentiality: e.target.value })}>{Object.entries(LEVELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {d.type?.hasValidity && <Field label="Valid until" name="validUntil" error={error}><input type="date" value={f.validUntil} onChange={(e) => setF({ ...f, validUntil: e.target.value })} /></Field>}
      </div>
      <div className="wf-inline">
        <Field label="WBS" name="wbsRef" error={error}><input value={f.wbsRef} maxLength={60} onChange={(e) => setF({ ...f, wbsRef: e.target.value })} /></Field>
        <Field label="Location" name="locationRef" error={error}><input value={f.locationRef} maxLength={120} onChange={(e) => setF({ ...f, locationRef: e.target.value })} /></Field>
        <Field label="Tags (comma between)" name="tags" error={error}><input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
      </div>
      {error?.form && <p role="alert" className="error">{error.form}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={saving}>Save</button><button type="button" className="btn" onClick={() => setEdit(false)}>Cancel</button></div>
    </form>
  );
}

function Versions({ d, onError }) {
  const [pair, setPair] = useState({ from: '', to: '' });
  const cmp = useCompare(d.id, pair.from, pair.to);
  const get = async (v, download) => { try { const f = await fetchContent(v.id, { download: true }); await saveBlob(f.buffer, f.type, f.name); } catch (e) { onError({ form: e.message }); } void download; };
  return (
    <div data-testid="doc-versions">
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Revisions">
        <table className="grid">
          <thead><tr><th>Rev</th><th>Status</th><th>Change</th><th>File</th><th>Sent</th><th>Decided</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.versions.map((v) => (
            <tr key={v.id} data-testid={`version-${v.revision}`}>
              <th scope="row" data-label="Rev">{v.revision}{v.current ? ' (current)' : ''}</th><td data-label="Status"><StatusBadge status={VERSION_STATUS[v.status][0]} label={VERSION_STATUS[v.status][1]} /></td>
              <td data-label="Change">{v.changeNote ?? ''}<br /><span className="muted small">{v.createdBy}</span></td>
              <td data-label="File">{(v.file ?? v.draftFile)?.name ?? <span className="muted">none yet</span>}{(v.file ?? v.draftFile) ? <span className="muted small"> {Math.round((v.file ?? v.draftFile).size / 1024)} KB, scan {(v.file ?? v.draftFile).scan.toLowerCase()}</span> : null}</td>
              <td data-label="Sent">{v.submittedAt ? formatDateTime(v.submittedAt) : ''}</td><td data-label="Decided">{v.approvedAt ? `issued ${formatDate(v.approvedAt)}` : v.supersededAt ? `superseded ${formatDate(v.supersededAt)}` : ''}</td>
              <td data-label="Actions">{(v.file ?? v.draftFile) && <button type="button" className="btn btn-small" onClick={() => get(v)} aria-label={`Download revision ${v.revision}`}>Download{v.status === 'SUPERSEDED' ? ' (watermarked)' : ''}</button>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {d.versions.length > 1 && (
        <section className="card" aria-label="Compare two revisions" data-testid="doc-compare">
          <h3>Compare two revisions</h3>
          <div className="wf-inline">
            <label className="field"><span>From</span><select value={pair.from} onChange={(e) => setPair({ ...pair, from: e.target.value })}><option value="">Choose</option>{d.versions.map((v) => <option key={v.id} value={v.id}>Revision {v.revision}</option>)}</select></label>
            <label className="field"><span>To</span><select value={pair.to} onChange={(e) => setPair({ ...pair, to: e.target.value })}><option value="">Choose</option>{d.versions.map((v) => <option key={v.id} value={v.id}>Revision {v.revision}</option>)}</select></label>
          </div>
          {cmp.data && <><p>{cmp.data.changes} difference(s) between revision {cmp.data.from.revision} and revision {cmp.data.to.revision}.</p>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Differences"><table className="grid"><thead><tr><th>Detail</th><th>Revision {cmp.data.from.revision}</th><th>Revision {cmp.data.to.revision}</th></tr></thead>
              <tbody>{cmp.data.rows.map((r) => <tr key={r.field} className={r.changed ? 'row-changed' : ''}><th scope="row" data-label="Detail">{r.label}{r.changed ? ' (changed)' : ''}</th><td data-label="From">{String(r.from)}</td><td data-label="To">{String(r.to)}</td></tr>)}</tbody></table></div></>}
        </section>)}
    </div>
  );
}

export default function DocumentPage({ session }) {
  usePageTitle('Document');
  const search = useSearch();
  const versionParam = Number(search.get('version')) || null;
  const loc = useVersionLocate(versionParam);
  const id = Number(search.get('id')) || loc.data?.documentId || null;
  const q = useDocument(id);
  const act = useDocAction();
  const update = useUpdateDocument();
  const share = useShare();
  const unshare = useUnshare();
  const [tab, setTab] = useState('details');
  const [asking, setAsking] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [sh, setSh] = useState({ type: 'USER', principal: '', permission: 'VIEW', expiresAt: '' });
  const [dist, setDist] = useState({ users: [], role: '', email: '', message: '', dueDays: '7' });
  const [viewer, setViewer] = useState(null);
  const history = useRecordHistory('doc_documents', id);
  if (!id && !versionParam) return <section aria-labelledby="dp-title"><PageHeader id="dp-title" title={"Document"} /><EmptyState title="No document chosen" message="Open a document from the register." action={{ label: 'Open the register', onClick: () => navigateTo('/documents') }} /></section>;
  if (q.error?.status === 404 || loc.error?.status === 404) return <section aria-labelledby="dp-title"><PageHeader id="dp-title" title={"Document"} /><EmptyState title="This document was not found" message="It does not exist, or you may not see it." action={{ label: 'Open the register', onClick: () => navigateTo('/documents') }} /></section>;
  const d = q.data;
  const run = (action, body = {}, after) => { setError(null); setNotice(''); act.mutate({ id, action, ...body }, { onSuccess: (r) => { setAsking(null); setText(''); setNotice(after?.(r) ?? 'Done.'); }, onError: (e) => setError(errorInfo(e)) }); };
  const asks = { checkin: 'Why do you force the check-in?', archive: 'Why is it archived?', cancel: 'Why is it cancelled?', revisions: 'What changes in the new revision?' };
  const current = d?.versions.find((v) => v.current) ?? null;
  const shown = viewer ? d?.versions.find((v) => v.id === viewer) : (current ?? d?.versions[0]);
  const canMark = Boolean(d) && d.status !== 'ARCHIVED' && d.status !== 'CANCELLED';
  return (
    <section aria-labelledby="dp-title" data-testid="document-page">
      <PageHeader id="dp-title" title={"Document"} />
      {q.isPending && id && <Skeleton label="Loading the document" rows={4} />}
      {q.isError && q.error?.status !== 404 && <ErrorState title="The document could not be loaded" error={q.error} onRetry={() => q.refetch()} />}
      {d && <>
        <header className="card">
          <h2>{d.docNo}: {d.title}</h2>
          <p><StatusBadge status={STATUS[d.status][0]} label={STATUS[d.status][1]} /> revision <strong data-testid="doc-revision">{d.revision ?? '—'}</strong> · {d.typeName} · {LEVELS[d.confidentiality]}
            {d.checkedOutBy && <span data-testid="doc-lock"> · <StatusBadge status="returned" label={`Checked out by ${d.checkedOutBy}`} /></span>}
            {d.daysToExpiry !== null && <span className={d.daysToExpiry < 0 ? 'error' : 'muted'}> · {d.daysToExpiry < 0 ? `expired ${-d.daysToExpiry} day(s) ago` : `${d.daysToExpiry} day(s) of validity left`}</span>}</p>
          {notice && <p role="status" className="notice" data-testid="doc-notice">{notice}</p>}
          {error?.form && <p role="alert" className="error" data-testid="doc-error">{error.form}</p>}
          <div className="actions" role="group" aria-label="What you can do">
            {d.allowed.checkOut && <button type="button" className="btn" disabled={act.isPending} onClick={() => run('checkout', {}, () => 'Checked out: nobody else can revise it meanwhile.')}>Check out</button>}
            {d.allowed.checkIn && <button type="button" className="btn" disabled={act.isPending} onClick={() => run('checkin', {}, () => 'Checked in.')}>Check in</button>}
            {d.allowed.forceCheckIn && <button type="button" className="btn" aria-expanded={asking === 'checkin'} onClick={() => { setAsking(asking === 'checkin' ? null : 'checkin'); setText(''); }}>Force check-in</button>}
            {d.allowed.newRevision && <button type="button" className="btn btn-primary" aria-expanded={asking === 'revisions'} onClick={() => { setAsking(asking === 'revisions' ? null : 'revisions'); setText(''); }}>New revision</button>}
            {d.allowed.submit && <><button type="button" className="btn btn-primary" onClick={() => navigateTo(`/documents/new?document=${d.id}`)}>{d.draftVersionId && d.versions.find((v) => v.id === d.draftVersionId)?.file === null && !d.versions.find((v) => v.id === d.draftVersionId)?.draftFile ? 'Attach the file' : 'Attach the file and send it'}</button>
              <button type="button" className="btn" disabled={act.isPending} onClick={() => run('submit', {}, () => 'Sent for approval: the reviewer, then the approver.')}>Send for approval</button></>}
            {d.allowed.distribute && <button type="button" className="btn" onClick={() => setTab('distribution')}>Distribute</button>}
            {d.allowed.archive && <button type="button" className="btn" aria-expanded={asking === 'archive'} onClick={() => { setAsking(asking === 'archive' ? null : 'archive'); setText(''); }}>Archive</button>}
            {d.allowed.cancel && <button type="button" className="btn" aria-expanded={asking === 'cancel'} onClick={() => { setAsking(asking === 'cancel' ? null : 'cancel'); setText(''); }}>Cancel the document</button>}
            {d.allowed.acknowledge && <button type="button" className="btn btn-primary" onClick={() => setTab('distribution')}>Acknowledge it</button>}
            <Link to="/documents">Back to the register</Link>
          </div>
          {asking && (
            <form className="wf-inline" aria-label={asks[asking]} onSubmit={(e) => { e.preventDefault(); if (asking === 'revisions') run('revisions', { changeNote: text }, (r) => `Revision ${r.revision} started and checked out to you.`); else run(asking, { reason: text }, () => 'Done.'); }}>
              <Field label={asks[asking]} name={asking === 'revisions' ? 'changeNote' : 'reason'} error={error}><input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} /></Field>
              <button type="submit" className="btn btn-primary" disabled={act.isPending || text.trim().length < (asking === 'revisions' ? 3 : 5)}>Do it</button>
            </form>)}
        </header>
        <div role="tablist" aria-label="Document sections" className="tabs">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>{l}{k === 'versions' ? ` (${d.versions.length})` : k === 'distribution' && d.distributions.length ? ` (${d.distributions.filter((x) => x.acknowledgedAt).length}/${d.distributions.length})` : ''}</button>)}</div>
        {tab === 'details' && <Details d={d} saving={update.isPending} error={error} onSave={(vars, done) => { setError(null); update.mutate(vars, { onSuccess: () => { setNotice('Saved.'); done(); }, onError: (e) => setError(errorInfo(e)) }); }} />}
        {tab === 'versions' && <Versions d={d} onError={setError} />}
        {tab === 'viewer' && (shown?.file || shown?.draftFile ? (
          <div>
            <label className="field"><span>Revision shown</span><select value={shown.id} onChange={(e) => setViewer(Number(e.target.value))}>{d.versions.filter((v) => v.file || v.draftFile).map((v) => <option key={v.id} value={v.id}>Revision {v.revision} ({VERSION_STATUS[v.status][1]})</option>)}</select></label>
            <DocumentViewer key={shown.id} version={shown} canMark={canMark} />
          </div>) : <EmptyState title="No file to show yet" message="Attach the file of the revision first." />)}
        {tab === 'approvals' && (
          <div data-testid="doc-approvals">
            {d.versions.filter((v) => v.instanceId).length === 0 ? <p className="muted">No revision has been sent for approval yet. When one is, the reviewer (discipline lead) decides first, then the approver for this type ({d.type?.approverRole === 'QCMGR' ? 'the quality control manager' : 'the project manager'}).</p> : (
              <ul>{d.versions.filter((v) => v.instanceId).map((v) => <li key={v.id}>Revision {v.revision}: <StatusBadge status={VERSION_STATUS[v.status][0]} label={VERSION_STATUS[v.status][1]} /> <Link to={`/workflow/instance?id=${v.instanceId}`}>Open the approval and its history</Link></li>)}</ul>)}
          </div>)}
        {tab === 'distribution' && (
          <div data-testid="doc-distribution">
            {d.distributions.length === 0 ? <p className="muted">Nothing has been sent to anyone yet.</p> : (
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Distribution"><table className="grid"><thead><tr><th>Recipient</th><th>Rev</th><th>Sent</th><th>Due</th><th>Acknowledged</th></tr></thead>
                <tbody>{d.distributions.map((r) => <tr key={r.id} data-testid={`dist-${r.recipient}`}><th scope="row" data-label="Recipient">{r.name}<br /><span className="muted small">{r.type === 'EXTERNAL' ? 'outside party' : r.recipient}</span></th><td data-label="Rev">{r.revision}</td><td data-label="Sent">{formatDate(r.sentAt)} by {r.sentBy}</td><td data-label="Due">{r.dueAt ? formatDate(r.dueAt) : ''}{r.overdue ? <span className="error small"> overdue</span> : ''}</td>
                  <td data-label="Acknowledged">{r.acknowledgedAt ? <>{formatDateTime(r.acknowledgedAt)}{r.ackNote ? <><br /><span className="small">{r.ackNote}</span></> : null}</> : <span className="muted">not yet</span>}</td></tr>)}</tbody></table></div>)}
            {d.allowed.acknowledge && (
              <form className="wf-inline" aria-label="Acknowledge" onSubmit={(e) => { e.preventDefault(); run('acknowledge', { note: text || undefined }, () => 'Acknowledged. Thank you.'); }}>
                <Field label="Note (optional)" name="note" error={error}><input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} /></Field><button type="submit" className="btn btn-primary" disabled={act.isPending}>I have read it</button></form>)}
            {d.allowed.distribute && (
              <form className="card form-grid" aria-label="Send to people" data-testid="dist-form" onSubmit={(e) => { e.preventDefault(); const recipients = [...dist.users.map((u) => ({ type: 'USER', id: u })), ...(dist.role ? [{ type: 'ROLE', id: dist.role.toUpperCase() }] : []), ...(dist.email ? [{ type: 'EXTERNAL', id: dist.email }] : [])]; run('distribute', { recipients, message: dist.message || undefined, dueDays: Number(dist.dueDays) || undefined }, (r) => `Sent to ${r.sent} recipient(s)${r.skipped ? `; ${r.skipped} had it already` : ''}.`); setDist({ ...dist, users: [], role: '', email: '' }); }}>
                <h3>Send revision {d.revision} and ask for an acknowledgement</h3>
                <div className="wf-inline">
                  <LookupField id="dist-user" label="A person" lookup="iam/users" valueKey="code" value="" onChange={() => {}} onPick={(row) => { if (row && !dist.users.includes(row.code)) setDist({ ...dist, users: [...dist.users, row.code] }); }} />
                  <Field label="Everyone with a role (code)" name="role" error={error}><input value={dist.role} maxLength={20} onChange={(e) => setDist({ ...dist, role: e.target.value })} /></Field>
                  <Field label="An outside party (e-mail)" name="email" error={error}><input type="email" value={dist.email} onChange={(e) => setDist({ ...dist, email: e.target.value })} /></Field>
                </div>
                {dist.users.length > 0 && <p>To: {dist.users.map((u) => <span key={u} className="chip">{u}<button type="button" className="btn btn-small" aria-label={`Remove ${u}`} onClick={() => setDist({ ...dist, users: dist.users.filter((x) => x !== u) })}>×</button></span>)}</p>}
                <div className="wf-inline"><Field label="Message" name="message" error={error}><input value={dist.message} maxLength={500} onChange={(e) => setDist({ ...dist, message: e.target.value })} /></Field><Field label="Acknowledge within (days)" name="dueDays" error={error}><input type="number" min="1" max="365" value={dist.dueDays} onChange={(e) => setDist({ ...dist, dueDays: e.target.value })} /></Field></div>
                <button type="submit" className="btn btn-primary" disabled={act.isPending || (!dist.users.length && !dist.role && !dist.email)}>Send</button>
              </form>)}
          </div>)}
        {tab === 'sharing' && (
          <div data-testid="doc-sharing">
            <p className="muted">Who may see this document is decided by their project and their level of trust. Here it can be shared beyond that, with a person, a role or an outside party, for a time.</p>
            {d.shares.length === 0 ? <p className="muted">It is not shared beyond the usual.</p> : <ul>{d.shares.map((s) => <li key={s.id}>{s.name} ({s.type.toLowerCase()}, {s.permission === 'EDIT' ? 'may work on it' : 'may look'}{s.expiresAt ? `, until ${formatDate(s.expiresAt)}` : ''}) {d.allowed.share && <button type="button" className="btn btn-small" aria-label={`Stop sharing with ${s.name}`} onClick={() => unshare.mutate({ id, shareId: s.id }, { onError: (e) => setError(errorInfo(e)) })}>Stop</button>}</li>)}</ul>}
            {d.allowed.share && (
              <form className="card wf-inline" aria-label="Share" onSubmit={(e) => { e.preventDefault(); setError(null); share.mutate({ id, type: sh.type, principal: sh.principal, permission: sh.permission, ...(sh.expiresAt ? { expiresAt: sh.expiresAt } : {}) }, { onSuccess: () => { setSh({ ...sh, principal: '' }); setNotice('Shared.'); }, onError: (er) => setError(errorInfo(er)) }); }}>
                <label className="field"><span>With</span><select value={sh.type} onChange={(e) => setSh({ ...sh, type: e.target.value, principal: '' })}><option value="USER">A person</option><option value="ROLE">A role</option><option value="EXTERNAL">An outside party</option></select></label>
                <Field label={sh.type === 'USER' ? 'Username' : sh.type === 'ROLE' ? 'Role code' : 'E-mail address'} name="principal" error={error}><input value={sh.principal} onChange={(e) => setSh({ ...sh, principal: e.target.value.trim() })} /></Field>
                <label className="field"><span>May</span><select value={sh.permission} onChange={(e) => setSh({ ...sh, permission: e.target.value })}><option value="VIEW">Look</option><option value="EDIT" disabled={sh.type === 'EXTERNAL'}>Work on it</option></select></label>
                <Field label="Until (needed for an outside party)" name="expiresAt" error={error}><input type="date" value={sh.expiresAt} onChange={(e) => setSh({ ...sh, expiresAt: e.target.value })} /></Field>
                <button type="submit" className="btn btn-primary" disabled={share.isPending || !sh.principal}>Share</button>
              </form>)}
          </div>)}
        {tab === 'related' && (
          <div data-testid="doc-related">
            {d.links.length === 0 ? <p className="muted">No record is linked to this document.</p> : <ul>{d.links.map((l) => <li key={`${l.entity}-${l.entityId}`}>{l.route ? <Link to={l.route}>{l.label ?? `${l.entity} ${l.entityId}`}</Link> : (l.label ?? `${l.entity} ${l.entityId}`)} <span className="muted small">{l.entity}</span></li>)}</ul>}
            <p className="muted small">Created {formatDateTime(d.createdAt)} by {d.createdBy}.{can(session, 'doc.document.manage') ? '' : ''}</p>
          </div>)}
        {tab === 'history' && (
          <div data-testid="doc-history">
            {history.isPending ? <Skeleton label="Loading the history" rows={2} /> : history.isError ? <p className="muted">The history is for those who may see the audit trail.</p> : (
              <ol>{(history.data ?? []).map((h, i) => <li key={i}><strong>{h.action}</strong> by {h.actor}, {formatDateTime(h.at ?? h.createdAt)}{h.reason ? `: ${h.reason}` : ''}</li>)}</ol>)}
          </div>)}
      </>}
    </section>
  );
}
