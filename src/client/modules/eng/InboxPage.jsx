import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ConfirmDialog } from '../../platform/feedback/Dialogs.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime, formatINR } from '../../platform/format.js';
import { useBulkAct, useInbox } from '../../platform/workflow/api.js';
import { useLiveRefresh } from '../../platform/realtime/socket.js';
import { Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Approvals (part 04.03, section 7.1): every task waiting for my decision, from every module, most urgent first, with the time left shown in words and colour.
// Filters with saved variants, free text, sort, pages, counts; approve several documents at once where the policy allows, each checked on its own.
export const SLA = { ON_TRACK: ['approved', 'On track'], DUE_SOON: ['returned', 'Due soon'], OVERDUE: ['rejected', 'Overdue'], ESCALATED: ['rejected', 'Escalated'] };
const PAGE = 25;
const unwrap = async (p) => (await p).data;
const EMPTY = { docType: '', projectId: '', sla: '', q: '', bulk: false, sort: 'urgency' };

function Variants({ filters, apply }) {
  const qc = useQueryClient();
  const views = useQuery({ queryKey: ['ui', 'saved-views', 'workflow.inbox'], queryFn: () => unwrap(api.get('/ui/saved-views?list=workflow.inbox')), retry: false });
  const save = useMutation({
    mutationFn: (name) => unwrap(api.post('/ui/saved-views', { list: 'workflow.inbox', name, isShared: false, isDefault: false, config: { columns: [], hidden: [], widths: {}, pageSize: 25, q: filters.q, sort: filters.sort, filters: Object.entries(filters).filter(([k, v]) => !['q', 'sort'].includes(k) && v !== '' && v !== false).map(([key, value]) => ({ key, op: 'eq', value: String(value) })) } }, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ui', 'saved-views', 'workflow.inbox'] }),
  });
  const remove = useMutation({ mutationFn: (v) => unwrap(api.delete(`/ui/saved-views/${v.id}`, {}, { version: v.version })), onSuccess: () => qc.invalidateQueries({ queryKey: ['ui', 'saved-views', 'workflow.inbox'] }) });
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState('');
  const list = views.data ?? [];
  const pick = (id) => {
    setChosen(id);
    const v = list.find((x) => String(x.id) === id);
    if (!v) return apply(EMPTY);
    const f = { ...EMPTY, q: v.config.q ?? '', sort: v.config.sort || 'urgency' };
    for (const c of v.config.filters) f[c.key] = c.key === 'bulk' ? c.value === 'true' : c.value;
    apply(f);
  };
  return (
    <div className="wf-inline" role="group" aria-label="Saved variants">
      <label className="field"><span>Saved variant</span><select value={chosen} onChange={(e) => pick(e.target.value)}><option value="">None</option>{list.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label className="field"><span>Name for this filter</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <button type="button" className="btn btn-small" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(name.trim(), { onSuccess: () => setName('') })}>Save variant</button>
      {chosen && <button type="button" className="btn btn-small" onClick={() => { remove.mutate(list.find((x) => String(x.id) === chosen)); setChosen(''); }}>Delete variant</button>}
    </div>
  );
}

export default function InboxPage() {
  usePageTitle('My Approvals');
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const query = useInbox({ ...filters, projectId: filters.projectId || undefined, bulk: filters.bulk ? 'true' : undefined, limit: PAGE, offset: (page - 1) * PAGE });
  const bulk = useBulkAct();
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); setPicked([]); };
  const data = query.data;
  // the tasks on screen follow their documents: a decision elsewhere removes or changes a row here
  useLiveRefresh([...new Set((data?.rows ?? []).map((r) => `record:workflow_instance:${r.instanceId}`))], [['workflow']]);
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const eligible = data?.rows.filter((r) => r.bulkEligible) ?? [];
  const toggle = (id) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  const run = async ({ reason }) => {
    const out = await bulk.mutateAsync({ taskIds: picked, action: 'approve', ...(reason ? { comment: reason } : {}) });
    setResult(out);
    setPicked([]);
    setConfirm(false);
  };
  return (
    <section aria-labelledby="ib-title" data-testid="inbox">
      <PageHeader id="ib-title" title={"My Approvals"} />
      {error && <p role="alert" className="error">{error.form}</p>}
      {query.isPending && <Skeleton label="Loading your approvals" rows={5} />}
      {query.isError && <ErrorState title="Your approvals could not be loaded" error={query.error} onRetry={() => query.refetch()} />}
      {data && (
        <>
          <ul className="srch-meta" aria-label="Counts" data-testid="ib-counts">
            <li><strong data-testid="ib-pending">{data.counts.pending}</strong> waiting for you</li><li><strong data-testid="ib-overdue">{data.counts.overdue}</strong> overdue</li><li><strong>{data.counts.dueSoon}</strong> due soon</li>
            <li><strong>{data.counts.bulkEligible}</strong> can be approved together</li><li><strong>{data.counts.delegated}</strong> on someone's behalf</li>
          </ul>
          {result && (
            <div className={result.refused ? 'state state-error' : 'notice'} role="status" data-testid="ib-result">
              <p>{result.approved} approved{result.refused ? `, ${result.refused} not approved` : ''}.</p>
              <ul className="lp-list">{result.results.filter((r) => !r.ok).map((r) => <li key={r.taskId}><strong>{r.docRef ?? `Task ${r.taskId}`}</strong>: {r.reason}</li>)}</ul>
            </div>
          )}
          <form className="srch-form" role="search" aria-label="Filter your approvals" onSubmit={(e) => e.preventDefault()}>
            <label className="field"><span>Document type</span><select value={filters.docType} onChange={(e) => set({ docType: e.target.value })}><option value="">All</option>{data.docTypes.map((t) => <option key={t.docType} value={t.docType}>{t.label}</option>)}</select></label>
            <label className="field"><span>Project</span><select value={filters.projectId} onChange={(e) => set({ projectId: e.target.value })}><option value="">All projects</option>{data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></label>
            <label className="field"><span>Time</span><select value={filters.sla} onChange={(e) => set({ sla: e.target.value })}><option value="">Any</option><option value="ON_TRACK">On track</option><option value="DUE_SOON">Due soon</option><option value="OVERDUE">Overdue or escalated</option></select></label>
            <label className="field"><span>Order</span><select value={filters.sort} onChange={(e) => set({ sort: e.target.value })}><option value="urgency">Most urgent first</option><option value="age">Oldest first</option><option value="amount">Largest first</option></select></label>
            <label className="field"><span>Words</span><input type="search" value={filters.q} onChange={(e) => set({ q: e.target.value })} /></label>
            <label className="check"><input type="checkbox" checked={filters.bulk} onChange={(e) => set({ bulk: e.target.checked })} /> Only those that can be approved together</label>
            {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => set(EMPTY)}>Clear filters</button>}
          </form>
          <Variants filters={filters} apply={(f) => { setFilters(f); setPage(1); setPicked([]); }} />
          <div className="srch-tools">
            <button type="button" className="btn btn-primary" disabled={picked.length === 0} onClick={() => { setError(null); setConfirm(true); }}>Approve {picked.length || ''} selected</button>
            <button type="button" className="btn" disabled={eligible.length === 0} onClick={() => setPicked(eligible.map((r) => r.taskId))}>Select every one that can be approved together</button>
            {picked.length > 0 && <button type="button" className="btn" onClick={() => setPicked([])}>Clear selection</button>}
          </div>
          {data.rows.length === 0 ? <EmptyState title={data.counts.pending === 0 ? 'Nothing is waiting for you' : 'No approval matches'} message={data.counts.pending === 0 ? 'When a document needs your decision it appears here, with the time you have.' : 'Change the filters above.'} action={data.counts.pending === 0 ? { label: 'See what you submitted', onClick: () => { window.history.pushState(null, '', '/approvals/submissions'); window.dispatchEvent(new PopStateEvent('popstate')); } } : { label: 'Clear filters', onClick: () => set(EMPTY) }} /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Approvals waiting">
              <table className="grid">
                <thead><tr><th><span className="sr-only">Select</span></th><th>Document</th><th>Project</th><th className="num">Amount</th><th>Raised by</th><th className="num">Age (h)</th><th>Time</th><th>Flags</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.taskId} data-testid={`ib-row-${r.taskId}`}>
                      <td><input type="checkbox" aria-label={`Select ${r.docRef ?? r.title}`} checked={picked.includes(r.taskId)} onChange={() => toggle(r.taskId)} title={r.bulkEligible ? '' : r.bulkReason ?? ''} /></td>
                      <th scope="row" data-label="Document"><Link to={`/approvals/task?id=${r.taskId}`}>{r.docRef ?? r.title}</Link><br /><span className="muted small">{r.docLabel}: {r.title} · {r.step}{r.onBehalfOf ? ` · for ${r.onBehalfOf}` : ''}{r.escalation ? ' · escalated to you' : ''}</span></th>
                      <td data-label="Project">{r.project ? `${r.project.code}` : ''}</td>
                      <td className="num" data-label="Amount">{r.amount == null ? '' : formatINR(r.amount)}</td>
                      <td data-label="Raised by">{r.submittedBy}</td><td className="num" data-label="Age (h)">{r.ageHours}</td>
                      <td data-label="Time"><StatusBadge status={SLA[r.sla][0]} label={SLA[r.sla][1]} /><br /><span className="muted small">{r.dueAt ? `due ${formatDateTime(r.dueAt)}` : ''}</span></td>
                      <td data-label="Flags">{r.flags.map((f) => f.label).join(', ') || (r.bulkEligible ? 'Can be approved together' : '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pager"><span>{data.total} approval(s), page {page} of {pages}</span>
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button></div>
          <p className="muted small"><Link to="/approvals/submissions">My Submissions &amp; Watch List</Link> shows what you raised and what you follow. <Link to="/field/approvals">The phone view</Link> is made for one-tap decisions.</p>
        </>
      )}
      <ConfirmDialog open={confirm} title={`Approve ${picked.length} document(s)?`} text="Each document is checked on its own against the policy for its type. Any that does not qualify is left for you to decide separately, and you will be told why." confirmLabel="Approve" commentOptional
        onConfirm={(v) => run(v ?? {}).catch((e) => { setConfirm(false); setError(errorInfo(e)); })} onCancel={() => setConfirm(false)} />
    </section>
  );
}
