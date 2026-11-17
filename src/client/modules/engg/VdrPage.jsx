import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { VDR_TYPES, dayIST, ep } from './api.js';
import { ProjectSelect } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// VDR Tracker by PO and vendor (part 11.04, FR-04): the documents vendors owe on each purchase order, with their status and the overdue ones.
export default function VdrPage() {
  const t = useT('engg');
  usePageTitle(t('vdr.title'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const [projectId, setProjectId] = useState('');
  const [open, setOpen] = useState(false); const [error, setError] = useState(null); const [f, setF] = useState({ projectId: '', poRef: '', vendor: '', docType: 'GA_DRAWING', title: '', dueDate: dayIST(14) });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const tr = useQuery({ queryKey: ['engg', 'tracker', projectId], queryFn: () => ep.tracker(projectId), retry: false });
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await ep.createVdr({ projectId: Number(f.projectId), poRef: f.poRef.trim(), vendor: f.vendor.trim(), docType: f.docType, title: f.title.trim(), dueDate: f.dueDate }); qc.invalidateQueries({ queryKey: ['engg'] }); navigateTo(`/engg/vdr-item?id=${r.id}`); } catch (x) { setError(errorInfo(x)); }
  };
  if (tr.error?.status === 403) return <NoPermission what={t('vdr.title')} permission="engg.vdr_item.view" />;
  if (tr.isError) return <ErrorState error={tr.error} onRetry={tr.refetch} />;
  const txt = (k, label, props = {}) => <Field label={label} name={k} error={error}><input value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`vdr-f-${k}`} {...props} /></Field>;
  return (
    <section aria-labelledby="vdr-h" data-testid="eg-vdr">
      <PageHeader id="vdr-h" title={t('vdr.title')} />
      <div className="actions-row no-print">{perms.includes('engg.vdr_item.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="vdr-new">{t('vdr.new')}</button>}</div>
      {open && (
        <form className="mdm-panel" aria-label={t('vdr.new')} data-testid="vdr-new-form" onSubmit={create}>
          <h2>{t('vdr.new')}</h2>
          <div className="form-grid">
            <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="vdr-f-project" error={error} />
            {txt('poRef', t('vdr.po'), { required: true, maxLength: 80 })}{txt('vendor', t('vdr.vendor'), { required: true, maxLength: 160 })}
            <Field label={t('vdr.docType')} name="docType" error={error}><select value={f.docType} onChange={(e) => set('docType', e.target.value)} data-testid="vdr-f-docType">{VDR_TYPES.map((k) => <option key={k} value={k}>{t(`vtype.${k}`)}</option>)}</select></Field>
            {txt('title', t('col.title'), { required: true, maxLength: 200 })}
            <Field label={t('vdr.due')} name="dueDate" error={error}><input type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} data-testid="vdr-f-dueDate" /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="vdr-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || !f.poRef.trim() || f.vendor.trim().length < 2 || f.title.trim().length < 3} data-testid="vdr-create">{t('vdr.create')}</button></div>
        </form>
      )}
      <ProjectSelect value={projectId} onChange={setProjectId} allowAll testId="vdr-filter-project" />
      {tr.isPending ? <Skeleton label={t('vdr.title')} rows={3} /> : (
        <div className="mdm-panel" data-testid="vdr-tracker"><h2>{t('vdr.byPo')}</h2>
          {tr.data.groups.length === 0 ? <p className="muted">{t('vdr.none')}</p> : (
            <div className="table-scroll"><table><thead><tr><th>{t('f.project')}</th><th>{t('vdr.po')}</th><th>{t('vdr.vendor')}</th><th>{t('sched.total')}</th><th>{t('vdr.required')}</th><th>{t('vdr.received')}</th><th>{t('vdr.inReview')}</th><th>{t('sched.approved')}</th><th>{t('vdr.resubmit')}</th><th>{t('sched.overdue')}</th></tr></thead>
              <tbody>{tr.data.groups.map((g) => <tr key={`${g.projectId}${g.poRef}${g.vendor}`} data-testid={`vdr-po-${g.poRef}`} data-overdue={g.overdue}><td>{g.project}</td><td>{g.poRef}</td><td>{g.vendor}</td><td>{g.total}</td><td>{g.required}</td><td>{g.received}</td><td>{g.inReview}</td><td>{g.accepted} ({g.acceptedPct}%)</td><td>{g.resubmit}</td><td>{g.overdue}</td></tr>)}</tbody></table></div>
          )}</div>
      )}
      <ListReport listCode="engg.vdr_items" endpoint="/engg/vdr-items" title={t('vdr.items')} session={session.data} rowHref={(r) => `/engg/vdr-item?id=${r.id}`} onOpen={(r) => navigateTo(`/engg/vdr-item?id=${r.id}`)} cardFields={['vdrNo', 'vendor', 'title', 'statusLabel']} statusKey="statusLabel"
        empty={{ title: t('vdr.emptyTitle'), text: t('vdr.emptyBody') }} contextFilters={projectId ? [{ key: 'projectId', op: 'eq', value: String(projectId) }] : []} />
    </section>
  );
}
