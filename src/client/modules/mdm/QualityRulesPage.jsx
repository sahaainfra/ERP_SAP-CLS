import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { mdm, scoreTone } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Data Quality Rules & Stewards (Administration, part 06.01, FR-04, FR-07): the score of each master and the rules that fail most, the rules in force (required, format of PAN, GSTIN, IFSC, PIN and others, not reviewed for N
// days) with their severity, and the stewards of each master. The system administrator changes them as one proposal with a reason; nothing changes before the IT administrator or the director approves it (maker-checker).
const SEV = ['ERROR', 'WARNING', 'INFO'];
export default function QualityRulesPage() {
  usePageTitle('Data Quality Rules & Stewards');
  const qc = useQueryClient();
  const cfg = useQuery({ queryKey: ['mdm', 'config'], queryFn: mdm.config, retry: false });
  const qual = useQuery({ queryKey: ['mdm', 'quality'], queryFn: () => mdm.quality(), retry: false });
  const [draft, setDraft] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  if (cfg.error?.status === 403) return <NoPermission what="the data quality rules" permission="mdm.governance.view" />;
  if (cfg.isError) return <ErrorState error={cfg.error} onRetry={cfg.refetch} />;
  if (cfg.isPending) return <Skeleton label="Loading the rules" rows={4} />;
  const c = cfg.data;
  const edit = () => { setDraft({ rules: c.rules.map((r) => ({ ...r, param: r.param ?? null })), stewards: c.stewards.map(({ masterType, username, role }) => ({ masterType, username, role })), reason: '' }); setError(null); setNote(null); };
  const setRule = (i, p) => setDraft({ ...draft, rules: draft.rules.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const setSteward = (i, p) => setDraft({ ...draft, stewards: draft.stewards.map((r, j) => (j === i ? { ...r, ...p } : r)) });
  const send = async (e) => {
    e.preventDefault(); setError(null);
    try { const r = await mdm.propose({ rules: draft.rules.map(({ masterType, field, rule, param, severity, active }) => ({ masterType, field, rule, param: param || null, severity, active: active !== false })), stewards: draft.stewards, reason: draft.reason }); setNote(`Version ${r.version} sent for approval to the IT administrator or the director.`); setDraft(null); qc.invalidateQueries({ queryKey: ['mdm'] }); } catch (err) { setError(errorInfo(err)); }
  };
  const fieldsOf = (t) => c.types.find((x) => x.type === t)?.fields ?? [];
  const R = draft ? draft.rules : c.rules;
  const S = draft ? draft.stewards : c.stewards;
  return (
    <section aria-labelledby="mdq-title" data-testid="mdm-quality">
      <PageHeader id="mdq-title" title={"Data Quality Rules & Stewards"} actions={<>{c.canEdit && !draft && !c.pending && <button type="button" className="btn btn-primary" onClick={edit} data-testid="mdq-edit">Propose a change</button>}</>} />
      {c.pending && <p className="mdm-banner" role="status" data-testid="mdq-pending">Version {c.pending.version} by {c.pending.by} waits for approval: {c.pending.reason}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="mdq-note">{note}</p>}
      <h2>Quality by master</h2>
      {qual.isPending ? <Skeleton label="Loading the scores" rows={2} /> : qual.isError ? <ErrorState error={qual.error} onRetry={qual.refetch} /> : qual.data.rows.map((m) => (
        <article key={m.type} className="mdm-card" data-testid={`mdq-score-${m.type}`}>
          <h3>{m.label}: <span className={`mdm-score mdm-score-${scoreTone(m.score)}`}>{m.score ?? '—'}</span> <span className="muted small">over {m.records} record(s) · {m.below70} below 70 · {m.stale} stale</span></h3>
          {m.failing.length === 0 ? <p className="muted small">No rule fails.</p> : <ul className="mdm-list">{m.failing.slice(0, 6).map((x) => <li key={`${x.rule}${x.field}`} className={`mdm-sev-${x.severity.toLowerCase()}`}>{x.rule === 'STALE' ? 'Not reviewed or changed for too long' : `${x.label}: ${x.rule.toLowerCase()}`} · {x.count} record(s)</li>)}</ul>}
          {m.worst.filter((w) => w.score < 70).length > 0 && <p className="small">Lowest: {m.worst.filter((w) => w.score < 70).slice(0, 5).map((w) => <span key={w.id}><Link to={`/admin/master-data/records?type=${m.type}&id=${w.id}`}>{w.code}</Link> ({w.score}) </span>)}</p>}
        </article>))}
      <form onSubmit={send} aria-label="Rules and stewards">
        <h2>Rules {draft ? '(your proposal)' : `in force (version ${c.version || 'built-in'})`}</h2>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Rules"><table className="grid"><thead><tr><th>Master</th><th>Field</th><th>Rule</th><th>Format or days</th><th>Severity</th>{draft && <th><span className="sr-only">Remove</span></th>}</tr></thead>
          <tbody>{R.map((r, i) => (
            <tr key={`${r.masterType}${r.field}${r.rule}${i}`} data-testid="mdq-rule">
              <td data-label="Master">{r.masterType}</td>
              <td data-label="Field">{draft ? <select aria-label="Field" value={r.field} onChange={(e) => setRule(i, { field: e.target.value })}><option value="*">Whole record</option>{fieldsOf(r.masterType).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select> : r.field === '*' ? 'Whole record' : fieldsOf(r.masterType).find((x) => x.key === r.field)?.label ?? r.field}</td>
              <td data-label="Rule">{draft ? <select aria-label="Rule" value={r.rule} onChange={(e) => setRule(i, { rule: e.target.value, param: e.target.value === 'STALE' ? '365' : e.target.value === 'FORMAT' ? 'PAN' : null })}><option value="REQUIRED">Required</option><option value="FORMAT">Format</option><option value="STALE">Not reviewed for</option></select> : { REQUIRED: 'Required', FORMAT: 'Format', STALE: 'Not reviewed for' }[r.rule]}</td>
              <td data-label="Format or days">{draft && r.rule === 'FORMAT' ? <select aria-label="Format" value={r.param ?? ''} onChange={(e) => setRule(i, { param: e.target.value })}>{c.formats.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}</select> : draft && r.rule === 'STALE' ? <input aria-label="Days" type="number" min="1" value={r.param ?? ''} onChange={(e) => setRule(i, { param: e.target.value })} /> : r.rule === 'STALE' ? `${r.param} days` : r.param ?? '—'}</td>
              <td data-label="Severity">{draft ? <select aria-label="Severity" value={r.severity} onChange={(e) => setRule(i, { severity: e.target.value })}>{SEV.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select> : <span className={`mdm-sev-${r.severity.toLowerCase()}`}>{r.severity.toLowerCase()}</span>}</td>
              {draft && <td><button type="button" className="btn btn-small" onClick={() => setDraft({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}>Remove</button></td>}
            </tr>))}</tbody></table></div>
        {draft && <button type="button" className="btn btn-small" onClick={() => setDraft({ ...draft, rules: [...draft.rules, { masterType: c.types[0].type, field: c.types[0].fields[0].key, rule: 'REQUIRED', param: null, severity: 'WARNING', active: true }] })} data-testid="mdq-add-rule">Add a rule</button>}
        <h2>Stewards</h2>
        {S.length === 0 && !draft ? <EmptyState compact title="No steward named" message="Until a steward is named, the changes of a master go to the workflow administrators." /> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Stewards"><table className="grid"><thead><tr><th>Master</th><th>Person</th><th>Role</th>{draft && <th><span className="sr-only">Remove</span></th>}</tr></thead>
            <tbody>{S.map((s, i) => (
              <tr key={`${s.masterType}${s.username}${i}`} data-testid="mdq-steward">
                <td data-label="Master">{draft ? <select aria-label="Master" value={s.masterType} onChange={(e) => setSteward(i, { masterType: e.target.value })}>{c.types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}</select> : c.types.find((t) => t.type === s.masterType)?.label ?? s.masterType}</td>
                <td data-label="Person">{draft ? <input aria-label="User name" value={s.username} onChange={(e) => setSteward(i, { username: e.target.value })} data-testid="mdq-steward-user" /> : `${s.name} (${s.username})`}</td>
                <td data-label="Role">{draft ? <select aria-label="Role" value={s.role} onChange={(e) => setSteward(i, { role: e.target.value })}><option value="PRIMARY">Primary</option><option value="BACKUP">Backup</option></select> : s.role.toLowerCase()}</td>
                {draft && <td><button type="button" className="btn btn-small" onClick={() => setDraft({ ...draft, stewards: draft.stewards.filter((_, j) => j !== i) })}>Remove</button></td>}
              </tr>))}</tbody></table></div>
        )}
        {draft && <>
          <button type="button" className="btn btn-small" onClick={() => setDraft({ ...draft, stewards: [...draft.stewards, { masterType: c.types[0].type, username: '', role: 'PRIMARY' }] })} data-testid="mdq-add-steward">Add a steward</button>
          <Field label="Reason (required, min 10 characters)" name="reason" error={error}><textarea rows="2" value={draft.reason} required minLength={10} maxLength={500} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} data-testid="mdq-reason" /></Field>
          {error?.form && <p className="field-error" role="alert" data-testid="mdq-error">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="mdq-send">Send for approval</button></div>
        </>}
      </form>
      {c.history.length > 0 && <><h2>History</h2><ul className="mdm-list">{c.history.map((h) => <li key={`${h.version}${h.status}`}>Version {h.version} · {h.status.toLowerCase()} · {h.by} · {formatDateTime(h.at)} · {h.reason}</li>)}</ul></>}
    </section>
  );
}
