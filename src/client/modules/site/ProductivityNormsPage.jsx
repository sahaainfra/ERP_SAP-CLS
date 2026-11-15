import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { NORM_TONE, fmtDate, fmtQty, st, today } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Productivity Norms (part 14.06, FR-01, AC-04): the planned output per man-day and per machine-hour of each activity, from the BOQ resource norms or entered; an entered norm is maker-checker (planning or project
// controls enter it, the project manager approves it) and every change is audited.
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };

function NormForm({ t, editing, onSaved, onCancel }) {
  const pq = useQuery({ queryKey: ['site', 'prod-projects'], queryFn: st.prodProjects, retry: false });
  const [f, setF] = useState(editing ? { projectId: editing.projectId, activityCode: editing.activityCode, resourceType: editing.resourceType, outputPerUnit: String(editing.outputPerUnit), effectiveFrom: editing.effectiveFrom, note: editing.note ?? '' } : { projectId: '', activityCode: '', resourceType: 'LABOUR', outputPerUnit: '', effectiveFrom: today(), note: '' });
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const oq = useQuery({ queryKey: ['site', 'prod-options', f.projectId], queryFn: () => st.prodOptions(f.projectId), enabled: Boolean(f.projectId), retry: false });
  if (pq.isPending) return <Skeleton label={t('cnd.prn.new')} rows={3} />;
  if (pq.isError) return <ErrorState error={pq.error} onRetry={pq.refetch} />;
  const save = async (e) => { e.preventDefault(); setError(null); setBusy(true); try { const d = editing ? await st.updateNorm(editing.id, { outputPerUnit: Number(f.outputPerUnit), effectiveFrom: f.effectiveFrom, note: f.note.trim() || null, rowVersion: editing.rowVersion }) : await st.createNorm({ projectId: Number(f.projectId), activityCode: f.activityCode, resourceType: f.resourceType, outputPerUnit: Number(f.outputPerUnit), effectiveFrom: f.effectiveFrom, note: f.note.trim() || null }); onSaved(d); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const acts = oq.data?.activities ?? []; const uom = acts.find((a) => a.code === f.activityCode)?.uom;
  return (
    <form className="mdm-panel" onSubmit={save} aria-label={editing ? t('cnd.prn.edit') : t('cnd.prn.new')} data-testid="norm-form"><h2>{editing ? t('cnd.prn.edit') : t('cnd.prn.new')}</h2>
      <div className="form-grid">
        <Field label={t('cnd.prg.project')} name="projectId" error={error}><select value={f.projectId} disabled={Boolean(editing)} onChange={(e) => set('projectId', e.target.value)} data-testid="norm-project"><option value="">{t('cnd.prg.chooseProject')}</option>{(pq.data ?? []).filter((p) => p.canConfigure || editing).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label={t('cnd.prg.activity')} name="activityCode" error={error}><select value={f.activityCode} disabled={Boolean(editing)} onChange={(e) => set('activityCode', e.target.value)} data-testid="norm-activity"><option value="">—</option>{acts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name} ({a.uom})</option>)}{editing && <option value={editing.activityCode}>{editing.activityCode}</option>}</select></Field>
        <Field label={t('cnd.prn.resource')} name="resourceType" error={error}><select value={f.resourceType} disabled={Boolean(editing)} onChange={(e) => set('resourceType', e.target.value)} data-testid="norm-resource"><option value="LABOUR">{t('cnd.prn.r.LABOUR')}</option><option value="EQUIPMENT">{t('cnd.prn.r.EQUIPMENT')}</option></select></Field>
        <Field label={t('cnd.prn.output', { u: uom ?? editing?.uom ?? '', p: f.resourceType === 'LABOUR' ? t('cnd.prd.manDay') : t('cnd.prd.machineHour') })} name="outputPerUnit" error={error}><input type="number" min="0" step="0.001" inputMode="decimal" value={f.outputPerUnit} onChange={(e) => set('outputPerUnit', e.target.value)} data-testid="norm-output" /></Field>
        <Field label={t('cnd.prn.from')} name="effectiveFrom" error={error}><input type="date" value={f.effectiveFrom} onChange={(e) => e.target.value && set('effectiveFrom', e.target.value)} data-testid="norm-from" /></Field>
      </div>
      <Field label={t('cnd.notes')} name="note" error={error}><input value={f.note} maxLength={500} onChange={(e) => set('note', e.target.value)} data-testid="norm-note" /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="norm-error">{error.form}{error.correlationId ? ` (${error.correlationId})` : ''}</p>}
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={busy} data-testid="norm-save">{t('act.save')}</button><button type="button" className="btn" onClick={onCancel}>{t('cnd.close')}</button></div>
    </form>
  );
}

