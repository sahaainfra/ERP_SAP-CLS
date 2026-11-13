import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { FUEL_TONE, fmtDate, fmtQty, fmtRs, fu, pl } from './api.js';
import { ExportButton, useRunner } from './PlantParts.jsx';

// Fuel issues (part 17.04): the list of issues and the issue with its meter, consumption against the norm, flags, cost and history; the plant supervisor verifies it here (the maker never does).
function Issue({ id }) {
  const t = useT('plant'); const q = useQuery({ queryKey: ['plant', 'fuel-issue', id], queryFn: () => fu.issue(id), retry: false }); const hq = useQuery({ queryKey: ['plant', 'fuel-issue-history', id, q.data?.status], queryFn: () => fu.history(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); usePageTitle(t('f.issueDetail'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('f.issueDetail')} permission="plant.issue.view" />; if (q.isPending) return <Skeleton label={t('f.issueDetail')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const why = (action, msg) => { const r = globalThis.prompt(t('why')); if (r) run(() => fu.act(x.id, action, { reason: r }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => pl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const kv = (k, v) => <div><dt>{t(k)}</dt><dd>{v ?? '—'}</dd></div>;
  return (
    <div data-testid="fi-object" data-status={x.status}><h1 id="fis-h">{x.docNo} <StatusBadge status={FUEL_TONE[x.status]} label={t(`rs.${x.status}`)} /></h1><p><Link to="/plant/fuel-issues">{t('f.issuesTitle')}</Link> · <Link to={`/plant/equipment?id=${x.equipmentId}`}>{x.assetCode}</Link> · {x.tank} · {x.project}{x.site ? `/${x.site}` : ''}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="fis-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="fis-note">{note}</p>}
      {x.anomalies.length > 0 && <div className="mdm-banner" role="alert" data-testid="fis-flags"><strong>{t('f.flagged')}</strong><ul>{x.anomalies.map((a) => <li key={a.id}><Link to={`/plant/fuel-anomalies?id=${a.id}`}>{a.docNo}</Link> {a.label}</li>)}</ul></div>}
      <div className="actions-row no-print">{can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => fu.act(x.id, 'submit'), t('submitted'))} data-testid="fis-submit">{t('sendForApproval')}</button>}{can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}
        {can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('f.cancelled'))}>{t('cancel')}</button>}{can.amend && <button type="button" className="btn" onClick={() => why('amend', t('f.amended'))} data-testid="fis-amend">{t('amend')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => pl.exportFile({}, `${x.docNo}.pdf`, `/issues/${x.id}/print`).catch(() => setError({ form: t('exportFailed') }))}>{t('print')}</button>}</div>
      {x.approve && x.taskId && <div className="mdm-panel no-print" data-testid="fis-decide"><h2>{t('decision')}</h2><label>{t('comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: '100%' }} /></label><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="fis-approve">{t('approve')}</button><button type="button" className="btn" disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      <dl className="kv" data-testid="fis-details">{kv('f.when', x.issueAt.replace('T', ' '))}{kv('f.litres', fmtQty(x.litres))}{kv('f.meter', fmtQty(x.meterReading))}{kv('f.previousMeter', x.previousMeter == null ? null : fmtQty(x.previousMeter))}{kv('f.consumptionLabel', x.consumption == null ? null : `${fmtQty(x.consumption)} ${x.normUnit}`)}{kv('f.normLabel', x.norm == null ? null : `${fmtQty(x.norm)} ${x.normUnit}`)}{kv('f.deviation', x.deviationPct == null ? null : `${x.deviationPct}%`)}{kv('f.issuedBy', x.issuedBy)}{kv('f.receivedBy', x.receivedBy)}{x.cost != null && kv('f.cost', fmtRs(x.cost))}{x.noAdvanceReason && kv('f.noAdvance', x.noAdvanceReason)}</dl>
      {hq.data && <div className="table-scroll" data-testid="fis-history"><table className="data-table"><caption>{t('approvals')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('event')}</th><th>{t('comment')}</th></tr></thead><tbody>{[...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, c: a.comment })), ...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, c: a.reason }))].sort((a, b) => String(a.at).localeCompare(String(b.at))).map((r, i) => <tr key={i}><td>{fmtDate(String(r.at).slice(0, 10))}</td><td>{r.who}</td><td>{r.what}</td><td>{r.c ?? ''}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
export default function FuelIssuesPage() {
  const t = useT('plant'); usePageTitle(t('f.issuesTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="fis-h"><Issue id={id} /></section>;
  return (
    <section aria-labelledby="fil-h" data-testid="plant-fuel-issues"><h1 id="fil-h">{t('f.issuesTitle')}</h1><p className="muted">{t('f.issuesIntro')}</p>
      <div className="actions-row no-print"><Link to="/plant/fuel-issue">{t('f.issueTitle')}</Link><Link to="/plant/fuel-dip">{t('f.dipTitle')}</Link><Link to="/plant/fuel-tanks">{t('f.tanksTitle')}</Link><Link to="/plant/fuel-reports">{t('f.reportsTitle')}</Link><ExportButton query={{}} name="fuel-issues.csv" path="/issues/export" testId="fis-export" /></div>
      <ListReport listCode="plant.fuel_issues" endpoint="/plant/issues" title={t('f.issuesTitle')} session={session.data} rowHref={(r) => `/plant/fuel-issues?id=${r.id}`} onOpen={(r) => navigateTo(`/plant/fuel-issues?id=${r.id}`)} cardFields={['docNo', 'assetCode', 'litres', 'status']} statusKey="status" dateKey="date" empty={{ title: t('f.issuesEmptyTitle'), text: t('f.issuesEmptyBody') }} />
    </section>
  );
}
