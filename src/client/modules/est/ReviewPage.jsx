import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import Chart from '../../platform/charts/Chart.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { ASSUMPTION_KINDS, REVIEW_CODES, est, fetchFile, inr, rv } from './api.js';
import { EstimatePicker, Tabs, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Estimate Review (part 09.03, FR-01 to FR-04, FR-06): one estimate version as the commercial manager and the director review it. The header shows the selling, the cost, the margin and the bid price; the tabs hold the review
// checklist (ticking every item approves the review step of the approval, or a return says what to correct), the bid price summary, the sensitivity of the bid price to +/- x % on the key resources, the unbalanced items,
// the register of assumptions, inclusions, exclusions and qualifications, and the approvals. Costs and margins are shown only to those allowed to see them.
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', RETURNED: 'RETURNED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', SUPERSEDED: 'CANCELLED' };
export default function ReviewPage() {
  const t = useT('est');
  const qc = useQueryClient();
  const sp = useSearch(); const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['est', 'review', id], queryFn: () => rv.panel(id), enabled: Boolean(id), retry: false });
  const lq = useQuery({ queryKey: ['est', 'all'], queryFn: () => est.list({ pageSize: 100 }), enabled: !id, retry: false });
  const x = q.data;
  usePageTitle(x ? `${t('rev.title')} ${x.estimate.ref}` : t('rev.title'));
  const [tab, setTab] = useState('checklist'); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (!id) return (<section aria-labelledby="rev-h" data-testid="review-none"><PageHeader id="rev-h" title={t('rev.title')} subtitle={t('rev.choose')} />{lq.data && <EstimatePicker id="rev-pick" value={null} onChange={(v) => v && navigateTo(`/est/review?id=${v}`)} rows={lq.data.data ?? []} label={t('imp.estimate')} />}</section>);
  if (q.error?.status === 403) return <NoPermission what={t('rev.title')} permission="est.review.view" />;
  if (q.isPending) return <Skeleton label={t('rev.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['est'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const e = x.estimate; const s = x.summary; const c = e.costsVisible;
  const tabs = ['checklist', 'summary', ...(c ? ['sensitivity', 'unbalanced'] : []), 'assumptions', 'reviews'];
  return (
    <section aria-labelledby="rev-h" data-testid="review" data-status={e.status}>
      <header>
        <PageHeader id="rev-h" title={<>{t('rev.title')} {e.ref} <StatusBadge status={TONE[e.status]} label={e.statusLabel} /></>} subtitle={<><Link to={`/est/estimate?id=${e.id}`}>{e.title}</Link> · {e.tender ? e.tender.docNo : e.project?.name} · {t('obj.basis', { date: e.basisDate })} · {t('rev.items', { n: e.items })}</>} />
        <dl className="op-figures" data-testid="rev-figures">
          <div><dt>{t('fig.selling')}</dt><dd>{inr(s.selling)}</dd></div>
          {c && <div><dt>{t('fig.cost')}</dt><dd>{inr(s.totalCost)}</dd></div>}
          {c && <div><dt>{t('fig.margin')}</dt><dd data-testid="rev-profit">{inr(s.profit)} ({s.profitPct}%)</dd></div>}
          <div><dt>{t('bid.discount')}</dt><dd>{s.discountPct}% · {inr(s.discount)}</dd></div>
          <div><dt>{t('bid.price')}</dt><dd data-testid="rev-bid">{inr(s.bidPrice)}</dd></div>
        </dl>
        {error?.form && <p className="field-error" role="alert" data-testid="rev-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="rev-note">{note}</p>}
        {x.can.reviewTask && <p className="mdm-banner" data-testid="rev-task">{t('rev.yourTask', { step: x.can.reviewStep ?? '' })}</p>}
        <div className="actions-row no-print">
          <button type="button" className="btn" onClick={() => navigateTo(`/est/bid-price?id=${e.id}`)} data-testid="rev-bid-link">{t('bid.title')}</button>
          {x.can.exportBoq && <button type="button" className="btn" onClick={() => run(() => fetchFile(`/est/estimates/${e.id}/priced-boq?format=html`, { open: true }))} data-testid="rev-print">{t('bid.boqPrint')}</button>}
        </div>
      </header>
      <Tabs tabs={tabs} active={tab} onChange={setTab} label={t('rev.title')} />
      {tab === 'checklist' && <Checklist x={x} run={run} />}
      {tab === 'summary' && <SummaryTable s={s} />}
      {tab === 'sensitivity' && <Sensitivity id={e.id} />}
      {tab === 'unbalanced' && <Unbalanced u={x.unbalanced} />}
      {tab === 'assumptions' && <Assumptions x={x} run={run} />}
      {tab === 'reviews' && (
        <div data-testid="rev-history">
          {x.reviews.length === 0 ? <p className="muted">{t('rev.none')}</p> : <ul className="mdm-list">{x.reviews.map((r) => <li key={r.id}><strong>{t(`verdict.${r.verdict}`)}</strong> · {r.reviewer} · <span className="muted small">{String(r.at).slice(0, 16).replace('T', ' ')}</span> · {t('rev.ticked', { n: r.checked.length, of: REVIEW_CODES.length })}{r.comments ? <><br />{r.comments}</> : null}</li>)}</ul>}
          <p className="small"><Link to={`/est/estimate?id=${e.id}`}>{t('rev.approvals')}</Link></p>
        </div>)}
      <p className="small"><Link to="/est/estimates">{t('list.title')}</Link></p>
    </section>
  );
}

function Checklist({ x, run }) {
  const t = useT('est');
  const [checked, setChecked] = useState([]); const [comments, setComments] = useState('');
  const send = async (verdict) => { const r = await run(() => rv.review(x.estimate.id, { checked, comments: comments.trim() || null, verdict }), t(`rev.done.${verdict}`)); if (r) { setChecked([]); setComments(''); } };
  return (
    <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); send('APPROVE'); }} aria-label={t('tab.checklist')} data-testid="rev-checklist">
      <h2>{t('tab.checklist')}</h2>
      <fieldset disabled={!x.can.review}>
        <legend className="sr-only">{t('tab.checklist')}</legend>
        {x.checklist.map((c) => <label key={c.code} className="check" style={{ display: 'block' }}><input type="checkbox" checked={checked.includes(c.code)} onChange={(e) => setChecked(e.target.checked ? [...checked, c.code] : checked.filter((k) => k !== c.code))} data-testid={`rev-item-${c.code}`} /> {t(`chk.${c.code}`)}</label>)}
        <Field label={t('rev.comments')} name="comments"><textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} data-testid="rev-comments" /></Field>
        <div className="actions">
          <button type="button" className="btn" onClick={() => send('NOTE')} data-testid="rev-note-btn">{t('rev.saveNote')}</button>
          {x.can.reviewTask && <button type="button" className="btn" onClick={() => send('RETURN')} data-testid="rev-return">{t('rev.return')}</button>}
          {x.can.reviewTask && <button type="submit" className="btn btn-primary" disabled={checked.length !== x.checklist.length} data-testid="rev-approve">{t('rev.approve')}</button>}
        </div>
      </fieldset>
      {!x.can.review && <p className="small muted">{t('rev.notReviewer')}</p>}
    </form>
  );
}

