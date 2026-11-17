import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { Tabs } from '../proj/parts.jsx';
import { ep, openPrint } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Deliverable (part 11.04): the milestones with plan and actual, the IFC release, the client comment resolution sheet per revision and the holds.
const TABS = ['milestones', 'crs', 'holds'];
export default function DeliverablePage() {
  const t = useT('engg');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['engg', 'deliverable', id], queryFn: () => ep.deliverable(id), enabled: Boolean(id), retry: false });
  const [tab, setTab] = useState('milestones'); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [cm, setCm] = useState({ revision: 'A', comment: '' }); const [reply, setReply] = useState({}); const [hold, setHold] = useState({ description: '', impactProcurement: false, impactConstruction: false, poRef: '', activityRef: '' });
  usePageTitle(q.data ? `${q.data.deliverableNo} ${q.data.title}` : t('del.title'));
  if (!id) return <section aria-labelledby="del-h" data-testid="del-none"><PageHeader id="del-h" title={t('del.title')} subtitle={<Link to="/engg/deliverables">{t('nav.deliverables')}</Link>} /></section>;
  if (q.error?.status === 403) return <NoPermission what={t('nav.deliverables')} permission="engg.deliverable.view" />;
  if (q.isPending) return <Skeleton label={t('del.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const c = d.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['engg'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  return (
    <section aria-labelledby="del-h" data-testid="deliverable" data-milestone={d.milestone} data-progress={d.progress} data-release={d.releaseStatus}>
      <header>
        <PageHeader id="del-h" title={<>{d.deliverableNo} · {d.title} <StatusBadge status={d.registerStatus === 'CANCELLED' ? 'CANCELLED' : d.milestone === 'NOT_STARTED' ? 'DRAFT' : d.milestone === 'IFC' || d.milestone === 'ASBUILT' ? 'APPROVED' : 'ACTIVE'} label={d.registerStatus === 'CANCELLED' ? t('dwg.cancelled') : t(`mile.${d.milestone}`)} /></>} subtitle={<>{d.projectCode} · {t(`ddisc.${d.discipline}`)} · {t(`dtype.${d.type}`)}{d.packageName ? ` · ${d.packageName}` : ''} · {t('prog.weight')} {d.weight} · <strong data-testid="del-progress">{d.progress} %</strong>{d.overdue ? ` · ${t('dwg.overdue')}` : ''}{d.drawingId ? <> · <Link to={`/engg/drawing?id=${d.drawingId}`}>{d.drawingNo}</Link></> : null}</>} />
        {d.releaseStatus === 'PENDING' && <p className="mdm-banner" role="status" data-testid="del-pending">{t('del.releasePending')}</p>}
        {error?.form && <p className="field-error" role="alert" data-testid="del-act-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="del-note">{note}</p>}
        <div className="actions-row no-print">
          {c.release && <button type="button" className="btn btn-primary" onClick={() => run(() => ep.deliverableAct(d.id, 'submit'), t('del.releaseSent'))} data-testid="del-release">{t('del.release')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why((x) => ep.deliverableAct(d.id, 'withdraw', { reason: x }), t('rev.withdrawn'))} data-testid="del-withdraw">{t('act.withdraw')}</button>}
          {c.amend && <button type="button" className="btn" onClick={() => why((x) => ep.deliverableAct(d.id, 'amend', { reason: x }), t('del.reopened'))} data-testid="del-amend">{t('del.reopen')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why((x) => ep.deliverableAct(d.id, 'cancel', { reason: x }), t('del.cancelled'))} data-testid="del-cancel">{t('act.cancel')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => openPrint(`/deliverables/${d.id}/print`, `${d.deliverableNo}.html`)} data-testid="del-print">{t('act.print')}</button>}
          {d.workflowInstanceId && <Link to={`/workflow/instance?id=${d.workflowInstanceId}`}>{t('rev.approval')}</Link>}
        </div>
      </header>
      <Tabs tabs={TABS} active={tab} onChange={setTab} label={t('del.title')} labelOf={(k) => t(`delt.${k}`)} />
      {tab === 'milestones' && (
        <div className="mdm-panel" data-testid="del-milestones"><h2>{t('delt.milestones')}</h2>
          <div className="table-scroll"><table><thead><tr><th>{t('del.milestone')}</th><th>{t('col.planned')}</th><th>{t('del.actual')}</th><th>{t('col.status')}</th><th /></tr></thead>
            <tbody>{d.milestones.map((m) => (
              <tr key={m.code} data-testid={`ms-${m.code}`} data-state={m.state}><td>{t(`mile.${m.code}`)}</td><td>{m.plan ?? '—'}</td><td>{m.actual ?? '—'}{m.late ? ` (${t('del.late')})` : ''}</td><td>{t(`mstate.${m.state}`)}</td>
                <td>{c.edit && m.code !== 'IFC' && !m.actual && <button type="button" className="btn" onClick={() => run(() => ep.deliverableAct(d.id, 'milestones', { milestone: m.code }), t('del.recorded'))} data-testid={`ms-record-${m.code}`}>{t('del.record')}</button>}</td></tr>))}</tbody></table></div>
          <p className="muted">{t('del.ifcNote')}</p></div>
      )}
      {tab === 'crs' && (
        <div className="mdm-panel" data-testid="del-crs"><h2>{t('delt.crs')}</h2>
          {c.edit && (
            <form aria-label={t('crs.add')} data-testid="crs-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await ep.deliverableAct(d.id, 'comments', { revision: cm.revision.trim(), comment: cm.comment.trim() }); setCm({ ...cm, comment: '' }); }, t('crs.added')); }}>
              <div className="form-grid">
                <Field label={t('f.revision')} name="revision" error={error}><input value={cm.revision} onChange={(e) => setCm({ ...cm, revision: e.target.value })} maxLength={10} data-testid="crs-revision" /></Field>
                <Field label={t('crs.comment')} name="comment" error={error}><input value={cm.comment} onChange={(e) => setCm({ ...cm, comment: e.target.value })} maxLength={2000} data-testid="crs-comment" /></Field>
              </div>
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={cm.comment.trim().length < 5} data-testid="crs-add">{t('crs.add')}</button></div>
            </form>
          )}
          {d.comments.length === 0 ? <p className="muted">{t('crs.none')}</p> : (
            <div className="table-scroll"><table><thead><tr><th>{t('f.revision')}</th><th>#</th><th>{t('crs.comment')}</th><th>{t('crs.response')}</th><th>{t('col.status')}</th><th /></tr></thead>
              <tbody>{d.comments.map((x) => (
                <tr key={x.id} data-testid={`crs-${x.revision}-${x.no}`} data-status={x.status}><td>{x.revision}</td><td>{x.no}</td><td>{x.comment}</td>
                  <td>{x.response ?? (c.edit && x.status !== 'CLOSED' ? <input aria-label={t('crs.response')} value={reply[x.id] ?? ''} onChange={(e) => setReply({ ...reply, [x.id]: e.target.value })} data-testid={`crs-reply-${x.revision}-${x.no}`} maxLength={2000} /> : '—')}</td>
                  <td>{t(`crsst.${x.status}`)}</td>
                  <td>{c.edit && x.status === 'OPEN' && <button type="button" className="btn" disabled={(reply[x.id] ?? '').trim().length < 3} onClick={() => run(() => ep.commentAct(x.id, 'respond', { response: reply[x.id].trim() }), t('crs.responded'))} data-testid={`crs-respond-${x.revision}-${x.no}`}>{t('crs.respond')}</button>}
                    {c.edit && x.status === 'RESPONDED' && <button type="button" className="btn" onClick={() => run(() => ep.commentAct(x.id, 'close'), t('crs.closed'))} data-testid={`crs-close-${x.revision}-${x.no}`}>{t('crs.close')}</button>}</td></tr>))}</tbody></table></div>
          )}</div>
      )}
      {tab === 'holds' && (
        <div className="mdm-panel" data-testid="del-holds"><h2>{t('delt.holds')}</h2>
          {c.edit && (
            <form aria-label={t('hold.raise')} data-testid="hold-form" onSubmit={(e) => { e.preventDefault(); run(async () => { await ep.raiseHold({ deliverableId: d.id, description: hold.description.trim(), impactProcurement: hold.impactProcurement, impactConstruction: hold.impactConstruction, poRef: hold.poRef.trim() || null, activityRef: hold.activityRef.trim() || null }); setHold({ ...hold, description: '' }); }, t('hold.raised')); }}>
              <div className="form-grid">
                <Field label={t('hold.description')} name="description" error={error}><input value={hold.description} onChange={(e) => setHold({ ...hold, description: e.target.value })} maxLength={2000} data-testid="hold-description" /></Field>
                <Field label={t('hold.po')} name="poRef" error={error}><input value={hold.poRef} onChange={(e) => setHold({ ...hold, poRef: e.target.value })} maxLength={80} data-testid="hold-po" /></Field>
                <Field label={t('f.activity')} name="activityRef" error={error}><input value={hold.activityRef} onChange={(e) => setHold({ ...hold, activityRef: e.target.value })} maxLength={120} /></Field>
              </div>
              <label><input type="checkbox" checked={hold.impactProcurement} onChange={(e) => setHold({ ...hold, impactProcurement: e.target.checked })} data-testid="hold-proc" /> {t('hold.procurement')}</label>{' '}
              <label><input type="checkbox" checked={hold.impactConstruction} onChange={(e) => setHold({ ...hold, impactConstruction: e.target.checked })} data-testid="hold-cons" /> {t('hold.construction')}</label>
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={hold.description.trim().length < 5} data-testid="hold-raise">{t('hold.raise')}</button></div>
            </form>
          )}
          {d.holds.length === 0 ? <p className="muted">{t('prog.noHolds')}</p> : (
            <ul>{d.holds.map((h) => (
              <li key={h.id} data-testid={`hold-${h.holdNo}`} data-status={h.status}>{h.holdNo} · {h.description} · {h.status === 'OPEN' ? t('hold.open') : `${t('hold.cleared')} ${h.clearedOn}`}{h.impactProcurement ? ` · ${t('hold.procurement')}` : ''}{h.impactConstruction ? ` · ${t('hold.construction')}` : ''}
                {c.edit && h.status === 'OPEN' && <> <button type="button" className="btn" onClick={() => why((x) => ep.clearHold(h.id, { note: x }), t('hold.clearedNote'))} data-testid={`hold-clear-${h.holdNo}`}>{t('hold.clear')}</button></>}</li>))}</ul>
          )}</div>
      )}
    </section>
  );
}
