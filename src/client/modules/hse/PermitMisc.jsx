import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { hse, qs } from './api.js';
import { ErrorLine, big, useRunner } from './HseParts.jsx';
import { PermitState, stamp } from './PermitsPage.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Active Permits board per site, Permit Approvals worklist and Permit Types (part 19.02).
function Card({ x }) {
  const t = useT('hse');
  return <li className="mdm-panel" data-testid="hse-board-card" data-risk={x.riskClass}><Link to={`/hse/permits?id=${x.id}`}>{x.docNo}</Link> <PermitState x={x} /> {x.riskClass === 'HIGH' && <StatusBadge status="REJECTED" label={t('pm.high')} />}<br />{x.type} · {x.location ?? '—'} · {x.title}<br /><small>{stamp(x.validFrom)} → {stamp(x.validTo)} · {x.workerCount} {t('pm.workers')} · {x.supervisor}{x.minutesLeft != null ? ` · ${t('pm.left', { n: x.minutesLeft })}` : ''}</small>{x.suspendedReason && x.permitStatus === 'SUSPENDED' && <p className="field-error">{x.suspendedReason}</p>}</li>;
}
export function PermitBoardPage() {
  const t = useT('hse'); usePageTitle(t('pb.title')); const [siteId, setSiteId] = useState('');
  const oq = useQuery({ queryKey: ['hse', 'plan-options'], queryFn: () => hse.get('/plans/options'), retry: false }); const q = useQuery({ queryKey: ['hse', 'permit-board', siteId], queryFn: () => hse.get(`/permits/board${qs({ siteId })}`), refetchInterval: 30_000, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('pb.title')} permission="hse.permit.view" />; if (q.isPending) return <Skeleton label={t('pb.title')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />; const d = q.data; const tot = d.totals;
  const groups = [['active', d.active], ['onHold', d.onHold], ['suspended', d.suspended], ['expired', d.expired], ['waiting', d.waiting]];
  return (
    <section aria-labelledby="pb-h" data-testid="hse-permit-board"><PageHeader id="pb-h" title={t('pb.title')} subtitle={<>{t('pb.intro')} <Link to="/hse/permits">{t('pm.register')}</Link></>} />
      <div className="form-grid no-print"><Field label={t('site')} name="siteId" error={null}><select value={siteId} onChange={(e) => setSiteId(e.target.value)} style={big} data-testid="hse-board-site"><option value="">{t('cmp.all')}</option>{(oq.data?.sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} {s.name}</option>)}</select></Field></div>
      <p data-testid="hse-board-totals">{t('pb.totals', { active: tot.active, soon: tot.expiringSoon, suspended: tot.suspended, hold: tot.onHold, waiting: tot.waiting })}</p>
      {groups.every(([, l]) => l.length === 0) ? <div className="empty-state" data-testid="hse-board-empty"><h2>{t('pb.emptyTitle')}</h2><p>{t('pb.emptyBody')}</p></div> : groups.map(([k, list]) => list.length > 0 && <div key={k}><h2>{t(`pb.${k}`)} ({list.length})</h2><ul style={{ listStyle: 'none', padding: 0 }}>{list.map((x) => <Card key={x.id} x={x} />)}</ul></div>)}
    </section>
  );
}
export function PermitApprovalsPage() {
  const t = useT('hse'); usePageTitle(t('pa.title')); const { error, run, busy, note } = useRunner(); const [comment, setComment] = useState({});
  const q = useQuery({ queryKey: ['hse', 'permit-pending'], queryFn: () => hse.get('/permits/pending'), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('pa.title')} permission="hse.permit.approve" />; if (q.isPending) return <Skeleton label={t('pa.title')} rows={3} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const decide = (x, action) => { const c = (comment[x.id] ?? '').trim(); if (action !== 'approve' && c.length < 5) { globalThis.alert?.(t('sayWhy')); return; } run(() => hse.decide(x.taskId, action, c || null), t(`done.${action}`)); };
  return (
    <section aria-labelledby="pa-h" data-testid="hse-permit-approvals"><PageHeader id="pa-h" title={t('pa.title')} subtitle={<>{t('pa.intro')} <Link to="/hse/permits">{t('pm.register')}</Link></>} /><ErrorLine error={error} id="hse-pa-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-pa-note">{note}</p>}
      {q.data.length === 0 ? <div className="empty-state" data-testid="hse-pa-empty"><h2>{t('pa.emptyTitle')}</h2><p>{t('pa.emptyBody')}</p></div> : (
        <ul style={{ listStyle: 'none', padding: 0 }}>{q.data.map((x) => (
          <li key={x.id} className="mdm-panel" data-testid="hse-pa-card"><Link to={`/hse/permits?id=${x.id}`}>{x.docNo}</Link> · {x.type} {x.riskClass === 'HIGH' && <StatusBadge status="REJECTED" label={t('pm.high')} />}<br />{x.location ?? '—'} · {x.title}<br /><small>{stamp(x.validFrom)} → {stamp(x.validTo)} · {x.workerCount} {t('pm.workers')} · {x.requestedBy}</small>
            {x.workers.some((w) => w.problems.length) && <p className="field-error">{x.workers.flatMap((w) => w.problems).join('; ')}</p>}
            <Field label={t('comment')} name={`c${x.id}`} error={null}><input value={comment[x.id] ?? ''} onChange={(e) => setComment({ ...comment, [x.id]: e.target.value })} style={big} data-testid="hse-pa-comment" /></Field>
            <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy} onClick={() => decide(x, 'approve')} data-testid="hse-pa-approve">{t('approve')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide(x, 'return')} data-testid="hse-pa-return">{t('returnIt')}</button><button type="button" className="btn" style={big} disabled={busy} onClick={() => decide(x, 'reject')} data-testid="hse-pa-reject">{t('reject')}</button></div></li>))}</ul>)}
    </section>
  );
}
export function PermitTypesPage() {
  const t = useT('hse'); usePageTitle(t('pt.title')); const session = useSession(); const { error, run, busy, note } = useRunner(); const blank = { code: '', name: '', riskClass: 'NORMAL', maxHours: 12, requiredCerts: [], requiresGasTest: false, gases: [], requiresIsolation: false, conflicts: '' }; const [v, setV] = useState(blank);
  const oq = useQuery({ queryKey: ['hse', 'permit-type-options'], queryFn: () => hse.get('/permit-types/options'), retry: false }); const o = oq.data;
  const toggle = (k, val) => setV({ ...v, [k]: v[k].includes(val) ? v[k].filter((x) => x !== val) : [...v[k], val] });
  return (
    <section aria-labelledby="pt-h" data-testid="hse-permit-types"><PageHeader id="pt-h" title={t('pt.title')} subtitle={t('pt.intro')} />
      <details className="mdm-panel no-print" data-testid="hse-pt-form"><summary>{t('pt.new')}</summary><ErrorLine error={error} id="hse-pt-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-pt-note">{note}</p>}
        <div className="form-grid"><Field label={t('lib.code')} name="code" error={error}><input value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} maxLength={40} style={big} data-testid="hse-pt-code" /></Field><Field label={t('pt.name')} name="name" error={error}><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={120} style={big} data-testid="hse-pt-name" /></Field>
          <Field label={t('pt.risk')} name="riskClass" error={error}><select value={v.riskClass} onChange={(e) => setV({ ...v, riskClass: e.target.value })} style={big} data-testid="hse-pt-risk"><option value="NORMAL">{t('pt.NORMAL')}</option><option value="HIGH">{t('pt.HIGH')}</option></select></Field>
          <Field label={t('pt.maxHours')} name="maxHours" error={error}><input type="number" min="1" max="24" value={v.maxHours} onChange={(e) => setV({ ...v, maxHours: e.target.value })} style={big} /></Field>
          <Field label={t('pt.conflicts')} name="conflicts" error={error}><input value={v.conflicts} onChange={(e) => setV({ ...v, conflicts: e.target.value })} placeholder="HOT, CONF" style={big} /></Field></div>
        <fieldset><legend>{t('pt.certs')}</legend>{(o?.certTypes ?? []).map((c) => <label key={c.code} style={{ display: 'inline-block', minHeight: 44, marginRight: 12 }}><input type="checkbox" checked={v.requiredCerts.includes(c.code)} onChange={() => toggle('requiredCerts', c.code)} /> {c.name}</label>)}</fieldset>
        <label style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={v.requiresGasTest} onChange={(e) => setV({ ...v, requiresGasTest: e.target.checked })} data-testid="hse-pt-gas" /> {t('pt.gasTest')}</label>
        {v.requiresGasTest && <fieldset>{(o?.gases ?? []).map((g) => <label key={g.code} style={{ display: 'inline-block', minHeight: 44, marginRight: 12 }}><input type="checkbox" checked={v.gases.includes(g.code)} onChange={() => toggle('gases', g.code)} /> {g.code}</label>)}</fieldset>}
        <label style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={v.requiresIsolation} onChange={(e) => setV({ ...v, requiresIsolation: e.target.checked })} /> {t('pt.isolation')}</label>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || v.code.length < 2 || v.name.length < 3} onClick={async () => { const r = await run(() => hse.make('/permit-types', { code: v.code, name: v.name, riskClass: v.riskClass, maxHours: Number(v.maxHours), requiredCerts: v.requiredCerts, requiresGasTest: v.requiresGasTest, gases: v.gases, requiresIsolation: v.requiresIsolation, conflicts: v.conflicts.split(',').map((s) => s.trim()).filter(Boolean) }), t('pt.saved')); if (r) setV(blank); }} data-testid="hse-pt-save">{t('save')}</button></div></details>
      <ListReport listCode="hse.permit_types" endpoint="/hse/permit-types" exportEndpoint="/ui/lists/hse.permit_types/export" title={t('pt.title')} session={session.data} onOpen={(r) => navigateTo(`/hse/permit-types?id=${r.id}`)} cardFields={['code', 'name', 'risk', 'status']} statusKey="status" empty={{ title: t('pt.emptyTitle'), text: t('pt.emptyBody') }} />
    </section>
  );
}
