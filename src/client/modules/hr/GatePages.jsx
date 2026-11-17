import { useEffect, useState } from 'react';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import { Banner } from '../../platform/feedback/Feedback.jsx';
import DashboardView from '../../platform/dashboard/DashboardView.jsx';
import { QueryState, errorInfo, navigateTo } from '../core/pages/ui.jsx';
import { openFile, useGate, useGates, useReviewCriterion, useSubmitGate } from './gatesApi.js';

// Part 07.14 (built in 166.6): the workforce dashboard (cards of the 166.5 framework) and the gates G1–G4: a list of the gates and an object page
// per gate with its criteria, their evidence, status, reviewer and date, the sign-off and the report.

const title = (t) => { if (typeof document !== 'undefined') document.title = `${t} - ERP`; };
const go = (to) => (e) => { e.preventDefault(); navigateTo(to); };
const STATUS_WORD = { OPEN: 'Open', SUBMITTED: 'With the reviewers', PASSED: 'Passed', RETURNED: 'Returned', MET: 'Met', NOT_MET: 'Not met' };
const STATUS_TONE = { OPEN: 'DRAFT', SUBMITTED: 'SUBMITTED', PASSED: 'APPROVED', RETURNED: 'RETURNED', MET: 'APPROVED', NOT_MET: 'REJECTED' };
const badge = (s, variant) => <StatusBadge status={STATUS_TONE[s]} label={STATUS_WORD[s]} variant={variant} />;
// the server's own words (a reason is required, the gate is locked): there are no form fields here to highlight
const say = (e) => { const i = errorInfo(e); return `${e?.message ?? i.form}${i.correlationId ? ` (Correlation ID ${i.correlationId})` : ''}`; };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).replace(/ /g, '-') : '—');

/** The workforce dashboard: the cards of the person's role on the overview framework (the site cards first, so a phone shows them first). */
export function WorkforcePage() {
  useEffect(() => title('Workforce Dashboard'), []);
  return (
    <div data-testid="workforce">
      <DashboardView code="ov-workforce" heading="Workforce Dashboard" intro="Attendance today, contract labour on site, headcount, overtime, leave liability, attrition, HR approvals and documents that expire. Each card reads its HR service and opens the list behind it." />
    </div>
  );
}

