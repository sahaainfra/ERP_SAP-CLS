import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card, CardGrid, Section } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from './api.js';

// Part 27.07: the monthly close status board (Board, UI v3 §3.6), the project monthly close (object page) with its checklist, the Project MIS and
// the Budget Master. On a desktop a card is dragged to the next column (start the close, send it for approval) and the server checks every move;
// on a phone one column is shown at a time (pill switcher) and a card moves through its menu. Every figure comes from GET /bi/monthly-closes.

const COLUMNS = ['NOT_STARTED', 'PREPARING', 'IN_APPROVAL', 'LOCKED'];
const STATE_STATUS = { PASS: 'APPROVED', OPEN: 'RETURNED', WAITING: 'SUBMITTED' };
const read = async (path) => (await api.get(path)).data;
const post = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };

function Board({ period }) {
  const t = useT('mc');
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['bi', 'mc-board', period], queryFn: () => read(`/bi/monthly-closes/board?period=${period}`), retry: false });
  const [column, setColumn] = useState('PREPARING');
  const [message, setMessage] = useState(null);
  const refresh = () => cache.invalidateQueries({ queryKey: ['bi', 'mc-board'] });
  const move = useMutation({
    mutationFn: async ({ card, to }) => {
      if (card.column === 'NOT_STARTED' && to === 'PREPARING') { const r = await post('/bi/monthly-closes', { projectId: card.projectId, period }); return { card, what: t('act.create'), undo: () => api.delete(`/bi/monthly-closes/${r.data.id}`) }; }
      if (card.column === 'PREPARING' && to === 'IN_APPROVAL') { await post(`/bi/monthly-closes/${card.closeId}/submit`, { rowVersion: card.rowVersion }); return { card, what: t('act.submit'), undo: () => post(`/bi/monthly-closes/${card.closeId}/withdraw`, { reason: 'Moved back on the board' }) }; }
      throw Object.assign(new Error(`${t(`col.${card.column}`)} → ${t(`col.${to}`)}`), { status: 422 });
    },
    onSuccess: (r) => { setMessage(r); return refresh(); },
  });
  const undo = useMutation({ mutationFn: () => message.undo(), onSuccess: () => { setMessage(null); return refresh(); } });
  if (q.error?.status === 403) return <NoPermission what={t('noPermission')} permission="bi.monthly_close.view" />;
  if (q.isPending) return <Skeleton label={t('title')} rows={5} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  if (!d.cards.length) return <EmptyState title={t('empty')} message={t('emptyBody')} />;
  const next = { NOT_STARTED: 'PREPARING', PREPARING: 'IN_APPROVAL' };
  const cardView = (c) => <li key={c.projectId} className="mdm-panel ui-card" draggable={Boolean(next[c.column])} data-testid="mc-card" data-project={c.code} data-column={c.column}
    onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.projectId))}>
    <strong>{c.project}</strong>
    <p className="muted small">{c.docNo ? `${c.docNo} · ${c.statusLabel}` : '—'}</p>
    <p className="small">{t('steps', { passed: c.passed, total: c.steps })}</p>
    <div className="actions-row" aria-hidden="true">{c.steps2.map((s) => <StatusBadge key={s.code} status={STATE_STATUS[s.state]} label={s.code.slice(0, 3)} variant="dot" size="sm" />)}</div>
    {c.blocking.length > 0 && c.column !== 'LOCKED' && <p className="small">{t('blocking', { list: c.blocking.join(', ') })}</p>}
    <div className="actions-row">
      {c.closeId && <Link to={`/bi/monthly-close?id=${c.closeId}`}>{t('act.open')}</Link>}
      {c.can.create && <button type="button" className="btn" onClick={() => move.mutate({ card: c, to: 'PREPARING' })} disabled={move.isPending}>{t('act.create')}</button>}
      {c.can.submit && <button type="button" className="btn btn-primary" onClick={() => move.mutate({ card: c, to: 'IN_APPROVAL' })} disabled={move.isPending || c.passed < c.steps}>{t('act.submit')}</button>}
    </div>
  </li>;
  const drop = (to) => (e) => { e.preventDefault(); const id = Number(e.dataTransfer.getData('text/plain')); const card = d.cards.find((c) => c.projectId === id); if (card && card.column !== to) move.mutate({ card, to }); };
  return <>
    <p className="muted">{t('legend')}</p>
    <div className="actions-row" aria-label={t('legend')}>{Object.entries(STATE_STATUS).map(([k, v]) => <StatusBadge key={k} status={v} label={t(`state.${k}`)} variant="dot" size="sm" />)}</div>
    {message && <p role="status" data-testid="mc-moved">{t('moved', { project: message.card.code, what: message.what })} <button type="button" className="btn" onClick={() => undo.mutate()} disabled={undo.isPending}>{t('act.undo')}</button></p>}
    {undo.isSuccess && <p role="status">{t('undone')}</p>}
    {(move.error || undo.error) && <ErrorState error={move.error ?? undo.error} />}
    <div role="tablist" aria-label={t('title')} className="tabs ui-phone-only" data-testid="mc-column-switcher">
      {d.columns.map((c) => <button key={c.key} type="button" role="tab" aria-selected={column === c.key} className={`btn${column === c.key ? ' btn-primary' : ''}`} onClick={() => setColumn(c.key)}>{t(`col.${c.key}`)} ({c.count})</button>)}
    </div>
    <CardGrid testid="mc-board" className="ui-board">
      {COLUMNS.map((key) => <Card key={key} title={`${t(`col.${key}`)} (${d.columns.find((c) => c.key === key).count})`} testid={`mc-col-${key}`} data-column={key}
        className={key === column ? 'ui-board-col is-current' : 'ui-board-col'} onDragOver={(e) => e.preventDefault()} onDrop={drop(key)}>
        <ul className="wd-todo">{d.cards.filter((c) => c.column === key).map(cardView)}</ul>
      </Card>)}
    </CardGrid>
  </>;
}

