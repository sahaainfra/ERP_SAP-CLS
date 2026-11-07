import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { bq } from './api.js';
import { useSearch } from './parts.jsx';

// BOQ Versions (part 10.04, FR-01): the tender, contract and revised versions of the BOQ of every project with their status, items and totals; a new version starts from the award, another version or nothing; a revised version only comes from an approved variation.
export default function BoqVersionsPage() {
  const t = useT('proj');
  usePageTitle(t('bq.listTitle'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const sp = useSearch(); const changeId = sp.get('change');
  const [open, setOpen] = useState(false); const [f, setF] = useState({ projectId: '', vtype: 'TENDER', name: '', from: 'AWARD', sourceVersionId: '' }); const [error, setError] = useState(null);
  const pq = useQuery({ queryKey: ['proj', 'boq-projects'], queryFn: bq.projects, retry: false, enabled: open });
  const vq = useQuery({ queryKey: ['proj', 'boq-source', f.projectId], queryFn: () => bq.versions(`&filter[projectId][eq]=${f.projectId}`), enabled: open && Boolean(f.projectId), retry: false });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await bq.create({ projectId: Number(f.projectId), vtype: f.vtype, name: f.name.trim(), from: f.from, ...(f.from === 'VERSION' ? { sourceVersionId: Number(f.sourceVersionId) } : {}) }); qc.invalidateQueries({ queryKey: ['proj'] }); navigateTo(`/proj/version?id=${r.id}`, { force: true }); } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <section aria-labelledby="bq-list-h" data-testid="boq-versions">
      <h1 id="bq-list-h" className="sr-only">{t('bq.listTitle')}</h1>
      {changeId && <p className="mdm-banner" role="status">{t('bq.changeOpen')}</p>}
      {perms.includes('proj.version.create') && (
        <div className="actions-row no-print">
          <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="bq-new">{t('bq.new')}</button>
          {perms.includes('proj.boq.import') && <Link to="/proj/boq-import">{t('bq.import')}</Link>} <Link to="/proj/boq-reports">{t('bq.reports')}</Link>
        </div>
      )}
      {open && (
        <form className="mdm-panel" onSubmit={create} aria-label={t('bq.new')} data-testid="bq-new-form">
          <h2>{t('bq.new')}</h2>
          <div className="form-grid">
            <Field label={t('st.project')} name="projectId" error={error}><select value={f.projectId} onChange={(e) => set('projectId', e.target.value)} required data-testid="bq-f-project"><option value="">{t('st.chooseProject')}</option>{(pq.data ?? []).map((p) => <option key={p.projectId} value={p.projectId}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={t('f.type')} name="vtype" error={error}><select value={f.vtype} onChange={(e) => set('vtype', e.target.value)} data-testid="bq-f-type"><option value="TENDER">{t('bq.type.TENDER')}</option><option value="CONTRACT">{t('bq.type.CONTRACT')}</option></select></Field>
            <Field label={t('f.name')} name="name" error={error}><input value={f.name} onChange={(e) => set('name', e.target.value)} required maxLength={200} data-testid="bq-f-name" /></Field>
            <Field label={t('bq.from')} name="from" error={error}><select value={f.from} onChange={(e) => set('from', e.target.value)} data-testid="bq-f-from"><option value="AWARD">{t('bq.from.AWARD')}</option><option value="VERSION">{t('bq.from.VERSION')}</option><option value="EMPTY">{t('bq.from.EMPTY')}</option></select></Field>
            {f.from === 'VERSION' && <Field label={t('bq.sourceVersion')} name="sourceVersionId" error={error}><select value={f.sourceVersionId} onChange={(e) => set('sourceVersionId', e.target.value)} data-testid="bq-f-source"><option value="">—</option>{(vq.data ?? []).map((v) => <option key={v.id} value={v.id}>{v.docNo} · {v.name}</option>)}</select></Field>}
          </div>
          <p className="small muted">{t('bq.revisedNote')}</p>
          {error?.form && <p className="field-error" role="alert" data-testid="bq-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || !f.name.trim()} data-testid="bq-f-create">{t('bq.create')}</button></div>
        </form>
      )}
      <ListReport listCode="proj.boq_versions" endpoint="/proj/versions" title={t('bq.listTitle')} session={session.data} rowHref={(r) => `/proj/version?id=${r.id}`} onOpen={(r) => navigateTo(`/proj/version?id=${r.id}`)} cardFields={['docNo', 'name', 'typeLabel', 'statusLabel', 'total']} empty={{ title: t('bq.emptyTitle'), text: t('bq.emptyText') }} />
    </section>
  );
}
