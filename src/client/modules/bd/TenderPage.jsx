import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { BID_TYPES, PORTALS, REGIONS, bd, inr, tdr } from './api.js';
import { Tabs, TimelinePanel } from './parts.jsx';
import { AddendaTab, DocumentsTab, EligibilityTab, QueriesTab, ReadinessPanel, TasksTab } from './TenderParts.jsx';

// Tender (business development, part 08.02): the tender register entry: authority (from the partner master), reference and portal, name of work, place, estimated cost, EMD and fee, bid type, completion period and the key dates; the bid capacity worked out by the
// calculation engine; the eligibility checklist; the bid or no-bid decision; the documents, the addenda, the pre-bid queries and the team's tasks. A colleague of the estimation team approves the registration; a tender is ready for submission only when the decision is
// approved, the eligibility is complete and every addendum is read (BR-01).
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const STAGE_TONE = { OPEN: 'IN_REVIEW', BID: 'ACTIVE', READY: 'COMPLETED', NO_BID: 'CANCELLED', SUBMITTED: 'COMPLETED', CLOSED: 'CANCELLED' };
const blank = () => ({ clientPartnerId: '', referenceNo: '', portal: 'CPPP', portalName: '', nameOfWork: '', location: '', region: '', estCost: '', emd: '', tenderFee: '', bidType: 'ITEM_RATE', periodMonths: '12', publishDate: '', prebidDate: '', submissionAt: '', openingAt: '', owner: '' });
const fromTender = (x) => ({ clientPartnerId: x.clientPartnerId, referenceNo: x.referenceNo ?? '', portal: x.portal, portalName: x.portalName ?? '', nameOfWork: x.nameOfWork, location: x.location ?? '', region: x.region ?? '', estCost: String(x.estCost ?? ''), emd: String(x.emd ?? ''), tenderFee: String(x.tenderFee ?? ''), bidType: x.bidType, periodMonths: String(x.periodMonths), publishDate: x.publishDate ?? '', prebidDate: x.prebidDate ?? '', submissionAt: x.submissionAt ?? '', openingAt: x.openingAt ?? '', owner: x.owner });
const body = (v) => ({ clientPartnerId: Number(v.clientPartnerId), referenceNo: v.referenceNo.trim() || null, portal: v.portal, portalName: v.portalName.trim() || null, nameOfWork: v.nameOfWork.trim(), location: v.location.trim() || null, region: v.region || null, estCost: Number(v.estCost || 0), emd: Number(v.emd || 0), tenderFee: Number(v.tenderFee || 0), bidType: v.bidType, periodMonths: Number(v.periodMonths || 12), publishDate: v.publishDate || null, prebidDate: v.prebidDate || null, submissionAt: v.submissionAt || null, openingAt: v.openingAt || null, ...(v.owner ? { owner: v.owner } : {}) });