export function SummaryTable({ s }) {
  const t = useT('est');
  return (
    <div className="table-wrap" data-testid="bid-summary">
      <table className="data-table">
        <tbody>
          {(s.parts ?? []).map((p) => <tr key={p.key}><th scope="row">{t(`part.${p.key}`)}</th><td data-testid={`part-${p.key}`}>{inr(p.amount)}</td></tr>)}
          <tr><th scope="row">{t('bid.selling')}</th><td>{inr(s.selling)}</td></tr>
          <tr><th scope="row">{t('bid.discountLine', { pct: s.discountPct })}</th><td data-testid="sum-discount">− {inr(s.discount)}</td></tr>
          <tr><th scope="row">{t('bid.net')}</th><td>{inr(s.net)}</td></tr>
          <tr><th scope="row">{t('fig.gst', { pct: s.gstPct })}</th><td>{inr(s.gst)}</td></tr>
          <tr><th scope="row"><strong>{t('bid.price')}</strong></th><td data-testid="sum-bid"><strong>{inr(s.bidPrice)}</strong></td></tr>
        </tbody>
      </table>
      <p className="small" data-testid="sum-words">{s.bidPriceInWords}</p>
      {s.check && <p className="small muted" data-testid="sum-check">{s.check.equals ? t('bid.checkOk') : t('bid.checkBad')}</p>}
    </div>
  );
}

function Sensitivity({ id }) {
  const t = useT('est');
  const [pct, setPct] = useState(10);
  const q = useQuery({ queryKey: ['est', 'sensitivity', id, pct], queryFn: () => rv.sensitivity(id, pct), enabled: pct !== 0, retry: false });
  const d = q.data;
  const chart = d && d.rows.length > 0 && { categories: d.rows.map((r) => r.label.slice(0, 24)), series: [{ name: t('sens.bidDelta'), values: d.rows.map((r) => Number(r.bidDelta)) }] };
  return (
    <div data-testid="rev-sensitivity">
      <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label={t('tab.sensitivity')}><label>{t('sens.change')} <select value={pct} onChange={(e) => setPct(Number(e.target.value))} data-testid="sens-pct">{[-20, -10, -5, 5, 10, 20].map((p) => <option key={p} value={p}>{p > 0 ? `+${p}` : p}%</option>)}</select></label></form>
      {q.isPending ? <Skeleton label={t('tab.sensitivity')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (<>
        <p className="small">{t('sens.base', { bid: inr(d.base.bidPrice), profit: inr(d.base.profit) })}</p>
        {chart && <Chart type="bar" data={chart} title={t('sens.chart', { pct: d.pct })} exportName="bid-sensitivity" />}
        <div className="table-wrap"><table className="data-table" data-testid="sens-table"><thead><tr><th scope="col">{t('sens.resource')}</th><th scope="col">{t('sens.baseAmount')}</th><th scope="col">{t('sens.costDelta')}</th><th scope="col">{t('bid.price')}</th><th scope="col">{t('sens.bidDelta')}</th><th scope="col">{t('sens.marginSame')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.key} data-testid={`sens-${r.key}`}><th scope="row" data-label={t('sens.resource')}>{r.label}{r.kind === 'type' ? <span className="muted small"> · {t('sens.allOfKind')}</span> : null}</th><td data-label={t('sens.baseAmount')}>{inr(r.baseAmount)}</td><td data-label={t('sens.costDelta')}>{inr(r.costDelta)}</td><td data-label={t('bid.price')}>{inr(r.bidPrice)}</td><td data-label={t('sens.bidDelta')} data-testid={`sens-delta-${r.key}`}>{inr(r.bidDelta)} ({r.bidDeltaPct}%)</td><td data-label={t('sens.marginSame')}>{inr(r.marginAtSamePrice)}</td></tr>)}</tbody></table></div>
      </>)}
    </div>
  );
}

