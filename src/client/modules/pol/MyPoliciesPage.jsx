import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { fetchFileUrl } from '../core/api/index.js';
import { errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { CATEGORIES, pol } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// My Policies (part 05.05, section 7.3, FR-07): the policies that apply to the person, what is waiting for their acknowledgement (with the due date), the ones they acknowledged, the earlier versions (read-only). Opening
// a policy records that it was read; a policy with a knowledge check is acknowledged by answering the questions and reaching the pass mark; a failed try can be repeated.
const ST = { TO_ACKNOWLEDGE: ['IN_REVIEW', 'To acknowledge'], OVERDUE: ['REJECTED', 'Overdue'], ACKNOWLEDGED: ['COMPLETED', 'Acknowledged'] };
const fromUrl = () => Number(new URLSearchParams(window.location.search).get('v')) || null;

function Reader({ versionId, onDone }) {
  const q = useQuery({ queryKey: ['pol', 'read', versionId], queryFn: () => pol.read(versionId), retry: false });
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { setAnswers([]); setResult(null); setError(null); }, [versionId]);
  if (q.isPending) return <Skeleton label="Opening the policy" rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  const quiz = d.version.quiz ?? [];
  const go = async () => { setError(null); try { const r = await pol.acknowledge(versionId, answers); setResult(r); onDone?.(); q.refetch(); } catch (e) { setError(errorInfo(e)); } };
  return (
    <article className="card" aria-labelledby="rd-title" data-testid="policy-reader">
      <h2 id="rd-title">{d.policy.policyNo} · {d.policy.title}</h2>
      <p className="muted small">Version {d.version.version} · {CATEGORIES.find(([k]) => k === d.policy.category)?.[1]} · owner {d.policy.owner}{d.version.effectiveFrom ? ` · effective ${formatDate(d.version.effectiveFrom)}` : ''}{d.readOnly ? ' · an earlier version, read-only' : ''}</p>
      {d.version.changeSummary && d.version.version > 1 && <p className="notice small">What changed: {d.version.changeSummary}</p>}
      <div className="policy-body" data-testid="reader-body" dangerouslySetInnerHTML={{ __html: d.version.bodyHtml }} />
      {d.version.attachments.length > 0 && <ul aria-label="Attachments">{d.version.attachments.map((a) => <li key={a.id}><button type="button" className="link-button" onClick={async () => { const l = await fetchFileUrl(a.id, {}); window.open(l.url, '_blank'); }}>{a.name}</button></li>)}</ul>}
      {d.mine?.acknowledgedAt && <p role="status" className="notice" data-testid="reader-done">You acknowledged this on {formatDateTime(d.mine.acknowledgedAt)}{d.mine.quizScore !== null ? ` (knowledge check ${d.mine.quizScore}%)` : ''}.</p>}
      {d.canAcknowledge && (
        <fieldset className="card" data-testid="reader-ack"><legend>{quiz.length ? `Knowledge check: pass mark ${d.version.passMark}%` : 'Acknowledge this policy'}</legend>
          {quiz.map((qz, k) => <div key={k} role="radiogroup" aria-label={qz.q} className="an-quiz"><p><strong>{k + 1}. {qz.q}</strong></p>{qz.options.map((o, i) => <label key={i} className="field field-inline"><span>{o}</span><input type="radio" name={`q${k}`} checked={answers[k] === i} onChange={() => { const n = [...answers]; n[k] = i; setAnswers(n); }} data-testid={`rd-q${k}-${i}`} /></label>)}</div>)}
          {result && !result.passed && <p className="field-error" role="alert" data-testid="reader-wrong">{result.right} of {result.of} right ({result.score}%); the pass mark is {result.passMark}%. Read the policy again and try once more.</p>}
          {error?.form && <p className="field-error" role="alert" data-testid="reader-error">{error.form}</p>}
          <button type="button" className="btn btn-primary btn-large" onClick={go} disabled={quiz.length > 0 && answers.filter((x) => x !== undefined).length < quiz.length} data-testid="reader-go">{quiz.length ? 'Check my answers and acknowledge' : 'I have read and understood this policy'}</button>
        </fieldset>
      )}
    </article>
  );
}

export default function MyPoliciesPage() {
  usePageTitle('My Policies');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['pol', 'my'], queryFn: pol.my, retry: false });
  const [tab, setTab] = useState('todo');
  const [sel, setSel] = useState(fromUrl);
  useEffect(() => { const g = () => setSel(fromUrl()); window.addEventListener('popstate', g); return () => window.removeEventListener('popstate', g); }, []);
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading your policies" rows={3} />;
  const d = q.data;
  const rows = tab === 'todo' ? d.rows.filter((r) => r.status !== 'ACKNOWLEDGED') : tab === 'done' ? d.rows.filter((r) => r.status === 'ACKNOWLEDGED') : tab === 'library' ? d.rows : d.history;
  const open = (id) => { window.history.pushState(null, '', `/collab/my-policies?v=${id}`); setSel(id); };
  return (
    <section aria-labelledby="mp-title" data-testid="my-policies">
      <PageHeader id="mp-title" title={"My Policies"} subtitle={<>{d.counts.toAcknowledge} to acknowledge{d.counts.overdue ? `, ${d.counts.overdue} overdue` : ''}, {d.counts.acknowledged} acknowledged.</>} />
      <div className="msg-filters" role="tablist" aria-label="My policies">
        {[['todo', `To acknowledge (${d.counts.toAcknowledge})`], ['done', `Acknowledged (${d.counts.acknowledged})`], ['library', 'Library'], ['history', `Earlier versions (${d.history.length})`]].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`lr-chip${tab === k ? ' is-on' : ''}`} onClick={() => setTab(k)} data-testid={`mp-tab-${k}`}>{l}</button>)}
      </div>
      {rows.length === 0 ? <EmptyState title={tab === 'todo' ? 'Nothing to acknowledge' : 'No policy here'} message={tab === 'todo' ? 'When a policy that applies to you is published, it waits here for your acknowledgement.' : 'Nothing to show.'} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Policies"><table className="grid"><thead><tr><th>Policy</th><th>Category</th><th>Version</th><th>Due</th><th>Status</th><th><span className="sr-only">Open</span></th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.versionId} className={r.status === 'OVERDUE' ? 'is-overdue' : sel === r.versionId ? 'is-selected' : ''} data-testid="mp-row"><th scope="row" data-label="Policy">{r.policyNo} · {r.title}</th><td data-label="Category">{CATEGORIES.find(([k]) => k === r.category)?.[1]}</td><td data-label="Version">{r.version}</td><td data-label="Due">{r.acknowledgedAt ? '—' : r.dueAt ? formatDate(r.dueAt) : '—'}</td>
            <td data-label="Status"><StatusBadge status={ST[r.status][0]} label={ST[r.status][1]} />{r.hasQuiz ? ' · quiz' : ''}</td><td><button type="button" className="btn btn-small btn-primary" onClick={() => open(r.versionId)} data-testid="mp-open">{r.status === 'ACKNOWLEDGED' || tab === 'history' ? 'Read' : 'Read and acknowledge'}</button></td></tr>)}</tbody></table></div>
      )}
      {sel && <Reader versionId={sel} onDone={() => qc.invalidateQueries({ queryKey: ['pol', 'my'] })} />}
    </section>
  );
}
