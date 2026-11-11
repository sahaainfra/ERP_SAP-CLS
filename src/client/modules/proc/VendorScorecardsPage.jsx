import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { AVL_TONE, RATING_TONE, fmtDate, pct, pv8, today } from './api.js';
import { useRunner } from './XpdParts.jsx';
import { useSearch } from '../site/parts.jsx';

// Vendor scorecard (part 15.08, FR-03, FR-04): the score per period with the trend, the six measures and their weights, and the evidence behind each (receipts, CS ranks, RFQ answers, inputs); quality and safety people enter their inputs; procurement records reviews,
// corrective action requests and development notes, and proposes a suspension.
const METRIC_KEYS = ['onTime', 'quality', 'price', 'response', 'safety', 'invoice'];
const previousQuarter = () => { let y = Number(today().slice(0, 4)); let q = Math.floor((Number(today().slice(5, 7)) - 1) / 3); if (q === 0) { q = 4; y -= 1; } return `${y}-Q${q}`; };

function Evidence({ t, ev }) {
  const rows = [
    [t('v.m.onTime'), `${ev.delivery?.receipts?.length ?? 0} ${t('v.receipts')}: ${(ev.delivery?.receipts ?? []).map((x) => `${x.grn}${x.onTime ? '' : ` (${t('v.late')})`}`).join(', ') || '—'}`],
    [t('v.m.quality'), ev.quality?.receipts?.length ? `${ev.quality.receipts.length} ${t('v.receipts')}: ${ev.quality.receipts.reduce((s, x) => s + x.accepted, 0) / 1000} / ${ev.quality.receipts.reduce((s, x) => s + x.qty, 0) / 1000}` : ev.quality?.input ? `${t('v.input')} ${pct(ev.quality.input.value)} (${ev.quality.input.by})` : '—'],
    [t('v.m.price'), (ev.price?.lines ?? []).length ? (ev.price.lines).map((x) => `${x.rank}/${x.n}`).join(', ') : '—'],
    [t('v.m.response'), ev.response?.invited ? `${ev.response.answered}/${ev.response.invited} ${t('v.answered')}${ev.response.avgHours != null ? `, ${ev.response.avgHours} h` : ''}` : '—'],
    [t('v.m.safety'), ev.safety ? `${pct(ev.safety.value)} (${ev.safety.by}${ev.safety.note ? `: ${ev.safety.note}` : ''})` : '—'], [t('v.m.invoice'), ev.invoice ? `${pct(ev.invoice.value)} (${ev.invoice.by})` : '—'],
  ];
  return <div className="table-scroll"><table className="data-table" data-testid="vs-evidence"><caption>{t('v.evidence')}</caption><thead><tr><th>{t('v.measure')}</th><th>{t('v.evidenceRecords')}</th></tr></thead><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table></div>;
}

function Trend({ t, cards }) {
  const items = [...cards].reverse().filter((c) => c.total != null); if (!items.length) return null; const W = 36; const H = 90;
  return (
    <figure data-testid="vs-trend" style={{ margin: '12px 0' }}><figcaption>{t('v.trend')}</figcaption>
      <svg role="img" aria-label={t('v.trend')} viewBox={`0 0 ${items.length * W + 10} ${H + 24}`} style={{ width: '100%', maxWidth: 480, height: 'auto' }}>
        {items.map((c, i) => { const h = Math.round((c.total / 1_000_000) * H); return <g key={c.id}><rect x={8 + i * W} y={H - h} width={W - 8} height={h} fill="var(--erp-color-status-info-solid)" /><text x={8 + i * W + (W - 8) / 2} y={H + 14} textAnchor="middle" fontSize="9" fill="currentColor">{c.period.slice(2)}</text></g>; })}
      </svg></figure>
  );
}