function Mis({ mis }) {
  const t = useT('mc');
  const { money, number } = useFormat();
  const inr = (v) => (v == null ? '—' : money(String(v)));
  const n = (v, d = 0) => (v == null ? '—' : number(String(v), { decimals: d }));
  const sec = (title, route, tiles) => <Card title={title} viewAll={route ?? undefined} viewAllLabel="›" testid={`mc-mis-${title}`}>{tiles}</Card>;
  return <CardGrid testid="mc-mis">
    {sec(t('mis.progress'), mis.progress?.route, mis.progress ? <KpiRow><KpiTile label={t('mis.physical')} kind="percent" value={`${n(mis.progress.physicalPct, 1)}%`} /><KpiTile label={t('mis.planned')} kind="percent" value={`${n(mis.progress.plannedPct, 1)}%`} /><KpiTile label={t('mis.spi')} kind="time" value={n(mis.progress.spi, 2)} /><KpiTile label={t('mis.cpi')} kind="money" value={n(mis.progress.cpi, 2)} /></KpiRow> : <EmptyState compact title={t('mis.none')} />)}
    {sec(t('mis.cost'), mis.cost?.route, <KpiRow><KpiTile label={t('mis.budget')} kind="money" amount={mis.cost.budget} value={inr(mis.cost.budget)} /><KpiTile label={t('mis.actual')} kind="money" amount={mis.cost.actual} value={inr(mis.cost.actual)} /><KpiTile label={t('mis.eac')} kind="money" amount={mis.cost.eac} value={inr(mis.cost.eac)} /><KpiTile label={t('mis.variance')} kind="money" amount={mis.cost.variance} value={inr(mis.cost.variance)} tone={mis.cost.variance < 0 ? 'error' : 'success'} /></KpiRow>)}
    {sec(t('mis.cvr'), mis.cvr?.route, mis.cvr ? <KpiRow><KpiTile label={t('mis.margin')} kind="money" amount={mis.cvr.margin} value={inr(mis.cvr.margin)} tone={mis.cvr.margin < 0 ? 'error' : 'success'} /><KpiTile label={t('mis.marginPct')} kind="percent" value={`${n(mis.cvr.marginPct, 2)}%`} /></KpiRow> : <EmptyState compact title={t('mis.none')} />)}
    {mis.billing && sec(t('mis.billing'), mis.billing.route, <KpiRow><KpiTile label={t('mis.billed')} kind="money" amount={mis.billing.billed} value={inr(mis.billing.billed)} /><KpiTile label={t('mis.collected')} kind="money" amount={mis.billing.collected} value={inr(mis.billing.collected)} /></KpiRow>)}
    {mis.cash && sec(t('mis.cash'), mis.cash.route, <KpiRow><KpiTile label={t('mis.payables')} kind="money" amount={mis.cash.payablesOpen} value={inr(mis.cash.payablesOpen)} /><KpiTile label={t('mis.receivables')} kind="money" amount={mis.cash.receivablesOpen ?? undefined} value={inr(mis.cash.receivablesOpen)} /></KpiRow>)}
    {mis.resources && sec(t('mis.resources'), mis.resources.route, <KpiRow><KpiTile label={t('mis.manDays')} kind="people" value={n(mis.resources.manDays, 1)} /><KpiTile label={t('mis.plantHours')} kind="time" value={n(mis.resources.plantHours, 1)} /></KpiRow>)}
    {sec(t('mis.quality'), mis.qualityHse?.route, <KpiRow><KpiTile label={t('mis.ncrs')} kind="quality" value={n(mis.qualityHse?.ncrsOpen)} /><KpiTile label={t('mis.incidents')} kind="safety" value={n(mis.qualityHse?.incidents)} /><KpiTile label={t('mis.lostTime')} kind="safety" value={n(mis.qualityHse?.lostTime)} tone={mis.qualityHse?.lostTime ? 'error' : 'success'} /></KpiRow>)}
    {mis.risks && sec(t('mis.risks'), mis.risks.route, <KpiRow><KpiTile label={t('mis.risks')} kind="risk" value={n(mis.risks.high)} tone={mis.risks.high ? 'warning' : 'success'} /></KpiRow>)}
    {mis.lookAhead && sec(t('mis.lookAhead', { month: mis.lookAhead.month }), mis.lookAhead.route, <KpiRow><KpiTile label={t('mis.lookAhead', { month: mis.lookAhead.month })} kind="count" value={n(mis.lookAhead.activitiesStarting)} /></KpiRow>)}
  </CardGrid>;
}

