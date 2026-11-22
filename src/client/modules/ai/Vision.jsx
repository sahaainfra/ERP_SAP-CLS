import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';

// Part 28.05: Vision Suggestions (worklist, UI v3 §3.1). Site photographs analysed on upload; each suggestion is drawn as a box with its
// confidence and is only a suggestion: a person confirms it into a safety observation or an NCR, notes a progress cue, or marks it wrong.
// Faces and people are shown blurred; nobody is identified and nothing is used for discipline (BR-01).

const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/ai/vision${p.toString() ? `?${p}` : ''}`);
};
const SLA_TONE = { ON_TIME: 'APPROVED', DUE_SOON: 'AT_RISK', OVERDUE: 'REJECTED' };
const ST_TONE = { PENDING: 'IN_REVIEW', REVIEWED: 'APPROVED', NO_FINDINGS: 'DRAFT', FAILED: 'REJECTED' };
const L_TONE = { PENDING: 'AT_RISK', CONFIRMED: 'APPROVED', FALSE_POSITIVE: 'CANCELLED', INFO: 'DRAFT' };
const pct = (v) => `${Math.round(Number(v) * 100)}%`;
const fmtNum = (number, v, d = 1) => number(typeof v === 'number' && !Number.isInteger(v) ? String(v) : v, { decimals: d });

function Suggestion({ s, r, t, onDone }) {
  const [mode, setMode] = useState(null);
  const [text, setText] = useState('');
  const confirm = useMutation({ mutationFn: (body) => write(`/ai/vision/${r.id}/labels/${s.index}/confirm`, body), onSuccess: onDone });
  const wrong = useMutation({ mutationFn: (body) => write(`/ai/vision/${r.id}/labels/${s.index}/false-positive`, body), onSuccess: onDone });
  return <li className="cv-sug" data-testid="cv-sug" data-label={s.label}>
    <div className="actions-row"><strong>{t(`l.${s.label}`)}{s.detail ? ` · ${s.detail}` : ''}</strong>
      <StatusBadge status={L_TONE[s.status]} label={s.status === 'INFO' ? t(`g.${s.group}`) : t(`ls.${s.status}`)} size="sm" /><span className="muted small">{t('sure', { pct: pct(s.confidence) })}</span></div>
    {s.created && <p className="small"><Link to={s.created.route}>{s.created.label}</Link></p>}
    {s.reason && <p className="muted small">{t('why', { reason: s.reason })}</p>}
    {s.status === 'PENDING' && r.can.review && !mode && <div className="actions-row cv-actions">
      <button type="button" className="btn btn-primary" onClick={() => setMode('confirm')} data-testid="cv-confirm">{t(`do.${s.action}`)}</button>
      <button type="button" className="btn" onClick={() => setMode('wrong')} data-testid="cv-wrong">{t('notRight')}</button>
    </div>}
    {mode === 'confirm' && <form onSubmit={(e) => { e.preventDefault(); confirm.mutate({ rowVersion: r.rowVersion, ...(text.trim().length >= 5 ? { description: text.trim() } : {}) }); }}>
      {s.action !== 'NOTE' && <Field name={`cv-desc-${s.index}`} label={t('describe')} hint={t(`hint.${s.action}`)}><textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
      <div className="actions-row cv-actions"><button type="submit" className="btn btn-primary" disabled={confirm.isPending} data-testid="cv-confirm-go">{t(`go.${s.action}`)}</button><button type="button" className="btn" onClick={() => setMode(null)}>{t('cancel')}</button></div>
      {confirm.error && <ErrorState error={confirm.error} />}
    </form>}
    {mode === 'wrong' && <form onSubmit={(e) => { e.preventDefault(); wrong.mutate({ reason: text, rowVersion: r.rowVersion }); }}>
      <Field name={`cv-why-${s.index}`} label={`${t('whatWrong')} *`}><input required minLength={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <div className="actions-row cv-actions"><button type="submit" className="btn btn-primary" disabled={wrong.isPending || text.trim().length < 3} data-testid="cv-wrong-go">{t('markWrong')}</button><button type="button" className="btn" onClick={() => setMode(null)}>{t('cancel')}</button></div>
      {wrong.error && <ErrorState error={wrong.error} />}
    </form>}
  </li>;
}

function Detail({ id }) {
  const t = useT('cv');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['cv', 'one', id], queryFn: () => read(`/ai/vision/${id}`), retry: false });
  const done = () => cache.invalidateQueries({ queryKey: ['cv'] });
  if (q.isPending) return <Skeleton label={t('detail')} rows={6} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const r = q.data;
  const shown = r.labels.filter((l) => l.group !== 'PRIVACY');
  return <Card title={r.fileName} subtitle={`${r.docNo} · ${r.model} · ${dateTime(r.analysedAt)}`} testid="cv-detail" menu={<button type="button" className="btn" onClick={() => go({ id: '' })}>{t('back')}</button>}>
    <div className="actions-row"><StatusBadge status={ST_TONE[r.status]} label={t(`st.${r.status}`)} />{r.sla && <StatusBadge status={SLA_TONE[r.sla]} label={t(`sla.${r.sla}`, { h: r.ageHours })} size="sm" />}{r.blurred && <StatusBadge status="APPROVED" label={t('blurred')} size="sm" />}</div>
    {r.reason && <p className="muted" role="status">{r.reason}</p>}
    <div className="cv-split">
      <figure className="cv-figure" data-testid="cv-figure">
        {r.image ? <img src={r.image} alt={t('photoAlt', { name: r.fileName })} /> : <p className="muted">{t('noImage')}</p>}
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">{shown.map((l) => <rect key={l.index} x={l.box[0]} y={l.box[1]} width={l.box[2]} height={l.box[3]} className={`cv-box cv-box-${l.group.toLowerCase()}`} vectorEffect="non-scaling-stroke" />)}</svg>
        <figcaption className="muted small">{t('caption')}</figcaption>
      </figure>
      <section aria-label={t('suggestions')}>
        {shown.length ? <ul className="cv-sugs">{shown.map((s) => <Suggestion key={s.index} s={s} r={r} t={t} onDone={done} />)}</ul> : <EmptyState compact title={t('nothing')} message={t('nothingBody')} />}
        <p className="muted small">{t('privacy')}</p>
      </section>
    </div>
  </Card>;
}

function Queue({ status }) {
  const t = useT('cv');
  const { number, dateTime } = useFormat();
  const q = useQuery({ queryKey: ['cv', 'list', status], queryFn: () => read(`/ai/vision?status=${status}`), retry: false });
  if (q.isPending) return <Skeleton label={t('title')} rows={6} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data;
  return <>
    <KpiRow testid="cv-tiles" label={t('title')}>
      <KpiTile label={t('toReview')} value={number(d.counts.PENDING ?? 0)} tone={d.counts.PENDING ? 'warning' : 'success'} to="/ai/vision">{t('oldestFirst')}</KpiTile>
      <KpiTile label={t('reviewed')} value={number(d.counts.REVIEWED ?? 0)} to="/ai/vision?status=REVIEWED" />
      <KpiTile label={t('noFindings')} value={number(d.counts.NO_FINDINGS ?? 0)} to="/ai/vision?status=NO_FINDINGS" />
    </KpiRow>
    <div className="toolbar"><Field name="cv-status" label={t('status')}><select value={status} onChange={(e) => go({ status: e.target.value === 'PENDING' ? '' : e.target.value })}>{['PENDING', 'REVIEWED', 'NO_FINDINGS', 'FAILED', 'ALL'].map((s) => <option key={s} value={s}>{t(`f.${s}`)}</option>)}</select></Field>
      <p className="muted small">{t('detector', { d: d.detector })}</p></div>
    {!d.rows.length ? <EmptyState title={t('empty')} message={t('emptyBody')} action={<Link to="/site/dpr-entry">{t('toDpr')}</Link>} /> :
      <Card title={t('queue')} count={{ shown: d.rows.length, total: d.total }} testid="cv-card-queue">
        <div className="table-scroll"><table className="data-table" data-testid="cv-queue">
          <thead><tr><th>{t('photo')}</th><th>{t('waiting')}</th><th className="num">{t('pending')}</th><th>{t('found')}</th><th>{t('status')}</th><th>{t('analysed')}</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.id} data-testid="cv-row">
            <td data-label={t('photo')}><Link to={`/ai/vision?id=${r.id}`}>{r.fileName}</Link><div className="muted small">{r.docNo} · {t(`src.${r.source}`)}</div></td>
            <td data-label={t('waiting')}>{r.sla ? <StatusBadge status={SLA_TONE[r.sla]} label={t(`sla.${r.sla}`, { h: r.ageHours })} size="sm" /> : '—'}</td>
            <td data-label={t('pending')} className="num">{number(r.pending)}</td>
            <td data-label={t('found')}>{r.labels.filter((l) => l.group !== 'PRIVACY').map((l) => t(`l.${l.label}`)).join(', ') || '—'}</td>
            <td data-label={t('status')}><StatusBadge status={ST_TONE[r.status]} label={t(`st.${r.status}`)} size="sm" /></td>
            <td data-label={t('analysed')}>{dateTime(r.analysedAt)}</td>
          </tr>)}</tbody>
        </table></div>
      </Card>}
  </>;
}

function Performance() {
  const t = useT('cv');
  const { number } = useFormat();
  const q = useQuery({ queryKey: ['cv', 'perf'], queryFn: () => read('/ai/vision/performance'), retry: false });
  if (q.isPending) return <Skeleton label={t('tab.performance')} rows={4} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data.length) return <EmptyState title={t('noPerf')} message={t('noPerfBody')} />;
  return <Card title={t('tab.performance')} subtitle={t('perfSub')} testid="cv-card-perf">
    <div className="table-scroll"><table className="data-table" data-testid="cv-perf">
      <thead><tr><th>{t('model')}</th><th>{t('label')}</th><th className="num">{t('suggested')}</th><th className="num">{t('confirmed')}</th><th className="num">{t('wrong')}</th><th className="num">{t('precision')}</th><th className="num">{t('avgConf')}</th></tr></thead>
      <tbody>{q.data.map((p) => <tr key={`${p.model}-${p.label}`}><td data-label={t('model')}>{p.model}</td><td data-label={t('label')}>{t(`l.${p.label}`)}</td><td data-label={t('suggested')} className="num">{number(p.suggested)}</td>
        <td data-label={t('confirmed')} className="num">{number(p.confirmed)}</td><td data-label={t('wrong')} className="num">{number(p.falsePositive)}</td>
        <td data-label={t('precision')} className="num">{p.precisionPct == null ? '—' : `${fmtNum(number, p.precisionPct)}%`}</td><td data-label={t('avgConf')} className="num">{p.avgConfidence == null ? '—' : pct(p.avgConfidence)}</td></tr>)}</tbody>
    </table></div>
  </Card>;
}

export function VisionPage() {
  const t = useT('cv');
  const search = useSearch();
  usePageTitle(t('title'));
  const id = search.get('id');
  const tab = search.get('tab') === 'performance' ? 'performance' : 'queue';
  const status = search.get('status') ?? 'PENDING';
  return <section aria-labelledby="cv-h" data-testid="cv-page">
    <PageHeader id="cv-h" title={t('title')} subtitle={t('subtitle')} />
    {id ? <Detail id={id} /> : <>
      <div role="tablist" aria-label={t('title')} className="tabs" data-testid="cv-tabs">{['queue', 'performance'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'queue' ? '' : k, status: '' })}>{t(`tab.${k}`)}</button>)}</div>
      {tab === 'queue' ? <Queue status={status} /> : <Performance />}
    </>}
  </section>;
}
