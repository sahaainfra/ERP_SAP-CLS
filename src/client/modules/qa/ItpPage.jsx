import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { qa } from './api.js';
import { DocBar, Status, sel, useRecord, useRunner } from './QaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// ITP Library and Editor (part 18.01, FR-02, FR-05): the plans with their steps and hold, witness, review and surveillance points; an approved plan is applied to the activities of a project to plan the inspection points.
const ACTS = ['EXCAVATION', 'PCC', 'RCC', 'MASONRY', 'PLASTER', 'WATERPROOFING', 'MEP', 'ROAD', 'OTHER']; const POINTS = ['HOLD', 'WITNESS', 'REVIEW', 'SURVEILLANCE'];
const blank = (n) => ({ code: `S${n}`, seq: n, description: '', pointType: 'HOLD', criteria: '', standardRef: '', frequency: '', responsibility: 'CONTRACTOR', records: [] });
function Editor({ id }) {
  const t = useT('qa'); usePageTitle(t('itp.edit')); const { error, run, busy } = useRunner(); const rq = useQuery({ queryKey: ['qa', '/itps', id], queryFn: () => qa.one('/itps', id), enabled: Boolean(id), retry: false });
  const [f, setF] = useState(null); const x = rq.data; if (id && x && !f) setF({ code: x.code, title: x.title, activityType: x.activityType, standardRef: x.standardRef ?? '', steps: x.steps, rowVersion: x.version });
  const form = f ?? (id ? null : { code: '', title: '', activityType: 'RCC', standardRef: '', steps: [blank(1)] });
  if (id && rq.error?.status === 403) return <NoPermission what={t('itp.edit')} permission="qa.itp.edit" />; if (!form) return <Skeleton label={t('itp.edit')} rows={4} />;
  const set = (k, v) => setF({ ...form, [k]: v }); const setStep = (i, k, v) => set('steps', form.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const save = async () => { const body = { title: form.title, activityType: form.activityType, standardRef: form.standardRef || null, steps: form.steps.map((s, i) => ({ ...s, seq: i + 1 })) }; const d = await run(() => (id ? qa.edit('/itps', id, { ...body, rowVersion: form.rowVersion }) : qa.make('/itps', { code: form.code, ...body })), t('saved')); if (d) navigateTo(`/qa/itps?id=${d.id}`); };
  return (
    <section aria-labelledby="itp-h" data-testid="qa-itp-editor"><PageHeader id="itp-h" title={id ? t('itp.edit') : t('itp.new')} subtitle={<Link to="/qa/itps">{t('itp.title')}</Link>} />
      {error?.form && <p className="field-error" role="alert" data-testid="itp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('code')} name="code" error={error}><input value={form.code} disabled={Boolean(id)} onChange={(e) => set('code', e.target.value)} maxLength={40} style={sel} data-testid="itp-code" /></Field>
        <Field label={t('title')} name="title" error={error}><input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} style={sel} data-testid="itp-title" /></Field>
        <Field label={t('itp.activity')} name="activityType" error={error}><select value={form.activityType} onChange={(e) => set('activityType', e.target.value)} style={sel} data-testid="itp-type">{ACTS.map((a) => <option key={a} value={a}>{t(`act.${a}`)}</option>)}</select></Field>
        <Field label={t('itp.standard')} name="standardRef" error={error}><input value={form.standardRef} onChange={(e) => set('standardRef', e.target.value)} maxLength={200} style={sel} data-testid="itp-standard" /></Field></div></div>
      <div className="table-scroll"><table className="data-table" data-testid="itp-steps"><caption>{t('itp.steps')}</caption><thead><tr><th>#</th><th>{t('code')}</th><th>{t('itp.check')}</th><th>{t('itp.point')}</th><th>{t('itp.criteria')}</th><th>{t('itp.standard')}</th><th>{t('itp.frequency')}</th><th>{t('itp.responsibility')}</th><th /></tr></thead>
        <tbody>{form.steps.map((s, i) => (
          <tr key={i} data-testid="itp-step"><td>{i + 1}</td>
            <td><input aria-label={t('code')} value={s.code} onChange={(e) => setStep(i, 'code', e.target.value)} maxLength={30} style={{ ...sel, width: 70 }} data-testid="step-code" /></td>
            <td><input aria-label={t('itp.check')} value={s.description} onChange={(e) => setStep(i, 'description', e.target.value)} maxLength={500} style={sel} data-testid="step-desc" /></td>
            <td><select aria-label={t('itp.point')} value={s.pointType} onChange={(e) => setStep(i, 'pointType', e.target.value)} style={sel} data-testid="step-type">{POINTS.map((p) => <option key={p} value={p}>{t(`pt.${p}`)}</option>)}</select></td>
            <td><input aria-label={t('itp.criteria')} value={s.criteria} onChange={(e) => setStep(i, 'criteria', e.target.value)} maxLength={500} style={sel} /></td>
            <td><input aria-label={t('itp.standard')} value={s.standardRef} onChange={(e) => setStep(i, 'standardRef', e.target.value)} maxLength={120} style={sel} /></td>
            <td><input aria-label={t('itp.frequency')} value={s.frequency} onChange={(e) => setStep(i, 'frequency', e.target.value)} maxLength={120} style={sel} /></td>
            <td><input aria-label={t('itp.responsibility')} value={s.responsibility} onChange={(e) => setStep(i, 'responsibility', e.target.value)} maxLength={60} style={sel} /></td>
            <td><button type="button" className="btn" disabled={form.steps.length < 2} onClick={() => set('steps', form.steps.filter((_, j) => j !== i))}>{t('remove')}</button></td></tr>))}</tbody></table></div>
      <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => set('steps', [...form.steps, blank(form.steps.length + 1)])} data-testid="itp-add-step">{t('itp.addStep')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={save} data-testid="itp-save">{t('save')}</button></div>
    </section>
  );
}
function Apply({ x }) {
  const t = useT('qa'); const { error, run, busy, note } = useRunner(); const [projectId, setProjectId] = useState(''); const [picked, setPicked] = useState([]); const oq = useQuery({ queryKey: ['qa', 'options'], queryFn: () => qa.options({}), retry: false }); const aq = useQuery({ queryKey: ['qa', 'activities', projectId], queryFn: () => qa.activities(projectId), enabled: Boolean(projectId), retry: false });
  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((y) => y !== id) : [...p, id]));
  return (
    <div className="mdm-panel no-print" data-testid="itp-apply"><h2>{t('itp.apply')}</h2><p className="muted">{t('itp.applyHint')}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="apply-error">{error.form}</p>}{note && <p className="mdm-banner" role="status" data-testid="apply-note">{note}</p>}
      <Field label={t('project')} name="projectId" error={error}><select value={projectId} onChange={(e) => { setProjectId(e.target.value); setPicked([]); }} style={sel} data-testid="apply-project"><option value="">—</option>{(oq.data?.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}</select></Field>
      {(aq.data ?? []).length > 0 && <fieldset><legend>{t('itp.activities')}</legend>{aq.data.map((a) => <label key={a.id} style={{ display: 'flex', gap: 8, minHeight: 36, alignItems: 'center' }}><input type="checkbox" checked={picked.includes(a.id)} onChange={() => toggle(a.id)} data-testid="apply-activity" />{a.code} {a.name}</label>)}</fieldset>}
      <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !picked.length} onClick={() => run(() => qa.post(`/itps/${x.id}/apply`, { projectId: Number(projectId), activityIds: picked }).then((d) => d), t('itp.applied'))} data-testid="apply-go">{t('itp.apply')}</button></div>
  );
}
function Itp({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/itps', id, t('itp.title'), 'qa.itp.view'); usePageTitle(t('itp.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="qa-itp-object" data-status={x.status}><PageHeader id="itp-h" title={<>{x.code} <small>v{x.versionNo}</small> <Status x={x} /></>} meta={<><Link to="/qa/itps">{t('itp.title')}</Link> · {x.title} · {t(`act.${x.activityType}`)}{x.standardRef ? ` · ${x.standardRef}` : ''}</>} />
      <DocBar kind="/itps" x={x} printName={`${x.code}-v${x.versionNo}.pdf`} extra={x.can.edit ? <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => navigateTo(`/qa/itps?edit=${x.id}`)} data-testid="itp-edit">{t('edit')}</button> : null} />
      <div className="table-scroll"><table className="data-table" data-testid="itp-steps-view"><caption>{t('itp.steps')}</caption><thead><tr><th>#</th><th>{t('code')}</th><th>{t('itp.check')}</th><th>{t('itp.point')}</th><th>{t('itp.criteria')}</th><th>{t('itp.standard')}</th><th>{t('itp.frequency')}</th><th>{t('itp.responsibility')}</th></tr></thead>
        <tbody>{x.steps.map((s) => <tr key={s.code}><td>{s.seq}</td><td>{s.code}</td><td>{s.description}</td><td>{t(`pt.${s.pointType}`)}</td><td>{s.criteria}</td><td>{s.standardRef}</td><td>{s.frequency}</td><td>{s.responsibility}</td></tr>)}</tbody></table></div>
      <p className="muted">{t('itp.pointsPlanned', { n: x.points ?? 0 })}</p>{x.can.apply && <Apply x={x} />}
    </div>
  );
}
export default function ItpPage() {
  const t = useT('qa'); usePageTitle(t('itp.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const edit = Number(sp.get('edit')) || null; const session = useSession();
  if (sp.get('new')) return <Editor id={null} />; if (edit) return <Editor id={edit} />; if (id) return <section aria-labelledby="itp-h"><Itp id={id} /></section>;
  return (
    <section aria-labelledby="il-h" data-testid="qa-itps"><PageHeader id="il-h" title={t('itp.title')} subtitle={t('itp.intro')} />
      <div className="actions-row no-print"><Link to="/qa/itps?new=1">{t('itp.new')}</Link><button type="button" className="btn" onClick={() => qa.exportFile('/export?kind=itps', 'itps.csv').catch(() => globalThis.alert?.(t('exportFailed')))} data-testid="itp-export">{t('export')}</button></div>
      <ListReport listCode="qa.itps" endpoint="/qa/itps" title={t('itp.title')} session={session.data} rowHref={(r) => `/qa/itps?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/itps?id=${r.id}`)} cardFields={['code', 'title', 'status']} statusKey="status" empty={{ title: t('itp.emptyTitle'), text: t('itp.emptyBody') }} />
    </section>
  );
}