function BudgetMaster({ bm }) {
  const t = useT('mc');
  const { money } = useFormat();
  const inr = (v) => (v == null ? '—' : money(String(v)));
  if (!bm.rows.length) return <EmptyState title={t('b.none')} action={<Link to="/finance/cost-forecasts">{t('mis.eac')}</Link>} />;
  return <>
    <p className="muted">{bm.route ? <Link to={bm.route}>{t('b.source', { ref: bm.forecastRef })}</Link> : null}</p>
    <KpiRow><KpiTile label={t('mis.budget')} kind="money" amount={bm.totals.budget} value={inr(bm.totals.budget)} /><KpiTile label={t('mis.eac')} kind="money" amount={bm.totals.eac} value={inr(bm.totals.eac)} /><KpiTile label={t('mis.variance')} kind="money" amount={bm.totals.variance} value={inr(bm.totals.variance)} tone={bm.totals.variance < 0 ? 'error' : 'success'} /></KpiRow>
    <div className="table-scroll"><table className="data-table" data-testid="mc-budget">
      <thead><tr><th>{t('b.head')}</th><th>{t('b.name')}</th><th className="num">{t('mis.budget')}</th><th className="num">{t('mis.committed')}</th><th className="num">{t('mis.actual')}</th><th className="num">{t('mis.eac')}</th><th className="num">{t('mis.variance')}</th></tr></thead>
      <tbody>{bm.rows.map((r) => <tr key={r.head} data-testid="mc-budget-row" data-head={r.head}><td data-label={t('b.head')}>{r.head}</td><td data-label={t('b.name')}>{r.name}</td><td data-label={t('mis.budget')} className="num">{inr(r.budget)}</td><td data-label={t('mis.committed')} className="num">{inr(r.committed)}</td><td data-label={t('mis.actual')} className="num">{inr(r.actual)}</td><td data-label={t('mis.eac')} className="num">{inr(r.eac)}</td><td data-label={t('mis.variance')} className="num">{inr(r.variance)}{r.variancePct != null ? ` (${r.variancePct}%)` : ''}</td></tr>)}</tbody>
    </table></div>
  </>;
}

