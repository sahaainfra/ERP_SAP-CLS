import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { DELIV_DISCIPLINES, DELIV_TYPES, ep } from './api.js';
import { ProjectSelect } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Deliverable Register (part 11.04, FR-01): every drawing, calculation, specification, data sheet and MTO with its weight, planned dates and progress.
const empty = () => ({ projectId: '', deliverableNo: '', title: '', discipline: 'STRUCTURAL', type: 'DRAWING', packageName: '', weight: 100, planIfr: '', planIfa: '', planIfc: '', planAsbuilt: '' });
export default function DeliverablesPage() {
  const t = useT('engg');
  usePageTitle(t('del.registerTitle'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null;
  const [open, setOpen] = useState(false); const [error, setError] = useState(null); const [f, setF] = useState({ ...empty(), projectId: fp ?? '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const r = await ep.createDeliverable({ projectId: Number(f.projectId), deliverableNo: f.deliverableNo.trim(), title: f.title.trim(), discipline: f.discipline, type: f.type, packageName: f.packageName.trim() || null, weight: Number(f.weight) || 1, planIfr: f.planIfr || null, planIfa: f.planIfa || null, planIfc: f.planIfc || null, planAsbuilt: f.planAsbuilt || null });
      qc.invalidateQueries({ queryKey: ['engg'] }); navigateTo(`/engg/deliverable?id=${r.id}`);
    } catch (x) { setError(errorInfo(x)); }
  };
  const txt = (k, label, props = {}) => <Field label={label} name={k} error={error}><input value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`del-f-${k}`} {...props} /></Field>;
  return (
    <section aria-labelledby="del-list-h" data-testid="eg-deliverables">
      <PageHeader id="del-list-h" srOnly title={t('del.registerTitle')} />
      <div className="actions-row no-print">
        {perms.includes('engg.deliverable.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="del-new">{t('del.new')}</button>}
        <Link to="/engg/progress">{t('prog.title')}</Link>
      </div>
      {open && (
        <form className="mdm-panel" aria-label={t('del.new')} data-testid="del-new-form" onSubmit={create}>
          <h2>{t('del.new')}</h2>
          <div className="form-grid">
            <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="del-f-project" error={error} />
            {txt('deliverableNo', t('del.no'), { required: true, maxLength: 60 })}{txt('title', t('col.title'), { required: true, maxLength: 200 })}
            <Field label={t('col.discipline')} name="discipline" error={error}><select value={f.discipline} onChange={(e) => set('discipline', e.target.value)} data-testid="del-f-discipline">{DELIV_DISCIPLINES.map((k) => <option key={k} value={k}>{t(`ddisc.${k}`)}</option>)}</select></Field>
            <Field label={t('sub.type')} name="type" error={error}><select value={f.type} onChange={(e) => set('type', e.target.value)} data-testid="del-f-type">{DELIV_TYPES.map((k) => <option key={k} value={k}>{t(`dtype.${k}`)}</option>)}</select></Field>
            {txt('packageName', t('col.package'), { maxLength: 80 })}
            <Field label={t('prog.weight')} name="weight" error={error}><input type="number" min="1" value={f.weight} onChange={(e) => set('weight', e.target.value)} data-testid="del-f-weight" /></Field>
            {['planIfr', 'planIfa', 'planIfc', 'planAsbuilt'].map((k) => <Field key={k} label={t(`del.${k}`)} name={k} error={error}><input type="date" value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`del-f-${k}`} /></Field>)}
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="del-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || f.deliverableNo.trim().length < 2 || f.title.trim().length < 3} data-testid="del-create">{t('del.create')}</button></div>
        </form>
      )}
      <ListReport listCode="engg.deliverables" endpoint="/engg/deliverables" title={t('del.registerTitle')} session={session.data} rowHref={(r) => `/engg/deliverable?id=${r.id}`} onOpen={(r) => navigateTo(`/engg/deliverable?id=${r.id}`)} cardFields={['deliverableNo', 'title', 'milestone', 'progress']} statusKey="milestone"
        empty={{ title: t('del.emptyTitle'), text: t('del.emptyBody') }} contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}
