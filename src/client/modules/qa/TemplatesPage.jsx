import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { RESULT_TONE, qa } from './api.js';
import { DocBar, Status, sel, useRecord, useRunner } from './QaParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Checklist Template Designer (part 18.01, FR-03): sections of questions (yes/no/NA, numeric with tolerance, text, photo, signature), weights, critical and automatic-fail questions, photo-required questions; a preview applies the server's own rules to sample answers.
// A version in force never changes: it is amended into a new version, approved by the owner of the module and the quality control manager.
const MODULES = ['QUALITY', 'HSE', 'PLANT', 'STORES', 'HANDOVER', 'SNAG']; const TYPES = ['YESNO', 'NUMERIC', 'TEXT', 'PHOTO', 'SIGNATURE'];
const q0 = (n) => ({ code: `Q${n}`, text: '', type: 'YESNO', weight: '1', critical: false, autoFail: false, photoRequired: false, target: '', tolPlus: '', tolMinus: '', min: '', max: '', unit: '' });
const num = (v) => (v === '' || v == null ? undefined : Number(v));
const toApi = (sections) => sections.map((s) => ({ code: s.code, title: s.title, questions: s.questions.map((q) => { const o = { code: q.code, text: q.text, type: q.type, weight: num(q.weight) ?? 1, critical: q.critical, autoFail: q.autoFail, photoRequired: q.photoRequired }; if (q.type === 'NUMERIC') Object.assign(o, { unit: q.unit || null, target: num(q.target), tolPlus: num(q.tolPlus), tolMinus: num(q.tolMinus), min: num(q.min), max: num(q.max) }); return JSON.parse(JSON.stringify(o)); }) }));
const fromApi = (sections) => sections.map((s) => ({ code: s.code, title: s.title, questions: s.questions.map((q) => ({ ...q0(1), ...q, weight: String(q.weight ?? 1), target: q.target ?? '', tolPlus: q.tolPlus ?? '', tolMinus: q.tolMinus ?? '', min: q.min ?? '', max: q.max ?? '', unit: q.unit ?? '' })) }));
function Preview({ sections, passPct }) {
  const t = useT('qa'); const [ans, setAns] = useState({}); const [out, setOut] = useState(null); const { error, run, busy } = useRunner(); const qs = sections.flatMap((s) => s.questions);
  const go = async () => { const answers = qs.map((q) => ({ questionCode: q.code, ...(q.type === 'YESNO' ? { answer: ans[q.code]?.v ?? null } : {}), ...(q.type === 'NUMERIC' ? { numValue: ans[q.code]?.v === '' || ans[q.code]?.v == null ? null : Number(ans[q.code].v) } : {}), ...(q.type === 'TEXT' ? { textValue: ans[q.code]?.v ?? null } : {}), photoCount: ans[q.code]?.photo ? 1 : 0 })); const d = await run(() => qa.preview({ sections: toApi(sections), scoring: { passPct }, answers }), null); if (d) setOut(d); };
  return (
    <div className="mdm-panel" data-testid="tpl-preview"><h2>{t('tpl.preview')}</h2><p className="muted">{t('tpl.previewHint')}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="preview-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {qs.filter((q) => q.code && q.text).map((q) => (
        <div key={q.code} className="form-grid"><span>{q.code} {q.text}</span>
          {q.type === 'YESNO' && <select aria-label={q.code} value={ans[q.code]?.v ?? ''} onChange={(e) => setAns({ ...ans, [q.code]: { ...ans[q.code], v: e.target.value } })} style={sel} data-testid={`pv-${q.code}`}><option value="">—</option><option value="YES">{t('yes')}</option><option value="NO">{t('no')}</option><option value="NA">{t('na')}</option></select>}
          {q.type === 'NUMERIC' && <input aria-label={q.code} type="number" step="any" value={ans[q.code]?.v ?? ''} onChange={(e) => setAns({ ...ans, [q.code]: { ...ans[q.code], v: e.target.value } })} style={sel} data-testid={`pv-${q.code}`} />}
          {q.type === 'TEXT' && <input aria-label={q.code} value={ans[q.code]?.v ?? ''} onChange={(e) => setAns({ ...ans, [q.code]: { ...ans[q.code], v: e.target.value } })} style={sel} />}
          {(q.photoRequired || q.type === 'PHOTO') && <label><input type="checkbox" checked={Boolean(ans[q.code]?.photo)} onChange={(e) => setAns({ ...ans, [q.code]: { ...ans[q.code], photo: e.target.checked } })} /> {t('tpl.photoTaken')}</label>}
        </div>))}
      <button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={go} data-testid="pv-go">{t('tpl.runPreview')}</button>
      {out && <div data-testid="pv-result" data-result={out.result}><p><StatusBadge status={RESULT_TONE[out.result]} label={t(`res.${out.result}`)} /> {out.scorePct != null ? `${out.scorePct} %` : ''}</p>{out.failed.length > 0 && <ul>{out.failed.map((f) => <li key={f.questionCode} data-testid="pv-failed">{f.questionCode} {f.text}</li>)}</ul>}{out.missing.length > 0 && <p className="muted">{t('tpl.missing', { n: out.missing.length })}</p>}</div>}
    </div>
  );
}
function Designer({ id }) {
  const t = useT('qa'); usePageTitle(t('tpl.designer')); const { error, run, busy } = useRunner(); const rq = useQuery({ queryKey: ['qa', '/templates', id], queryFn: () => qa.one('/templates', id), enabled: Boolean(id), retry: false }); const [f, setF] = useState(null); const x = rq.data;
  if (id && x && !f) setF({ code: x.code, name: x.name, module: x.module, passPct: String(x.scoring?.passPct ?? 80), consultant: Boolean(x.scoring?.consultantSignature), sections: fromApi(x.sections), rowVersion: x.version });
  const form = f ?? (id ? null : { code: '', name: '', module: 'QUALITY', passPct: '80', consultant: false, sections: [{ code: 'S1', title: '', questions: [q0(1)] }] });
  if (id && rq.error?.status === 403) return <NoPermission what={t('tpl.designer')} permission="qa.template.edit" />; if (!form) return <Skeleton label={t('tpl.designer')} rows={4} />;
  const set = (k, v) => setF({ ...form, [k]: v }); const upd = (si, fn) => set('sections', form.sections.map((s, i) => (i === si ? fn(s) : s))); const setQ = (si, qi, k, v) => upd(si, (s) => ({ ...s, questions: s.questions.map((q, j) => (j === qi ? { ...q, [k]: v } : q)) }));
  const body = () => ({ name: form.name, module: form.module, sections: toApi(form.sections), scoring: { passPct: Number(form.passPct) || 80, ...(form.consultant ? { consultantSignature: true } : {}) } });
  const save = async () => { const d = await run(() => (id ? qa.edit('/templates', id, { ...body(), rowVersion: form.rowVersion }) : qa.make('/templates', { code: form.code, ...body() })), t('saved')); if (d) navigateTo(`/qa/templates?id=${d.id}`); };
  return (
    <section aria-labelledby="tpl-h" data-testid="qa-template-designer"><PageHeader id="tpl-h" title={id ? t('tpl.designer') : t('tpl.new')} subtitle={<Link to="/qa/templates">{t('tpl.title')}</Link>} />
      {error?.form && <p className="field-error" role="alert" data-testid="tpl-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid">
        <Field label={t('code')} name="code" error={error}><input value={form.code} disabled={Boolean(id)} onChange={(e) => set('code', e.target.value)} maxLength={40} style={sel} data-testid="tpl-code" /></Field>
        <Field label={t('name')} name="name" error={error}><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={200} style={sel} data-testid="tpl-name" /></Field>
        <Field label={t('module')} name="module" error={error}><select value={form.module} onChange={(e) => set('module', e.target.value)} style={sel} data-testid="tpl-module">{MODULES.map((m) => <option key={m} value={m}>{t(`mod.${m}`)}</option>)}</select></Field>
        <Field label={t('tpl.passPct')} name="passPct" error={error}><input type="number" min="0" max="100" value={form.passPct} onChange={(e) => set('passPct', e.target.value)} style={sel} data-testid="tpl-pass" /></Field>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}><input type="checkbox" checked={form.consultant} onChange={(e) => set('consultant', e.target.checked)} />{t('tpl.consultantSign')}</label></div></div>
      {form.sections.map((s, si) => (
        <div className="mdm-panel" key={si} data-testid="tpl-section"><div className="form-grid"><Field label={t('tpl.sectionCode')} name={`sc${si}`} error={error}><input value={s.code} onChange={(e) => upd(si, (z) => ({ ...z, code: e.target.value }))} maxLength={30} style={sel} /></Field><Field label={t('tpl.sectionTitle')} name={`st${si}`} error={error}><input value={s.title} onChange={(e) => upd(si, (z) => ({ ...z, title: e.target.value }))} maxLength={200} style={sel} data-testid="tpl-section-title" /></Field></div>
          <div className="table-scroll"><table className="data-table"><thead><tr><th>{t('code')}</th><th>{t('tpl.question')}</th><th>{t('tpl.type')}</th><th>{t('tpl.weight')}</th><th>{t('tpl.critical')}</th><th>{t('tpl.autoFail')}</th><th>{t('tpl.photoReq')}</th><th>{t('tpl.target')}</th><th>{t('tpl.tolPlus')}</th><th>{t('tpl.tolMinus')}</th><th>{t('tpl.unit')}</th><th /></tr></thead>
            <tbody>{s.questions.map((q, qi) => (
              <tr key={qi} data-testid="tpl-question">
                <td><input aria-label={t('code')} value={q.code} onChange={(e) => setQ(si, qi, 'code', e.target.value)} maxLength={30} style={{ ...sel, width: 70 }} data-testid="q-code" /></td>
                <td><input aria-label={t('tpl.question')} value={q.text} onChange={(e) => setQ(si, qi, 'text', e.target.value)} maxLength={400} style={sel} data-testid="q-text" /></td>
                <td><select aria-label={t('tpl.type')} value={q.type} onChange={(e) => setQ(si, qi, 'type', e.target.value)} style={sel} data-testid="q-type">{TYPES.map((y) => <option key={y} value={y}>{t(`qt.${y}`)}</option>)}</select></td>
                <td><input aria-label={t('tpl.weight')} type="number" min="1" value={q.weight} onChange={(e) => setQ(si, qi, 'weight', e.target.value)} style={{ ...sel, width: 60 }} /></td>
                <td><input aria-label={t('tpl.critical')} type="checkbox" checked={q.critical} onChange={(e) => setQ(si, qi, 'critical', e.target.checked)} /></td>
                <td><input aria-label={t('tpl.autoFail')} type="checkbox" checked={q.autoFail} onChange={(e) => setQ(si, qi, 'autoFail', e.target.checked)} data-testid="q-autofail" /></td>
                <td><input aria-label={t('tpl.photoReq')} type="checkbox" checked={q.photoRequired} onChange={(e) => setQ(si, qi, 'photoRequired', e.target.checked)} data-testid="q-photo" /></td>
                {q.type === 'NUMERIC' ? <><td><input aria-label={t('tpl.target')} type="number" step="any" value={q.target} onChange={(e) => setQ(si, qi, 'target', e.target.value)} style={{ ...sel, width: 80 }} data-testid="q-target" /></td><td><input aria-label={t('tpl.tolPlus')} type="number" step="any" min="0" value={q.tolPlus} onChange={(e) => setQ(si, qi, 'tolPlus', e.target.value)} style={{ ...sel, width: 70 }} data-testid="q-tolplus" /></td><td><input aria-label={t('tpl.tolMinus')} type="number" step="any" min="0" value={q.tolMinus} onChange={(e) => setQ(si, qi, 'tolMinus', e.target.value)} style={{ ...sel, width: 70 }} data-testid="q-tolminus" /></td><td><input aria-label={t('tpl.unit')} value={q.unit} onChange={(e) => setQ(si, qi, 'unit', e.target.value)} maxLength={20} style={{ ...sel, width: 60 }} /></td></> : <td colSpan={4} />}
                <td><button type="button" className="btn" disabled={s.questions.length < 2} onClick={() => upd(si, (z) => ({ ...z, questions: z.questions.filter((_, j) => j !== qi) }))}>{t('remove')}</button></td></tr>))}</tbody></table></div>
          <div className="actions-row"><button type="button" className="btn" onClick={() => upd(si, (z) => ({ ...z, questions: [...z.questions, q0(form.sections.reduce((n, y) => n + y.questions.length, 0) + 1)] }))} data-testid="tpl-add-question">{t('tpl.addQuestion')}</button><button type="button" className="btn" disabled={form.sections.length < 2} onClick={() => set('sections', form.sections.filter((_, i) => i !== si))}>{t('tpl.removeSection')}</button></div></div>))}
      <div className="actions-row"><button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => set('sections', [...form.sections, { code: `S${form.sections.length + 1}`, title: '', questions: [q0(form.sections.reduce((n, y) => n + y.questions.length, 0) + 1)] }])} data-testid="tpl-add-section">{t('tpl.addSection')}</button><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={save} data-testid="tpl-save">{t('save')}</button></div>
      <Preview sections={form.sections} passPct={Number(form.passPct) || 80} />
    </section>
  );
}
function Template({ id }) {
  const t = useT('qa'); const { q, guard } = useRecord('/templates', id, t('tpl.title'), 'qa.template.view'); usePageTitle(t('tpl.title')); if (guard) return guard; const x = q.data;
  return (
    <div data-testid="qa-template-object" data-status={x.status}><PageHeader id="tpl-h" title={<>{x.name} <small>v{x.versionNo}</small> <Status x={x} /></>} meta={<><Link to="/qa/templates">{t('tpl.title')}</Link> · {x.code} · {t(`mod.${x.module}`)} · {t('tpl.usedBy', { n: x.used })}</>} />
      <DocBar kind="/templates" x={x} printName={`${x.code}-v${x.versionNo}.pdf`} extra={x.can.edit ? <button type="button" className="btn" style={{ minHeight: 44 }} onClick={() => navigateTo(`/qa/templates?edit=${x.id}`)} data-testid="tpl-edit">{t('edit')}</button> : null} />
      {x.sections.map((s) => <div className="table-scroll" key={s.code}><table className="data-table" data-testid="tpl-view"><caption>{s.title}</caption><thead><tr><th>{t('code')}</th><th>{t('tpl.question')}</th><th>{t('tpl.type')}</th><th>{t('tpl.weight')}</th><th>{t('tpl.rules')}</th></tr></thead><tbody>{s.questions.map((q) => <tr key={q.code}><td>{q.code}</td><td>{q.text}</td><td>{t(`qt.${q.type}`)}</td><td>{q.weight ?? 1}</td><td>{[q.critical && t('tpl.critical'), q.autoFail && t('tpl.autoFail'), q.photoRequired && t('tpl.photoReq'), q.type === 'NUMERIC' && (q.target != null ? `${q.target} +${q.tolPlus ?? 0}/-${q.tolMinus ?? 0} ${q.unit ?? ''}` : `${q.min ?? ''}…${q.max ?? ''} ${q.unit ?? ''}`)].filter(Boolean).join(' · ')}</td></tr>)}</tbody></table></div>)}
      <Preview sections={fromApi(x.sections)} passPct={x.scoring?.passPct ?? 80} />
    </div>
  );
}
export default function TemplatesPage() {
  const t = useT('qa'); usePageTitle(t('tpl.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const edit = Number(sp.get('edit')) || null; const session = useSession();
  if (sp.get('new')) return <Designer id={null} />; if (edit) return <Designer id={edit} />; if (id) return <section aria-labelledby="tpl-h"><Template id={id} /></section>;
  return (
    <section aria-labelledby="tl-h" data-testid="qa-templates"><PageHeader id="tl-h" title={t('tpl.title')} subtitle={t('tpl.intro')} />
      <div className="actions-row no-print"><Link to="/qa/templates?new=1">{t('tpl.new')}</Link></div>
      <ListReport listCode="qa.templates" endpoint="/qa/templates" title={t('tpl.title')} session={session.data} rowHref={(r) => `/qa/templates?id=${r.id}`} onOpen={(r) => navigateTo(`/qa/templates?id=${r.id}`)} cardFields={['code', 'name', 'status']} statusKey="status" empty={{ title: t('tpl.emptyTitle'), text: t('tpl.emptyBody') }} />
    </section>
  );
}
