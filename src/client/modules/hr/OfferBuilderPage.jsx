import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { EMPLOYMENT_TYPES, REQ_STATUS, dayIST, recruit, rupees } from './api.js';

// Offer Builder (HR, part 07.02): the offer to a selected candidate. Designation (the grade follows it), employment type, CTC a year, date of joining, how long the offer stays open. As the CTC is typed the breakup is
// computed on the server (basic, HRA, special allowance, employer PF, gratuity, the parts adding up to the CTC) with the requisition's range and what the candidate expects, and it says who will approve: the HR manager, and the
// director above the range or for a senior grade. Once saved the page is the offer itself: send for approval, withdraw, cancel, amend (a new revision), print the letter, send the link to the candidate, record an acceptance.
export default function OfferBuilderPage() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const candidateId = Number(sp.get('candidateId')) || null;
  const q = useQuery({ queryKey: ['hr', 'offer', id], queryFn: () => recruit.offer(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? `Offer ${q.data.docNo}` : 'Offer Builder');
  if (id && q.error?.status === 403) return <NoPermission what="offers" permission="hr.offer.view" />;
  if (id && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (id && q.isPending) return <Skeleton label="Loading the offer" rows={5} />;
  const o = q.data ?? null;
  const editable = !o || o.canEdit;
  return (
    <section aria-labelledby="ob-title" data-testid="offer-builder">
      <p><Link to="/hr/offers">← Offers</Link>{(o?.candidateId ?? candidateId) ? <> · <Link to={`/hr/recruitment/candidate?id=${o?.candidateId ?? candidateId}`}>Candidate</Link></> : null}</p>
      <h1 id="ob-title">{o ? `Offer ${o.docNo}${o.revision > 1 ? ` (revision ${o.revision})` : ''}: ${o.candidate}` : 'Offer Builder'}</h1>
      {o && <p><StatusBadge status={REQ_STATUS[o.status][0]} label={REQ_STATUS[o.status][1]} />{o.response !== 'NONE' && <> · the candidate {o.response.toLowerCase()}</>}{o.band === 'DIR' && <> · <span data-testid="ob-band">needs the director: {o.bandReason}</span></>}</p>}
      {editable ? <Form o={o} candidateId={candidateId} /> : <Facts o={o} />}
      {o && <Actions o={o} />}
      {o && o.history?.approvals?.length > 0 && <section aria-label="Approvals"><h2>Approvals</h2><ol className="mdm-list" data-testid="ob-approvals">{o.history.approvals.map((a, i) => <li key={i}>{formatDateTime(a.at)} · {a.event} · {a.actor}{a.comment ? `: ${a.comment}` : ''}</li>)}</ol></section>}
    </section>
  );
}

function Breakup({ b }) {
  if (!b?.lines) return null;
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="CTC breakup"><table className="grid" data-testid="ob-breakup"><thead><tr><th>Component</th><th className="num">Monthly (₹)</th><th className="num">Yearly (₹)</th></tr></thead>
      <tbody>{b.lines.map((l) => <tr key={l.code}><th scope="row" data-label="Component">{l.label}{l.kind === 'EMPLOYER' ? ' (employer)' : ''}</th><td className="num" data-label="Monthly">{rupees(l.monthly)}</td><td className="num" data-label="Yearly">{rupees(l.annual)}</td></tr>)}<tr><th scope="row">Cost to company</th><td className="num">{rupees(b.ctcMonthly)}</td><td className="num"><strong>{rupees(b.ctcAnnual)}</strong></td></tr></tbody></table></div>
  );
}

function Facts({ o }) {
  return <div><dl className="kv-list" data-testid="ob-facts">{[['Designation', `${o.designation ?? ''}${o.grade ? ` (${o.grade})` : ''}`], ['Type', o.employmentType], ['CTC a year', rupees(o.ctcAnnual)], ['Requisition range', o.range ? `${rupees(o.range.min)} to ${rupees(o.range.max)}` : null], ['Joining', formatDate(o.dojProposed)], ['Open for', `${o.validDays} days`], ['Sent', o.sentAt ? `${formatDateTime(o.sentAt)}, open until ${formatDate(o.validUntil)}` : null], ['Answer', o.responseNote]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v || '—'}</dd></div>)}</dl><Breakup b={o.breakup} /></div>;
}

