import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { OPEN_STAGES, REGIONS, SECTORS, bd, inr } from './api.js';
import { InteractionsPanel, Tabs, TimelinePanel } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Opportunity (business development, part 08.01, FR-04, FR-06, BR-01, BR-02): the client from the partner master, the project, sector, place, estimated value, probability, expected tender and award dates, stage, competitors and owner. Two things are kept apart:
// the go-ahead for tendering (an approval: a business development review, and the director above ₹10 crore) and the stage in the pipeline (moved by the owner; a stage that pursues a tender needs the go-ahead). The probability follows the stage unless the person gives a reason.
// A win comes only from a tender award or from a direct award the director approves. An approved opportunity is converted to a tender (08.02).
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED' };
const STAGE_TONE = { WON: 'COMPLETED', LOST: 'REJECTED' };
const blank = () => ({ clientPartnerId: '', name: '', sector: 'ROADS', location: '', region: '', estValue: '', stage: 'IDENTIFIED', expectedTenderDate: '', expectedAwardDate: '', owner: '', probability: '', probabilityReason: '' });
const fromOpp = (o) => ({ clientPartnerId: o.clientPartnerId, name: o.name, sector: o.sector, location: o.location ?? '', region: o.region ?? '', estValue: String(o.estValue ?? ''), stage: o.stage, expectedTenderDate: o.expectedTenderDate ?? '', expectedAwardDate: o.expectedAwardDate ?? '', owner: o.owner, probability: String(o.probability), probabilityReason: o.probabilityReason ?? '' });
const body = (v, { withStage = false } = {}) => ({ clientPartnerId: Number(v.clientPartnerId), name: v.name.trim(), sector: v.sector, location: v.location.trim() || null, region: v.region || null, estValue: Number(v.estValue || 0), expectedTenderDate: v.expectedTenderDate || null, expectedAwardDate: v.expectedAwardDate || null, ...(v.owner ? { owner: v.owner } : {}), ...(withStage ? { stage: v.stage } : {}), ...(v.probability !== '' ? { probability: Number(v.probability), ...(v.probabilityReason.trim() ? { probabilityReason: v.probabilityReason.trim() } : {}) } : {}) });

