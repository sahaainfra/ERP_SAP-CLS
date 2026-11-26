import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { api, authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { REQ_STATUS, SKILL_LABELS, lab } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { todayIst } from '../../platform/forms/dates.js';

// Worker (HR, part 07.08): the profile of a contract worker: details (the ID and bank account masked), clearance (induction and medical, the PPE issued), deployments, attendance, the wage that applies, approvals and history, with
// the actions the person may take: send, withdraw, cancel, amend, add the photo, record clearance and PPE (safety and HR), blacklist and lift it, print the card. Incidents come from the HSE module (19.01) when it is installed.
const transport = browserTransport(authHeaders);
const TABS = [['details', 'Details'], ['clearance', 'Induction, medical and PPE'], ['deployments', 'Deployments'], ['attendance', 'Attendance'], ['wages', 'Wages'], ['history', 'Approvals and history']];
export default function WorkerPage() {
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle('Worker');
  const qc = useQueryClient();
  const [tab, setTab] = useState('details');
  const q = useQuery({ queryKey: ['lab', 'worker', id], queryFn: () => lab.workers.get(id), enabled: Boolean(id), retry: false });
  if (!id) return <ErrorState error={new Error('No worker was named.')} />;
  if (q.error?.status === 403) return <NoPermission what="workers" permission="hr.worker.view" />;
  if (q.isPending) return <Skeleton label="Loading the worker" rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const w = q.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ['lab'] });
  return (
    <section aria-labelledby="wp-title" data-testid="worker">
      <p><Link to="/labour/workers">← Workers Register</Link></p>
      <header>
        <PageHeader id="wp-title" title={<>{w.name} <span className="muted small">{w.workerCode}</span></>} meta={<><StatusBadge status={(REQ_STATUS[w.status] ?? [w.status])[0]} label={w.statusLabel} /> {w.workerStatus === 'BLACKLISTED' && <StatusBadge status="OVERDUE" label="Blacklisted" />} {w.cleared ? <StatusBadge status="ACTIVE" label="Cleared for work" /> : <StatusBadge status="AT_RISK" label="Not cleared" />} <span className="muted small" data-testid="wp-contractor">{w.contractor} · {w.tradeCode.replace(/_/g, ' ').toLowerCase()} · {w.skillLabel}</span></>} />
      </header>
      <Actions w={w} refresh={refresh} />
      <div role="tablist" className="tabs" aria-label="Worker">{TABS.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={tab === k} className={tab === k ? 'tab tab-active' : 'tab'} onClick={() => setTab(k)} data-testid={`wp-tab-${k}`}>{l}</button>)}</div>
      {tab === 'details' && <Details w={w} refresh={refresh} />}
      {tab === 'clearance' && <Clearance w={w} refresh={refresh} />}
      {tab === 'deployments' && (w.deployments.length === 0 ? <p className="muted" data-testid="wp-no-dep">Not deployed yet. A deployment (Deployments, part 07.03) puts the worker on a site and in a crew.</p> : <ul className="mdm-list" data-testid="wp-deployments">{w.deployments.map((d) => <li key={d.id}>{d.docNo}: {d.site ?? 'site'} from {d.fromDate}{d.toDate ? ` to ${d.toDate}` : ''} ({d.status.toLowerCase()})</li>)}</ul>)}
      {tab === 'attendance' && (w.punches.length === 0 ? <p className="muted">No punch yet.</p> : <ul className="mdm-list" data-testid="wp-punches">{w.punches.map((p, i) => <li key={i}>{p.workDate}: {p.type === 'IN' ? 'In' : 'Out'} {p.at.slice(11, 16)} UTC ({p.result.toLowerCase()})</li>)}</ul>)}
      {tab === 'wages' && (w.wage?.rate ? <p data-testid="wp-wage">The rate to pay today is <strong>{w.wage.rate.rate}</strong> a day ({w.wage.rate.source === 'CONTRACT' ? `the contracted rate ${w.wage.rate.docNo}` : 'the minimum wage'}){w.wage.minimum ? `; the minimum wage is ${w.wage.minimum.rate}` : ''}. <Link to="/labour/wages">Wage Rates & Minimum Wages</Link></p> : <p className="muted" data-testid="wp-wage">No wage rate is on file for this contractor, trade and state. <Link to="/labour/wages">Wage Rates & Minimum Wages</Link></p>)}
      {tab === 'history' && (
        <div data-testid="wp-history">
          <ul className="mdm-list">{w.history.approvals.map((h, i) => <li key={`a${i}`}>{h.at?.slice(0, 10)} {h.step_code ?? ''} {h.event}{h.comment ? `: ${h.comment}` : ''} ({h.actor})</li>)}{w.history.audit.map((h, i) => <li key={`u${i}`}>{h.at?.slice(0, 10)} {h.action}{h.reason ? `: ${h.reason}` : ''} ({h.by})</li>)}</ul>
          <p className="muted small">Incidents of this worker are shown here once the safety module (19.01) records them.</p>
        </div>
      )}
    </section>
  );
}