function Partner({ t, id }) {
  const q = useQuery({ queryKey: ['proc', 'vendor-card', id], queryFn: () => pv8.partner(id), retry: false });
  const { error, note, busy, run } = useRunner(); const [period, setPeriod] = useState(previousQuarter()); const [sel, setSel] = useState(null); const [inp, setInp] = useState({ kind: 'SAFETY', value: '', note: '' }); const [act, setAct] = useState({ kind: 'CAR', title: '', owner: '', dueDate: '', detail: '' });
  usePageTitle(t('v.scoreTitle'));
  if (q.error?.status === 403) return <NoPermission what={t('v.scoreTitle')} permission="proc.vendor_score.view" />;
  if (q.isPending) return <Skeleton label={t('v.scoreTitle')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const card = d.scorecards.find((c) => c.id === sel) ?? d.scorecards[0] ?? null; const can = d.can;
  const why = (fn, msg) => { const x = window.prompt(t('x.why')); if (x) run(() => fn(x), msg); };
  return (
    <div data-testid="vs-object">
      <h1 id="vs-h">{d.partner.name} <span className="muted">({d.partner.code})</span></h1><p><Link to="/proc/vendor-scorecards">{t('x.back')}</Link> · <Link to="/proc/avl">{t('v.avlTitle')}</Link></p>
      {error?.form && <p className="field-error" role="alert" data-testid="vs-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="vs-note">{note}</p>}
      <div className="table-scroll"><table className="data-table" data-testid="vs-avl"><caption>{t('v.avlTitle')}</caption><thead><tr><th>{t('v.category')}</th><th>{t('v.region')}</th><th>{t('x.status')}</th><th>{t('v.validUntil')}</th></tr></thead>
        <tbody>{d.avl.length === 0 ? <tr><td colSpan={4} className="muted">{t('v.notOnList')}</td></tr> : d.avl.map((e) => <tr key={e.id}><td>{e.category}</td><td>{e.region}</td><td><StatusBadge status={AVL_TONE[e.expired && e.status !== 'SUSPENDED' ? 'EXPIRED' : e.status]} label={e.expired && e.status !== 'SUSPENDED' ? t('v.expired') : e.statusLabel} /></td><td>{fmtDate(e.validUntil)}</td></tr>)}</tbody></table></div>
      {d.suspensions.filter((s) => ['DRAFT', 'SUBMITTED', 'RETURNED'].includes(s.status)).map((s) => <p key={s.id} className="mdm-banner" role="status" data-testid="vs-susp">{t('v.suspOpen')} <Link to={`/proc/avl?suspension=${s.id}`}>{s.docNo}</Link></p>)}
      <div className="actions-row no-print">{can.suspend && d.avl.some((e) => e.status !== 'SUSPENDED') && <button type="button" className="btn" onClick={() => why((reason) => pv8.suspCreate({ partnerId: d.partner.id, reason }).then((s) => navigateTo(`/proc/avl?suspension=${s.id}`)))} data-testid="vs-propose">{t('v.proposeSuspension')}</button>}</div>
      {can.compute && <div className="mdm-panel no-print" data-testid="vs-compute"><h2>{t('v.compute')}</h2><div className="form-grid"><Field label={t('v.period')} name="period" error={error}><input value={period} maxLength={7} onChange={(ev) => setPeriod(ev.target.value)} style={{ minHeight: 44 }} data-testid="vs-period" /></Field></div>
        <p className="muted">{t('v.periodHelp')}</p><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => pv8.compute({ partnerId: d.partner.id, period }), t('v.computed'))} data-testid="vs-compute-go">{t('v.compute')}</button></div></div>}
      <Trend t={t} cards={d.scorecards} />
      {card ? <>
        <h2>{t('v.scorecard')} {card.period} <StatusBadge status={RATING_TONE[card.rating]} label={card.rating === 'NA' ? t('v.notRated') : `${t('v.rating')} ${card.rating}`} /></h2>
        <p data-testid="vs-total">{t('v.total')}: <strong>{pct(card.total)}</strong> · {fmtDate(card.periodFrom)} – {fmtDate(card.periodTo)}</p>
        <div className="table-scroll"><table className="data-table" data-testid="vs-metrics"><caption>{t('v.measures')}</caption><thead><tr><th>{t('v.measure')}</th><th className="num">{t('v.weight')}</th><th className="num">{t('v.value')}</th></tr></thead>
          <tbody>{METRIC_KEYS.map((k) => <tr key={k} data-testid="vs-metric"><td>{t(`v.m.${k}`)}</td><td className="num">{card.weights[k]}</td><td className="num">{pct(card.metrics[k])}</td></tr>)}</tbody></table></div>
        <details open><summary>{t('v.evidence')}</summary><Evidence t={t} ev={card.evidence} /></details>
        {d.scorecards.length > 1 && <div className="table-scroll"><table className="data-table" data-testid="vs-history"><caption>{t('v.periods')}</caption><thead><tr><th>{t('v.period')}</th><th className="num">{t('v.total')}</th><th>{t('v.rating')}</th><th /></tr></thead>
          <tbody>{d.scorecards.map((c) => <tr key={c.id}><td>{c.period}</td><td className="num">{pct(c.total)}</td><td>{c.rating}</td><td><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setSel(c.id)}>{t('v.open')}</button></td></tr>)}</tbody></table></div>}
      </> : <p className="muted" data-testid="vs-none">{t('v.noScorecards')}</p>}
      {can.input && <div className="mdm-panel no-print" data-testid="vs-input"><h2>{t('v.enterInput')}</h2><div className="form-grid">
        <Field label={t('v.measure')} name="kind" error={error}><select value={inp.kind} onChange={(ev) => setInp({ ...inp, kind: ev.target.value })} style={{ minHeight: 44 }} data-testid="vs-in-kind">{['SAFETY', 'INVOICE_ACCURACY', 'QUALITY'].map((k) => <option key={k} value={k}>{t(`v.k.${k}`)}</option>)}</select></Field>
        <Field label={t('v.period')} name="period" error={error}><input value={period} maxLength={7} onChange={(ev) => setPeriod(ev.target.value)} style={{ minHeight: 44 }} data-testid="vs-in-period" /></Field>
        <Field label={t('v.valuePct')} name="value" error={error}><input type="number" min="0" max="100" step="0.1" value={inp.value} onChange={(ev) => setInp({ ...inp, value: ev.target.value })} style={{ minHeight: 44 }} data-testid="vs-in-value" /></Field>
        <Field label={t('x.note')} name="note" error={error}><input value={inp.note} maxLength={500} onChange={(ev) => setInp({ ...inp, note: ev.target.value })} style={{ minHeight: 44 }} /></Field></div>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy || inp.value === ''} onClick={() => run(() => pv8.input({ partnerId: d.partner.id, period, kind: inp.kind, value: Number(inp.value), note: inp.note || null }), t('v.inputSaved')).then(() => setInp({ ...inp, value: '', note: '' }))} data-testid="vs-in-save">{t('x.save')}</button></div></div>}
      <div className="table-scroll"><table className="data-table" data-testid="vs-actions"><caption>{t('v.actions')}</caption><thead><tr><th>{t('v.actionNo')}</th><th>{t('v.kind')}</th><th>{t('v.title')}</th><th>{t('v.dueDate')}</th><th>{t('x.status')}</th><th /></tr></thead>
        <tbody>{d.actions.length === 0 ? <tr><td colSpan={6} className="muted">{t('v.noActions')}</td></tr> : d.actions.map((a) => <tr key={a.id} data-testid="vs-action" data-status={a.status}><td>{a.docNo}</td><td>{t(`v.ak.${a.kind}`)}</td><td>{a.title}{a.response ? ` — ${a.response}` : ''}</td><td>{fmtDate(a.dueDate)}{a.overdue && <span className="field-error"> {t('x.overdue')}</span>}</td><td>{t(`v.as.${a.status}`)}</td>
          <td>{a.can.respond && <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => { const x = window.prompt(t('v.responsePrompt')); if (x) run(() => pv8.actionAct(a.id, 'respond', { response: x }), t('v.responded')); }} data-testid="vs-act-respond">{t('v.respond')}</button>}
            {a.can.close && <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => run(() => pv8.actionAct(a.id, 'close', {}), t('v.closedAction'))} data-testid="vs-act-close">{t('v.closeAction')}</button>}</td></tr>)}</tbody></table></div>
      {can.act && <div className="mdm-panel no-print" data-testid="vs-new-action"><h2>{t('v.newAction')}</h2><div className="form-grid">
        <Field label={t('v.kind')} name="kind" error={error}><select value={act.kind} onChange={(ev) => setAct({ ...act, kind: ev.target.value })} style={{ minHeight: 44 }} data-testid="vs-act-kind">{['REVIEW', 'CAR', 'DEVELOPMENT'].map((k) => <option key={k} value={k}>{t(`v.ak.${k}`)}</option>)}</select></Field>
        <Field label={t('v.title')} name="title" error={error}><input value={act.title} maxLength={200} onChange={(ev) => setAct({ ...act, title: ev.target.value })} style={{ minHeight: 44 }} data-testid="vs-act-title" /></Field>
        <Field label={t('v.owner')} name="owner" error={error}><input value={act.owner} maxLength={60} onChange={(ev) => setAct({ ...act, owner: ev.target.value })} style={{ minHeight: 44 }} /></Field>
        <Field label={t('v.dueDate')} name="dueDate" error={error}><input type="date" min={today()} value={act.dueDate} onChange={(ev) => setAct({ ...act, dueDate: ev.target.value })} style={{ minHeight: 44 }} data-testid="vs-act-due" /></Field></div>
        <label>{t('v.detail')}<textarea rows={2} value={act.detail} maxLength={2000} onChange={(ev) => setAct({ ...act, detail: ev.target.value })} style={{ width: '100%', boxSizing: 'border-box' }} /></label>
        <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy || act.title.trim().length < 3} onClick={() => run(() => pv8.actionCreate({ partnerId: d.partner.id, scorecardId: card?.id, kind: act.kind, title: act.title, owner: act.owner || null, dueDate: act.dueDate || null, detail: act.detail || null }), t('v.actionSaved')).then(() => setAct({ ...act, title: '', detail: '' }))} data-testid="vs-act-save">{t('x.save')}</button></div></div>}
    </div>
  );
}