export default function OpportunityPage({ create = false }) {
  const t = useT('bd');
  const qc = useQueryClient();
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  const q = useQuery({ queryKey: ['bd', 'opp', id], queryFn: () => bd.opp(id), enabled: Boolean(id) && !create, retry: false });
  const o = q.data;
  usePageTitle(create ? t('opp.new') : o ? o.docNo : t('opp.title'));
  const [v, setV] = useState(blank); const [mode, setMode] = useState(create ? 'form' : 'view'); const [reason, setReason] = useState('');
  const [tab, setTab] = useState('details'); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [tr, setTr] = useState({ stage: '', probability: '', probabilityReason: '', expectedTenderDate: '', expectedAwardDate: '', reason: '' });
  const [comp, setComp] = useState([]); const [lose, setLose] = useState(null); const [award, setAward] = useState(null);
  useEffect(() => { if (o) { if (mode === 'view') setV(fromOpp(o)); setTr({ stage: o.stage, probability: String(o.probability), probabilityReason: o.probabilityReason ?? '', expectedTenderDate: o.expectedTenderDate ?? '', expectedAwardDate: o.expectedAwardDate ?? '', reason: '' }); setComp(o.competitors.map((c) => ({ ...c, note: c.note ?? '' }))); } }, [o, mode]);
  if (!create && !id) return <ErrorState error={new Error(t('opp.noId'))} />;
  if (!create && q.error?.status === 403) return <NoPermission what={t('opp.title')} permission="bd.opportunity.view" />;
  if (!create && q.isPending) return <Skeleton label={t('opp.title')} rows={5} />;
  if (!create && q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const set = (k, x) => setV({ ...v, [k]: x });
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['bd'] }); return r; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const r = window.prompt(t('act.why')); if (r) run(() => fn(r), done); };
  const save = async (submit) => {
    if (create) { const r = await run(() => bd.createOpp({ ...body(v, { withStage: true }), submit })); if (r) navigateTo(`/bd/opportunity?id=${r.id}`, { force: true }); return; }
    if (mode === 'amend') { const r = await run(() => bd.oppAct(id, 'amend', { ...body(v), reason, version: o.rowVersion }), t('opp.amended')); if (r) setMode('view'); return; }
    const r = await run(() => bd.updateOpp(id, { ...body(v), version: o.rowVersion }), t('act.saved')); if (r) { setMode('view'); if (submit) await run(() => bd.oppAct(id, 'submit', {}), t('opp.sent')); }
  };
  const editing = mode !== 'view'; const ro = !editing;
  const stageOptions = create ? ['IDENTIFIED', 'QUALIFIED'] : OPEN_STAGES;
  const form = (
    <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }} data-testid="opp-form" aria-label={t('opp.title')}>
      <LookupField id="op-client" label={t('opp.client')} lookup="bd/clients" value={v.clientPartnerId} onChange={(x) => set('clientPartnerId', x)} disabled={ro} error={error?.fields?.clientPartnerId} hint={t('opp.clientHint')} required />
      <Field label={t('opp.name')} name="name" error={error}><input value={v.name} maxLength={160} readOnly={ro} onChange={(e) => set('name', e.target.value)} required data-testid="op-name" /></Field>
      <Field label={t('lead.sector')} name="sector" error={error}><select value={v.sector} disabled={ro} onChange={(e) => set('sector', e.target.value)} data-testid="op-sector">{SECTORS.map((k) => <option key={k} value={k}>{t(`sector.${k}`)}</option>)}</select></Field>
      <Field label={t('lead.location')} name="location" error={error}><input value={v.location} readOnly={ro} onChange={(e) => set('location', e.target.value)} data-testid="op-location" /></Field>
      <Field label={t('lead.region')} name="region" error={error}><select value={v.region} disabled={ro} onChange={(e) => set('region', e.target.value)} data-testid="op-region"><option value="">–</option>{REGIONS.map((k) => <option key={k} value={k}>{t(`region.${k}`)}</option>)}</select></Field>
      <Field label={t('lead.estValue')} name="estValue" error={error}><input type="number" min="0" step="0.01" inputMode="decimal" value={v.estValue} readOnly={ro} onChange={(e) => set('estValue', e.target.value)} data-testid="op-value" /></Field>
      {create && <Field label={t('opp.stage')} name="stage" error={error}><select value={v.stage} onChange={(e) => set('stage', e.target.value)} data-testid="op-stage">{stageOptions.map((k) => <option key={k} value={k}>{t(`stage.${k}`)}</option>)}</select></Field>}
      {(create || editing) && <><Field label={t('opp.probability')} name="probability" error={error} hint={t('opp.probabilityHint')}><input type="number" min="0" max="100" value={v.probability} onChange={(e) => set('probability', e.target.value)} data-testid="op-probability" /></Field>
        {v.probability !== '' && <Field label={t('opp.probabilityReason')} name="probabilityReason" error={error}><input value={v.probabilityReason} onChange={(e) => set('probabilityReason', e.target.value)} data-testid="op-probability-reason" /></Field>}</>}
      <Field label={t('opp.expectedTender')} name="expectedTenderDate" error={error}><input type="date" value={v.expectedTenderDate} readOnly={ro} onChange={(e) => set('expectedTenderDate', e.target.value)} data-testid="op-tender-date" /></Field>
      <Field label={t('opp.expectedAward')} name="expectedAwardDate" error={error}><input type="date" value={v.expectedAwardDate} readOnly={ro} onChange={(e) => set('expectedAwardDate', e.target.value)} data-testid="op-award-date" /></Field>
      <LookupField id="op-owner" label={t('lead.owner')} lookup="bd/owners" valueKey="code" value={v.owner} onChange={(x) => set('owner', x)} disabled={ro} />
      {mode === 'amend' && <Field label={t('act.amendReason')} name="reason" error={error}><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} required data-testid="op-amend-reason" /></Field>}
      {editing && <div className="actions"><button type="button" className="btn" onClick={() => (create ? navigateTo('/bd/opportunities') : (setMode('view'), setV(fromOpp(o))))}>{t('act.close')}</button><button type="submit" className="btn" data-testid="op-save">{mode === 'amend' ? t('act.saveAmend') : t('act.saveDraft')}</button>{mode !== 'amend' && <button type="button" className="btn btn-primary" onClick={() => save(true)} data-testid="op-save-send">{t('opp.saveSend')}</button>}</div>}
    </form>
  );
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="op-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>;
  if (create) return (<section aria-labelledby="op-title-h" data-testid="opp-new"><PageHeader id="op-title-h" title={t('opp.new')} />{errBox}{form}<p className="small"><Link to="/bd/opportunities">{t('opp.list')}</Link></p></section>);
  const canTrack = o.can.track;
  return (
    <section aria-labelledby="op-title-h" data-testid="opportunity" data-status={o.status} data-stage={o.stage}>
      <header>
        <PageHeader id="op-title-h" title={<>{o.name} <StatusBadge status={STAGE_TONE[o.stage] ?? 'ACTIVE'} label={o.stageLabel} /> <StatusBadge status={TONE[o.status]} label={o.statusLabel} /></>} subtitle={<>{o.docNo} · <Link to={`/bd/client?id=${o.clientPartnerId}`}>{o.clientName}</Link> · {t(`sector.${o.sector}`)} · {[o.location, o.region && t(`region.${o.region}`)].filter(Boolean).join(', ')}</>} />
        <dl className="op-figures" data-testid="op-figures"><div><dt>{t('lead.estValue')}</dt><dd data-testid="op-fig-value">{inr(o.estValue)}</dd></div><div><dt>{t('opp.probability')}</dt><dd data-testid="op-fig-prob">{o.probability}%</dd></div><div><dt>{t('opp.weighted')}</dt><dd data-testid="op-fig-weighted">{inr(o.weighted)}</dd></div><div><dt>{t('opp.expectedAward')}</dt><dd>{o.expectedAwardDate ?? '—'}</dd></div><div><dt>{t('lead.owner')}</dt><dd>{o.owner}</dd></div>{o.wonValue != null && <div><dt>{t('opp.wonValue')}</dt><dd data-testid="op-fig-won">{inr(o.wonValue)}</dd></div>}</dl>
        {o.goAheadPending && <p className="mdm-banner" role="status" data-testid="op-goahead-warning">{t('opp.goAheadPending')}</p>}
        {o.status !== 'APPROVED' && ['DRAFT', 'RETURNED'].includes(o.status) && o.directorNeeded && <p className="muted small">{t('opp.directorNeeded')}</p>}
        {o.awardStatus !== 'NONE' && <p className="muted" data-testid="op-award-status">{o.awardStatusLabel}{o.awardReason ? `: ${o.awardReason}` : ''}</p>}
        {o.stage === 'LOST' && <p data-testid="op-lost">{t('opp.lostBecause', { reason: o.lostReason ?? o.lostReasonCode })}{o.lostTo ? ` · ${t('opp.lostTo', { who: o.lostTo })}` : ''}</p>}
        {errBox}{note && <p className="mdm-banner" role="status" data-testid="op-note">{note}</p>}
        <div className="actions-row no-print" data-testid="op-actions">
          {o.can.edit && !editing && <button type="button" className="btn" onClick={() => setMode('form')} data-testid="op-edit">{t('act.edit')}</button>}
          {o.can.submit && !editing && <button type="button" className="btn btn-primary" onClick={() => run(() => bd.oppAct(id, 'submit', {}), t('opp.sent'))} data-testid="op-submit">{t('opp.askGoAhead')}</button>}
          {o.can.withdraw && <button type="button" className="btn" onClick={() => why((r) => bd.oppAct(id, 'withdraw', { reason: r }), t('act.withdrawn'))} data-testid="op-withdraw">{t('act.withdraw')}</button>}
          {o.can.amend && !editing && <button type="button" className="btn" onClick={() => setMode('amend')} data-testid="op-amend">{t('act.amend')}</button>}
          {o.can.convert && <button type="button" className="btn btn-primary" onClick={() => run(() => bd.oppAct(id, 'convert', { version: o.rowVersion }), t('opp.converted'))} data-testid="op-convert">{t('opp.convert')}</button>}
          {o.can.win && <button type="button" className="btn" onClick={() => setAward({ reason: '', awardValue: String(o.estValue ?? '') })} data-testid="op-win">{t('opp.directAward')}</button>}
          {canTrack && <button type="button" className="btn" onClick={() => setLose({ reasonCode: o.lostReasons?.[0]?.code ?? 'OTHER', reason: '', lostTo: '' })} data-testid="op-lose">{t('opp.markLost')}</button>}
          {o.can.cancel && <button type="button" className="btn" onClick={() => why((r) => bd.oppAct(id, 'cancel', { reason: r }), t('act.cancelled'))} data-testid="op-cancel">{t('act.cancel')}</button>}
          {o.can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('act.confirmDelete'))) { const r = await run(() => bd.deleteOpp(id)); if (r) navigateTo('/bd/opportunities', { force: true }); } }} data-testid="op-delete">{t('act.delete')}</button>}
          {o.can.print && <a className="btn" href={`/api/v1/bd/opportunities/${id}/print`} target="_blank" rel="noreferrer">{t('act.print')}</a>}
        </div>
        {lose && (
          <form className="mdm-panel mdm-fields" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bd.oppAct(id, 'lose', { reasonCode: lose.reasonCode, reason: lose.reason.trim() || null, lostTo: lose.lostTo.trim() || null, version: o.rowVersion }), t('opp.lost')); if (r) setLose(null); }} data-testid="op-lose-form" aria-label={t('opp.markLost')}>
            <Field label={t('opp.lostReasonCode')} name="reasonCode" error={error}><select value={lose.reasonCode} onChange={(e) => setLose({ ...lose, reasonCode: e.target.value })} data-testid="op-lose-code">{o.lostReasons.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
            <Field label={t('opp.lostReason')} name="reason" error={error}><textarea rows="2" value={lose.reason} onChange={(e) => setLose({ ...lose, reason: e.target.value })} data-testid="op-lose-reason" /></Field>
            <Field label={t('opp.lostToLabel')} name="lostTo" error={error}><input value={lose.lostTo} onChange={(e) => setLose({ ...lose, lostTo: e.target.value })} data-testid="op-lose-to" /></Field>
            <div className="actions"><button type="button" className="btn" onClick={() => setLose(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="op-lose-save">{t('opp.markLost')}</button></div>
          </form>)}
        {award && (
          <form className="mdm-panel mdm-fields" onSubmit={async (e) => { e.preventDefault(); const r = await run(() => bd.oppAct(id, 'direct-award', { reason: award.reason.trim(), awardValue: Number(award.awardValue), version: o.rowVersion }), t('opp.awardSent')); if (r) setAward(null); }} data-testid="op-award-form" aria-label={t('opp.directAward')}>
            <p className="muted">{t('opp.directAwardHint')}</p>
            <Field label={t('opp.awardReason')} name="reason" error={error}><textarea rows="2" value={award.reason} onChange={(e) => setAward({ ...award, reason: e.target.value })} required data-testid="op-award-reason" /></Field>
            <Field label={t('opp.awardValue')} name="awardValue" error={error}><input type="number" min="0" step="0.01" value={award.awardValue} onChange={(e) => setAward({ ...award, awardValue: e.target.value })} required data-testid="op-award-value" /></Field>
            <div className="actions"><button type="button" className="btn" onClick={() => setAward(null)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="op-award-save">{t('opp.sendAward')}</button></div>
          </form>)}
      </header>
      <Tabs tabs={['details', 'pipeline', 'interactions', 'documents', 'competitors', 'approvals', 'related']} active={tab} onChange={setTab} label={t('opp.title')} />
      {tab === 'details' && form}
      {tab === 'pipeline' && (
        <div data-testid="pipeline-panel">
          {canTrack ? (
            <form className="mdm-panel mdm-fields" onSubmit={async (e) => { e.preventDefault(); const stageChanged = tr.stage !== o.stage; const asked = tr.probability === '' ? undefined : Number(tr.probability); const probChanged = asked !== undefined && (asked !== o.probability || (tr.probabilityReason || '') !== (o.probabilityReason || ''));
              await run(() => bd.oppAct(id, 'track', { stage: stageChanged ? tr.stage : undefined, ...(probChanged ? { probability: asked, probabilityReason: tr.probabilityReason.trim() || undefined } : {}), expectedTenderDate: tr.expectedTenderDate || null, expectedAwardDate: tr.expectedAwardDate || null, reason: tr.reason.trim() || undefined, version: o.rowVersion }), t('opp.tracked')); }} data-testid="op-track-form" aria-label={t('tab.pipeline')}>
              <Field label={t('opp.stage')} name="stage" error={error}><select value={tr.stage} onChange={(e) => setTr({ ...tr, stage: e.target.value, probability: '', probabilityReason: '' })} data-testid="op-track-stage">{OPEN_STAGES.map((k) => <option key={k} value={k}>{t(`stage.${k}`)}</option>)}</select></Field>
              <Field label={t('opp.probability')} name="probability" error={error} hint={t('opp.probabilityHint')}><input type="number" min="0" max="100" value={tr.probability} placeholder={tr.stage !== o.stage ? t('opp.defaultOfStage') : ''} onChange={(e) => setTr({ ...tr, probability: e.target.value })} data-testid="op-track-prob" /></Field>
              <Field label={t('opp.probabilityReason')} name="probabilityReason" error={error}><input value={tr.probabilityReason} onChange={(e) => setTr({ ...tr, probabilityReason: e.target.value })} data-testid="op-track-prob-reason" /></Field>
              <Field label={t('opp.expectedTender')} name="expectedTenderDate" error={error}><input type="date" value={tr.expectedTenderDate} onChange={(e) => setTr({ ...tr, expectedTenderDate: e.target.value })} data-testid="op-track-tender" /></Field>
              <Field label={t('opp.expectedAward')} name="expectedAwardDate" error={error}><input type="date" value={tr.expectedAwardDate} onChange={(e) => setTr({ ...tr, expectedAwardDate: e.target.value })} data-testid="op-track-award" /></Field>
              <Field label={t('opp.moveReason')} name="reason" error={error}><input value={tr.reason} onChange={(e) => setTr({ ...tr, reason: e.target.value })} data-testid="op-track-reason" /></Field>
              <div className="actions"><button type="submit" className="btn btn-primary" data-testid="op-track-save">{t('act.save')}</button></div>
            </form>
          ) : <p className="muted">{t('opp.notTrackable')}</p>}
          <TimelinePanel kind={`opp-stage-${id}-${o.rowVersion}`} load={() => bd.oppHistory(id)} />
        </div>)}
      {tab === 'interactions' && <InteractionsPanel entity="OPPORTUNITY" entityId={id} canLog={o.can.interact} />}
      {tab === 'documents' && <div data-testid="documents"><AttachmentList entity="bd_opportunity" entityId={id} canEdit={canTrack} />{canTrack && <FileUploader entity="bd_opportunity" entityId={id} />}</div>}
      {tab === 'competitors' && (
        <div data-testid="competitors">
          {comp.length === 0 && <p className="muted">{t('comp.none')}</p>}
          {comp.map((c, i) => (
            <div key={i} className="mdm-panel mdm-fields" data-testid="comp-row">
              <Field label={t('comp.name')} name={`c${i}`} error={null}><input value={c.name} readOnly={!canTrack} onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-testid="comp-name" /></Field>
              <Field label={t('comp.strength')} name={`s${i}`} error={null}><select value={c.strength} disabled={!canTrack} onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, strength: e.target.value } : x)))} data-testid="comp-strength">{['STRONG', 'AVERAGE', 'WEAK'].map((k) => <option key={k} value={k}>{t(`strength.${k}`)}</option>)}</select></Field>
              <label className="check"><input type="checkbox" checked={Boolean(c.incumbent)} disabled={!canTrack} onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, incumbent: e.target.checked } : x)))} /> {t('comp.incumbent')}</label>
              <Field label={t('comp.note')} name={`n${i}`} error={null}><input value={c.note} readOnly={!canTrack} onChange={(e) => setComp(comp.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} /></Field>
              {canTrack && <button type="button" className="btn btn-small" onClick={() => setComp(comp.filter((_, j) => j !== i))}>{t('act.remove')}</button>}
            </div>))}
          {canTrack && <div className="actions"><button type="button" className="btn" onClick={() => setComp([...comp, { name: '', strength: 'AVERAGE', incumbent: false, note: '' }])} data-testid="comp-add">{t('comp.add')}</button><button type="button" className="btn btn-primary" onClick={() => run(() => bd.oppAct(id, 'track', { competitors: comp.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), strength: c.strength, incumbent: Boolean(c.incumbent), note: c.note.trim() || null })), version: o.rowVersion }), t('comp.saved'))} data-testid="comp-save">{t('act.save')}</button></div>}
        </div>)}
      {tab === 'approvals' && (<><TimelinePanel kind={`opp-${id}-${o.rowVersion}`} load={() => bd.oppHistory(id)} />{o.amendments.length > 0 && <div data-testid="amendments"><h2>{t('lead.amendments')}</h2>{o.amendments.map((a) => <p key={a.no}>#{a.no} · {a.by} · {a.reason} — {t('lead.before', { value: inr(a.before.estValue) })}</p>)}</div>}</>)}
      {tab === 'related' && (<ul className="mdm-list" data-testid="related">{o.related.map((r) => <li key={r.type + r.id}>{r.type}: {r.route ? <Link to={r.route}>{r.ref}</Link> : r.ref}</li>)}</ul>)}
      <p className="small"><Link to="/bd/opportunities">{t('opp.list')}</Link> · <Link to="/bd/pipeline">{t('pipe.title')}</Link></p>
    </section>
  );
}
