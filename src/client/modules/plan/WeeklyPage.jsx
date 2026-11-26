import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { VARIANCE_CODES, WEEKLY_TONE, download, fmtDate, mondayOf, openPrint, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { todayIst } from '../../platform/forms/dates.js';

// Weekly Work Plan (part 13.04, FR-04, FR-05, BR-01): the commitments of a week by activity and crew, sent to the construction manager and the project manager, then what was done and why not, and PPC.
// The page is the list, one plan (draft, approval, record, daily breakdown) and the report of PPC by week with the reasons for what was not done.
const todayIso = () => todayIst();
const num = (v) => (v === '' || v == null ? 0 : Number(v));
const fmtN = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });

function NewPlan({ t, initial, onDone }) {
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(initial.scheduleId); const [week, setWeek] = useState(initial.week ? mondayOf(initial.week) : mondayOf(todayIso())); const [siteId, setSiteId] = useState(initial.siteId ?? '');
  const [rows, setRows] = useState([]); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [note, setNote] = useState('');
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const pid = projectId ?? sq.data?.projectId ?? null;
  const oq = useQuery({ queryKey: ['plan', 'la-options', pid], queryFn: () => pl.lookaheadOptions(pid), enabled: Boolean(pid), retry: false });
  const bq = useQuery({ queryKey: ['plan', 'lookahead', scheduleId, `week-${week}`], queryFn: () => pl.lookahead(scheduleId, `weeks=1&from=${week}`), enabled: Boolean(scheduleId) && week === mondayOf(week), retry: false });
  useEffect(() => { if (bq.data && initial.add?.length && rows.length === 0) setRows(bq.data.activities.filter((a) => initial.add.includes(a.id)).map((a) => ({ activityId: a.id, code: a.code, name: a.name, crewId: '', qty: '', uom: '' }))); }, [bq.data]);
  const set = (i, p) => setRows((x) => x.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const crews = (oq.data?.crews ?? []).filter((c) => !siteId || c.siteId === Number(siteId));
  const save = async (e) => { e.preventDefault(); setError(null); setBusy(true); try { onDone(await pl.createWeekly({ scheduleId, siteId: siteId ? Number(siteId) : null, weekStart: week, note: note.trim() || null, items: rows.map((r) => ({ activityId: r.activityId, crewId: r.crewId ? Number(r.crewId) : null, committedQty: Number(r.qty), uom: r.uom.trim() || null })) })); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  const addable = (bq.data?.activities ?? []).filter((a) => !rows.some((r) => r.activityId === a.id));
  return (
    <form className="mdm-panel" onSubmit={save} data-testid="wp-form" aria-label={t('wp.new')}>
      <h2>{t('wp.new')}</h2>
      <SchedulePicker projectId={pid} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); setRows([]); }} onSchedule={(v) => { setScheduleId(v); setRows([]); }} testId="wp" />
      <div className="form-grid">
        <Field label={t('wp.weekFrom')} name="weekStart" error={error}><input type="date" value={week} onChange={(e) => setWeek(e.target.value)} required data-testid="wp-week" /></Field>
        <Field label={t('la.site')} name="siteId" error={error}><select value={siteId} onChange={(e) => setSiteId(e.target.value)} data-testid="wp-site"><option value="">{t('wp.wholeProject')}</option>{(oq.data?.sites ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
      </div>
      <Field label={t('wp.note')} name="note" error={error}><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} data-testid="wp-note-input" /></Field>
      {week !== mondayOf(week) && <p className="field-error" role="alert">{t('wp.mondayOnly')}</p>}
      {rows.length > 0 && (
        <div className="table-scroll"><table className="data-table" data-testid="wp-new-lines"><caption>{t('wp.commitments')}</caption>
          <thead><tr><th>{t('f.activity')}</th><th>{t('wp.crew')}</th><th className="num">{t('wp.committed')}</th><th>{t('f.uom')}</th><th><span className="sr-only">{t('act.remove')}</span></th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={`${r.activityId}-${i}`} data-testid="wp-new-line"><td>{r.code} {r.name}</td>
              <td><select aria-label={t('wp.crew')} value={r.crewId} onChange={(e) => set(i, { crewId: e.target.value })} data-testid="wp-new-crew"><option value="">—</option>{crews.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></td>
              <td className="num"><input type="number" min="0" step="0.001" aria-label={t('wp.committed')} value={r.qty} onChange={(e) => set(i, { qty: e.target.value })} required data-testid="wp-new-qty" /></td>
              <td><input aria-label={t('f.uom')} value={r.uom} onChange={(e) => set(i, { uom: e.target.value })} maxLength={20} size={8} /></td>
              <td><button type="button" className="btn" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={t('r.remove', { n: i + 1 })}>{t('act.remove')}</button></td></tr>
          ))}</tbody></table></div>
      )}
      {addable.length > 0 && <Field label={t('wp.addActivity')} name="add"><select value="" onChange={(e) => { const a = addable.find((x) => x.id === Number(e.target.value)); if (a) setRows([...rows, { activityId: a.id, code: a.code, name: a.name, crewId: '', qty: '', uom: '' }]); }} data-testid="wp-add"><option value="">—</option>{addable.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}{a.ready ? '' : ` ⚠ ${a.constraints.length}`}</option>)}</select></Field>}
      {error?.form && <p className="field-error" role="alert" data-testid="wp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || rows.length === 0 || rows.some((r) => !(Number(r.qty) > 0))} data-testid="wp-create">{t('wp.create')}</button></div>
    </form>
  );
}

