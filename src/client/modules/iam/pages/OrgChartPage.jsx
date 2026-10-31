import { useRef, useState } from 'react';
import { Field, FormDialog, QueryState, can, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useOrgTree, useOrgUpdate } from '../api/org.js';
import { StatusChip } from '../components/OrgList.jsx';

const flatten = (nodes, depth = 0) => nodes.flatMap((n) => [{ ...n, depth }, ...flatten(n.children ?? [], depth + 1)]);
const descendantIds = (node) => [node.id, ...(node.children ?? []).flatMap(descendantIds)];

/** Keep the nodes that match the search, and the ancestors that lead to them. */
function prune(nodes, q) {
  if (!q) return nodes;
  return nodes.flatMap((n) => {
    const kids = prune(n.children ?? [], q);
    const hit = [n.code, n.name, n.headName ?? ''].some((v) => v.toLowerCase().includes(q));
    return hit || kids.length ? [{ ...n, children: hit ? n.children : kids }] : [];
  });
}

function DeptNode({ node, canMove, closed, toggle, drag, setDrag, onDrop, onMove, searching }) {
  const kids = node.children ?? [];
  const isOpen = searching || !closed.has(node.id);
  const blocked = drag && descendantIds(drag).includes(node.id);
  return (
    <li role="treeitem" aria-expanded={kids.length ? isOpen : undefined} data-testid={`chart-${node.code}`}>
      <div
        className={`chart-node${drag?.id === node.id ? ' chart-dragging' : ''}`}
        draggable={canMove && !searching}
        onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(node.id)); setDrag(node); }}
        onDragEnd={() => setDrag(null)}
        onDragOver={(e) => { if (drag && !blocked) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (drag && !blocked) onDrop(drag, node); }}
      >
        {kids.length > 0 ? <button type="button" className="btn btn-small" onClick={() => toggle(node.id)} aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.name}`}>{isOpen ? '−' : '+'}</button> : <span className="chart-leaf" />}
        <strong>{node.code}</strong> <span>{node.name}</span>
        <span className="muted small">{node.kind === 'DIVISION' ? 'Division' : 'Department'}{node.headName ? ` · Head: ${node.headName}` : ''}</span>
        {node.status !== 'ACTIVE' && <StatusChip status={node.status} />}
        {canMove && <button type="button" className="btn btn-small" onClick={() => onMove(node)} aria-label={`Move ${node.code}`}>Move</button>}
      </div>
      {kids.length > 0 && isOpen && (
        <ul role="group">{kids.map((k) => <DeptNode key={k.id} node={k} canMove={canMove} closed={closed} toggle={toggle} drag={drag} setDrag={setDrag} onDrop={onDrop} onMove={onMove} searching={searching} />)}</ul>
      )}
    </li>
  );
}

const Plain = ({ nodes, label }) => (
  <ul className="chart-plain" aria-label={label}>
    {nodes.map((n) => (
      <li key={n.id}><strong>{n.code}</strong> {n.name} {n.status && n.status !== 'ACTIVE' && <StatusChip status={n.status} />}
        {(n.children?.length ?? 0) > 0 && <Plain nodes={n.children} label={`${n.name} children`} />}
        {(n.sites?.length ?? 0) > 0 && <Plain nodes={n.sites} label={`${n.name} sites`} />}
      </li>
    ))}
  </ul>
);

export default function OrgChartPage({ session }) {
  usePageTitle('Organisation Chart');
  const tree = useOrgTree();
  const update = useOrgUpdate('departments');
  const [view, setView] = useState('departments');
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState(new Set());
  const [drag, setDrag] = useState(null);
  const [undo, setUndo] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(null);
  const [moving, setMoving] = useState(null);
  const dialog = useRef(null);
  const canMove = can(session, 'org.hr.manage');
  const t = tree.data;
  const query = q.trim().toLowerCase();
  const departments = t ? prune(t.departments, query) : [];

  const toggle = (id) => setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const move = async (node, parentId) => {
    setError(null);
    try {
      const out = await update.mutateAsync({ id: node.id, parentId, version: node.version });
      setUndo({ id: node.id, parentId: node.parentId ?? null, version: out.version, name: node.name });
      setNotice(`${node.name} was moved.`);
      return true;
    } catch (err) {
      setError(errorInfo(err));
      return false;
    }
  };
  const doUndo = async () => {
    const u = undo;
    setUndo(null);
    try {
      await update.mutateAsync({ id: u.id, parentId: u.parentId, version: u.version });
      setNotice(`The move of ${u.name} was undone.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Organisation &rsaquo; Chart</nav>
      <div className="page-head">
        <h1 id="page-title">Organisation Chart</h1>
        <div className="actions"><button type="button" className="btn" onClick={() => window.print()}>Print or save as PDF</button></div>
      </div>
      <p className="muted">{t?.company ? `${t.company.name}. ` : ''}Divisions and departments with their heads. {canMove ? 'Drag a department onto another to move it, or use Move. ' : ''}Person-level reporting lines arrive with the user master.</p>
      <div role="tablist" aria-label="Chart views" className="actions">
        {[['departments', 'Departments'], ['branches', 'Branches & regions'], ['projects', 'Projects & sites'], ['locations', 'Locations']].map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`ctab-${id}`} aria-selected={view === id} className={`btn${view === id ? ' btn-primary' : ''}`} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search the chart</span><input type="search" placeholder="Search code, name or head" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {view === 'departments' && <button type="button" className="btn" onClick={() => setClosed(new Set())}>Expand all</button>}
        {view === 'departments' && <button type="button" className="btn" onClick={() => setClosed(new Set(flatten(t?.departments ?? []).filter((n) => n.children?.length).map((n) => n.id)))}>Collapse all</button>}
        {undo && <button type="button" className="btn" onClick={doUndo}>Undo move</button>}
      </div>
      <p role="status" className="notice" data-testid="chart-notice">{notice}</p>
      {error && <p className="field-error" role="alert">{error.form}</p>}
      <QueryState query={tree} what="the organisation chart" permission="org.view" />
      {t && (
        <div role="tabpanel" aria-labelledby={`ctab-${view}`} className="chart">
          {view === 'departments' && (departments.length === 0
            ? <div className="state"><h2>{query ? 'Nothing matches' : 'No departments yet'}</h2><p>{query ? 'Try another search.' : 'Add divisions and departments under Organisation.'}</p></div>
            : (
              <>
                <ul role="tree" aria-label="Departments" className="chart-tree">
                  {departments.map((n) => <DeptNode key={n.id} node={n} canMove={canMove} closed={closed} toggle={toggle} drag={drag} setDrag={setDrag} searching={Boolean(query)} onDrop={(d, target) => move(d, target.id)} onMove={(node) => { setMoving(flatten(t.departments).find((d) => d.id === node.id)); setError(null); dialog.current?.showModal(); }} />)}
                </ul>
                {canMove && drag && <div className="chart-root-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); move(drag, null); }}>Drop here to make it a top-level unit</div>}
              </>
            ))}
          {view === 'branches' && (t.branches.length ? <Plain nodes={prune(t.branches, query)} label="Branches and regions" /> : <div className="state"><h2>No branches yet</h2></div>)}
          {view === 'projects' && (t.projects.length ? <Plain nodes={t.projects.filter((p) => !query || `${p.code} ${p.name}`.toLowerCase().includes(query) || p.sites.some((s) => `${s.code} ${s.name}`.toLowerCase().includes(query)))} label="Projects and sites" /> : <div className="state"><h2>No projects yet</h2></div>)}
          {view === 'locations' && (t.locations.length ? <Plain nodes={t.locations.filter((l) => !query || `${l.code} ${l.name}`.toLowerCase().includes(query))} label="Locations" /> : <div className="state"><h2>No locations yet</h2></div>)}
        </div>
      )}
      <FormDialog dialogRef={dialog} title={`Move ${moving?.code ?? ''}`} reason={false} submitLabel="Move" error={error} busy={update.isPending}
        onSubmit={async (f) => {
          const v = String(f.get('parentId'));
          if (await move(moving, v ? Number(v) : null)) dialog.current?.close();
        }}>
        <Field label="New parent" name="parentId" error={error} hint="Leave empty to make it a top-level unit. A unit cannot move under itself or one of its own descendants.">
          <select name="parentId" defaultValue={moving?.parentId ?? ''}>
            <option value="">Top level</option>
            {flatten(t?.departments ?? []).filter((d) => !moving || !descendantIds(moving).includes(d.id)).map((d) => <option key={d.id} value={d.id}>{`${'— '.repeat(d.depth)}${d.code} ${d.name}`}</option>)}
          </select>
        </Field>
      </FormDialog>
    </section>
  );
}
