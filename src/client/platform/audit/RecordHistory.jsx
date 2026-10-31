import { formatDateTime } from '../format.js';
import { useRecordHistory } from '../../modules/core/api/audit.js';
import { QueryState } from '../../modules/core/pages/ui.jsx';

const show = (v) => (v === undefined ? '' : v === null ? 'empty' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** One entry's changes as a short list: field, old value and new value (sensitive values are already masked by the server). */
export function Changes({ changes }) {
  const keys = Object.keys(changes ?? {});
  if (keys.length === 0) return <span className="muted">No field changes recorded</span>;
  return (
    <ul className="changes">
      {keys.map((k) => (
        <li key={k}><code>{k}</code>: {'old' in changes[k] ? <><del>{show(changes[k].old)}</del> </> : null}{'new' in changes[k] ? <>&rarr; <ins>{show(changes[k].new)}</ins></> : null}</li>
      ))}
    </ul>
  );
}

/**
 * The History tab of a record (part 02.06, FR-06): who did what to it and when, newest first, with the field changes.
 * Every object page uses it with the record's kind and number; people who may view the record see its history, masked.
 */
export default function RecordHistory({ entity, id, title = 'History' }) {
  const q = useRecordHistory(entity, id);
  const rows = q.data ?? [];
  return (
    <section className="card" aria-labelledby={`history-${entity}-${id}`} data-testid="record-history">
      <h3 id={`history-${entity}-${id}`}>{title}</h3>
      <QueryState query={q} what="the history" permission="core.audit.view" />
      {q.data && rows.length === 0 && <p className="muted">Nothing has been recorded for this record yet.</p>}
      {rows.length > 0 && (
        <ol className="timeline">
          {rows.map((e) => (
            <li key={e.id} data-testid={`history-${e.id}`}>
              <strong>{e.action}</strong> by {e.actor} <span className="muted">{formatDateTime(e.at)}</span>
              {e.reason && <p>{e.reason}</p>}
              <Changes changes={e.changes} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
