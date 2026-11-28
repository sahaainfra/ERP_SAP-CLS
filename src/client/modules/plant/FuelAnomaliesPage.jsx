import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { ANOM_TONE, fmtDate, fmtQty, fmtRs, fu, pl } from './api.js';
import { useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Fuel anomalies (part 17.04, FR-05): what the detection rules raised. The plant manager explains an anomaly; the plant supervisor and then the project manager accept the explanation; or the project manager confirms a loss after investigation.
const REASONS = ['METER_FAULT', 'HEAVY_DUTY', 'SPARE_CAN', 'LEAK_FIXED', 'MEASUREMENT', 'LOG_LATE', 'OTHER'];
function Anomaly({ id }) {
  const t = useT('plant'); const q = useQuery({ queryKey: ['plant', 'fuel-anomaly', id], queryFn: () => fu.anomaly(id), retry: false }); const hq = useQuery({ queryKey: ['plant', 'fuel-anomaly-history', id, q.data?.status], queryFn: () => fu.anomalyHistory(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [reason, setReason] = useState('HEAVY_DUTY'); const [text, setText] = useState(''); const [comment, setComment] = useState(''); usePageTitle(t('f.anomalyDetail'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('f.anomalyDetail')} permission="plant.fuel.report" />; if (q.isPending) return <Skeleton label={t('f.anomalyDetail')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => pl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const confirm = () => { const why = globalThis.prompt(t('f.confirmPrompt')); if (why && why.length >= 5) run(() => fu.anomalyAct(x.id, 'confirm', { note: why }), t('f.confirmed')); };
  const kv = (k, v) => <div><dt>{t(k)}</dt><dd>{v ?? '—'}</dd></div>;
  return (
    <div data-testid="fa-object" data-status={x.status}><PageHeader id="fa-h" title={<>{x.docNo} <StatusBadge status={ANOM_TONE[x.status]} label={t(`f.as.${x.status}`)} /></>} meta={<><Link to="/plant/fuel-anomalies">{t('f.anomaliesTitle')}</Link> · {x.assetCode ?? x.tank} · {t(`f.rule.${x.rule}`)} · {x.project}{x.site ? `/${x.site}` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="fa-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="fa-note">{note}</p>}
      {x.reviewComment && <p className="mdm-banner" role="alert" data-testid="fa-returned">{t('f.returnedWith', { c: x.reviewComment })}</p>}
      <dl className="kv" data-testid="fa-details">{kv('f.severity', t(`f.sev.${x.severity}`))}{kv('f.detected', fmtDate(x.detectedOn))}{kv('f.age', x.ageDays)}{kv('f.litresAtRisk', fmtQty(x.litresAtRisk))}{x.valueAtRisk != null && kv('f.valueAtRisk', fmtRs(x.valueAtRisk))}{x.issueId && <div><dt>{t('f.issue')}</dt><dd><Link to={`/plant/fuel-issues?id=${x.issueId}`}>{t('f.openIssue')}</Link></dd></div>}{x.reasonLabel && kv('f.reason', x.reasonLabel)}{x.explanation && kv('f.explanation', x.explanation)}{x.explainedBy && kv('f.explainedBy', x.explainedBy)}{x.confirmNote && kv('f.confirmNote', x.confirmNote)}</dl>
      <ul data-testid="fa-evidence">{Object.entries(x.details).map(([k, v]) => <li key={k}>{k}: {String(v)}</li>)}</ul>
      {can.explain && <div className="mdm-panel no-print" data-testid="fa-explain"><h2>{t('f.explainTitle')}</h2><Field label={t('f.reason')} name="reasonCode" error={error}><select value={reason} onChange={(ev) => setReason(ev.target.value)} style={{ minHeight: 'var(--erp-target-min)' }} data-testid="fa-reason">{REASONS.map((k) => <option key={k} value={k}>{t(`f.ar.${k}`)}</option>)}</select></Field>
        <Field label={t('f.explanation')} name="explanation" error={error}><textarea value={text} onChange={(ev) => setText(ev.target.value)} rows={3} maxLength={500} style={{ width: '100%' }} data-testid="fa-text" /></Field>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => run(() => fu.anomalyAct(x.id, 'explain', { reasonCode: reason, explanation: text }), t('f.explained'))} data-testid="fa-send">{t('f.sendExplanation')}</button>{can.confirm && <button type="button" className="btn" onClick={confirm} data-testid="fa-confirm">{t('f.confirmLoss')}</button>}</div></div>}
      {!can.explain && can.confirm && <div className="actions-row no-print"><button type="button" className="btn" onClick={confirm} data-testid="fa-confirm">{t('f.confirmLoss')}</button></div>}
      {x.approve && x.taskId && <div className="mdm-panel no-print" data-testid="fa-decide"><h2>{t('decision')}</h2><label>{t('comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: '100%' }} /></label><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 'var(--erp-target-large)' }} disabled={busy} onClick={() => decide('approve')} data-testid="fa-approve">{t('f.accept')}</button><button type="button" className="btn" disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      {hq.data && <div className="table-scroll" data-testid="fa-history"><table className="data-table"><caption>{t('approvals')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('event')}</th><th>{t('comment')}</th></tr></thead><tbody>{[...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, c: a.comment })), ...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, c: a.reason }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((r, i) => <tr key={i}><td>{fmtDate(String(r.at).slice(0, 10))}</td><td>{r.who}</td><td>{r.what}</td><td>{r.c ?? ''}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
export default function FuelAnomaliesPage() {
  const t = useT('plant'); usePageTitle(t('f.anomaliesTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const sq = useQuery({ queryKey: ['plant', 'fuel-anomaly-summary'], queryFn: fu.anomalySummary, retry: false, enabled: !id });
  if (id) return <section aria-labelledby="fa-h"><Anomaly id={id} /></section>;
  if (sq.error?.status === 403) return <NoPermission what={t('f.anomaliesTitle')} permission="plant.fuel.report" />;
  return (
    <section aria-labelledby="fal-h" data-testid="plant-fuel-anomalies"><PageHeader id="fal-h" title={t('f.anomaliesTitle')} subtitle={t('f.anomaliesIntro')} />
      {sq.data && <p data-testid="fa-summary">{t('f.summary', { open: sq.data.open, waiting: sq.data.waiting, high: sq.data.high })}</p>}
      <div className="actions-row no-print"><Link to="/plant/fuel-reports">{t('f.reportsTitle')}</Link><Link to="/plant/fuel-issues">{t('f.issuesTitle')}</Link></div>
      <ListReport listCode="plant.fuel_anomalies" endpoint="/plant/fuel/anomalies" exportEndpoint="/ui/lists/plant.fuel_anomalies/export" title={t('f.anomaliesTitle')} session={session.data} rowHref={(r) => `/plant/fuel-anomalies?id=${r.id}`} onOpen={(r) => navigateTo(`/plant/fuel-anomalies?id=${r.id}`)} cardFields={['docNo', 'rule', 'assetCode', 'status']} statusKey="status" dateKey="detected" empty={{ title: t('f.anomaliesEmptyTitle'), text: t('f.anomaliesEmptyBody') }} />
    </section>
  );
}
