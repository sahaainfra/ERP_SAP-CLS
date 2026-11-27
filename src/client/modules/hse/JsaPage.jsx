import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, hse } from './api.js';
import { ErrorLine, ProjectSite, big, today, useRecord, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// JSA Builder (part 19.01, FR-03): the task broken into steps with hazard, control and the person responsible; released by someone other than its preparer; the crew acknowledges by badge scan or name; closed after the work.
const TONE = { DRAFT: 'DRAFT', ISSUED: 'APPROVED', COMPLETED: 'APPROVED', CANCELLED: 'CANCELLED' }; const blankS = { step: '', hazard: '', control: '', responsible: '' };
function JsaForm({ initial, onSave, busy, error }) {
  const t = useT('hse'); const [v, setV] = useState(initial); const o = useQuery({ queryKey: ['hse', 'jsa-options', v.projectId], queryFn: () => hse.get(`/jsa/options${v.projectId ? `?projectId=${v.projectId}` : ''}`), placeholderData: (p) => p, retry: false });
  if (o.error?.status === 403) return <NoPermission what={t('jsa.title')} permission="hse.jsa.create" />; if (o.isPending) return <Skeleton label={t('jsa.title')} rows={3} />;
  const setS = (i, k, val) => setV({ ...v, steps: v.steps.map((s, j) => (j === i ? { ...s, [k]: val } : s)) });
  return (
    <div className="mdm-panel" data-testid="hse-jsa-form"><div className="form-grid">
      {!initial.id && <ProjectSite o={o.data} v={v} set={setV} error={error} siteOptional />}
      <Field label={t('jsa.task')} name="task" error={error}><input value={v.task} onChange={(e) => setV({ ...v, task: e.target.value })} maxLength={300} style={big} data-testid="hse-jsa-task" /></Field>
      <Field label={t('jsa.hira')} name="hiraId" error={error}><select value={v.hiraId} onChange={(e) => setV({ ...v, hiraId: e.target.value })} style={big} data-testid="hse-jsa-hira"><option value="">—</option>{(o.data?.hiras ?? []).map((h) => <option key={h.id} value={h.id}>{h.docNo} {h.title}</option>)}</select></Field>
      <Field label={t('jsa.activity')} name="activityId" error={error}><select value={v.activityId} onChange={(e) => setV({ ...v, activityId: e.target.value })} style={big} data-testid="hse-jsa-activity"><option value="">—</option>{(o.data?.activities ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}</select></Field>
      <Field label={t('jsa.wa')} name="waId" error={error}><select value={v.waId} onChange={(e) => setV({ ...v, waId: e.target.value })} style={big}><option value="">—</option>{(o.data?.was ?? []).map((a) => <option key={a.id} value={a.id}>{a.waNo}</option>)}</select></Field>
      <Field label={t('jsa.validOn')} name="validOn" error={error}><input type="date" min={today()} value={v.validOn} onChange={(e) => setV({ ...v, validOn: e.target.value })} style={big} /></Field>
      <Field label={t('jsa.method')} name="methodStatementRef" error={error}><input value={v.methodStatementRef} onChange={(e) => setV({ ...v, methodStatementRef: e.target.value })} maxLength={120} style={big} /></Field></div>
      <h2>{t('jsa.steps')}</h2>
      {v.steps.map((s, i) => (
        <div className="form-grid" key={i} data-testid="hse-jsa-step"><Field label={t('jsa.stepN', { n: i + 1 })} name={`s${i}`} error={error}><input value={s.step} onChange={(e) => setS(i, 'step', e.target.value)} style={big} data-testid="hse-jsa-step-text" /></Field><Field label={t('jsa.hazard')} name={`h${i}`} error={error}><input value={s.hazard} onChange={(e) => setS(i, 'hazard', e.target.value)} style={big} data-testid="hse-jsa-step-hazard" /></Field><Field label={t('jsa.control')} name={`k${i}`} error={error}><input value={s.control} onChange={(e) => setS(i, 'control', e.target.value)} style={big} data-testid="hse-jsa-step-control" /></Field><Field label={t('jsa.responsible')} name={`r${i}`} error={error}><input value={s.responsible} onChange={(e) => setS(i, 'responsible', e.target.value)} style={big} /></Field>
          {v.steps.length > 1 && <button type="button" className="btn" onClick={() => setV({ ...v, steps: v.steps.filter((_, j) => j !== i) })}>{t('remove')}</button>}</div>
      ))}
      <div className="actions-row"><button type="button" className="btn" onClick={() => setV({ ...v, steps: [...v.steps, { ...blankS }] })} data-testid="hse-jsa-add">{t('jsa.addStep')}</button>
        <button type="button" className="btn btn-primary" style={big} disabled={busy || v.task.trim().length < 3 || (!initial.id && !v.projectId)} onClick={() => onSave(v)} data-testid="hse-jsa-save">{t('save')}</button></div></div>
  );
}
const idOrNull = (s) => (s ? Number(s) : null); const body = (v) => ({ task: v.task, hiraId: idOrNull(v.hiraId), activityId: idOrNull(v.activityId), waId: idOrNull(v.waId), methodStatementRef: v.methodStatementRef || null, validOn: v.validOn || undefined, steps: v.steps });
function Jsa({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/jsa', id, t('jsa.title'), 'hse.jsa.view'); const { error, run, busy, note } = useRunner(); const [editing, setEditing] = useState(false); const [badge, setBadge] = useState(''); const [name, setName] = useState(''); usePageTitle(t('jsa.title')); if (guard) return guard; const x = q.data;
  const act = (a, b, msg) => run(() => hse.act('/jsa', x.id, a, b), msg);
  return (
    <div data-testid="hse-jsa-object" data-status={x.status}><PageHeader id="js-h" title={<>{x.docNo} <StatusBadge status={TONE[x.status]} label={t(`jsa.st.${x.status}`)} /></>} meta={<><Link to="/hse/jsa">{t('jsa.title')}</Link> · {x.project} · {x.task} · {t('jsa.validOn')} {fmtDate(x.validOn)}{x.hira ? ` · ${x.hira.docNo} (${t(`risk.${x.hira.riskLevel}`)})` : ''}</>} />
      <ErrorLine error={error} id="hse-jsa-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-jsa-note">{note}</p>}
      <div className="actions-row no-print">
        {x.can.edit && <button type="button" className="btn" onClick={() => setEditing(!editing)} data-testid="hse-jsa-edit">{t('edit')}</button>}
        {x.can.release && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => act('release', {}, t('jsa.released'))} data-testid="hse-jsa-release">{t('jsa.release')}</button>}
        {x.can.complete && <button type="button" className="btn" disabled={busy} onClick={() => act('complete', {}, t('jsa.completed'))} data-testid="hse-jsa-complete">{t('jsa.complete')}</button>}
        {x.can.cancel && <button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) act('cancel', { reason: r }, t('cancelled')); }} data-testid="hse-jsa-cancel">{t('cancel')}</button>}
        {x.can.print && <button type="button" className="btn" onClick={() => hse.exportFile(`/jsa/${x.id}/print`, `${x.docNo}.pdf`).catch(() => globalThis.alert?.(t('exportFailed')))}>{t('print')}</button>}</div>
      {editing && x.can.edit ? <JsaForm initial={{ id: x.id, projectId: x.projectId, task: x.task, hiraId: x.hiraId ?? '', activityId: x.activityId ?? '', waId: x.waId ?? '', methodStatementRef: x.methodStatementRef ?? '', validOn: x.validOn ?? '', steps: x.steps }} busy={busy} error={error} onSave={async (v) => { const r = await run(() => hse.edit('/jsa', x.id, { ...body(v), rowVersion: x.version }), t('saved')); if (r) setEditing(false); }} /> : (
        <div className="table-scroll" data-testid="hse-jsa-steps"><table className="data-table"><thead><tr><th>#</th><th>{t('jsa.step')}</th><th>{t('jsa.hazard')}</th><th>{t('jsa.control')}</th><th>{t('jsa.responsible')}</th></tr></thead><tbody>{x.steps.map((s, i) => <tr key={i}><td>{i + 1}</td><td>{s.step}</td><td>{s.hazard}</td><td>{s.control}</td><td>{s.responsible}</td></tr>)}</tbody></table></div>)}
      <div className="mdm-panel" data-testid="hse-jsa-crew"><h2>{t('jsa.crew', { n: x.participantCount })}</h2>
        <ul>{x.participants.map((p, i) => <li key={i}>{p.name}</li>)}</ul>
        {x.can.sign && <div className="form-grid no-print"><Field label={t('jsa.scan')} name="badge" error={error}><input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="LAB:…" style={big} data-testid="hse-jsa-badge" /></Field><button type="button" className="btn" disabled={busy || !badge} onClick={async () => { if (await act('sign', { badge }, t('jsa.signed'))) setBadge(''); }} data-testid="hse-jsa-sign-badge">{t('jsa.sign')}</button>
          <Field label={t('jsa.byName')} name="name" error={error}><input value={name} onChange={(e) => setName(e.target.value)} style={big} data-testid="hse-jsa-name" /></Field><button type="button" className="btn" disabled={busy || name.trim().length < 2} onClick={async () => { if (await act('sign', { name }, t('jsa.signed'))) setName(''); }} data-testid="hse-jsa-sign-name">{t('jsa.sign')}</button></div>}</div>
    </div>
  );
}
function JsaNew() {
  const t = useT('hse'); const { error, run, busy } = useRunner(); usePageTitle(t('jsa.new'));
  return <section aria-labelledby="jsn-h"><PageHeader id="jsn-h" title={t('jsa.new')} meta={<Link to="/hse/jsa">{t('jsa.title')}</Link>} /><ErrorLine error={error} id="hse-jsa-error" /><JsaForm initial={{ projectId: '', siteId: '', task: '', hiraId: '', activityId: '', waId: '', methodStatementRef: '', validOn: today(), steps: [{ ...blankS }] }} busy={busy} error={error} onSave={async (v) => { const r = await run(() => hse.make('/jsa', { projectId: Number(v.projectId), siteId: idOrNull(v.siteId), ...body(v) })); if (r) navigateTo(`/hse/jsa?id=${r.id}`); }} /></section>;
}
export default function JsaPage() {
  const t = useT('hse'); usePageTitle(t('jsa.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="js-h"><Jsa id={id} /></section>; if (sp.get('new')) return <JsaNew />;
  return (
    <section aria-labelledby="jsl-h" data-testid="hse-jsa"><PageHeader id="jsl-h" title={t('jsa.title')} subtitle={t('jsa.intro')} />
      <div className="actions-row no-print"><Link to="/hse/jsa?new=1" data-testid="hse-jsa-new">{t('jsa.new')}</Link></div>
      <ListReport listCode="hse.jsa" endpoint="/hse/jsa" exportEndpoint="/ui/lists/hse.jsa/export" title={t('jsa.title')} session={session.data} rowHref={(r) => `/hse/jsa?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/jsa?id=${r.id}`)} cardFields={['docNo', 'task', 'validOn', 'status']} statusKey="status" dateKey="validOn" empty={{ title: t('jsa.emptyTitle'), text: t('jsa.emptyBody') }} />
    </section>
  );
}