/** The gates: each with its status and how many of its criteria are met. */
export function GatesPage() {
  useEffect(() => title('Programme Gates'), []);
  const q = useGates();
  return (
    <section aria-labelledby="gates-h" data-testid="gates">
      <PageHeader id="gates-h" title="Programme Gates" subtitle="Each gate closes a phase of the programme once every criterion is met with evidence and the technical lead and the director have signed it." />
      <QueryState query={q} what="the gates" />
      {q.data && (
        <>
          <p className="muted small" data-testid="gates-derived">The criteria are derived from the parts of each gate in the progress register, their completion reports and discovery notes, and the defect register.</p>
          <ul className="gate-list">
            {q.data.map((g) => (
              <li key={g.code} className="ui-card" data-testid={`gate-${g.code}`}>
                <div className="ui-card-head"><h2><a href={`/admin/gate?code=${g.code}`} onClick={go(`/admin/gate?code=${g.code}`)}>{g.code} {g.name}</a></h2>{badge(g.status)}</div>
                <div className="ui-card-body">
                  <p><strong>{g.counts.met}</strong> of {g.counts.total} criteria met{g.counts.notMet ? `, ${g.counts.notMet} not met` : ''}{g.counts.open ? `, ${g.counts.open} open` : ''}.</p>
                  <progress max={g.counts.total} value={g.counts.met} aria-label={`${g.code}: ${g.counts.met} of ${g.counts.total} criteria met`} />
                  {g.passedAt && <p className="muted small">Passed on {day(g.passedAt)}.</p>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function Criterion({ c, canReview, review }) {
  const [note, setNote] = useState(c.note ?? '');
  const [error, setError] = useState(null);
  const [opening, setOpening] = useState(null);
  const set = (status) => {
    setError(null);
    review.mutate({ criterion: c.code, status, note: note.trim() || undefined, version: c.version }, { onError: (e) => setError(say(e)) });
  };
  const open = async (e) => { setOpening(e.path); try { await openFile(e.href.replace(/^\/api\/v1/, '')); } catch (err) { setError(err.message); } finally { setOpening(null); } };
  return (
    <li className="gate-criterion" data-testid={`criterion-${c.code}`} data-status={c.status}>
      <div className="gate-criterion-head">
        <strong>{c.code}</strong> {badge(c.status, 'outline')}
        <span className="gate-criterion-title">{c.title}</span>
      </div>
      <ul className="gate-evidence small" aria-label={`Evidence of ${c.code}`}>
        {c.evidence.map((e) => (
          <li key={e.path}>
            {e.resolves
              ? <button type="button" className="btn btn-small" onClick={() => open(e)} disabled={opening === e.path} data-testid="evidence-open">{e.label}</button>
              : <span className="field-error">{e.label}: missing ({e.path})</span>}
          </li>
        ))}
      </ul>
      <p className="muted small">{c.reviewedBy ? `Reviewed by ${c.reviewedBy} on ${day(c.reviewedAt)}` : 'Not reviewed yet'}{c.note ? `: ${c.note}` : ''}</p>
      {canReview && (
        <div className="gate-review">
          <label className="small">Note<input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder={c.status === 'NOT_MET' ? 'Why it is not met' : ''} /></label>
          <span className="gate-review-actions">
            <button type="button" className="btn btn-small btn-primary" disabled={review.isPending || c.status === 'MET'} onClick={() => set('MET')}>Met</button>
            <button type="button" className="btn btn-small" disabled={review.isPending || c.status === 'NOT_MET'} onClick={() => set('NOT_MET')}>Not met</button>
            {c.status !== 'OPEN' && <button type="button" className="btn btn-small" disabled={review.isPending} onClick={() => set('OPEN')}>Back to open</button>}
          </span>
        </div>
      )}
      {error && <p className="field-error small" role="alert">{error}</p>}
    </li>
  );
}

/** One gate: the header with its status and counts, sign-off and report, then its criteria with their evidence. */
export function GatePage() {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const code = (params.get('code') ?? '').toUpperCase();
  const q = useGate(/^G[1-4]$/.test(code) ? code : null);
  const review = useReviewCriterion(code);
  const submit = useSubmitGate(code);
  const [message, setMessage] = useState(null);
  const [filter, setFilter] = useState('ALL');
  useEffect(() => title(q.data ? `${q.data.code} ${q.data.name}` : 'Gate'), [q.data]);
  if (!/^G[1-4]$/.test(code)) return <section aria-labelledby="gate-h"><PageHeader id="gate-h" title="Gate" subtitle="Open a gate from the list of programme gates." meta={<a href="/admin/gates" onClick={go('/admin/gates')}>Programme Gates</a>} /></section>;
  if (!q.data) return <section aria-labelledby="gate-h"><PageHeader id="gate-h" title={`Gate ${code}`} /><QueryState query={q} what={`gate ${code}`} /></section>;
  const g = q.data;
  const allMet = g.counts.met === g.counts.total;
  const send = () => { setMessage(null); submit.mutate({}, { onSuccess: () => setMessage({ tone: 'success', text: `${g.code} is with the technical lead and then the director for sign-off.` }), onError: (e) => setMessage({ tone: 'error', text: say(e) }) }); };
  const report = async () => { setMessage(null); try { await openFile(`/hr/gates/${g.code}/report`, { save: `gate-${g.code}-report.pdf` }); } catch (e) { setMessage({ tone: 'error', text: e.message }); } };
  const shown = g.criteria.filter((c) => filter === 'ALL' || c.status === filter);
  return (
    <section aria-labelledby="gate-h" data-testid="gate" data-status={g.status}>
      <PageHeader
        id="gate-h" title={`${g.code} ${g.name}`} status={badge(g.status, 'solid')}
        meta={<a href="/admin/gates" onClick={go('/admin/gates')}>Programme Gates</a>}
        facts={[{ label: 'Criteria met', value: `${g.counts.met} of ${g.counts.total}`, testid: 'gate-met' }, { label: 'Not met', value: String(g.counts.notMet) }, { label: 'Open', value: String(g.counts.open) }, { label: 'Passed on', value: day(g.passedAt) }]}
        actions={<>
          {g.canExport && <button type="button" className="btn" onClick={report} data-testid="gate-report">Download the report (PDF)</button>}
          {g.canReview && <button type="button" className="btn btn-primary" onClick={send} disabled={!allMet || submit.isPending} title={allMet ? undefined : 'Every criterion must be met first'} data-testid="gate-submit">Send for sign-off</button>}
        </>}
      />
      {message && <Banner tone={message.tone} onClose={() => setMessage(null)} testId="gate-message">{message.text}</Banner>}
      {g.canReview && !allMet && <p className="muted small" data-testid="gate-blocked">The gate can be sent for sign-off once every criterion is met: {g.counts.total - g.counts.met} still to do.</p>}
      <KpiRow label={`${g.code} criteria`}>
        <KpiTile label="Met" value={g.counts.met} tone="success" pressed={filter === 'MET'} onClick={() => setFilter(filter === 'MET' ? 'ALL' : 'MET')} />
        <KpiTile label="Not met" value={g.counts.notMet} tone={g.counts.notMet ? 'error' : 'neutral'} pressed={filter === 'NOT_MET'} onClick={() => setFilter(filter === 'NOT_MET' ? 'ALL' : 'NOT_MET')} />
        <KpiTile label="Open" value={g.counts.open} tone={g.counts.open ? 'warning' : 'neutral'} pressed={filter === 'OPEN'} onClick={() => setFilter(filter === 'OPEN' ? 'ALL' : 'OPEN')} />
      </KpiRow>
      {g.history.length > 0 && (
        <section aria-labelledby="gate-signoff" className="ui-card">
          <h2 id="gate-signoff" className="ui-card-head">Sign-off</h2>
          <ol className="ui-card-body gate-history small">{g.history.map((h, i) => <li key={i}>{day(h.at)} · {h.role ?? h.step ?? ''} · {h.by}: {h.event.toLowerCase().replace(/_/g, ' ')}{h.comment ? ` (${h.comment})` : ''}</li>)}</ol>
        </section>
      )}
      <h2>Criteria{filter !== 'ALL' ? ` (${STATUS_WORD[filter].toLowerCase()})` : ''}</h2>
      <ul className="gate-criteria">{shown.map((c) => <Criterion key={c.code} c={c} canReview={g.canReview} review={review} />)}</ul>
    </section>
  );
}
