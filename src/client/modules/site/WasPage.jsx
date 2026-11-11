import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { useSession } from '../core/api/index.js';
import { CHECK_TONE, WA_TONE, fmtDate, fmtQty, openPrint, st, today } from './api.js';
import { SiteDay, useSearch } from './parts.jsx';

// Work Authorisations (part 14.01, FR-03 to FR-05): the list, a new WA (or an emergency one) and the WA itself: its plan, resources, the checks panel (drawing, budget, permit, hold points, plan),
// what was used against it, the closure with the reconciliation, the approval (the construction manager; the project manager too outside the plan or for an emergency) and the revision.
export function WaForm({ t, siteId: fixedSite, date: fixedDate, initial, onSave, saveLabel, busy, error, editing = false }) {
  const [siteId, setSiteId] = useState(fixedSite ?? null); const [date, setDate] = useState(fixedDate ?? today()); const [f, setF] = useState(initial);
  const oq = useQuery({ queryKey: ['site', 'options', siteId, date], queryFn: () => st.options(siteId, date), enabled: Boolean(siteId), retry: false });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const o = oq.data; const act = o?.activities.find((a) => a.id === Number(f.activityId)); const dwg = o?.drawings.find((d) => d.id === Number(f.drawingId));
  const onSite = useCallback((v) => setSiteId(v), []);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...(editing ? {} : { siteId, emergency: f.emergency, emergencyReason: f.emergency ? f.emergencyReason.trim() : null }), planDate: date, activityId: Number(f.activityId), workFrontId: f.workFrontId ? Number(f.workFrontId) : null, plannedQty: Number(f.plannedQty), startTime: f.startTime, endTime: f.endTime, supervisor: f.supervisor.trim() || null, crews: f.crewIds.map((c) => ({ crewId: c })), drawingId: f.drawingId ? Number(f.drawingId) : null, drawingRevision: f.drawingRevision.trim() || null, permitRequired: f.permitRequired, permitRef: f.permitRef.trim() || null, holdPoints: f.holdPoints.trim() || null, budgetAmount: f.budgetAmount === '' ? 0 : Number(f.budgetAmount) }); }} data-testid="wa-form" aria-label={saveLabel}>
      {!editing && <SiteDay siteId={siteId} date={date} onSite={onSite} onDate={setDate} testId="wa" />}
      {o && (
        <>
          {!editing && <label className="check"><input type="checkbox" checked={f.emergency} onChange={(e) => { set('emergency', e.target.checked); if (e.target.checked) setDate(today()); }} data-testid="wa-emergency" /> {t('wa.emergencyAsk')}</label>}
          {f.emergency && <Field label={t('wa.emergencyReason')} name="emergencyReason" error={error}><textarea value={f.emergencyReason} onChange={(e) => set('emergencyReason', e.target.value)} required minLength={5} maxLength={1000} rows={2} data-testid="wa-reason" /></Field>}
          <div className="form-grid">
            <Field label={t('wa.activity')} name="activityId" error={error}><select value={f.activityId} onChange={(e) => set('activityId', e.target.value)} required data-testid="wa-activity"><option value="">{t('f.choose')}</option>{o.activities.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}{a.inPlan ? ` · ${t('wa.inPlanShort')}` : ''}</option>)}</select></Field>
            <Field label={t('wa.front')} name="workFrontId" error={error}><select value={f.workFrontId} onChange={(e) => set('workFrontId', e.target.value)} data-testid="wa-front"><option value="">{t('wa.frontAuto')}</option>{o.fronts.map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
            <Field label={t('wa.qty', { u: act?.uom ?? '' })} name="plannedQty" error={error}><input type="number" min="0.001" step="0.001" value={f.plannedQty} onChange={(e) => set('plannedQty', e.target.value)} required data-testid="wa-qty" /></Field>
            <Field label={t('wa.start')} name="startTime" error={error}><input type="time" value={f.startTime} onChange={(e) => set('startTime', e.target.value)} required data-testid="wa-start" /></Field>
            <Field label={t('wa.end')} name="endTime" error={error}><input type="time" value={f.endTime} onChange={(e) => set('endTime', e.target.value)} required data-testid="wa-end" /></Field>
            <Field label={t('wa.supervisor')} name="supervisor" error={error}><input value={f.supervisor} onChange={(e) => set('supervisor', e.target.value)} maxLength={80} placeholder={t('wa.supervisorMe')} /></Field>
          </div>
          {act && <p className="muted" data-testid="wa-remaining">{act.remaining != null ? t('wa.remaining', { r: fmtQty(act.remaining), q: fmtQty(act.qty), u: act.uom ?? '', p: o.tolerancePct }) : t('wa.noQty')} · {act.inPlan ? t('wa.inPlan') : t('wa.outside')}</p>}
          <fieldset className="mdm-panel"><legend>{t('wa.crews')}</legend>{o.crews.length === 0 ? <p className="muted">{t('wa.noCrews')}</p> : o.crews.map((c) => <label key={c.id} className="check" style={{ display: 'block' }}><input type="checkbox" checked={f.crewIds.includes(c.id)} onChange={(e) => set('crewIds', e.target.checked ? [...f.crewIds, c.id] : f.crewIds.filter((x) => x !== c.id))} data-testid="wa-crew" /> {c.code} {c.name} · {c.trade} · {t('wa.heads', { n: c.headcount })}</label>)}</fieldset>
          <div className="form-grid">
            <Field label={t('wa.drawing')} name="drawingId" error={error}><select value={f.drawingId} onChange={(e) => { set('drawingId', e.target.value); set('drawingRevision', ''); }} data-testid="wa-drawing"><option value="">—</option>{o.drawings.map((d) => <option key={d.id} value={d.id}>{d.drawingNo} {d.title}{d.ifcRevision ? ` · IFC ${d.ifcRevision}` : ` · ${t('wa.noIfc')}`}</option>)}</select></Field>
            <Field label={t('wa.revision')} name="drawingRevision" error={error}><input value={f.drawingRevision} onChange={(e) => set('drawingRevision', e.target.value)} maxLength={20} placeholder={dwg?.ifcRevision ?? ''} data-testid="wa-revision" /></Field>
            <Field label={t('wa.budget')} name="budgetAmount" error={error}><input type="number" min="0" step="0.01" value={f.budgetAmount} onChange={(e) => set('budgetAmount', e.target.value)} data-testid="wa-budget" /></Field>
            <Field label={t('wa.holdPoints')} name="holdPoints" error={error}><input value={f.holdPoints} onChange={(e) => set('holdPoints', e.target.value)} maxLength={500} /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={f.permitRequired} onChange={(e) => set('permitRequired', e.target.checked)} data-testid="wa-permit-needed" /> {t('wa.permitNeeded')}</label>
          {f.permitRequired && <Field label={t('wa.permit')} name="permitRef" error={error}><input value={f.permitRef} onChange={(e) => set('permitRef', e.target.value)} maxLength={60} data-testid="wa-permit" /></Field>}
        </>
      )}
      {error?.form && <p className="field-error" role="alert" data-testid="wa-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !o} data-testid="wa-save">{saveLabel}</button></div>
    </form>
  );
}
export const blankWa = () => ({ activityId: '', workFrontId: '', plannedQty: '', startTime: '08:00', endTime: '17:00', supervisor: '', crewIds: [], drawingId: '', drawingRevision: '', permitRequired: false, permitRef: '', holdPoints: '', budgetAmount: '', emergency: false, emergencyReason: '' });

