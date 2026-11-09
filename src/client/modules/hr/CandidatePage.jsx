import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate } from '../../platform/format.js';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { REQ_STATUS, recruit, rupees } from './api.js';
import PrejoiningForm from './PrejoiningForm.jsx';

// Candidate (HR, part 07.02): one candidate. Header: name, stage, requisition, source, days in the stage, what they ask; actions for the stage: reject (with a reason), make an offer, join. Tabs: Details · Interviews
// (schedule, the panel's feedback with scores and recommendation, the result) · Offer (the offers and their answer) · Pre-joining (background verification, medical fitness, the details of the candidate, whose
// sensitive part is masked) · Joining (the checklist after joining and the employee record) · Documents (the resume and joining documents) · Timeline · Discussion. A panel member sees the basic data and gives feedback; pay is not shown to them.
const TABS = [['details', 'Details'], ['interviews', 'Interviews'], ['offer', 'Offer'], ['prejoining', 'Pre-joining'], ['joining', 'Joining'], ['documents', 'Documents'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
export default function CandidatePage() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['hr', 'candidate', id], queryFn: () => recruit.candidate(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? q.data.name : 'Candidate');
  const [tab, setTab] = useState(() => sp.get('tab') ?? 'details');
  if (!id) return <ErrorState title="No candidate chosen" error={{ message: 'Open a candidate from the Candidate Pipeline.' }} />;
  if (q.error?.status === 403) return <NoPermission what="candidates" permission="hr.candidate.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the candidate" rows={6} />;
  const c = q.data;
  const hr = c.accessLevel === 'full';
  const tabs = TABS.filter(([k]) => hr || ['details', 'interviews', 'timeline', 'discussion'].includes(k));
  return (
    <section aria-labelledby="cd-title" data-testid="candidate-page">
      <p><Link to="/hr/recruitment">← Candidate Pipeline</Link></p>
      <header className="op-header">
        <div className="page-head"><h1 id="cd-title">{c.name}</h1><StatusBadge status={c.stage === 'REJECTED' ? 'REJECTED' : c.stage === 'JOINED' ? 'COMPLETED' : 'ACTIVE'} label={c.stageLabel} /></div>
        <dl className="op-figures">
          <div><dt>Requisition</dt><dd>{c.requisition} · {c.designation}</dd></div><div><dt>Department</dt><dd>{c.department}</dd></div><div><dt>Source</dt><dd>{c.sourceLabel}{c.sourceDetail ? `: ${c.sourceDetail}` : ''}</dd></div>
          <div><dt>In this stage</dt><dd>{c.daysInStage} day(s)</dd></div>{c.expectedCtc && <div><dt>Expects / has</dt><dd>{rupees(c.expectedCtc)} / {rupees(c.currentCtc)}</dd></div>}{c.noticeDays != null && <div><dt>Notice</dt><dd>{c.noticeDays} days</dd></div>}
        </dl>
        {hr && <Actions c={c} />}
      </header>
      <div role="tablist" aria-label="Candidate sections" className="op-tabs">{tabs.map(([k, l]) => <button key={k} type="button" role="tab" id={`cd-tab-${k}`} aria-selected={tab === k} aria-controls={`cd-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)} data-testid={`cd-tab-${k}`}>{l}</button>)}</div>
      <div role="tabpanel" id={`cd-panel-${tab}`} aria-labelledby={`cd-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'details' && <dl className="kv-list" data-testid="cd-details">{[['Mobile', c.mobile], ['E-mail', c.email], ['Requisition', c.requisition], ['Rejected because', c.rejectReason], ['Personal data kept until', c.retentionUntil ? formatDate(c.retentionUntil) : null], ['Removed', c.anonymised ? 'The personal data was removed after the retention period' : null]].filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x || '—'}</dd></div>)}</dl>}
        {tab === 'interviews' && <Interviews c={c} />}
        {tab === 'offer' && <OfferTab c={c} />}
        {tab === 'prejoining' && <Prejoining c={c} />}
        {tab === 'joining' && <Joining c={c} />}
        {tab === 'documents' && <div><AttachmentList entity="hr_candidate" entityId={c.id} canEdit={c.canEdit} />{c.canEdit && <FileUploader entity="hr_candidate" entityId={c.id} />}</div>}
        {tab === 'timeline' && <TimelineTab entity="hr_candidate" id={c.id} />}
        {tab === 'discussion' && <DiscussionTab entity="hr_candidate" id={c.id} />}
      </div>
    </section>
  );
}

function useRun() {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const run = async (fn, done) => { setError(null); setNote(null); try { const out = await fn(); if (done) setNote(typeof done === 'function' ? done(out) : done); qc.invalidateQueries({ queryKey: ['hr'] }); return out; } catch (e) { setError(errorInfo(e)); return null; } };
  return { run, error, note };
}

function Actions({ c }) {
  const { run, error, note } = useRun();
  const [rej, setRej] = useState(null);
  return (
    <div data-testid="cd-actions">
      <div className="actions-row">
        {c.stage === 'SELECTED' && c.canEdit && <button type="button" className="btn btn-primary" onClick={() => navigateTo(`/hr/offers/offer?candidateId=${c.id}`)} data-testid="cd-make-offer">Make an offer</button>}
        {c.stage === 'ACCEPTED' && c.canEdit && <button type="button" className="btn btn-primary" onClick={() => run(() => recruit.join(c.id), (o) => `Joined: employee ${o.employee.code} was created and sent for approval; ${o.tasks.length} joining tasks were given out.`)} data-testid="cd-join">Convert to employee</button>}
        {c.employeeId && <Link to={`/hr/employees/employee?id=${c.employeeId}`}>Employee record</Link>}
        {!['JOINED', 'REJECTED'].includes(c.stage) && c.canEdit && <button type="button" className="btn" onClick={() => setRej('')} data-testid="cd-reject">Reject</button>}
      </div>
      {rej !== null && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => recruit.stage(c.id, { stage: 'REJECTED', reason: rej, version: c.rowVersion }), 'Rejected.').then(() => setRej(null)); }}><Field label="Why (required)" name="reason" error={error}><textarea rows="2" required minLength={5} value={rej} onChange={(e) => setRej(e.target.value)} data-testid="cd-reject-reason" /></Field><div className="actions"><button type="button" className="btn" onClick={() => setRej(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="cd-reject-go">Reject</button></div></form>}
      {note && <p role="status" className="mdm-banner" data-testid="cd-note">{note}</p>}{error?.form && <p className="field-error" role="alert" data-testid="cd-error">{error.form}</p>}
    </div>
  );
}

