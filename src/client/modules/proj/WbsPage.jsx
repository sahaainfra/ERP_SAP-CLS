import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { downloadWbs, ordered, st } from './api.js';
import ProjectPicker from './ProjectPicker.jsx';
import { Tabs, useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// WBS Editor (part 10.03, FR-01, FR-02, FR-05 to FR-07): the work breakdown structure of a project as a tree: nodes with codes, weights (the children of a node sum to 100 %), discipline, responsible person and control accounts. Start from a template of the
// project type or a copy of another project; drag a node onto another to move it (or use "Move to" with the keyboard; the server checks every move; Undo takes the last move or edit back); edit several nodes at once; export to Excel, CSV or PDF.
// After the baseline the structure is locked: the Changes tab raises a change request (approved by planning, the project manager and the project controls manager) and the Versions tab keeps every version with its diff. The Matrix tab marks which node applies where.
export default function WbsPage() {
  const t = useT('proj');
  usePageTitle(t('wbs.title'));
  const qc = useQueryClient();
  const sp = useSearch(); const changeId = Number(sp.get('change')) || null;
  const located = useQuery({ queryKey: ['proj', 'locate', changeId], queryFn: () => st.locate(changeId), enabled: Boolean(changeId) && !sp.get('projectId'), retry: false });
  const projectId = Number(sp.get('projectId')) || located.data?.projectId || null;
  const q = useQuery({ queryKey: ['proj', 'wbs', projectId], queryFn: () => st.tree(projectId), enabled: Boolean(projectId), retry: false });
  const [tab, setTab] = useState(changeId ? 'changes' : 'tree'); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [sel, setSel] = useState([]); const [edit, setEdit] = useState(null); const [undo, setUndo] = useState([]); const [drag, setDrag] = useState(null); const [panel, setPanel] = useState(null);
  const head = <><PageHeader id="wbs-h" title={t('wbs.title')} subtitle={t('wbs.intro')} /><ProjectPicker route="/proj/wbs" projectId={projectId} /></>;
  if (!projectId) return <section aria-labelledby="wbs-h" data-testid="wbs-none">{head}</section>;
  if (q.error?.status === 403) return <NoPermission what={t('wbs.title')} permission="proj.wbs.view" />;
  if (q.isPending) return <Skeleton label={t('wbs.title')} rows={6} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data; const c = x.can; const rows = ordered(x.nodes);
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); return r ?? true; } catch (e) { setError(errorInfo(e)); return null; } };
  const nodeOf = (id) => x.nodes.find((n) => n.id === id);
  const doMove = async (id, parentId, beforeId = null, remember = true) => {
    const n = nodeOf(id); if (!n) return;
    const sibs = rows.filter((r) => r.parentId === n.parentId); const idx = sibs.findIndex((r) => r.id === id); const prevBefore = sibs[idx + 1]?.id ?? null; const prevParent = n.parentId;
    const r = await run(() => st.move(projectId, id, { parentId, beforeId }), t('wbs.moved', { code: n.code }));
    if (r && remember) setUndo((u) => [...u, { kind: 'move', id, parentId: prevParent, beforeId: prevBefore, label: n.code }]);
  };
  const doUndo = async () => { const last = undo[undo.length - 1]; if (!last) return; setUndo((u) => u.slice(0, -1)); if (last.kind === 'move') await doMove(last.id, last.parentId, last.beforeId, false); else await run(() => st.update(projectId, last.id, last.fields), t('wbs.undone')); };
  const onDrop = (e, target) => { e.preventDefault(); const id = Number(e.dataTransfer.getData('text/plain')) || drag; setDrag(null); if (!id || id === target) return; doMove(id, target); };
  const errBox = error?.form && <p className="field-error" role="alert" data-testid="wbs-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>;
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((v) => v !== id) : [...s, id]));
  return (
    <section aria-labelledby="wbs-h" data-testid="wbs" data-baselined={x.baselined ? '1' : '0'}>
      {head}
      <p data-testid="wbs-state"><StatusBadge status={x.baselined ? 'APPROVED' : 'DRAFT'} label={x.baselined ? t('wbs.baselined', { n: x.versionNo }) : t('wbs.notBaselined')} /> <span className="muted small">{t('wbs.nodes', { n: x.nodes.length })}</span></p>
      {errBox}{note && <p className="mdm-banner" role="status" data-testid="wbs-note">{note}</p>}
      {!x.validation.ok && x.nodes.length > 0 && <div className="mdm-banner" role="status" data-testid="wbs-problems"><strong>{t('wbs.weightsTitle')}</strong><ul className="mdm-list">{x.validation.problems.slice(0, 6).map((p, i) => <li key={i}>{p.message}</li>)}</ul></div>}
      <Tabs tabs={['tree', 'matrix', 'versions', 'changes']} active={tab} onChange={setTab} label={t('wbs.title')} />
      {tab === 'tree' && (
        <div data-testid="wbs-tree-tab">
          <div className="actions-row no-print" data-testid="wbs-toolbar">
            {c.manage && <button type="button" className="btn btn-primary" onClick={() => { setEdit({ parentId: null }); setPanel('node'); }} data-testid="wbs-add-root">{t('wbs.addRoot')}</button>}
            {c.manage && <button type="button" className="btn" onClick={() => run(() => st.normalise(projectId), t('wbs.normalised'))} data-testid="wbs-normalise">{t('wbs.normalise')}</button>}
            {c.template && <button type="button" className="btn" onClick={() => setPanel(panel === 'template' ? null : 'template')} data-testid="wbs-template-open">{t('wbs.fromTemplate')}</button>}
            {c.template && <button type="button" className="btn" onClick={() => setPanel(panel === 'copy' ? null : 'copy')} data-testid="wbs-copy-open">{t('wbs.fromProject')}</button>}
            {c.manage && sel.length > 0 && <button type="button" className="btn" onClick={() => setPanel(panel === 'bulk' ? null : 'bulk')} data-testid="wbs-bulk-open">{t('wbs.bulk', { n: sel.length })}</button>}
            {undo.length > 0 && <button type="button" className="btn" onClick={doUndo} data-testid="wbs-undo">{t('wbs.undo', { code: undo[undo.length - 1].label })}</button>}
            {c.baseline && <button type="button" className="btn" onClick={() => { if (window.confirm(t('wbs.confirmBaseline'))) run(() => st.baseline(projectId), t('wbs.baselineDone')); }} disabled={!x.validation.ok || x.nodes.length === 0} data-testid="wbs-baseline">{t('wbs.baseline')}</button>}
            {c.export && <button type="button" className="btn" onClick={() => downloadWbs(projectId, 'xlsx')} data-testid="wbs-xlsx">{t('bl.xlsx')}</button>}
            {c.export && <button type="button" className="btn" onClick={() => downloadWbs(projectId, 'pdf')} data-testid="wbs-pdf">{t('bl.pdf')}</button>}
            {c.import && <Link to="/import">{t('wbs.import')}</Link>}
          </div>
          {panel === 'template' && <TemplatePanel x={x} run={run} projectId={projectId} done={() => setPanel(null)} />}
          {panel === 'copy' && <CopyPanel x={x} run={run} projectId={projectId} done={() => setPanel(null)} />}
          {panel === 'bulk' && <BulkPanel ids={sel} run={run} projectId={projectId} x={x} done={() => { setPanel(null); setSel([]); }} />}
          {panel === 'node' && edit && <NodePanel x={x} node={edit} run={run} projectId={projectId} setUndo={setUndo} done={() => { setPanel(null); setEdit(null); }} error={error} />}
          {rows.length === 0 ? (
            <div className="mdm-banner" data-testid="wbs-empty"><strong>{t('wbs.emptyTitle')}</strong> {t('wbs.emptyText')}</div>
          ) : (
            <div className="table-wrap" data-testid="wbs-tree">
              <p className="small muted" id="wbs-legend">{t('wbs.legend')}</p>
              <table className="data-table" aria-describedby="wbs-legend"><caption className="sr-only">{t('wbs.title')}</caption>
                <thead><tr><th scope="col" /><th scope="col">{t('wbs.code')}</th><th scope="col">{t('f.name')}</th><th scope="col" className="num">{t('wbs.weight')}</th><th scope="col">{t('wbs.discipline')}</th><th scope="col">{t('wbs.responsible')}</th><th scope="col">{t('wbs.used')}</th><th scope="col" className="no-print">{t('wbs.actions')}</th></tr></thead>
                <tbody>
                  {rows.map((n) => (
                    <tr key={n.id} data-testid="wbs-row" data-code={n.code} data-status={n.status} draggable={c.manage} onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(n.id)); setDrag(n.id); }} onDragOver={(e) => { if (c.manage && drag) e.preventDefault(); }} onDrop={(e) => onDrop(e, n.id)} className={n.status === 'INACTIVE' ? 'muted' : ''}>
                      <td>{c.edit && <input type="checkbox" checked={sel.includes(n.id)} onChange={() => toggle(n.id)} aria-label={t('wbs.select', { code: n.code })} />}</td>
                      <td><span style={{ paddingInlineStart: `${(n.level - 1) * 16}px` }}>{n.code}</span></td>
                      <td>{n.name}{n.isControlAccount ? ` · ${t('wbs.ca')}` : ''}{n.status === 'INACTIVE' ? ` · ${t('wbs.inactive')}` : ''}</td>
                      <td className="num">{n.weight}%</td><td>{n.disciplineLabel ?? '—'}</td><td>{n.responsibleUser ?? '—'}</td><td>{n.usage || '—'}</td>
                      <td className="no-print">
                        {c.edit && <button type="button" className="btn" onClick={() => { setEdit(n); setPanel('node'); }} aria-label={t('wbs.editNode', { code: n.code })} data-testid={`wbs-edit-${n.code}`}>{t('act.edit')}</button>}
                        {c.manage && <button type="button" className="btn" onClick={() => { setEdit({ parentId: n.id }); setPanel('node'); }} data-testid={`wbs-child-${n.code}`}>{t('wbs.addChild')}</button>}
                        {c.manage && <MoveTo n={n} x={x} rows={rows} onMove={(pid) => doMove(n.id, pid)} />}
                        {c.manage && n.status === 'ACTIVE' && <button type="button" className="btn" onClick={() => run(() => st.setStatus(projectId, n.id, false), t('wbs.deactivated', { code: n.code }))} data-testid={`wbs-deactivate-${n.code}`}>{t('wbs.deactivate')}</button>}
                        {c.manage && n.status === 'INACTIVE' && <button type="button" className="btn" onClick={() => run(() => st.setStatus(projectId, n.id, true))}>{t('wbs.activate')}</button>}
                        {c.manage && <button type="button" className="btn" onClick={() => { if (window.confirm(t('wbs.confirmDelete', { code: n.code }))) run(() => st.remove(projectId, n.id), t('wbs.deleted', { code: n.code })); }} data-testid={`wbs-delete-${n.code}`}>{t('act.delete')}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {c.manage && drag && <div className="mdm-banner" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, null)} data-testid="wbs-drop-top">{t('wbs.dropTop')}</div>}
            </div>
          )}
        </div>
      )}
      {tab === 'matrix' && <Matrix projectId={projectId} run={run} />}
      {tab === 'versions' && <Versions projectId={projectId} />}
      {tab === 'changes' && <Changes x={x} projectId={projectId} run={run} focus={changeId} error={error} />}
      <p className="small"><Link to="/proj/locations">{t('loc.title')}</Link> · <Link to="/proj/work-packages">{t('wp.title')}</Link></p>
    </section>
  );
}