export default function TenderPage({ create = false }) {
  const t = useT('bd');
  const qc = useQueryClient();
  const params = new URLSearchParams(window.location.search);
  const id = Number(params.get('id')) || null; const fromOpp = Number(params.get('opportunityId')) || null;
  const q = useQuery({ queryKey: ['bd', 'tender', id], queryFn: () => tdr.tender(id), enabled: Boolean(id) && !create, retry: false });
  const x = q.data;
  usePageTitle(create ? t('td.new') : x ? x.docNo : t('td.title'));
  const [v, setV] = useState(blank); const [mode, setMode] = useState(create ? 'form' : 'view'); const [reason, setReason] = useState('');
  const [tab, setTab] = useState('details'); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [cap, setCap] = useState({ bcTurnover: '', bcCommitments: '' });
  useEffect(() => { if (x && mode === 'view') { setV(fromTender(x)); setCap({ bcTurnover: x.bcTurnover == null ? '' : String(x.bcTurnover), bcCommitments: x.bcCommitments == null ? '' : String(x.bcCommitments) }); } }, [x, mode]);
  useEffect(() => { if (create && fromOpp) bd.opp(fromOpp).then((o) => setV((p) => ({ ...p, clientPartnerId: o.clientPartnerId, nameOfWork: o.name, location: o.location ?? '', region: o.region ?? '', estCost: String(o.estValue ?? ''), opportunityId: o.id }))).catch(() => {}); }, [create, fromOpp]);
  if (!create && !id) return <ErrorState error={new Error(t('td.noId'))} />;
  if (!create && q.error?.status === 403) return <NoPermission what={t('td.title')} permission="bd.tender.view" />;
  if (!create && q.isPending) return <Skeleton label={t('td.title')} rows={5} />;
  if (!create && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const set = (k, val) => setV({ ...v, [k]: val });
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const save = async (submit) => {
    if (create) { const r = await run(() => tdr.createTender({ ...body(v), ...(v.opportunityId ? { opportunityId: v.opportunityId } : {}), submit })); if (r?.id) navigateTo(`/bd/tender?id=${r.id}`, { force: true }); return; }
    if (mode === 'amend') { const r = await run(() => tdr.tenderAct(id, 'amend', { ...body(v), reason, version: x.rowVersion }), t('td.amended')); if (r) setMode('view'); return; }
    const r = await run(() => tdr.updateTender(id, { ...body(v), version: x.rowVersion }), t('act.saved')); if (r) { setMode('view'); if (submit) await run(() => tdr.tenderAct(id, 'submit', {}), t('td.sent')); }
  };
  const editing = mode !== 'view'; const ro = !editing;
  const form = (
    <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }} data-testid="tender-form" aria-label={t('td.title')}>
      <LookupField id="td-client" label={t('td.authority')} lookup="bd/clients" value={v.clientPartnerId} onChange={(val) => set('clientPartnerId', val)} disabled={ro} error={error?.fields?.clientPartnerId} hint={t('opp.clientHint')} required />
      <Field label={t('td.reference')} name="referenceNo" error={error}><input value={v.referenceNo} readOnly={ro} onChange={(e) => set('referenceNo', e.target.value)} data-testid="td-reference" /></Field>
      <Field label={t('td.portal')} name="portal" error={error}><select value={v.portal} disabled={ro} onChange={(e) => set('portal', e.target.value)} data-testid="td-portal">{PORTALS.map((k) => <option key={k} value={k}>{t(`portal.${k}`)}</option>)}</select></Field>
      <Field label={t('td.portalName')} name="portalName" error={error}><input value={v.portalName} readOnly={ro} onChange={(e) => set('portalName', e.target.value)} /></Field>
      <Field label={t('td.nameOfWork')} name="nameOfWork" error={error}><textarea rows="2" value={v.nameOfWork} readOnly={ro} maxLength={300} onChange={(e) => set('nameOfWork', e.target.value)} required data-testid="td-name" /></Field>
      <Field label={t('lead.location')} name="location" error={error}><input value={v.location} readOnly={ro} onChange={(e) => set('location', e.target.value)} data-testid="td-location" /></Field>
      <Field label={t('lead.region')} name="region" error={error}><select value={v.region} disabled={ro} onChange={(e) => set('region', e.target.value)}><option value="">–</option>{REGIONS.map((k) => <option key={k} value={k}>{t(`region.${k}`)}</option>)}</select></Field>
      <Field label={t('td.estCost')} name="estCost" error={error}><input type="number" min="0" step="0.01" inputMode="decimal" value={v.estCost} readOnly={ro} onChange={(e) => set('estCost', e.target.value)} data-testid="td-cost" /></Field>
      <Field label={t('td.emd')} name="emd" error={error}><input type="number" min="0" step="0.01" inputMode="decimal" value={v.emd} readOnly={ro} onChange={(e) => set('emd', e.target.value)} data-testid="td-emd" /></Field>
      <Field label={t('td.fee')} name="tenderFee" error={error}><input type="number" min="0" step="0.01" inputMode="decimal" value={v.tenderFee} readOnly={ro} onChange={(e) => set('tenderFee', e.target.value)} data-testid="td-fee" /></Field>
      <Field label={t('td.bidType')} name="bidType" error={error}><select value={v.bidType} disabled={ro} onChange={(e) => set('bidType', e.target.value)} data-testid="td-bidtype">{BID_TYPES.map((k) => <option key={k} value={k}>{t(`bidtype.${k}`)}</option>)}</select></Field>
      <Field label={t('td.period')} name="periodMonths" error={error}><input type="number" min="1" max="240" value={v.periodMonths} readOnly={ro} onChange={(e) => set('periodMonths', e.target.value)} data-testid="td-period" /></Field>
      <Field label={t('td.publish')} name="publishDate" error={error}><input type="date" value={v.publishDate} readOnly={ro} onChange={(e) => set('publishDate', e.target.value)} data-testid="td-publish" /></Field>
      <Field label={t('td.prebid')} name="prebidDate" error={error}><input type="date" value={v.prebidDate} readOnly={ro} onChange={(e) => set('prebidDate', e.target.value)} data-testid="td-prebid" /></Field>
      <Field label={t('td.submission')} name="submissionAt" error={error}><input type="datetime-local" value={v.submissionAt} readOnly={ro} onChange={(e) => set('submissionAt', e.target.value)} data-testid="td-submission" /></Field>
      <Field label={t('td.opening')} name="openingAt" error={error}><input type="datetime-local" value={v.openingAt} readOnly={ro} onChange={(e) => set('openingAt', e.target.value)} data-testid="td-opening" /></Field>
      <LookupField id="td-owner" label={t('lead.owner')} lookup="bd/owners" valueKey="code" value={v.owner} onChange={(val) => set('owner', val)} disabled={ro} />
      {mode === 'amend' && <Field label={t('act.amendReason')} name="reason" error={error}><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} required data-testid="td-amend-reason" /></Field>}
      {editing && <div className="actions"><button type="button" className="btn" onClick={() => (create ? navigateTo('/bd/tenders') : (setMode('view'), setV(fromTender(x))))}>{t('act.close')}</button><button type="submit" className="btn" data-testid="td-save">{mode === 'amend' ? t('act.saveAmend') : t('act.saveDraft')}</button>{mode !== 'amend' && <button type="button" className="btn btn-primary" onClick={() => save(true)} data-testid="td-save-send">{t('td.saveSend')}</button>}</div>}
    </form>
  );
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="td-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>;
  if (create) return (<section aria-labelledby="td-title-h" data-testid="tender-new"><h1 id="td-title-h">{t('td.new')}</h1>{errBox}{form}<p className="small"><Link to="/bd/tenders">{t('tenders.title')}</Link></p></section>);
  const days = x.daysToSubmission;
  return (
    <section aria-labelledby="td-title-h" data-testid="tender" data-status={x.status} data-stage={x.stage}>
      <header>
        <h1 id="td-title-h">{x.nameOfWork} <StatusBadge status={STAGE_TONE[x.stage] ?? 'ACTIVE'} label={x.stageLabel} /> <StatusBadge status={TONE[x.status]} label={x.statusLabel} /></h1>
        <p className="muted">{x.docNo} · {x.referenceNo ?? t('td.noReference')} · <Link to={`/bd/client?id=${x.clientPartnerId}`}>{x.clientName}</Link> · {x.portalLabel}</p>
        <dl className="op-figures" data-testid="td-figures">
          <div><dt>{t('td.estCost')}</dt><dd data-testid="td-fig-cost">{inr(x.estCost)}</dd></div><div><dt>{t('td.emd')}</dt><dd>{inr(x.emd)}</dd></div>
          <div><dt>{t('td.bidCapacity')}</dt><dd data-testid="td-fig-capacity" className={x.bidCapacity != null && x.bidCapacity < x.estCost ? 'field-error' : ''}>{inr(x.bidCapacity)}</dd></div>
          <div><dt>{t('td.submission')}</dt><dd data-testid="td-fig-submission">{x.submissionAt ? x.submissionAt.replace('T', ' ') : '—'}{days != null && <span className={days <= 3 ? 'field-error small' : 'muted small'}> {days < 0 ? t('td.passed') : t('td.daysLeft', { n: days })}</span>}</dd></div>
          <div><dt>{t('lead.owner')}</dt><dd>{x.owner}</dd></div>
        </dl>
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="td-note">{note}</p>}
        <div className="actions-row no-print" data-testid="td-actions">
          {x.can.edit && !editing && <button type="button" className="btn" onClick={() => setMode('form')} data-testid="td-edit">{t('act.edit')}</button>}
          {x.can.submit && !editing && <button type="button" className="btn btn-primary" onClick={() => run(() => tdr.tenderAct(id, 'submit', {}), t('td.sent'))} data-testid="td-submit">{t('td.send')}</button>}
          {x.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => tdr.tenderAct(id, 'withdraw', { reason: r }), t('act.withdrawn'))} data-testid="td-withdraw">{t('act.withdraw')}</button>}
          {x.can.amend && !editing && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="td-amend">{t('act.amend')}</button>}
          {x.can.decide && <Link to={`/bd/bid-decision?tenderId=${id}`} className="btn btn-primary" data-testid="td-decide">{t('td.evaluate')}</Link>}
          {x.can.ready && <button type="button" className="btn btn-primary" onClick={() => run(() => tdr.tenderAct(id, 'ready', {}), t('td.markedReady'))} data-testid="td-ready">{t('td.markReady')}</button>}
          {x.can.unready && <button type="button" className="btn" onClick={() => why((r) => tdr.tenderAct(id, 'unready', { reason: r }), t('td.takenBack'))} data-testid="td-unready">{t('td.takeBack')}</button>}
          {x.can.cancel && <button type="button" className="btn" onClick={() => why((r) => tdr.tenderAct(id, 'cancel', { reason: r }), t('act.cancelled'))} data-testid="td-cancel">{t('act.cancel')}</button>}
          {x.can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('act.confirmDelete'))) { const r = await run(() => tdr.deleteTender(id)); if (r) navigateTo('/bd/tenders', { force: true }); } }} data-testid="td-delete">{t('act.delete')}</button>}
          {x.can.print && <a className="btn" href={`/api/v1/bd/tenders/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>
      </header>
      <Tabs tabs={['details', 'eligibility', 'decision', 'documents', 'addenda', 'queries', 'tasks', 'approvals', 'related']} active={tab} onChange={setTab} label={t('td.title')} />
      {tab === 'details' && (<>
        {form}
        {x.status === 'APPROVED' && <ReadinessPanel readiness={x.readiness} />}
        {x.capacity && (
          <div className="mdm-panel" data-testid="capacity">
            <h2>{t('td.capacityTitle')}</h2>
            <p className="muted">{t('td.capacityFormula', { a: inr(x.capacity.a / 100), n: x.capacity.years, f: x.capacity.factor, b: inr(x.capacity.b / 100) })}</p>
            <p data-testid="capacity-result"><strong>{inr(x.bidCapacity)}</strong> — {x.bidCapacity >= x.estCost ? t('td.capacityOk') : t('td.capacityShort')}</p>
            {x.can.track && (
              <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => tdr.tenderAct(id, 'track', { bcTurnover: cap.bcTurnover === '' ? null : Number(cap.bcTurnover), bcCommitments: cap.bcCommitments === '' ? null : Number(cap.bcCommitments), version: x.rowVersion }), t('td.capacityWorked')); }} data-testid="capacity-form" aria-label={t('td.capacityTitle')}>
                <Field label={t('td.turnoverA')} name="bcTurnover" error={error} hint={t('td.profileHint')}><input type="number" min="0" step="0.01" value={cap.bcTurnover} onChange={(e) => setCap({ ...cap, bcTurnover: e.target.value })} data-testid="cap-turnover" /></Field>
                <Field label={t('td.commitmentsB')} name="bcCommitments" error={error}><input type="number" min="0" step="0.01" value={cap.bcCommitments} onChange={(e) => setCap({ ...cap, bcCommitments: e.target.value })} data-testid="cap-commitments" /></Field>
                <div className="actions"><button type="submit" className="btn" data-testid="cap-save">{t('td.work')}</button></div>
              </form>)}
          </div>)}
      </>)}
      {tab === 'eligibility' && <EligibilityTab tender={x} run={run} error={error} />}
      {tab === 'decision' && (
        <div data-testid="decision-tab">
          {x.decision ? <p>{t('td.decisionIs', { no: x.decision.docNo, decision: t(`decision.${x.decision.decision}`), score: x.decision.totalScore, status: x.decision.status })} <Link to={`/bd/bid-decision?id=${x.decision.id}`} data-testid="td-decision-link">{x.decision.docNo}</Link></p> : <p className="muted">{t('td.noDecision')}</p>}
          {x.can.decide && <Link to={`/bd/bid-decision?tenderId=${id}`} className="btn btn-primary">{t('td.evaluate')}</Link>}
        </div>)}
      {tab === 'documents' && <DocumentsTab tender={x} run={run} error={error} />}
      {tab === 'addenda' && <AddendaTab tender={x} run={run} error={error} />}
      {tab === 'queries' && <QueriesTab tender={x} run={run} error={error} />}
      {tab === 'tasks' && <TasksTab tender={x} run={run} error={error} />}
      {tab === 'approvals' && (<><TimelinePanel kind={`tender-${id}-${x.rowVersion}`} load={() => tdr.tenderHistory(id)} />{x.amendments.length > 0 && <div data-testid="amendments"><h2>{t('lead.amendments')}</h2>{x.amendments.map((a) => <p key={a.no}>#{a.no} · {a.by} · {a.reason} — {t('lead.before', { value: inr(a.before.estCost) })}</p>)}</div>}</>)}
      {tab === 'related' && <ul className="mdm-list" data-testid="related">{x.related.map((r) => <li key={r.type + r.id}>{r.type}: <Link to={r.route}>{r.ref}</Link></li>)}</ul>}
      <p className="small"><Link to="/bd/tenders">{t('tenders.title')}</Link> · <Link to="/bd/tender-calendar">{t('cal.title')}</Link></p>
    </section>
  );
}
