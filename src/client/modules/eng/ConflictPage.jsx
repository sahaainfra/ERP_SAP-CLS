import { useState } from 'react';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { settle } from '../../platform/offline/engine.js';
import { useCommands, useOffActions } from '../../platform/offline/api.js';
import { usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Conflict Resolution (Mobile, part 04.15, FR-06): a change made offline met a record that was changed on the server meanwhile. Side by side, for every field that both sides changed: what it was when you went
// offline, what you wrote and what the server holds now. Keep mine, keep the server's, or choose field by field. Nothing is overwritten until you decide.
function Conflict({ c }) {
  const act = useOffActions();
  const [pick, setPick] = useState({});
  const [error, setError] = useState(null);
  const fields = c.conflict.fields;
  const decide = async (choice, fieldsMap = {}) => {
    setError(null);
    try { await act.resolve.mutateAsync({ id: c.id, choice, fields: fieldsMap }); await settle(c.commandId); } catch (e) { setError(e); }
  };
  const chosen = Object.fromEntries(fields.map((f) => [f.key, pick[f.key] ?? '']));
  const ready = fields.every((f) => chosen[f.key]);
  return (
    <article className="card conflict" data-testid="conflict" aria-label={`Conflict on ${c.label ?? c.type}`}>
      <h2>{c.label ?? c.type}</h2>
      <p className="muted small">Captured {formatDateTime(c.clientCreatedAt)}. The server record is now at version {c.conflict.serverVersion}; you started from version {c.conflict.baseVersion}.</p>
      {fields.map((f) => (
        <fieldset key={f.key} className="conflict-field" data-testid={`cf-${f.key}`}>
          <legend>{f.label}</legend>
          <p className="muted small">When you went offline: <span>{String(f.base ?? '(empty)')}</span></p>
          <label className="choice"><input type="radio" name={`${c.id}-${f.key}`} checked={pick[f.key] === 'mine'} onChange={() => setPick({ ...pick, [f.key]: 'mine' })} /> <span>Mine: <strong data-testid={`cf-${f.key}-mine`}>{String(f.mine)}</strong></span></label>
          <label className="choice"><input type="radio" name={`${c.id}-${f.key}`} checked={pick[f.key] === 'server'} onChange={() => setPick({ ...pick, [f.key]: 'server' })} /> <span>Server: <strong data-testid={`cf-${f.key}-server`}>{String(f.server)}</strong></span></label>
        </fieldset>
      ))}
      {Object.keys(c.conflict.otherChanges ?? {}).length > 0 && <p className="muted small">Your other changes ({Object.keys(c.conflict.otherChanges).join(', ')}) do not clash and are kept in every case except "keep the server's version".</p>}
      {error && <p className="field-error" role="alert">{error.message}{error.correlationId ? ` (Correlation ID: ${error.correlationId})` : ''}</p>}
      <div className="actions">
        <button type="button" className="btn btn-primary btn-large" disabled={act.resolve.isPending} onClick={() => decide('MINE')} data-testid="cf-mine">Keep mine</button>
        <button type="button" className="btn btn-large" disabled={act.resolve.isPending} onClick={() => decide('SERVER')} data-testid="cf-server">Keep the server's</button>
        <button type="button" className="btn btn-large" disabled={act.resolve.isPending || !ready} onClick={() => decide('MERGE', chosen)} data-testid="cf-merge">Use my choices</button>
      </div>
    </article>
  );
}

export default function ConflictPage() {
  usePageTitle('Conflict Resolution');
  const q = useCommands({ status: 'CONFLICT', limit: 50 });
  if (q.isError && q.error?.status === 403) return <NoPermission what="your conflicts" permission="" />;
  return (
    <section aria-labelledby="cr-title" className="conflicts" data-testid="conflicts">
      <PageHeader id="cr-title" title={"Conflict Resolution"} subtitle={"These changes were made while you were offline and clash with changes made by someone else on the server. Decide for each field; nothing is overwritten until you do."} />
      {q.isPending && <Skeleton label="Loading the conflicts" />}
      {q.isError && <ErrorState error={q.error} onRetry={q.refetch} />}
      {q.data && q.data.rows.length === 0 && <EmptyState title="No conflicts" message="Everything you sent was saved without a clash." />}
      {q.data?.rows.map((c) => <Conflict key={c.id} c={c} />)}
    </section>
  );
}