function Details({ w, refresh }) {
  const input = useRef(null); const [state, setState] = useState(''); const [problem, setProblem] = useState('');
  const pick = async (file) => {
    if (!file) return; setProblem('');
    try {
      setState('Uploading...');
      const stored = await uploadFile(file, { transport, entity: 'lab_worker', entityId: w.rootId });
      let status = stored.scanStatus;
      for (let i = 0; i < 40 && status === 'PENDING'; i += 1) { await new Promise((r) => setTimeout(r, 500)); status = (await api.get(`/core/files/${stored.id}`)).data.scanStatus; }
      if (status !== 'CLEAN') throw new Error('The file did not pass the virus scan.');
      await lab.workers.photo(w.id, stored.id); setState(''); refresh();
    } catch (e) { setState(''); setProblem(e.message); }
    if (input.current) input.current.value = '';
  };
  const rows = [['Name', w.name], ['Contractor', w.contractor], ['Trade', w.tradeCode], ['Skill', SKILL_LABELS[w.skillCategory]], ['ID (Aadhaar)', w.aadhaarMasked], ['Mobile', w.mobile], ['Age', `${w.age} years`], ['Gender', w.gender.toLowerCase()], ['Home state', w.homeState], ['Bank account', w.bankMasked ?? 'none'], ['IFSC', w.ifsc], ['UAN', w.uan], ['ESIC', w.esicIp], ['BOCW number', w.bocwNo], ['Emergency contact', w.emergencyName ? `${w.emergencyName} ${w.emergencyMobile ?? ''}` : null]];
  return (
    <div data-testid="wp-details">
      <dl className="op-figures">{rows.filter(([, x]) => x != null && x !== '').map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x}</dd></div>)}</dl>
      <p>Photo: {w.photoFileId ? <a href={`/api/v1/core/files/${w.photoFileId}/download`} target="_blank" rel="noreferrer" data-testid="wp-photo">open</a> : 'none yet'}</p>
      {(w.can.edit || w.can.clear) && <div className="field"><label className="btn">{state || 'Add or change the photo'}<input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} data-testid="wp-photo-input" /></label>{problem && <p className="field-error" role="alert">{problem}</p>}</div>}
      {w.pendingRevision && <p className="mdm-banner">A change is {w.pendingRevision.status === 'SUBMITTED' ? 'in approval' : 'being prepared'}: <Link to={`/labour/workers/new?id=${w.pendingRevision.id}`}>open it</Link>.</p>}
    </div>
  );
}

function Clearance({ w, refresh }) {
  const [f, setF] = useState({ inductionStatus: w.inductionStatus, inductionDate: w.inductionDate ?? '', medicalStatus: w.medicalStatus, medicalValidUntil: w.medicalValidUntil ?? '' });
  const [ppe, setPpe] = useState({ item: '', issuedOn: todayIst() });
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); refresh(); } catch (e) { setError(errorInfo(e)); } };
  return (
    <div data-testid="wp-clearance">
      <p>Induction: <strong>{w.inductionStatus.toLowerCase()}</strong>{w.inductionDate ? ` on ${w.inductionDate}` : ''} · Medical: <strong>{w.medicalStatus.toLowerCase()}</strong>{w.medicalValidUntil ? ` until ${w.medicalValidUntil}` : ''}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="wp-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="wp-note">{note}</p>}
      {w.can.clear && (
        <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => lab.workers.clearance(w.id, { inductionStatus: f.inductionStatus, inductionDate: f.inductionDate || null, medicalStatus: f.medicalStatus, medicalValidUntil: f.medicalValidUntil || null }), 'Clearance recorded.'); }}>
          <Field label="Induction" name="inductionStatus" error={error}><select value={f.inductionStatus} onChange={(e) => setF({ ...f, inductionStatus: e.target.value })} data-testid="cl-induction">{[['PENDING', 'Pending'], ['CLEARED', 'Cleared'], ['EXPIRED', 'Expired']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Induction done on" name="inductionDate" error={error}><input type="date" value={f.inductionDate} onChange={(e) => setF({ ...f, inductionDate: e.target.value })} data-testid="cl-induction-date" /></Field>
          <Field label="Medical fitness" name="medicalStatus" error={error}><select value={f.medicalStatus} onChange={(e) => setF({ ...f, medicalStatus: e.target.value })} data-testid="cl-medical">{[['PENDING', 'Pending'], ['FIT', 'Fit'], ['UNFIT', 'Unfit'], ['EXPIRED', 'Expired']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Medical valid until" name="medicalValidUntil" error={error}><input type="date" value={f.medicalValidUntil} onChange={(e) => setF({ ...f, medicalValidUntil: e.target.value })} data-testid="cl-medical-until" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="cl-save">Record clearance</button></div>
        </form>
      )}
      <h2>PPE issued</h2>
      {w.ppe.length === 0 ? <p className="muted">None recorded.</p> : <ul className="mdm-list" data-testid="wp-ppe">{w.ppe.map((p, i) => <li key={i}>{p.item}, {p.issuedOn} ({p.by})</li>)}</ul>}
      {w.can.clear && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => lab.workers.ppe(w.id, { item: ppe.item.trim(), issuedOn: ppe.issuedOn }), 'PPE recorded.'); }}><Field label="Item" name="item" error={error}><input value={ppe.item} onChange={(e) => setPpe({ ...ppe, item: e.target.value })} data-testid="ppe-item" /></Field><Field label="Issued on" name="issuedOn" error={error}><input type="date" value={ppe.issuedOn} onChange={(e) => setPpe({ ...ppe, issuedOn: e.target.value })} /></Field><div className="actions"><button type="submit" className="btn" data-testid="ppe-add">Record PPE</button></div></form>}
    </div>
  );
}

