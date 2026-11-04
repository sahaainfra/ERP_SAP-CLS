import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { formatDateTime, formatINR } from '../../platform/format.js';

// The evidence panel (part 04.03, FR-03): sections that the modules and the approval itself provide, drawn the same way for every document type. Read-only.
const TONE = { success: 'approved', warning: 'returned', error: 'rejected' };
export const show = (v, format) => {
  if (v === null || v === undefined || v === '') return 'not available';
  if (format === 'inr') return formatINR(v);
  if (format === 'datetime') return formatDateTime(v);
  if (format === 'percent') return `${v} %`;
  return String(v);
};

export function Flags({ flags }) {
  if (!flags?.length) return null;
  return (
    <ul className="srch-meta" aria-label="Risk flags" data-testid="ev-flags">
      {flags.map((f) => <li key={f.code}><StatusBadge status={f.severity === 'high' ? 'rejected' : 'returned'} label={f.label} /></li>)}
    </ul>
  );
}

function Section({ s }) {
  return (
    <section aria-labelledby={`ev-${s.code}`} className="card" data-testid={`ev-${s.code}`}>
      <h3 id={`ev-${s.code}`}>{s.title}</h3>
      {s.kind === 'metrics' && (
        <dl className="kv">
          {s.items.map((it, i) => (
            <div key={i}><dt>{it.label}</dt><dd>{it.masked ? <span aria-label="hidden for your role">•••</span> : (it.tone ? <StatusBadge status={TONE[it.tone] ?? 'draft'} label={show(it.value, it.format)} /> : show(it.value, it.format))}{it.note && <span className="muted small"> {it.note}</span>}</dd></div>
          ))}
        </dl>
      )}
      {s.kind === 'table' && (s.rows.length === 0 ? <p className="muted">{s.empty ?? 'Nothing to show.'}</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={s.title}>
          <table className="grid"><thead><tr>{s.columns.map((c) => <th key={c.key} className={c.format === 'inr' ? 'num' : undefined}>{c.label}</th>)}</tr></thead>
            <tbody>{s.rows.map((r, i) => <tr key={i}>{s.columns.map((c, j) => (j === 0 ? <th scope="row" key={c.key} data-label={c.label}>{show(r[c.key], c.format)}</th> : <td key={c.key} data-label={c.label} className={c.format === 'inr' ? 'num' : undefined}>{show(r[c.key], c.format)}</td>))}</tr>)}</tbody></table>
        </div>
      ))}
      {s.kind === 'list' && <ul className="lp-list">{s.items.map((it, i) => <li key={i}><strong>{it.label}</strong> {it.detail}</li>)}</ul>}
    </section>
  );
}

export default function Evidence({ data }) {
  return (
    <div data-testid="evidence">
      <p className="muted small">Read when you opened this ({formatDateTime(data.computedAt)}). It informs your decision; it never makes it.</p>
      {data.emptyMessage && <p className="notice" role="note" data-testid="ev-empty">{data.emptyMessage}</p>}
      {data.unavailable.map((u, i) => <p key={i} role="alert" className="error">{u.message}</p>)}
      {data.sections.map((s) => <Section key={s.code} s={s} />)}
    </div>
  );
}
