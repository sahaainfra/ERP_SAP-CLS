import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { SOURCES, STAGES, recruit, rupees } from './api.js';

// Candidate Pipeline (HR, part 07.02): the board of candidates in a column per stage (Applied, Screened, Interview, Selected, Offered, Accepted, Joined, Rejected), filtered by requisition and name, with the source of each.
// A card moves one step by drag and drop or by its "Move to" list (keyboard); the server decides whether the move is allowed (an interview must be passed before Selected; Offered, Accepted and Joined come from the offer and
// the joining) and says why not. A move forward in the first stages is undone with Undo; Rejected asks for the reason. "Add a candidate" enters one against an approved requisition; Print prints the board.
const NEXT = { APPLIED: ['SCREENED'], SCREENED: ['INTERVIEW'], INTERVIEW: ['SELECTED'] };
export default function CandidatePipelinePage() {
  usePageTitle('Candidate Pipeline');
  const qc = useQueryClient();
  const sp = new URLSearchParams(window.location.search);
  const [reqId, setReqId] = useState(sp.get('requisitionId') ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [undo, setUndo] = useState(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState(null);
  const q = useQuery({ queryKey: ['hr', 'board', reqId, text], queryFn: () => recruit.board({ requisitionId: reqId || undefined, q: text || undefined }), retry: false });
  if (q.error?.status === 403) return <NoPermission what="the pipeline" permission="hr.candidate.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const b = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['hr', 'board'] });
  const move = async (c, stage, { reason, isUndo = false } = {}) => {
    setError(null);
    try {
      const out = await recruit.stage(c.id, { stage, version: c.rowVersion, reason, undo: isUndo });
      setUndo(!isUndo && ['SCREENED', 'INTERVIEW', 'SELECTED'].includes(stage) ? { id: c.id, from: c.stage, version: out.rowVersion, name: c.name } : null);
      refresh();
    } catch (e) { setError(errorInfo(e)); }
  };
  const reject = (c) => { const reason = window.prompt(`Why is ${c.name} rejected? (at least 5 characters)`); if (reason && reason.trim().length >= 5) move(c, 'REJECTED', { reason: reason.trim() }); };
  return (
    <section aria-labelledby="cp-title" data-testid="pipeline">
      <h1 id="cp-title">Candidate Pipeline</h1>
      <form className="srch-form" aria-label="Filters" onSubmit={(e) => e.preventDefault()}>
        <Field label="Requisition" name="requisition" error={null}><select value={reqId} onChange={(e) => setReqId(e.target.value)} data-testid="cp-requisition"><option value="">All requisitions</option>{(b?.requisitions ?? []).map((r) => <option key={r.id} value={r.id}>{r.docNo} · {r.designation} ({r.positions})</option>)}</select></Field>
        <Field label="Candidate" name="q" error={null}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Name" data-testid="cp-search" /></Field>
        <button type="button" className="btn" onClick={() => setAdding(!adding)} data-testid="cp-add">Add a candidate</button>
        <button type="button" className="btn" onClick={() => window.print()}>Print</button>
      </form>
      {adding && <AddCandidate requisitions={b?.requisitions ?? []} reqId={reqId} done={(c) => { setAdding(false); refresh(); navigateTo(`/hr/recruitment/candidate?id=${c.id}`); }} close={() => setAdding(false)} />}
      {error?.form && <p className="field-error" role="alert" data-testid="cp-error">{error.form}</p>}
      {undo && <p className="mdm-banner" role="status" data-testid="cp-undo">{undo.name} moved. <button type="button" className="btn btn-small" onClick={() => move({ id: undo.id, stage: '', rowVersion: undo.version, name: undo.name }, undo.from, { isUndo: true })} data-testid="cp-undo-go">Undo</button></p>}
      {q.isPending ? <Skeleton label="Loading the pipeline" rows={4} /> : b.total === 0 && !text ? <EmptyState title="No candidate yet" message={b.requisitions.length ? 'Add the first candidate with "Add a candidate".' : 'Candidates are entered against an approved requisition: raise one first.'} /> : (
        <>
          <div className="hr-board" role="list" aria-label="Stages">
            {b.stages.map((s) => (
              <section key={s.stage} role="listitem" className="hr-col" aria-label={`${s.label}, ${s.candidates.length}`} data-testid={`cp-col-${s.stage}`}
                onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag && drag.stage !== s.stage) { if (s.stage === 'REJECTED') reject(drag); else move(drag, s.stage); } setDrag(null); }}>
                <h2>{s.label} <span className="num">{s.candidates.length}</span></h2>
                {s.candidates.map((c) => (
                  <article key={c.id} className="hr-card" draggable onDragStart={() => setDrag(c)} data-testid="cp-card">
                    <h3><Link to={`/hr/recruitment/candidate?id=${c.id}`}>{c.name}</Link></h3>
                    <p className="muted small">{c.requisition} · {c.sourceLabel} · {c.daysInStage} day(s) here</p>
                    {c.expectedCtc && <p className="small">Expects {rupees(c.expectedCtc)}</p>}
                    {c.lastInterview && <p className="small">Interview: {c.lastInterview.toLowerCase()}</p>}
                    {!['JOINED', 'REJECTED', 'OFFERED', 'ACCEPTED'].includes(c.stage) && (
                      <label className="small">Move to <select aria-label={`Move ${c.name}`} value="" onChange={(e) => { const v = e.target.value; if (v === 'REJECTED') reject(c); else if (v) move(c, v); }} data-testid="cp-move">
                        <option value="">…</option>{(NEXT[c.stage] ?? []).map((n) => <option key={n} value={n}>{STAGES.find(([k]) => k === n)[1]}</option>)}<option value="REJECTED">Reject</option></select></label>
                    )}
                  </article>
                ))}
              </section>
            ))}
          </div>
          <p className="muted small" data-testid="cp-sources">Sources: {SOURCES.map(([k, l]) => `${l} ${b.sources[k] ?? 0}`).join(' · ')}. Offered, Accepted and Joined come from the offer and the joining.</p>
        </>
      )}
      <p className="small"><Link to="/hr/requisitions">Manpower Requisitions</Link> · <Link to="/hr/offers">Offers</Link> · <Link to="/hr/onboarding">Onboarding Checklist</Link></p>
    </section>
  );
}