function Close({ id, session }) {
  const t = useT('mc');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const [tab, setTab] = useState('checklist');
  const [reason, setReason] = useState('');
  const q = useQuery({ queryKey: ['bi', 'mc', id], queryFn: () => read(`/bi/monthly-closes/${id}`), retry: false });
  const hist = useQuery({ queryKey: ['bi', 'mc-history', id], queryFn: () => read(`/bi/monthly-closes/${id}/history`), enabled: tab === 'history', retry: false });
  const refresh = () => cache.invalidateQueries({ queryKey: ['bi'] });
  const act = useMutation({ mutationFn: ({ path, body }) => post(`/bi/monthly-closes/${id}/${path}`, body), onSuccess: (r) => { setReason(''); if (r?.data?.id && r.data.id !== Number(id)) navigateTo(`/bi/monthly-close?id=${r.data.id}`); return refresh(); } });
  const dl = useMutation({ mutationFn: ({ path, name }) => downloadReport(`/api/v1/bi/monthly-closes/${id}/${path}`, name) });
  if (q.error?.status === 403) return <NoPermission what={t('noPermission')} permission="bi.monthly_close.view" />;
  if (q.isPending) return <Skeleton label={t('closeTitle')} rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const c = q.data;
  void session;
  return <>
    <PageHeader id="mc-h" title={`${t('closeTitle')} · ${c.projectCode} · ${c.period}`} status={<StatusBadge status={c.status} label={c.statusLabel} variant="solid" />}
      subtitle={`${c.docNo} · v${c.versionNo} · ${c.lockState === 'LOCKED' ? t('lock.LOCKED', { time: dateTime(c.lockedAt) }) : t('lock.OPEN')}`}
      actions={<>
        {c.can.submit && <button type="button" className="btn btn-primary" data-testid="mc-submit" disabled={act.isPending} onClick={() => act.mutate({ path: 'submit', body: { rowVersion: c.rowVersion } })}>{t('act.submit')}</button>}
        {c.approval?.taskId && <Link to={`/approvals/task?id=${c.approval.taskId}`}>{t('approveTask')}</Link>}
        {c.can.print && <button type="button" className="btn" onClick={() => dl.mutate({ path: 'print?part=mis', name: `project-mis-${c.projectCode}-${c.period}.pdf` })}>{t('print')}</button>}
      </>} />
    {(act.error || dl.error) && <ErrorState error={act.error ?? dl.error} />}
    <p className="muted" data-testid="mc-frozen">{c.frozen ? t('frozen', { time: dateTime(c.snapshotAt) }) : t('live')}</p>
    <div role="tablist" aria-label={t('closeTitle')} className="tabs" data-testid="mc-tabs">
      {['checklist', 'mis', 'budget', 'history'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => setTab(k)}>{t(`tab.${k}`)}</button>)}
    </div>
    {tab === 'checklist' && <>
      <KpiRow><KpiTile label={t('tab.checklist')} kind="count" value={t('steps', { passed: c.passed, total: c.steps })} tone={c.passed === c.steps ? 'success' : 'warning'} /></KpiRow>
      <div className="table-scroll"><table className="data-table" data-testid="mc-checklist">
        <thead><tr><th>{t('c.step')}</th><th>{t('c.state')}</th><th>{t('c.owner')}</th><th>{t('c.dependsOn')}</th><th>{t('c.detail')}</th></tr></thead>
        <tbody>{c.checklist.map((s) => <tr key={s.code} data-testid="mc-step" data-code={s.code} data-state={s.state}>
          <td data-label={t('c.step')}>{s.route ? <Link to={s.route}>{s.name}</Link> : s.name}</td>
          <td data-label={t('c.state')}><StatusBadge status={STATE_STATUS[s.state]} label={t(`state.${s.state}`)} size="sm" /></td>
          <td data-label={t('c.owner')}>{s.ownerRole}</td><td data-label={t('c.dependsOn')}>{s.dependsOn.join(', ') || '—'}</td><td data-label={t('c.detail')}>{s.detail}</td>
        </tr>)}</tbody>
      </table></div>
    </>}
    {tab === 'mis' && <Mis mis={c.mis} />}
    {tab === 'budget' && <>
      {c.can.export && <div className="actions-row"><button type="button" className="btn" onClick={() => dl.mutate({ path: 'export?part=budget&format=xlsx', name: `budget-master-${c.projectCode}-${c.period}.xlsx` })}>{t('export')}</button>
        {c.can.print && <button type="button" className="btn" onClick={() => dl.mutate({ path: 'print?part=budget', name: `budget-master-${c.projectCode}-${c.period}.pdf` })}>{t('print')}</button>}</div>}
      <BudgetMaster bm={c.budgetMaster} />
    </>}
    {tab === 'history' && (hist.isPending ? <Skeleton label={t('tab.history')} /> : hist.error ? <ErrorState error={hist.error} /> : <div className="table-scroll"><table className="data-table">
      <thead><tr><th>{t('h.event')}</th><th>{t('h.actor')}</th><th>{t('h.at')}</th><th>{t('h.comment')}</th></tr></thead>
      <tbody>{hist.data.approvals.map((h, i) => <tr key={i}><td data-label={t('h.event')}>{h.event} {h.step_code ?? ''}</td><td data-label={t('h.actor')}>{h.actor}</td><td data-label={t('h.at')}>{dateTime(h.at)}</td><td data-label={t('h.comment')}>{h.comment ?? ''}</td></tr>)}</tbody>
    </table></div>)}
    {(c.can.withdraw || c.can.cancel || c.can.amend) && <Section title={t('reason')}>
      <Field name="mc-reason" label={t('reason')}><textarea minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="actions-row">
        {c.can.withdraw && <button type="button" className="btn" disabled={reason.trim().length < 5} onClick={() => act.mutate({ path: 'withdraw', body: { reason } })}>{t('act.withdraw')}</button>}
        {c.can.cancel && <button type="button" className="btn" disabled={reason.trim().length < 5} onClick={() => act.mutate({ path: 'cancel', body: { reason } })}>{t('cancel')}</button>}
        {c.can.amend && <button type="button" className="btn" data-testid="mc-amend" disabled={reason.trim().length < 5} onClick={() => act.mutate({ path: 'amend', body: { reason } })}>{t('amend')}</button>}
      </div>
    </Section>}
  </>;
}

export function MonthlyClose({ session }) {
  const t = useT('mc');
  const search = useSearch();
  const id = search.get('id');
  const period = search.get('period') ?? lastMonth();
  usePageTitle(id ? t('closeTitle') : t('title'));
  if (id) return <section aria-labelledby="mc-h" data-testid="bi-monthly-close"><Close id={id} session={session} /></section>;
  return <section aria-labelledby="mc-h" data-testid="bi-monthly-close-board">
    <PageHeader id="mc-h" title={t('title')} />
    <div className="actions-row"><Field name="mc-period" label={t('period')}><input type="month" value={period} onChange={(e) => navigateTo(`/bi/monthly-close?period=${e.target.value}`)} /></Field></div>
    <Board period={period} />
  </section>;
}
