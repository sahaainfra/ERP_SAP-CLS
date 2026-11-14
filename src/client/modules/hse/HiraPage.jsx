import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { hse, RISK_TONE } from './api.js';
import { DocBar, ErrorLine, ProjectSite, Status, big, useRecord, useRunner } from './HseParts.jsx';

// HIRA Register (part 19.01, FR-02): hazards scored on a 5 x 5 matrix before and after the controls; the server scores again and the highest residual risk decides who approves (the project manager; the HSE head also for a high risk).
const level = (s) => (s <= 4 ? 'LOW' : s <= 9 ? 'MEDIUM' : s <= 16 ? 'HIGH' : 'EXTREME');
const NUMS = [1, 2, 3, 4, 5]; const blankH = { activity: '', hazard: '', consequence: '', c: 3, l: 3, controls: '', rc: 2, rl: 2, owner: '' };
function Score({ n }) { const t = useT('hse'); return <StatusBadge status={RISK_TONE[level(n)]} label={`${n} ${t(`risk.${level(n)}`)}`} />; }
function HiraForm({ initial, onSave, busy, error }) {
  const t = useT('hse'); const o = useQuery({ queryKey: ['hse', 'hira-options', initial.projectId], queryFn: () => hse.get(`/hira/options${initial.projectId ? `?projectId=${initial.projectId}` : ''}`), retry: false }); const [v, setV] = useState(initial);
  if (o.error?.status === 403) return <NoPermission what={t('hira.title')} permission="hse.hira.create" />; if (o.isPending) return <Skeleton label={t('hira.title')} rows={3} />;
  const setH = (i, k, val) => setV({ ...v, hazards: v.hazards.map((h, j) => (j === i ? { ...h, [k]: val } : h)) }); const num = (e) => Number(e.target.value);
  const bad = v.hazards.some((h) => h.rc * h.rl > h.c * h.l);
  return (
    <div className="mdm-panel" data-testid="hse-hira-form"><div className="form-grid">
      {!initial.id && <ProjectSite o={o.data} v={v} set={setV} error={error} siteOptional />}
      <Field label={t('hira.titleField')} name="title" error={error}><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={200} style={big} data-testid="hse-hira-title" /></Field>
      <Field label={t('hira.activityType')} name="activityType" error={error}><input value={v.activityType} onChange={(e) => setV({ ...v, activityType: e.target.value })} maxLength={60} style={big} data-testid="hse-hira-type" /></Field></div>
      <h2>{t('hira.hazards')}</h2>
      {v.hazards.map((h, i) => (
        <fieldset key={i} className="mdm-panel" data-testid="hse-hira-row"><legend>{t('hira.hazardN', { n: i + 1 })}</legend><div className="form-grid">
          <Field label={t('hira.activity')} name={`a${i}`} error={error}><input value={h.activity} onChange={(e) => setH(i, 'activity', e.target.value)} style={big} data-testid="hse-hira-activity" /></Field>
          <Field label={t('hira.hazard')} name={`h${i}`} error={error}><input value={h.hazard} onChange={(e) => setH(i, 'hazard', e.target.value)} style={big} data-testid="hse-hira-hazard" /></Field>
          <Field label={t('hira.consequence')} name={`q${i}`} error={error}><input value={h.consequence} onChange={(e) => setH(i, 'consequence', e.target.value)} style={big} /></Field>
          <Field label={t('hira.c')} name={`c${i}`} error={error}><select value={h.c} onChange={(e) => setH(i, 'c', num(e))} style={big} data-testid="hse-hira-c">{NUMS.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label={t('hira.l')} name={`l${i}`} error={error}><select value={h.l} onChange={(e) => setH(i, 'l', num(e))} style={big} data-testid="hse-hira-l">{NUMS.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <p data-testid="hse-hira-score">{t('hira.risk')}: <Score n={h.c * h.l} /></p>
          <Field label={t('hira.controls')} name={`k${i}`} error={error}><textarea rows={2} value={h.controls} onChange={(e) => setH(i, 'controls', e.target.value)} style={{ width: '100%' }} data-testid="hse-hira-controls" /></Field>
          <Field label={t('hira.rc')} name={`rc${i}`} error={error}><select value={h.rc} onChange={(e) => setH(i, 'rc', num(e))} style={big} data-testid="hse-hira-rc">{NUMS.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <Field label={t('hira.rl')} name={`rl${i}`} error={error}><select value={h.rl} onChange={(e) => setH(i, 'rl', num(e))} style={big} data-testid="hse-hira-rl">{NUMS.map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>
          <p data-testid="hse-hira-residual">{t('hira.residual')}: <Score n={h.rc * h.rl} /></p>
          <Field label={t('hira.owner')} name={`o${i}`} error={error}><input value={h.owner} onChange={(e) => setH(i, 'owner', e.target.value)} style={big} /></Field>
          {v.hazards.length > 1 && <button type="button" className="btn" onClick={() => setV({ ...v, hazards: v.hazards.filter((_, j) => j !== i) })}>{t('remove')}</button>}</div></fieldset>
      ))}
      {bad && <p className="field-error" role="alert">{t('hira.residualHigher')}</p>}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, hazards: [...v.hazards, { ...blankH }] })} data-testid="hse-hira-add">{t('hira.addHazard')}</button>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || bad || v.title.trim().length < 3 || (!initial.id && !v.projectId)} onClick={() => onSave(v)} data-testid="hse-hira-save">{t('save')}</button></div></div>
  );
}
const body = (v) => ({ title: v.title, activityType: v.activityType || null, hazards: v.hazards.map((h) => ({ ...h, consequence: h.consequence || '', owner: h.owner || '' })) });
function Hira({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/hira', id, t('hira.title'), 'hse.hira.view'); const { error, run, busy, note } = useRunner(); const [editing, setEditing] = useState(false); usePageTitle(t('hira.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="hse-hira-object" data-status={x.status}><h1 id="hr-h">{x.docNo} <Status x={x} /> <StatusBadge status={RISK_TONE[x.riskLevel]} label={t(`risk.${x.riskLevel}`)} /></h1>
      <p><Link to="/hse/hira">{t('hira.title')}</Link> · {x.project} · {t('plan.version', { n: x.versionNo })} · {x.title} · {t('hira.maxResidual')} {x.maxResidual}</p>
      <ErrorLine error={error} id="hse-hira-error" />{note && <p className="mdm-banner" role="status">{note}</p>}
      {x.can.edit && <div className="actions-row no-print"><button type="button" className="btn" onClick={() => setEditing(!editing)} data-testid="hse-hira-edit">{t('edit')}</button></div>}
      {editing && x.can.edit ? <HiraForm initial={{ id: x.id, projectId: x.projectId, title: x.title, activityType: x.activityType ?? '', hazards: x.hazards }} busy={busy} error={error} onSave={async (v) => { const r = await run(() => hse.edit('/hira', x.id, { ...body(v), rowVersion: x.version }), t('saved')); if (r) setEditing(false); }} /> : (
        <div className="table-scroll" data-testid="hse-hira-table"><table className="data-table"><thead><tr><th>{t('hira.activity')}</th><th>{t('hira.hazard')}</th><th>{t('hira.risk')}</th><th>{t('hira.controls')}</th><th>{t('hira.residual')}</th><th>{t('hira.owner')}</th></tr></thead>
          <tbody>{x.hazards.map((h, i) => <tr key={i}><td>{h.activity}</td><td>{h.hazard}</td><td><Score n={h.score} /></td><td>{h.controls}</td><td><Score n={h.residual} /></td><td>{h.owner}</td></tr>)}</tbody></table></div>)}
      <p className="muted">{t('hira.jsaCount', { n: x.jsaCount ?? 0 })}</p>
      <DocBar kind="/hira" x={x} printName={`${x.docNo}.pdf`} />
    </div>
  );
}
function HiraNew() {
  const t = useT('hse'); const { error, run, busy } = useRunner(); usePageTitle(t('hira.new'));
  return <section aria-labelledby="hrn-h"><h1 id="hrn-h">{t('hira.new')}</h1><p><Link to="/hse/hira">{t('hira.title')}</Link></p><ErrorLine error={error} id="hse-hira-error" /><HiraForm initial={{ projectId: '', siteId: '', title: '', activityType: '', hazards: [{ ...blankH }] }} busy={busy} error={error} onSave={async (v) => { const r = await run(() => hse.make('/hira', { projectId: Number(v.projectId), siteId: v.siteId ? Number(v.siteId) : null, ...body(v) })); if (r) navigateTo(`/hse/hira?id=${r.id}`); }} /></section>;
}
export default function HiraPage() {
  const t = useT('hse'); usePageTitle(t('hira.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const sum = useQuery({ queryKey: ['hse', 'hira-summary'], queryFn: () => hse.get('/hira/summary'), retry: false });
  if (id) return <section aria-labelledby="hr-h"><Hira id={id} /></section>; if (sp.get('new')) return <HiraNew />;
  return (
    <section aria-labelledby="hrl-h" data-testid="hse-hira"><h1 id="hrl-h">{t('hira.title')}</h1><p className="muted">{t('hira.intro')}</p>
      {sum.data && <p data-testid="hse-hira-summary">{t('hira.summary', { approved: sum.data.approved, pending: sum.data.pending })} {sum.data.byLevel.map((l) => `${t(`risk.${l.level}`)}: ${l.approved}`).join(' · ')}</p>}
      <div className="actions-row no-print"><Link to="/hse/hira?new=1" data-testid="hse-hira-new">{t('hira.new')}</Link><button type="button" className="btn" onClick={() => hse.exportFile('/hira/export', 'hira.csv').catch(() => globalThis.alert?.(t('exportFailed')))}>{t('export')}</button></div>
      <ListReport listCode="hse.hira" endpoint="/hse/hira" title={t('hira.title')} session={session.data} rowHref={(r) => `/hse/hira?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/hira?id=${r.id}`)} cardFields={['docNo', 'title', 'risk', 'status']} statusKey="status" empty={{ title: t('hira.emptyTitle'), text: t('hira.emptyBody') }} />
    </section>
  );
}