function Interviews({ c }) {
  const { run, error, note } = useRun();
  const [s, setS] = useState(null);
  const [fb, setFb] = useState(null);
  return (
    <div data-testid="cd-interviews">
      {c.interviews.length === 0 ? <p className="muted">No interview yet.</p> : c.interviews.map((i) => (
        <article key={i.id} className="mdm-card" data-testid="cd-interview">
          <h3>Round {i.round} · {String(i.scheduledAt).replace('T', ' ')} · {i.mode.replace('_', ' ').toLowerCase()}</h3>
          <p>Panel: {i.panel.join(', ')} · Result: <strong data-testid="cd-result">{i.result.toLowerCase()}</strong>{i.score != null ? ` · score ${i.score}/5` : ''}</p>
          {i.feedback.length > 0 && <ul className="mdm-list">{i.feedback.map((f) => <li key={f.by}>{f.by}: {f.recommendation.toLowerCase()} · average {f.average}{f.comments ? ` · ${f.comments}` : ''}</li>)}</ul>}
          {i.canGive && <button type="button" className="btn btn-small" onClick={() => setFb({ id: i.id, technical: 3, communication: 3, comments: '', recommendation: 'PASS' })} data-testid="cd-feedback-open">Give feedback</button>}
          {i.result === 'PENDING' && c.canEdit && <button type="button" className="btn btn-small" onClick={() => { const r = window.prompt('Why is the interview cancelled?'); if (r && r.length >= 5) run(() => recruit.cancelInterview(i.id, r), 'Cancelled.'); }}>Cancel</button>}
        </article>
      ))}
      {fb && <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => recruit.feedback(fb.id, { scores: { technical: Number(fb.technical), communication: Number(fb.communication) }, comments: fb.comments || undefined, recommendation: fb.recommendation }), 'Feedback saved.').then((o) => o && setFb(null)); }} data-testid="cd-feedback-form">
        <Field label="Technical (1 to 5)" name="scores" error={error}><input type="number" min="1" max="5" value={fb.technical} onChange={(e) => setFb({ ...fb, technical: e.target.value })} data-testid="cd-fb-technical" /></Field>
        <Field label="Communication (1 to 5)" name="scores" error={error}><input type="number" min="1" max="5" value={fb.communication} onChange={(e) => setFb({ ...fb, communication: e.target.value })} data-testid="cd-fb-communication" /></Field>
        <Field label="Recommendation" name="recommendation" error={error}><select value={fb.recommendation} onChange={(e) => setFb({ ...fb, recommendation: e.target.value })} data-testid="cd-fb-reco"><option value="PASS">Pass</option><option value="HOLD">Hold</option><option value="FAIL">Fail</option></select></Field>
        <Field label="Comments" name="comments" error={error}><textarea rows="2" value={fb.comments} onChange={(e) => setFb({ ...fb, comments: e.target.value })} /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setFb(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="cd-fb-save">Save feedback</button></div></form>}
      {c.canEdit && !['REJECTED', 'JOINED', 'OFFERED', 'ACCEPTED'].includes(c.stage) && (s ? <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => recruit.schedule(c.id, { scheduledAt: s.at, mode: s.mode, panel: s.panel.split(',').map((x) => x.trim()).filter(Boolean) }), 'Scheduled; the panel was told.').then((o) => o && setS(null)); }} data-testid="cd-schedule-form">
        <Field label="Date and time" name="scheduledAt" error={error}><input type="datetime-local" value={s.at} onChange={(e) => setS({ ...s, at: e.target.value })} required data-testid="cd-sch-at" /></Field>
        <Field label="Mode" name="mode" error={error}><select value={s.mode} onChange={(e) => setS({ ...s, mode: e.target.value })}><option value="IN_PERSON">In person</option><option value="PHONE">Phone</option><option value="VIDEO">Video</option></select></Field>
        <Field label="Panel (user names, comma separated)" name="panel" error={error}><input value={s.panel} onChange={(e) => setS({ ...s, panel: e.target.value })} required data-testid="cd-sch-panel" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setS(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="cd-sch-go">Schedule</button></div></form>
        : <button type="button" className="btn" onClick={() => setS({ at: '', mode: 'IN_PERSON', panel: '' })} data-testid="cd-schedule">Schedule an interview</button>)}
      {note && <p role="status" className="mdm-banner" data-testid="cd-iv-note">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function OfferTab({ c }) {
  return (
    <div data-testid="cd-offers">
      {c.offers.length === 0 ? <p className="muted">No offer yet.{c.stage === 'SELECTED' && c.canEdit ? ' Make one with "Make an offer".' : ''}</p> : <ul className="mdm-list">{c.offers.map((o) => <li key={o.id}><Link to={`/hr/offers/offer?id=${o.id}`}>{o.docNo}{o.revision > 1 ? ` r${o.revision}` : ''}</Link> · {rupees(o.ctcAnnual)} a year · {REQ_STATUS[o.status]?.[1] ?? o.status}{o.response !== 'NONE' ? ` · candidate: ${o.response.toLowerCase()}` : ''}{o.status === 'APPROVED' && o.sentAt ? ` · sent, open until ${o.validUntil}` : ''}</li>)}</ul>}
    </div>
  );
}

function Prejoining({ c }) {
  const { run, error, note } = useRun();
  return (
    <div data-testid="cd-prejoining">
      <div className="mdm-fields">
        <Field label="Background verification" name="bgvStatus" error={error}><select value={c.bgvStatus} onChange={(e) => run(() => recruit.checks(c.id, { bgvStatus: e.target.value }), 'Saved.')} disabled={!c.canEdit} data-testid="cd-bgv">{[['NOT_STARTED', 'Not started'], ['IN_PROGRESS', 'In progress'], ['CLEAR', 'Clear'], ['ADVERSE', 'Adverse']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Medical fitness" name="medicalStatus" error={error}><select value={c.medicalStatus} onChange={(e) => run(() => recruit.checks(c.id, { medicalStatus: e.target.value }), 'Saved.')} disabled={!c.canEdit} data-testid="cd-medical">{[['PENDING', 'Pending'], ['FIT', 'Fit'], ['UNFIT', 'Unfit']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </div>
      <p data-testid="cd-pj-state">{c.prejoiningDone ? `The details are in${c.sensitive ? `: PAN ${c.sensitive.pan ?? '—'}, Aadhaar ${c.sensitive.aadhaar ?? '—'}, bank ${c.sensitive.bank ?? '—'}` : ''}.` : 'The details are not in yet. The candidate fills them through the offer link after accepting, or HR enters them below.'}</p>
      {c.canEdit && ['SELECTED', 'OFFERED', 'ACCEPTED'].includes(c.stage) && <details><summary>Enter the details here</summary><PrejoiningForm initialName={c.name} onSave={async (b) => { await recruit.prejoining(c.id, b); run(async () => null); }} /></details>}
      {note && <p role="status" className="mdm-banner">{note}</p>}{error?.form && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}

function Joining({ c }) {
  return (
    <div data-testid="cd-joining">
      {c.employeeId ? <p>Employee record: <Link to={`/hr/employees/employee?id=${c.employeeId}`}>open it</Link> (joined {c.joinedOn ? formatDate(c.joinedOn) : ''}).</p> : <p className="muted">The employee record is created when the candidate joins.</p>}
      {c.tasks.length > 0 && <ul className="mdm-list">{c.tasks.map((t) => <li key={t.id}>{t.title} · {t.role} · due {formatDate(t.dueDate)} · {t.status.toLowerCase()}</li>)}</ul>}
      {c.tasks.length > 0 && <p><Link to="/hr/onboarding">Onboarding Checklist</Link></p>}
    </div>
  );
}