function MoveTo({ n, x, rows, onMove }) {
  const t = useT('proj');
  const banned = new Set([n.id]); const walk = (pid) => { for (const c of x.nodes.filter((y) => y.parentId === pid)) { banned.add(c.id); walk(c.id); } }; walk(n.id);
  return (
    <select aria-label={t('wbs.moveTo', { code: n.code })} value="" onChange={(e) => { const v = e.target.value; if (v !== '') onMove(v === 'top' ? null : Number(v)); }} data-testid={`wbs-moveto-${n.code}`}>
      <option value="">{t('wbs.moveToShort')}</option>
      <option value="top">{t('wbs.topLevel')}</option>
      {rows.filter((r) => !banned.has(r.id) && r.status === 'ACTIVE').map((r) => <option key={r.id} value={r.id}>{r.code} {r.name}</option>)}
    </select>
  );
}
function TemplatePanel({ x, run, projectId, done }) {
  const t = useT('proj'); const [tpl, setTpl] = useState(x.templates[0]?.code ?? ''); const [parent, setParent] = useState('');
  return (
    <form className="mdm-panel" aria-label={t('wbs.fromTemplate')} data-testid="wbs-template-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => st.template(projectId, { template: tpl, parentId: parent ? Number(parent) : null }), t('wbs.templateDone'))) done(); }}>
      <h2>{t('wbs.fromTemplate')}</h2>
      <Field label={t('wbs.template')} name="template"><select value={tpl} onChange={(e) => setTpl(e.target.value)} data-testid="wbs-template">{x.templates.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select></Field>
      {x.nodes.length > 0 && <Field label={t('wbs.under')} name="parentId"><select value={parent} onChange={(e) => setParent(e.target.value)}><option value="">—</option>{ordered(x.nodes).filter((n) => n.status === 'ACTIVE').map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select></Field>}
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="wbs-template-apply">{t('wbs.apply')}</button></div>
    </form>
  );
}
function CopyPanel({ x, run, projectId, done }) {
  const t = useT('proj'); const [src, setSrc] = useState(''); const [loc, setLoc] = useState(true); const [wp, setWp] = useState(true);
  return (
    <form className="mdm-panel" aria-label={t('wbs.fromProject')} data-testid="wbs-copy-form" onSubmit={async (e) => { e.preventDefault(); if (src && await run(() => st.copy(projectId, { sourceProjectId: Number(src), includeLocations: loc, includeWorkPackages: wp }), t('wbs.copyDone'))) done(); }}>
      <h2>{t('wbs.fromProject')}</h2>
      {x.sources.length === 0 ? <p className="muted">{t('wbs.noSources')}</p> : <Field label={t('wbs.source')} name="sourceProjectId"><select value={src} onChange={(e) => setSrc(e.target.value)} data-testid="wbs-source"><option value="">—</option>{x.sources.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>}
      <label><input type="checkbox" checked={loc} onChange={(e) => setLoc(e.target.checked)} /> {t('wbs.withLocations')}</label> <label><input type="checkbox" checked={wp} onChange={(e) => setWp(e.target.checked)} /> {t('wbs.withPackages')}</label>
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={!src} data-testid="wbs-copy-apply">{t('wbs.apply')}</button></div>
    </form>
  );
}
function BulkPanel({ ids, run, projectId, x, done }) {
  const t = useT('proj'); const [d, setD] = useState(''); const [u, setU] = useState(''); const [ca, setCa] = useState('');
  return (
    <form className="mdm-panel" aria-label={t('wbs.bulk', { n: ids.length })} data-testid="wbs-bulk-form" onSubmit={async (e) => { e.preventDefault(); const set = {}; if (d) set.discipline = d; if (u) set.responsibleUser = u; if (ca !== '') set.isControlAccount = ca === 'yes'; if (Object.keys(set).length && await run(() => st.bulk(projectId, { ids, set }), t('wbs.bulkDone', { n: ids.length }))) done(); }}>
      <h2>{t('wbs.bulk', { n: ids.length })}</h2>
      <Field label={t('wbs.discipline')} name="discipline"><select value={d} onChange={(e) => setD(e.target.value)} data-testid="wbs-bulk-discipline"><option value="">—</option>{x.disciplines.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select></Field>
      <LookupField id="wbs-bulk-user" label={t('wbs.responsible')} lookup="proj/people" valueKey="code" value={u} onChange={setU} />
      {!x.baselined && <Field label={t('wbs.ca')} name="ca"><select value={ca} onChange={(e) => setCa(e.target.value)}><option value="">—</option><option value="yes">{t('wbs.yes')}</option><option value="no">{t('wbs.no')}</option></select></Field>}
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="wbs-bulk-apply">{t('wbs.apply')}</button></div>
    </form>
  );
}
function NodePanel({ x, node, run, projectId, setUndo, done, error }) {
  const t = useT('proj'); const isNew = !node.id; const locked = x.baselined;
  const [f, setF] = useState({ code: node.code ?? '', name: node.name ?? '', weight: node.weight ?? '', discipline: node.discipline ?? '', responsibleUser: node.responsibleUser ?? '', isControlAccount: Boolean(node.isControlAccount), description: node.description ?? '' });
  const set = (k, v) => setF((y) => ({ ...y, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (isNew) { const b = { parentId: node.parentId ?? null, name: f.name.trim(), ...(f.code.trim() ? { code: f.code.trim() } : {}), ...(f.weight !== '' ? { weight: String(f.weight) } : {}), discipline: f.discipline || null, responsibleUser: f.responsibleUser || null, isControlAccount: f.isControlAccount, description: f.description.trim() || null }; if (await run(() => st.create(projectId, b), t('wbs.created'))) done(); return; }
    const b = { name: f.name.trim(), discipline: f.discipline || null, responsibleUser: f.responsibleUser || null, description: f.description.trim() || null, version: node.rowVersion };
    if (!locked) { b.code = f.code.trim(); b.weight = String(f.weight || '0'); b.isControlAccount = f.isControlAccount; }
    const before = { name: node.name, discipline: node.discipline, responsibleUser: node.responsibleUser, description: node.description, ...(locked ? {} : { code: node.code, weight: node.weight, isControlAccount: node.isControlAccount }) };
    if (await run(() => st.update(projectId, node.id, b), t('wbs.saved'))) { setUndo((u) => [...u, { kind: 'update', id: node.id, fields: before, label: node.code }]); done(); }
  };
  return (
    <form className="mdm-panel" onSubmit={submit} aria-label={isNew ? t('wbs.addNode') : t('wbs.editNode', { code: node.code })} data-testid="wbs-node-form">
      <h2>{isNew ? t('wbs.addNode') : t('wbs.editNode', { code: node.code })}</h2>
      <div className="form-grid">
        <Field label={t('wbs.code')} name="code" error={error} hint={isNew ? t('wbs.codeHint') : undefined}><input value={f.code} onChange={(e) => set('code', e.target.value)} maxLength={40} disabled={locked && !isNew} data-testid="wbs-f-code" /></Field>
        <Field label={t('f.name')} name="name" error={error}><input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={200} required data-testid="wbs-f-name" /></Field>
        <Field label={t('wbs.weight')} name="weight" error={error}><input inputMode="decimal" value={f.weight} onChange={(e) => set('weight', e.target.value)} disabled={locked && !isNew} data-testid="wbs-f-weight" /></Field>
        <Field label={t('wbs.discipline')} name="discipline" error={error}><select value={f.discipline} onChange={(e) => set('discipline', e.target.value)} data-testid="wbs-f-discipline"><option value="">—</option>{x.disciplines.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}</select></Field>
        <LookupField id="wbs-f-user" label={t('wbs.responsible')} lookup="proj/people" valueKey="code" value={f.responsibleUser} onChange={(v) => set('responsibleUser', v)} />
        <label><input type="checkbox" checked={f.isControlAccount} onChange={(e) => set('isControlAccount', e.target.checked)} disabled={locked && !isNew} /> {t('wbs.ca')}</label>
      </div>
      <Field label={t('wbs.description')} name="description" error={error}><textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} /></Field>
      <div className="actions"><button type="button" className="btn" onClick={done}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="wbs-f-save">{t('bl.save')}</button></div>
    </form>
  );
}
function Matrix({ projectId, run }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'matrix', projectId], queryFn: () => st.matrix(projectId), retry: false });
  if (q.isPending) return <Skeleton label={t('wbs.matrix')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const m = q.data; const on = new Set(m.cells.map(([w, l]) => `${w}:${l}`));
  if (!m.rows.length || !m.columns.length) return <div className="mdm-banner" data-testid="matrix-empty"><strong>{t('wbs.matrixEmptyTitle')}</strong> {t('wbs.matrixEmptyText')} <Link to="/proj/locations">{t('loc.title')}</Link></div>;
  return (
    <div className="table-wrap" data-testid="wbs-matrix">
      <p className="small muted">{t('wbs.matrixHelp')}</p>
      <table className="data-table"><caption className="sr-only">{t('wbs.matrix')}</caption>
        <thead><tr><th scope="col">{t('wbs.code')}</th>{m.columns.map((c) => <th key={c.id} scope="col" title={c.name}>{c.code}</th>)}</tr></thead>
        <tbody>{m.rows.map((r) => <tr key={r.id}><th scope="row">{r.code} {r.name}</th>{m.columns.map((c) => <td key={c.id}><input type="checkbox" checked={on.has(`${r.id}:${c.id}`)} disabled={!m.can.manage} aria-label={`${r.code} ${c.code}`} onChange={(e) => run(() => st.setMatrix(projectId, [{ wbsId: r.id, locationId: c.id, on: e.target.checked }]))} data-testid={`cell-${r.code}-${c.code}`} /></td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
function Versions({ projectId }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'versions', projectId], queryFn: () => st.versions(projectId), retry: false }); const [open, setOpen] = useState(null);
  const vq = useQuery({ queryKey: ['proj', 'version', projectId, open], queryFn: () => st.version(projectId, open), enabled: Boolean(open), retry: false });
  if (q.isPending) return <Skeleton label={t('wbs.versions')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (!q.data.length) return <p className="muted" data-testid="versions-empty">{t('wbs.noVersions')}</p>;
  return (
    <div data-testid="wbs-versions">
      <ul className="mdm-list">{q.data.map((v) => <li key={v.id}><button type="button" className="btn" onClick={() => setOpen(open === v.id ? null : v.id)}>{t('wbs.version', { n: v.versionNo })}</button> {v.kind === 'BASELINE' ? t('wbs.baselineKind') : t('wbs.changeKind')} · {v.statusLabel} · {v.requestedBy} · {String(v.decidedAt ?? '').slice(0, 10)}{v.reason ? ` · ${v.reason}` : ''}</li>)}</ul>
      {vq.data && <div className="mdm-panel" data-testid="version-detail"><h3>{t('wbs.version', { n: vq.data.versionNo })}</h3>{vq.data.diff.length === 0 ? <p className="muted">{t('wbs.noDiff')}</p> : <ul className="mdm-list">{vq.data.diff.map((d, i) => <li key={i}>{t(`wbs.diff.${d.kind}`)} · {d.code} {d.name}{d.changes ? `: ${d.changes.map((c) => `${c.field} ${c.before ?? '–'} → ${c.after ?? '–'}`).join('; ')}` : ''}</li>)}</ul>}</div>}
    </div>
  );
}
const blankOp = () => ({ op: 'add', parentId: '', name: '', weight: '', id: '', toParent: '' });
function Changes({ x, projectId, run, focus, error }) {
  const t = useT('proj'); const q = useQuery({ queryKey: ['proj', 'changes', projectId], queryFn: () => st.changes(projectId), retry: false });
  const [ops, setOps] = useState([blankOp()]); const [reason, setReason] = useState(''); const [building, setBuilding] = useState(false);
  const set = (i, k, v) => setOps((l) => l.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  if (q.isPending) return <Skeleton label={t('wbs.changes')} rows={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const rows = ordered(x.nodes); const num = (v) => (v === '' ? null : Number(v));
  const body = () => ({ reason: reason.trim(), ops: ops.map((o) => (o.op === 'add' ? { op: 'add', parentId: num(o.parentId), name: o.name.trim(), ...(o.weight !== '' ? { weight: String(o.weight) } : {}) } : o.op === 'move' ? { op: 'move', id: Number(o.id), parentId: num(o.toParent) } : o.op === 'weights' ? { op: 'weights', weights: [{ id: Number(o.id), weight: String(o.weight) }] } : { op: o.op, id: Number(o.id) })) });
  const act = (id, action, why) => run(() => st.actChange(projectId, id, action, why ? { reason: window.prompt(t('act.why')) || '' } : {}), t(`wbs.change.${action}`));
  return (
    <div data-testid="wbs-changes">
      {x.can.change && !x.openChange && !building && <button type="button" className="btn btn-primary" onClick={() => setBuilding(true)} data-testid="change-new">{t('wbs.newChange')}</button>}
      {x.openChange && <p className="mdm-banner" role="status">{t('wbs.openChange')}</p>}
      {!x.baselined && <p className="muted">{t('wbs.changesBeforeBaseline')}</p>}
      {building && (
        <form className="mdm-panel" aria-label={t('wbs.newChange')} data-testid="change-form" onSubmit={async (e) => { e.preventDefault(); if (await run(() => st.createChange(projectId, body()), t('wbs.changeDrafted'))) { setBuilding(false); setOps([blankOp()]); setReason(''); } }}>
          <h2>{t('wbs.newChange')}</h2>
          <Field label={t('wbs.reason')} name="reason" error={error}><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} data-testid="change-reason" /></Field>
          {ops.map((o, i) => (
            <div key={i} className="form-grid" data-testid="change-op">
              <Field label={t('wbs.opKind')} name={`ops.${i}.op`}><select value={o.op} onChange={(e) => set(i, 'op', e.target.value)} data-testid={`change-op-${i}`}>{['add', 'move', 'weights', 'deactivate', 'activate'].map((k) => <option key={k} value={k}>{t(`wbs.op.${k}`)}</option>)}</select></Field>
              {o.op === 'add' ? (
                <>
                  <Field label={t('wbs.under')} name={`ops.${i}.parentId`}><select value={o.parentId} onChange={(e) => set(i, 'parentId', e.target.value)} data-testid={`change-parent-${i}`}><option value="">{t('wbs.topLevel')}</option>{rows.filter((n) => n.status === 'ACTIVE').map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select></Field>
                  <Field label={t('f.name')} name={`ops.${i}.name`}><input value={o.name} onChange={(e) => set(i, 'name', e.target.value)} data-testid={`change-name-${i}`} /></Field>
                  <Field label={t('wbs.weight')} name={`ops.${i}.weight`}><input inputMode="decimal" value={o.weight} onChange={(e) => set(i, 'weight', e.target.value)} data-testid={`change-weight-${i}`} /></Field>
                </>
              ) : (
                <Field label={t('wbs.node')} name={`ops.${i}.id`}><select value={o.id} onChange={(e) => set(i, 'id', e.target.value)} data-testid={`change-node-${i}`}><option value="">—</option>{rows.map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select></Field>
              )}
              {o.op === 'move' && <Field label={t('wbs.moveToShort')} name={`ops.${i}.parentId`}><select value={o.toParent} onChange={(e) => set(i, 'toParent', e.target.value)}><option value="">{t('wbs.topLevel')}</option>{rows.filter((n) => n.status === 'ACTIVE' && String(n.id) !== String(o.id)).map((n) => <option key={n.id} value={n.id}>{n.code} {n.name}</option>)}</select></Field>}
              {o.op === 'weights' && <Field label={t('wbs.weight')} name={`ops.${i}.weight`}><input inputMode="decimal" value={o.weight} onChange={(e) => set(i, 'weight', e.target.value)} /></Field>}
              <button type="button" className="btn" onClick={() => setOps((l) => l.filter((_, j) => j !== i))} disabled={ops.length === 1}>{t('bl.removeRow')}</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setOps((l) => [...l, blankOp()])} data-testid="change-add-op">{t('wbs.addOp')}</button>
          {error?.form && <p className="field-error" role="alert" data-testid="change-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 6).join('; ')}` : ''}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setBuilding(false)}>{t('act.close')}</button><button type="submit" className="btn btn-primary" data-testid="change-save">{t('wbs.draftChange')}</button></div>
        </form>
      )}
      {q.data.length === 0 ? <p className="muted" data-testid="changes-empty">{t('wbs.noChanges')}</p> : (
        <ul className="mdm-list" data-testid="change-list">{q.data.map((v) => (
          <li key={v.id} data-testid="change-item" data-status={v.status} className={focus === v.id ? 'mdm-banner' : ''}>
            <strong>{t('wbs.version', { n: v.versionNo })}</strong> · {v.statusLabel} · {v.requestedBy} · {v.reason}
            <ul className="mdm-list">{v.diff.map((d, i) => <li key={i}>{t(`wbs.diff.${d.kind}`)} · {d.code} {d.name}{d.changes ? `: ${d.changes.map((c) => `${c.field} ${c.before ?? '–'} → ${c.after ?? '–'}`).join('; ')}` : ''}</li>)}</ul>
            {['DRAFT', 'RETURNED'].includes(v.status) && x.can.change && <button type="button" className="btn btn-primary" onClick={() => act(v.id, 'submit')} data-testid={`change-submit-${v.id}`}>{t('wbs.sendChange')}</button>}
            {v.status === 'SUBMITTED' && <button type="button" className="btn" onClick={() => act(v.id, 'withdraw', true)}>{t('act.withdraw')}</button>}
            {['DRAFT', 'RETURNED', 'SUBMITTED'].includes(v.status) && x.can.change && <button type="button" className="btn" onClick={() => act(v.id, 'cancel', true)}>{t('bl.cancel')}</button>}
          </li>))}</ul>
      )}
    </div>
  );
}