function Unbalanced({ u }) {
  const t = useT('est');
  return (
    <div data-testid="rev-unbalanced">
      <p className="small">{t('unb.help', { avg: u.averageMarkupPct, band: u.bandPoints, client: u.clientBandPct })}</p>
      <p data-testid="unb-count"><strong>{t('unb.flagged', { n: u.flagged })}</strong></p>
      <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">{t('items.no')}</th><th scope="col">{t('items.description')}</th><th scope="col">{t('items.costRate')}</th><th scope="col">{t('items.rate')}</th><th scope="col">{t('unb.markup')}</th><th scope="col">{t('unb.vsClient')}</th><th scope="col">{t('unb.flags')}</th></tr></thead>
        <tbody>{u.rows.map((r) => <tr key={r.itemId} className={r.flags.length ? 'row-highlight' : ''} data-testid={`unb-${r.itemNo}`}><th scope="row" data-label={t('items.no')}>{r.itemNo}</th><td data-label={t('items.description')}>{r.description}</td><td data-label={t('items.costRate')}>{inr(r.costRate)}</td><td data-label={t('items.rate')}>{inr(r.sellingRate)}</td><td data-label={t('unb.markup')}>{r.markupPct}%</td><td data-label={t('unb.vsClient')}>{r.vsClientPct == null ? '—' : `${r.vsClientPct}%`}</td><td data-label={t('unb.flags')}>{r.flags.map((f) => t(`flag.${f}`)).join(', ') || '—'}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function Assumptions({ x, run }) {
  const t = useT('est'); const edit = x.can.editAssumptions;
  const [rows, setRows] = useState(x.assumptions.map((a) => ({ kind: a.kind, text: a.text })));
  useEffect(() => { setRows(x.assumptions.map((a) => ({ kind: a.kind, text: a.text }))); }, [x.estimate.rowVersion, x.assumptions.length]);
  const set = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => rv.assumptions(x.estimate.id, { lines: rows.map((r) => ({ kind: r.kind, text: r.text.trim() })) }), t('asm.saved')); }} aria-label={t('tab.assumptions')} data-testid="rev-assumptions">
      <h2>{t('tab.assumptions')}</h2>
      {rows.length === 0 && <p className="muted">{t('asm.none')}</p>}
      {ASSUMPTION_KINDS.map((k) => rows.some((r) => r.kind === k) && !edit ? <div key={k}><h3>{t(`asm.${k}`)}</h3><ul className="mdm-list">{rows.filter((r) => r.kind === k).map((r, i) => <li key={i}>{r.text}</li>)}</ul></div> : null)}
      {edit && rows.map((r, i) => (
        <div key={i} className="mdm-fields" data-testid={`asm-${i}`}>
          <Field label={t('asm.kind')} name={`k${i}`}><select value={r.kind} onChange={(e) => set(i, { kind: e.target.value })} data-testid={`asm-kind-${i}`}>{ASSUMPTION_KINDS.map((k) => <option key={k} value={k}>{t(`asm.${k}`)}</option>)}</select></Field>
          <Field label={t('asm.text')} name={`t${i}`}><input value={r.text} onChange={(e) => set(i, { text: e.target.value })} data-testid={`asm-text-${i}`} /></Field>
          <button type="button" className="btn btn-small" onClick={() => setRows(rows.filter((_, k) => k !== i))} aria-label={t('act.remove')}>✕</button>
        </div>))}
      {edit && <div className="actions"><button type="button" className="btn" onClick={() => setRows([...rows, { kind: 'ASSUMPTION', text: '' }])} data-testid="asm-add">{t('asm.add')}</button><button type="submit" className="btn btn-primary" data-testid="asm-save">{t('act.save')}</button></div>}
      {!edit && <p className="small muted">{t('asm.locked')}</p>}
    </form>
  );
}

