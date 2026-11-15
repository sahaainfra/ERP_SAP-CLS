import { useMemo, useState } from 'react';

const NEXT = { none: 'allow', allow: 'deny', deny: 'none' };
const LABEL = { allow: 'Allow', deny: 'Deny', none: '-' };

/**
 * The permission matrix of a role: for each module, a grid of entities (rows) by actions (columns). A cell is Allow, Deny or empty.
 * A deny beats an allow from any other role the person holds. `grants` maps a permission key to 'allow' or 'deny'; with `editable` a
 * click moves a cell through empty, allow and deny, and `onChange` gets the new map. Marked cells are sensitive permissions.
 */
export default function PermissionMatrix({ registry, grants, editable = false, onChange }) {
  const [module, setModule] = useState('');
  const [q, setQ] = useState('');
  const modules = useMemo(() => [...new Set(registry.map((p) => p.module))].sort(), [registry]);
  const shown = registry.filter((p) => (!module || p.module === module) && (!q || p.key.includes(q.toLowerCase()) || p.description.toLowerCase().includes(q.toLowerCase())));
  const byModule = useMemo(() => {
    const out = new Map();
    for (const p of shown) {
      if (!out.has(p.module)) out.set(p.module, { actions: new Set(), entities: new Map() });
      const m = out.get(p.module);
      m.actions.add(p.action);
      if (!m.entities.has(p.entity)) m.entities.set(p.entity, new Map());
      m.entities.get(p.entity).set(p.action, p);
    }
    return [...out.entries()];
  }, [shown]);
  const allowed = [...grants.values()].filter((v) => v === 'allow').length;
  const denied = [...grants.values()].filter((v) => v === 'deny').length;
  const set = (key) => {
    const next = new Map(grants);
    const state = NEXT[grants.get(key) ?? 'none'];
    if (state === 'none') next.delete(key);
    else next.set(key, state);
    onChange(next);
  };
  const setAll = (mod, state) => {
    const next = new Map(grants);
    for (const p of registry.filter((x) => x.module === mod)) {
      if (state === 'none') next.delete(p.key);
      else next.set(p.key, state);
    }
    onChange(next);
  };

  return (
    <div>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search permissions</span><input type="search" placeholder="Search permissions" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="field field-inline"><span className="sr-only">Module</span>
          <select aria-label="Module" value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">All modules</option>
            {modules.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <span className="muted" data-testid="matrix-summary">{allowed} allowed, {denied} denied of {registry.length} permissions</span>
      </div>
      {byModule.length === 0 && <div className="state"><h2>No permissions match</h2><p>Clear the search to see them all.</p></div>}
      {byModule.map(([mod, m]) => {
        const actions = [...m.actions].sort();
        return (
          <section key={mod} aria-label={`Permissions of ${mod}`} className="card">
            <h3>{mod}{editable && <> <button type="button" className="btn btn-small" onClick={() => setAll(mod, 'allow')}>Allow all</button> <button type="button" className="btn btn-small" onClick={() => setAll(mod, 'none')}>Clear all</button></>}</h3>
            <div className="table-wrap" data-no-cards="">
              <table>
                <caption className="sr-only">Permissions of {mod}: entities by actions</caption>
                <thead><tr><th>Entity</th>{actions.map((a) => <th key={a}>{a.replace(/_/g, ' ')}</th>)}</tr></thead>
                <tbody>
                  {[...m.entities.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([entity, cells]) => (
                    <tr key={entity}>
                      <th scope="row">{entity}</th>
                      {actions.map((a) => {
                        const p = cells.get(a);
                        if (!p) return <td key={a} data-label={a} className="muted">·</td>;
                        const state = grants.get(p.key) ?? 'none';
                        const text = `${LABEL[state]}${p.sensitive ? ' *' : ''}`;
                        return (
                          <td key={a} data-label={a.replace(/_/g, ' ')}>
                            {editable ? (
                              <button type="button" className={`btn btn-small${state === 'allow' ? ' btn-primary' : ''}`} aria-label={`${p.key}: ${LABEL[state] === '-' ? 'not granted' : LABEL[state]}. Click to change`} aria-pressed={state !== 'none'} data-testid={`cell-${p.key}`} onClick={() => set(p.key)} title={p.description}>{text}</button>
                            ) : (
                              <span className={`chip ${state === 'allow' ? 'chip-pass' : state === 'deny' ? 'chip-fail' : 'chip-never'}`} title={p.description} data-testid={`cell-${p.key}`}>{text}</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      <p className="muted small">* A sensitive permission: a role that holds one is a privileged role, so a change to it needs the director as well.</p>
    </div>
  );
}