function Form({ o, candidateId }) {
  const [v, setV] = useState({ designationId: o?.designationId ?? '', grade: o?.grade ?? '', employmentType: o?.employmentType ?? 'PERMANENT', ctcAnnual: o ? String(Number(o.ctcAnnual)) : '', dojProposed: o?.dojProposed ?? dayIST(21), validDays: o?.validDays ?? 7 });
  const [pv, setPv] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const cand = o?.candidateId ?? candidateId;
  const candidate = useQuery({ queryKey: ['hr', 'candidate', cand], queryFn: () => recruit.candidate(cand), enabled: Boolean(cand), retry: false });
  useEffect(() => {
    if (!v.ctcAnnual || Number(v.ctcAnnual) <= 0) { setPv(null); return undefined; }
    const t = setTimeout(async () => { try { setPv(await recruit.preview({ ctcAnnual: v.ctcAnnual, candidateId: cand || undefined, designationId: v.designationId ? Number(v.designationId) : undefined })); setError(null); } catch (e) { setPv(null); setError(errorInfo(e)); } }, 400);
    return () => clearTimeout(t);
  }, [v.ctcAnnual, v.designationId, cand]);
  const body = () => ({ designationId: Number(v.designationId), grade: v.grade || null, employmentType: v.employmentType, ctcAnnual: String(v.ctcAnnual), dojProposed: v.dojProposed, validDays: Number(v.validDays) });
  const save = async (submit) => {
    setBusy(true); setError(null);
    try {
      const out = o ? await recruit.offerUpdate(o.id, { ...body(), version: o.rowVersion }) : await recruit.offerCreate({ ...body(), candidateId: cand, submit });
      if (o && submit) await recruit.offerSubmit(o.id);
      navigateTo(`/hr/offers/offer?id=${out.id}${submit ? '&sent=1' : ''}`, { force: true });
    } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  if (!cand) return <ErrorState title="No candidate chosen" error={{ message: 'Make an offer from a selected candidate in the Candidate Pipeline.' }} />;
  return (
    <div>
      {candidate.data && <p className="muted">For {candidate.data.name} · {candidate.data.requisition} · expects {rupees(candidate.data.expectedCtc)}</p>}
      <div className="mdm-fields">
        <LookupField id="ob-designation" label="Designation" lookup="hr/designations" value={v.designationId} onChange={(x) => setV((s) => ({ ...s, designationId: x }))} onPick={(r) => r?.extra?.grade && setV((s) => ({ ...s, designationId: r.id, grade: r.extra.grade }))} error={error?.fields?.designationId} required />
        <Field label="Grade" name="grade" error={error} hint="Filled from the designation"><input value={v.grade} maxLength={20} onChange={(e) => setV({ ...v, grade: e.target.value })} data-testid="ob-grade" /></Field>
        <Field label="Employment type" name="employmentType" error={error}><select value={v.employmentType} onChange={(e) => setV({ ...v, employmentType: e.target.value })}>{EMPLOYMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="CTC a year (₹, required)" name="ctcAnnual" error={error}><input inputMode="decimal" value={v.ctcAnnual} onChange={(e) => setV({ ...v, ctcAnnual: e.target.value })} data-testid="ob-ctc" /></Field>
        <Field label="Date of joining" name="dojProposed" error={error}><input type="date" value={v.dojProposed} onChange={(e) => setV({ ...v, dojProposed: e.target.value })} data-testid="ob-doj" /></Field>
        <Field label="Open for (days)" name="validDays" error={error}><input type="number" min="1" max="60" value={v.validDays} onChange={(e) => setV({ ...v, validDays: e.target.value })} /></Field>
      </div>
      {pv && <div data-testid="ob-preview"><p className={`mdm-banner${pv.band === 'DIR' ? ' is-warning' : ''}`} role="status" data-testid="ob-route">{pv.range ? `Requisition range ${rupees(pv.range.min)} to ${rupees(pv.range.max)}. ` : ''}{pv.band === 'DIR' ? `The director also approves: ${pv.bandReason}.` : pv.band ? 'The HR manager approves.' : ''}</p><Breakup b={pv} /></div>}
      {error?.form && <p className="field-error" role="alert" data-testid="ob-error">{error.form}</p>}
      <div className="actions"><button type="button" className="btn" onClick={() => navigateTo('/hr/recruitment')}>Cancel</button><button type="button" className="btn" disabled={busy || !v.designationId} onClick={() => save(false)} data-testid="ob-save">Save draft</button><button type="button" className="btn btn-primary" disabled={busy || !v.designationId} onClick={() => save(true)} data-testid="ob-submit">{busy ? 'Saving...' : 'Send for approval'}</button></div>
    </div>
  );
}

function Actions({ o }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const [link, setLink] = useState(null);
  const run = async (fn, done) => { setError(null); try { const out = await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['hr'] }); setMode(null); setReason(''); return out; } catch (e) { setError(errorInfo(e)); return null; } };
  return (
    <div data-testid="ob-actions">
      <div className="actions-row">
        {o.canSubmit && <button type="button" className="btn btn-primary" onClick={() => run(() => recruit.offerSubmit(o.id), 'Sent for approval.')} data-testid="ob-send-approval">Send for approval</button>}
        {o.canWithdraw && <button type="button" className="btn" onClick={() => setMode('withdraw')}>Withdraw</button>}
        {o.canCancel && <button type="button" className="btn" onClick={() => setMode('cancel')} data-testid="ob-cancel">Cancel</button>}
        {o.canDelete && <button type="button" className="btn" onClick={() => { if (window.confirm('Delete this draft?')) run(() => recruit.offerRemove(o.id), 'Deleted.').then(() => navigateTo('/hr/offers')); }}>Delete draft</button>}
        {o.canAmend && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="ob-amend">Amend</button>}
        {o.canSend && <button type="button" className="btn btn-primary" onClick={async () => { const out = await run(() => recruit.offerSend(o.id), 'The offer link was made. Share it with the candidate; it is shown only now.'); if (out) setLink(out.link); }} data-testid="ob-send-link">{o.sentAt ? 'Make a new link' : 'Send the offer'}</button>}
        {o.canRecordAcceptance && <button type="button" className="btn" onClick={() => setMode('accept')} data-testid="ob-accept">Record an acceptance</button>}
        {o.canPrint && <a className="btn" href={`/api/v1/hr/offers/${o.id}/print`} target="_blank" rel="noreferrer" data-testid="ob-print">Print the letter</a>}
      </div>
      {link && <p className="mdm-banner" role="status" data-testid="ob-link">Link for the candidate: <code>{link}</code></p>}
      {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); const fn = { withdraw: () => recruit.offerWithdraw(o.id, reason), cancel: () => recruit.offerCancel(o.id, reason), amend: () => recruit.offerAmend(o.id, reason), accept: () => recruit.offerAccept(o.id, reason) }[mode]; run(fn, 'Done.').then((out) => { if (out && mode === 'amend') navigateTo(`/hr/offers/offer?id=${out.id}`, { force: true }); }); }}>
        <Field label={mode === 'accept' ? 'How the acceptance came (required)' : 'Reason (required)'} name="reason" error={error}><textarea rows="2" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="ob-reason" /></Field>
        <div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="ob-reason-go">Confirm</button></div></form>}
      {note && <p role="status" className="mdm-banner" data-testid="ob-note">{note}</p>}{error?.form && !mode && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}
void api;