function Actions({ w, refresh }) {
  const [mode, setMode] = useState(null); const [reason, setReason] = useState(''); const [error, setError] = useState(null); const [note, setNote] = useState(new URLSearchParams(window.location.search).get('sent') ? 'Sent for approval.' : null);
  const run = async (fn, done) => { setError(null); setNote(null); try { const out = await fn(); setNote(done); setMode(null); setReason(''); refresh(); return out; } catch (e) { setError(errorInfo(e)); return null; } };
  const c = w.can;
  const go = () => {
    if (mode === 'amend') return run(() => lab.workers.amend(w.id, reason), 'A revision was made: change it and send it for approval.').then((o) => o && navigateTo(`/labour/workers/new?id=${o.id}`));
    const fn = { withdraw: () => lab.workers.withdraw(w.id, reason), cancel: () => lab.workers.cancel(w.id, reason), blacklist: () => lab.workers.blacklist(w.id, reason), unblacklist: () => lab.workers.unblacklist(w.id, reason) }[mode];
    return run(fn, 'Done.');
  };
  return (
    <div data-testid="wp-actions">
      <div className="actions-row">
        {c.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => lab.workers.submit(w.id), 'Sent for approval.')} data-testid="wp-submit">Send for approval</button>}
        {c.edit && <button type="button" className="btn" onClick={() => navigateTo(`/labour/workers/new?id=${w.id}`)} data-testid="wp-edit">{w.status === 'RETURNED' ? 'Correct' : 'Edit'}</button>}
        {c.withdraw && <button type="button" className="btn" onClick={() => setMode('withdraw')} data-testid="wp-withdraw">Withdraw</button>}
        {c.cancel && <button type="button" className="btn" onClick={() => setMode('cancel')} data-testid="wp-cancel">Cancel</button>}
        {c.delete && <button type="button" className="btn" onClick={() => run(() => lab.workers.remove(w.id), 'Deleted.').then(() => navigateTo('/labour/workers'))} data-testid="wp-delete">Delete draft</button>}
        {c.amend && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="wp-amend">Amend</button>}
        {c.blacklist && w.workerStatus === 'ACTIVE' && <button type="button" className="btn" onClick={() => setMode('blacklist')} data-testid="wp-blacklist">Blacklist</button>}
        {c.blacklist && w.workerStatus === 'BLACKLISTED' && <button type="button" className="btn" onClick={() => setMode('unblacklist')} data-testid="wp-unblacklist">Lift the blacklisting</button>}
        {c.print && w.status === 'APPROVED' && w.workerStatus === 'ACTIVE' && <button type="button" className="btn" onClick={() => navigateTo(`/labour/cards?ids=${w.id}`)} data-testid="wp-card">Labour ID card</button>}
        {c.print && <a className="btn" href={`/api/v1/hr/workers/${w.id}/print`} target="_blank" rel="noreferrer" data-testid="wp-print">Print</a>}
      </div>
      {w.blacklistReason && <p className="field-error" data-testid="wp-blacklisted">Blacklisted: {w.blacklistReason}</p>}
      {mode && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); go(); }}><Field label="Reason (required)" name="reason" error={error}><textarea rows="2" required minLength={5} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="wp-reason" /></Field><div className="actions"><button type="button" className="btn" onClick={() => setMode(null)}>Close</button><button type="submit" className="btn btn-primary" data-testid="wp-reason-go">Confirm</button></div></form>}
      {note && <p role="status" className="mdm-banner" data-testid="wp-note-top">{note}</p>}
      {error?.form && !mode && <p className="field-error" role="alert">{error.form}</p>}
    </div>
  );
}
