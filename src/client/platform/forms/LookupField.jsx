import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';
import { FieldShell } from './fields.jsx';

const PAGE = 20;

/** One page of a lookup (GET /<module>/lookups/<name>), searched on the server. */
export async function fetchLookup(lookup, { q = '', page = 1, parent = null, ids = null, pageSize = PAGE } = {}) {
  const params = new URLSearchParams({ q, page: String(page), pageSize: String(pageSize) });
  if (parent) params.set('parent', String(parent));
  if (ids) params.set('id', ids.join(','));
  const [module, name] = lookup.split('/');
  return api.get(`/${module}/lookups/${name}?${params}`);
}

/** The label of a chosen value, fetched by id once (a saved record shows "CODE Name", not a number). */
export function useLookupLabel(lookup, value, valueKey = 'id') {
  return useQuery({
    queryKey: ['lookup-label', lookup, valueKey, String(value ?? '')],
    queryFn: async () => {
      if (valueKey === 'id') return (await fetchLookup(lookup, { ids: [Number(value)] })).data[0] ?? null;
      return (await fetchLookup(lookup, { q: String(value), pageSize: 50 })).data.find((r) => r.code === value) ?? null;
    },
    enabled: value !== '' && value !== null && value !== undefined && (valueKey !== 'id' || Number(value) > 0),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * A searchable lookup (FR-01): an ARIA combobox whose list comes from the server, page by page, as the person types; each row shows the
 * code, the name and the lookup's extra columns. `parent` makes it dependent (the sites of the chosen project); without the parent
 * it says what to choose first. The value is the row's id (or its code, `valueKey="code"`); `onPick(row)` gives the whole row so a form
 * can fill defaults from it.
 */
export function LookupField({ id, label, lookup, value, onChange, onPick, onBlur, error, hint, required, disabled, readOnly, parent, parentLabel, valueKey = 'id', compact = false, demo }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [typed, setTyped] = useState(null);
  const [active, setActive] = useState(0);
  const [pages, setPages] = useState(1);
  const [debounced, setDebounced] = useState('');
  const wrap = useRef(null);
  const listId = `${id}-list`;
  const needsParent = parent !== undefined && !parent;
  const chosen = useLookupLabel(lookup, value, valueKey);
  const results = useQuery({
    queryKey: ['lookup', lookup, debounced, parent ?? '', pages],
    queryFn: async () => {
      const all = [];
      let meta = null;
      for (let p = 1; p <= pages; p += 1) {
        const r = await fetchLookup(lookup, { q: debounced, page: p, parent: parent || null });
        all.push(...r.data);
        meta = r.meta;
      }
      return { rows: all, meta };
    },
    enabled: open && !needsParent && !disabled,
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev) => prev,
  });
  useEffect(() => { const t = setTimeout(() => { setDebounced(q.trim()); setPages(1); setActive(0); }, 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!wrap.current?.contains(e.target)) { setOpen(false); setTyped(null); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const rows = results.data?.rows ?? [];
  const meta = results.data?.meta;
  const more = meta && rows.length < meta.total;
  const labelOf = (r) => (r ? `${r.code} ${r.name}` : '');
  const shownValue = typed ?? (value !== '' && value !== null && value !== undefined ? (chosen.data ? labelOf(chosen.data) : chosen.isPending ? 'Loading...' : String(value)) : '');
  const pick = (r) => {
    onChange(r ? r[valueKey] : '');
    onPick?.(r ?? null);
    setTyped(null);
    setQ('');
    setOpen(false);
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(a + 1, rows.length - 1 + (more ? 1 : 0))); e.stopPropagation(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); e.stopPropagation(); }
    else if (e.key === 'Enter' && open) { e.preventDefault(); e.stopPropagation(); if (active === rows.length && more) setPages(pages + 1); else if (rows[active]) pick(rows[active]); }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setTyped(null); }
    else if (e.key === 'PageDown' && open && more) { e.preventDefault(); setPages(pages + 1); }
  };
  const activeId = open && rows[active] ? `${id}-opt-${active}` : undefined;
  const placeholder = needsParent ? `Choose the ${parentLabel ?? 'item above'} first` : 'Type to search';
  return (
    <FieldShell id={id} label={label} required={required} hint={hint} error={error} readOnly={readOnly} text={chosen.data ? labelOf(chosen.data) : value} className={compact ? 'ff-compact' : ''}>
      {(aria) => (
        <div className="ff-lookup" ref={wrap}>
          <span className={`ff-affix${disabled ? ' is-disabled' : ''}`}>
            <input id={id} name={id} className={`ff-input${demo === 'focus' ? ' is-focus' : ''}`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeId} autoComplete="off"
              value={shownValue} placeholder={placeholder} disabled={disabled || needsParent} required={required} {...aria}
              onFocus={() => { if (!needsParent) setOpen(true); }}
              onChange={(e) => { setTyped(e.target.value); setQ(e.target.value); setOpen(true); if (e.target.value === '') pick(null); }}
              onKeyDown={onKey}
              onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget)) { setTimeout(() => { setOpen(false); setTyped(null); }, 150); } onBlur?.(e); }} />
            {value !== '' && value !== null && value !== undefined && !disabled && (
              <button type="button" className="ff-suffix-btn" aria-label={`Clear ${label}`} onClick={() => pick(null)}>×</button>
            )}
          </span>
          {open && !needsParent && (
            <div className="ff-pop" role="presentation">
              <ul id={listId} role="listbox" aria-label={label} className="ff-options">
                {rows.map((r, i) => (
                  <li key={r.id} id={`${id}-opt-${i}`} role="option" aria-selected={String(r[valueKey]) === String(value)} className={i === active ? 'is-active' : ''}
                    onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)} onMouseEnter={() => setActive(i)}>
                    <span className="ff-opt-code">{r.code}</span>
                    <span className="ff-opt-name">{r.name}</span>
                    {(meta?.columns ?? []).map((c) => <span key={c.key} className="ff-opt-extra" title={c.label}>{String(r.extra?.[c.key] ?? '')}</span>)}
                  </li>
                ))}
                {more && (
                  <li role="option" aria-selected={false} id={`${id}-opt-${rows.length}`} className={`ff-opt-more ${active === rows.length ? 'is-active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => setPages(pages + 1)}>
                    Show more ({rows.length} of {meta.total})
                  </li>
                )}
              </ul>
              <div className="ff-pop-foot" aria-live="polite">
                {results.isFetching ? 'Searching...' : results.isError ? <span className="ff-error">{results.error.message}</span> : rows.length === 0 ? `Nothing matches "${debounced}".` : `${meta.total} found`}
              </div>
            </div>
          )}
        </div>
      )}
    </FieldShell>
  );
}
