import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, exp } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Travel Request (HR, part 07.12, FR-01): the purpose of a trip, the project, from and to, the dates, the mode, the estimated cost and the advance wanted. The manager approves, then the project manager (the department head when there is no
// project). An approved request is the basis of a travel advance and of the claim for the trip.
const MODES = ['TRAIN', 'BUS', 'FLIGHT', 'CAR', 'BIKE', 'SITE_VEHICLE', 'OTHER'];
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', CLOSED: 'CLOSED' };
export default function TravelRequestPage() {
  const t = useT('exp');
  const qc = useQueryClient();
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const q = useQuery({ queryKey: ['exp', 'travel', id], queryFn: () => exp.travel(id), enabled: Boolean(id), retry: false });
  const h = useQuery({ queryKey: ['exp', 'travel-history', id], queryFn: () => exp.travelHistory(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [v, setV] = useState({ purpose: '', fromPlace: '', toPlace: '', startDate: dayIST(3), endDate: dayIST(4), mode: 'TRAIN', estCost: '', advance: '', projectId: '' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const loaded = useRef(false);
  // Part 09: one save at a time; the second click of a double click (which can land on the other button once the message above moves) is ignored
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const r = q.data;
  usePageTitle(r ? r.docNo : t('travel.title'));
  useEffect(() => { if (r && !loaded.current) { loaded.current = true; setV({ purpose: r.purpose, fromPlace: r.fromPlace, toPlace: r.toPlace, startDate: r.startDate, endDate: r.endDate, mode: r.mode, estCost: String(r.estCost), advance: r.advance ? String(r.advance) : '', projectId: r.projectId ? String(r.projectId) : '' }); } }, [r]);
  if (id && q.error?.status === 403) return <NoPermission what={t('travel.title')} permission="hr.travel_request.view" />;
  if (id && q.isPending) return <Skeleton label={t('travel.title')} rows={4} />;
  if (id && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const editable = !id || r.can.edit;
  const body = () => ({ purpose: v.purpose.trim(), fromPlace: v.fromPlace.trim(), toPlace: v.toPlace.trim(), startDate: v.startDate, endDate: v.endDate, mode: v.mode, estCost: Number(v.estCost || 0), advance: Number(v.advance || 0), projectId: v.projectId ? Number(v.projectId) : null });
  const run = async (fn, done) => { if (busyRef.current) return null; busyRef.current = true; setBusy(true); setError(null); setNote(null); try { const out = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['exp'] }); return out; } catch (e) { setError(errorInfo(e)); return null; } finally { busyRef.current = false; setBusy(false); } };
  const save = (submit) => run(async () => { const out = id ? await exp.updateTravel(id, { ...body(), version: r.rowVersion }) : await exp.createTravel({ ...body(), submit }); if (id && submit) await exp.travelAct(id, 'submit'); if (!id) navigateTo(`/expenses/travel?id=${out.id}`, { force: true }); else loaded.current = false; return out; }, submit ? t('travel.sent') : t('travel.saved'));
  return (
    <section aria-labelledby="tr-title" data-testid="travel" data-status={r?.status ?? 'NEW'}>
      <PageHeader id="tr-title" title={r ? <>{r.docNo} <StatusBadge status={TONE[r.status]} label={t(`tst.${r.status}`)} /></> : t('travel.title')} />
      {error?.form && <p className="field-error" role="alert" data-testid="tr-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="tr-note">{note}</p>}
      <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }} data-testid="tr-form" aria-label={t('travel.title')}>
        <Field label={t('claim.purpose')} name="purpose" error={error}><textarea rows="2" value={v.purpose} maxLength={300} disabled={!editable} onChange={(e) => setV({ ...v, purpose: e.target.value })} required data-testid="tr-purpose" /></Field>
        <LookupField id="tr-project" label={t('claim.project')} lookup="iam/projects" value={v.projectId} onChange={(x) => setV({ ...v, projectId: x })} readOnly={!editable} hint={t('travel.projectHint')} />
        <Field label={t('travel.fromPlace')} name="fromPlace" error={error}><input value={v.fromPlace} maxLength={80} disabled={!editable} onChange={(e) => setV({ ...v, fromPlace: e.target.value })} required data-testid="tr-from" /></Field>
        <Field label={t('travel.toPlace')} name="toPlace" error={error}><input value={v.toPlace} maxLength={80} disabled={!editable} onChange={(e) => setV({ ...v, toPlace: e.target.value })} required data-testid="tr-to" /></Field>
        <Field label={t('travel.start')} name="startDate" error={error}><input type="date" value={v.startDate} disabled={!editable} onChange={(e) => setV({ ...v, startDate: e.target.value })} data-testid="tr-start" /></Field>
        <Field label={t('travel.end')} name="endDate" error={error}><input type="date" value={v.endDate} disabled={!editable} onChange={(e) => setV({ ...v, endDate: e.target.value })} data-testid="tr-end" /></Field>
        <Field label={t('travel.mode')} name="mode" error={error}><select value={v.mode} disabled={!editable} onChange={(e) => setV({ ...v, mode: e.target.value })} data-testid="tr-mode">{MODES.map((m) => <option key={m} value={m}>{t(`mode.${m}`)}</option>)}</select></Field>
        <Field label={t('travel.estCost')} name="estCost" error={error}><input type="number" min="0" step="0.01" value={v.estCost} disabled={!editable} onChange={(e) => setV({ ...v, estCost: e.target.value })} required data-testid="tr-cost" /></Field>
        <Field label={t('travel.advance')} name="advance" error={error} hint={t('travel.advanceHint')}><input type="number" min="0" step="0.01" value={v.advance} disabled={!editable} onChange={(e) => setV({ ...v, advance: e.target.value })} data-testid="tr-advance" /></Field>
        {editable && <div className="actions"><button type="submit" className="btn" disabled={busy} data-testid="tr-save">{t('act.saveDraft')}</button><button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={busy} data-testid="tr-send">{t('act.saveSend')}</button></div>}
      </form>
      {r && (
        <div className="actions-row no-print" data-testid="tr-actions">
          {r.can.delete && <button type="button" className="btn" onClick={() => run(async () => { await exp.removeTravel(id); navigateTo('/expenses', { force: true }); })} data-testid="tr-delete">{t('act.delete')}</button>}
          {r.can.withdraw && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('act.why')); if (why) run(() => exp.travelAct(id, 'withdraw', { reason: why })); }} data-testid="tr-withdraw">{t('act.withdraw')}</button>}
          {r.can.cancel && <button type="button" className="btn" onClick={() => { const why = window.prompt(t('act.why')); if (why) run(() => exp.travelAct(id, 'cancel', { reason: why })); }} data-testid="tr-cancel">{t('act.cancel')}</button>}
          {r.can.advance && <a className="btn" href={`/expenses/advance?travel=${id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/expenses/advance?travel=${id}`); }} data-testid="tr-ask-advance">{t('travel.askAdvance')}</a>}
          {r.can.claim && <a className="btn btn-primary" href={`/expenses/claim?travel=${id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/expenses/claim?travel=${id}`); }} data-testid="tr-claim">{t('travel.makeClaim')}</a>}
          {r.can.print && <a className="btn" href={`/api/v1/hr/travel-requests/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>
      )}
      {h.data && (h.data.approvals.length > 0 || h.data.audit.length > 0) && <><h2>{t('act.history')}</h2><ul className="mdm-list" data-testid="tr-history">{[...h.data.approvals.map((a) => ({ at: a.at, text: `${a.event} · ${a.actor}${a.comment ? `: ${a.comment}` : ''}` })), ...h.data.audit.map((a) => ({ at: a.at, text: `${a.action} · ${a.by}${a.reason ? `: ${a.reason}` : ''}` }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((x, i) => <li key={i}><span className="muted small">{String(x.at).slice(0, 16).replace('T', ' ')}</span> {x.text}</li>)}</ul></>}
      <p className="small"><Link to="/expenses">{t('my.title')}</Link></p>
    </section>
  );
}
