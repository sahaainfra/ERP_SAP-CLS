import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { WP_TYPES, ordered, st } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Work Package (part 10.03, FR-03): one work package: code, name, type (self, subcontract, procurement), owner and the WBS nodes it groups. A node is in one work package of each type; closed work packages are reopened before they change.
export default function WorkPackagePage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const pidParam = Number(sp.get('projectId')) || null;
  const wq = useQuery({ queryKey: ['proj', 'wp', id], queryFn: () => st.wp(id), enabled: Boolean(id), retry: false });
  const w = wq.data; const projectId = w?.projectId ?? pidParam;
  const tq = useQuery({ queryKey: ['proj', 'wbs', projectId], queryFn: () => st.tree(projectId), enabled: Boolean(projectId), retry: false });
  const [f, setF] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  usePageTitle(w ? `${w.code} ${w.name}` : t('wp.new'));
  if (id && wq.error?.status === 403) return <NoPermission what={t('wp.title')} permission="proj.wbs.view" />;
  if (id && wq.isPending) return <Skeleton label={t('wp.title')} rows={4} />;
  if (id && wq.isError) return <ErrorState error={wq.error} onRetry={wq.refetch} />;
  if (!id && !projectId) return <section aria-labelledby="wp-h" data-testid="wp-pick"><PageHeader id="wp-h" title={t('wp.new')} /><ProjectPicker route="/proj/work-package" projectId={null} testId="wp-project" /></section>;
  if (tq.isPending && projectId) return <Skeleton label={t('wp.title')} rows={4} />;
  if (tq.isError) return tq.error?.status === 403 ? <NoPermission what={t('wp.title')} permission="proj.wbs.view" /> : <ErrorState error={tq.error} onRetry={tq.refetch} />;
  const tree = tq.data; const can = tree.can.edit; const form = f ?? { code: w?.code ?? '', name: w?.name ?? '', type: w?.type ?? 'SELF', ownerUser: w?.ownerUser ?? '', description: w?.description ?? '', wbsIds: w?.wbsIds ?? [], status: w?.status ?? 'ACTIVE' };
  const set = (k, v) => setF({ ...form, [k]: v });
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r; } catch (e) { setError(errorInfo(e)); return null; } };
  const submit = async (e) => {
    e.preventDefault();
    const b = { code: form.code.trim(), name: form.name.trim(), type: form.type, ownerUser: form.ownerUser || null, description: form.description.trim() || null, wbsIds: form.wbsIds };
    if (w) { const r = await run(() => st.updateWp(w.id, { ...b, version: w.rowVersion }), t('wbs.saved')); if (r) setF(null); }
    else { const r = await run(() => st.createWp({ projectId, ...b }), t('wp.created')); if (r) navigateTo(`/proj/work-package?id=${r.id}`, { force: true }); }
  };
  const nodes = ordered(tree.nodes).filter((n) => n.status === 'ACTIVE');
  const leaf = (n) => !tree.nodes.some((c) => c.parentId === n.id);
  return (
    <section aria-labelledby="wp-h" data-testid="work-package" data-status={w?.status}>
      <PageHeader id="wp-h" title={<>{w ? `${w.code} · ${w.name}` : t('wp.new')} {w && <StatusBadge status={w.status === 'ACTIVE' ? 'ACTIVE' : w.status === 'CLOSED' ? 'COMPLETED' : 'DRAFT'} label={w.statusLabel} />}</>} subtitle={<>{tree.project.code} · {tree.project.name}{w ? ` · ${w.typeLabel}` : ''}</>} />
      {error?.form && <p className="field-error" role="alert" data-testid="wp-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="wp-note">{note}</p>}
      <form className="mdm-panel" onSubmit={submit} aria-label={t('wp.title')} data-testid="wp-form">
        <div className="form-grid">
          <Field label={t('wbs.code')} name="code" error={error}><input value={form.code} onChange={(e) => set('code', e.target.value)} maxLength={40} required disabled={!can || w?.status === 'CLOSED'} data-testid="wp-f-code" /></Field>
          <Field label={t('f.name')} name="name" error={error}><input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={200} required disabled={!can || w?.status === 'CLOSED'} data-testid="wp-f-name" /></Field>
          <Field label={t('f.type')} name="type" error={error}><select value={form.type} onChange={(e) => set('type', e.target.value)} disabled={!can || w?.status === 'CLOSED'} data-testid="wp-f-type">{WP_TYPES.map((k) => <option key={k} value={k}>{t(`wp.type.${k}`)}</option>)}</select></Field>
          <LookupField id="wp-f-owner" label={t('wp.owner')} lookup="proj/people" valueKey="code" value={form.ownerUser} onChange={(v) => set('ownerUser', v)} />
        </div>
        <fieldset data-testid="wp-nodes"><legend>{t('wp.nodes')}</legend>
          {nodes.length === 0 ? <p className="muted">{t('wp.noNodes')} <Link to={`/proj/wbs?projectId=${projectId}`}>{t('wbs.title')}</Link></p> : (
            <ul className="mdm-list">{nodes.map((n) => <li key={n.id}><label><input type="checkbox" checked={form.wbsIds.includes(n.id)} disabled={!can || w?.status === 'CLOSED'} onChange={(e) => set('wbsIds', e.target.checked ? [...form.wbsIds, n.id] : form.wbsIds.filter((i) => i !== n.id))} data-testid={`wp-node-${n.code}`} /> <span style={{ paddingInlineStart: `${(n.level - 1) * 12}px` }}>{n.code} {n.name}{leaf(n) ? '' : ` (${t('wp.group')})`}</span></label></li>)}</ul>
          )}
        </fieldset>
        {error?.fields?.wbsIds && <p className="field-error">{error.fields.wbsIds}</p>}
        {can && <div className="actions">
          {w && w.status !== 'CLOSED' && <button type="button" className="btn" onClick={() => run(() => st.updateWp(w.id, { status: 'CLOSED' }), t('wp.closed'))} data-testid="wp-close">{t('wp.close')}</button>}
          {w && w.status === 'CLOSED' && <button type="button" className="btn" onClick={() => run(() => st.updateWp(w.id, { status: 'ACTIVE' }), t('wp.reopened'))}>{t('wp.reopen')}</button>}
          {w && <button type="button" className="btn" onClick={async () => { if (window.confirm(t('wp.confirmDelete'))) { const r = await run(() => st.removeWp(w.id)); if (r) navigateTo('/proj/work-packages', { force: true }); } }} data-testid="wp-delete">{t('act.delete')}</button>}
          {w?.status !== 'CLOSED' && <button type="submit" className="btn btn-primary" data-testid="wp-save">{t('bl.save')}</button>}
        </div>}
      </form>
      <p className="small"><Link to="/proj/work-packages">{t('wp.title')}</Link> · <Link to={`/proj/wbs?projectId=${projectId}`}>{t('wbs.title')}</Link></p>
    </section>
  );
}
