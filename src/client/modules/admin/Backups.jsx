import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 29.06: Backup & DR status (overview page, UI v3 §3.4): the health checks with their alerts, the backups, the restore tests and
// quarterly drills with their reports, and production restores approved by ITADM then DIR.

const read = async (path) => (await api.get(path)).data;
const send = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/admin/backups${p.toString() ? `?${p}` : ''}`);
};
const BT = { VERIFIED: 'APPROVED', FAILED: 'REJECTED', RUNNING: 'IN_REVIEW', EXPIRED: 'CANCELLED' };
const TT = { PASSED: 'APPROVED', FAILED: 'REJECTED', RUNNING: 'IN_REVIEW' };
const RQ = { SUBMITTED: 'IN_REVIEW', APPROVED: 'APPROVED', REJECTED: 'REJECTED', EXECUTED: 'COMPLETED' };
const mb = (b) => (b == null ? '—' : `${(b / 1048576).toFixed(1)} MB`);

function Status({ s }) {
  const t = useT('bkp');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const run = useMutation({ mutationFn: (type) => send('/admin/backups', { type }), onSuccess: () => cache.invalidateQueries({ queryKey: ['bkp'] }) });
  const drill = useMutation({ mutationFn: () => send('/admin/backups/tests', { kind: 'DRILL', note: 'Drill from the status page' }), onSuccess: () => cache.invalidateQueries({ queryKey: ['bkp'] }) });
  const mon = useMutation({ mutationFn: () => send('/admin/backups/monitor', {}), onSuccess: () => cache.invalidateQueries({ queryKey: ['bkp'] }) });
  const h = Object.fromEntries(s.health.map((x) => [x.code, x]));
  return <>
    {!s.healthy && <p role="alert" className="bkp-banner" data-testid="bkp-unhealthy">{t('unhealthy')}</p>}
    <KpiRow testid="bkp-tiles" label={t('tab.status')}>
      <KpiTile testid="bkp-k-full" kind="time" label={t('k.full')} value={h.full.value ? dateTime(h.full.value) : t('never')} tone={h.full.ok ? 'success' : 'error'}>{h.full.message}</KpiTile>
      <KpiTile testid="bkp-k-rpo" kind="time" label={t('k.rpo', { n: s.targets.rpoMinutes })} value={h.rpo.value ? dateTime(h.rpo.value) : t('never')} tone={h.rpo.ok ? 'success' : 'error'}>{h.rpo.message}</KpiTile>
      <KpiTile testid="bkp-k-offsite" label={t('k.offsite')} value={h.offsite.ok ? t('ok') : t('missing')} tone={h.offsite.ok ? 'success' : 'error'}>{h.offsite.message}</KpiTile>
      <KpiTile testid="bkp-k-drill" kind="time" label={t('k.drill', { n: s.targets.rtoMinutes })} value={s.lastDrill ? t(`ts.${s.lastDrill.status}`) : t('never')} tone={h.drill.ok ? 'success' : 'warning'} to="/admin/backups?tab=tests">{h.drill.message}</KpiTile>
    </KpiRow>
    {(run.error || drill.error || mon.error) && <ErrorState error={run.error ?? drill.error ?? mon.error} />}
    {s.canRun && <div className="actions-row bkp-actions">
      <button type="button" className="btn btn-primary" disabled={run.isPending} onClick={() => run.mutate('FULL')} data-testid="bkp-full">{t('backupNow')}</button>
      <button type="button" className="btn" disabled={run.isPending} onClick={() => run.mutate('SNAPSHOT')}>{t('snapshotNow')}</button>
      <button type="button" className="btn" disabled={drill.isPending} onClick={() => drill.mutate()} data-testid="bkp-drill">{t('runDrill')}</button>
      <button type="button" className="btn" disabled={mon.isPending} onClick={() => mon.mutate()}>{t('checkNow')}</button>
    </div>}
    {run.data && <p className="small" role="status" data-testid="bkp-result">{t('took', { name: run.data.data.name, status: t(`bs.${run.data.data.status}`) })}</p>}
    {drill.data && <p className="small" role="status" data-testid="bkp-drill-result">{t('drillResult', { status: t(`ts.${drill.data.data.status}`), rto: Number(drill.data.data.restoreMinutes).toFixed(2), rpo: Number(drill.data.data.dataLossMinutes).toFixed(1) })}</p>}
    <Card title={t('alerts')} testid="bkp-alerts">{!s.alerts.length ? <p className="muted">{t('noAlerts')}</p> : <ul className="bkp-list">{s.alerts.map((a) => <li key={a.id} className="small bkp-problem">{t(`c.${a.check}`)}: {a.message} · {dateTime(a.firedAt)}</li>)}</ul>}</Card>
    <Card title={t('policy')} testid="bkp-policy">
      <p className="small">{t('retention', { d: s.retention.daily, w: s.retention.weekly, m: s.retention.monthly, y: s.retention.yearly, h: s.retention.snapshotHours })}</p>
      <p className="small">{t('targets', { rpo: s.targets.rpoMinutes, rto: s.targets.rtoMinutes, days: s.targets.drillDays })}</p>
      <p className="small">{t('where', { local: s.locations.local, offsite: s.locations.offsite })} {s.locations.keyConfigured ? t('keyOk') : t('keyDev')}</p>
    </Card>
  </>;
}

function Backups() {
  const t = useT('bkp');
  const { dateTime, number } = useFormat();
  const search = useSearch();
  const type = search.get('type') ?? '';
  const q = useQuery({ queryKey: ['bkp', 'list', type], queryFn: () => read(`/admin/backups${type ? `?type=${type}` : ''}`), retry: false });
  return <>
    <div className="toolbar"><Field name="bkp-type" label={t('type')}><select value={type} onChange={(e) => go({ type: e.target.value })}><option value="">{t('all')}</option><option value="FULL">{t('bt.FULL')}</option><option value="SNAPSHOT">{t('bt.SNAPSHOT')}</option></select></Field></div>
    {q.isPending ? <Skeleton label={t('tab.backups')} rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length ? <EmptyState title={t('noBackups')} message={t('noBackupsBody')} /> :
      <Card title={t('tab.backups')} count={{ shown: q.data.rows.length, total: q.data.total }} testid="bkp-backups">
        <ul className="bkp-cards">{q.data.rows.map((b) => <li key={b.id} className="bkp-card" data-testid="bkp-backup">
          <div className="actions-row"><strong>{b.name}</strong><StatusBadge status={BT[b.status]} label={t(`bs.${b.status}`)} size="sm" /></div>
          <p className="muted small">{t(`bt.${b.type}`)} · {dateTime(b.finishedAt ?? b.startedAt)} · {mb(b.sizeBytes)} · {t('rows', { n: number(b.rows ?? 0, { decimals: 0 }), t: number(b.tables ?? 0, { decimals: 0 }) })}</p>
          <p className="small">{b.encrypted ? t('encrypted') : ''}{b.offsite ? ` · ${t('offsiteCopy')}` : ''}{b.tiers.length ? ` · ${b.tiers.map((x) => t(`tier.${x}`)).join(', ')}` : ''}{b.files ? ` · ${t('filesRep', { c: b.files.copied, p: b.files.present })}` : ''}</p>
          {b.error && <p className="small bkp-problem">{b.error}</p>}
        </li>)}</ul>
      </Card>}
  </>;
}

function Tests({ s }) {
  const t = useT('bkp');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const search = useSearch();
  const kind = search.get('kind') ?? '';
  const q = useQuery({ queryKey: ['bkp', 'tests', kind], queryFn: () => read(`/admin/backups/tests${kind ? `?kind=${kind}` : ''}`), retry: false });
  const run = useMutation({ mutationFn: (k) => send('/admin/backups/tests', { kind: k }), onSuccess: () => cache.invalidateQueries({ queryKey: ['bkp'] }) });
  const rep = useMutation({ mutationFn: (x) => downloadReport(`/api/v1/admin/backups/tests/${x.id}/report?format=pdf`, `restore-test-${x.id}.pdf`) });
  return <>
    <div className="toolbar">
      <Field name="bkp-kind" label={t('kind')}><select value={kind} onChange={(e) => go({ kind: e.target.value })}><option value="">{t('all')}</option><option value="TEST">{t('tk.TEST')}</option><option value="DRILL">{t('tk.DRILL')}</option></select></Field>
      {s.canRun && <><button type="button" className="btn" disabled={run.isPending} onClick={() => run.mutate('TEST')} data-testid="bkp-test">{t('runTest')}</button><button type="button" className="btn" disabled={run.isPending} onClick={() => run.mutate('DRILL')}>{t('runDrill')}</button></>}
    </div>
    {(run.error || rep.error) && <ErrorState error={run.error ?? rep.error} />}
    {q.isPending ? <Skeleton label={t('tab.tests')} rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length ? <EmptyState title={t('noTests')} message={t('noTestsBody')} /> :
      <Card title={t('tab.tests')} count={{ shown: q.data.rows.length, total: q.data.total }} testid="bkp-tests">
        <ul className="bkp-cards">{q.data.rows.map((x) => <li key={x.id} className="bkp-card" data-testid="bkp-testrow">
          <div className="actions-row"><strong>{t(`tk.${x.kind}`)} #{x.id}</strong><StatusBadge status={TT[x.status]} label={t(`ts.${x.status}`)} size="sm" /></div>
          <p className="muted small">{x.backup} · {dateTime(x.startedAt)} · {x.by}</p>
          <p className="small">{t('measured', { rto: Number(x.restoreMinutes ?? 0).toFixed(2), rtoT: x.rtoTarget, rpo: Number(x.dataLossMinutes ?? 0).toFixed(1), rpoT: x.rpoTarget })}</p>
          <ul className="bkp-checks">{x.checks.map((c) => <li key={c.check} className={`small${c.ok ? '' : ' bkp-problem'}`}>{c.ok ? '✓' : '✗'} {c.check}: {c.detail}</li>)}</ul>
          <button type="button" className="btn" disabled={rep.isPending} onClick={() => rep.mutate(x)}>{t('report')}</button>
        </li>)}</ul>
      </Card>}
  </>;
}

function Restores({ s }) {
  const t = useT('bkp');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const list = useQuery({ queryKey: ['bkp', 'list', 'VERIFIED'], queryFn: () => read('/admin/backups?status=VERIFIED'), retry: false });
  const [f, setF] = useState({ backupId: '', incidentRef: '', incident: '' });
  const [comment, setComment] = useState({});
  const req = useMutation({ mutationFn: () => send('/admin/backups/restores', { backupId: Number(f.backupId), incidentRef: f.incidentRef.trim(), incident: f.incident.trim() }), onSuccess: () => cache.invalidateQueries({ queryKey: ['bkp'] }) });
  const act = useMutation({ mutationFn: ({ r, action }) => send(`/admin/backups/restores/${r.id}/act`, { action, comment: comment[r.id] || undefined }), onSuccess: () => cache.invalidateQueries({ queryKey: ['bkp'] }) });
  return <>
    <p className="small muted">{t('restoreRule')}</p>
    {s.canRequest && <Card title={t('requestRestore')} testid="bkp-request">
      <form className="bkp-form" onSubmit={(e) => { e.preventDefault(); req.mutate(); }}>
        <Field name="bkp-r-backup" label={t('backup')}><select value={f.backupId} onChange={(e) => setF({ ...f, backupId: e.target.value })} required><option value="">{t('choose')}</option>{(list.data?.rows ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field name="bkp-r-ref" label={t('incidentRef')}><input value={f.incidentRef} onChange={(e) => setF({ ...f, incidentRef: e.target.value })} required minLength={3} maxLength={60} /></Field>
        <Field name="bkp-r-inc" label={t('incident')}><input value={f.incident} onChange={(e) => setF({ ...f, incident: e.target.value })} required minLength={5} maxLength={500} /></Field>
        <button type="submit" className="btn btn-primary" disabled={req.isPending}>{t('send')}</button>
      </form>
    </Card>}
    {(req.error || act.error) && <ErrorState error={req.error ?? act.error} />}
    {!s.requests.length ? <EmptyState title={t('noRequests')} message={t('noRequestsBody')} /> : <ul className="bkp-cards" data-testid="bkp-requests">{s.requests.map((r) => <li key={r.id} className="bkp-card">
      <div className="actions-row"><strong>{r.incidentRef} · {r.backup}</strong><StatusBadge status={RQ[r.status]} label={t(`rs.${r.status}`)} size="sm" /></div>
      <p className="small">{r.incident}</p><p className="muted small">{r.by}{r.approvedBy ? ` · ${t('approvedBy', { who: r.approvedBy })}` : ''}{r.executedAt ? ` · ${t('executed', { at: dateTime(r.executedAt), who: r.executedBy })}` : ''}</p>
      {r.command && <p className="small">{t('operator')} <code className="bkp-code">{r.command}</code></p>}
      {r.canDecide && <div className="bkp-form"><Field name={`bkp-c-${r.id}`} label={t('comment')}><input value={comment[r.id] ?? ''} onChange={(e) => setComment({ ...comment, [r.id]: e.target.value })} /></Field>
        <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ r, action: 'approve' })}>{t('approve')}</button>
        <button type="button" className="btn" disabled={act.isPending || (comment[r.id] ?? '').trim().length < 5} onClick={() => act.mutate({ r, action: 'reject' })}>{t('reject')}</button></div>}
    </li>)}</ul>}
  </>;
}

export function BackupDr() {
  const t = useT('bkp');
  const search = useSearch();
  usePageTitle(t('title'));
  const q = useQuery({ queryKey: ['bkp', 'status'], queryFn: () => read('/admin/backups/status'), retry: false });
  const tabs = ['status', 'backups', 'tests', 'restores'];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'status';
  return <section aria-labelledby="bkp-h" data-testid="bkp-page">
    <PageHeader id="bkp-h" title={t('title')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="bkp-tabs">{tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'status' ? '' : k, type: '', kind: '' })}>{t(`tab.${k}`)}</button>)}</div>
    {q.isPending ? <Skeleton label={t('title')} rows={6} /> : q.error?.status === 403 ? <NoPermission message={q.error.message} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : <>
      {tab === 'status' && <Status s={q.data} />}
      {tab === 'backups' && <Backups />}
      {tab === 'tests' && <Tests s={q.data} />}
      {tab === 'restores' && <Restores s={q.data} />}
    </>}
  </section>;
}
