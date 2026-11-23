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

// Part 29.07: retention policies (configuration page, UI v3 §3.6), archival jobs, legal holds, the archive with read-only record views, and
// disposal with its certificate and DPDP erasure requests. Jobs are approved SYSADM → AUD; disposal and erasure by DIR.

const read = async (path) => (await api.get(path)).data;
const send = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/admin/archive${p.toString() ? `?${p}` : ''}`);
};
const ST = { SUBMITTED: 'IN_REVIEW', DONE: 'COMPLETED', REJECTED: 'REJECTED', REFUSED: 'REJECTED' };

function Decide({ item, path }) {
  const t = useT('arc');
  const cache = useQueryClient();
  const [comment, setComment] = useState('');
  const act = useMutation({ mutationFn: (action) => send(`${path}/${item.id}/act`, { action, comment: comment || undefined }), onSuccess: () => cache.invalidateQueries({ queryKey: ['arc'] }) });
  if (!item.canApprove || item.status !== 'SUBMITTED') return null;
  return <div className="arc-form">
    {act.error && <ErrorState error={act.error} />}
    <Field name={`arc-c-${path}-${item.id}`} label={t('comment')}><input value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
    <button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate('approve')} data-testid="arc-approve">{t('approve')}</button>
    <button type="button" className="btn" disabled={act.isPending || comment.trim().length < 5} onClick={() => act.mutate('reject')}>{t('reject')}</button>
  </div>;
}

function Policies({ data }) {
  const t = useT('arc');
  const cache = useQueryClient();
  const [f, setF] = useState({});
  const save = useMutation({ mutationFn: (c) => send('/admin/archive/policies', { recordClass: c.code, archiveAfterMonths: Number(f[c.code]?.months ?? c.policy?.archiveAfterMonths ?? 12), retentionYears: Number(f[c.code]?.years ?? c.policy?.retentionYears ?? 8), legalBasis: f[c.code]?.basis ?? c.policy?.legalBasis ?? '', actionAfter: f[c.code]?.action ?? c.policy?.actionAfter ?? 'REVIEW' }), onSuccess: () => cache.invalidateQueries({ queryKey: ['arc'] }) });
  const set = (c, k) => (e) => setF({ ...f, [c.code]: { ...f[c.code], [k]: e.target.value } });
  return <>
    {save.error && <ErrorState error={save.error} />}
    <ul className="arc-cards" data-testid="arc-policies">{data.classes.map((c) => <li key={c.code} className="arc-card" data-testid="arc-policy" data-class={c.code}>
      <div className="actions-row"><strong>{c.label}</strong><StatusBadge status={c.policy ? 'APPROVED' : 'DRAFT'} label={c.policy ? t('hasPolicy') : t('noPolicy')} size="sm" /></div>
      {c.policy && <p className="small">{t('policyLine', { m: c.policy.archiveAfterMonths, y: c.policy.retentionYears, a: t(`act.${c.policy.actionAfter}`) })}<br /><span className="muted">{c.policy.legalBasis}</span></p>}
      {c.personal && <p className="muted small">{t('personal')}</p>}
      {data.canManage && <div className="arc-form">
        <Field name={`arc-m-${c.code}`} label={t('archiveAfter')}><input inputMode="numeric" value={f[c.code]?.months ?? c.policy?.archiveAfterMonths ?? ''} onChange={set(c, 'months')} /></Field>
        <Field name={`arc-y-${c.code}`} label={t('retention')}><input inputMode="numeric" value={f[c.code]?.years ?? c.policy?.retentionYears ?? ''} onChange={set(c, 'years')} /></Field>
        <Field name={`arc-a-${c.code}`} label={t('after')}><select value={f[c.code]?.action ?? c.policy?.actionAfter ?? 'REVIEW'} onChange={set(c, 'action')}>{['DISPOSE', 'ANONYMISE', 'REVIEW'].map((a) => <option key={a} value={a}>{t(`act.${a}`)}</option>)}</select></Field>
        <Field name={`arc-b-${c.code}`} label={t('basis')}><input value={f[c.code]?.basis ?? c.policy?.legalBasis ?? ''} onChange={set(c, 'basis')} maxLength={300} /></Field>
        <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(c)} data-testid="arc-save-policy">{t('savePolicy')}</button>
      </div>}
    </li>)}</ul>
  </>;
}

function Jobs({ data }) {
  const t = useT('arc');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['arc', 'jobs'], queryFn: () => read('/admin/archive/jobs'), retry: false });
  const [f, setF] = useState({ recordClass: data.classes.find((c) => c.policy)?.code ?? '', closedProjectsOnly: false, reason: '' });
  const pv = useMutation({ mutationFn: () => send('/admin/archive/jobs/preview', { recordClass: f.recordClass, closedProjectsOnly: f.closedProjectsOnly }) });
  const create = useMutation({ mutationFn: () => send('/admin/archive/jobs', { recordClass: f.recordClass, closedProjectsOnly: f.closedProjectsOnly, reason: f.reason }), onSuccess: () => { pv.reset(); cache.invalidateQueries({ queryKey: ['arc'] }); } });
  return <>
    {data.canManage && <Card title={t('newJob')} subtitle={t('newJobSub')} testid="arc-newjob">
      <div className="arc-form">
        <Field name="arc-j-class" label={t('recordClass')}><select value={f.recordClass} onChange={(e) => { setF({ ...f, recordClass: e.target.value }); pv.reset(); }}>{data.classes.filter((c) => c.policy).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
        <label className="arc-check"><input type="checkbox" checked={f.closedProjectsOnly} onChange={(e) => { setF({ ...f, closedProjectsOnly: e.target.checked }); pv.reset(); }} /> {t('closedOnly')}</label>
        <button type="button" className="btn" disabled={!f.recordClass || pv.isPending} onClick={() => pv.mutate()} data-testid="arc-preview">{t('preview')}</button>
      </div>
      {pv.data && <p className="small" role="status" data-testid="arc-preview-result">{t('previewLine', { e: number(pv.data.data.eligible, { decimals: 0 }), h: number(pv.data.data.held, { decimals: 0 }) })}</p>}
      {pv.data?.data.eligible > 0 && <div className="arc-form"><Field name="arc-j-reason" label={t('reason')}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} minLength={5} maxLength={500} /></Field>
        <button type="button" className="btn btn-primary" disabled={create.isPending || f.reason.trim().length < 5} onClick={() => create.mutate()} data-testid="arc-create-job">{t('sendJob')}</button></div>}
      {(pv.error || create.error) && <ErrorState error={pv.error ?? create.error} />}
    </Card>}
    {q.isPending ? <Skeleton label={t('tab.jobs')} rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length ? <EmptyState title={t('noJobs')} message={t('noJobsBody')} /> :
      <ul className="arc-cards" data-testid="arc-jobs">{q.data.rows.map((j) => <li key={j.id} className="arc-card" data-testid="arc-job">
        <div className="actions-row"><strong>{j.label} #{j.id}</strong><StatusBadge status={ST[j.status]} label={t(`s.${j.status}`)} size="sm" /></div>
        <p className="small">{t('jobLine', { n: number(j.records, { decimals: 0 }), h: number(j.held, { decimals: 0 }) })}{j.scope.closedProjectsOnly ? ` · ${t('closedOnly')}` : j.scope.before ? ` · ${t('before', { d: j.scope.before })}` : ''}</p>
        <p className="muted small">{j.by} · {dateTime(j.createdAt)}{j.approvedBy ? ` · ${t('approvedBy', { who: j.approvedBy })}` : ''}{j.file ? ` · ${j.file}` : ''}</p>
        <Decide item={j} path="/admin/archive/jobs" />
      </li>)}</ul>}
  </>;
}

function Holds({ data }) {
  const t = useT('arc');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['arc', 'holds'], queryFn: () => read('/admin/archive/holds'), retry: false });
  const [f, setF] = useState({ entity: 'org_projects', entityId: '', reason: '' });
  const [why, setWhy] = useState({});
  const place = useMutation({ mutationFn: () => send('/admin/archive/holds', { entity: f.entity, entityId: Number(f.entityId), reason: f.reason }), onSuccess: () => { setF({ ...f, entityId: '', reason: '' }); cache.invalidateQueries({ queryKey: ['arc'] }); } });
  const release = useMutation({ mutationFn: (h) => send(`/admin/archive/holds/${h.id}/release`, { reason: why[h.id] }), onSuccess: () => cache.invalidateQueries({ queryKey: ['arc'] }) });
  return <>
    <p className="small muted">{t('holdRule')}</p>
    {q.data?.canHold && <Card title={t('placeHold')} testid="arc-placehold">
      <form className="arc-form" onSubmit={(e) => { e.preventDefault(); place.mutate(); }}>
        <Field name="arc-h-entity" label={t('holdOn')}><select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value })}><option value="org_projects">{t('project')}</option>{data.classes.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
        <Field name="arc-h-id" label={t('recordId')}><input inputMode="numeric" value={f.entityId} onChange={(e) => setF({ ...f, entityId: e.target.value.replace(/\D/g, '') })} required /></Field>
        <Field name="arc-h-reason" label={t('reason')}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required minLength={5} maxLength={500} /></Field>
        <button type="submit" className="btn btn-primary" disabled={place.isPending} data-testid="arc-hold">{t('placeHold')}</button>
      </form>
    </Card>}
    {(place.error || release.error) && <ErrorState error={place.error ?? release.error} />}
    {q.isPending ? <Skeleton label={t('tab.holds')} rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length ? <EmptyState title={t('noHolds')} message={t('noHoldsBody')} /> :
      <ul className="arc-cards" data-testid="arc-holds">{q.data.rows.map((h) => <li key={h.id} className="arc-card" data-testid="arc-holdrow">
        <div className="actions-row"><strong>{h.label}</strong><StatusBadge status="AT_RISK" label={t('onHold')} size="sm" /></div>
        <p className="small">{h.reason}</p><p className="muted small">{h.placedBy} · {dateTime(h.placedAt)}</p>
        {q.data.canHold && <div className="arc-form"><Field name={`arc-r-${h.id}`} label={t('releaseReason')}><input value={why[h.id] ?? ''} onChange={(e) => setWhy({ ...why, [h.id]: e.target.value })} /></Field>
          <button type="button" className="btn" disabled={release.isPending || (why[h.id] ?? '').trim().length < 5} onClick={() => release.mutate(h)}>{t('release')}</button></div>}
      </li>)}</ul>}
  </>;
}

function Records() {
  const t = useT('arc');
  const { dateTime } = useFormat();
  const search = useSearch();
  const [text, setText] = useState(search.get('q') ?? '');
  const sel = search.get('record') ?? '';
  const q = useQuery({ queryKey: ['arc', 'records', search.get('q') ?? ''], queryFn: () => read(`/admin/archive/records${search.get('q') ? `?q=${encodeURIComponent(search.get('q'))}` : ''}`), retry: false });
  const one = useQuery({ queryKey: ['arc', 'record', sel], queryFn: () => read(`/admin/archive/records/${sel}`), enabled: Boolean(sel), retry: false });
  return <>
    <form className="arc-form" onSubmit={(e) => { e.preventDefault(); go({ q: text.trim(), record: '' }); }}>
      <Field name="arc-q" label={t('searchRef')}><input type="search" value={text} onChange={(e) => setText(e.target.value)} /></Field>
      <button type="submit" className="btn">{t('search')}</button>
    </form>
    {q.isPending ? <Skeleton label={t('tab.records')} rows={3} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : !q.data.rows.length ? <EmptyState title={t('noRecords')} message={t('noRecordsBody')} /> :
      <Card title={t('tab.records')} count={{ shown: q.data.rows.length, total: q.data.total }} testid="arc-records">
        <ul className="arc-cards">{q.data.rows.map((r) => <li key={r.id} className="arc-card" data-testid="arc-record">
          <div className="actions-row"><strong>{r.ref}</strong><StatusBadge status={r.disposedAt ? 'CANCELLED' : 'APPROVED'} label={r.disposedAt ? t(`d.${r.disposal}`) : t('archived')} size="sm" /></div>
          <p className="muted small">{r.label} · {r.recordDate} · {t('archivedAt', { at: dateTime(r.archivedAt) })}</p>
          <button type="button" className="btn" onClick={() => go({ record: r.id })} data-testid="arc-open">{t('open')}</button>
        </li>)}</ul>
      </Card>}
    {sel && (one.isPending ? <Skeleton label={t('record')} rows={4} /> : one.error ? <ErrorState error={one.error} /> : <Card title={`${one.data.ref} · ${one.data.label}`} subtitle={t('readOnly')} testid="arc-view">
      <p className="small">{one.data.intact == null ? t('payloadGone') : one.data.intact ? t('intact') : t('notIntact')} · <code className="arc-code">{one.data.sha256}</code></p>
      <p className="muted small">{t('jobPolicy', { job: one.data.job.id, by: one.data.job.approvedBy ?? '—', y: one.data.policy.retentionYears ?? '—', basis: one.data.policy.legalBasis ?? '—' })}{one.data.held ? ` · ${t('onHold')}` : ''}</p>
      {one.data.payload && <table className="arc-table"><tbody>{Object.entries(one.data.payload).filter(([, v]) => v != null && v !== '').slice(0, 40).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{String(v)}</td></tr>)}</tbody></table>}
      <h3 className="arc-h">{t('trail')}</h3>
      {!one.data.trail.length ? <p className="muted small">{t('noTrail')}</p> : <ul className="arc-list">{one.data.trail.map((x, i) => <li key={i} className="small">{dateTime(x.at)} · {x.action} · {x.actor}{x.reason ? ` · ${x.reason}` : ''}</li>)}</ul>}
    </Card>)}
  </>;
}

function Disposal({ data }) {
  const t = useT('arc');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const dq = useQuery({ queryKey: ['arc', 'disposals'], queryFn: () => read('/admin/archive/disposals'), retry: false });
  const eq = useQuery({ queryKey: ['arc', 'erasures'], queryFn: () => read('/admin/archive/erasures'), retry: false });
  const [f, setF] = useState({ recordClass: data.classes.find((c) => c.policy)?.code ?? '', reason: '' });
  const [e, setE] = useState({ subjectId: '', basis: '', reason: '' });
  const propose = useMutation({ mutationFn: () => send('/admin/archive/disposals', f), onSuccess: () => cache.invalidateQueries({ queryKey: ['arc'] }) });
  const erase = useMutation({ mutationFn: () => send('/admin/archive/erasures', { subjectId: Number(e.subjectId), basis: e.basis, reason: e.reason }), onSuccess: () => cache.invalidateQueries({ queryKey: ['arc'] }) });
  const cert = useMutation({ mutationFn: (d) => downloadReport(`/api/v1/admin/archive/disposals/${d.id}/certificate`, `${d.certificateNo}.pdf`) });
  return <>
    {data.canDispose && <Card title={t('propose')} subtitle={t('proposeSub')} testid="arc-propose">
      <div className="arc-form">
        <Field name="arc-d-class" label={t('recordClass')}><select value={f.recordClass} onChange={(ev) => setF({ ...f, recordClass: ev.target.value })}>{data.classes.filter((c) => c.policy).map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select></Field>
        <Field name="arc-d-reason" label={t('reason')}><input value={f.reason} onChange={(ev) => setF({ ...f, reason: ev.target.value })} minLength={5} maxLength={500} /></Field>
        <button type="button" className="btn btn-primary" disabled={propose.isPending || f.reason.trim().length < 5} onClick={() => propose.mutate()}>{t('proposeBtn')}</button>
      </div>
      {propose.error && <ErrorState error={propose.error} />}
    </Card>}
    {cert.error && <ErrorState error={cert.error} />}
    <Card title={t('disposals')} testid="arc-disposals">{dq.isPending ? <Skeleton label={t('disposals')} rows={2} /> : !dq.data?.rows.length ? <p className="muted">{t('noDisposals')}</p> : <ul className="arc-cards">{dq.data.rows.map((d) => <li key={d.id} className="arc-card" data-testid="arc-disposal">
      <div className="actions-row"><strong>{d.label} #{d.id}</strong><StatusBadge status={ST[d.status]} label={t(`s.${d.status}`)} size="sm" /></div>
      <p className="small">{t('disposalLine', { n: number(d.records, { decimals: 0 }), h: number(d.held, { decimals: 0 }), a: t(`act.${d.action}`) })}{d.status === 'DONE' ? ` · ${t('disposedLine', { d: d.disposed, a: d.anonymised })}` : ''}</p>
      <p className="muted small">{d.by} · {dateTime(d.createdAt)}</p>
      {d.certificateNo && <button type="button" className="btn" onClick={() => cert.mutate(d)} data-testid="arc-cert">{t('certificate', { no: d.certificateNo })}</button>}
      <Decide item={d} path="/admin/archive/disposals" />
    </li>)}</ul>}</Card>
    {data.canDispose && <Card title={t('erasure')} subtitle={t('erasureSub')} testid="arc-erase">
      <div className="arc-form">
        <Field name="arc-e-id" label={t('employeeId')}><input inputMode="numeric" value={e.subjectId} onChange={(ev) => setE({ ...e, subjectId: ev.target.value.replace(/\D/g, '') })} /></Field>
        <Field name="arc-e-basis" label={t('requestBasis')}><input value={e.basis} onChange={(ev) => setE({ ...e, basis: ev.target.value })} maxLength={300} /></Field>
        <Field name="arc-e-reason" label={t('reason')}><input value={e.reason} onChange={(ev) => setE({ ...e, reason: ev.target.value })} maxLength={500} /></Field>
        <button type="button" className="btn btn-primary" disabled={erase.isPending || !e.subjectId || e.basis.trim().length < 5 || e.reason.trim().length < 5} onClick={() => erase.mutate()}>{t('checkSend')}</button>
      </div>
      {erase.error && <ErrorState error={erase.error} />}
    </Card>}
    <Card title={t('erasures')} testid="arc-erasures">{eq.isPending ? <Skeleton label={t('erasures')} rows={2} /> : !eq.data?.rows.length ? <p className="muted">{t('noErasures')}</p> : <ul className="arc-cards">{eq.data.rows.map((x) => <li key={x.id} className="arc-card" data-testid="arc-erasure">
      <div className="actions-row"><strong>{x.subject}</strong><StatusBadge status={ST[x.status]} label={t(`s.${x.status}`)} size="sm" /></div>
      <ul className="arc-list">{x.checks.map((c) => <li key={c.check} className={`small${c.ok ? '' : ' arc-problem'}`}>{c.ok ? '✓' : '✗'} {c.check}: {c.detail}</li>)}</ul>
      <Decide item={x} path="/admin/archive/erasures" />
    </li>)}</ul>}</Card>
  </>;
}

export function RetentionArchive() {
  const t = useT('arc');
  const { number } = useFormat();
  const search = useSearch();
  usePageTitle(t('title'));
  const q = useQuery({ queryKey: ['arc', 'policies'], queryFn: () => read('/admin/archive/policies'), retry: false });
  const rep = useQuery({ queryKey: ['arc', 'report'], queryFn: () => read('/admin/archive/report'), retry: false });
  const tabs = ['policies', 'jobs', 'holds', 'records', 'disposal'];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'policies';
  const sum = (k) => (rep.data?.rows ?? []).reduce((a, r) => a + r[k], 0);
  return <section aria-labelledby="arc-h" data-testid="arc-page">
    <PageHeader id="arc-h" title={t('title')} subtitle={t('subtitle')} />
    {rep.data && <KpiRow testid="arc-kpis" label={t('title')}>
      <KpiTile testid="arc-k-policies" kind="count" label={t('k.policies')} value={number(rep.data.rows.filter((r) => r.policy).length, { decimals: 0 })} tone="neutral">{t('k.policiesHelp', { n: rep.data.rows.length })}</KpiTile>
      <KpiTile testid="arc-k-archived" kind="count" label={t('k.archived')} value={number(sum('archived'), { decimals: 0 })} tone="neutral" to="/admin/archive?tab=records">{t('k.archivedHelp')}</KpiTile>
      <KpiTile testid="arc-k-holds" kind="count" label={t('k.holds')} value={number(sum('held') + rep.data.projectHolds, { decimals: 0 })} tone={sum('held') + rep.data.projectHolds ? 'warning' : 'neutral'} to="/admin/archive?tab=holds">{t('k.holdsHelp')}</KpiTile>
      <KpiTile testid="arc-k-disposed" kind="count" label={t('k.disposed')} value={number(sum('disposed'), { decimals: 0 })} tone="neutral" to="/admin/archive?tab=disposal">{t('k.disposedHelp')}</KpiTile>
    </KpiRow>}
    <div role="tablist" aria-label={t('title')} className="tabs" data-testid="arc-tabs">{tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'policies' ? '' : k, q: '', record: '' })}>{t(`tab.${k}`)}</button>)}</div>
    {q.isPending ? <Skeleton label={t('title')} rows={5} /> : q.error?.status === 403 ? <NoPermission message={q.error.message} /> : q.error ? <ErrorState error={q.error} onRetry={q.refetch} /> : <>
      {tab === 'policies' && <Policies data={q.data} />}
      {tab === 'jobs' && <Jobs data={q.data} />}
      {tab === 'holds' && <Holds data={q.data} />}
      {tab === 'records' && <Records />}
      {tab === 'disposal' && <Disposal data={q.data} />}
    </>}
  </section>;
}
