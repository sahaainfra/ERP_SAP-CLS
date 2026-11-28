import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useContextOptions, useSetContext } from './api.js';
import { useFeatureFlag } from '../../modules/core/api/index.js';
import { useT } from '../i18n/index.js';
import { confirmLeave } from '../forms/guard.js';
import Icon from '../design/Icon.jsx';

const KEY = 'erp.context';
export const OPEN_CONTEXT_EVENT = 'erp:open-context';

/** What forms and lists read (they listen for 'erp:context'): the project and site chosen, mirrored in this browser. */
export function mirrorContext(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the choice lasts for this page view */ }
  window.dispatchEvent(new CustomEvent('erp:context', { detail: next }));
}
export function readContext() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}

/**
 * The company, project and site switcher of the shell (FR-03): a button that shows the working context and opens a panel with a search
 * box over the projects and sites in the person's scope. The choice is kept on the server per person and mirrored to the browser so
 * every form and list follows it at once. Changing it while a form has unsaved changes asks first (BR-02).
 */
export default function ContextSwitcher({ context, onChange }) {
  const opts = useContextOptions();
  const save = useSetContext();
  const qc = useQueryClient();
  const t = useT('shell');
  // PACK-07 (ff.ui.pack07, OFF by default): recent contexts, arrow keys and Enter in the panel, focus back on the button when it
  // closes, and every cached page refreshed after a switch so what is on screen follows the new context
  const pack07 = useFeatureFlag('ff.ui.pack07');
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const [q, setQ] = useState('');
  const box = useRef(null);
  const input = useRef(null);
  const data = opts.data;

  // The server's remembered choice is the truth: bring this browser in step with it once it arrives. A person who has not chosen on
  // the server yet but did in this browser (before the choice was kept on the server) keeps that choice: it is saved there.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!data) return;
    const sel = data.selected;
    const mine = readContext();
    if ((mine.projectId || '') === (sel.projectId || '') && (mine.siteId || '') === (sel.siteId || '')) return;
    const projectId = Number(mine.projectId) || null;
    if (!sel.projectId && projectId && data.projects.some((p) => p.id === projectId)) {
      const siteId = Number(mine.siteId) || null;
      saveRef.current.mutate({ projectId, siteId: siteId && data.sites.some((x) => x.id === siteId && x.projectId === projectId) ? siteId : null });
      return;
    }
    const next = { projectId: sel.projectId ?? '', siteId: sel.siteId ?? '' };
    mirrorContext(next);
    onChange?.(next);
  }, [data, onChange]);

  useEffect(() => {
    const openIt = () => setOpen(true);
    window.addEventListener(OPEN_CONTEXT_EVENT, openIt);
    return () => window.removeEventListener(OPEN_CONTEXT_EVENT, openIt);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    input.current?.focus();
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); if (pack07) trigger.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, pack07]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    const hit = (t) => `${t.code} ${t.name}`.toLowerCase().includes(needle);
    return data.projects.map((p) => ({ project: p, sites: data.sites.filter((s) => s.projectId === p.id) }))
      .map((r) => ({ ...r, shown: !needle || hit(r.project) || r.sites.some(hit), sitesShown: !needle || hit(r.project) ? r.sites : r.sites.filter(hit) }))
      .filter((r) => r.shown);
  }, [data, q]);

  const recent = (data?.recent ?? []).map((r) => ({ p: data.projects.find((x) => x.id === r.projectId), s: r.siteId ? data.sites.find((x) => x.id === r.siteId) : null })).filter((r) => r.p);

  if (!data || data.projects.length === 0) return null;
  const project = data.projects.find((p) => p.id === (context?.projectId || data.selected.projectId));
  const site = project ? data.sites.find((s) => s.id === (context?.siteId || data.selected.siteId) && s.projectId === project.id) : null;
  const label = project ? `${project.code}${site ? ` / ${site.code}` : ''}` : 'All projects';

  const choose = (projectId, siteId) => {
    if (!confirmLeave()) return; // a form with unsaved changes asks first
    save.mutate({ projectId, siteId }, {
      onSuccess: () => {
        const next = { projectId: projectId ?? '', siteId: siteId ?? '' };
        mirrorContext(next);
        onChange?.(next);
        setOpen(false);
        setQ('');
        if (pack07) { trigger.current?.focus(); qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'shell' }); }
      },
    });
  };

  return (
    <span className="sh-context" ref={box}>
      <button ref={trigger} type="button" className="sh-chip" aria-haspopup="dialog" aria-expanded={open} aria-label={`Working context: ${data.companies[0]?.name ?? 'company'}, ${label}`} onClick={() => setOpen((o) => !o)} data-testid="context-button">
        <Icon name="erp.action.location" size={16} />
        <span className="sh-chip-text"><span className="muted small">{data.companies[0]?.name}</span> {label}</span>
      </button>
      {open && (
        <div className="sh-pop sh-context-pop" role="group" aria-label="Working context" onKeyDown={pack07 ? (e) => {
          const options = [...(box.current?.querySelectorAll('[role="option"]') ?? [])];
          const at = options.indexOf(document.activeElement);
          const go = (i) => { e.preventDefault(); options[Math.max(0, Math.min(options.length - 1, i))]?.focus(); };
          if (e.key === 'ArrowDown') go(at < 0 ? 0 : at + 1);
          else if (e.key === 'ArrowUp') go(at <= 0 ? 0 : at - 1);
          else if (e.key === 'Home' && at >= 0) go(0);
          else if (e.key === 'End' && at >= 0) go(options.length - 1);
          else if (e.key === 'Enter' && e.target === input.current) { e.preventDefault(); (options.find((o) => o.dataset.match === '1') ?? options[0])?.click(); }
        } : undefined}>
          <p className="muted small">Company: <strong>{data.companies[0]?.name}</strong>. Forms start with this project and site, and lists show only them.</p>
          <label className="shell-field"><span>Find a project or site</span>
            <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code or name" />
          </label>
          <ul className="sh-options" role="listbox" aria-label="Projects and sites">
            {pack07 && !q.trim() && recent.length > 0 && (
              <li className="sh-context-recent" data-testid="context-recent">
                <span className="muted small" id="context-recent-h">{t('context.recent')}</span>
                <ul aria-labelledby="context-recent-h">
                  {recent.map(({ p, s: st }) => (
                    <li key={`r${p.id}-${st?.id ?? 0}`}><button type="button" role="option" aria-selected={false} onClick={() => choose(p.id, st?.id ?? null)}><strong>{p.code}</strong>{st ? ` / ${st.code}` : ''} <span className="muted">{st ? st.name : p.name}</span></button></li>
                  ))}
                </ul>
              </li>
            )}
            <li><button type="button" role="option" aria-selected={!project} onClick={() => choose(null, null)}>All projects</button></li>
            {rows.map(({ project: p, sitesShown }) => (
              <li key={p.id}>
                <button type="button" role="option" data-match={q.trim() ? '1' : undefined} aria-selected={project?.id === p.id && !site} onClick={() => choose(p.id, null)}><strong>{p.code}</strong> {p.name}</button>
                {sitesShown.length > 0 && (
                  <ul>
                    {sitesShown.map((s) => (
                      <li key={s.id}><button type="button" role="option" aria-selected={site?.id === s.id} onClick={() => choose(p.id, s.id)}>{s.code} <span className="muted">{s.name}</span></button></li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
            {rows.length === 0 && <li className="muted small">Nothing in your scope matches "{q}".</li>}
          </ul>
          {save.isError && <p role="alert" className="field-error">{save.error.message}</p>}
        </div>
      )}
    </span>
  );
}
