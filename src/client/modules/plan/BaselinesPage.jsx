import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { BASELINE_TONE, REVISIONS, download, fmtDate, openPrint, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';

// Baselines (part 13.03, FR-01, FR-02): the frozen pictures of the programme. The list, and one baseline with its approval (project manager, then project director), its change against the baseline it
// revises, its comparison with the programme of today and the other baselines of the project. An approved baseline is never changed: a revision is a new baseline with its kind and reason.
const slug = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '-');
const signed = (n) => (n == null ? '—' : n > 0 ? `+${n}` : String(n));

function NewBaseline({ t, onDone }) {
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(null);
  const [f, setF] = useState({ name: '', revisionType: 'EOT', reason: '', changeSummary: '', referenceNo: '' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const bq = useQuery({ queryKey: ['plan', 'baselines-of', projectId], queryFn: () => pl.baselinesOf(projectId), enabled: Boolean(projectId), retry: false });
  const revision = (bq.data?.rows ?? []).some((b) => b.status === 'APPROVED'); const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try { onDone(await pl.createBaseline({ scheduleId, name: f.name.trim(), revisionType: revision ? f.revisionType : 'ORIGINAL', reason: f.reason.trim(), changeSummary: f.changeSummary.trim() || null, referenceNo: f.referenceNo.trim() || null })); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <form className="mdm-panel" onSubmit={save} data-testid="bl-form" aria-label={t('bl.new')}>
      <h2>{t('bl.new')}</h2>
      <SchedulePicker projectId={projectId} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); }} onSchedule={setScheduleId} testId="bl" />
      {bq.data && !bq.data.canCreate && <p className="field-error" role="alert" data-testid="bl-open">{t('bl.oneOpen')}</p>}
      <div className="form-grid">
        <Field label={t('f.name')} name="name" error={error}><input value={f.name} onChange={(e) => set('name', e.target.value)} required minLength={3} maxLength={200} data-testid="bl-name" /></Field>
        <Field label={t('bl.kind')} name="revisionType" error={error}>{revision
          ? <select value={f.revisionType} onChange={(e) => set('revisionType', e.target.value)} data-testid="bl-kind">{REVISIONS.map((k) => <option key={k} value={k}>{t(`bl.kind.${k}`)}</option>)}</select>
          : <input value={t('bl.kind.ORIGINAL')} readOnly data-testid="bl-kind" />}</Field>
        <Field label={t('bl.reference')} name="referenceNo" error={error}><input value={f.referenceNo} onChange={(e) => set('referenceNo', e.target.value)} maxLength={80} data-testid="bl-ref" /></Field>
      </div>
      <Field label={t('f.reason')} name="reason" error={error}><textarea value={f.reason} onChange={(e) => set('reason', e.target.value)} required minLength={5} maxLength={1000} rows={2} data-testid="bl-reason" /></Field>
      {revision && <Field label={t('bl.changeSummary')} name="changeSummary" error={error}><textarea value={f.changeSummary} onChange={(e) => set('changeSummary', e.target.value)} maxLength={2000} rows={2} data-testid="bl-summary" /></Field>}
      <p className="muted">{t('bl.newHint')}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="bl-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !scheduleId} data-testid="bl-save">{t('bl.create')}</button></div>
    </form>
  );
}

/** The spread of the finish variances: one series, so one colour; the count is written on every bar. */
function Buckets({ t, buckets }) {
  const max = Math.max(1, ...buckets.map((b) => b.n)); const W = 420; const rowH = 26;
  return (
    <svg width={W} height={buckets.length * rowH} role="img" aria-label={t('var.chartSpread')} data-testid="var-buckets" style={{ maxWidth: '100%' }}>
      {buckets.map((b, i) => (
        <g key={b.key}><title>{`${t(`var.bucket.${b.key}`)}: ${b.n}`}</title>
          <text x={150} y={i * rowH + 17} fontSize="12" textAnchor="end" fill="var(--erp-color-text-secondary)">{t(`var.bucket.${b.key}`)}</text>
          <rect x={158} y={i * rowH + 6} width={Math.max(b.n ? 3 : 0, ((W - 200) * b.n) / max)} height={rowH - 12} rx="3" fill="var(--erp-chart-1)" />
          <text x={164 + ((W - 200) * b.n) / max} y={i * rowH + 17} fontSize="12" fill="var(--erp-color-text-primary)">{b.n}</text>
        </g>
      ))}
    </svg>
  );
}
export { Buckets };

