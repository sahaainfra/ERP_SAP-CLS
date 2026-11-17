import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { DISCIPLINES, ORIGINATORS, SIZES, STATUS_CODES, dayIST, eg } from './api.js';
import { ProjectSelect, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Drawing Register (part 11.01, FR-01): every drawing with its current revision and status code; a new drawing starts with its first revision as a draft.
const empty = () => ({ projectId: '', drawingNo: '', title: '', discipline: 'STRUCTURAL', packageName: '', scale: '', sheetSize: 'A1', originatorType: 'CONSULTANT', originator: '', plannedReceipt: '', wbsId: '', locationId: '', activity: '', label: 'A', statusCode: 'IFC', changeNote: '' });
export default function DrawingsPage() {
  const t = useT('engg');
  usePageTitle(t('reg.title'));
  const qc = useQueryClient();
  const session = useSession(); const perms = session.data?.permissions ?? [];
  const search = useSearch(); void search;
  const fp = Number(/filter\[projectId\]=(\d+)/.exec(window.location.search)?.[1]) || null;
  const [open, setOpen] = useState(false); const [error, setError] = useState(null); const [f, setF] = useState({ ...empty(), projectId: fp ?? '' });
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const st = useQuery({ queryKey: ['engg', 'structure', f.projectId], queryFn: () => eg.structure(f.projectId), enabled: open && Boolean(f.projectId), retry: false });
  const create = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const links = f.activity.trim() ? [{ type: 'ACTIVITY', ref: f.activity.trim() }] : [];
      const r = await eg.createDrawing({ projectId: Number(f.projectId), drawingNo: f.drawingNo.trim(), title: f.title.trim(), discipline: f.discipline, packageName: f.packageName.trim() || null, scale: f.scale.trim() || null, sheetSize: f.sheetSize, originatorType: f.originatorType, originator: f.originator.trim() || null,
        plannedReceipt: f.plannedReceipt || null, wbsId: f.wbsId ? Number(f.wbsId) : null, locationId: f.locationId ? Number(f.locationId) : null, links, revision: { label: f.label.trim(), statusCode: f.statusCode, changeNote: f.changeNote.trim() || null, receivedOn: dayIST() } });
      qc.invalidateQueries({ queryKey: ['engg'] }); navigateTo(`/engg/drawing?id=${r.id}`);
    } catch (x) { setError(errorInfo(x)); }
  };
  const sel = (k, label, opts, tk) => <Field label={label} name={k} error={error}><select value={f[k]} onChange={(e) => set(k, e.target.value)} data-testid={`eg-f-${k}`}>{opts.map((o) => <option key={o} value={o}>{t(`${tk}.${o}`)}</option>)}</select></Field>;
  return (
    <section aria-labelledby="eg-list-h" data-testid="eg-drawings">
      <PageHeader id="eg-list-h" srOnly title={t('reg.title')} />
      <div className="actions-row no-print">
        {perms.includes('engg.drawing.create') && <button type="button" className="btn btn-primary" onClick={() => setOpen(!open)} data-testid="eg-new">{t('reg.new')}</button>}
      </div>
      {open && (
        <form className="mdm-panel" aria-label={t('reg.new')} data-testid="eg-new-form" onSubmit={create}>
          <h2>{t('reg.new')}</h2>
          <div className="form-grid">
            <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="eg-f-project" error={error} />
            <Field label={t('col.drawingNo')} name="drawingNo" error={error}><input value={f.drawingNo} onChange={(e) => set('drawingNo', e.target.value)} required maxLength={60} data-testid="eg-f-no" /></Field>
            <Field label={t('col.title')} name="title" error={error}><input value={f.title} onChange={(e) => set('title', e.target.value)} required maxLength={200} data-testid="eg-f-title" /></Field>
            {sel('discipline', t('col.discipline'), DISCIPLINES, 'disc')}
            <Field label={t('col.package')} name="packageName" error={error}><input value={f.packageName} onChange={(e) => set('packageName', e.target.value)} maxLength={80} data-testid="eg-f-package" /></Field>
            <Field label={t('f.scale')} name="scale" error={error}><input value={f.scale} onChange={(e) => set('scale', e.target.value)} maxLength={20} placeholder="1:50" /></Field>
            <Field label={t('f.size')} name="sheetSize" error={error}><select value={f.sheetSize} onChange={(e) => set('sheetSize', e.target.value)}>{SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            {sel('originatorType', t('f.originatorType'), ORIGINATORS, 'orig')}
            <Field label={t('f.originator')} name="originator" error={error}><input value={f.originator} onChange={(e) => set('originator', e.target.value)} maxLength={120} /></Field>
            <Field label={t('col.planned')} name="plannedReceipt" error={error}><input type="date" value={f.plannedReceipt} onChange={(e) => set('plannedReceipt', e.target.value)} data-testid="eg-f-planned" /></Field>
            <Field label={t('f.wbs')} name="wbsId" error={error}><select value={f.wbsId} onChange={(e) => set('wbsId', e.target.value)}><option value="">—</option>{(st.data?.wbs ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></Field>
            <Field label={t('f.location')} name="locationId" error={error}><select value={f.locationId} onChange={(e) => set('locationId', e.target.value)}><option value="">—</option>{(st.data?.locations ?? []).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select></Field>
            <Field label={t('f.activity')} name="links" error={error}><input value={f.activity} onChange={(e) => set('activity', e.target.value)} maxLength={120} data-testid="eg-f-activity" /></Field>
            <Field label={t('f.revision')} name="revision" error={error}><input value={f.label} onChange={(e) => set('label', e.target.value)} required maxLength={10} data-testid="eg-f-label" /></Field>
            {sel('statusCode', t('f.statusCode'), STATUS_CODES, 'code')}
            <Field label={t('f.changeNote')} name="changeNote" error={error}><input value={f.changeNote} onChange={(e) => set('changeNote', e.target.value)} maxLength={2000} /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="eg-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!f.projectId || f.drawingNo.trim().length < 2 || f.title.trim().length < 3 || !f.label.trim()} data-testid="eg-create">{t('reg.create')}</button></div>
        </form>
      )}
      <ListReport listCode="engg.drawings" endpoint="/engg/drawings" title={t('reg.title')} session={session.data} rowHref={(r) => `/engg/drawing?id=${r.id}`} onOpen={(r) => navigateTo(`/engg/drawing?id=${r.id}`)} cardFields={['drawingNo', 'title', 'revision', 'statusCode']} statusKey="statusCode"
        empty={{ title: t('reg.emptyTitle'), text: t('reg.emptyBody') }} contextFilters={fp ? [{ key: 'projectId', op: 'eq', value: String(fp) }] : []} />
    </section>
  );
}