export default function VendorScorecardsPage() {
  const t = useT('proc'); usePageTitle(t('v.scoreTitle')); const sp = useSearch(); const partner = Number(sp.get('partner')) || null; const session = useSession();
  if (partner) return <section aria-labelledby="vs-h" data-testid="proc-vs"><Partner key={partner} t={t} id={partner} /></section>;
  return (
    <section aria-labelledby="vss-h" data-testid="proc-vs"><h1 id="vss-h">{t('v.scoreTitle')}</h1><p className="muted">{t('v.scoreIntro')}</p>
      <div className="actions-row no-print"><Link to="/proc/vendor-ranking">{t('v.rankTitle')}</Link> <Link to="/proc/avl">{t('v.avlTitle')}</Link> <Link to="/proc/prequalifications">{t('v.preqTitle')}</Link></div>
      <ListReport listCode="proc.vendor_scorecards" endpoint="/proc/vendor-scorecards" title={t('v.scoreTitle')} session={session.data} rowHref={(r) => `/proc/vendor-scorecards?partner=${r.partnerId}`} onOpen={(r) => navigateTo(`/proc/vendor-scorecards?partner=${r.partnerId}`)}
        cardFields={['vendor', 'period', 'total', 'rating']} statusKey="rating" empty={{ title: t('v.scoreEmptyTitle'), text: t('v.scoreEmptyBody') }} /></section>
  );
}
