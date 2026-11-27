import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../core/api/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { deploy } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Crews & Gangs (HR, part 07.03): the List Report of crews with their site, trade, supervisor and the members in force today. "New crew" opens a short form: the site, a code, a name, the trade and the supervisor (an employee).
// A crew belongs to one site; its members are staff deployed at that site (contract labour joins with the labour register, part 07.08).
export default function CrewsPage() {
  usePageTitle('Crews & Gangs');
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const canNew = perms.includes('hr.crew.edit');
  const [adding, setAdding] = useState(false);
  return (
    <section aria-labelledby="cw-title" data-testid="crews">
      <PageHeader id="cw-title" srOnly title={"Crews & Gangs"} />
      <ListReport listCode="hr.crews" endpoint="/hr/crews" exportEndpoint="/ui/lists/hr.crews/export" title="Crews & Gangs" session={session.data}
        rowHref={(r) => `/hr/crews/crew?id=${r.id}`} onOpen={(r) => navigateTo(`/hr/crews/crew?id=${r.id}`)}
        cardFields={['code', 'name', 'site', 'members', 'active']} statusKey="active"
        newAction={canNew ? { label: 'New crew', onClick: () => setAdding(true) } : undefined}
        empty={{ title: 'No crew here', text: canNew ? 'Make the first crew of a site with New crew.' : 'Crews appear here once a site has gangs.' }} />
      {adding && <NewCrew close={() => setAdding(false)} />}
      <p className="small"><Link to="/hr/deployment-board">Deployment Board</Link> · <Link to="/hr/deployments">Deployments</Link></p>
    </section>
  );
}

function NewCrew({ close }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ projectId: '', siteId: '', code: '', name: '', trade: '', supervisorId: '' });
  const [error, setError] = useState(null);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const fe = (k) => error?.fields?.[k];
  const go = async (e) => {
    e.preventDefault(); setError(null);
    try {
      const c = await deploy.crews.create({ siteId: Number(v.siteId), code: v.code.trim(), name: v.name.trim(), trade: v.trade.trim() || null, supervisorId: v.supervisorId ? Number(v.supervisorId) : null });
      qc.invalidateQueries({ queryKey: ['hr'] }); navigateTo(`/hr/crews/crew?id=${c.id}`, { force: true });
    } catch (x) { setError(errorInfo(x)); }
  };
  return (
    <form className="mdm-panel mdm-fields" onSubmit={go} data-testid="cw-new-form" aria-label="New crew">
      <LookupField id="cw-project" label="Project" lookup="iam/projects" value={v.projectId} onChange={(x) => set({ projectId: x, siteId: '' })} />
      <LookupField id="cw-site" label="Site" lookup="iam/sites" parent={v.projectId || undefined} parentLabel="project" value={v.siteId} onChange={(x) => set({ siteId: x })} error={fe('siteId')} required />
      <Field label="Code (required)" name="code" error={error}><input value={v.code} maxLength={20} onChange={(e) => set({ code: e.target.value })} required data-testid="cw-code" /></Field>
      <Field label="Name (required)" name="name" error={error}><input value={v.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} required data-testid="cw-name" /></Field>
      <Field label="Trade" name="trade" error={error}><input value={v.trade} maxLength={60} onChange={(e) => set({ trade: e.target.value })} data-testid="cw-trade" /></Field>
      <LookupField id="cw-supervisor" label="Supervisor" lookup="hr/employees" value={v.supervisorId} onChange={(x) => set({ supervisorId: x })} error={fe('supervisorId')} />
      {error?.form && <p className="field-error" role="alert" data-testid="cw-error">{error.form}</p>}
      <div className="actions"><button type="button" className="btn" onClick={close}>Close</button><button type="submit" className="btn btn-primary" data-testid="cw-create">Make the crew</button></div>
    </form>
  );
}
