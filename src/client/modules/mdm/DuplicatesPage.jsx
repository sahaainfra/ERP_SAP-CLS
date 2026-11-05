import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { DUP_STATUS, mdm } from './api.js';

// Duplicate Candidates (Administration, part 06.01, FR-02): the pairs of records that look alike (same PAN, GSTIN or mobile, or a similar name), highest score first. Compare shows the two side by side, field by field, with the
// differences marked; the person chooses which record survives and asks for the merge (approved by the steward, and the accounts manager for vendors and clients), or says they are different. A merge never deletes: the merged
// record stays and refers to the survivor (BR-01).
export default function DuplicatesPage() {
  usePageTitle('Duplicate Candidates');
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({ type: new URLSearchParams(window.location.search).get('type') ?? 'PARTNER', status: 'OPEN', minScore: '' }));
  const q = useQuery({ queryKey: ['mdm', 'dups', f], queryFn: () => mdm.duplicates(f), retry: false, placeholderData: (p) => p });
  const [pair, setPair] = useState(null);
  const [survivor, setSurvivor] = useState('a');
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  const dlg = useRef(null);
  if (q.error?.status === 403) return <NoPermission what="the duplicates report" permission="mdm.governance.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the duplicate candidates" rows={4} />;
  const d = q.data;
  const set = (p) => setF({ ...f, ...p });
  const refresh = () => qc.invalidateQueries({ queryKey: ['mdm'] });
  const openPair = (p) => { setPair(p); setSurvivor(p.a.dqScore >= p.b.dqScore ? 'a' : 'b'); setError(null); setNote(null); dlg.current?.showModal(); };
  const scan = async () => { setError(null); try { const r = await mdm.scan(f.type); setNote(`${r.found} new candidate(s) found.`); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const merge = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const keep = pair[survivor]; const drop = pair[survivor === 'a' ? 'b' : 'a'];
    setError(null);
    try { const r = await mdm.merge({ type: pair.masterType, fromId: drop.id, toId: keep.id, justification: String(fd.get('justification')) }); setNote(`Merge of ${drop.code} into ${keep.code} sent for approval (request ${r.changeRequestId}).`); dlg.current?.close(); refresh(); } catch (err) { setError(errorInfo(err)); }
  };
  const different = async () => { const why = window.prompt('Why are these two different?') ?? ''; if (why.trim().length < 5) return; setError(null); try { await mdm.dismiss(pair.id, why.trim()); dlg.current?.close(); refresh(); } catch (err) { setError(errorInfo(err)); } };
  return (
    <section aria-labelledby="mdu-title" data-testid="mdm-duplicates">
      <div className="page-head"><h1 id="mdu-title">Duplicate Candidates</h1>{d.canMerge && <button type="button" className="btn" onClick={scan} data-testid="mdu-scan">Scan now</button>}</div>
      <p className="muted">An identical PAN or GSTIN is refused when a record is saved; these pairs are the ones that only look alike, or that were already there. A merge keeps both records; the merged one points to the survivor.</p>
      <form className="srch-form" aria-label="Filter the candidates" onSubmit={(e) => e.preventDefault()}>
        <Field label="Status" name="status" error={null}><select value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid="mdu-status"><option value="">All</option>{Object.entries(DUP_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Score at least" name="minScore" error={null}><input type="number" min="0" max="100" value={f.minScore} onChange={(e) => set({ minScore: e.target.value })} /></Field>
      </form>
      {note && <p role="status" className="mdm-banner" data-testid="mdu-note">{note}</p>}
      {error?.form && !pair && <p className="field-error" role="alert">{error.form}</p>}
      {d.rows.length === 0 ? <EmptyState title="No candidate" message="No pair of records looks alike. The hourly scan and every new record are checked." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Duplicate candidates"><table className="grid"><thead><tr><th className="num">Score</th><th>Record</th><th>Looks like</th><th>Why</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{d.rows.map((p) => (
            <tr key={p.id} data-testid="mdu-row">
              <td className="num" data-label="Score"><span className={`mdm-score mdm-score-${p.score >= 95 ? 'error' : 'warning'}`}>{p.score}</span></td>
              <th scope="row" data-label="Record">{p.a.code} {p.a.name}<div className="muted small">{p.a.status.toLowerCase()}</div></th>
              <td data-label="Looks like">{p.b.code} {p.b.name}<div className="muted small">{p.b.status.toLowerCase()}</div></td>
              <td data-label="Why">{p.rule}</td>
              <td data-label="Status"><StatusBadge status={DUP_STATUS[p.status][0]} label={DUP_STATUS[p.status][1]} />{p.resolution && <div className="muted small">{p.resolution}</div>}</td>
              <td><button type="button" className="btn btn-small btn-primary" onClick={() => openPair(p)} data-testid="mdu-compare">Compare</button></td>
            </tr>))}</tbody></table></div>
      )}
      <dialog ref={dlg} className="dialog dialog-wide" aria-labelledby="mdu-cmp" data-testid="mdu-dialog">
        {pair && <form onSubmit={merge}>
          <h2 id="mdu-cmp">Compare {pair.a.code} and {pair.b.code}</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Side by side"><table className="grid mdm-cmp"><thead><tr><th>Field</th>{['a', 'b'].map((s) => <th key={s}><label className="check"><input type="radio" name="survivor" checked={survivor === s} disabled={pair.status !== 'OPEN'} onChange={() => setSurvivor(s)} data-testid={`mdu-keep-${s}`} /> Keep {pair[s].code}</label></th>)}</tr></thead>
            <tbody>
              <tr><th scope="row">Quality score</th><td>{pair.a.dqScore}</td><td>{pair.b.dqScore}</td></tr>
              {pair.fields.map((x) => { const same = (pair.a.data[x.key] ?? '') === (pair.b.data[x.key] ?? ''); return <tr key={x.key} className={same ? '' : 'mdm-diff'} data-testid="mdu-field"><th scope="row">{x.label}{!same && <span className="sr-only"> (different)</span>}</th><td>{pair.a.data[x.key] ?? '—'}</td><td>{pair.b.data[x.key] ?? '—'}</td></tr>; })}
            </tbody></table></div>
          {pair.status === 'OPEN' && d.canMerge ? <>
            <p className="muted small">{pair[survivor === 'a' ? 'b' : 'a'].code} will be merged into {pair[survivor].code}: it stays, read-only, and everything that refers to it resolves to {pair[survivor].code}.</p>
            <Field label="Justification (required, min 10 characters)" name="justification" error={error}><textarea name="justification" rows="2" required minLength={10} maxLength={500} data-testid="mdu-why" /></Field>
            {error?.form && <p className="field-error" role="alert" data-testid="mdu-error">{error.form}</p>}
            <div className="actions"><button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button type="button" className="btn" onClick={different} data-testid="mdu-different">Not a duplicate</button><button type="submit" className="btn btn-primary" data-testid="mdu-merge">Ask to merge</button></div>
          </> : <div className="actions"><button type="button" className="btn" onClick={() => dlg.current?.close()}>Close</button></div>}
        </form>}
      </dialog>
    </section>
  );
}
