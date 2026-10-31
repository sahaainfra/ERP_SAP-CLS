import { useState } from 'react';
import { useOrgContext } from '../api/org.js';

const KEY = 'erp.context';

/** The project and site the person is working in, kept in this browser. Other pages read it with workContext(). */
export function workContext() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/** The shell's company, project and site switcher (FR-08). It lists only what the person's scope allows (the server decides). */
export default function ContextSwitcher() {
  const ctx = useOrgContext();
  const [sel, setSel] = useState(workContext);
  if (!ctx.data || ctx.data.projects.length === 0) return null;
  const { companies, projects, sites } = ctx.data;
  const project = projects.some((p) => p.id === sel.projectId) ? sel.projectId : '';
  const site = sites.some((s) => s.id === sel.siteId && s.projectId === project) ? sel.siteId : '';
  const save = (next) => {
    setSel(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the choice lasts for this page view */ }
    window.dispatchEvent(new CustomEvent('erp:context', { detail: next }));
  };
  return (
    <span className="shell-context" role="group" aria-label="Working context">
      <span className="muted small">{companies[0]?.name}</span>
      <label className="shell-field"><span>Project</span>
        <select value={project} onChange={(e) => save({ projectId: e.target.value ? Number(e.target.value) : '', siteId: '' })}>
          <option value="">All projects</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
        </select>
      </label>
      <label className="shell-field"><span>Site</span>
        <select value={site} disabled={!project} onChange={(e) => save({ projectId: project, siteId: e.target.value ? Number(e.target.value) : '' })}>
          <option value="">All sites</option>
          {sites.filter((s) => s.projectId === project).map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
        </select>
      </label>
    </span>
  );
}
