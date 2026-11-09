import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DiscussionTab, TimelineTab } from '../../platform/collab/CollabTabs.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { formatDate } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, deploy } from './api.js';

// Crew (HR, part 07.03): one crew or gang of a site: its supervisor and trade, and its members with the dates they joined and left. The supervisor keeps the members of their own crew; a member must be deployed at the site
// (the server says so when not). A member is ended with a date, never deleted, so the history of who worked in the crew stays. Tabs: Members · Timeline · Discussion.
const TABS = [['members', 'Members'], ['timeline', 'Timeline'], ['discussion', 'Discussion']];
export default function CrewPage() {
  const sp = new URLSearchParams(window.location.search);
  const id = Number(sp.get('id')) || null;
  const q = useQuery({ queryKey: ['hr', 'crew', id], queryFn: () => deploy.crews.get(id), enabled: Boolean(id), retry: false });
  usePageTitle(q.data ? `${q.data.code} ${q.data.name}` : 'Crew');
  const [tab, setTab] = useState(() => sp.get('tab') ?? 'members');
  if (!id) return <ErrorState title="No crew chosen" error={{ message: 'Open a crew from Crews & Gangs.' }} />;
  if (q.error?.status === 403) return <NoPermission what="crews" permission="hr.crew.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the crew" rows={5} />;
  const c = q.data;
  const current = c.members.filter((m) => m.current);
  return (
    <section aria-labelledby="cr-title" data-testid="crew-page">
      <p><Link to="/hr/crews">← Crews &amp; Gangs</Link></p>
      <header className="op-header">
        <div className="page-head"><h1 id="cr-title">{c.code} · {c.name}</h1><StatusBadge status={c.active ? 'ACTIVE' : 'CLOSED'} label={c.active ? 'Active' : 'Closed'} /></div>
        <dl className="op-figures"><div><dt>Site</dt><dd>{c.site}</dd></div><div><dt>Project</dt><dd>{c.project}</dd></div><div><dt>Trade</dt><dd>{c.trade ?? '—'}</dd></div><div><dt>Supervisor</dt><dd data-testid="cr-supervisor">{c.supervisor ?? '—'}</dd></div><div><dt>Members now</dt><dd data-testid="cr-count">{current.length}</dd></div></dl>
      </header>
      <div role="tablist" aria-label="Crew sections" className="op-tabs">{TABS.map(([k, l]) => <button key={k} type="button" role="tab" id={`cr-tab-${k}`} aria-selected={tab === k} aria-controls={`cr-panel-${k}`} tabIndex={tab === k ? 0 : -1} className={`op-tab${tab === k ? ' is-active' : ''}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div role="tabpanel" id={`cr-panel-${tab}`} aria-labelledby={`cr-tab-${tab}`} className="op-panel" tabIndex={0}>
        {tab === 'members' && <Members c={c} />}
        {tab === 'timeline' && <TimelineTab entity="hr_crew" id={c.id} />}
        {tab === 'discussion' && <DiscussionTab entity="hr_crew" id={c.id} />}
      </div>
    </section>
  );
}

function Members({ c }) {
  const qc = useQueryClient();
  const [person, setPerson] = useState('');
  const [from, setFrom] = useState(dayIST(0));
  const [error, setError] = useState(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['hr'] });
  const add = async (e) => { e.preventDefault(); setError(null); try { await deploy.crews.addMember(c.id, { personType: 'EMPLOYEE', personId: Number(person), fromDate: from }); setPerson(''); refresh(); } catch (x) { setError(errorInfo(x)); } };
  const end = async (m) => { setError(null); try { await deploy.crews.endMember(c.id, m.id, dayIST(0)); refresh(); } catch (x) { setError(errorInfo(x)); } };
  return (
    <div data-testid="cr-members">
      {c.members.length === 0 ? <p className="muted">No member yet. Add the people deployed at {c.site}.</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Members"><table className="grid"><thead><tr><th>Name</th><th>Code</th><th>Designation</th><th>From</th><th>To</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{c.members.map((m) => <tr key={m.id} data-testid="cr-member"><td data-label="Name">{m.personType === 'EMPLOYEE' ? <Link to={`/hr/employees/employee?id=${m.personId}`}>{m.name}</Link> : m.name}</td><td data-label="Code">{m.code ?? '—'}</td><td data-label="Designation">{m.designation ?? '—'}</td><td data-label="From">{formatDate(m.fromDate)}</td><td data-label="To">{m.toDate ? formatDate(m.toDate) : 'open'}</td>
            <td data-label="Actions">{c.can.members && m.current && <button type="button" className="btn btn-small" onClick={() => end(m)} data-testid="cr-end">End today</button>}</td></tr>)}</tbody></table></div>
      )}
      {c.can.members && c.active && (
        <form className="mdm-panel mdm-fields" onSubmit={add} aria-label="Add a member" data-testid="cr-add-form">
          <LookupField id="cr-person" label="Employee" lookup="hr/employees" value={person} onChange={setPerson} error={error?.fields?.personId} required />
          <Field label="Joins on" name="fromDate" error={error}><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="cr-from" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" data-testid="cr-add">Add to the crew</button></div>
        </form>
      )}
      {error?.form && <p className="field-error" role="alert" data-testid="cr-error">{error.form}</p>}
    </div>
  );
}
