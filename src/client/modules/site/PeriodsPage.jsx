import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { PRD_TONE, fmtDate, fmtPct, fmtRatio, fmtRs, openPrint, st, today } from './api.js';
import { useProjects } from './progress-parts.jsx';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Progress Period Close (part 14.05, FR-02, BR-02): a weekly or monthly period with its manual adjustments (a quantity added or taken off an activity, with a reason) and the actual cost; the server works out the
// snapshot when it is sent, the project manager closes it, and a closed period never changes (a correction is an amendment of the latest one).
const refresh = (qc) => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };
const blankAdj = () => ({ activityCode: '', qty: '', reason: '' });

function PeriodForm({ t, editing, onSaved, onCancel }) {
  const qc = useQueryClient(); const pq = useProjects(); const [f, setF] = useState(editing ? { projectId: editing.projectId, periodType: editing.periodType, periodEnd: editing.periodEnd, actualCost: editing.actualCost ?? '', adjustments: editing.adjustments.map((a) => ({ ...a, qty: String(a.qty) })) } : null);
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const projects = (pq.data ?? []).filter((p) => p.canCreate || editing);
  const projectId = f?.projectId ?? (projects.length === 1 ? projects[0].id : null);
  const oq = useQuery({ queryKey: ['site', 'period-options', projectId], queryFn: () => st.periodOptions(projectId), enabled: Boolean(projectId), retry: false });
  if (pq.isPending) return <Skeleton label={t('cnd.per.new')} rows={4} />;
  if (pq.isError) return <ErrorState error={pq.error} onRetry={pq.refetch} />;
  const form = f ?? { projectId, periodType: 'MONTH', periodEnd: today(), actualCost: '', adjustments: [] }; const set = (k, v) => setF({ ...form, projectId, [k]: v }); const o = oq.data;
  const setAdj = (i, k, v) => set('adjustments', form.adjustments.map((a, j) => (j === i ? { ...a, [k]: v } : a)));
  const body = () => ({ periodType: form.periodType, periodEnd: form.periodEnd, ...(o?.canSeeCost !== false ? { actualCost: form.actualCost === '' ? null : Number(form.actualCost) } : {}), adjustments: form.adjustments.filter((a) => a.activityCode || a.qty || a.reason).map((a) => ({ activityCode: a.activityCode, qty: Number(a.qty), reason: a.reason.trim() })) });
  const save = async (andSend) => {
    setError(null); if (!projectId) { setError({ form: t('cnd.prg.chooseProject'), fields: { projectId: t('cnd.prg.chooseProject') } }); return; } setBusy(true);
    try { let d = editing ? await st.updatePeriod(editing.id, { ...body(), rowVersion: editing.rowVersion }) : await st.createPeriod({ projectId, ...body() }); if (andSend) d = await st.periodAct(d.id, 'submit'); refresh(qc); onSaved(d); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  const errAt = (k) => error?.fields?.[k];
  return (
    <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); save(false); }} aria-label={editing ? t('cnd.per.edit') : t('cnd.per.new')} data-testid="per-form">
      <h2>{editing ? t('cnd.per.edit') : t('cnd.per.new')}</h2>
      <div className="form-grid">
        <Field label={t('cnd.prg.project')} name="projectId" error={error}><select value={projectId ?? ''} disabled={Boolean(editing)} onChange={(e) => setF({ ...form, projectId: e.target.value ? Number(e.target.value) : null, adjustments: [] })} data-testid="per-project"><option value="">{t('cnd.prg.chooseProject')}</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
        <Field label={t('cnd.per.type')} name="periodType" error={error}><select value={form.periodType} onChange={(e) => set('periodType', e.target.value)} data-testid="per-type"><option value="WEEK">{t('cnd.per.t.WEEK')}</option><option value="MONTH">{t('cnd.per.t.MONTH')}</option></select></Field>
        <Field label={t('cnd.per.start')} name="periodStart"><input value={editing ? editing.periodStart : (o?.nextStart ?? '')} readOnly data-testid="per-start" /></Field>
        <Field label={t('cnd.per.end')} name="periodEnd" error={error}><input type="date" value={form.periodEnd} max={today()} onChange={(e) => e.target.value && set('periodEnd', e.target.value)} data-testid="per-end" /></Field>
        {o?.canSeeCost !== false && <Field label={t('cnd.per.cost')} name="actualCost" error={error} hint={t('cnd.per.costHint')}><input type="number" min="0" step="0.01" inputMode="decimal" value={form.actualCost} onChange={(e) => set('actualCost', e.target.value)} data-testid="per-cost" /></Field>}
      </div>
      <fieldset><legend>{t('cnd.per.adjustments')}</legend><p className="muted">{t('cnd.per.adjHelp')}</p>
        {form.adjustments.length > 0 && <div className="table-scroll"><table className="data-table" data-testid="per-adj-table"><caption className="sr-only">{t('cnd.per.adjustments')}</caption><thead><tr><th>{t('cnd.prg.activity')}</th><th className="num">{t('cnd.per.adjQty')}</th><th>{t('cnd.per.reason')}</th><th><span className="sr-only">{t('act.remove')}</span></th></tr></thead>
          <tbody>{form.adjustments.map((a, i) => (
            <tr key={i} data-testid="per-adj-row"><td><select aria-label={t('cnd.prg.activity')} value={a.activityCode} onChange={(e) => setAdj(i, 'activityCode', e.target.value)} data-testid="per-adj-code"><option value="">—</option>{(o?.activities ?? []).map((x) => <option key={x.code} value={x.code}>{x.code} {x.name} ({x.qty} {x.uom})</option>)}</select>{errAt(`adjustments.${i}.activityCode`) && <span className="field-error">{errAt(`adjustments.${i}.activityCode`)}</span>}</td>
              <td><input aria-label={t('cnd.per.adjQty')} type="number" step="0.001" value={a.qty} onChange={(e) => setAdj(i, 'qty', e.target.value)} style={{ maxWidth: 120 }} data-testid="per-adj-qty" />{errAt(`adjustments.${i}.qty`) && <span className="field-error">{errAt(`adjustments.${i}.qty`)}</span>}</td>
              <td><input aria-label={t('cnd.per.reason')} value={a.reason} maxLength={1000} onChange={(e) => setAdj(i, 'reason', e.target.value)} data-testid="per-adj-reason" />{errAt(`adjustments.${i}.reason`) && <span className="field-error">{errAt(`adjustments.${i}.reason`)}</span>}</td>
              <td><button type="button" className="btn" onClick={() => set('adjustments', form.adjustments.filter((_, j) => j !== i))} aria-label={t('act.remove')}>×</button></td></tr>))}</tbody></table></div>}
        <button type="button" className="btn" disabled={!projectId} onClick={() => set('adjustments', [...form.adjustments, blankAdj()])} data-testid="per-adj-add">{t('cnd.per.addAdj')}</button>
      </fieldset>
      {error?.form && <p className="field-error" role="alert" data-testid="per-error">{error.form}{error.correlationId ? ` (${error.correlationId})` : ''}</p>}
      <div className="actions-row"><button type="submit" className="btn" style={{ minHeight: 44 }} disabled={busy} data-testid="per-save">{t('cnd.ins.saveDraft')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={busy} onClick={() => save(true)} data-testid="per-send">{t('act.submit')}</button><button type="button" className="btn" style={{ minHeight: 44 }} onClick={onCancel}>{t('cnd.close')}</button></div>
    </form>
  );
}

