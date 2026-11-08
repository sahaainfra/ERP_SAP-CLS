import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { SUB_TYPES, dayIST, sb } from './api.js';
import { ProjectSelect } from './parts.jsx';

// Submittal Register (part 11.03, FR-01, FR-02): every submittal of the projects you may see; a new one starts as a draft with its required-by date (or the site need date, the lead time and the review days).
const empty = () => ({ projectId: '', type: 'MAR', title: '', specSection: '', activityRef: '', itemId: '', materialRef: '', make: '', model: '', supplier: '', consultant: '', needDate: dayIST(60), leadTimeDays: 21, reviewDays: 14, hseRef: '' });
export default function SubmittalsPage() {
  const t = useT('engg');
  usePageTitle(t('sub.registerTitle'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null;
  const [open, setOpen] = useState(false); const [error, setError] = useState(null); const [f, setF] = useState({ ...empty(), projectId: fp ?? '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const r = await sb.create({ projectId: Number(f.projectId), type: f.type, title: f.title.trim(), specSection: f.specSection.trim() || null, activityRef: f.activityRef.trim() || null, itemId: f.itemId ? Number(f.itemId) : null, materialRef: f.materialRef.trim() || null, make: f.make.trim() || null, model: f.model.trim() || null, supplier: f.supplier.trim() || null, consultant: f.consultant.trim() || null, hseRef: f.hseRef.trim() || null, needDate: f.needDate || null, leadTimeDays: Number(f.leadTimeDays) || 0, reviewDays: Number(f.reviewDays) || 0 });
      qc.invalidateQueries({ queryKey: ['engg'] }); navigateTo(`/engg/submittal?id=${r.id}`);
    } catch (x) { setError(errorInfo(x)); }
  };
  const txt = (k, label, props = {}) => <Field label={label} name={k} error={error}><input value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`sub-f-${k}`} {...props} /></Field>;
  return (
    <section aria-labelledby="sub-list-h" data-testid="eg-submittals">
      <h1 id="sub-list-h" className="sr-only">{t('sub.registerTitle')}</h1>
      <div className="actions-row no-print">
        {perms.includes('engg.submittal.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="sub-new">{t('sub.new')}</button>}
        <Link to="/engg/submittal-schedule">{t('sub.scheduleTitle')}</Link>
      </div>
      {open && (
        <form className="mdm-panel" aria-label={t('sub.new')} data-testid="sub-new-form" onSubmit={create}>
          <h2>{t('sub.new')}</h2>
          <div className="form-grid">
            <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="sub-f-project" error={error} />
            <Field label={t('sub.type')} name="type" error={error}><select value={f.type} onChange={(e) => set('type', e.target.value)} data-testid="sub-f-type">{SUB_TYPES.map((k) => <option key={k} value={k}>{t(`stype.${k}`)}</option>)}</select></Field>
            {txt('title', t('col.title'), { required: true, maxLength: 200 })}{txt('specSection', t('sub.spec'), { maxLength: 120 })}{txt('activityRef', t('f.activity'), { maxLength: 120 })}
            {f.type === 'MAR' && <>
              <LookupField id="sub-f-item" label={t('sub.item')} lookup="mdm/items" value={f.itemId} onChange={(v) => set('itemId', v)} />
              {txt('materialRef', t('sub.material'), { maxLength: 160 })}{txt('make', t('sub.make'), { maxLength: 120 })}{txt('model', t('sub.model'), { maxLength: 120 })}{txt('supplier', t('sub.supplier'), { maxLength: 160 })}
            </>}
            {f.type === 'METHOD_STATEMENT' && txt('hseRef', t('sub.hse'), { maxLength: 120 })}
            {txt('consultant', t('rfi.consultant'), { maxLength: 160 })}
            <Field label={t('sub.needDate')} name="needDate" error={error}><input type="date" value={f.needDate} onChange={(e) => set('needDate', e.target.value)} data-testid="sub-f-need" /></Field>
            <Field label={t('sub.leadTime')} name="leadTimeDays" error={error}><input type="number" min="0" value={f.leadTimeDays} onChange={(e) => set('leadTimeDays', e.target.value)} data-testid="sub-f-lead" /></Field>
            <Field label={t('sub.reviewDays')} name="reviewDays" error={error}><input type="number" min="0" value={f.reviewDays} onChange={(e) => set('reviewDays', e.target.value)} data-testid="sub-f-review" /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="sub-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || f.title.trim().length < 3} data-testid="sub-create">{t('sub.create')}</button></div>
        </form>
      )}
      <ListReport listCode="engg.submittals" endpoint="/engg/submittals" title={t('sub.registerTitle')} session={session.data} rowHref={(r) => `/engg/submittal?id=${r.id}`} onOpen={(r) => navigateTo(`/engg/submittal?id=${r.id}`)} cardFields={['submittalNo', 'title', 'typeLabel', 'statusLabel']} statusKey="statusLabel"
        empty={{ title: t('sub.emptyTitle'), text: t('sub.emptyBody') }} contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}
