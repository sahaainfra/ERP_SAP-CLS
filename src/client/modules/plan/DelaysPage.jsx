import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { useSession } from '../core/api/index.js';
import { CAUSES, DELAY_TONE, EVIDENCE_KINDS, RESPONSIBILITIES, fmtDate, openPrint, pl } from './api.js';
import { useSearch } from './parts.jsx';

// Delay Register (part 13.05, FR-01, FR-02, FR-04): the delays of the projects; one delay with its cause, responsibility, activities, evidence and time-impact analyses, sent for the approval of its
// classification (the project manager, then the commercial manager) and locked once approved; a change is a revision.
const ActivityPicker = ({ t, acts, value, onChange }) => (
  <fieldset className="mdm-panel" data-testid="dl-activities"><legend>{t('dl.activities')}</legend>
    <div style={{ maxHeight: 220, overflowY: 'auto' }}>{acts.map((a) => <label key={a.id} className="check" style={{ display: 'block' }}><input type="checkbox" checked={value.includes(a.id)} onChange={(e) => onChange(e.target.checked ? [...value, a.id] : value.filter((x) => x !== a.id))} data-testid="dl-act" data-code={a.code} /> {a.code} {a.name}{a.critical ? ` · ${t('f.critical')}` : ''}</label>)}</div>
  </fieldset>
);

function DelayForm({ t, initial, projectId: fixed, onSave, saveLabel, busy, error }) {
  const [projectId, setProjectId] = useState(fixed ?? null); const [f, setF] = useState(initial);
  const pq = useQuery({ queryKey: ['plan', 'projects'], queryFn: pl.projects, retry: false, enabled: !fixed });
  const oq = useQuery({ queryKey: ['plan', 'delay-options', projectId], queryFn: () => pl.delayOptions(projectId), enabled: Boolean(projectId), retry: false });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v })); const days = f.startDate && f.endDate && f.endDate >= f.startDate ? Math.round((Date.parse(f.endDate) - Date.parse(f.startDate)) / 86_400_000) + 1 : null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ ...(fixed ? {} : { projectId }), title: f.title.trim(), description: f.description.trim() || null, cause: f.cause, responsibility: f.responsibility, startDate: f.startDate, endDate: f.endDate, activityIds: f.activityIds, mitigation: f.mitigation.trim() || null, concurrency: f.concurrency.trim() || null }); }} data-testid="dl-form" aria-label={saveLabel}>
      {!fixed && <Field label={t('f.project')} name="projectId" error={error}><select value={projectId ?? ''} onChange={(e) => { setProjectId(e.target.value ? Number(e.target.value) : null); set('activityIds', []); }} required data-testid="dl-project"><option value="">{t('f.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>}
      <div className="form-grid">
        <Field label={t('dl.event')} name="title" error={error}><input value={f.title} onChange={(e) => set('title', e.target.value)} required minLength={3} maxLength={200} data-testid="dl-title" /></Field>
        <Field label={t('dl.cause')} name="cause" error={error}><select value={f.cause} onChange={(e) => set('cause', e.target.value)} data-testid="dl-cause">{CAUSES.map((k) => <option key={k} value={k}>{t(`dc.${k}`)}</option>)}</select></Field>
        <Field label={t('dl.responsibility')} name="responsibility" error={error}><select value={f.responsibility} onChange={(e) => set('responsibility', e.target.value)} data-testid="dl-resp">{RESPONSIBILITIES.map((k) => <option key={k} value={k}>{t(`dr.${k}`)}</option>)}</select></Field>
        <Field label={t('h.from')} name="startDate" error={error}><input type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} required data-testid="dl-from" /></Field>
        <Field label={t('h.to')} name="endDate" error={error}><input type="date" value={f.endDate} min={f.startDate || undefined} onChange={(e) => set('endDate', e.target.value)} required data-testid="dl-to" /></Field>
      </div>
      {days != null && <p className="muted" data-testid="dl-days">{t('dl.daysLive', { n: days })} · {t(`dl.class.${f.responsibility}`)}</p>}
      <Field label={t('dl.description')} name="description" error={error}><textarea value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={4000} rows={2} data-testid="dl-desc" /></Field>
      {oq.data && (oq.data.activities.length ? <ActivityPicker t={t} acts={oq.data.activities} value={f.activityIds} onChange={(v) => set('activityIds', v)} /> : <p className="muted">{t('dl.noSchedule')}</p>)}
      <Field label={t('dl.mitigation')} name="mitigation" error={error}><textarea value={f.mitigation} onChange={(e) => set('mitigation', e.target.value)} maxLength={2000} rows={2} data-testid="dl-mitigation" /></Field>
      <Field label={t('dl.concurrency')} name="concurrency" error={error}><textarea value={f.concurrency} onChange={(e) => set('concurrency', e.target.value)} maxLength={2000} rows={2} data-testid="dl-concurrency" /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="dl-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || (!fixed && !projectId)} data-testid="dl-save">{saveLabel}</button></div>
    </form>
  );
}

