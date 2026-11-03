import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';

// Saved variants of a list (part 03.03) for the pages of the engines: a person's own named filters, kept on the server, applied with one choice.
const unwrap = async (p) => (await p).data;

/** `list` is the code of the saved-view list, `filters` the current filters, `empty` the cleared filters, `apply(filters)` puts a saved variant on screen. */
export default function Variants({ list, filters, empty, apply }) {
  const qc = useQueryClient();
  const key = ['ui', 'saved-views', list];
  const views = useQuery({ queryKey: key, queryFn: () => unwrap(api.get(`/ui/saved-views?list=${list}`)), retry: false });
  const save = useMutation({
    mutationFn: (name) => unwrap(api.post('/ui/saved-views', { list, name, isShared: false, isDefault: false, config: { columns: [], hidden: [], widths: {}, pageSize: 25, q: filters.q ?? '', sort: filters.sort ?? '', filters: Object.entries(filters).filter(([k, v]) => !['q', 'sort'].includes(k) && v !== '' && v !== false && v != null).map(([k, v]) => ({ key: k, op: 'eq', value: String(v) })) } }, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({ mutationFn: (v) => unwrap(api.delete(`/ui/saved-views/${v.id}`, {}, { version: v.version })), onSuccess: () => qc.invalidateQueries({ queryKey: key }) });
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState('');
  const items = views.data ?? [];
  const pick = (id) => {
    setChosen(id);
    const v = items.find((x) => String(x.id) === id);
    if (!v) return apply(empty);
    const f = { ...empty, q: v.config.q ?? '', sort: v.config.sort || empty.sort || '' };
    for (const c of v.config.filters ?? []) f[c.key] = c.value;
    apply(f);
  };
  return (
    <div className="wf-inline" role="group" aria-label="Saved variants">
      <label className="field"><span>Saved variant</span><select value={chosen} onChange={(e) => pick(e.target.value)}><option value="">None</option>{items.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
      <label className="field"><span>Name for this filter</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <button type="button" className="btn btn-small" disabled={!name.trim() || save.isPending} onClick={() => save.mutate(name.trim(), { onSuccess: () => setName('') })}>Save variant</button>
      {chosen && <button type="button" className="btn btn-small" onClick={() => { remove.mutate(items.find((x) => String(x.id) === chosen)); setChosen(''); }}>Delete variant</button>}
    </div>
  );
}
