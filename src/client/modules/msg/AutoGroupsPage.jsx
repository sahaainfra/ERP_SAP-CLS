import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { comm } from '../../platform/messages/Comm.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';

// Auto Groups (Administration, part 05.04, FR-01): the rules that keep the project, site, department, team and discipline groups in step with the organisation and the assignments. A change is a new version approved by a
// second person; the groups it keeps and how many people are in each are listed below, and "Run now" does at once what the minute job does.
const STATUS = { ACTIVE: ['COMPLETED', 'In force'], PENDING: ['IN_REVIEW', 'Waiting for approval'], RETIRED: ['DRAFT', 'Replaced'], REJECTED: ['REJECTED', 'Rejected'] };
const TYPES = [['PROJECT', 'Project group'], ['SITE', 'Site group'], ['DEPARTMENT', 'Department group'], ['TEAM', 'Team'], ['DISCIPLINE', 'Discipline group (one in every project)']];
export default function AutoGroupsPage() {
  usePageTitle('Auto Groups');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['comm', 'rules'], queryFn: comm.rules, retry: false });
  const [rules, setRules] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (q.data && !rules) setRules(q.data.rules.map((r) => ({ groupType: r.groupType, scopeType: r.scopeType, scopeId: r.scopeId, roleText: r.roleFilter.join(', '), title: r.title, enabled: r.enabled }))); }, [q.data, rules]);
  if (q.error?.status === 403) return <NoPermission what="the auto group rules" permission="msg.autogroup.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending || !rules) return <Skeleton label="Loading the rules" rows={3} />;
  const d = q.data;
  const editable = d.canEdit && d.pending.length === 0;
  const set = (i, p) => setRules(rules.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const submit = async (e) => {
    e.preventDefault(); setError(null); setNotice('');
    try { const r = await comm.proposeRules({ rules: rules.map((x) => ({ groupType: x.groupType, scopeType: x.scopeType, scopeId: x.scopeType === 'COMPANY' ? null : Number(x.scopeId) || null, roleFilter: x.roleText.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean), title: x.title, enabled: x.enabled })), reason }); setNotice(`Version ${r.version} was sent for approval. It changes nothing until a second person approves it.`); setRules(null); setReason(''); qc.invalidateQueries({ queryKey: ['comm', 'rules'] }); } catch (er) { setError(errorInfo(er)); }
  };
  const run = async () => { setError(null); try { const r = await comm.syncGroups(); setNotice(`Done: ${r.groups} group(s) checked, ${r.created} made, ${r.added} added, ${r.removed} removed.`); qc.invalidateQueries({ queryKey: ['comm', 'rules'] }); } catch (er) { setError(errorInfo(er)); } };
  return (
    <section aria-labelledby="ag-title" data-testid="auto-groups">
      <h1 id="ag-title">Auto Groups</h1>
      <p className="muted">Version {d.version || 'default'} is in force. People added by hand stay; only the people the rules added are removed when an assignment ends. The groups follow assignments within a minute.</p>
      {d.pending.length > 0 && <p role="status" className="notice" data-testid="ag-pending">Version {d.pending[0].version} waits for approval (sent by {d.pending[0].by}). Only one change can wait at a time.</p>}
      {notice && <p role="status" className="notice" data-testid="ag-notice">{notice}</p>}
      <form className="card form-grid" onSubmit={submit} noValidate aria-label="Auto group rules" data-testid="ag-form">
        <fieldset disabled={!editable}><legend>Rules</legend>
          {rules.map((r, i) => (
            <div key={i} className="card" data-testid="ag-rule">
              <Field label="Kind of group" name={`rules.${i}.groupType`} error={error}><select value={r.groupType} onChange={(e) => set(i, { groupType: e.target.value })} data-testid={`ag-type-${i}`}>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Where" name={`rules.${i}.scopeType`} error={error}><select value={r.scopeType} onChange={(e) => set(i, { scopeType: e.target.value })}><option value="COMPANY">The whole company</option><option value="PROJECT">One project</option><option value="SITE">One site</option><option value="DEPARTMENT">One department</option></select></Field>
              {r.scopeType !== 'COMPANY' && <Field label="Number of that project, site or department" name={`rules.${i}.scopeId`} error={error}><input inputMode="numeric" value={r.scopeId ?? ''} onChange={(e) => set(i, { scopeId: e.target.value })} /></Field>}
              {['TEAM', 'DISCIPLINE'].includes(r.groupType) && <>
                <Field label="Name of the group *" name={`rules.${i}.title`} error={error}><input value={r.title} maxLength={80} onChange={(e) => set(i, { title: e.target.value })} data-testid={`ag-title-${i}`} /></Field>
                <Field label="Roles that belong to it * (codes, comma separated)" name={`rules.${i}.roleFilter`} error={error}><input value={r.roleText} onChange={(e) => set(i, { roleText: e.target.value })} data-testid={`ag-roles-${i}`} /></Field>
              </>}
              <label className="field field-inline"><span>On</span><input type="checkbox" checked={r.enabled} onChange={(e) => set(i, { enabled: e.target.checked })} /></label>
              <button type="button" className="btn btn-small" onClick={() => setRules(rules.filter((_, k) => k !== i))}>Remove the rule</button>
            </div>
          ))}
          <button type="button" className="btn" onClick={() => setRules([...rules, { groupType: 'DISCIPLINE', scopeType: 'COMPANY', scopeId: null, roleText: '', title: '', enabled: true }])} data-testid="ag-add">Add a rule</button>
          <Field label="Reason for this change *" name="reason" error={error}><textarea rows="2" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="ag-reason" /></Field>
        </fieldset>
        {error?.form && <p className="field-error" role="alert" data-testid="ag-error">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
        <div className="actions">{d.canEdit && <button type="submit" className="btn btn-primary btn-large" disabled={!editable || reason.trim().length < 5} data-testid="ag-submit">Send for approval</button>}{d.canEdit && <button type="button" className="btn" onClick={run} data-testid="ag-run">Run now</button>}</div>
      </form>
      <h2>Groups kept by the rules</h2>
      {d.groups.length === 0 ? <EmptyState compact title="No group yet" message="The groups appear after the first run." /> : <div className="table-wrap" tabIndex={0} role="region" aria-label="Groups"><table className="grid"><thead><tr><th>Group</th><th>Kind</th><th>People</th></tr></thead><tbody>{d.groups.map((g) => <tr key={g.id} data-testid="ag-group"><th scope="row" data-label="Group"><button type="button" className="link-button" onClick={() => navigateTo(`/collab/messages?c=${g.id}`)}>{g.title}</button></th><td data-label="Kind">{g.type}</td><td data-label="People">{g.members}</td></tr>)}</tbody></table></div>}
      <h2>History</h2>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="History of the rules"><table className="grid"><thead><tr><th>Version</th><th>Status</th><th>Rules</th><th>By</th><th>Reason</th><th>Sent</th></tr></thead><tbody>{d.history.map((h) => <tr key={`${h.version}-${h.status}`} data-testid="ag-history-row"><th scope="row" data-label="Version">{h.version}</th><td data-label="Status"><StatusBadge status={STATUS[h.status][0]} label={STATUS[h.status][1]} /></td><td data-label="Rules">{h.rules}</td><td data-label="By">{h.by}</td><td data-label="Reason">{h.reason}</td><td data-label="Sent">{formatDateTime(h.at)}</td></tr>)}</tbody></table></div>
    </section>
  );
}