/** FR-04: the quantity done (the DPR quantity by default) and what each resource used; the reason is asked when a material is off by more than the tolerance (BR-03, checked again on the server). */
export function CloseForm({ t, w, onDone, compact = false }) {
  const [qty, setQty] = useState(w.dprQty ? String(w.dprQty) : ''); const [res, setRes] = useState(Object.fromEntries(w.resources.map((r) => [r.id, String(r.actualQty)]))); const [why, setWhy] = useState(''); const [notes, setNotes] = useState(''); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const beyond = w.resources.filter((r) => r.type === 'MATERIAL' && r.plannedQty > 0 && Math.abs(Number(res[r.id] || 0) - r.plannedQty) * 100 > r.plannedQty * w.tolerancePct);
  return (
    <form className={compact ? '' : 'mdm-panel'} onSubmit={async (e) => { e.preventDefault(); setError(null); setBusy(true); try { await st.close(w.id, { actualQty: qty === '' ? null : Number(qty), resources: w.resources.map((r) => ({ id: r.id, actualQty: Number(res[r.id] || 0) })), varianceReason: why.trim() || null, closureNotes: notes.trim() || null, rowVersion: w.rowVersion }); onDone(); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } }} data-testid="wa-close-form" aria-label={t('wa.close')}>
      {!compact && <h2>{t('wa.close')}</h2>}
      <Field label={t('wa.actualQty', { u: w.uom ?? '' })} name="actualQty" error={error}><input type="number" min="0" step="0.001" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ minHeight: 44 }} data-testid="wa-actual" /></Field>
      {w.dprQty > 0 && <p className="muted">{t('wa.fromDpr', { q: fmtQty(w.dprQty) })}</p>}
      {w.resources.map((r) => <Field key={r.id} label={`${r.label} (${r.uom}) · ${t('wa.authorised')} ${fmtQty(r.plannedQty)}`} name={`res-${r.id}`}><input type="number" min="0" step="0.001" inputMode="decimal" value={res[r.id]} onChange={(e) => setRes({ ...res, [r.id]: e.target.value })} style={{ minHeight: 44 }} data-testid="wa-res-actual" data-type={r.type} /></Field>)}
      {beyond.length > 0 && <Field label={t('wa.varianceReason', { p: w.tolerancePct })} name="varianceReason" error={error}><textarea value={why} onChange={(e) => setWhy(e.target.value)} required maxLength={1000} rows={2} data-testid="wa-variance" /></Field>}
      <Field label={t('wa.closureNotes')} name="closureNotes"><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="wa-close-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy} style={{ minHeight: 44 }} data-testid="wa-close-save">{t('wa.closeBtn')}</button></div>
    </form>
  );
}

