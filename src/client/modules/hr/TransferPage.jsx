import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { REQ_STATUS, deploy } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Transfer (HR, part 07.03): one transfer or secondment. Header: number and revision, status, the employee, from and to, the relieving and joining dates, travel and accommodation; actions for this status and person: send, correct,
// withdraw, cancel (undoes an approved transfer that has not taken effect), amend, print. Tabs: Details · Handover (the checklist the relieving manager ticks) · Revisions · Approvals · Timeline · Discussion.
const TABS = [['details', 'Details'], ['handover', 'Handover'], ['revisions', 'Revisions'], ['approvals', 'Approvals'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
const place = (p, s) => [p, s].filter(Boolean).join(' / ') || '—';
export default function TransferPage() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['hr', 'trf', id], queryFn: () => deploy.transfers.get(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.employee}` : 'Transfer');
  const [tab, setTab] = useState(() => sp.get('tab') ?? 'details');
  if (!id) return <ErrorState title="No transfer chosen" error={{ message: 'Open a transfer from Transfers.' }} />;
  if (q.error?.status === 403) return <NoPermission what="transfers" permission="hr.transfer.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the transfer" rows={6} />;
  const t = q.data;
  const [st, label] = REQ_STATUS[t.status] ?? ['DRAFT', t.statusLabel];
  return (
    <section aria-labelledby="tp-title" data-testid="transfer-page">
      <p><Link to="/hr/transfers">← Transfers</Link></p>
      {sp.get('sent') === '1' && <p className="mdm-banner" role="status" data-testid="tp-sent">Sent for approval: the current project manager{t.scope === 'CROSS_PROJECT' ? ', the receiving project manager' : ''} and the HR manager.</p>}
      <header className="op-header">
        <PageHeader id="tp-title" title={<>{t.docNo} · {t.employee}</>} status={<StatusBadge status={st} label={label} />} actions={<><span className="muted">{t.kindLabel}</span>{t.revision > 1 && <span className="muted">revision {t.revision}</span>}</>} />
        <dl className="op-figures">
          <div><dt>From</dt><dd>{place(t.fromProject, t.fromSite)}</dd></div><div><dt>To</dt><dd data-testid="tp-to">{place(t.toProject, t.toSite)}</dd></div>
          <div><dt>Relieving – joining</dt><dd data-testid="tp-dates">{formatDate(t.relieveDate)} – {formatDate(t.joinDate)}</dd></div>
          <div><dt>Travel / accommodation</dt><dd>{t.travelRequired ? 'Travel' : 'No travel'} / {t.accommodationRequired ? 'Accommodation' : 'No accommodation'}</dd></div>
          <div><dt>Handover</dt><dd data-testid="tp-handover-count">{t.handoverDone} of {t.handoverTotal}</dd></div>
        </dl>
        <Actions t={t} />
      </header>
      <div role="tablist" aria-label="Transfer sections" className="op-tabs">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`tp-tab-${k}`} aria-selected={tab === k} aria-controls={`tp-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div role="tabpanel" id={`tp-panel-${tab}`} aria-labelledby={`tp-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'details' && <dl className="kv-list" data-testid="tp-details">{[['Employee', `${t.employee} (${t.employeeCode})`], ['Crew there', t.toCrew], ['Role there', t.siteRole], ['Returns on', t.returnDate ? formatDate(t.returnDate) : null], ['Reason', t.reason], ['Crosses projects', t.scope === 'CROSS_PROJECT' ? 'Yes: the receiving project manager approves too' : 'No'],
          ['Raised by', t.requestedBy ?? t.createdBy], ['Closed because', t.closedReason]].map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || '—'}</dd></div>)}
          {t.deployments.length > 0 && <div><dt>Deployment given</dt><dd>{t.deployments.map((d) => <Link key={d.id} to={`/hr/deployments/deployment?id=${d.id}`}>{d.docNo}</Link>)}</dd></div>}</dl>}
        {tab === 'handover' && <Handover t={t} />}
        {tab === 'revisions' && <Revisions t={t} />}
        {tab === 'approvals' && <Approvals t={t} />}
        {tab === 'timeline' && <TimelineTab entity="hr_transfer" id={t.id} />}
        {tab === 'discussion' && <DiscussionTab entity="hr_transfer" id={t.id} />}
      </div>
    </section>
  );
}

function Handover({ t }) {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const tick = async (i) => { setError(null); try { await deploy.transfers.handover(t.id, [{ code: i.code, done: !i.done }]); qc.invalidateQueries({ queryKey: ['hr'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <div data-testid="tp-handover">
      {!t.can.handover && <p className="muted">The handover is ticked once the transfer is sent for approval, by the people who keep it.</p>}
      <ul className="mdm-list">{t.handover.map((i) => <li key={i.code}><label className="check"><input type="checkbox" checked={i.done} disabled={!t.can.handover} onChange={() => tick(i)} data-testid={`tp-item-${i.code}`} /> {i.title}</label>{i.done && <span className="muted small"> · {i.doneBy}, {formatDateTime(i.doneAt)}</span>}</li>)}</ul>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Actions({ t }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const run = async (fn, done) => { setError(null); try { const out = await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['hr'] }); setMode(null); setReason(''); return out; } catch (e) { setError(errorInfo(e)); return null; } };
  const c = t.can;
  return (
    <div data-testid="tp-actions">
      <div className="actions-row">
        {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => deploy.transfers.submit(t.id), 'Sent for approval.')} data-testid="tp-submit">Send for approval</button>}
        {c.edit && <button type="button" className="btn" onClick={() => navigateTo(`/hr/transfers/new?id=${t.id}`)} data-testid="tp-edit">{t.status === 'RETURNED' ? 'Correct' : 'Edit'}</button>}
        {c.withdraw && <button type="button" className="btn" onClick={() => setMode('withdraw')} data-testid="tp-withdraw">Withdraw</button>}
        {c.cancel && <button type="button" className="btn" onClick={() => setMode('cancel')} data-testid="tp-cancel">{t.status === 'APPROVED' ? 'Undo the transfer' : 'Cancel'}</button>}
        {c.delete && <button type="button" className="btn" onClick={() => { if (window.confirm('Delete this draft?')) run(() => deploy.transfers.remove(t.id), 'Deleted.').then(() => navigateTo('/hr/transfers')); }} data-testid="tp-delete">Delete draft</button>}
        {c.amend && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="tp-amend">Amend</button>}
        {c.print && <a className="btn" href={`/api/v1/hr/transfers/${t.id}/print`} target="_blank" rel="noreferrer" data-testid="tp-print">Print</a>}
      </div>
      {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); if (mode === 'amend') run(() => deploy.transfers.amend(t.id, reason), 'A new revision was created: change it and send it for approval.').then((o) => o && navigateTo(`/hr/transfers/new?id=${o.id}`, { force: true })); else run(() => (mode === 'withdraw' ? deploy.transfers.withdraw(t.id, reason) : deploy.transfers.cancel(t.id, reason)), mode === 'withdraw' ? 'Withdrawn.' : 'Done.'); }}>
        <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="tp-reason" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="tp-reason-go">Confirm</button></div></form>}
      {note && <p role="status" className="mdm-banner" data-testid="tp-note">{note}</p>}
      {error?.form && !mode && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Revisions({ t }) {
  const q = useQuery({ queryKey: ['hr', 'trf', t.id, 'compare'], queryFn: () => deploy.transfers.compare(t.id), enabled: t.revision > 1, retry: false });
  if (t.revision <= 1) return <p className="muted">This is the first revision. An amendment of an approved transfer that has not taken effect is a new revision, compared here with the one before.</p>;
  if (q.isPending) return <Skeleton label="Comparing" rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <div className="table-wrap" tabIndex={0} role="region" aria-label="Comparison"><table className="grid" data-testid="tp-compare"><thead><tr><th>Field</th><th>Revision {q.data.from.revision}</th><th>Revision {q.data.to.revision}</th></tr></thead><tbody>{q.data.rows.map((x) => <tr key={x.field} className={x.changed ? 'is-changed' : ''}><td>{x.label}{x.changed && <span className="sr-only"> (changed)</span>}</td><td>{String(x.before ?? '—')}</td><td>{String(x.after ?? '—')}</td></tr>)}</tbody></table></div>;
}

function Approvals({ t }) {
  const h = useQuery({ queryKey: ['hr', 'trf', t.id, 'history'], queryFn: async () => (await api.get(`/hr/transfers/${t.id}/history`)).data, retry: false });
  if (h.isPending) return <Skeleton label="Loading" rows={2} />;
  if (h.isError) return <ErrorState error={h.error} onRetry={h.refetch} />;
  if (!h.data.approvals.length) return <p className="muted">Nothing sent for approval yet.</p>;
  return <ol className="mdm-list" data-testid="tp-approvals">{h.data.approvals.map((a, i) => <li key={i}>{formatDateTime(a.at)} · {a.event} · {a.actor}{a.comment ? `: ${a.comment}` : ''}</li>)}</ol>;
}