function Plan({ t, id, onGone }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plan', 'weekly', id], queryFn: () => pl.weekly(id), retry: false });
  const dq = useQuery({ queryKey: ['plan', 'weekly-daily', id], queryFn: () => pl.weeklyDaily(id), enabled: q.isSuccess, retry: false });
  const hq = useQuery({ queryKey: ['plan', 'weekly-history', id], queryFn: () => pl.weeklyHistory(id), enabled: q.isSuccess, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [edit, setEdit] = useState(null); const [rec, setRec] = useState(null); const [talk, setTalk] = useState(false);
  usePageTitle(q.data ? `${q.data.docNo} · ${t('wp.title')}` : t('wp.title'));
  if (q.error?.status === 403) return <NoPermission what={t('wp.title')} permission="plan.weekly_plan.view" />;
  if (q.isPending) return <Skeleton label={t('wp.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data; const can = p.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['plan'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  const startEdit = () => setEdit({ note: p.note ?? '', lines: p.lines.map((l) => ({ activityId: l.activityId, label: `${l.activity} ${l.activityName}`, crewId: l.crewId ? String(l.crewId) : '', qty: String(l.committedQty), uom: l.uom ?? '' })) });
  const startRecord = () => setRec(Object.fromEntries(p.lines.map((l) => [l.id, { qty: String(l.completedQty), code: l.varianceCode ?? '' }])));
  const done = p.status === 'CLOSED';
  return (
    <div data-testid="wp-object" data-status={p.status}>
      <PageHeader id="wp-h" title={<>{p.docNo} · {t('wp.weekOf', { d: fmtDate(p.weekStart) })} <StatusBadge status={WEEKLY_TONE[p.status]} label={t(`wp.st.${p.status}`)} /></>} meta={<Link to="/plan/weekly">{t('wp.back')}</Link>} />
      <dl className="kv" data-testid="wp-figures">
        <div><dt>{t('f.project')}</dt><dd>{p.projectCode} · {p.projectName}</dd></div><div><dt>{t('la.site')}</dt><dd>{p.site ?? t('wp.wholeProject')}</dd></div><div><dt>{t('f.schedule')}</dt><dd><Link to={`/plan/lookahead?scheduleId=${p.scheduleId}`}>{p.scheduleDocNo}</Link></dd></div>
        <div><dt>{t('bl.revision')}</dt><dd>{p.revisionNo}</dd></div><div><dt>{t('wp.commitments')}</dt><dd>{p.items}</dd></div><div><dt>{t('wp.completedCount')}</dt><dd data-testid="wp-completed">{p.completedCount}</dd></div>
        <div><dt>{t('wp.ppc')}</dt><dd data-testid="wp-ppc">{p.ppc != null ? `${p.ppc} %${p.ppcFinal ? '' : ` (${t('wp.live')})`}` : '—'}</dd></div><div><dt>{t('bl.preparedBy')}</dt><dd>{p.requestedBy ?? '—'}</dd></div>{p.approvedAt && <div><dt>{t('bl.approvedBy')}</dt><dd>{p.approvedBy} · {fmtDate(p.approvedAt.slice(0, 10))}</dd></div>}
      </dl>
      {p.note && <p>{p.note}</p>}{p.reason && <p><strong>{t('f.reason')}:</strong> {p.reason}</p>}
      {p.status === 'APPROVED' && <p className="muted" data-testid="wp-locked">{t('wp.locked')}</p>}
      {error?.form && <p className="field-error" role="alert" data-testid="wp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="wp-note">{note}</p>}
      <div className="actions-row no-print">
        {can.edit && <button type="button" className="btn" onClick={() => (edit ? setEdit(null) : startEdit())} data-testid="wp-edit">{t('bl.edit')}</button>}
        {can.submit && <button type="button" className="btn btn-primary" onClick={() => run(() => pl.weeklyAct(p.id, 'submit'), t('act.sent'))} data-testid="wp-submit">{t('act.submit')}</button>}
        {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => pl.weeklyAct(p.id, 'withdraw', { reason: x }))} data-testid="wp-withdraw">{t('act.withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why((x) => pl.weeklyAct(p.id, 'cancel', { reason: x }))} data-testid="wp-cancel">{t('act.cancel')}</button>}
        {can.delete && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('bl.deleteAsk')) && await run(() => pl.removeWeekly(p.id))) onGone(); }} data-testid="wp-delete">{t('bl.delete')}</button>}
        {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => pl.weeklyAct(p.id, 'amend', { reason: x })); if (n) navigateTo(`/plan/weekly?id=${n.id}`); } }} data-testid="wp-amend">{t('bl.revise')}</button>}
        {can.record && <button type="button" className="btn" onClick={() => (rec ? setRec(null) : startRecord())} data-testid="wp-record">{t('wp.record')}</button>}
        {can.close && <button type="button" className="btn btn-primary" onClick={() => run(() => pl.weeklyAct(p.id, 'close'), t('wp.closedNote'))} data-testid="wp-close">{t('wp.close')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => openPrint(`/weekly-plans/${p.id}/print`).catch(() => null)} data-testid="wp-print">{t('act.print')}</button>}
        <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk} data-testid="wp-discuss">{t('act.discussion')}</button>
        {p.workflowInstanceId && <Link to={`/workflow/instance?id=${p.workflowInstanceId}`}>{t('act.approval')}</Link>}
      </div>
      {talk && <div className="mdm-panel" data-testid="wp-discussion"><DiscussionTab entity="plan_weekly_plan" id={p.id} /></div>}
      {edit && (
        <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); if (await run(() => pl.updateWeekly(p.id, { note: edit.note.trim() || null, items: edit.lines.map((l) => ({ activityId: l.activityId, crewId: l.crewId ? Number(l.crewId) : null, committedQty: Number(l.qty), uom: l.uom.trim() || null })), rowVersion: p.rowVersion }), t('bl.saved'))) setEdit(null); }} data-testid="wp-edit-form" aria-label={t('bl.edit')}>
          <Field label={t('wp.note')} name="note" error={error}><input value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} maxLength={1000} /></Field>
          <div className="table-scroll"><table className="data-table"><caption>{t('wp.commitments')}</caption><thead><tr><th>{t('f.activity')}</th><th className="num">{t('wp.committed')}</th><th>{t('f.uom')}</th><th><span className="sr-only">{t('act.remove')}</span></th></tr></thead>
            <tbody>{edit.lines.map((l, i) => <tr key={`${l.activityId}-${i}`}><td>{l.label}</td><td className="num"><input type="number" min="0" step="0.001" aria-label={t('wp.committed')} value={l.qty} onChange={(e) => setEdit({ ...edit, lines: edit.lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)) })} data-testid="wp-edit-qty" /></td><td>{l.uom}</td><td><button type="button" className="btn" onClick={() => setEdit({ ...edit, lines: edit.lines.filter((_, k) => k !== i) })}>{t('act.remove')}</button></td></tr>)}</tbody></table></div>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={edit.lines.length === 0 || edit.lines.some((l) => !(Number(l.qty) > 0))} data-testid="wp-edit-save">{t('act.save')}</button><button type="button" className="btn" onClick={() => setEdit(null)}>{t('act.cancel')}</button></div>
        </form>
      )}
      <div className="table-scroll"><table className="data-table" data-testid="wp-lines"><caption>{t('wp.commitments')}</caption>
        <thead><tr><th>{t('f.activity')}</th><th>{t('wp.crew')}</th><th className="num">{t('wp.committed')}</th><th className="num">{t('wp.completed')}</th><th>{t('f.uom')}</th><th>{t('wp.result')}</th><th>{t('wp.ready')}</th></tr></thead>
        <tbody>{p.lines.map((l) => (
          <tr key={l.id} data-testid="wp-line" data-code={l.activity}>
            <td>{l.activity} {l.activityName}</td><td>{l.crew ?? '—'}</td><td className="num">{fmtN(l.committedQty)}</td>
            <td className="num">{rec ? <input type="number" min="0" step="0.001" aria-label={t('wp.completed')} value={rec[l.id].qty} onChange={(e) => setRec({ ...rec, [l.id]: { ...rec[l.id], qty: e.target.value } })} data-testid="wp-rec-qty" /> : fmtN(l.completedQty)}</td><td>{l.uom ?? ''}</td>
            <td>{rec ? (num(rec[l.id].qty) >= l.committedQty ? <span>✓ {t('wp.done')}</span> : <select aria-label={t('wp.variance')} value={rec[l.id].code} onChange={(e) => setRec({ ...rec, [l.id]: { ...rec[l.id], code: e.target.value } })} data-testid="wp-rec-code"><option value="">{t('wp.whyNot')}</option>{VARIANCE_CODES.map((k) => <option key={k} value={k}>{t(`vc.${k}`)}</option>)}</select>) : l.completed ? <span>✓ {t('wp.done')}</span> : <span>{['APPROVED', 'CLOSED'].includes(p.status) ? `✗ ${l.varianceLabel ? t(`vc.${l.varianceCode}`) : t('wp.notDone')}` : '—'}</span>}</td>
            <td>{l.ready ? '✓' : <span data-testid="wp-notready">⚠ {l.openConstraints}</span>}</td>
          </tr>
        ))}</tbody></table></div>
      {rec && <div className="actions no-print"><button type="button" className="btn btn-primary" onClick={async () => { if (await run(() => pl.weeklyAct(p.id, 'record', { items: p.lines.map((l) => ({ itemId: l.id, completedQty: num(rec[l.id].qty), varianceCode: num(rec[l.id].qty) >= l.committedQty ? null : (rec[l.id].code || null) })) }), t('wp.recorded'))) setRec(null); }} data-testid="wp-rec-save">{t('wp.saveRecord')}</button><button type="button" className="btn" onClick={() => setRec(null)}>{t('act.cancel')}</button></div>}
      {done && p.variance.length > 0 && <p className="muted" data-testid="wp-variance">{t('wp.varianceLine')}: {p.variance.map((v) => `${t(`vc.${v.code}`)} ${v.n}`).join(' · ')}</p>}
      {dq.data && (
        <div className="table-scroll"><table className="data-table" data-testid="wp-daily"><caption>{t('wp.daily')}</caption>
          <thead><tr><th>{t('f.activity')}</th><th>{t('wp.crew')}</th>{dq.data.days.map((d) => <th key={d.date} className="num" title={d.working ? '' : t('wp.dayOff')}>{fmtDate(d.date).slice(0, 6)}{d.working ? '' : ' ·'}</th>)}<th className="num">{t('f.total')}</th></tr></thead>
          <tbody>{dq.data.lines.map((l) => <tr key={l.itemId}><td>{l.activity}</td><td>{l.crew ?? '—'}</td>{dq.data.days.map((d) => <td key={d.date} className="num">{l.byDay[d.date] ? fmtN(l.byDay[d.date]) : ''}</td>)}<td className="num">{fmtN(l.total)}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={2}>{t('f.total')}</th>{dq.data.days.map((d) => <td key={d.date} className="num">{d.total ? fmtN(d.total) : ''}</td>)}<td className="num">{fmtN(dq.data.lines.reduce((n, l) => n + l.total, 0))}</td></tr></tfoot></table></div>
      )}
      {hq.data && (hq.data.approvals.length > 0 || hq.data.audit.length > 0) && (
        <div className="table-scroll"><table className="data-table" data-testid="wp-history"><caption>{t('bl.history')}</caption><thead><tr><th>{t('bl.when')}</th><th>{t('bl.who')}</th><th>{t('bl.what')}</th><th>{t('bl.note')}</th></tr></thead>
          <tbody>{[...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, note: a.reason })), ...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, note: a.comment }))].sort((x, y) => String(x.at).localeCompare(String(y.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.note ?? ''}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

/** PPC by week as bars with the figure on each (one series), and the reasons for what was not done in order of size with the running share. */
function Report({ t, initialProject }) {
  const [projectId, setProjectId] = useState(initialProject); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [failed, setFailed] = useState(false);
  const pq = useQuery({ queryKey: ['plan', 'projects'], queryFn: pl.projects, retry: false });
  const qs = new URLSearchParams({ projectId: String(projectId ?? ''), ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const rq = useQuery({ queryKey: ['plan', 'ppc', qs], queryFn: () => pl.ppc(qs), enabled: Boolean(projectId), retry: false });
  const r = rq.data; const W = 560; const H = 180; const left = 36; const bw = r ? Math.max(8, Math.min(40, (W - left) / Math.max(1, r.weeks.length) - 6)) : 0; const step = r ? (W - left) / Math.max(1, r.weeks.length) : 0; const y = (v) => H - 24 - ((H - 40) * v) / 100;
  return (
    <div data-testid="ppc-report">
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('pr.params')}>
        <div className="form-grid">
          <Field label={t('f.project')} name="projectId"><select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : null)} data-testid="ppc-project"><option value="">{t('f.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
          <Field label={t('h.from')} name="from"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="ppc-from" /></Field>
          <Field label={t('h.to')} name="to"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} data-testid="ppc-to" /></Field>
        </div>
        {r?.can.export && <div className="actions">{['xlsx', 'pdf', 'csv'].map((f) => <button key={f} type="button" className="btn" onClick={() => { setFailed(false); download(`/ppc/export?${qs}&format=${f}`, `ppc-${r.projectCode}.${f}`).catch(() => setFailed(true)); }} data-testid={`ppc-export-${f}`}>{t('var.export', { f: f.toUpperCase() })}</button>)}</div>}
        {failed && <p className="field-error" role="alert">{t('bl.fileFailed')}</p>}
      </form>
      {!projectId && <p className="muted" data-testid="ppc-choose">{t('wp.chooseProject')}</p>}
      {rq.isPending && projectId && <Skeleton label={t('wp.report')} rows={4} />}
      {rq.isError && <ErrorState error={rq.error} onRetry={rq.refetch} />}
      {r && (
        <>
          <dl className="kv" data-testid="ppc-summary"><div><dt>{t('wp.weeksClosed')}</dt><dd>{r.totals.weeks}</dd></div><div><dt>{t('wp.commitments')}</dt><dd>{r.totals.items}</dd></div><div><dt>{t('wp.completedCount')}</dt><dd>{r.totals.completed}</dd></div><div><dt>{t('wp.ppc')}</dt><dd data-testid="ppc-total">{r.totals.ppc != null ? `${r.totals.ppc} %` : '—'}</dd></div><div><dt>{t('wp.lastWeek')}</dt><dd>{r.totals.last != null ? `${r.totals.last} %` : '—'}</dd></div></dl>
          {r.weeks.length === 0 ? <p className="muted" data-testid="ppc-none">{t('wp.noWeeks')}</p> : (
            <>
              <h2>{t('wp.trend')}</h2>
              <div className="table-scroll"><svg width={Math.max(W, left + r.weeks.length * 46)} height={H} role="img" aria-label={t('wp.trendLabel')} data-testid="ppc-chart">
                {[0, 50, 100].map((v) => <g key={v}><line x1={left} x2={W} y1={y(v)} y2={y(v)} stroke="var(--erp-color-border-subtle)" /><text x={left - 4} y={y(v) + 4} fontSize="10" textAnchor="end" fill="var(--erp-color-text-muted)">{v}</text></g>)}
                {r.weeks.map((w, i) => { const x = left + i * step + (step - bw) / 2; return (
                  <g key={w.weekStart} data-testid="ppc-bar"><title>{`${fmtDate(w.weekStart)}: ${w.ppc ?? '—'} % (${w.completed}/${w.items})`}</title>
                    <rect x={x} y={y(w.ppc ?? 0)} width={bw} height={H - 24 - y(w.ppc ?? 0)} rx="3" fill="var(--erp-chart-1)" />
                    <text x={x + bw / 2} y={y(w.ppc ?? 0) - 4} fontSize="10" textAnchor="middle" fill="var(--erp-color-text-primary)">{w.ppc ?? ''}</text>
                    <text x={x + bw / 2} y={H - 8} fontSize="9" textAnchor="middle" fill="var(--erp-color-text-muted)">{w.weekStart.slice(5)}</text></g>
                ); })}
              </svg></div>
              <div className="table-scroll"><table className="data-table" data-testid="ppc-table"><caption>{t('wp.trend')}</caption><thead><tr><th>{t('wp.weekFrom')}</th><th className="num">{t('wp.plans')}</th><th className="num">{t('wp.commitments')}</th><th className="num">{t('wp.completedCount')}</th><th className="num">{t('wp.ppc')} %</th><th className="num">{t('wp.cumulative')} %</th></tr></thead>
                <tbody>{r.weeks.map((w) => <tr key={w.weekStart} data-testid="ppc-row"><td>{fmtDate(w.weekStart)}</td><td className="num">{w.plans}</td><td className="num">{w.items}</td><td className="num">{w.completed}</td><td className="num">{w.ppc ?? '—'}</td><td className="num">{w.cumulativePpc ?? '—'}</td></tr>)}</tbody>
                <tfoot><tr><th>{t('f.total')}</th><td className="num">{r.totals.plans}</td><td className="num">{r.totals.items}</td><td className="num">{r.totals.completed}</td><td className="num">{r.totals.ppc ?? '—'}</td><td /></tr></tfoot></table></div>
              <h2>{t('wp.reasons')}</h2>
              {r.variance.length === 0 ? <p className="muted">{t('wp.noReasons')}</p> : (
                <div className="table-scroll"><table className="data-table" data-testid="ppc-reasons"><caption>{t('wp.reasons')}</caption><thead><tr><th>{t('wp.variance')}</th><th className="num">{t('wp.notCompleted')}</th><th className="num">{t('wp.share')} %</th><th className="num">{t('wp.cumulative')} %</th><th><span className="sr-only">{t('wp.share')}</span></th></tr></thead>
                  <tbody>{r.variance.map((v) => <tr key={v.code} data-testid="ppc-reason"><td>{t(`vc.${v.code}`)}</td><td className="num">{v.n}</td><td className="num">{v.pct}</td><td className="num">{v.cumulativePct}</td><td style={{ width: 160 }}><svg width="150" height="10" aria-hidden="true"><rect width={Math.max(2, 1.5 * v.pct)} height="10" rx="3" fill="var(--erp-chart-1)" /></svg></td></tr>)}</tbody></table></div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function WeeklyPage() {
  const t = useT('plan');
  usePageTitle(t('wp.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const [adding, setAdding] = useState(Boolean(sp.get('add'))); const [tab, setTab] = useState(sp.get('tab') === 'report' ? 'report' : 'plans');
  if (id) return <section aria-labelledby="wp-h" data-testid="plan-weekly"><Plan key={id} t={t} id={id} onGone={() => navigateTo('/plan/weekly')} /></section>;
  const initial = { scheduleId: Number(sp.get('scheduleId')) || null, week: sp.get('week'), siteId: sp.get('siteId') ?? '', add: (sp.get('add') ?? '').split(',').map(Number).filter(Boolean) };
  return (
    <section aria-labelledby="wp-h" data-testid="plan-weekly">
      <PageHeader id="wp-h" srOnly title={t('wp.title')} />
      <div className="actions-row no-print">
        <div role="tablist" aria-label={t('wp.title')} style={{ display: 'contents' }}>{['plans', 'report'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'btn btn-primary' : 'btn'} onClick={() => setTab(k)} data-testid={`wp-tab-${k}`}>{t(k === 'plans' ? 'wp.title' : 'wp.report')}</button>)}</div>
        {tab === 'plans' && perms.includes('plan.weekly_plan.create') && <button type="button" className="btn" onClick={() => setAdding(!adding)} data-testid="wp-new">{t('wp.new')}</button>}
        <Link to="/plan/lookahead">{t('la.title')}</Link>
      </div>
      {tab === 'plans' && adding && <NewPlan t={t} initial={initial} onDone={(p) => { qc.invalidateQueries({ queryKey: ['plan'] }); navigateTo(`/plan/weekly?id=${p.id}`); }} />}
      {tab === 'plans' && <ListReport listCode="plan.weekly_plans" endpoint="/plan/weekly-plans" title={t('wp.title')} session={session.data} rowHref={(r) => `/plan/weekly?id=${r.id}`} onOpen={(r) => navigateTo(`/plan/weekly?id=${r.id}`)}
        cardFields={[{ key: 'project', label: t('f.project') }, { key: 'weekStart', label: t('wp.weekFrom') }, { key: 'status', label: t('f.status') }, { key: 'ppc', label: t('wp.ppc') }]} statusKey="status" empty={{ title: t('wp.emptyTitle'), text: t('wp.emptyBody') }} />}
      {tab === 'report' && <Report t={t} initialProject={Number(sp.get('projectId')) || null} />}
    </section>
  );
}