function Baseline({ t, id, onGone }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plan', 'baseline', id], queryFn: () => pl.baseline(id), retry: false });
  const hq = useQuery({ queryKey: ['plan', 'baseline-history', id], queryFn: () => pl.baselineHistory(id), enabled: q.isSuccess, retry: false });
  const oq = useQuery({ queryKey: ['plan', 'baselines-of', q.data?.projectId], queryFn: () => pl.baselinesOf(q.data.projectId), enabled: q.isSuccess, retry: false });
  const vq = useQuery({ queryKey: ['plan', 'variance', id, 'summary'], queryFn: () => pl.variance(id, 'pageSize=25'), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [edit, setEdit] = useState(null); const [rev, setRev] = useState(null); const [talk, setTalk] = useState(false);
  usePageTitle(q.data ? `${q.data.docNo} · ${t('bl.title')}` : t('bl.title'));
  if (q.error?.status === 403) return <NoPermission what={t('bl.title')} permission="plan.baseline.view" />;
  if (q.isPending) return <Skeleton label={t('bl.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const b = q.data; const can = b.can; const c = b.change ?? {};
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['plan'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  return (
    <div data-testid="bl-object" data-status={b.status}>
      <h1 id="bl-h">{b.docNo} · {b.name} <StatusBadge status={BASELINE_TONE[b.status]} label={t(`st.${b.status}`)} /> {b.current && <span className="chip" data-testid="bl-current">{t('bl.current')}</span>}</h1>
      <p><Link to="/plan/baselines">{t('bl.back')}</Link></p>
      <dl className="kv" data-testid="bl-figures">
        <div><dt>{t('f.project')}</dt><dd>{b.projectCode} · {b.projectName}</dd></div><div><dt>{t('bl.revision')}</dt><dd>{b.baselineNo} · {t(`bl.kind.${b.revisionType}`)}</dd></div>
        <div><dt>{t('f.schedule')}</dt><dd><Link to={`/plan/activities?scheduleId=${b.scheduleId}`}>{b.scheduleDocNo} v{b.scheduleVersionNo}</Link> · {t(`st.${b.scheduleStatus}`)}</dd></div>
        <div><dt>{t('f.start')}</dt><dd>{fmtDate(b.startDate)}</dd></div><div><dt>{t('f.finish')}</dt><dd data-testid="bl-finish">{fmtDate(b.finishDate)}</dd></div><div><dt>{t('f.activities')}</dt><dd>{b.activities}</dd></div>
        <div><dt>{t('f.critical')}</dt><dd>{b.critical}</dd></div><div><dt>{t('bl.links')}</dt><dd>{b.links}</dd></div>{b.referenceNo && <div><dt>{t('bl.reference')}</dt><dd>{b.referenceNo}</dd></div>}
        <div><dt>{t('bl.preparedBy')}</dt><dd>{b.requestedBy ?? '—'}</dd></div>{b.approvedAt && <div><dt>{t('bl.approvedBy')}</dt><dd>{b.approvedBy} · {fmtDate(b.approvedAt.slice(0, 10))}</dd></div>}
      </dl>
      <p><strong>{t('f.reason')}:</strong> {b.reason}</p>
      {b.changeSummary && <p data-testid="bl-change-summary"><strong>{t('bl.changeSummary')}:</strong> {b.changeSummary}</p>}
      {b.status === 'APPROVED' && <p className="muted" data-testid="bl-frozen">{t('bl.frozen')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="bl-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="bl-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => setEdit(edit ? null : { name: b.name, reason: b.reason, changeSummary: b.changeSummary ?? '', referenceNo: b.referenceNo ?? '', refresh: false })} data-testid="bl-edit">{t('bl.edit')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => pl.baselineAct(b.id, 'submit'), t('act.sent'))} data-testid="bl-submit">{t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => pl.baselineAct(b.id, 'withdraw', { reason: x }))} data-testid="bl-withdraw">{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => pl.baselineAct(b.id, 'cancel', { reason: x }))} data-testid="bl-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('bl.deleteAsk')) && await run(() => pl.removeBaseline(b.id))) onGone(); }} data-testid="bl-delete">{t('bl.delete')}</button>}
        {can.amend && <button type="button" className="btn" onClick={() => setRev(rev ? null : { revisionType: 'EOT', reason: '', changeSummary: '', referenceNo: '' })} data-testid="bl-amend">{t('bl.revise')}</button>}
        <button type="button" className="btn" onClick={() => navigateTo(`/plan/variance?baselineId=${b.id}`)} data-testid="bl-variance">{t('var.title')}</button>
        {can.print && <button type="button" className="btn" onClick={() => openPrint(`/baselines/${b.id}/print`).catch(() => null)} data-testid="bl-print">{t('act.print')}</button>}
        {can.export && ['msp', 'p6'].map((f) => <button key={f} type="button" className="btn" onClick={() => download(`/baselines/${b.id}/exchange?format=${f}`, `${slug(b.docNo)}-${f}.xml`).catch(() => setError({ form: t('bl.fileFailed') }))} data-testid={`bl-file-${f}`}>{t(`bl.file.${f}`)}</button>)}
        <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk} data-testid="bl-discuss">{t('act.discussion')}</button>
        {b.workflowInstanceId && <Link to={`/workflow/instance?id=${b.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {talk && <div className="mdm-panel" data-testid="bl-discussion"><DiscussionTab entity="plan_baseline" id={b.id} /></div>}
      {edit && (
        <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); if (await run(() => pl.updateBaseline(b.id, { name: edit.name.trim(), reason: edit.reason.trim(), changeSummary: edit.changeSummary.trim() || null, referenceNo: edit.referenceNo.trim() || null, ...(edit.refresh ? { refresh: true } : {}), rowVersion: b.rowVersion }), t('bl.saved'))) setEdit(null); }} data-testid="bl-edit-form" aria-label={t('bl.edit')}>
          <div className="form-grid">
            <Field label={t('f.name')} name="name" error={error}><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required minLength={3} maxLength={200} data-testid="bl-edit-name" /></Field>
            <Field label={t('bl.reference')} name="referenceNo" error={error}><input value={edit.referenceNo} onChange={(e) => setEdit({ ...edit, referenceNo: e.target.value })} maxLength={80} /></Field>
          </div>
          <Field label={t('f.reason')} name="reason" error={error}><textarea value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} required minLength={5} maxLength={1000} rows={2} /></Field>
          <Field label={t('bl.changeSummary')} name="changeSummary" error={error}><textarea value={edit.changeSummary} onChange={(e) => setEdit({ ...edit, changeSummary: e.target.value })} maxLength={2000} rows={2} data-testid="bl-edit-summary" /></Field>
          <label className="check"><input type="checkbox" checked={edit.refresh} onChange={(e) => setEdit({ ...edit, refresh: e.target.checked })} data-testid="bl-edit-refresh" /> {t('bl.refresh')}</label>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="bl-edit-save">{t('act.save')}</button><button type="button" className="btn" onClick={() => setEdit(null)}>{t('act.cancel')}</button></div>
        </form>
      )}
      {rev && (
        <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); const n = await run(() => pl.baselineAct(b.id, 'amend', { revisionType: rev.revisionType, reason: rev.reason.trim(), changeSummary: rev.changeSummary.trim() || null, referenceNo: rev.referenceNo.trim() || null })); if (n) { setRev(null); navigateTo(`/plan/baselines?id=${n.id}`); } }} data-testid="bl-amend-form" aria-label={t('bl.revise')}>
          <h2>{t('bl.revise')}</h2><p className="muted">{t('bl.reviseHint')}</p>
          <div className="form-grid">
            <Field label={t('bl.kind')} name="revisionType" error={error}><select value={rev.revisionType} onChange={(e) => setRev({ ...rev, revisionType: e.target.value })} data-testid="bl-amend-kind">{REVISIONS.map((k) => <option key={k} value={k}>{t(`bl.kind.${k}`)}</option>)}</select></Field>
            <Field label={t('bl.reference')} name="referenceNo" error={error}><input value={rev.referenceNo} onChange={(e) => setRev({ ...rev, referenceNo: e.target.value })} maxLength={80} data-testid="bl-amend-ref" /></Field>
          </div>
          <Field label={t('f.reason')} name="reason" error={error}><textarea value={rev.reason} onChange={(e) => setRev({ ...rev, reason: e.target.value })} required minLength={5} maxLength={1000} rows={2} data-testid="bl-amend-reason" /></Field>
          <Field label={t('bl.changeSummary')} name="changeSummary" error={error}><textarea value={rev.changeSummary} onChange={(e) => setRev({ ...rev, changeSummary: e.target.value })} maxLength={2000} rows={2} data-testid="bl-amend-summary" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="bl-amend-save">{t('bl.reviseCreate')}</button><button type="button" className="btn" onClick={() => setRev(null)}>{t('act.cancel')}</button></div>
        </form>
      )}
      {b.previousDocNo && (
        <div className="mdm-panel" data-testid="bl-change">
          <h2>{t('bl.against', { d: b.previousDocNo })}</h2>
          <dl className="kv">
            <div><dt>{t('bl.finishMoves')}</dt><dd data-testid="bl-change-finish">{fmtDate(c.baselineFinish)} → {fmtDate(c.finish)} ({t('var.days', { n: signed(c.finishVar ?? 0) })})</dd></div>
            <div><dt>{t('var.added')}</dt><dd>{c.added ?? 0}</dd></div><div><dt>{t('var.removed')}</dt><dd>{c.removed ?? 0}</dd></div><div><dt>{t('var.changed')}</dt><dd>{c.changed ?? 0}</dd></div>
            <div><dt>{t('var.slipped')}</dt><dd>{c.slipped ?? 0}</dd></div><div><dt>{t('var.criticalSlipped')}</dt><dd>{c.criticalSlipped ?? 0}</dd></div><div><dt>{t('bl.linksChanged')}</dt><dd>+{c.linksAdded ?? 0} / −{c.linksRemoved ?? 0}</dd></div>
          </dl>
          {(c.top ?? []).length > 0 && (
            <div className="table-scroll"><table className="data-table"><caption>{t('bl.topSlips')}</caption><thead><tr><th>{t('f.code')}</th><th>{t('f.activity')}</th><th className="num">{t('var.finishVar')}</th><th>{t('f.critical')}</th></tr></thead>
              <tbody>{c.top.map((x) => <tr key={x.code}><td>{x.code}</td><td>{x.name}</td><td className="num">{signed(x.finishVar)}</td><td>{x.critical ? t('var.yes') : ''}</td></tr>)}</tbody></table></div>
          )}
        </div>
      )}
      <div className="mdm-panel" data-testid="bl-compare">
        <h2>{t('bl.compare')}</h2>
        {vq.isPending ? <Skeleton label={t('bl.compare')} rows={2} /> : vq.isError ? <ErrorState error={vq.error} onRetry={vq.refetch} /> : (
          <>
            <p className="muted">{t('bl.compareWith', { d: vq.data.against.label })}{vq.data.against.needsCalc ? ` · ${t('act.needsCalc')}` : ''}</p>
            <dl className="kv">
              <div><dt>{t('var.baselineFinish')}</dt><dd>{fmtDate(vq.data.summary.baselineFinish)}</dd></div><div><dt>{t('var.currentFinish')}</dt><dd>{fmtDate(vq.data.summary.currentFinish)}</dd></div>
              <div><dt>{t('var.finishVar')}</dt><dd data-testid="bl-compare-var">{t('var.days', { n: signed(vq.data.summary.finishVar) })}</dd></div><div><dt>{t('var.slipped')}</dt><dd>{vq.data.summary.slipped}</dd></div><div><dt>{t('var.criticalSlipped')}</dt><dd>{vq.data.summary.criticalSlipped}</dd></div>
            </dl>
            <Buckets t={t} buckets={vq.data.summary.buckets} />
            <p><Link to={`/plan/variance?baselineId=${b.id}`}>{t('bl.fullReport')}</Link></p>
          </>
        )}
      </div>
      {(oq.data?.rows ?? []).length > 1 && (
        <div className="table-scroll"><table className="data-table" data-testid="bl-others"><caption>{t('bl.ofProject')}</caption>
          <thead><tr><th>{t('bl.revision')}</th><th>{t('bl.docNo')}</th><th>{t('bl.kind')}</th><th>{t('f.status')}</th><th>{t('f.finish')}</th></tr></thead>
          <tbody>{oq.data.rows.map((x) => <tr key={x.id} aria-current={x.id === b.id ? 'true' : undefined}><td>{x.baselineNo}</td><td>{x.id === b.id ? x.docNo : <Link to={`/plan/baselines?id=${x.id}`}>{x.docNo}</Link>}{x.current ? ` · ${t('bl.current')}` : ''}</td><td>{t(`bl.kind.${x.revisionType}`)}</td><td>{t(`st.${x.status}`)}</td><td>{fmtDate(x.finishDate)}</td></tr>)}</tbody></table></div>
      )}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="bl-history"><caption>{t('bl.history')}</caption>
          <thead><tr><th>{t('bl.when')}</th><th>{t('bl.who')}</th><th>{t('bl.what')}</th><th>{t('bl.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function BaselinesPage() {
  const t = useT('plan');
  const sp = useSearch(); const id = Number(sp.get('id')) || null;
  const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? []; const [adding, setAdding] = useState(false);
  usePageTitle(t('bl.title'));
  if (id) return <section aria-labelledby="bl-h" data-testid="plan-baselines"><Baseline key={id} t={t} id={id} onGone={() => navigateTo('/plan/baselines')} /></section>;
  return (
    <section aria-labelledby="bl-h" data-testid="plan-baselines">
      <h1 id="bl-h" className="sr-only">{t('bl.title')}</h1>
      <div className="actions-row no-print">
        {perms.includes('plan.baseline.create') && <button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)} data-testid="bl-new">{t('bl.new')}</button>}
        <button type="button" className="btn" onClick={() => navigateTo('/plan/variance')} data-testid="bl-to-variance">{t('var.title')}</button>
      </div>
      {adding && <NewBaseline t={t} onDone={(b) => { qc.invalidateQueries({ queryKey: ['plan'] }); navigateTo(`/plan/baselines?id=${b.id}`); }} />}
      <ListReport listCode="plan.baselines" endpoint="/plan/baselines" title={t('bl.title')} session={session.data} rowHref={(r) => `/plan/baselines?id=${r.id}`} onOpen={(r) => navigateTo(`/plan/baselines?id=${r.id}`)}
        cardFields={[{ key: 'project', label: t('f.project') }, { key: 'status', label: t('f.status') }, { key: 'baselineNo', label: t('bl.revision') }, { key: 'finishDate', label: t('f.finish') }]} statusKey="status"
        empty={{ title: t('bl.emptyTitle'), text: t('bl.emptyBody') }} />
    </section>
  );
}
