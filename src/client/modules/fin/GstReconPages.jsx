import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import Chart from '../../platform/charts/Chart.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { JN_TONE, gl, gr, money } from './api.js';
import { GlError, useGlRunner } from './JournalsPage.jsx';

// Part 23.08: the GSTR-2B reconciliation worklist (import, categories, owner, vendor follow-up, resolution) with the ITC review of a month (approved by the CFO), and
// the returns report: GSTR-1 / GSTR-3B (chart first), the TDS statement with its challans and certificates, the 26AS match and the compliance calendar.
const big = { minHeight: 48, fontSize: '1rem' };
const can = (session, p) => Boolean(session?.permissions?.includes(p));
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const lastMonth = () => { const d = new Date(`${istToday().slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
const quarterNow = () => { const t = istToday(); const y = Number(t.slice(0, 4)); const m = Number(t.slice(5, 7)); const fy = m >= 4 ? y : y - 1; const q = m >= 4 && m <= 6 ? 1 : m <= 9 && m >= 7 ? 2 : m >= 10 ? 3 : 4; return `${fy}-${String((fy + 1) % 100).padStart(2, '0')}-Q${q}`; };
const guardOf = (q, what, permission) => (q.error?.status === 403 || q.error?.status === 404 ? <NoPermission what={what} permission={permission} /> : q.isPending ? <Skeleton label={what} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : null);
const Pills = ({ tabs, tab, setTab, label, prefix }) => <div className="actions-row" role="tablist" aria-label={label}>{tabs.map(([k, l, n]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setTab(k)} data-testid={`${prefix}-${k}`}>{l}{n != null ? ` (${n})` : ''}</button>)}</div>;
const SLA = { LATE: 'REJECTED', DUE: 'RETURNED', OK: 'IN_REVIEW', DONE: 'APPROVED' };
const MTONE = { MATCHED: 'APPROVED', MISMATCH_AMOUNT: 'REJECTED', MISMATCH_DATE: 'RETURNED', MISMATCH_NUMBER: 'RETURNED', MISSING_IN_BOOKS: 'IN_REVIEW', MISSING_IN_2B: 'IN_REVIEW' };
const ask = (t, k) => { const r = globalThis.prompt?.(t(k)); return r && r.trim().length >= 5 ? r.trim() : null; };

// ---- the 2B worklist ----
function Line({ l, run, busy, t }) {
  return (
    <li className="mdm-panel" data-testid="rec-line" data-status={l.status} style={{ display: 'grid', gap: 6, padding: 12, margin: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{l.invoiceNo}</strong><span><StatusBadge status={MTONE[l.status]} label={t(`rec.m.${l.status}`)} /> {l.sla && l.sla !== 'DONE' ? <StatusBadge status={SLA[l.sla]} label={t('rec.age', { n: l.ageDays })} /> : null}</span></div>
      <span className="muted small">{l.supplier ?? ''} · {l.supplierGstin} · {l.invoiceDate} · {t('rec.tax')} {money(l.tax)}{l.bill ? ` · ${t('rec.books')} ${l.bill.docNo}` : ''}{l.diff ? ` · ${t('rec.diff')} ${money(l.diff)}` : ''}</span>
      {l.note && <span className="small">{l.note}</span>}
      {l.owner && <span className="muted small">{t('rec.owner')}: {l.owner} · {t(`rec.r.${l.resolution}`)}{l.nextFollowup ? ` · ${t('rec.next')} ${l.nextFollowup}` : ''}</span>}
      {l.can?.manage && <div className="actions-row">
        {!l.owner && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => gr.act(l.id, { action: 'assign' }), t('rec.assigned'))}>{t('rec.takeIt')}</button>}
        <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => { const n = ask(t, 'rec.followupPrompt'); if (n) run(() => gr.act(l.id, { action: 'followup', channel: 'EMAIL', note: n }), t('rec.followed')); }} data-testid={`rec-follow-${l.id}`}>{t('rec.followup')}</button>
        {['OPEN', 'FOLLOW_UP'].includes(l.resolution) && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const n = ask(t, 'rec.resolvePrompt'); if (n) run(() => gr.act(l.id, { action: 'accept', note: n }), t('rec.accepted')); }}>{t('rec.accept')}</button>}
      </div>}
    </li>
  );
}
function Worklist({ period }) {
  const t = useT('gst'); const session = useSession(); const [cat, setCat] = useState('MISMATCH'); const q = useQuery({ queryKey: ['gl', 'gr-wl', period, cat], queryFn: () => gr.worklist({ period, status: cat }), retry: false, placeholderData: (prev) => prev }); const { error, note, busy, run } = useGlRunner(); const [file, setFile] = useState(null);
  const g = guardOf(q, t('rec.title'), 'fin.gst_recon.view'); if (g) return g; const x = q.data;
  const go = async () => { if (!file) return; const content = await file.text(); const r = await run(() => gr.import({ period, fileName: file.name, format: /\.json$/i.test(file.name) ? 'JSON' : 'CSV', content }), t('rec.imported')); if (r) { setFile(null); q.refetch(); } };
  const nMism = x.counts.MISMATCH_AMOUNT + x.counts.MISMATCH_DATE + x.counts.MISMATCH_NUMBER; const cats = [['MISMATCH', t('rec.c.mismatch'), nMism], ['MISSING_IN_BOOKS', t('rec.m.MISSING_IN_BOOKS'), x.counts.MISSING_IN_BOOKS], ['MISSING_IN_2B', t('rec.m.MISSING_IN_2B'), x.counts.MISSING_IN_2B], ['MATCHED', t('rec.m.MATCHED'), x.counts.MATCHED]];
  const rows = cat === 'MISMATCH' ? x.rows.filter((r) => r.status.startsWith('MISMATCH')) : x.rows.filter((r) => r.status === cat);
  return (
    <div data-testid="rec-worklist"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <KpiRow label={t('rec.title')}><KpiTile label={t('rec.taxIn2b')} value={money(x.taxIn2b)} amount={x.taxIn2b} kind="money" /><KpiTile label={t('rec.m.MATCHED')} value={String(x.counts.MATCHED)} valueTestid="rec-matched" /><KpiTile label={t('rec.c.mismatch')} value={String(nMism)} valueTestid="rec-mismatch" /><KpiTile label={t('rec.m.MISSING_IN_2B')} value={String(x.counts.MISSING_IN_2B)} /></KpiRow>
      {x.canImport && <div className="mdm-panel"><p className="muted small">{t('rec.importIntro')}</p><div className="actions-row"><label className="btn" style={{ ...big, display: 'inline-flex', alignItems: 'center' }}>{file ? file.name : t('rec.choose')}<input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} data-testid="rec-file" /></label><button type="button" className="btn btn-primary" style={big} disabled={busy || !file} onClick={go} data-testid="rec-import">{t('rec.import')}</button>{x.imports.length > 0 && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => gr.rematch({ period }), t('rec.rematched')).then(() => q.refetch())}>{t('rec.rematch')}</button>}{can(session.data, 'fin.gst_recon.export') && <button type="button" className="btn" style={big} onClick={() => gl.file(`/gst-recon/export?period=${period}`, `gstr-2b-${period}.csv`).catch(() => globalThis.alert?.(t('gst.fileFailed')))}>{t('rec.export')}</button>}</div>
        {x.imports.length > 0 && <p className="muted small">{t('rec.lastImport', { file: x.imports[0].fileName, n: x.imports[0].lines, at: String(x.imports[0].at).slice(0, 16).replace('T', ' ') })}</p>}</div>}
      <Pills tabs={cats} tab={cat} setTab={setCat} label={t('rec.title')} prefix="rec-cat" />
      {cat === 'MISSING_IN_2B' ? (x.missingIn2b.length === 0 ? <EmptyState compact title={t('rec.none')} message={t('rec.noneBody')} /> : <ul className="lp-list">{x.missingIn2b.map((m) => <li key={m.billId} className="mdm-panel" data-testid="rec-missing2b" style={{ display: 'grid', gap: 6, padding: 12, margin: '8px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{m.invoiceNo}</strong><StatusBadge status="IN_REVIEW" label={t('rec.m.MISSING_IN_2B')} /></div><span className="muted small">{m.supplier} · {m.supplierGstin ?? '—'} · {m.invoiceDate} · {t('rec.tax')} {money(m.tax)} · {m.docNo}{m.followups ? ` · ${t('rec.followups', { n: m.followups })}` : ''}</span>{x.canManage && <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => { const n = ask(t, 'rec.followupPrompt'); if (n) run(() => gr.act(m.billId, { on: 'bill', action: 'followup', channel: 'PORTAL', note: n }), t('rec.followed')).then(() => q.refetch()); }}>{t('rec.followup')}</button></div>}</li>)}</ul>)
        : rows.length === 0 ? <EmptyState compact title={x.imports.length ? t('rec.none') : t('rec.noImport')} message={x.imports.length ? t('rec.noneBody') : t('rec.noImportBody')} /> : <ul className="lp-list">{rows.map((l) => <Line key={l.id} l={l} run={(fn, done) => run(fn, done).then((r) => { q.refetch(); return r; })} busy={busy} t={t} />)}</ul>}
    </div>
  );
}

// ---- the ITC review ----
function Review({ id }) {
  const t = useT('gst'); const q = useQuery({ queryKey: ['gl', 'gr-itc', id], queryFn: () => gr.review(id), retry: false }); const { error, setError, note, busy, run } = useGlRunner(); const [comment, setComment] = useState('');
  const g = guardOf(q, t('itc.title'), 'fin.itc_review.view'); if (g) return g; const x = q.data; const c = x.can;
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('set.sayWhy') }); return; } run(() => gl.decide(c.taskId, action, comment.trim() || null), t(`set.done.${action}`)); };
  const groups = [...new Set(x.lines.map((l) => l.decision))];
  return (
    <div data-testid="itc-review" data-status={x.status}>
      <h2 style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>{x.docNo} · {x.period} <StatusBadge status={JN_TONE[x.status] ?? 'CANCELLED'} label={t(`set.st.${x.status}`)} /></h2>
      <GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <KpiRow label={t('itc.title')}><KpiTile label={t('itc.claimable')} value={money(x.claimable)} amount={x.claimable} kind="money" valueTestid="itc-claimable" /><KpiTile label={t('itc.eligible')} value={money(x.eligible)} amount={x.eligible} kind="money" /><KpiTile label={t('itc.override')} value={money(x.override)} amount={x.override} kind="money" /><KpiTile label={t('itc.reversed')} value={money(x.reversed)} amount={x.reversed} kind="money" /><KpiTile label={t('itc.blocked')} value={money(x.blocked)} amount={x.blocked} kind="money" /><KpiTile label={t('itc.held')} value={money(x.held)} amount={x.held} kind="money" /></KpiRow>
      {groups.map((d) => <div key={d}><h3>{t(`itc.d.${d}`)}</h3><ul className="lp-list">{x.lines.filter((l) => l.decision === d).map((l) => (
        <li key={l.id} className="mdm-panel" data-testid="itc-line" data-decision={l.decision} style={{ display: 'grid', gap: 4, padding: 12, margin: '6px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{l.invoiceNo}</strong><span className="num">{l.reverse ? `− ${money(l.reverse)}` : money(l.claim || l.tax)}</span></div>
          <span className="muted small">{l.supplier} · {l.supplierGstin ?? ''} · {l.invoiceDate}</span>{l.reason && <span className="small">{l.reason}</span>}
          {c.recompute && ['HELD_NOT_IN_2B', 'HELD_MISMATCH'].includes(l.decision) && <div className="actions-row"><button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = globalThis.prompt?.(t('itc.overridePrompt')); if (r) run(() => gr.override(x.id, { billId: l.billId, claim: true, reason: r, version: x.version }), t('itc.overridden')); }}>{t('itc.claimAnyway')}</button></div>}
          {c.recompute && l.decision === 'OVERRIDE_CLAIM' && <div className="actions-row"><button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => gr.override(x.id, { billId: l.billId, claim: false, version: x.version }), t('itc.unclaimed'))}>{t('itc.unclaim')}</button></div>}
        </li>))}</ul></div>)}
      {c.approve && c.taskId && <div className="mdm-panel no-print" data-testid="itc-decide"><h3>{t('set.decision')}</h3><label>{t('set.comment')}<textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} style={{ width: '100%', fontSize: '1rem' }} /></label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ ...big, flex: '1 1 10rem' }} disabled={busy} onClick={() => decide('approve')} data-testid="itc-approve">{t('set.approve')}</button><button type="button" className="btn" style={{ ...big, flex: '1 1 10rem' }} disabled={busy} onClick={() => decide('return')}>{t('set.return')}</button></div></div>}
      <div className="actions-row ff-actionbar">
        {c.recompute && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => gr.reviewAct(x.id, 'recompute'), t('itc.recomputed'))}>{t('itc.recompute')}</button>}
        {c.submit && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => gr.reviewAct(x.id, 'submit'), t('itc.sent'))} data-testid="itc-submit">{t('itc.submit')}</button>}
        {c.withdraw && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const r = ask(t, 'gst.remarkPrompt'); if (r) run(() => gr.reviewAct(x.id, 'withdraw', { reason: r }), t('set.withdrawn')); }}>{t('set.withdraw')}</button>}
        {c.amend && <button type="button" className="btn" style={big} disabled={busy} onClick={() => run(() => gr.reviewAct(x.id, 'amend'), t('itc.amended'))}>{t('itc.amend')}</button>}
        {c.print && <button type="button" className="btn" style={big} onClick={() => gl.file(`/itc-reviews/${x.id}/print`, `itc-review-${x.period}.pdf`).catch(() => globalThis.alert?.(t('gst.fileFailed')))}>{t('itc.print')}</button>}
      </div>
    </div>
  );
}
function Reviews({ period, open }) {
  const t = useT('gst'); const session = useSession(); const q = useQuery({ queryKey: ['gl', 'gr-itcs'], queryFn: gr.reviews, retry: false }); const { error, busy, run } = useGlRunner(); const [id, setId] = useState(open);
  const g = guardOf(q, t('itc.title'), 'fin.itc_review.view'); if (g) return g;
  if (id) return <><div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setId(null)}>{t('itc.all')}</button></div><Review id={id} /></>;
  const mine = q.data.find((r) => r.period === period && ['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED'].includes(r.status));
  return (
    <div data-testid="itc-reviews"><GlError error={error} />
      {!mine && can(session.data, 'fin.itc_review.create') && <div className="mdm-panel"><p>{t('itc.makeIntro', { period })}</p><button type="button" className="btn btn-primary" style={{ ...big, width: '100%' }} disabled={busy} onClick={async () => { const r = await run(() => gr.createReview({ period }), t('itc.made')); if (r) setId(r.id); }} data-testid="itc-create">{t('itc.make', { period })}</button></div>}
      {q.data.length === 0 ? <EmptyState compact title={t('itc.none')} message={t('itc.noneBody')} /> : <ul className="lp-list">{q.data.map((r) => <li key={r.id} className="mdm-panel" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 12, minHeight: 48 }}><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => setId(r.id)}>{r.docNo} · {r.period}</button><StatusBadge status={JN_TONE[r.status] ?? 'CANCELLED'} label={t(`set.st.${r.status}`)} /><span className="num">{money(r.claimable)}</span></li>)}</ul>}
    </div>
  );
}
export function GstReconPage() {
  const t = useT('gst'); usePageTitle(t('rec.title')); const sp = useSearch(); const [tab, setTab] = useState(sp.get('tab') ?? 'recon'); const [period, setPeriod] = useState(sp.get('period') ?? lastMonth());
  return (
    <section aria-labelledby="rec-h" data-testid="gst-recon">
      <PageHeader id="rec-h" title={t('rec.title')} subtitle={t('rec.intro')} meta={<Link to="/finance/gst-returns">{t('ret.title')}</Link>} />
      <div className="form-grid"><Field label={t('rec.period')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} data-testid="rec-period" /></Field></div>
      <Pills tabs={[['recon', t('rec.tab')], ['itc', t('itc.tab')]]} tab={tab} setTab={setTab} label={t('rec.title')} prefix="rec-tab" />
      {tab === 'recon' ? <Worklist period={period} /> : <Reviews period={period} open={Number(sp.get('review')) || null} />}
    </section>
  );
}

// ---- the returns report ----
function GstReturns({ period }) {
  const t = useT('gst'); const q = useQuery({ queryKey: ['gl', 'gr-ret', period], queryFn: () => gr.returns({ period }), retry: false }); const { error, note, busy, run } = useGlRunner();
  const g = guardOf(q, t('ret.title'), 'fin.gst_return.view'); if (g) return g; const x = q.data; const b = x.gstr3b;
  const file = (rt) => { const arn = globalThis.prompt?.(t('ret.arnPrompt')); if (arn) run(() => gr.fileReturn({ period, returnType: rt, arn: arn.trim(), filedOn: istToday() }), t('ret.filed')); };
  return (
    <div data-testid="ret-gst"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="mdm-panel"><Chart type="bar" data={{ categories: x.trend.map((r) => r.period), series: [{ name: t('ret.output'), values: x.trend.map((r) => Math.round(r.output)) }, { name: t('ret.itc'), values: x.trend.map((r) => Math.round(r.itc)) }], unit: '₹' }} title={t('ret.trend')} exportName={`gst-${period}`} tableSwitch /></div>
      <KpiRow label={t('ret.title')}><KpiTile label={t('ret.payable')} value={money(b.payable)} amount={b.payable} kind="money" valueTestid="ret-payable" /><KpiTile label={t('ret.output')} value={money(b.outward.tax)} amount={b.outward.tax} kind="money" /><KpiTile label={t('ret.itc')} value={money(b.itc.net)} amount={b.itc.net} kind="money" /><KpiTile label={t('ret.rcm')} value={money(b.inwardRcm.tax)} amount={b.inwardRcm.tax} kind="money" /></KpiRow>
      {['GSTR1', 'GSTR3B'].map((rt) => { const f = x.filings[rt]; return (
        <div key={rt} className="mdm-panel" data-testid={`ret-${rt}`}><h2 style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{t(`ret.${rt}`)} <StatusBadge status={f?.status === 'FILED' ? 'APPROVED' : f ? 'IN_REVIEW' : 'DRAFT'} label={f?.status === 'FILED' ? t('ret.filedArn', { arn: f.arn }) : f ? t('ret.prepared') : t('ret.notPrepared')} /></h2>
          {rt === 'GSTR1' ? <ul className="lp-list">{x.gstr1.b2b.map((i) => <li key={i.no} style={{ minHeight: 44 }}>{i.no} · {i.date} · {i.gstin} · {money(i.taxable)} · {i.igst ? `IGST ${money(i.igst)}` : `CGST ${money(i.cgst)} + SGST ${money(i.sgst)}`}</li>)}{x.gstr1.cdnr.map((n) => <li key={n.no} style={{ minHeight: 44 }}>{t('ret.cn')} {n.no} · {n.date} · − {money(n.taxable)}</li>)}{x.gstr1.b2b.length + x.gstr1.cdnr.length === 0 && <li className="muted">{t('ret.noSales')}</li>}</ul>
            : <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(10rem, max-content) 1fr', gap: '4px 12px' }}><dt>{t('ret.31a')}</dt><dd className="num">{money(b.outward.taxable)} · {money(b.outward.tax)}</dd><dt>{t('ret.31d')}</dt><dd className="num">{money(b.inwardRcm.taxable)} · {money(b.inwardRcm.tax)}</dd><dt>{t('ret.4a')}</dt><dd className="num">{money(b.itc.available)}</dd><dt>{t('ret.4b')}</dt><dd className="num">{money(b.itc.reversed)}</dd><dt>{t('ret.4d')}</dt><dd className="num">{money(b.itc.ineligible)}</dd>{b.itc.reclaimed > 0 && <><dt>{t('ret.reclaimed')}</dt><dd className="num">{money(b.itc.reclaimed)}</dd></>}{b.setOff && <><dt>{t('ret.cash')}</dt><dd className="num" data-testid="ret-cash">IGST {money(b.setOff.cash.igst)} · CGST {money(b.setOff.cash.cgst)} · SGST {money(b.setOff.cash.sgst)}</dd><dt>{t('ret.carry')}</dt><dd className="num">IGST {money(b.setOff.carryForward.igst)} · CGST {money(b.setOff.carryForward.cgst)} · SGST {money(b.setOff.carryForward.sgst)}</dd><dt>{t('ret.due')}</dt><dd>{b.dueDate}{b.daysLate > 0 ? ` · ${t('ret.late', { n: b.daysLate })}` : ''}</dd>{b.daysLate > 0 && <><dt>{t('ret.interest')}</dt><dd className="num">{money(b.interest.amount)}</dd><dt>{t('ret.lateFee')}</dt><dd className="num">{money(b.lateFee.total)}</dd></>}<dt>{t('ret.totalDue')}</dt><dd className="num"><strong>{money(b.totalDue)}</strong></dd></>}</dl>}
          <div className="actions-row">{x.can.prepare && f?.status !== 'FILED' && <button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => run(() => gr.prepareReturn({ period, returnType: rt }), t('ret.preparedNote'))} data-testid={`ret-prepare-${rt}`}>{t('ret.prepare')}</button>}{x.can.file && f?.status === 'PREPARED' && <button type="button" className="btn" style={big} disabled={busy} onClick={() => file(rt)}>{t('ret.markFiled')}</button>}<button type="button" className="btn" style={big} onClick={() => gl.file(`/gst-returns/export?period=${period}&returnType=${rt}`, `${rt.toLowerCase()}-${period}.json`).catch(() => globalThis.alert?.(t('gst.fileFailed')))}>{t('ret.export')}</button></div>
        </div>); })}
      <div className="ff-actionbar" data-testid="ret-totals"><span>{t('ret.output')} <strong>{money(b.outward.tax)}</strong></span><span>{t('ret.itc')} <strong>{money(b.itc.net)}</strong></span><span>{t('ret.payable')} <strong>{money(b.payable)}</strong></span></div>
    </div>
  );
}
function Tds() {
  const t = useT('gst'); const [quarter, setQuarter] = useState(quarterNow()); const q = useQuery({ queryKey: ['gl', 'gr-tds', quarter], queryFn: () => gr.tds({ quarter }), retry: false }); const { error, note, busy, run } = useGlRunner(); const [ch, setCh] = useState({ bsr: '', date: istToday(), serial: '', amount: '' });
  const g = guardOf(q, t('tds.title'), 'fin.tds_return.view'); const x = q.data;
  return (
    <div data-testid="ret-tds"><GlError error={error} />{note && <p className="mdm-banner" role="status">{note}</p>}
      <div className="form-grid"><Field label={t('tds.quarter')} name="quarter" error={null}><input value={quarter} onChange={(e) => setQuarter(e.target.value)} style={big} pattern="\d{4}-\d{2}-Q[1-4]" /></Field></div>
      {g ?? <>
        <KpiRow label={t('tds.title')}><KpiTile label={t('tds.form')} value={x.form ? `Form ${x.form}` : '—'} valueTestid="tds-form" /><KpiTile label={t('tds.deducted')} value={money(x.deducted)} amount={x.deducted} kind="money" /><KpiTile label={t('tds.deposited')} value={money(x.deposited)} amount={x.deposited} kind="money" /><KpiTile label={t('tds.status')} value={t(`tds.st.${x.status}`)} /></KpiRow>
        {x.deductees.length === 0 ? <EmptyState compact title={t('tds.none')} message={t('tds.noneBody')} /> : <ul className="lp-list" aria-label={t('tds.deductees')}>{x.deductees.map((d) => <li key={d.partnerId ?? d.name} className="mdm-panel" style={{ display: 'grid', gap: 4, padding: 12, margin: '6px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{d.name}</strong><span className="num">{money(d.tds)}</span></div><span className="muted small">PAN {d.pan ?? t('tds.noPan')} · {d.sections} · {t('tds.paid')} {money(d.paid)} · {t('tds.entries', { n: d.entries })}</span>{x.status === 'FILED' && x.can.certificate && d.partnerId && <div className="actions-row"><button type="button" className="btn" style={big} onClick={() => gl.file(`/tds-returns/certificate?quarter=${quarter}&partnerId=${d.partnerId}`, `form-${x.certificate}-${quarter}.pdf`).catch(() => globalThis.alert?.(t('gst.fileFailed')))}>{t('tds.cert', { form: x.certificate })}</button></div>}</li>)}</ul>}
        <h3>{t('tds.challans')}</h3>{x.challans.length > 0 && <ul className="lp-list">{x.challans.map((c, i) => <li key={i} style={{ minHeight: 44 }}>BSR {c.bsr} · {c.date} · {c.serial} · {money(c.amount)}</li>)}</ul>}
        {x.can.prepare && x.status !== 'FILED' && <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); run(() => gr.prepareTds({ quarter, challans: [...x.challans, ...(ch.bsr ? [{ ...ch, amount: ch.amount || '0' }] : [])] }), t('tds.prepared')).then(() => setCh({ bsr: '', date: istToday(), serial: '', amount: '' })); }}>
          <div className="form-grid"><Field label={t('tds.bsr')} name="bsr" error={error?.fields?.['challans.0.bsr']}><input inputMode="numeric" value={ch.bsr} onChange={(e) => setCh({ ...ch, bsr: e.target.value })} style={big} maxLength={7} /></Field><Field label={t('tds.date')} name="date" error={null}><input type="date" value={ch.date} onChange={(e) => setCh({ ...ch, date: e.target.value })} style={big} /></Field><Field label={t('tds.serial')} name="serial" error={null}><input inputMode="numeric" value={ch.serial} onChange={(e) => setCh({ ...ch, serial: e.target.value })} style={big} maxLength={5} /></Field><Field label={t('tds.amount')} name="amount" error={null}><input inputMode="decimal" value={ch.amount} onChange={(e) => setCh({ ...ch, amount: e.target.value })} style={big} /></Field></div>
          <div className="actions-row"><button type="submit" className="btn btn-primary" style={big} disabled={busy}>{t('tds.prepare')}</button>{x.can.file && x.status === 'PREPARED' && <button type="button" className="btn" style={big} disabled={busy} onClick={() => { const tok = globalThis.prompt?.(t('tds.tokenPrompt')); if (tok) run(() => gr.fileTds({ quarter, tokenNo: tok.trim(), filedOn: istToday() }), t('tds.filed')); }}>{t('ret.markFiled')}</button>}</div></form>}
        <p className="muted small">{t('tds.tcs')}</p>
      </>}
    </div>
  );
}
function Calendar() {
  const t = useT('gst'); const q = useQuery({ queryKey: ['gl', 'gr-cal'], queryFn: () => gr.calendar({}), retry: false });
  const g = guardOf(q, t('cal.title'), 'fin.gst_return.view'); if (g) return g; const x = q.data; const TONES = { OVERDUE: 'REJECTED', DUE_SOON: 'RETURNED', UPCOMING: 'IN_REVIEW', DONE: 'APPROVED' };
  return (
    <div data-testid="ret-calendar">
      <KpiRow label={t('cal.title')}><KpiTile label={t('cal.st.OVERDUE')} value={String(x.counts.overdue)} valueTestid="cal-overdue" /><KpiTile label={t('cal.st.DUE_SOON')} value={String(x.counts.dueSoon)} /><KpiTile label={t('cal.st.UPCOMING')} value={String(x.counts.upcoming)} /><KpiTile label={t('cal.st.DONE')} value={String(x.counts.done)} /></KpiRow>
      {x.rows.length === 0 ? <EmptyState compact title={t('cal.none')} message={t('cal.noneBody')} /> : <ul className="lp-list" aria-label={t('cal.title')}>{x.rows.map((r) => <li key={`${r.code}${r.period}`} className="mdm-panel" data-testid="cal-row" data-status={r.status} style={{ display: 'grid', gap: 4, padding: 12, margin: '6px 0' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><strong>{r.obligation}</strong><StatusBadge status={TONES[r.status]} label={r.status === 'DONE' ? t('cal.st.DONE') : r.daysLeft < 0 ? t('cal.late', { n: -r.daysLeft }) : t('cal.left', { n: r.daysLeft })} /></div><span className="muted small">{r.period} · {t('cal.due')} {r.dueDate}{r.form ? ` · ${r.form}` : ''} · {r.legalRef ?? ''}{r.done?.ref ? ` · ${r.done.ref}` : ''}</span></li>)}</ul>}
    </div>
  );
}
export function GstReturnsPage() {
  const t = useT('gst'); usePageTitle(t('ret.title')); const sp = useSearch(); const session = useSession(); const [tab, setTab] = useState(sp.get('tab') ?? 'gst'); const [period, setPeriod] = useState(sp.get('period') ?? lastMonth());
  const tabs = [['gst', t('ret.tab')], ['tds', t('tds.tab')], ['calendar', t('cal.tab')]].filter(([k]) => k !== 'tds' || can(session.data, 'fin.tds_return.view'));
  return (
    <section aria-labelledby="ret-h" data-testid="gst-returns">
      <PageHeader id="ret-h" title={t('ret.title')} subtitle={t('ret.intro')} meta={<Link to="/finance/gst-reconciliation">{t('rec.title')}</Link>} />
      <Pills tabs={tabs} tab={tab} setTab={setTab} label={t('ret.title')} prefix="ret-tab" />
      {tab === 'gst' && <><div className="form-grid"><Field label={t('rec.period')} name="period" error={null}><input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} style={big} /></Field></div><GstReturns period={period} /></>}
      {tab === 'tds' && <Tds />}
      {tab === 'calendar' && <Calendar />}
    </section>
  );
}
