import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { DP_TONE, WA_TONE, fmtDate, fmtQty, st, today } from './api.js';
import { SiteDay, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Daily Work Plan builder (part 14.01, FR-02): the plan of a site and a supervisor for a day, started from the approved weekly plans (13.04), copied from the day before or empty; a line grid
// of activity, front, crew and quantity checked by the server; issued, each line becomes a work authorisation in draft with the time window given.
const tomorrow = () => new Date(Date.now() + 5.5 * 3600_000 + 86_400_000).toISOString().slice(0, 10);

function Plan({ t, id }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['site', 'daily', id], queryFn: () => st.daily(id), retry: false });
  const oq = useQuery({ queryKey: ['site', 'options', q.data?.siteId, q.data?.planDate], queryFn: () => st.options(q.data.siteId, q.data.planDate), enabled: Boolean(q.data?.can.edit), retry: false });
  const [lines, setLines] = useState(null); const [win, setWin] = useState({ startTime: '08:00', endTime: '17:00' }); const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  usePageTitle(q.data ? `${q.data.docNo} · ${t('dp.title')}` : t('dp.title'));
  if (q.error?.status === 403) return <NoPermission what={t('dp.title')} permission="site.daily_plan.view" />;
  if (q.isPending) return <Skeleton label={t('dp.title')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const p = q.data; const o = oq.data; const rows = lines ?? p.lines.map((l) => ({ activityId: String(l.activityId), workFrontId: l.workFrontId ? String(l.workFrontId) : '', crewId: l.crewId ? String(l.crewId) : '', plannedQty: String(l.plannedQty) }));
  const set = (i, k, v) => setLines(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); setLines(null); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['site'] }); return x; } catch (e) { setError(errorInfo(e)); return null; } finally { setBusy(false); } };
  const body = () => rows.filter((r) => r.activityId && r.plannedQty).map((r) => ({ activityId: Number(r.activityId), workFrontId: r.workFrontId ? Number(r.workFrontId) : null, crewId: r.crewId ? Number(r.crewId) : null, plannedQty: Number(r.plannedQty) }));
  const total = rows.reduce((s, r) => s + (Number(r.plannedQty) || 0), 0);
  return (
    <div data-testid="dp-object" data-status={p.status}>
      <PageHeader id="dp-h" title={<>{p.docNo} · {fmtDate(p.planDate)} <StatusBadge status={DP_TONE[p.status]} label={t(`dps.${p.status}`)} /></>} meta={<><Link to="/site/daily-plans">{t('dp.back')}</Link> · <Link to={`/site/board?siteId=${p.siteId}&date=${p.planDate}`}>{t('bd.title')}</Link></>} />
      <dl className="kv"><div><dt>{t('f.site')}</dt><dd>{p.projectCode} · {p.siteCode} {p.siteName}</dd></div><div><dt>{t('wa.supervisor')}</dt><dd>{p.supervisor}</dd></div><div><dt>{t('dp.lines')}</dt><dd data-testid="dp-count">{p.lines.length}</dd></div>{p.issuedAt && <div><dt>{t('dp.issued')}</dt><dd>{p.issuedBy} · {String(p.issuedAt).slice(0, 16).replace('T', ' ')}</dd></div>}</dl>
      {error?.form && <p className="field-error" role="alert" data-testid="dp-error">{error.form}{error.fields ? ` ${Object.entries(error.fields).slice(0, 4).map(([k, v]) => `${k.replace(/^lines\.(\d+)\..*/, (_, n) => t('dp.line', { n: Number(n) + 1 }))}: ${v}`).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="dp-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="dp-grid"><caption>{t('dp.grid')}</caption>
        <thead><tr><th>#</th><th>{t('wa.activity')}</th><th>{t('wa.front')}</th><th>{t('wa.crew')}</th><th className="num">{t('wa.qtyShort')}</th><th>{p.can.edit ? <span className="sr-only">{t('act.actions')}</span> : t('dp.wa')}</th></tr></thead>
        <tbody>{p.can.edit && o ? rows.map((r, i) => (
          <tr key={i} data-testid="dp-line">
            <td>{i + 1}</td>
            <td><select aria-label={t('wa.activity')} value={r.activityId} onChange={(e) => set(i, 'activityId', e.target.value)} data-testid="dp-activity"><option value="">{t('f.choose')}</option>{o.activities.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}{a.remaining != null ? ` (${fmtQty(a.remaining)} ${a.uom ?? ''})` : ''}</option>)}</select></td>
            <td><select aria-label={t('wa.front')} value={r.workFrontId} onChange={(e) => set(i, 'workFrontId', e.target.value)}><option value="">{t('wa.frontAuto')}</option>{o.fronts.map((f) => <option key={f.id} value={f.id}>{f.code} {f.name}</option>)}</select></td>
            <td><select aria-label={t('wa.crew')} value={r.crewId} onChange={(e) => set(i, 'crewId', e.target.value)} data-testid="dp-crew"><option value="">—</option>{o.crews.map((c) => <option key={c.id} value={c.id}>{c.code} {c.trade}</option>)}</select></td>
            <td className="num"><input aria-label={t('wa.qtyShort')} type="number" min="0.001" step="0.001" value={r.plannedQty} onChange={(e) => set(i, 'plannedQty', e.target.value)} style={{ width: 100 }} data-testid="dp-qty" /></td>
            <td><button type="button" className="btn" onClick={() => setLines(rows.filter((_, j) => j !== i))} aria-label={t('dp.removeLine', { n: i + 1 })}>{t('act.remove')}</button></td>
          </tr>
        )) : p.lines.map((l, i) => <tr key={l.id} data-testid="dp-line"><td>{i + 1}</td><td>{l.activity}</td><td>{l.workFront ?? '—'}</td><td>{l.crew ?? '—'}</td><td className="num">{fmtQty(l.plannedQty)} {l.uom ?? ''}</td><td>{l.waId ? <><Link to={`/site/work-authorisations?id=${l.waId}`}>{l.waNo}</Link> <StatusBadge status={WA_TONE[l.waStatus]} label={t(`wst.${l.waStatus}`)} /></> : '—'}</td></tr>)}</tbody>
        {p.can.edit && <tfoot><tr><th colSpan={4}>{t('f.total')}</th><td className="num" data-testid="dp-total">{fmtQty(total)}</td><td /></tr></tfoot>}
      </table></div>
      {p.lines.length === 0 && !p.can.edit && <p className="muted">{t('dp.noLines')}</p>}
      {p.can.edit && (
        <div className="actions-row no-print">
          <button type="button" className="btn" onClick={() => setLines([...rows, { activityId: '', workFrontId: '', crewId: '', plannedQty: '' }])} data-testid="dp-add">{t('dp.addLine')}</button>
          <button type="button" className="btn" disabled={busy || lines == null} onClick={() => run(() => st.updateDaily(p.id, { lines: body(), rowVersion: p.rowVersion }), t('act.saved'))} data-testid="dp-save">{t('act.save')}</button>
          <button type="button" className="btn" onClick={() => { const x = window.prompt(t('act.why')); if (x) run(() => st.dailyAct(p.id, 'cancel', { reason: x })); }} data-testid="dp-cancel">{t('act.cancel')}</button>
        </div>
      )}
      {p.can.issue && (
        <form className="mdm-panel no-print" onSubmit={(e) => { e.preventDefault(); if (lines != null) { setError({ form: t('dp.saveFirst') }); return; } if (window.confirm(t('dp.issueAsk', { n: p.lines.length }))) run(() => st.dailyAct(p.id, 'issue', win), t('dp.issuedNote')); }} aria-label={t('dp.issue')}>
          <h2>{t('dp.issue')}</h2><p className="muted">{t('dp.issueHelp')}</p>
          <div className="form-grid"><Field label={t('wa.start')} name="startTime"><input type="time" value={win.startTime} onChange={(e) => setWin({ ...win, startTime: e.target.value })} required /></Field><Field label={t('wa.end')} name="endTime"><input type="time" value={win.endTime} onChange={(e) => setWin({ ...win, endTime: e.target.value })} required /></Field></div>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || p.lines.length === 0} data-testid="dp-issue">{t('dp.issue')}</button></div>
        </form>
      )}
    </div>
  );
}

export default function DailyPage() {
  const t = useT('site'); usePageTitle(t('dp.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const qc = useQueryClient(); const session = useSession(); const perms = session.data?.permissions ?? [];
  const [siteId, setSiteId] = useState(Number(sp.get('siteId')) || null); const [date, setDate] = useState(sp.get('date') ?? tomorrow()); const [from, setFrom] = useState('WEEKLY'); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const onSite = useCallback((v) => setSiteId(v), []);
  if (id) return <section aria-labelledby="dp-h" data-testid="site-daily"><Plan key={id} t={t} id={id} /></section>;
  return (
    <section aria-labelledby="dp-h" data-testid="site-daily">
      <PageHeader id="dp-h" title={t('dp.title')} />
      {perms.includes('site.daily_plan.manage') && (
        <form className="mdm-panel no-print" onSubmit={async (e) => { e.preventDefault(); setError(null); setBusy(true); try { const p = await st.createDaily({ siteId, planDate: date, from }); qc.invalidateQueries({ queryKey: ['site'] }); navigateTo(`/site/daily-plans?id=${p.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } }} aria-label={t('dp.new')} data-testid="dp-new-form">
          <h2>{t('dp.new')}</h2>
          <SiteDay siteId={siteId} date={date} onSite={onSite} onDate={setDate} testId="dp" />
          <fieldset><legend>{t('dp.from')}</legend>{['WEEKLY', 'YESTERDAY', 'EMPTY'].map((k) => <label key={k} className="check" style={{ marginRight: 16 }}><input type="radio" name="from" value={k} checked={from === k} onChange={() => setFrom(k)} data-testid={`dp-from-${k}`} /> {t(`dp.from.${k}`)}</label>)}</fieldset>
          {error?.form && <p className="field-error" role="alert" data-testid="dp-new-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !siteId} data-testid="dp-create">{t('dp.create')}</button></div>
        </form>
      )}
      <ListReport listCode="site.daily_plans" endpoint="/site/daily-plans" title={t('dp.list')} session={session.data} rowHref={(r) => `/site/daily-plans?id=${r.id}`} onOpen={(r) => navigateTo(`/site/daily-plans?id=${r.id}`)}
        cardFields={['docNo', 'planDate', 'site', 'supervisor']} statusKey="status"
        empty={{ title: t('dp.emptyTitle'), text: t('dp.emptyBody') }} />
      <p className="muted"><Link to="/site/board">{t('bd.title')}</Link> · <Link to="/plan/weekly">{t('dp.weekly')}</Link> · {fmtDate(today())}</p>
    </section>
  );
}
