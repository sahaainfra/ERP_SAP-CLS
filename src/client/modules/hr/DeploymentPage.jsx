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

// Deployment (HR, part 07.03): one deployment. Header: number and revision, status, the person, project and site, the dates, primary or secondary, against the plan; actions for this status and person: send, correct, withdraw,
// cancel (an approved deployment is closed today and its access ends), amend (a new revision, approved again), print. Tabs: Details · Revisions (comparison) · Approvals · Timeline · Discussion.
const TABS = [['details', 'Details'], ['revisions', 'Revisions'], ['approvals', 'Approvals'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
const WHEN = { CURRENT: 'In force today', UPCOMING: 'Starts later', ENDED: 'Ended', OPEN: 'Not approved yet' };
export default function DeploymentPage() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['hr', 'dep', id], queryFn: () => deploy.get(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.person}` : 'Deployment');
  const [tab, setTab] = useState(() => sp.get('tab') ?? 'details');
  if (!id) return <ErrorState title="No deployment chosen" error={{ message: 'Open a deployment from Deployments.' }} />;
  if (q.error?.status === 403) return <NoPermission what="deployments" permission="hr.deployment.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the deployment" rows={6} />;
  const r = q.data;
  const [st, label] = REQ_STATUS[r.status] ?? ['DRAFT', r.statusLabel];
  return (
    <section aria-labelledby="dp-title" data-testid="deployment-page">
      <p><Link to="/hr/deployments">← Deployments</Link></p>
      {sp.get('sent') === '1' && <p className="mdm-banner" role="status" data-testid="dp-sent">Sent for approval: the project manager{r.band === 'OUTSIDE_PLAN' ? ', then the project director (outside the plan)' : ''}.</p>}
      <header className="op-header">
        <PageHeader id="dp-title" title={<>{r.docNo} · {r.person}</>} status={<StatusBadge status={st} label={label} />} actions={<>{r.revision > 1 && <span className="muted">revision {r.revision}</span>}</>} />
        <dl className="op-figures">
          <div><dt>Project</dt><dd>{r.project}</dd></div><div><dt>Site</dt><dd>{r.site ?? '—'}</dd></div><div><dt>Crew</dt><dd>{r.crew ?? '—'}</dd></div>
          <div><dt>From – to</dt><dd data-testid="dp-dates">{formatDate(r.fromDate)} – {r.toDate ? formatDate(r.toDate) : 'open'}</dd></div><div><dt>Posting</dt><dd>{r.isPrimary ? 'Primary' : 'Secondary'}</dd></div>
          <div><dt>Now</dt><dd data-testid="dp-when">{WHEN[r.when]}</dd></div><div><dt>Against the plan</dt><dd data-testid="dp-band">{r.band === 'OUTSIDE_PLAN' ? 'Outside the plan' : 'Within the plan'}</dd></div>
        </dl>
        <Actions r={r} />
      </header>
      <div role="tablist" aria-label="Deployment sections" className="op-tabs">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`dp-tab-${k}`} aria-selected={tab === k} aria-controls={`dp-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div role="tabpanel" id={`dp-panel-${tab}`} aria-labelledby={`dp-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'details' && <dl className="kv-list" data-testid="dp-details">{[['Person', `${r.person}${r.personCode ? ` (${r.personCode})` : ''}`], ['Designation', r.designation], ['Role on site', r.siteRole], ['Site access role', r.accessRole ? `${r.accessRole} at the ${r.siteId ? 'site' : 'project'}, while the deployment is in force` : 'None'],
          ['Default cost code', r.defaultCostCode ? `${r.defaultCostCode.code} ${r.defaultCostCode.name}` : null], ['Planned posts / deployed', r.plan?.planned != null ? `${r.plan.planned} / ${r.plan.deployed}` : null], ['Raised by', r.requestedBy ?? r.createdBy], ['Closed because', r.closedReason],
          ['From a transfer', r.transferId ? <Link to={`/hr/transfers/transfer?id=${r.transferId}`}>Open the transfer</Link> : null]].map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || '—'}</dd></div>)}</dl>}
        {tab === 'revisions' && <Revisions r={r} />}
        {tab === 'approvals' && <Approvals r={r} />}
        {tab === 'timeline' && <TimelineTab entity="hr_deployment" id={r.id} />}
        {tab === 'discussion' && <DiscussionTab entity="hr_deployment" id={r.id} />}
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
  const c = r.can;
  return (
    <div data-testid="dp-actions">
      <div className="actions-row">
        {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => deploy.submit(r.id), 'Sent for approval.')} data-testid="dp-submit">Send for approval</button>}
        {c.edit && <button type="button" className="btn" onClick={() => navigateTo(`/hr/deployments/new?id=${r.id}`)} data-testid="dp-edit">{r.status === 'RETURNED' ? 'Correct' : 'Edit'}</button>}
        {c.withdraw && <button type="button" className="btn" onClick={() => setMode('withdraw')} data-testid="dp-withdraw">Withdraw</button>}
        {c.cancel && <button type="button" className="btn" onClick={() => setMode('cancel')} data-testid="dp-cancel">{r.status === 'APPROVED' ? 'End now' : 'Cancel'}</button>}
        {c.delete && <button type="button" className="btn" onClick={() => { if (window.confirm('Delete this draft?')) run(() => deploy.remove(r.id), 'Deleted.').then(() => navigateTo('/hr/deployments')); }} data-testid="dp-delete">Delete draft</button>}
        {c.amend && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="dp-amend">Amend</button>}
        {c.print && <a className="btn" href={`/api/v1/hr/deployments/${r.id}/print`} target="_blank" rel="noreferrer" data-testid="dp-print">Print</a>}
      </div>
      {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); if (mode === 'amend') run(() => deploy.amend(r.id, reason), 'A new revision was created: change it and send it for approval.').then((o) => o && navigateTo(`/hr/deployments/new?id=${o.id}`, { force: true })); else run(() => (mode === 'withdraw' ? deploy.withdraw(r.id, reason) : deploy.cancel(r.id, reason)), mode === 'withdraw' ? 'Withdrawn.' : 'Done.'); }}>
        <Field label="Reason (required)" name="reason" error={error}><textarea rows="2" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="dp-reason" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="dp-reason-go">Confirm</button></div></form>}
      {note && <p role="status" className="mdm-banner" data-testid="dp-note">{note}</p>}
      {error?.form && !mode && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Revisions({ r }) {
  const q = useQuery({ queryKey: ['hr', 'dep', r.id, 'compare'], queryFn: () => deploy.compare(r.id), enabled: r.revision > 1, retry: false });
  if (r.revision <= 1) return <p className="muted">This is the first revision. An amendment of an approved deployment is a new revision, compared here with the one before.</p>;
  if (q.isPending) return <Skeleton label="Comparing" rows={2} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <div className="table-wrap" tabIndex={0} role="region" aria-label="Comparison"><table className="grid" data-testid="dp-compare"><thead><tr><th>Field</th><th>Revision {q.data.from.revision}</th><th>Revision {q.data.to.revision}</th></tr></thead><tbody>{q.data.rows.map((x) => <tr key={x.field} className={x.changed ? 'is-changed' : ''}><td>{x.label}{x.changed && <span className="sr-only"> (changed)</span>}</td><td>{String(x.before ?? '—')}</td><td>{String(x.after ?? '—')}</td></tr>)}</tbody></table></div>;
}

function Approvals({ r }) {
  const h = useQuery({ queryKey: ['hr', 'dep', r.id, 'history'], queryFn: async () => (await api.get(`/hr/deployments/${r.id}/history`)).data, retry: false });
  if (h.isPending) return <Skeleton label="Loading" rows={2} />;
  if (h.isError) return <ErrorState error={h.error} onRetry={h.refetch} />;
  if (!h.data.approvals.length) return <p className="muted">Nothing sent for approval yet.</p>;
  return <ol className="mdm-list" data-testid="dp-approvals">{h.data.approvals.map((a, i) => <li key={i}>{formatDateTime(a.at)} · {a.event} · {a.actor}{a.comment ? `: ${a.comment}` : ''}</li>)}</ol>;
}