function Wa({ t, id, onGone }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['site', 'wa', id], queryFn: () => st.wa(id), retry: false });
  const hq = useQuery({ queryKey: ['site', 'wa-history', id], queryFn: () => st.history(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [edit, setEdit] = useState(false); const [closing, setClosing] = useState(false); const [busy, setBusy] = useState(false); const [talk, setTalk] = useState(false); const [up, setUp] = useState(0);
  usePageTitle(q.data ? `${q.data.waNo} · ${t('wa.title')}` : t('wa.title'));
  if (q.error?.status === 403) return <NoPermission what={t('wa.title')} permission="site.work_authorisation.view" />;
  if (q.isPending) return <Skeleton label={t('wa.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const w = q.data; const can = w.can;
  const refresh = () => qc.invalidateQueries({ queryKey: ['site'] });
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  return (
    <div data-testid="wa-object" data-status={w.status}>
      <h1 id="wa-h">{w.waNo} · {w.activity} <StatusBadge status={WA_TONE[w.status]} label={t(`wst.${w.status}`)} />{w.overdue && <> <StatusBadge status="OVERDUE" label={t('wa.overdue')} /></>}</h1>
      <p><Link to="/site/work-authorisations">{t('wa.back')}</Link> · <Link to={`/site/board?siteId=${w.siteId}&date=${w.planDate}`}>{t('bd.title')}</Link></p>
      <dl className="kv" data-testid="wa-figures">
        <div><dt>{t('f.site')}</dt><dd>{w.projectCode} · {w.siteCode} {w.siteName}</dd></div><div><dt>{t('wa.front')}</dt><dd>{w.workFront ?? '—'}</dd></div><div><dt>{t('f.date')}</dt><dd>{fmtDate(w.planDate)} · {w.startTime}–{w.endTime}</dd></div>
        <div><dt>{t('wa.qtyShort')}</dt><dd data-testid="wa-planned">{fmtQty(w.plannedQty)} {w.uom ?? ''}</dd></div><div><dt>{t('wa.actual')}</dt><dd data-testid="wa-actual-v">{w.actualQty == null ? '—' : `${fmtQty(w.actualQty)} ${w.uom ?? ''}`}</dd></div><div><dt>{t('wa.remainingShort')}</dt><dd>{w.remainingQty == null ? '—' : fmtQty(w.remainingQty)}</dd></div>
        <div><dt>{t('wa.wbs')}</dt><dd>{w.wbs ?? '—'}</dd></div><div><dt>{t('wa.location')}</dt><dd>{w.location ?? '—'}</dd></div><div><dt>{t('wa.supervisor')}</dt><dd>{w.supervisor}</dd></div>
        <div><dt>{t('wa.drawing')}</dt><dd>{w.drawing ? `${w.drawing} · ${t('wa.rev')} ${w.drawingRevision ?? '—'}` : '—'}</dd></div><div><dt>{t('wa.permit')}</dt><dd>{w.permitRequired ? (w.permitRef ?? t('wa.permitMissing')) : t('wa.permitNot')}</dd></div><div><dt>{t('wa.budget')}</dt><dd>{w.budgetAmount ? `₹ ${w.budgetAmount.toLocaleString('en-IN')}` : '—'}</dd></div>
        <div><dt>{t('wa.plan')}</dt><dd>{w.inPlan ? t('wa.inPlan') : t('wa.outside')}</dd></div><div><dt>{t('wa.raisedBy')}</dt><dd>{w.requestedBy}</dd></div>{w.approvedAt && <div><dt>{t('wa.approvedBy')}</dt><dd>{w.approvedBy} · {fmtDate(w.approvedAt.slice(0, 10))}</dd></div>}
        {w.emergency && <div><dt>{t('wa.emergency')}</dt><dd data-testid="wa-emergency-v">{w.emergencyReason} · {w.regularisedAt ? t('wa.regularised', { d: fmtDate(w.regularisedAt.slice(0, 10)) }) : t('wa.regulariseBy', { d: String(w.regulariseBy).slice(0, 16).replace('T', ' ') })}</dd></div>}
      </dl>
      {w.previous && <p className="muted" data-testid="wa-previous">{t('wa.revises', { w: w.previous.waNo })}: {fmtQty(w.previous.plannedQty)} · {w.previous.startTime}–{w.previous.endTime} · {t('wa.rev')} {w.previous.drawingRevision ?? '—'}</p>}
      {w.status === 'APPROVED' && <p className="muted" data-testid="wa-locked">{t('wa.locked')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="wa-obj-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="wa-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => setEdit(!edit)} data-testid="wa-edit">{t('act.edit')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => st.waAct(w.id, 'submit'), w.status === 'EMERGENCY' ? t('wa.sentRegularise') : t('act.sent'))} data-testid="wa-submit">{w.status === 'EMERGENCY' ? t('wa.regularise') : t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => st.waAct(w.id, 'withdraw', { reason: x }))} data-testid="wa-withdraw">{t('act.withdraw')}</button>}
        {can.close && <button type="button" className="btn btn-primary" onClick={() => setClosing(!closing)} data-testid="wa-close">{t('wa.close')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => st.waAct(w.id, 'cancel', { reason: x }))} data-testid="wa-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('wa.deleteAsk')) && await run(() => st.removeWa(w.id))) onGone(); }} data-testid="wa-delete">{t('act.delete')}</button>}
        {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => st.waAct(w.id, 'amend', { reason: x })); if (n) navigateTo(`/site/work-authorisations?id=${n.id}`); } }} data-testid="wa-amend">{t('wa.revise')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => openPrint(`/work-authorisations/${w.id}/print`).catch(() => null)} data-testid="wa-print">{t('act.print')}</button>}
        <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk}>{t('act.discussion')}</button>
        {w.workflowInstanceId && <Link to={`/workflow/instance?id=${w.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {talk && <div className="mdm-panel"><DiscussionTab entity="site_work_authorisation" id={w.id} /></div>}
      {edit && (
        <div className="mdm-panel"><h2>{t('act.edit')}</h2>
          <WaForm t={t} editing siteId={w.siteId} date={w.planDate} busy={busy} error={error} saveLabel={t('act.save')}
            initial={{ ...blankWa(), activityId: String(w.activityId), workFrontId: w.workFrontId ? String(w.workFrontId) : '', plannedQty: String(w.plannedQty), startTime: w.startTime, endTime: w.endTime, supervisor: w.supervisor, crewIds: w.resources.filter((r) => r.crewId).map((r) => r.crewId), drawingId: w.drawingId ? String(w.drawingId) : '', drawingRevision: w.drawingRevision ?? '', permitRequired: w.permitRequired, permitRef: w.permitRef ?? '', holdPoints: w.holdPoints ?? '', budgetAmount: w.budgetAmount ? String(w.budgetAmount) : '' }}
            onSave={async (b) => { if (await run(() => st.updateWa(w.id, { ...b, rowVersion: w.rowVersion }), t('act.saved'))) setEdit(false); }} />
        </div>
      )}
      {closing && can.close && <CloseForm t={t} w={w} onDone={() => { setClosing(false); setNote(t('wa.closed')); refresh(); }} />}
      <div className="mdm-panel" data-testid="wa-checks"><h2>{t('wa.checks')}</h2>
        <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('wa.checks')}</caption><thead><tr><th>{t('wa.check')}</th><th>{t('wa.result')}</th><th>{t('wa.detail')}</th></tr></thead>
          <tbody>{w.checks.map((c) => <tr key={c.code} data-testid="wa-check" data-code={c.code} data-result={c.result}><td>{t(`ck.${c.code}`)}</td><td><StatusBadge status={CHECK_TONE[c.result]} label={t(`cr.${c.result}`)} /></td><td>{c.message}</td></tr>)}</tbody></table></div>
      </div>
      <div className="mdm-panel" data-testid="wa-resources"><h2>{t('wa.resources')}</h2>
        {w.resources.length === 0 ? <p className="muted">{t('wa.noResources')}</p> : (
          <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('wa.resources')}</caption><thead><tr><th>{t('wa.type')}</th><th>{t('wa.resource')}</th><th>{t('wa.unit')}</th><th className="num">{t('wa.authorised')}</th><th className="num">{t('wa.used')}</th><th className="num">{t('wa.variance')}</th></tr></thead>
            <tbody>{w.resources.map((r) => <tr key={r.id} data-testid="wa-resource"><td>{t(`rt.${r.type}`)}</td><td>{r.label}{r.headcount != null ? ` · ${t('wa.heads', { n: r.headcount })}` : ''}{r.source === 'NORM' ? ` · ${t('wa.norm')}` : ''}</td><td>{r.uom}</td><td className="num">{fmtQty(r.plannedQty)}</td><td className="num">{fmtQty(r.actualQty)}</td><td className="num">{r.variancePct} %{r.beyond ? ` · ${t('wa.beyond')}` : ''}</td></tr>)}</tbody></table></div>
        )}
        {w.varianceReason && <p><strong>{t('wa.varianceWhy')}:</strong> {w.varianceReason}</p>}{w.closureNotes && <p><strong>{t('wa.closureNotes')}:</strong> {w.closureNotes}</p>}
      </div>
      <div className="mdm-panel" data-testid="wa-uses"><h2>{t('wa.uses', { n: w.uses.length })}</h2>
        {w.uses.length === 0 ? <p className="muted">{t('wa.noUses')}</p> : (
          <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('wa.uses', { n: w.uses.length })}</caption><thead><tr><th>{t('f.date')}</th><th>{t('wa.kind')}</th><th>{t('wa.source')}</th><th className="num">{t('wa.qtyShort')}</th><th>{t('wa.result')}</th></tr></thead>
            <tbody>{w.uses.map((u, i) => <tr key={i}><td>{fmtDate(u.date)}</td><td>{t(`uk.${u.kind}`)}</td><td>{u.source}</td><td className="num">{fmtQty(u.qty)} {u.uom ?? ''}</td><td>{u.result}{u.exceptionNo ? ` · ${u.exceptionNo}` : ''}</td></tr>)}</tbody></table></div>
        )}
      </div>
      <div className="mdm-panel"><h2>{t('wa.files')}</h2><FileUploader entity="site_work_authorisation" entityId={w.id} onDone={() => setUp((n) => n + 1)} /><AttachmentList key={up} entity="site_work_authorisation" entityId={w.id} canEdit={can.edit || can.close} /></div>
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="wa-history"><caption>{t('wa.history')}</caption><thead><tr><th>{t('wa.when')}</th><th>{t('wa.who')}</th><th>{t('wa.what')}</th><th>{t('wa.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function WasPage() {
  const t = useT('site'); usePageTitle(t('wa.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const [adding, setAdding] = useState(sp.get('new') === '1'); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  if (id) return <section aria-labelledby="wa-h" data-testid="site-was"><Wa key={id} t={t} id={id} onGone={() => navigateTo('/site/work-authorisations')} /></section>;
  return (
    <section aria-labelledby="wa-h" data-testid="site-was">
      <h1 id="wa-h" className="sr-only">{t('wa.title')}</h1>
      <div className="actions-row no-print">
        {perms.includes('site.work_authorisation.create') && <button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)} data-testid="wa-new">{t('wa.new')}</button>}
        <Link to="/site/board">{t('bd.title')}</Link> <Link to="/site/daily-plans">{t('dp.title')}</Link>
      </div>
      {adding && (
        <div className="mdm-panel"><h2>{t('wa.new')}</h2>
          <WaForm t={t} siteId={Number(sp.get('siteId')) || null} date={sp.get('date') ?? undefined} busy={busy} error={error} saveLabel={t('wa.create')} initial={blankWa()}
            onSave={async (b) => { setError(null); setBusy(true); try { const w = await st.createWa(b); qc.invalidateQueries({ queryKey: ['site'] }); navigateTo(`/site/work-authorisations?id=${w.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } }} />
        </div>
      )}
      <ListReport listCode="site.work_authorisations" endpoint="/site/work-authorisations" title={t('wa.title')} session={session.data} rowHref={(r) => `/site/work-authorisations?id=${r.id}`} onOpen={(r) => navigateTo(`/site/work-authorisations?id=${r.id}`)}
        cardFields={['planDate', 'site', 'activity', 'plannedQty']} statusKey="status"
        empty={{ title: t('wa.emptyTitle'), text: t('wa.emptyBody') }} />
    </section>
  );
}
