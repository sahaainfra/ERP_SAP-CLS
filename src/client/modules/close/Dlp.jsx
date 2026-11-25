import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authHeaders } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { useT } from '../../platform/i18n/index.js';
import { downloadReport } from '../bi/api.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { post, qs, read } from './common.js';

// Part 26.03: the defects liability overview (periods, what ends soon, open and overdue complaints), a period (complaints with their
// assignment, rectification and verification, warranty claims, the completion certificate) and the list of complaints. The API checks every rule.
const transport = browserTransport(authHeaders);
const TONE = { ACTIVE: 'SUBMITTED', COMPLETION_REVIEW: 'AT_RISK', COMPLETED: 'APPROVED', CANCELLED: 'CANCELLED', OPEN: 'DRAFT', ASSIGNED: 'SUBMITTED', RECTIFIED: 'AT_RISK', CLOSED: 'APPROVED', REJECTED: 'CANCELLED', ACCEPTED: 'SUBMITTED', RESOLVED: 'APPROVED', CRITICAL: 'REJECTED', MAJOR: 'AT_RISK', MINOR: 'DRAFT' };
const Badge = ({ t, status }) => <StatusBadge status={TONE[status] ?? 'DRAFT'} label={t(`dl.st.${status}`)} size="sm" />;
const go = (to) => (e) => { e.preventDefault(); navigateTo(to); };

function Guard({ q, title, children }) {
  if (q.error?.status === 403) return <NoPermission what={title} permission="dlp.view" />;
  if (q.isPending) return <section><PageHeader title={title} /><Skeleton label={title} rows={6} /></section>;
  if (q.error) return <section><PageHeader title={title} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  return children(q.data);
}

