import { Fragment, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { DiscussionTab } from '../../platform/collab/CollabTabs.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { DEPS, STATUS_TONE, TYPES, fmtDate, openPrint, pl } from './api.js';
import { SchedulePicker, useSearch } from './parts.jsx';

// Activities (part 13.01, FR-02, FR-04, FR-06, FR-07): the activities of a schedule grouped by WBS node, with the dates, floats and critical flag the server's CPM pass worked out (BR-01); filters for critical, delayed (negative float)
// and open work; a selection edited in bulk; links with their type and lag (a loop is refused with its path, BR-02); progress at a data date; and the approval of the schedule.
const FILTERS = ['all', 'critical', 'delayed', 'open'];
function LinkEditor({ s, a, all, t, run }) {
  const [f, setF] = useState({ predId: '', type: 'FS', lag: '0' });
  return (
    <div className="mdm-panel" data-testid="pa-links">
      <p><strong>{a.code}</strong> · {t('act.preds')}: {a.predecessors.length === 0 ? '—' : a.predecessors.map((p) => <span key={p.id} className="chip" data-testid="pa-pred">{p.code} {p.type}{p.lag ? (p.lag > 0 ? `+${p.lag}` : p.lag) : ''}{s.can.edit && <button type="button" className="btn btn-link" onClick={() => run(() => pl.unlink(p.id))} aria-label={`${t('act.unlink')} ${p.code}`} data-testid="pa-unlink">×</button>}</span>)}</p>
      <p className="muted">{t('act.succs')}: {a.successors.map((x) => `${x.code} ${x.type}${x.lag ? (x.lag > 0 ? `+${x.lag}` : x.lag) : ''}`).join(', ') || '—'}</p>
      {s.can.edit && (
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); run(() => pl.link(s.id, { predId: Number(f.predId), succId: a.id, type: f.type, lag: Number(f.lag || 0) })); }} aria-label={t('act.addPred')}>
          <Field label={t('act.pred')} name="predId"><select value={f.predId} onChange={(e) => setF({ ...f, predId: e.target.value })} required data-testid="pa-pred-pick"><option value="">—</option>{all.filter((x) => x.id !== a.id).map((x) => <option key={x.id} value={x.id}>{x.code} {x.name}</option>)}</select></Field>
          <Field label={t('act.linkType')} name="type"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} data-testid="pa-pred-type">{DEPS.map((d) => <option key={d} value={d}>{t(`dep.${d}`)}</option>)}</select></Field>
          <Field label={t('act.lag')} name="lag"><input type="number" step="1" value={f.lag} onChange={(e) => setF({ ...f, lag: e.target.value })} data-testid="pa-pred-lag" /></Field>
          <div className="actions"><button type="submit" className="btn" disabled={!f.predId} data-testid="pa-pred-add">{t('act.addPred')}</button></div>
        </form>
      )}
    </div>
  );
}
export default function ActivitiesPage() {
  const t = useT('plan');
  const qc = useQueryClient(); const sp = useSearch();
  const [projectId, setProjectId] = useState(null); const [scheduleId, setScheduleId] = useState(Number(sp.get('scheduleId')) || null);
  const [filter, setFilter] = useState(FILTERS.includes(sp.get('filter')) ? sp.get('filter') : 'all'); const [wbsId, setWbsId] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(100);
  const [sel, setSel] = useState([]); const [bulk, setBulk] = useState(null); const [open, setOpen] = useState(null); const [adding, setAdding] = useState(null); const [prog, setProg] = useState(null); const [talk, setTalk] = useState(false);
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const sq = useQuery({ queryKey: ['plan', 'schedule', scheduleId], queryFn: () => pl.schedule(scheduleId), enabled: Boolean(scheduleId), retry: false });
  const pid = projectId ?? sq.data?.projectId ?? null;
  const oq = useQuery({ queryKey: ['plan', 'options', pid], queryFn: () => pl.options(pid), enabled: Boolean(pid), retry: false });
  const qs = new URLSearchParams({ filter, page: String(page), pageSize: String(pageSize), ...(wbsId ? { wbsId } : {}), ...(q.trim() ? { q: q.trim() } : {}) }).toString();
  const aq = useQuery({ queryKey: ['plan', 'activities', scheduleId, qs], queryFn: () => pl.activities(scheduleId, qs), enabled: Boolean(scheduleId) && sq.isSuccess, retry: false, placeholderData: (x) => x });
  const all = useQuery({ queryKey: ['plan', 'activities-all', scheduleId], queryFn: () => pl.activities(scheduleId, 'pageSize=1000'), enabled: Boolean(scheduleId) && sq.isSuccess && Boolean(open || prog), retry: false });
  usePageTitle(sq.data ? `${sq.data.docNo} · ${t('act.title')}` : t('act.title'));
  const run = async (fn, done) => { setError(null); setNote(null); try { const x = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['plan'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } };
  const why = (fn, done) => { const x = window.prompt(t('act.why')); if (x) run(() => fn(x), done); };
  if (sq.error?.status === 403 || aq.error?.status === 403) return <NoPermission what={t('act.title')} permission="plan.schedule.view" />;
  const s = sq.data; const d = aq.data; const can = s?.can ?? {};
  const toggle = (id) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <section aria-labelledby="pa-h" data-testid="plan-activities" data-status={s?.status}>
      <h1 id="pa-h">{s ? `${s.docNo} · ${s.name}` : t('act.title')} {s && <StatusBadge status={STATUS_TONE[s.status]} label={t(`st.${s.status}`)} />}</h1>
      <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('f.schedule')}>
        <SchedulePicker projectId={pid} scheduleId={scheduleId} onProject={(v) => { setProjectId(v); setScheduleId(null); setSel([]); }} onSchedule={(v) => { setScheduleId(v); setSel([]); setPage(1); }} testId="pa" />
      </form>
      {!scheduleId && <p className="muted" data-testid="pa-choose">{t('act.choose')} <Link to="/plan/schedules">{t('sch.title')}</Link></p>}
      {scheduleId && sq.isPending && <Skeleton label={t('act.title')} rows={5} />}
      {sq.isError && sq.error?.status !== 403 && <ErrorState error={sq.error} onRetry={sq.refetch} />}
      {s && (
        <>
          <dl className="kv" data-testid="pa-figures">
            <div><dt>{t('f.version')}</dt><dd>{s.versionNo}</dd></div><div><dt>{t('f.start')}</dt><dd>{fmtDate(s.startDate)}</dd></div><div><dt>{t('f.finish')}</dt><dd data-testid="pa-finish">{fmtDate(s.finishDate)}</dd></div>
            <div><dt>{t('f.dataDate')}</dt><dd data-testid="pa-datadate">{fmtDate(s.dataDate)}</dd></div><div><dt>{t('f.activities')}</dt><dd>{s.activities}</dd></div><div><dt>{t('f.critical')}</dt><dd data-testid="pa-critical">{s.critical}</dd></div>
            <div><dt>{t('f.calendar')}</dt><dd>{s.calendar}</dd></div>
          </dl>
          {s.needsCalc && s.activities > 0 && <p className="mdm-banner" role="status" data-testid="pa-needscalc">{t('act.needsCalc')}</p>}
          {s.status === 'APPROVED' && <p className="muted" data-testid="pa-locked">{t('act.locked')}</p>}
          {error?.form && <p className="field-error" role="alert" data-testid="pa-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 3).join('; ')}` : ''}</p>}
          {note && <p className="mdm-banner" role="status" data-testid="pa-note">{note}</p>}
          <div className="actions-row no-print">
            {can.calculate && <button type="button" className="btn btn-primary" onClick={() => run(() => pl.calculate(s.id), t('act.calculated'))} data-testid="pa-calc">{t('act.calculate')}</button>}
            {can.edit && <button type="button" className="btn" onClick={() => setAdding(adding ? null : { name: '', type: 'TASK', duration: '1', wbsId: '' })} data-testid="pa-add">{t('act.add')}</button>}
            {can.edit && <button type="button" className="btn" onClick={() => navigateTo(`/plan/generate?scheduleId=${s.id}`)} data-testid="pa-generate">{t('gen.title')}</button>}
            {can.progress && <button type="button" className="btn" onClick={() => setProg(prog ? null : { dataDate: s.dataDate ?? '', rows: {} })} data-testid="pa-progress">{t('prog.title')}</button>}
            {can.submit && <button type="button" className="btn" onClick={() => run(() => pl.act(s.id, 'submit'), t('act.sent'))} data-testid="pa-submit">{t('act.submit')}</button>}
            {can.withdraw && <button type="button" className="btn" onClick={() => why((x) => pl.act(s.id, 'withdraw', { reason: x }))} data-testid="pa-withdraw">{t('act.withdraw')}</button>}
            {can.cancel && <button type="button" className="btn" onClick={() => why((x) => pl.act(s.id, 'cancel', { reason: x }))} data-testid="pa-cancel">{t('act.cancel')}</button>}
            {can.amend && <button type="button" className="btn" onClick={async () => { const x = window.prompt(t('act.why')); if (x) { const n = await run(() => pl.act(s.id, 'amend', { reason: x })); if (n) { setScheduleId(n.id); window.history.replaceState(null, '', `/plan/activities?scheduleId=${n.id}`); } } }} data-testid="pa-amend">{t('act.newVersion')}</button>}
            <button type="button" className="btn" onClick={() => navigateTo(`/plan/critical?scheduleId=${s.id}`)} data-testid="pa-report">{t('crit.title')}</button>
            {can.print && <button type="button" className="btn" onClick={() => openPrint(`/schedules/${s.id}/print`).catch(() => null)} data-testid="pa-print">{t('act.print')}</button>}
            <button type="button" className="btn" onClick={() => setTalk(!talk)} aria-expanded={talk} data-testid="pa-discuss">{t('act.discussion')}</button>
            {s.workflowInstanceId && <Link to={`/workflow/instance?id=${s.workflowInstanceId}`}>{t('act.approval')}</Link>}
          </div>
          {talk && <div className="mdm-panel" data-testid="pa-discussion"><DiscussionTab entity="plan_schedule" id={s.id} /></div>}
          {adding && (
            <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); if (await run(() => pl.addActivity(s.id, { name: adding.name.trim(), type: adding.type, duration: adding.type === 'MILESTONE' ? 0 : Number(adding.duration || 0), wbsId: adding.wbsId ? Number(adding.wbsId) : null }), t('act.added'))) setAdding(null); }} data-testid="pa-add-form" aria-label={t('act.add')}>
              <div className="form-grid">
                <Field label={t('f.name')} name="name"><input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} required minLength={2} maxLength={200} data-testid="pa-add-name" /></Field>
                <Field label={t('f.type')} name="type"><select value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })} data-testid="pa-add-type">{TYPES.map((x) => <option key={x} value={x}>{t(`type.${x}`)}</option>)}</select></Field>
                <Field label={t('f.duration')} name="duration"><input type="number" min="0" step="1" value={adding.type === 'MILESTONE' ? '0' : adding.duration} disabled={adding.type === 'MILESTONE'} onChange={(e) => setAdding({ ...adding, duration: e.target.value })} data-testid="pa-add-duration" /></Field>
                <Field label={t('f.wbs')} name="wbsId"><select value={adding.wbsId} onChange={(e) => setAdding({ ...adding, wbsId: e.target.value })} data-testid="pa-add-wbs"><option value="">—</option>{(oq.data?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>
              </div>
              <div className="actions"><button type="submit" className="btn btn-primary" data-testid="pa-add-save">{t('act.save')}</button></div>
            </form>
          )}
          {prog && (
            <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); const rows = Object.entries(prog.rows).map(([id, r]) => ({ activityId: Number(id), ...(r.actualStart !== undefined ? { actualStart: r.actualStart || null } : {}), ...(r.actualFinish !== undefined ? { actualFinish: r.actualFinish || null } : {}), ...(r.pct !== undefined && r.pct !== '' ? { pctComplete: Number(r.pct) } : {}), ...(r.rem !== undefined && r.rem !== '' ? { remainingDays: Number(r.rem) } : {}) })); if (await run(() => pl.progress(s.id, { dataDate: prog.dataDate, rows }), t('prog.done'))) setProg(null); }} data-testid="pa-prog-form" aria-label={t('prog.title')}>
              <h2>{t('prog.title')}</h2>
              <Field label={t('f.dataDate')} name="dataDate"><input type="date" value={prog.dataDate} onChange={(e) => setProg({ ...prog, dataDate: e.target.value })} required data-testid="pa-prog-date" /></Field>
              <div className="table-scroll"><table className="data-table" data-testid="pa-prog-table"><caption className="sr-only">{t('prog.title')}</caption><thead><tr><th>{t('f.activity')}</th><th>{t('prog.actualStart')}</th><th>{t('prog.actualFinish')}</th><th className="num">{t('prog.pct')}</th><th className="num">{t('prog.remaining')}</th></tr></thead>
                <tbody>{(all.data?.rows ?? []).filter((a) => ['TASK', 'MILESTONE'].includes(a.type) && !a.actualFinish).slice(0, 200).map((a) => { const r = prog.rows[a.id] ?? {}; const set = (k, v) => setProg({ ...prog, rows: { ...prog.rows, [a.id]: { ...r, [k]: v } } }); return (
                  <tr key={a.id} data-testid="pa-prog-row"><td>{a.code} {a.name}</td><td><input type="date" value={r.actualStart ?? a.actualStart ?? ''} onChange={(e) => set('actualStart', e.target.value)} aria-label={`${t('prog.actualStart')} ${a.code}`} data-testid="pa-prog-start" /></td><td><input type="date" value={r.actualFinish ?? ''} onChange={(e) => set('actualFinish', e.target.value)} aria-label={`${t('prog.actualFinish')} ${a.code}`} data-testid="pa-prog-finish" /></td>
                    <td className="num"><input type="number" min="0" max="100" step="0.01" value={r.pct ?? (a.actualStart ? a.pctComplete : '')} onChange={(e) => set('pct', e.target.value)} aria-label={`${t('prog.pct')} ${a.code}`} style={{ maxWidth: '5rem' }} data-testid="pa-prog-pct" /></td><td className="num"><input type="number" min="0" step="1" value={r.rem ?? ''} placeholder={a.remainingDays ?? ''} onChange={(e) => set('rem', e.target.value)} aria-label={`${t('prog.remaining')} ${a.code}`} style={{ maxWidth: '5rem' }} data-testid="pa-prog-rem" /></td></tr>); })}</tbody></table></div>
              <p className="muted">{t('prog.help')}</p>
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={!prog.dataDate} data-testid="pa-prog-save">{t('prog.save')}</button></div>
            </form>
          )}
          <form className="mdm-panel no-print" onSubmit={(e) => e.preventDefault()} aria-label={t('act.filters')}>
            <div className="form-grid">
              <Field label={t('act.show')} name="filter"><select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }} data-testid="pa-filter">{FILTERS.map((x) => <option key={x} value={x}>{t(`flt.${x}`)}{d?.counts && x !== 'all' ? ` (${d.counts[x] ?? 0})` : ''}</option>)}</select></Field>
              <Field label={t('f.wbs')} name="wbsId"><select value={wbsId} onChange={(e) => { setWbsId(e.target.value); setPage(1); }} data-testid="pa-wbs"><option value="">{t('act.allWbs')}</option>{(oq.data?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} {w.name}</option>)}</select></Field>
              <Field label={t('act.search')} name="q"><input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} data-testid="pa-q" /></Field>
              <Field label={t('act.perPage')} name="pageSize"><select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} data-testid="pa-pagesize">{[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
            </div>
          </form>
          {can.edit && sel.length > 0 && (
            <form className="mdm-panel" onSubmit={async (e) => { e.preventDefault(); const set = Object.fromEntries(Object.entries(bulk ?? {}).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, k === 'duration' || k === 'calendarId' ? Number(v) : v])); if (await run(() => pl.bulk(s.id, { ids: sel, set }), t('bulk.done', { n: sel.length }))) { setSel([]); setBulk(null); } }} data-testid="pa-bulk" aria-label={t('bulk.title')}>
              <h2>{t('bulk.title', { n: sel.length })}</h2>
              <div className="form-grid">
                <Field label={t('f.duration')} name="bduration"><input type="number" min="0" step="1" value={bulk?.duration ?? ''} onChange={(e) => setBulk({ ...bulk, duration: e.target.value })} data-testid="pa-bulk-duration" /></Field>
                <Field label={t('f.calendar')} name="bcalendar"><select value={bulk?.calendarId ?? ''} onChange={(e) => setBulk({ ...bulk, calendarId: e.target.value })} data-testid="pa-bulk-calendar"><option value="">—</option>{(oq.data?.calendars ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></Field>
                <Field label={t('f.responsible')} name="bresp"><input value={bulk?.responsible ?? ''} onChange={(e) => setBulk({ ...bulk, responsible: e.target.value })} maxLength={60} data-testid="pa-bulk-resp" /></Field>
              </div>
              <div className="actions"><button type="submit" className="btn btn-primary" disabled={!bulk || Object.values(bulk).every((v) => v === '')} data-testid="pa-bulk-apply">{t('bulk.apply')}</button><button type="button" className="btn" onClick={() => setSel([])}>{t('bulk.clear')}</button></div>
            </form>
          )}
          {aq.isPending ? <Skeleton label={t('act.title')} rows={6} /> : aq.isError ? <ErrorState error={aq.error} onRetry={aq.refetch} /> : d.rows.length === 0 ? (
            <div className="mdm-panel" data-testid="pa-empty"><p>{filter === 'all' && !q && !wbsId ? t('act.empty') : t('act.noneMatch')}</p>{can.edit && filter === 'all' && <button type="button" className="btn btn-primary" onClick={() => navigateTo(`/plan/generate?scheduleId=${s.id}`)}>{t('gen.title')}</button>}</div>
          ) : (
            <>
              <div className="table-scroll"><table className="data-table" data-testid="pa-grid"><caption className="sr-only">{t('act.title')}</caption>
                <thead><tr>{can.edit && <th><input type="checkbox" aria-label={t('bulk.all')} checked={d.rows.every((r) => sel.includes(r.id))} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...d.rows.map((r) => r.id)])] : sel.filter((x) => !d.rows.some((r) => r.id === x)))} data-testid="pa-select-all" /></th>}<th>{t('f.code')}</th><th>{t('f.activity')}</th><th className="num">{t('f.dur')}</th><th>{t('f.es')}</th><th>{t('f.ef')}</th><th>{t('f.ls')}</th><th>{t('f.lf')}</th><th className="num">{t('f.tf')}</th><th className="num">{t('f.ff')}</th><th className="num">%</th><th>{t('act.preds')}</th></tr></thead>
                <tbody>{d.rows.map((a, i) => (
                  <Fragment key={a.id}>
                    {(i === 0 || d.rows[i - 1].wbsCode !== a.wbsCode) && <tr className="group-row" data-testid="pa-group"><th colSpan={can.edit ? 12 : 11} scope="colgroup">{a.wbs ?? t('act.noWbs')}</th></tr>}
                    <tr data-testid="pa-row" data-code={a.code} data-critical={a.critical ? '1' : '0'}>
                      {can.edit && <td><input type="checkbox" checked={sel.includes(a.id)} onChange={() => toggle(a.id)} aria-label={`${t('bulk.pick')} ${a.code}`} data-testid="pa-select" /></td>}
                      <td><button type="button" className="btn btn-link" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id} data-testid="pa-open">{a.code}</button></td>
                      <td>{a.name}{a.type !== 'TASK' ? <span className="muted"> · {t(`type.${a.type}`)}</span> : null}{a.critical ? <span className="field-error"> · {t('f.critical')}</span> : null}</td>
                      <td className="num">{a.duration}</td><td>{fmtDate(a.es)}</td><td>{fmtDate(a.ef)}</td><td>{fmtDate(a.ls)}</td><td>{fmtDate(a.lf)}</td>
                      <td className={`num${a.totalFloat != null && a.totalFloat < 0 ? ' field-error' : ''}`}>{a.totalFloat ?? '—'}</td><td className="num">{a.freeFloat ?? '—'}</td><td className="num">{a.pctComplete}</td>
                      <td>{a.predecessors.map((p) => `${p.code}${p.type !== 'FS' ? p.type : ''}${p.lag ? (p.lag > 0 ? `+${p.lag}` : p.lag) : ''}`).join(', ')}</td>
                    </tr>
                    {open === a.id && <tr><td colSpan={can.edit ? 12 : 11}><LinkEditor s={s} a={a} all={all.data?.rows ?? d.rows} t={t} run={run} /></td></tr>}
                  </Fragment>))}</tbody></table></div>
              <div className="pager"><span data-testid="pa-total">{t('act.total', { n: d.total })}</span><button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('act.prev')}</button><button type="button" className="btn" disabled={page * pageSize >= d.total} onClick={() => setPage(page + 1)}>{t('act.next')}</button></div>
            </>
          )}
        </>
      )}
    </section>
  );
}