function Period({ t, id, onGone }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['site', 'period', id], queryFn: () => st.period(id), retry: false });
  const hq = useQuery({ queryKey: ['site', 'period-history', id], queryFn: () => st.periodHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [talk, setTalk] = useState(false); const [comment, setComment] = useState(''); const [editing, setEditing] = useState(false);
  usePageTitle(q.data ? `${q.data.docNo} · ${t('cnd.per.title')}` : t('cnd.per.title'));
  if (q.error?.status === 403) return <NoPermission what={t('cnd.per.title')} permission="site.period.view" />;
  if (q.isPending) return <Skeleton label={t('cnd.per.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const can = d.can; const s = d.snapshot;
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(qc); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('dpr.sayWhy') }); return; } run(() => st.decide(d.taskId, action, comment.trim() || null), t(`dpr.done.${action}`)); };
  if (editing) return <PeriodForm t={t} editing={d} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />;
  return (
    <div data-testid="per-object" data-status={d.status}>
      <PageHeader id="per-h" title={<>{d.docNo} · {fmtDate(d.periodStart)} – {fmtDate(d.periodEnd)} <StatusBadge status={PRD_TONE[d.status]} label={t(`cnd.per.s.${d.status}`)} /></>} meta={<><Link to="/site/periods">{t('cnd.per.back')}</Link>{d.revisionNo > 1 && <> · {t('dpr.amendmentOf', { n: d.previous?.docNo ?? '' })}</>}</>} />
      <dl className="kv" data-testid="per-figures"><div><dt>{t('cnd.prg.project')}</dt><dd>{d.projectCode} · {d.projectName}</dd></div><div><dt>{t('cnd.per.type')}</dt><dd>{t(`cnd.per.t.${d.periodType}`)}</dd></div>
        <div><dt>{t('cnd.prg.planned')}</dt><dd data-testid="per-planned">{fmtPct(d.planned)}</dd></div><div><dt>{t('cnd.prg.actual')}</dt><dd data-testid="per-physical">{fmtPct(d.physical)}</dd></div>
        {s?.project && <div><dt>SPI</dt><dd data-testid="per-spi">{fmtRatio(s.project.spi)}</dd></div>}{s?.project?.cpi != null && <div><dt>CPI</dt><dd>{fmtRatio(s.project.cpi)}</dd></div>}{s?.project?.eac != null && <div><dt>EAC</dt><dd>{fmtRs(s.project.eac)}</dd></div>}
        {d.actualCost != null && <div><dt>{t('cnd.per.cost')}</dt><dd>{fmtRs(d.actualCost)}</dd></div>}{d.costMasked && <div><dt>{t('cnd.per.cost')}</dt><dd>{t('cnd.ins.amountMasked')}</dd></div>}
        <div><dt>{t('wa.raisedBy')}</dt><dd>{d.requestedBy ?? '—'}</dd></div>{d.closedAt && <div><dt>{t('cnd.per.closedBy')}</dt><dd>{d.closedBy} · {fmtDate(d.closedAt.slice(0, 10))}</dd></div>}</dl>
      {d.status === 'APPROVED' && <p className="muted" data-testid="per-locked">{t('cnd.per.locked')}</p>}
      {d.preview && s && <p className="mdm-banner" role="status">{t('cnd.per.preview')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="per-obj-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="per-obj-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => setEditing(true)} data-testid="per-edit">{t('act.edit')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => st.periodAct(d.id, 'submit'), t('act.sent'))} data-testid="per-submit">{t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => st.periodAct(d.id, 'withdraw', { reason: x }))}>{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => st.periodAct(d.id, 'cancel', { reason: x }))} data-testid="per-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('cnd.per.deleteAsk')) && await run(() => st.removePeriod(d.id))) onGone(); }}>{t('act.delete')}</button>}
        {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => st.periodAct(d.id, 'amend', { reason: x })); if (n) navigateTo(`/site/periods?id=${n.id}`); } }} data-testid="per-amend">{t('cnd.hin.amend')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => openPrint(`/periods/${d.id}/print`).catch(() => null)} data-testid="per-print">{t('act.print')}</button>}
        <Link to={`/site/client-progress?projectId=${d.projectId}&periodId=${d.id}`}>{t('cnd.cli.title')}</Link>
        <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk}>{t('act.discussion')}</button>{d.workflowInstanceId && <Link to={`/workflow/instance?id=${d.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {d.taskId && (
        <div className="mdm-panel no-print" data-testid="per-decide"><h2>{t('dpr.decide')}</h2>
          <label>{t('mb.comment')}<input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} style={{ minHeight: 44 }} data-testid="per-comment" /></label>
          <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="per-approve">{t('cnd.per.close')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('mb.return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('mb.reject')}</button></div>
        </div>
      )}
      {talk && <div className="mdm-panel"><DiscussionTab entity="prs_period" id={d.id} /></div>}
      <div className="mdm-panel" data-testid="per-adjustments"><h2>{t('cnd.per.adjustments')} ({d.adjustments.length})</h2>
        {d.adjustments.length === 0 ? <p className="muted">{t('cnd.per.noAdj')}</p> : <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.per.adjustments')}</caption><thead><tr><th>{t('cnd.prg.activity')}</th><th className="num">{t('cnd.per.adjQty')}</th><th>{t('cnd.per.reason')}</th></tr></thead><tbody>{d.adjustments.map((a, i) => <tr key={i}><td>{a.activityCode}</td><td className="num">{a.qty}</td><td>{a.reason}</td></tr>)}</tbody></table></div>}
      </div>
      {s && <div className="mdm-panel" data-testid="per-snapshot"><h2>{t('cnd.per.snapshot')}</h2><p className="muted">{t('cnd.per.snapshotHelp', { d: String(s.takenAt).slice(0, 16).replace('T', ' ') })}{s.baseline ? ` · ${s.baseline.docNo}` : ` · ${t('cnd.prg.baselineMissing')}`}</p>
        <div className="table-scroll"><table className="data-table"><caption className="sr-only">{t('cnd.per.snapshot')}</caption><thead><tr><th>{t('cnd.prg.wbs')}</th><th className="num">{t('cnd.prg.planned')}</th><th className="num">{t('cnd.prg.actual')}</th><th className="num">SPI</th>{s.wbs[0]?.bac !== undefined && <><th className="num">PV</th><th className="num">EV</th></>}</tr></thead>
          <tbody>{s.wbs.map((n) => <tr key={n.code} data-testid="per-wbs-row"><td style={{ paddingLeft: 8 + n.level * 16 }}>{n.code} {n.name}</td><td className="num">{fmtPct(n.planned)}</td><td className="num">{fmtPct(n.physical)}</td><td className="num">{fmtRatio(n.spi)}</td>{n.bac !== undefined && <><td className="num">{fmtRs(n.pv)}</td><td className="num">{fmtRs(n.ev)}</td></>}</tr>)}</tbody></table></div></div>}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="per-history"><caption>{t('wa.history')}</caption><thead><tr><th>{t('wa.when')}</th><th>{t('wa.who')}</th><th>{t('wa.what')}</th><th>{t('wa.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((r, i) => <tr key={i}><td>{String(r.at ?? '').slice(0, 16).replace('T', ' ')}</td><td>{r.who}</td><td>{r.what}</td><td>{r.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function PeriodsPage() {
  const t = useT('site'); usePageTitle(t('cnd.per.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const isNew = sp.get('new') === '1'; const session = useSession(); const perms = session.data?.permissions ?? [];
  if (id) return <section aria-labelledby="per-h" data-testid="site-periods"><Period key={id} t={t} id={id} onGone={() => navigateTo('/site/periods')} /></section>;
  if (isNew) return <section data-testid="site-periods"><PageHeader srOnly title={t('cnd.per.new')} /><PeriodForm t={t} editing={null} onSaved={(d) => navigateTo(`/site/periods?id=${d.id}`)} onCancel={() => navigateTo('/site/periods')} /></section>;
  return (
    <section aria-labelledby="per-h" data-testid="site-periods">
      <PageHeader id="per-h" srOnly title={t('cnd.per.title')} />
      <div className="actions-row no-print">{perms.includes('site.period.create') && <Link to="/site/periods?new=1">{t('cnd.per.new')}</Link>} <Link to="/site/progress">{t('cnd.prg.title')}</Link> <Link to="/site/progress-report">{t('cnd.rep.title')}</Link> <Link to="/site/client-progress">{t('cnd.cli.title')}</Link></div>
      <ListReport listCode="site.periods" endpoint="/site/periods" title={t('cnd.per.title')} session={session.data} rowHref={(r) => `/site/periods?id=${r.id}`} onOpen={(r) => navigateTo(`/site/periods?id=${r.id}`)}
        cardFields={['docNo', 'project', 'periodEnd', 'physical', 'planned']} statusKey="status" empty={{ title: t('cnd.per.emptyTitle'), text: t('cnd.per.emptyBody') }} />
    </section>
  );
}
