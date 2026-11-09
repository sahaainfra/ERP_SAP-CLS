import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { EmptyState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { trn } from './api.js';

// Training Set-up (HR, part 07.10): the courses (what is taught, internal or external, who must take it and how long it stays valid, the pass mark, the certificate it gives), the types of certificate and licence (validity, the days of warning,
// the posts that need one before a posting) and the skills of the matrix. HR keeps them; every change is audited.
const csv = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
export default function TrainingSetupPage() {
  const t = useT('trn');
  usePageTitle(t('setup.title'));
  const qc = useQueryClient();
  const courses = useQuery({ queryKey: ['trn', 'courses'], queryFn: trn.courses, retry: false });
  const types = useQuery({ queryKey: ['trn', 'cert-types'], queryFn: trn.certTypes, retry: false });
  const skills = useQuery({ queryKey: ['trn', 'skill-defs'], queryFn: trn.skillDefs, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [c, setC] = useState({ code: '', title: '', titleHi: '', category: 'SAFETY', mode: 'INTERNAL', all: false, designations: '', departments: '', trades: '', validityMonths: '', passScore: '', certTypeCode: '' });
  const [ct, setCt] = useState({ code: '', name: '', nameHi: '', validityMonths: '', alertDays: '30', designations: '', trades: '' });
  const [sk, setSk] = useState({ code: '', name: '', nameHi: '', trade: '' });
  if (courses.error?.status === 403) return <NoPermission what={t('setup.title')} permission="hr.session.view" />;
  const save = async (fn, done, reset) => { setError(null); setNote(null); try { await fn(); setNote(done); reset(); qc.invalidateQueries({ queryKey: ['trn'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="su-title" data-testid="training-setup">
      <h1 id="su-title">{t('setup.title')}</h1>
      {error?.form && <p className="field-error" role="alert" data-testid="su-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="su-note">{note}</p>}
      <h2>{t('setup.courses')}</h2>
      {courses.isPending ? <Skeleton label={t('setup.courses')} rows={2} /> : (courses.data ?? []).length === 0 ? <EmptyState title={t('setup.noCourses')} message={t('setup.noCoursesHint')} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('setup.courses')}><table className="grid" data-testid="su-courses"><thead><tr><th>{t('setup.code')}</th><th>{t('s.course')}</th><th>{t('s.mode')}</th><th>{t('setup.mandatory')}</th><th>{t('setup.validity')}</th></tr></thead>
          <tbody>{courses.data.map((x) => <tr key={x.id} data-testid="su-course-row" data-code={x.code}><th scope="row" data-label={t('setup.code')}>{x.code}</th><td data-label={t('s.course')}>{x.title}</td><td data-label={t('s.mode')}>{t(`mode.${x.mode}`)}</td><td data-label={t('setup.mandatory')}>{x.mandatoryFor?.all ? t('setup.everyone') : [...(x.mandatoryFor?.designationCodes ?? []), ...(x.mandatoryFor?.departmentCodes ?? []), ...(x.mandatoryFor?.tradeCodes ?? [])].join(', ') || '—'}</td><td data-label={t('setup.validity')}>{x.validityMonths ? t('setup.months', { n: x.validityMonths }) : '—'}</td></tr>)}</tbody></table></div>
      )}
      <form className="mdm-panel mdm-fields" aria-label={t('setup.newCourse')} data-testid="su-course-form" onSubmit={(e) => { e.preventDefault(); save(() => trn.saveCourse({ code: c.code, title: c.title.trim(), titleHi: c.titleHi.trim() || null, category: c.category, mode: c.mode, mandatoryFor: { ...(c.all ? { all: true } : {}), ...(csv(c.designations).length ? { designationCodes: csv(c.designations) } : {}), ...(csv(c.departments).length ? { departmentCodes: csv(c.departments) } : {}), ...(csv(c.trades).length ? { tradeCodes: csv(c.trades) } : {}) }, validityMonths: c.validityMonths ? Number(c.validityMonths) : null, passScore: c.passScore ? Number(c.passScore) : null, certTypeCode: c.certTypeCode || null }), t('setup.saved'), () => setC({ ...c, code: '', title: '', titleHi: '' })); }}>
        <h3>{t('setup.newCourse')}</h3>
        <Field label={t('setup.code')} name="code" error={error}><input value={c.code} maxLength={30} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} required data-testid="su-c-code" /></Field>
        <Field label={t('s.course')} name="title" error={error}><input value={c.title} maxLength={150} onChange={(e) => setC({ ...c, title: e.target.value })} required data-testid="su-c-title" /></Field>
        <Field label={t('setup.titleHi')} name="titleHi" error={error}><input value={c.titleHi} maxLength={150} onChange={(e) => setC({ ...c, titleHi: e.target.value })} data-testid="su-c-titlehi" /></Field>
        <Field label={t('setup.category')} name="category" error={error}><select value={c.category} onChange={(e) => setC({ ...c, category: e.target.value })} data-testid="su-c-category">{['SAFETY', 'TECHNICAL', 'STATUTORY', 'SOFT', 'OTHER'].map((k) => <option key={k} value={k}>{t(`cat.${k}`)}</option>)}</select></Field>
        <Field label={t('s.mode')} name="mode" error={error}><select value={c.mode} onChange={(e) => setC({ ...c, mode: e.target.value })} data-testid="su-c-mode"><option value="INTERNAL">{t('mode.INTERNAL')}</option><option value="EXTERNAL">{t('mode.EXTERNAL')}</option></select></Field>
        <label className="check"><input type="checkbox" checked={c.all} onChange={(e) => setC({ ...c, all: e.target.checked })} data-testid="su-c-all" /> {t('setup.everyone')}</label>
        <Field label={t('setup.designations')} name="designations" error={error} hint={t('setup.csvHint')}><input value={c.designations} onChange={(e) => setC({ ...c, designations: e.target.value })} data-testid="su-c-desig" /></Field>
        <Field label={t('setup.trades')} name="trades" error={error} hint={t('setup.csvHint')}><input value={c.trades} onChange={(e) => setC({ ...c, trades: e.target.value })} data-testid="su-c-trades" /></Field>
        <Field label={t('setup.validity')} name="validityMonths" error={error}><input type="number" min="1" value={c.validityMonths} onChange={(e) => setC({ ...c, validityMonths: e.target.value })} data-testid="su-c-validity" /></Field>
        <Field label={t('setup.passScore')} name="passScore" error={error}><input type="number" min="0" max="100" value={c.passScore} onChange={(e) => setC({ ...c, passScore: e.target.value })} data-testid="su-c-pass" /></Field>
        <Field label={t('setup.certGives')} name="certTypeCode" error={error}><select value={c.certTypeCode} onChange={(e) => setC({ ...c, certTypeCode: e.target.value })} data-testid="su-c-cert"><option value="">—</option>{(types.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
        <div className="actions"><button type="submit" className="btn btn-primary" data-testid="su-c-save">{t('act.save')}</button></div>
      </form>
      <h2>{t('setup.certTypes')}</h2>
      {(types.data ?? []).length === 0 ? <p className="muted">{t('setup.noTypes')}</p> : <ul className="mdm-list" data-testid="su-types">{types.data.map((x) => <li key={x.id} data-code={x.code}><strong>{x.code}</strong> {x.name} · {x.validityMonths ? t('setup.months', { n: x.validityMonths }) : '—'} · {t('setup.alert', { n: x.alertDays })}{(x.requiredFor?.designationCodes ?? []).length ? ` · ${t('setup.neededBy')} ${x.requiredFor.designationCodes.join(', ')}` : ''}{(x.requiredFor?.tradeCodes ?? []).length ? ` · ${x.requiredFor.tradeCodes.join(', ')}` : ''}</li>)}</ul>}
      <form className="mdm-panel mdm-fields" aria-label={t('setup.newType')} data-testid="su-type-form" onSubmit={(e) => { e.preventDefault(); save(() => trn.saveCertType({ code: ct.code, name: ct.name.trim(), nameHi: ct.nameHi.trim() || null, validityMonths: ct.validityMonths ? Number(ct.validityMonths) : null, alertDays: Number(ct.alertDays || 30), requiredFor: { ...(csv(ct.designations).length ? { designationCodes: csv(ct.designations) } : {}), ...(csv(ct.trades).length ? { tradeCodes: csv(ct.trades) } : {}) }, mandatory: true }), t('setup.saved'), () => setCt({ ...ct, code: '', name: '', nameHi: '' })); }}>
        <h3>{t('setup.newType')}</h3>
        <Field label={t('setup.code')} name="code" error={error}><input value={ct.code} maxLength={30} onChange={(e) => setCt({ ...ct, code: e.target.value.toUpperCase() })} required data-testid="su-t-code" /></Field>
        <Field label={t('cert.type')} name="name" error={error}><input value={ct.name} maxLength={100} onChange={(e) => setCt({ ...ct, name: e.target.value })} required data-testid="su-t-name" /></Field>
        <Field label={t('setup.titleHi')} name="nameHi" error={error}><input value={ct.nameHi} maxLength={100} onChange={(e) => setCt({ ...ct, nameHi: e.target.value })} data-testid="su-t-namehi" /></Field>
        <Field label={t('setup.validity')} name="validityMonths" error={error}><input type="number" min="1" value={ct.validityMonths} onChange={(e) => setCt({ ...ct, validityMonths: e.target.value })} data-testid="su-t-validity" /></Field>
        <Field label={t('setup.alertDays')} name="alertDays" error={error}><input type="number" min="0" value={ct.alertDays} onChange={(e) => setCt({ ...ct, alertDays: e.target.value })} data-testid="su-t-alert" /></Field>
        <Field label={t('setup.neededByDesignations')} name="designations" error={error} hint={t('setup.csvHint')}><input value={ct.designations} onChange={(e) => setCt({ ...ct, designations: e.target.value })} data-testid="su-t-desig" /></Field>
        <Field label={t('setup.neededByTrades')} name="trades" error={error} hint={t('setup.csvHint')}><input value={ct.trades} onChange={(e) => setCt({ ...ct, trades: e.target.value })} data-testid="su-t-trades" /></Field>
        <div className="actions"><button type="submit" className="btn btn-primary" data-testid="su-t-save">{t('act.save')}</button></div>
      </form>
      <h2>{t('setup.skills')}</h2>
      {skills.isPending ? <Skeleton label={t('setup.skills')} rows={2} /> : (skills.data ?? []).length === 0 ? <p className="muted">{t('setup.noSkills')}</p> : <ul className="mdm-list" data-testid="su-skills">{skills.data.map((x) => <li key={x.id} data-code={x.code}><strong>{x.code}</strong> {x.name}{x.trade ? ` · ${x.trade}` : ''}</li>)}</ul>}
      <form className="mdm-panel mdm-fields" aria-label={t('setup.newSkill')} data-testid="su-skill-form" onSubmit={(e) => { e.preventDefault(); save(() => trn.saveSkillDef({ code: sk.code, name: sk.name.trim(), nameHi: sk.nameHi.trim() || null, trade: sk.trade.trim() || null }), t('setup.saved'), () => setSk({ ...sk, code: '', name: '', nameHi: '' })); }}>
        <h3>{t('setup.newSkill')}</h3>
        <Field label={t('setup.code')} name="code" error={error}><input value={sk.code} maxLength={30} onChange={(e) => setSk({ ...sk, code: e.target.value.toUpperCase() })} required data-testid="su-s-code" /></Field>
        <Field label={t('skill.skill')} name="name" error={error}><input value={sk.name} maxLength={100} onChange={(e) => setSk({ ...sk, name: e.target.value })} required data-testid="su-s-name" /></Field>
        <Field label={t('setup.titleHi')} name="nameHi" error={error}><input value={sk.nameHi} maxLength={100} onChange={(e) => setSk({ ...sk, nameHi: e.target.value })} data-testid="su-s-namehi" /></Field>
        <Field label={t('skill.trade')} name="trade" error={error}><input value={sk.trade} maxLength={40} onChange={(e) => setSk({ ...sk, trade: e.target.value })} data-testid="su-s-trade" /></Field>
        <div className="actions"><button type="submit" className="btn btn-primary" data-testid="su-s-save">{t('act.save')}</button></div>
      </form>
      <p className="small"><Link to="/training">{t('cal.title')}</Link> · <Link to="/training/skills">{t('skill.title')}</Link></p>
    </section>
  );
}
