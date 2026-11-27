import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { LOG_TONE, fmtDate, fmtQty, fmtRs, lg, pl } from './api.js';
import { ExportButton, useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Equipment log books (part 17.03): the list of logs and of breakdowns, the log with its readings, flags, cost and history, and the report of a breakdown.
const CATS = ['MECHANICAL', 'HYDRAULIC', 'ELECTRICAL', 'TYRE', 'ACCIDENT', 'OTHER'];
function Log({ id }) {
  const t = useT('plant'); const q = useQuery({ queryKey: ['plant', 'log', id], queryFn: () => lg.log(id), retry: false }); const hq = useQuery({ queryKey: ['plant', 'log-history', id, q.data?.status], queryFn: () => lg.history(id), enabled: q.isSuccess, retry: false });
  const { error, setError, note, busy, run } = useRunner(); const [comment, setComment] = useState(''); usePageTitle(t('l.logTitle'));
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('l.logTitle')} permission="plant.log.view" />; if (q.isPending) return <Skeleton label={t('l.logTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const can = x.can; const why = (action, msg) => { const r = globalThis.prompt(t('why')); if (r) run(() => lg.act(x.id, action, { reason: r }), msg); };
  const decide = (action) => { if (action !== 'approve' && comment.trim().length < 5) { setError({ form: t('sayWhy') }); return; } run(() => pl.decide(x.taskId, action, comment.trim() || null), t(`done.${action}`)); };
  const kv = (k, v) => <div><dt>{t(k)}</dt><dd>{v ?? '—'}</dd></div>;
  return (
    <div data-testid="lg-object" data-status={x.status}><PageHeader id="lg-h" title={<>{x.docNo} <StatusBadge status={LOG_TONE[x.status]} label={t(`rs.${x.status}`)} /></>} meta={<><Link to="/plant/logs">{t('l.logsTitle')}</Link> · <Link to={`/plant/equipment?id=${x.equipmentId}`}>{x.assetCode}</Link> · {fmtDate(x.date)} · {x.shiftLabel} · {x.project}{x.site ? `/${x.site}` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="lg-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="lg-note">{note}</p>}
      {x.anomalies.length > 0 && <div className="mdm-banner" role="alert" data-testid="lg-flags"><strong>{t('l.flagged')}</strong><ul>{x.anomalies.map((a) => <li key={a.code}>{a.message}</li>)}</ul>{x.anomalyNote && <p data-testid="lg-explanation">{t('l.explanation')}: {x.anomalyNote}</p>}</div>}
      {x.status === 'APPROVED' && !x.useRecorded && x.useNote && <p className="mdm-banner" role="alert" data-testid="lg-usenote">{t('l.useNote', { n: x.useNote })}</p>}
      <div className="actions-row no-print">{can.submit && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => lg.act(x.id, 'submit'), t('submitted'))} data-testid="lg-submit">{t('sendForApproval')}</button>}{can.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('withdrawn'))}>{t('withdraw')}</button>}{can.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('cancelled'))}>{t('cancel')}</button>}{can.amend && <button type="button" className="btn" onClick={() => why('amend', t('amended'))} data-testid="lg-amend">{t('amend')}</button>}
        {can.print && <button type="button" className="btn" onClick={() => pl.exportFile({}, `${x.docNo}.pdf`, `/logs/${x.id}/print`).catch(() => setError({ form: t('exportFailed') }))}>{t('print')}</button>}</div>
      {x.approve && x.taskId && <div className="mdm-panel no-print" data-testid="lg-decide"><h2>{t('decision')}</h2><label>{t('comment')}<textarea value={comment} onChange={(ev) => setComment(ev.target.value)} rows={2} style={{ width: '100%' }} /></label><div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('approve')} data-testid="lg-approve">{t('approve')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('return')}>{t('return')}</button><button type="button" className="btn" style={{ minHeight: 48 }} disabled={busy} onClick={() => decide('reject')}>{t('reject')}</button></div></div>}
      <dl className="kv" data-testid="lg-details">{kv('l.operator', x.operator)}{kv('l.startMeter', fmtQty(x.startMeter))}{kv('l.endMeter', fmtQty(x.endMeter))}{kv('l.meterRunLabel', fmtQty(x.meterRun))}{kv('l.working', fmtQty(x.workingHrs))}{kv('l.idle', `${fmtQty(x.idleHrs)}${x.idleReasonLabel ? ` (${x.idleReasonLabel})` : ''}`)}{kv('l.breakdown', fmtQty(x.breakdownHrs))}{kv('l.wa', x.wa)}{kv('a.activity', x.activity)}{kv('l.workQty', `${fmtQty(x.workQty)} ${x.workUom ?? ''}`)}{kv('l.fuel', fmtQty(x.fuelLitres))}{x.hire && kv('l.vendorRep', x.vendorSigned ? x.vendorRep : t('l.notSigned'))}{x.cost != null && kv('l.cost', fmtRs(x.cost))}{x.meterPhotoFileId && <div><dt>{t('l.meterPhoto')}</dt><dd><a href={`/api/v1/core/files/${x.meterPhotoFileId}/download`} target="_blank" rel="noreferrer">{t('open')}</a></dd></div>}</dl>
      {hq.data && <div className="table-scroll" data-testid="lg-history"><table className="data-table"><caption>{t('approvals')}</caption><thead><tr><th>{t('when')}</th><th>{t('who')}</th><th>{t('event')}</th><th>{t('comment')}</th></tr></thead><tbody>{[...hq.data.approvals.map((a) => ({ at: a.at, who: a.actor, what: `${a.event}${a.step_code ? ` (${a.step_code})` : ''}`, c: a.comment })), ...hq.data.audit.map((a) => ({ at: a.at, who: a.actor, what: a.action, c: a.reason }))].sort((p, q2) => String(p.at).localeCompare(String(q2.at))).map((h, i) => <tr key={i}><td>{String(h.at).slice(0, 16).replace('T', ' ')}</td><td>{h.who}</td><td>{h.what}</td><td>{h.c ?? ''}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
function Breakdowns({ t, session }) {
  const oq = useQuery({ queryKey: ['plant', 'log-options'], queryFn: () => lg.options({}), retry: false }); const { error, run, busy, note } = useRunner(); const [f, setF] = useState({ equipmentId: '', category: 'MECHANICAL', description: '' }); const [open, setOpen] = useState(false); const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const resolve = (b) => { const r = globalThis.prompt(t('l.resolvePrompt')); if (r && r.length >= 5) run(() => lg.resolve(b.id, { resolution: r }), t('l.resolved')); };
  return (
    <div data-testid="lg-breakdowns">{note && <p className="mdm-banner" role="status" data-testid="bd-note">{note}</p>}{error?.form && <p className="field-error" role="alert" data-testid="bd-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="actions-row no-print"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} onClick={() => setOpen(!open)} aria-expanded={open} data-testid="bd-open">{t('l.reportBreakdown')}</button></div>
      {open && <div className="mdm-panel" data-testid="bd-form"><div className="form-grid"><Field label={t('l.machine')} name="equipmentId" error={error}><select value={f.equipmentId} onChange={(ev) => set('equipmentId', ev.target.value)} style={{ minHeight: 48 }} data-testid="bd-equipment"><option value="">—</option>{(oq.data?.machines ?? []).map((m) => <option key={m.id} value={m.id}>{m.assetCode}</option>)}</select></Field>
        <Field label={t('l.category')} name="category" error={error}><select value={f.category} onChange={(ev) => set('category', ev.target.value)} style={{ minHeight: 48 }} data-testid="bd-category">{CATS.map((c) => <option key={c} value={c}>{t(`l.bc.${c}`)}</option>)}</select></Field></div>
        <Field label={t('l.whatHappened')} name="description" error={error}><textarea value={f.description} onChange={(ev) => set('description', ev.target.value)} rows={2} maxLength={500} style={{ width: '100%' }} data-testid="bd-description" /></Field>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !f.equipmentId} onClick={async () => { const d = await run(() => lg.report({ equipmentId: Number(f.equipmentId), category: f.category, description: f.description }), t('l.reported')); if (d) { setOpen(false); setF({ equipmentId: '', category: 'MECHANICAL', description: '' }); } }} data-testid="bd-go">{t('l.reportGo')}</button></div></div>}
      <ListReport listCode="plant.breakdowns" endpoint="/plant/breakdowns" exportEndpoint="/ui/lists/plant.breakdowns/export" title={t('l.breakdownsTitle')} session={session} rowHref={() => '/plant/logs?tab=breakdowns'} onOpen={(r) => { if (r.can?.resolve) resolve(r); }} cardFields={['docNo', 'assetCode', 'category', 'status']} statusKey="status" dateKey="reported" empty={{ title: t('l.bdEmptyTitle'), text: t('l.bdEmptyBody') }} /></div>
  );
}
export default function LogsPage() {
  const t = useT('plant'); usePageTitle(t('l.logsTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const [tab, setTab] = useState(sp.get('tab') === 'breakdowns' ? 'breakdowns' : 'logs');
  if (id) return <section aria-labelledby="lg-h"><Log id={id} /></section>;
  return (
    <section aria-labelledby="lgl-h" data-testid="plant-logs"><PageHeader id="lgl-h" title={t('l.logsTitle')} subtitle={t('l.logsIntro')} />
      <div className="actions-row no-print"><Link to="/plant/log-entry">{t('l.entryTitle')}</Link><Link to="/plant/log-verification">{t('l.verifyTitle')}</Link><Link to="/plant/utilisation">{t('l.utilTitle')}</Link><ExportButton query={{}} name="equipment-logs.csv" path="/logs/export" testId="lg-export" /></div>
      <div role="tablist" className="tabs no-print">{['logs', 'breakdowns'].map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn${tab === k ? ' btn-primary' : ''}`} style={{ minHeight: 44 }} onClick={() => setTab(k)} data-testid={`lg-tab-${k}`}>{t(`l.tab.${k}`)}</button>)}</div>
      {tab === 'breakdowns' ? <Breakdowns t={t} session={session.data} /> : <ListReport listCode="plant.logs" endpoint="/plant/logs" title={t('l.logsTitle')} session={session.data} rowHref={(r) => `/plant/logs?id=${r.id}`} onOpen={(r) => navigateTo(`/plant/logs?id=${r.id}`)} cardFields={['docNo', 'assetCode', 'date', 'status']} statusKey="status" dateKey="date" empty={{ title: t('l.logsEmptyTitle'), text: t('l.logsEmptyBody') }} />}
    </section>
  );
}