export function DlpOverview() {
  const t = useT('close'); usePageTitle(t('dl.title'));
  const q = useQuery({ queryKey: ['close', 'dlp', 'dash'], queryFn: () => read('/dlp/dashboard'), retry: false });
  return <Guard q={q} title={t('dl.title')}>{(d) => <section aria-labelledby="dl-h" data-testid="close-dlp">
    <PageHeader id="dl-h" title={t('dl.title')} subtitle={t('dl.subtitle')} />
    <KpiRow testid="dl-tiles" label={t('dl.title')}>
      <KpiTile testid="dl-k-active" label={t('dl.kActive')} kind="count" value={String(d.totals.active)}>{t('dl.kActiveBody', { n: d.totals.endingIn30 })}</KpiTile>
      <KpiTile testid="dl-k-ended" label={t('dl.kEnded')} kind="count" value={String(d.totals.ended)} tone={d.totals.ended ? 'warning' : 'success'}>{t('dl.kEndedBody')}</KpiTile>
      <KpiTile testid="dl-k-open" label={t('dl.kOpen')} kind="count" value={String(d.totals.openComplaints)} to="/close/dlp/complaints">{t('dl.kOpenBody')}</KpiTile>
      <KpiTile testid="dl-k-overdue" label={t('dl.kOverdue')} kind="count" value={String(d.totals.overdue)} tone={d.totals.overdue ? 'error' : 'success'} to="/close/dlp/complaints?overdue=1">{t('dl.kOverdueBody')}</KpiTile>
    </KpiRow>
    <Card title={t('dl.periods')} testid="dl-periods">
      {!d.periods.length ? <EmptyState compact title={t('dl.none')} message={t('dl.noneBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="dl-table">
        <thead><tr><th scope="col">{t('f.docNo')}</th><th scope="col">{t('f.project')}</th><th scope="col">{t('dl.f.area')}</th><th scope="col">{t('dl.f.handover')}</th><th scope="col">{t('dl.f.ends')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('dl.f.open')}</th><th scope="col">{t('dl.f.overdue')}</th></tr></thead>
        <tbody>{d.periods.map((p) => <tr key={p.id} data-testid="dl-row" data-status={p.status}>
          <td><a href={`/close/dlp/period?id=${p.id}`} onClick={go(`/close/dlp/period?id=${p.id}`)}>{p.docNo}</a></td><td>{p.project}</td><td>{p.area}</td><td>{p.handover}</td>
          <td>{p.endsOn}{p.status === 'ACTIVE' && <span className="small muted"> · {p.daysLeft >= 0 ? t('dl.daysLeft', { n: p.daysLeft }) : t('dl.ended')}</span>}</td>
          <td><Badge t={t} status={p.status} /></td><td>{p.complaints.open}</td><td>{p.complaints.overdue}</td>
        </tr>)}</tbody>
      </table></div>}
    </Card>
  </section>}</Guard>;
}

function ComplaintTable({ t, rows, actions }) {
  return <div className="table-scroll"><table className="data-table" data-testid="dc-table">
    <thead><tr><th scope="col">{t('f.docNo')}</th><th scope="col">{t('dl.f.reported')}</th><th scope="col">{t('f.description')}</th><th scope="col">{t('dl.f.severity')}</th><th scope="col">{t('dl.f.due')}</th><th scope="col">{t('dl.f.party')}</th><th scope="col">{t('f.status')}</th>{actions && <th scope="col">{t('f.actions')}</th>}</tr></thead>
    <tbody>{rows.map((c) => <tr key={c.id} data-testid="dc-row" data-status={c.status} data-overdue={c.overdue ? 'yes' : 'no'}>
      <td>{c.docNo}</td><td>{c.reportedOn} · {c.reportedBy}</td><td>{c.description}{c.location ? <span className="small muted"> · {c.location}</span> : null}{c.asset ? <span className="small muted"> · {c.asset}</span> : null}</td>
      <td><Badge t={t} status={c.severity} /></td><td>{c.dueAt.slice(0, 16).replace('T', ' ')}{c.overdue && <StatusBadge status="REJECTED" label={t('dl.overdue')} size="sm" />}</td>
      <td>{c.responsibleType ? `${t(`dl.party.${c.responsibleType}`)}${c.partner ? ` · ${c.partner}` : ''}` : ''}</td><td><Badge t={t} status={c.status} /></td>
      {actions && <td>{actions(c)}</td>}
    </tr>)}</tbody>
  </table></div>;
}

export function DlpPeriod() {
  const t = useT('close'); const id = useSearch().get('id'); const cache = useQueryClient();
  const q = useQuery({ queryKey: ['close', 'dlp', 'one', id], queryFn: () => read(`/dlp/periods/${id}`), retry: false, enabled: Boolean(id) });
  usePageTitle(q.data ? q.data.docNo : t('dl.one'));
  const refresh = () => cache.invalidateQueries({ queryKey: ['close', 'dlp'] });
  const complete = useMutation({ mutationFn: () => post(`/dlp/periods/${id}/complete`), onSuccess: refresh });
  if (!id) return <section><PageHeader title={t('dl.one')} /><EmptyState title={t('dl.pick')} message={t('dl.pickBody')} /></section>;
  return <Guard q={q} title={t('dl.one')}>{(p) => <section aria-labelledby="dp-h" data-testid="close-dlp-period" data-status={p.status}>
    <PageHeader id="dp-h" title={`${p.docNo} ${p.area ?? ''}`} subtitle={`${p.project} · ${p.handover} · ${p.startsOn} → ${p.endsOn}`} status={<Badge t={t} status={p.status} />} />
    <Card title={t('dl.completion')} subtitle={t('dl.completionBody')} testid="dp-completion">
      {complete.error && <ErrorState error={complete.error} />}
      <p data-testid="dp-ready" data-ready={p.readiness.ready ? 'yes' : 'no'}><StatusBadge status={p.readiness.ready ? 'APPROVED' : 'REJECTED'} label={p.readiness.ready ? t('sys.ready') : t('sys.notReady')} size="sm" /></p>
      {!p.readiness.ready && <ul className="small">{p.readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
      {p.status === 'ACTIVE' && p.readiness.ready && p.can.complete && <button type="button" className="btn btn-primary" disabled={complete.isPending} onClick={() => complete.mutate()} data-testid="dp-complete">{t('dl.requestCompletion')}</button>}
    </Card>
    <Complaints t={t} p={p} refresh={refresh} />
    <Claims t={t} p={p} refresh={refresh} />
  </section>}</Guard>;
}

function Complaints({ t, p, refresh }) {
  const [v, setV] = useState({ reportedOn: '', reportedBy: '', description: '', severity: 'MINOR', location: '' });
  const [act, setAct] = useState({ id: null, kind: null, note: '', file: null, partnerId: '', type: 'OWN_CREW', recovery: '' });
  const add = useMutation({ mutationFn: () => post(`/dlp/periods/${p.id}/complaints`, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''))), onSuccess: () => { setV({ reportedOn: '', reportedBy: '', description: '', severity: 'MINOR', location: '' }); refresh(); } });
  const run = useMutation({
    mutationFn: async ([c, kind, accept]) => {
      if (kind === 'assign') return post(`/dlp/complaints/${c.id}/assign`, { responsibleType: act.type, ...(act.type !== 'OWN_CREW' ? { partnerId: Number(act.partnerId) } : {}) });
      if (kind === 'rectify') { const f = await uploadFile(act.file, { transport, entity: 'dlp_complaints', entityId: c.id, stripExif: true }); return post(`/dlp/complaints/${c.id}/rectify`, { note: act.note, fileId: f.id }); }
      return post(`/dlp/complaints/${c.id}/verify`, { accept, ...(act.note ? { note: act.note } : {}), ...(accept && act.recovery ? { recovery: Number(act.recovery) } : {}) });
    },
    onSuccess: () => { setAct({ id: null, kind: null, note: '', file: null, partnerId: '', type: 'OWN_CREW', recovery: '' }); refresh(); },
  });
  const actions = (c) => {
    const can = { assign: p.can.manage && ['OPEN', 'ASSIGNED'].includes(c.status), rectify: p.can.rectify && c.status === 'ASSIGNED', verify: p.can.verify && c.status === 'RECTIFIED' };
    if (act.id === c.id) return <div className="form-grid">
      {act.kind === 'assign' && <><Field name={`ty-${c.id}`} label={t('dl.f.party')}><select id={`ty-${c.id}`} value={act.type} onChange={(e) => setAct({ ...act, type: e.target.value })} data-testid={`dc-type-${c.id}`}>{['OWN_CREW', 'SUBCONTRACTOR', 'SUPPLIER'].map((x) => <option key={x} value={x}>{t(`dl.party.${x}`)}</option>)}</select></Field>
        {act.type !== 'OWN_CREW' && <Field name={`pa-${c.id}`} label={t('dl.f.partnerId')}><select id={`pa-${c.id}`} required value={act.partnerId} onChange={(e) => setAct({ ...act, partnerId: e.target.value })} data-testid={`dc-partner-${c.id}`}><option value="">{t('f.choose')}</option>{p.partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}</>}
      {act.kind === 'rectify' && <Field name={`fi-${c.id}`} label={t('dl.f.evidence')}><input id={`fi-${c.id}`} type="file" accept="image/*,.pdf" required onChange={(e) => setAct({ ...act, file: e.target.files?.[0] ?? null })} data-testid={`dc-file-${c.id}`} /></Field>}
      {act.kind === 'verify' && <Field name={`rc-${c.id}`} label={t('dl.f.recovery')}><input id={`rc-${c.id}`} inputMode="decimal" value={act.recovery} onChange={(e) => setAct({ ...act, recovery: e.target.value })} data-testid={`dc-recovery-${c.id}`} /></Field>}
      {act.kind !== 'assign' && <Field name={`nt-${c.id}`} label={t('f.note')}><input id={`nt-${c.id}`} value={act.note} onChange={(e) => setAct({ ...act, note: e.target.value })} data-testid={`dc-note-${c.id}`} /></Field>}
      <div className="actions-row">
        {act.kind === 'verify' ? <><button type="button" className="btn btn-small btn-primary" onClick={() => run.mutate([c, 'verify', true])} data-testid={`dc-close-${c.id}`}>{t('dl.close')}</button><button type="button" className="btn btn-small" onClick={() => run.mutate([c, 'verify', false])} data-testid={`dc-back-${c.id}`}>{t('dl.sendBack')}</button></>
          : <button type="button" className="btn btn-small btn-primary" disabled={run.isPending} onClick={() => run.mutate([c, act.kind])} data-testid={`dc-save-${c.id}`}>{t('save')}</button>}
        <button type="button" className="btn btn-small" onClick={() => setAct({ ...act, id: null })}>{t('cancel')}</button>
      </div>
    </div>;
    return <div className="actions-row">{['assign', 'rectify', 'verify'].filter((k) => can[k]).map((k) => <button key={k} type="button" className="btn btn-small" onClick={() => setAct({ ...act, id: c.id, kind: k })} data-testid={`dc-${k}-${c.id}`}>{t(`dl.do.${k}`)}</button>)}</div>;
  };
  return <Card title={t('dl.complaints')} testid="dp-complaints">
    {(add.error || run.error) && <ErrorState error={add.error ?? run.error} />}
    {!p.complaintList.length ? <EmptyState compact title={t('dl.noComplaints')} message={t('dl.noComplaintsBody')} /> : <ComplaintTable t={t} rows={p.complaintList} actions={actions} />}
    {p.can.report && p.status === 'ACTIVE' && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} data-testid="dp-complaint-form">
      <Field name="dc-on" label={t('dl.f.reportedOn')}><input id="dc-on" type="date" required value={v.reportedOn} onChange={(e) => setV({ ...v, reportedOn: e.target.value })} data-testid="dc-on" /></Field>
      <Field name="dc-by" label={t('dl.f.reportedBy')}><input id="dc-by" required value={v.reportedBy} onChange={(e) => setV({ ...v, reportedBy: e.target.value })} data-testid="dc-by" /></Field>
      <Field name="dc-loc" label={t('ca.f.location')}><input id="dc-loc" value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} data-testid="dc-loc" /></Field>
      <Field name="dc-desc" label={t('f.description')}><input id="dc-desc" required value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} data-testid="dc-desc" /></Field>
      <Field name="dc-sev" label={t('dl.f.severity')}><select id="dc-sev" value={v.severity} onChange={(e) => setV({ ...v, severity: e.target.value })} data-testid="dc-sev">{['CRITICAL', 'MAJOR', 'MINOR'].map((x) => <option key={x} value={x}>{t(`dl.st.${x}`)}</option>)}</select></Field>
      <div className="actions-row"><button type="submit" className="btn" disabled={add.isPending} data-testid="dc-add">{t('dl.addComplaint')}</button></div>
    </form>}
  </Card>;
}

