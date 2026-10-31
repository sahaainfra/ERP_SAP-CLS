import { useState } from 'react';
import { QueryState, can, usePageTitle } from '../../core/pages/ui.jsx';
import { useOrgTree } from '../api/org.js';
import OrgList, { StatusChip, labelOf } from '../components/OrgList.jsx';

const TYPES = [['COST', 'Cost centre'], ['PROFIT', 'Profit centre']];
const LINKS = [['DEPARTMENT', 'Department'], ['PROJECT', 'Project'], ['SITE', 'Site']];

const COLUMNS = [
  { key: 'code', label: 'Code', sort: 'code' }, { key: 'name', label: 'Name', sort: 'name' }, { key: 'type', label: 'Kind', render: (r) => labelOf(TYPES, r.type), text: (r) => r.type, sort: 'type' },
  { key: 'parentCode', label: 'Parent' }, { key: 'linkedType', label: 'Mapped to', render: (r) => (r.linkedType ? `${labelOf(LINKS, r.linkedType)}: ${r.linkedName ?? r.linkedId}` : ''), text: (r) => (r.linkedType ? `${r.linkedType}: ${r.linkedName ?? r.linkedId}` : '') },
  { key: 'status', label: 'Status', sort: 'status' },
];
const FIELDS = [
  { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'name', label: 'Name', type: 'text', required: true, max: 160 },
  { name: 'type', label: 'Kind', type: 'select', options: TYPES, required: true, default: 'COST' }, { name: 'parentId', label: 'Parent', type: 'ref', ref: 'cost-centres' },
  { name: 'linkedType', label: 'Mapped to', type: 'link' },
];

const Branch = ({ nodes }) => (
  <ul className="chart-plain">
    {nodes.map((n) => (
      <li key={n.id} data-testid={`cc-${n.code}`}>
        <strong>{n.code}</strong> {n.name} <span className="chip chip-not_applicable">{labelOf(TYPES, n.type)}</span> {n.linkedType && <span className="muted small">{labelOf(LINKS, n.linkedType)} #{n.linkedId}</span>} {n.status !== 'ACTIVE' && <StatusChip status={n.status} />}
        {n.children.length > 0 && <Branch nodes={n.children} />}
      </li>
    ))}
  </ul>
);

function Hierarchy() {
  const tree = useOrgTree();
  const nodes = tree.data?.costCentres ?? [];
  return (
    <>
      <QueryState query={tree} what="the hierarchy" permission="org.view" />
      {tree.data && (nodes.length === 0 ? <div className="state"><h2>No cost or profit centres</h2><p>Add the first one from the list view.</p></div> : <Branch nodes={nodes} />)}
    </>
  );
}

export default function CostCentresPage({ session }) {
  usePageTitle('Cost & Profit Centres');
  const [view, setView] = useState('list');
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Organisation &rsaquo; Cost &amp; Profit Centres</nav>
      <div className="page-head"><h1 id="page-title">Cost &amp; Profit Centres</h1></div>
      <div role="tablist" aria-label="Views" className="actions">
        {[['list', 'List'], ['hierarchy', 'Hierarchy']].map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`cctab-${id}`} aria-selected={view === id} className={`btn${view === id ? ' btn-primary' : ''}`} onClick={() => setView(id)}>{label}</button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`cctab-${view}`}>
        {view === 'list'
          ? <OrgList entity="cost-centres" title="Cost centres" noun="cost centre" columns={COLUMNS} fields={FIELDS} canManage={can(session, 'org.costcentre.manage')} filters={[{ name: 'type', label: 'Kind', options: TYPES }, { name: 'linkedType', label: 'Mapped to', options: LINKS }]} hint="Cost and profit centres form a hierarchy and can be mapped to a department, a project or a site." />
          : <Hierarchy />}
      </div>
    </section>
  );
}
