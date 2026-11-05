import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { authHeaders } from '../../platform/api/index.js';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CATEGORIES, STATUS, pol } from './api.js';

// Policy Register and the policy page (part 05.05, section 7.1): every policy with its category, owner, version, status, effective and review dates and the acknowledgement percentage; opening one shows its versions,
// who it applies to, who has acknowledged it, the requirements tagged for controls, and the actions of its owner (edit the draft, start a revision, compare versions, archive).
const fromUrl = () => Number(new URLSearchParams(window.location.search).get('id')) || null;
const REVIEW = { overdue: ['REJECTED', 'Review overdue'], due: ['IN_REVIEW', 'Review due soon'] };
const scopeText = (a = {}) => (a.all ? 'Everyone' : [a.departments?.length && `${a.departments.length} department(s)`, a.roles?.length && `roles ${a.roles.join(', ')}`, a.sites?.length && `${a.sites.length} site(s)`, a.projects?.length && `${a.projects.length} project(s)`].filter(Boolean).join('; ') || 'Not set');

function Detail({ id, onChanged }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pol', 'policy', id], queryFn: () => pol.get(id), retry: false });
  const [versionId, setVersionId] = useState(null);
  const acks = useQuery({ queryKey: ['pol', 'acks', id, versionId], queryFn: () => pol.acks(id, versionId ? { versionId } : {}), enabled: Boolean(q.data?.current), retry: false });
  const [cmp, setCmp] = useState({ from: '', to: '' });
  const diff = useQuery({ queryKey: ['pol', 'compare', id, cmp.from, cmp.to], queryFn: () => pol.compare(id, cmp.from, cmp.to), enabled: Boolean(cmp.from && cmp.to && cmp.from !== cmp.to), retry: false });
  const [error, setError] = useState(null);
  if (q.isPending) return <Skeleton label="Loading the policy" rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data;
  const run = async (fn) => { setError(null); try { await fn(); qc.invalidateQueries({ queryKey: ['pol'] }); onChanged?.(); } catch (e) { setError(errorInfo(e)); } };
  const exportCsv = async () => { const res = await fetch(`/api/v1/pol/policies/${id}/acknowledgements/export${versionId ? `?versionId=${versionId}` : ''}`, { headers: authHeaders() }); const url = URL.createObjectURL(await res.blob()); Object.assign(document.createElement('a'), { href: url, download: 'policy-acknowledgements.csv' }).click(); URL.revokeObjectURL(url); };
  return (
    <article className="card" aria-labelledby="pd-title" data-testid="policy-detail">
      <h2 id="pd-title">{p.policyNo} · {p.title}</h2>
      <p className="muted small">{CATEGORIES.find(([k]) => k === p.category)?.[1]} · owner {p.owner.name}{p.department ? ` · ${p.department}` : ''} · <StatusBadge status={STATUS[p.status]?.[0] ?? 'DRAFT'} label={STATUS[p.status]?.[1] ?? p.status} /> {p.reviewState && <StatusBadge status={REVIEW[p.reviewState][0]} label={REVIEW[p.reviewState][1]} />}</p>
      <p>Applies to: {scopeText(p.applicability)}. Effective {p.effectiveFrom ? formatDate(p.effectiveFrom) : '—'}, review by {p.reviewDue ? formatDate(p.reviewDue) : '—'}.</p>
      {error?.form && <p className="field-error" role="alert" data-testid="pd-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
      <div className="actions">
        {p.can.edit && <button type="button" className="btn btn-primary" onClick={() => navigateTo(`/collab/policies/edit?id=${p.id}`)} data-testid="pd-edit">Edit the draft</button>}
        {p.can.revise && <button type="button" className="btn btn-primary" onClick={() => run(async () => { await pol.revise(p.id); navigateTo(`/collab/policies/edit?id=${p.id}`); })} data-testid="pd-revise">Start a new version</button>}
        {p.can.archive && <button type="button" className="btn" onClick={() => { const why = window.prompt('Why is this policy being archived?') ?? ''; if (why.trim().length >= 5) run(() => pol.archive(p.id, why.trim())); }} data-testid="pd-archive">Archive</button>}
        {p.can.tag && p.status !== 'ARCHIVED' && <button type="button" className="btn" onClick={() => navigateTo(`/collab/policies/edit?id=${p.id}&tab=requirements`)} data-testid="pd-requirements">Requirements for controls ({p.requirements})</button>}
      </div>
      <h3>Versions</h3>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Versions"><table className="grid"><thead><tr><th>Version</th><th>Status</th><th>Effective</th><th>Recipients</th><th>Acknowledged</th><th>What changed</th></tr></thead>
        <tbody>{p.versions.map((v) => <tr key={v.id} data-testid="pd-version"><th scope="row" data-label="Version"><button type="button" className="link-button" onClick={() => setVersionId(v.id)}>{v.version}</button></th><td data-label="Status"><StatusBadge status={STATUS[v.status]?.[0] ?? 'DRAFT'} label={STATUS[v.status]?.[1] ?? v.status} /></td><td data-label="Effective">{v.effectiveFrom ? formatDate(v.effectiveFrom) : '—'}</td>
          <td data-label="Recipients">{v.stats?.recipients ?? '—'}</td><td data-label="Acknowledged">{v.stats ? <><span className="cc-bar" role="img" aria-label={`${v.stats.percent} percent`}><i style={{ width: `${v.stats.percent}%` }} /></span> {v.stats.acknowledged} ({v.stats.percent}%)</> : '—'}</td><td data-label="What changed">{v.changeSummary || (v.version === 1 ? 'First version' : '—')}</td></tr>)}</tbody></table></div>
      {p.versions.length > 1 && (
        <section aria-label="Compare two versions" data-testid="pd-compare"><h3>Compare versions</h3>
          <div className="srch-form"><Field label="From" name="from" error={null}><select value={cmp.from} onChange={(e) => setCmp({ ...cmp, from: e.target.value })} data-testid="cmp-from"><option value="">Choose</option>{p.versions.map((v) => <option key={v.id} value={v.id}>Version {v.version}</option>)}</select></Field>
            <Field label="To" name="to" error={null}><select value={cmp.to} onChange={(e) => setCmp({ ...cmp, to: e.target.value })} data-testid="cmp-to"><option value="">Choose</option>{p.versions.map((v) => <option key={v.id} value={v.id}>Version {v.version}</option>)}</select></Field></div>
          {diff.data && <Diff d={diff.data} />}
        </section>
      )}
      {p.current && ['PUBLISHED', 'ACTIVE', 'SUPERSEDED'].includes((p.versions.find((v) => v.id === (versionId ?? p.current.id)) ?? p.current).status) && acks.data && (
        <section aria-label="Acknowledgements" data-testid="pd-acks"><h3>Acknowledgements, version {acks.data.version}: {acks.data.stats.acknowledged} of {acks.data.stats.recipients} ({acks.data.stats.percent}%){acks.data.stats.overdue ? `, ${acks.data.stats.overdue} overdue` : ''}</h3>
          <div className="actions"><button type="button" className="btn" onClick={exportCsv} data-testid="pd-export">Export CSV</button></div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Who acknowledged"><table className="grid"><thead><tr><th>Person</th><th>Status</th><th>Due</th><th>Acknowledged</th><th>Quiz</th><th>Reminders</th></tr></thead>
            <tbody>{acks.data.rows.map((r) => <tr key={r.username} className={r.status === 'OVERDUE' ? 'is-overdue' : ''} data-testid="pd-ack-row"><th scope="row" data-label="Person">{r.name}</th><td data-label="Status">{r.status === 'ACKNOWLEDGED' ? 'Acknowledged' : r.status === 'OVERDUE' ? 'Overdue' : 'Pending'}</td><td data-label="Due">{r.dueAt ? formatDate(r.dueAt) : '—'}</td><td data-label="Acknowledged">{r.acknowledgedAt ? formatDateTime(r.acknowledgedAt) : '—'}</td><td data-label="Quiz">{r.quizScore !== null ? `${r.quizScore}% (${r.attempts} tries)` : '—'}</td><td data-label="Reminders">{r.reminders}{r.escalatedAt ? ' · escalated' : ''}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </article>
  );
}

export function Diff({ d }) {
  return (
    <div className="diff" data-testid="diff" aria-label={`Version ${d.from.version} compared with version ${d.to.version}`}>
      <p className="muted small">{d.summary.changed} changed, {d.summary.added} added, {d.summary.removed} removed, {d.summary.same} unchanged.</p>
      {d.rows.map((r, i) => r.type === 'same' ? <p key={i} className="diff-same">{r.text}</p> : r.type === 'add' ? <p key={i} className="diff-add" data-testid="diff-add"><span className="sr-only">Added: </span>{r.text}</p> : r.type === 'del' ? <p key={i} className="diff-del" data-testid="diff-del"><span className="sr-only">Removed: </span>{r.text}</p>
        : <p key={i} className="diff-change" data-testid="diff-change"><span className="sr-only">Changed: </span>{r.words.map((w, k) => (w.t === 'same' ? <span key={k}>{w.text} </span> : w.t === 'add' ? <ins key={k}>{w.text} </ins> : <del key={k}>{w.text} </del>))}</p>)}
    </div>
  );
}

export default function PolicyRegisterPage() {
  usePageTitle('Policy Register');
  const [f, setF] = useState({ q: '', category: '', status: '', review: '', limit: 25, offset: 0 });
  const [sel, setSel] = useState(fromUrl);
  const q = useQuery({ queryKey: ['pol', 'register', f], queryFn: () => pol.list(f), retry: false, placeholderData: (p) => p });
  useEffect(() => { const g = () => setSel(fromUrl()); window.addEventListener('popstate', g); return () => window.removeEventListener('popstate', g); }, []);
  if (q.error?.status === 403) return <NoPermission what="the policy register" permission="pol.policy.view_all" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the register" rows={4} />;
  const d = q.data;
  const set = (p) => setF({ ...f, offset: 0, ...p });
  const choose = (id) => { window.history.pushState(null, '', `/collab/policies?id=${id}`); setSel(id); };
  return (
    <section aria-labelledby="pr-title" data-testid="policy-register">
      <div className="page-head"><h1 id="pr-title">Policy Register</h1>{d.canCreate && <button type="button" className="btn btn-primary" onClick={() => navigateTo('/collab/policies/edit')} data-testid="pr-new">New policy</button>}</div>
      <form className="srch-form" role="search" aria-label="Filter the register" onSubmit={(e) => e.preventDefault()}>
        <Field label="Search" name="q" error={null}><input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} data-testid="pr-q" /></Field>
        <Field label="Category" name="category" error={null}><select value={f.category} onChange={(e) => set({ category: e.target.value })} data-testid="pr-category"><option value="">All</option>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Status" name="status" error={null}><select value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid="pr-status"><option value="">All</option>{['DRAFT', 'PUBLISHED', 'ACTIVE', 'UNDER_REVISION', 'ARCHIVED'].map((s) => <option key={s} value={s}>{STATUS[s][1]} ({d.counts[s] ?? 0})</option>)}</select></Field>
        <Field label="Review" name="review" error={null}><select value={f.review} onChange={(e) => set({ review: e.target.value })}><option value="">Any</option><option value="due">Due soon or overdue</option><option value="overdue">Overdue</option></select></Field>
        <Field label="Rows" name="limit" error={null}><select value={f.limit} onChange={(e) => set({ limit: Number(e.target.value) })}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
      </form>
      {d.rows.length === 0 ? <EmptyState title="No policy matches" message="Write the first policy, or change the filters." action={d.canCreate ? <button type="button" className="btn btn-primary" onClick={() => navigateTo('/collab/policies/edit')}>New policy</button> : undefined} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Policies"><table className="grid"><thead><tr><th>No</th><th>Title</th><th>Category</th><th>Owner</th><th>Version</th><th>Status</th><th>Effective</th><th>Review by</th><th>Acknowledged</th><th>Requirements</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id} className={sel === r.id ? 'is-selected' : ''} data-testid="pr-row">
              <th scope="row" data-label="No">{r.policyNo}</th>
              <td data-label="Title"><button type="button" className="link-button" onClick={() => choose(r.id)} data-testid="pr-open">{r.title}</button></td>
              <td data-label="Category">{CATEGORIES.find(([k]) => k === r.category)?.[1]}</td><td data-label="Owner">{r.owner.name}</td><td data-label="Version">{r.currentVersion ?? '—'}</td>
              <td data-label="Status"><StatusBadge status={STATUS[r.status]?.[0] ?? 'DRAFT'} label={STATUS[r.status]?.[1] ?? r.status} /></td>
              <td data-label="Effective">{r.effectiveFrom ? formatDate(r.effectiveFrom) : '—'}</td>
              <td data-label="Review by">{r.reviewDue ? formatDate(r.reviewDue) : '—'} {r.reviewState && <StatusBadge status={REVIEW[r.reviewState][0]} label={REVIEW[r.reviewState][1]} />}</td>
              <td data-label="Acknowledged">{r.stats ? <><span className="cc-bar" role="img" aria-label={`${r.stats.percent} percent`}><i style={{ width: `${r.stats.percent}%` }} /></span> {r.stats.percent}% of {r.stats.recipients}</> : '—'}</td>
              <td data-label="Requirements">{r.requirements}</td>
            </tr>))}</tbody></table></div>
      )}
      <div className="actions"><button type="button" className="btn" disabled={f.offset === 0} onClick={() => setF({ ...f, offset: Math.max(0, f.offset - f.limit) })}>Previous</button><span className="muted small" role="status">{d.total === 0 ? 0 : f.offset + 1}–{Math.min(d.total, f.offset + f.limit)} of {d.total}</span><button type="button" className="btn" disabled={f.offset + f.limit >= d.total} onClick={() => setF({ ...f, offset: f.offset + f.limit })}>Next</button></div>
      {sel && <Detail id={sel} onChanged={q.refetch} />}
    </section>
  );
}