function Claims({ t, p, refresh }) {
  const [v, setV] = useState({ assetId: '', claimedOn: '', description: '' });
  const add = useMutation({ mutationFn: () => post(`/dlp/periods/${p.id}/claims`, { assetId: Number(v.assetId), claimedOn: v.claimedOn, description: v.description }), onSuccess: () => { setV({ assetId: '', claimedOn: '', description: '' }); refresh(); } });
  const move = useMutation({ mutationFn: ([id, status]) => post(`/dlp/claims/${id}`, { status }), onSuccess: refresh });
  const next = { OPEN: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['RESOLVED'] };
  return <Card title={t('dl.claims')} testid="dp-claims">
    {(add.error || move.error) && <ErrorState error={add.error ?? move.error} />}
    {!p.claims.length ? <EmptyState compact title={t('dl.noClaims')} message={t('dl.noClaimsBody')} /> : <ul className="plain-list">{p.claims.map((w) => <li key={w.id} data-testid="dp-claim" data-status={w.status}>
      {w.docNo} · {w.asset} · {w.claimedOn} · {w.description} <Badge t={t} status={w.status} />
      {p.can.manage && (next[w.status] ?? []).map((s) => <button key={s} type="button" className="btn btn-small" disabled={move.isPending} onClick={() => move.mutate([w.id, s])} data-testid={`dp-claim-${s}-${w.id}`}>{t(`dl.st.${s}`)}</button>)}
    </li>)}</ul>}
    {p.can.manage && p.assets.length > 0 && <form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} data-testid="dp-claim-form">
      <Field name="wc-asset" label={t('ca.f.tagNo')}><select id="wc-asset" required value={v.assetId} onChange={(e) => setV({ ...v, assetId: e.target.value })} data-testid="wc-asset"><option value="">{t('f.choose')}</option>{p.assets.map((a) => <option key={a.id} value={a.id}>{a.tagNo} {a.description}</option>)}</select></Field>
      <Field name="wc-on" label={t('dl.f.claimedOn')}><input id="wc-on" type="date" required value={v.claimedOn} onChange={(e) => setV({ ...v, claimedOn: e.target.value })} data-testid="wc-on" /></Field>
      <Field name="wc-desc" label={t('f.description')}><input id="wc-desc" required value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} data-testid="wc-desc" /></Field>
      <div className="actions-row"><button type="submit" className="btn" disabled={add.isPending} data-testid="wc-add">{t('dl.addClaim')}</button></div>
    </form>}
  </Card>;
}

