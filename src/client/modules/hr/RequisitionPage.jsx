import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { REQ_STATUS, STAGES, recruit, rupees } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Requisition (HR, part 07.02): one manpower requisition. Header: number and revision, status, positions and how many joined, the CTC range, against the plan; actions for this status and person: send, correct, withdraw,
// cancel or close, amend (a new revision, approved again), print. Tabs: Details · Plan check · Candidates (counts by stage, opens the pipeline) · Revisions (comparison) · Approvals · Timeline · Discussion.
const TABS = [['details', 'Details'], ['candidates', 'Candidates'], ['revisions', 'Revisions'], ['approvals', 'Approvals'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
export default function RequisitionPage() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['hr', 'req', id], queryFn: () => recruit.req(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.designation ?? ''}` : 'Requisition');
  const [tab, setTab] = useState(() => sp.get('tab') ?? 'details');
  if (!id) return <ErrorState title="No requisition chosen" error={{ message: 'Open a requisition from Manpower Requisitions.' }} />;
  if (q.error?.status === 403) return <NoPermission what="requisitions" permission="hr.requisition.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the requisition" rows={6} />;
  const r = q.data;
  const [st, label] = REQ_STATUS[r.status];
  return (
    <section aria-labelledby="rp-title" data-testid="requisition-page">
      <p><Link to="/hr/requisitions">← Manpower Requisitions</Link></p>
      {sp.get('sent') === '1' && <p className="mdm-banner" role="status" data-testid="rp-sent">Sent for approval: the department or project head, then the HR manager{r.band === 'BEYOND_PLAN' ? ', then the director (beyond the plan)' : ''}.</p>}
      <header className="op-header">
        <PageHeader id="rp-title" title={<>{r.docNo} · {r.designation}</>} status={<StatusBadge status={st} label={label} />} actions={<>{r.revision > 1 && <span className="muted">revision {r.revision}</span>}</>} />
        <dl className="op-figures">
          <div><dt>Department</dt><dd>{r.department}</dd></div><div><dt>Positions</dt><dd data-testid="rp-positions">{r.positions} ({r.joined} joined, {r.open} open)</dd></div><div><dt>Reason</dt><dd>{r.reason === 'NEW' ? 'New position' : 'Replacement'}</dd></div>
          {r.ctcMin && <div><dt>CTC a year</dt><dd>{rupees(r.ctcMin)} to {rupees(r.ctcMax)}</dd></div>}<div><dt>Required by</dt><dd>{formatDate(r.requiredBy)}</dd></div>
          <div><dt>Against the plan</dt><dd data-testid="rp-band">{r.band === 'BEYOND_PLAN' ? 'Beyond the plan' : 'Within the plan'}</dd></div>
        </dl>
        <Actions r={r} />
      </header>
      <div role="tablist" aria-label="Requisition sections" className="op-tabs">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`rp-tab-${k}`} aria-selected={tab === k} aria-controls={`rp-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)} data-testid={`rp-tab-${k}`}>{l}</button>)}</div>
      <div role="tabpanel" id={`rp-panel-${tab}`} aria-labelledby={`rp-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'details' && <dl className="kv-list" data-testid="rp-details">{[['Department', r.department], ['Designation', r.designation], ['Project', r.project], ['Employment type', r.employmentType], ['Work location', r.locationType === 'SITE' ? 'Site' : 'Head office'], ['Reports to', r.manager ? `${r.manager.emp_code} ${r.manager.full_name}` : null], ['Raised by', r.requestedBy], ['Why', r.justification],
          ['Plan at submission', r.plan?.planned != null || r.plan?.hasPlan === false ? `planned ${r.plan.hasPlan ? r.plan.planned : 'none'} · in post ${r.plan.filled} · open ${r.plan.open}` : null]].map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || '—'}</dd></div>)}</dl>}
        {tab === 'candidates' && <div data-testid="rp-candidates"><ul className="mdm-list">{STAGES.map(([k, l]) => <li key={k}>{l}: <strong>{r.candidates[k] ?? 0}</strong></li>)}</ul><p><Link to={`/hr/recruitment?requisitionId=${r.id}`}>Open the pipeline of this requisition</Link></p></div>}
        {tab === 'revisions' && <Revisions r={r} />}
        {tab === 'approvals' && <Approvals r={r} />}
        {tab === 'timeline' && <TimelineTab entity="hr_requisition" id={r.id} />}
        {tab === 'discussion' && <DiscussionTab entity="hr_requisition" id={r.id} />}
      </div>
    </section>
  );
}

function Actions({ r }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const run = async (fn, done) => { setError(null); try { const out = await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['hr'] }); setMode(null); setReason(''); return out; } catch (e) { setError(errorInfo(e)); return null; } };
  return (
    <div data-testid="rp-actions">
      <div className="actions-row">
        {r.canSubmit && <button type="button" className="btn btn-primary" onClick={() => run(() => recruit.reqSubmit(r.id), 'Sent for approval.')} data-testid="rp-submit">Send for approval</button>}
        {r.canEdit && <button type="button" className="btn" onClick={() => navigateTo(`/hr/requisitions/new?id=${r.id}`)} data-testid="rp-edit">{r.status === 'RETURNED' ? 'Correct' : 'Edit'}</button>}
        {r.canWithdraw && <button type="button" className="btn" onClick={() => setMode('withdraw')} data-testid="rp-withdraw">Withdraw</button>}
        {r.canCancel && <button type="button" className="btn" onClick={() => setMode('cancel')} data-testid="rp-cancel">{r.status === 'APPROVED' ? 'Close' : 'Cancel'}</button>}
        {r.canDelete && <button type="button" className="btn" onClick={() => { if (window.confirm('Delete this draft?')) run(() => recruit.reqRemove(r.id), 'Deleted.').then(() => navigateTo('/hr/requisitions')); }} data-testid="rp-delete">Delete draft</button>}
        {r.canAmend && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="rp-amend">Amend</button>}
        {r.status === 'APPROVED' && <a className="btn" href={`/hr/recruitment?requisitionId=${r.id}`} data-testid="rp-pipeline">Pipeline</a>}
        {r.canPrint && <a className="btn" href={`/api/v1/hr/requisitions/${r.id}/print`} target="_blank" rel="noreferrer" data-testid="rp-print">Print</a>}
      </div>
      {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); if (mode === 'amend') run(() => recruit.reqAmend(r.id, reason), 'A new revision was created: change it and send it for approval.').then((o) => o && navigateTo(`/hr/requisitions/new?id=${o.id}`, { force: true })); else run(() => (mode === 'withdraw' ? recruit.reqWithdraw(r.id, reason) : recruit.reqCancel(r.id, reason)), 'Done.'); }}>
        <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="rp-reason" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="rp-reason-go">Confirm</button></div></form>}
      {note && <p role="status" className="mdm-banner" data-testid="rp-note">{note}</p>}
      {error?.form && !mode && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Revisions({ r }) {
  const q = useQuery({ queryKey: ['hr', 'req', r.id, 'compare'], queryFn: () => recruit.reqCompare(r.id), enabled: r.revision > 1, retry: false });
  if (r.revision <= 1) return <p className="muted">This is the first revision. An amendment of an approved requisition is a new revision, compared here with the one before.</p>;
  if (q.isPending) return <Skeleton label="Comparing" rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <div className="table-wrap" tabIndex={0} role="region" aria-label="Comparison"><table className="grid" data-testid="rp-compare"><thead><tr><th>Field</th><th>Revision {q.data.from.revision}</th><th>Revision {q.data.to.revision}</th></tr></thead><tbody>{q.data.rows.map((x) => <tr key={x.field} className={x.changed ? 'is-soon' : ''}><th scope="row">{x.field}</th><td>{String(x.from ?? '—')}</td><td>{String(x.to ?? '—')}</td></tr>)}</tbody></table></div>;
}

function Approvals({ r }) {
  const h = useQuery({ queryKey: ['hr', 'req', r.id, 'history'], queryFn: async () => (await api.get(`/hr/requisitions/${r.id}/history`)).data, retry: false });
  if (h.isPending) return <Skeleton label="Loading" rows={2} />;
  if (h.isError) return <ErrorState error={h.error} onRetry={h.refetch} />;
  if (!h.data.approvals.length) return <p className="muted">Nothing sent for approval yet.</p>;
  return <ol className="mdm-list" data-testid="rp-approvals">{h.data.approvals.map((a, i) => <li key={i}>{formatDateTime(a.at)} · {a.event} · {a.actor}{a.comment ? `: ${a.comment}` : ''}</li>)}</ol>;
}