function Evidence({ t, d, onChange }) {
  const [kind, setKind] = useState('engg_rfi'); const [q, setQ] = useState(''); const [pick, setPick] = useState(''); const [note, setNote] = useState(''); const [error, setError] = useState(null); const [up, setUp] = useState(0);
  const cq = useQuery({ queryKey: ['plan', 'evidence-candidates', d.id, kind, q, up], queryFn: () => pl.evidenceCandidates(d.id, kind, q), enabled: d.can.evidence, retry: false });
  const run = async (fn) => { setError(null); try { await fn(); onChange(); return true; } catch (e) { setError(errorInfo(e)); return false; } };
  return (
    <div className="mdm-panel" data-testid="dl-evidence">
      <h2>{t('dl.evidence', { n: d.evidence.length })}</h2>
      {d.evidence.length === 0 ? <p className="muted">{t('dl.noEvidence')}</p> : (
        <ul>{d.evidence.map((e) => <li key={e.id} data-testid="dl-evidence-row"><strong>{t(`ev.${e.entity}`)}</strong>: {e.link ? <Link to={e.link}>{e.label}</Link> : e.label}{e.note ? ` · ${e.note}` : ''} {d.can.edit && <button type="button" className="btn" onClick={() => run(() => pl.removeEvidence(d.id, e.id))} aria-label={t('dl.unlink', { l: e.label })}>{t('act.remove')}</button>}</li>)}</ul>
      )}
      {d.can.evidence && (
        <form className="form-grid no-print" onSubmit={async (e) => { e.preventDefault(); if (pick && await run(() => pl.addEvidence(d.id, { entity: kind, entityId: Number(pick), note: note.trim() || null }))) { setPick(''); setNote(''); } }} aria-label={t('dl.link')}>
          <Field label={t('dl.kind')} name="entity"><select value={kind} onChange={(e) => { setKind(e.target.value); setPick(''); }} data-testid="dl-ev-kind">{EVIDENCE_KINDS.map((k) => <option key={k} value={k}>{t(`ev.${k}`)}</option>)}</select></Field>
          <Field label={t('act.search')} name="q"><input type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={60} data-testid="dl-ev-q" /></Field>
          <Field label={t('dl.record')} name="entityId"><select value={pick} onChange={(e) => setPick(e.target.value)} data-testid="dl-ev-pick"><option value="">—</option>{(cq.data?.rows ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
          <Field label={t('wp.note')} name="note"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></Field>
          <div className="actions"><button type="submit" className="btn" disabled={!pick} data-testid="dl-ev-add">{t('dl.link')}</button></div>
        </form>
      )}
      {error?.form && <p className="field-error" role="alert">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <h3>{t('dl.files')}</h3>
      {d.can.evidence && <FileUploader entity="plan_delay" entityId={d.id} onDone={() => setUp((n) => n + 1)} />}
      <AttachmentList key={up} entity="plan_delay" entityId={d.id} canEdit={d.can.edit} />
    </div>
  );
}

function Delay({ t, id, onGone }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plan', 'delay', id], queryFn: () => pl.delay(id), retry: false });
  const hq = useQuery({ queryKey: ['plan', 'delay-history', id], queryFn: () => pl.delayHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [edit, setEdit] = useState(false); const [busy, setBusy] = useState(false); const [talk, setTalk] = useState(false);
  usePageTitle(q.data ? `${q.data.docNo} · ${t('dl.title')}` : t('dl.title'));
  if (q.error?.status === 403) return <NoPermission what={t('dl.title')} permission="plan.delay.view" />;
  if (q.isPending) return <Skeleton label={t('dl.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const can = d.can; const tia = d.tias.find((x) => x.id === d.tiaId);
  const refresh = () => qc.invalidateQueries({ queryKey: ['plan'] });
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  return (
    <div data-testid="dl-object" data-status={d.status}>
      <h1 id="dl-h">{d.docNo} · {d.title} <StatusBadge status={DELAY_TONE[d.status]} label={t(`dst.${d.status}`)} /></h1>
      <p><Link to="/plan/delays">{t('dl.back')}</Link></p>
      <dl className="kv" data-testid="dl-figures">
        <div><dt>{t('f.project')}</dt><dd>{d.projectCode} · {d.projectName}</dd></div><div><dt>{t('dl.cause')}</dt><dd data-testid="dl-cause-v">{t(`dc.${d.cause}`)}</dd></div><div><dt>{t('dl.responsibility')}</dt><dd>{t(`dr.${d.responsibility}`)} · {t(`dl.class.${d.responsibility}`)}</dd></div>
        <div><dt>{t('h.from')}</dt><dd>{fmtDate(d.startDate)}</dd></div><div><dt>{t('h.to')}</dt><dd>{fmtDate(d.endDate)}</dd></div><div><dt>{t('dl.delayDays')}</dt><dd data-testid="dl-days-v">{d.delayDays}</dd></div>
        <div><dt>{t('dl.impact')}</dt><dd data-testid="dl-impact">{d.impactDays == null ? t('dl.notAnalysed') : t('var.days', { n: d.impactDays })}</dd></div><div><dt>{t('f.schedule')}</dt><dd>{d.scheduleDocNo ?? '—'}</dd></div><div><dt>{t('bl.revision')}</dt><dd>{d.revisionNo}</dd></div>
        {d.source && <div><dt>{t('dl.source')}</dt><dd>{d.source.link ? <Link to={d.source.link}>{t(`ev.${d.source.entity}`)}</Link> : d.source.label}</dd></div>}
        <div><dt>{t('bl.preparedBy')}</dt><dd>{d.requestedBy ?? t('dl.bySystem')}</dd></div>{d.approvedAt && <div><dt>{t('bl.approvedBy')}</dt><dd>{d.approvedBy} · {fmtDate(d.approvedAt.slice(0, 10))}</dd></div>}
      </dl>
      {d.description && <p>{d.description}</p>}
      <p><strong>{t('dl.activities')}:</strong> <span data-testid="dl-affected">{d.affected.map((a) => `${a.code} ${a.name}`).join('; ') || '—'}</span></p>
      {d.mitigation && <p><strong>{t('dl.mitigation')}:</strong> {d.mitigation}</p>}{d.concurrency && <p><strong>{t('dl.concurrency')}:</strong> {d.concurrency}</p>}
      {d.previous && <p className="muted" data-testid="dl-previous">{t('dl.revises', { d: d.previous.docNo })}: {t(`dr.${d.previous.responsibility}`)} · {t(`dc.${d.previous.cause}`)} · {d.previous.delayDays} · {d.previous.impactDays ?? '—'}</p>}
      {d.status === 'APPROVED' && <p className="muted" data-testid="dl-locked">{t('dl.locked')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="dl-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="dl-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => setEdit(!edit)} data-testid="dl-edit">{t('bl.edit')}</button>}
        {can.analyse && <button type="button" className="btn" onClick={() => navigateTo(`/plan/tia?delayId=${d.id}`)} data-testid="dl-analyse">{t('tia.title')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => pl.delayAct(d.id, 'submit'), t('act.sent'))} data-testid="dl-submit">{t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => pl.delayAct(d.id, 'withdraw', { reason: x }))} data-testid="dl-withdraw">{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => pl.delayAct(d.id, 'cancel', { reason: x }))} data-testid="dl-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('bl.deleteAsk')) && await run(() => pl.removeDelay(d.id))) onGone(); }} data-testid="dl-delete">{t('bl.delete')}</button>}
        {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => pl.delayAct(d.id, 'amend', { reason: x })); if (n) navigateTo(`/plan/delays?id=${n.id}`); } }} data-testid="dl-amend">{t('bl.revise')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => openPrint(`/delays/${d.id}/print`).catch(() => null)} data-testid="dl-print">{t('act.print')}</button>}
        <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk} data-testid="dl-discuss">{t('act.discussion')}</button>
        {d.workflowInstanceId && <Link to={`/workflow/instance?id=${d.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {talk && <div className="mdm-panel"><DiscussionTab entity="plan_delay" id={d.id} /></div>}
      {edit && (
        <div className="mdm-panel"><h2>{t('bl.edit')}</h2>
          <DelayForm t={t} projectId={d.projectId} busy={busy} error={error} saveLabel={t('act.save')} initial={{ title: d.title, description: d.description ?? '', cause: d.cause, responsibility: d.responsibility, startDate: d.startDate, endDate: d.endDate, activityIds: d.affected.map((a) => a.activityId), mitigation: d.mitigation ?? '', concurrency: d.concurrency ?? '' }}
            onSave={async (b) => { if (await run(() => pl.updateDelay(d.id, { ...b, rowVersion: d.rowVersion }), t('bl.saved'))) setEdit(false); }} />
        </div>
      )}
      <Evidence t={t} d={d} onChange={refresh} />
      <div className="mdm-panel" data-testid="dl-tias">
        <h2>{t('dl.analyses')}</h2>
        {d.tias.length === 0 ? <p className="muted">{t('dl.noAnalysis')}{can.analyse ? <> <Link to={`/plan/tia?delayId=${d.id}`}>{t('tia.title')}</Link></> : null}</p> : (
          <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('dl.analyses')}</caption><thead><tr><th>{t('bl.when')}</th><th>{t('f.schedule')}</th><th>{t('f.dataDate')}</th><th>{t('tia.before')}</th><th>{t('tia.after')}</th><th className="num">{t('dl.impact')}</th><th>{t('tia.fragnet')}</th></tr></thead>
            <tbody>{d.tias.map((x) => <tr key={x.id} data-testid="dl-tia-row" aria-current={x.id === d.tiaId ? 'true' : undefined}><td>{String(x.analysedAt).slice(0, 16).replace('T', ' ')}{x.id === d.tiaId ? ` · ${t('dl.inUse')}` : ''}</td><td>{x.scheduleRef}</td><td>{fmtDate(x.dataDate)}</td><td>{fmtDate(x.completionBefore)}</td><td>{fmtDate(x.completionAfter)}</td><td className="num">{x.impactDays} ({x.impactWorkingDays})</td><td>{(x.fragnet.activities ?? []).map((a) => `${a.code} ${a.name} (${a.duration})`).join('; ')}</td></tr>)}</tbody></table></div>
        )}
        {tia && <p className="muted">{t('tia.result', { b: fmtDate(tia.completionBefore), a: fmtDate(tia.completionAfter), n: tia.impactDays, w: tia.impactWorkingDays })}</p>}
      </div>
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="dl-history"><caption>{t('bl.history')}</caption><thead><tr><th>{t('bl.when')}</th><th>{t('bl.who')}</th><th>{t('bl.what')}</th><th>{t('bl.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function DelaysPage() {
  const t = useT('plan');
  usePageTitle(t('dl.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const [adding, setAdding] = useState(false); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  if (id) return <section aria-labelledby="dl-h" data-testid="plan-delays"><Delay key={id} t={t} id={id} onGone={() => navigateTo('/plan/delays')} /></section>;
  return (
    <section aria-labelledby="dl-h" data-testid="plan-delays">
      <h1 id="dl-h" className="sr-only">{t('dl.title')}</h1>
      <div className="actions-row no-print">
        {perms.includes('plan.delay.create') && <button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)} data-testid="dl-new">{t('dl.new')}</button>}
        <Link to="/plan/delay-summary">{t('ds.title')}</Link>
      </div>
      {adding && (
        <div className="mdm-panel"><h2>{t('dl.new')}</h2>
          <DelayForm t={t} busy={busy} error={error} saveLabel={t('dl.create')} initial={{ title: '', description: '', cause: 'LATE_DRAWINGS', responsibility: 'EMPLOYER', startDate: '', endDate: '', activityIds: [], mitigation: '', concurrency: '' }}
            onSave={async (b) => { setError(null); setBusy(true); try { const d = await pl.createDelay(b); qc.invalidateQueries({ queryKey: ['plan'] }); navigateTo(`/plan/delays?id=${d.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } }} />
        </div>
      )}
      <ListReport listCode="plan.delays" endpoint="/plan/delays" title={t('dl.title')} session={session.data} rowHref={(r) => `/plan/delays?id=${r.id}`} onOpen={(r) => navigateTo(`/plan/delays?id=${r.id}`)}
        cardFields={[{ key: 'project', label: t('f.project') }, { key: 'responsibility', label: t('dl.responsibility') }, { key: 'delayDays', label: t('dl.delayDays') }, { key: 'impactDays', label: t('dl.impact') }]} statusKey="status"
        empty={{ title: t('dl.emptyTitle'), text: t('dl.emptyBody') }} />
    </section>
  );
}