export function DlpComplaints() {
  const t = useT('close'); usePageTitle(t('dc.title')); const search = useSearch();
  const params = { status: search.get('status') ?? '', overdue: search.get('overdue') ?? '' };
  const q = useQuery({ queryKey: ['close', 'dlp', 'complaints', params], queryFn: () => read(`/dlp/complaints${qs(params)}`), retry: false });
  const exp = useMutation({ mutationFn: () => downloadReport(`/api/v1/close/dlp/complaints/export${qs(params)}`, 'dlp-complaints.csv') });
  return <Guard q={q} title={t('dc.title')}>{(rows) => <section aria-labelledby="dc-h" data-testid="close-dlp-complaints">
    <PageHeader id="dc-h" title={t('dc.title')} subtitle={t('dc.subtitle')} menu={[{ label: t('ca.export'), testid: 'dc-export', onClick: () => exp.mutate() }]} />
    {exp.error && <ErrorState error={exp.error} />}
    <div className="actions-row" role="group" aria-label={t('dc.filter')}>
      <Field name="dc-status" label={t('f.status')}><select id="dc-status" value={params.status} onChange={(e) => navigateTo(`/close/dlp/complaints${qs({ ...params, status: e.target.value })}`)} data-testid="dc-status"><option value="">{t('dc.all')}</option>{['OPEN', 'ASSIGNED', 'RECTIFIED', 'CLOSED', 'REJECTED'].map((s) => <option key={s} value={s}>{t(`dl.st.${s}`)}</option>)}</select></Field>
      <label className="small"><input type="checkbox" checked={Boolean(params.overdue)} onChange={(e) => navigateTo(`/close/dlp/complaints${qs({ ...params, overdue: e.target.checked ? '1' : '' })}`)} data-testid="dc-overdue" /> {t('dl.overdue')}</label>
    </div>
    {!rows.length ? <EmptyState title={t('dl.noComplaints')} message={t('dc.noneBody')} /> : <Card title={t('dc.title')}><ComplaintTable t={t} rows={rows} /></Card>}
  </section>}</Guard>;
}