function AddCandidate({ requisitions, reqId, done, close }) {
  const open = requisitions.filter((r) => r.status === 'APPROVED');
  const [v, setV] = useState({ fullName: '', mobile: '', email: '', source: 'REFERRAL', sourceDetail: '', requisitionId: reqId || '', expectedCtc: '', currentCtc: '', noticeDays: '' });
  const [error, setError] = useState(null);
  const [ack, setAck] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    try { done(await recruit.candCreate({ fullName: v.fullName, mobile: v.mobile, email: v.email || null, source: v.source, sourceDetail: v.sourceDetail || null, requisitionId: Number(v.requisitionId), expectedCtc: v.expectedCtc || null, currentCtc: v.currentCtc || null, noticeDays: v.noticeDays === '' ? null : Number(v.noticeDays), acknowledgeDuplicates: ack })); } catch (err) { setError(errorInfo(err)); }
  };
  const set = (p) => setV({ ...v, ...p });
  return (
    <form className="mdm-panel mdm-fields" onSubmit={submit} data-testid="cp-add-form">
      <Field label="Requisition (required)" name="requisitionId" error={error}><select value={v.requisitionId} onChange={(e) => set({ requisitionId: e.target.value })} required data-testid="cp-add-req"><option value="">Choose</option>{open.map((r) => <option key={r.id} value={r.id}>{r.docNo} · {r.designation}</option>)}</select></Field>
      <Field label="Name (required)" name="fullName" error={error}><input value={v.fullName} onChange={(e) => set({ fullName: e.target.value })} required data-testid="cp-add-name" /></Field>
      <Field label="Mobile (required)" name="mobile" error={error}><input inputMode="tel" value={v.mobile} onChange={(e) => set({ mobile: e.target.value })} required data-testid="cp-add-mobile" /></Field>
      <Field label="E-mail" name="email" error={error}><input type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} /></Field>
      <Field label="Source" name="source" error={error}><select value={v.source} onChange={(e) => set({ source: e.target.value })} data-testid="cp-add-source">{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Field label="Who or which agency" name="sourceDetail" error={error}><input value={v.sourceDetail} onChange={(e) => set({ sourceDetail: e.target.value })} /></Field>
      <Field label="Current CTC a year (₹)" name="currentCtc" error={error}><input inputMode="decimal" value={v.currentCtc} onChange={(e) => set({ currentCtc: e.target.value })} /></Field>
      <Field label="Expected CTC a year (₹)" name="expectedCtc" error={error}><input inputMode="decimal" value={v.expectedCtc} onChange={(e) => set({ expectedCtc: e.target.value })} data-testid="cp-add-expected" /></Field>
      <Field label="Notice period (days)" name="noticeDays" error={error}><input inputMode="numeric" value={v.noticeDays} onChange={(e) => set({ noticeDays: e.target.value })} /></Field>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {error?.code === 'DUPLICATE_WARNING' && <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I checked: this is a different person</label>}
      <div className="actions"><button type="button" className="btn" onClick={close}>Close</button><button type="submit" className="btn btn-primary" data-testid="cp-add-go">Add</button></div>
    </form>
  );
}
