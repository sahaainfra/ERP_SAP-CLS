import { useQuery } from '@tanstack/react-query';
import { api } from '../api/index.js';
import { useFlagOn } from '../shell/api.js';
import StatusBadge from '../design/StatusBadge.jsx';
import { navigateTo } from '../../modules/core/pages/ui.jsx';
import { formatMoney } from '../../../shared/i18n/format.js';
import { currentPrefs } from '../i18n/index.js';

// Part 166.7, FR-03: the document flow panel of a record. The documents this one came from and those that followed it, in the order of the chain
// (MR → PR → RFQ → CS → PO → gate entry → GRN → test → issue, vendor invoice; client bill → certification → tax invoice; measurement → sub bill),
// each with its status, amount and date and a link to it; a document the person may not open is shown without its number; a step that a later
// part adds is "not yet available". Only with ff.ui.p16607 ON; the server checks every right.

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(/ /g, '-') : null);
const rupees = (v) => (v === null || v === undefined ? null : formatMoney(String(v), currentPrefs()));

export default function DocumentFlow({ type, id }) {
  const on = useFlagOn('ff.ui.p16607');
  const q = useQuery({ queryKey: ['doc-flow', type, id], queryFn: async () => (await api.get(`/ui/doc-flow?type=${type}&id=${id}`)).data, enabled: on && Boolean(id), retry: false });
  if (!on || !id) return null;
  return (
    <section className="ui-card doc-flow" aria-labelledby={`flow-${type}-${id}`} data-testid="doc-flow">
      <h2 id={`flow-${type}-${id}`} className="ui-card-head">Document flow</h2>
      <div className="ui-card-body">
        {q.isPending && <p className="muted small" role="status">Reading the linked documents…</p>}
        {q.isError && <p className="field-error small" role="alert">{q.error?.message ?? 'The document flow could not be read.'}</p>}
        {q.data && (
          <>
            {q.data.nodes.length <= 1 && q.data.later.length === 0 && <p className="muted small" data-testid="doc-flow-alone">No linked document yet: the documents made from this one, or the one it was made from, appear here.</p>}
            <ol className="doc-flow-list">
              {q.data.nodes.map((n) => (
                <li key={n.key} className={`doc-flow-node${n.current ? ' is-current' : ''}${n.visible ? '' : ' is-hidden'}`} data-testid="doc-flow-node" data-type={n.type} aria-current={n.current ? 'step' : undefined}>
                  <span className="doc-flow-kind small muted">{n.label}</span>
                  {n.visible ? (
                    <>
                      {n.current ? <strong className="doc-flow-ref">{n.ref}</strong> : <a className="doc-flow-ref" href={n.route} onClick={(e) => { e.preventDefault(); navigateTo(n.route); }}>{n.ref}</a>}
                      <span className="doc-flow-facts">
                        {n.status && <StatusBadge status={n.status} size="sm" variant="outline" />}
                        {n.amount !== null && <span className="doc-flow-amount">{rupees(n.amount)}</span>}
                        {n.date && <span className="muted small">{day(n.date)}</span>}
                        {n.party && <span className="muted small">{n.party}</span>}
                      </span>
                    </>
                  ) : <span className="muted small">{n.note}</span>}
                </li>
              ))}
              {q.data.later.map((l) => (
                <li key={`${l.after}-${l.label}`} className="doc-flow-node is-later" data-testid="doc-flow-later">
                  <span className="doc-flow-kind small muted">{l.label}</span>
                  <span className="muted small">{l.note}</span>
                </li>
              ))}
            </ol>
            {q.data.truncated && <p className="muted small">Only the nearest documents are shown.</p>}
          </>
        )}
      </div>
    </section>
  );
}