function Norm({ t, id, onGone }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['site', 'norm', id], queryFn: () => st.norm(id), retry: false });
  const hq = useQuery({ queryKey: ['site', 'norm-history', id], queryFn: () => st.normHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [comment, setComment] = useState(''); const [editing, setEditing] = useState(false);
  usePageTitle(t('cnd.prn.title'));
  if (q.error?.status === 403) return <NoPermission what={t('cnd.prn.title')} permission="site.productivity.view" />;
  if (q.isPending) return <Skeleton label={t('cnd.prn.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const n = q.data; const can = n.can;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('dpr.sayWhy') }); return; } run(() => st.decide(n.taskId, action, comment.trim() || null), t(`dpr.done.${action}`)); };
  if (editing) return <NormForm t={t} editing={n} onSaved={() => { setEditing(false); refresh(qc); }} onCancel={() => setEditing(false)} />;
  return (
    <div data-testid="norm-object" data-status={n.status}>
      <PageHeader id="norm-h" title={<>{n.projectCode} · {n.activityCode} · {t(`cnd.prn.r.${n.resourceType}`)} <StatusBadge status={NORM_TONE[n.status]} label={t(`cnd.prn.s.${n.status}`)} /></>} meta={<Link to="/site/productivity-norms">{t('cnd.prn.back')}</Link>} />
      <dl className="kv" data-testid="norm-figures"><div><dt>{t('cnd.prn.outputShort')}</dt><dd data-testid="norm-value">{fmtQty(n.outputPerUnit)} {n.uom ?? ''} / {n.perLabel}</dd></div><div><dt>{t('cnd.prn.from')}</dt><dd>{fmtDate(n.effectiveFrom)}</dd></div><div><dt>{t('cnd.prn.source')}</dt><dd>{n.source === 'BOQ' ? t('cnd.prn.boq') : t('cnd.prn.entered')}</dd></div><div><dt>{t('cnd.prd.workType')}</dt><dd>{n.workType.replace('UOM:', '')}</dd></div><div><dt>{t('wa.raisedBy')}</dt><dd>{n.requestedBy ?? '—'}</dd></div>{n.approvedAt && <div><dt>{t('wa.approvedBy')}</dt><dd>{n.approvedBy} · {fmtDate(n.approvedAt.slice(0, 10))}</dd></div>}</dl>
      {n.note && <p>{n.note}</p>}{n.status === 'APPROVED' && <p className="muted" data-testid="norm-locked">{t('cnd.prn.locked')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="norm-obj-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="norm-obj-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="norm-edit">{t('act.edit')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => st.normAct(n.id, 'submit'), t('act.sent'))} data-testid="norm-submit">{t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => st.normAct(n.id, 'withdraw', { reason: x }))}>{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => st.normAct(n.id, 'cancel', { reason: x }))}>{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('cnd.prn.deleteAsk')) && await run(() => st.removeNorm(n.id))) onGone(); }}>{t('act.delete')}</button>}
        {n.workflowInstanceId && <Link to={`/workflow/instance?id=${n.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {n.taskId && (
        <div className="mdm-panel no-print" data-testid="norm-decide"><h2>{t('dpr.decide')}</h2>
          <label>{t('mb.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="norm-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="norm-approve">{t('mb.approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('mb.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('mb.reject')}</button></div>
        </div>
      )}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="norm-history"><caption>{t('wa.history')}</caption><thead><tr><th>{t('wa.when')}</th><th>{t('wa.who')}</th><th>{t('wa.what')}</th><th>{t('wa.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((r, i) => <tr key={i}><td>{String(r.at ?? '').slice(0, 16).replace('T', ' ')}</td><td>{r.who}</td><td>{r.what}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function ProductivityNormsPage() {
  const t = useT('site'); usePageTitle(t('cnd.prn.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const isNew = sp.get('new') === '1'; const session = useSession(); const perms = session.data?.permissions ?? []; const qc = useQueryClient();
  const pq = useQuery({ queryKey: ['site', 'prod-projects'], queryFn: st.prodProjects, retry: false, enabled: perms.includes('site.productivity.configure') });
  const [projectId, setProjectId] = useState(''); const [msg, setMsg] = useState(null); const [error, setError] = useState(null);
  if (id) return <section aria-labelledby="norm-h" data-testid="site-productivity-norms"><Norm key={id} t={t} id={id} onGone={() => navigateTo('/site/productivity-norms')} /></section>;
  if (isNew) return <section data-testid="site-productivity-norms"><PageHeader srOnly title={t('cnd.prn.new')} /><NormForm t={t} editing={null} onSaved={(d) => { refresh(qc); navigateTo(`/site/productivity-norms?id=${d.id}`); }} onCancel={() => navigateTo('/site/productivity-norms')} /></section>;
  const boq = async () => { setError(null); setMsg(null); try { const r = await st.refreshBoq(Number(projectId)); setMsg(t('cnd.prn.boqDone', { m: r.made, k: r.kept })); refresh(qc); } catch (e) { setError(errorInfo(e).form); } };
  return (
    <section aria-labelledby="norm-h" data-testid="site-productivity-norms">
      <PageHeader id="norm-h" title={t('cnd.prn.title')} subtitle={t('cnd.prn.intro')} />
      <div className="actions-row no-print">{perms.includes('site.productivity.configure') && <Link to="/site/productivity-norms?new=1">{t('cnd.prn.new')}</Link>} <Link to="/site/productivity">{t('cnd.prd.title')}</Link></div>
      {perms.includes('site.productivity.configure') && (
        <div className="mdm-panel no-print" data-testid="norm-boq"><h2>{t('cnd.prn.fromBoq')}</h2><p className="muted">{t('cnd.prn.fromBoqHelp')}</p>
          <div className="form-grid"><Field label={t('cnd.prg.project')} name="boqProject"><select value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="norm-boq-project"><option value="">{t('cnd.prg.chooseProject')}</option>{(pq.data ?? []).filter((p) => p.canConfigure).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field></div>
          <button type="button" className="btn" disabled={!projectId} onClick={boq} data-testid="norm-boq-go">{t('cnd.prn.load')}</button>{msg && <p className="mdm-banner" role="status" data-testid="norm-boq-note">{msg}</p>}{error && <p className="field-error" role="alert">{error}</p>}
        </div>
      )}
      <ListReport listCode="site.prod_norms" endpoint="/site/productivity/norms" title={t('cnd.prn.title')} session={session.data} rowHref={(r) => `/site/productivity-norms?id=${r.id}`} onOpen={(r) => navigateTo(`/site/productivity-norms?id=${r.id}`)}
        cardFields={['project', 'activity', 'resource', 'output', 'effectiveFrom']} statusKey="status" empty={{ title: t('cnd.prn.emptyTitle'), text: t('cnd.prn.emptyBody') }} />
    </section>
  );
}
