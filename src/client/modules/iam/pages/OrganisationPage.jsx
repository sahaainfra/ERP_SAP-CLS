import { useState } from 'react';
import { GST_STATES } from '../../../../shared/gst.js';
import { can, usePageTitle } from '../../core/pages/ui.jsx';
import OrgList, { labelOf } from '../components/OrgList.jsx';
import PageHeader from '../../../platform/design/PageHeader.jsx';

const STATES = GST_STATES.map((s) => [s.code, `${s.code} ${s.name}`]);
const BRANCH_KINDS = [['BRANCH', 'Branch'], ['REGION', 'Region']];
const DEPT_KINDS = [['DEPARTMENT', 'Department'], ['DIVISION', 'Division']];
const LOCATION_TYPES = [['OFFICE', 'Office'], ['CENTRAL_WAREHOUSE', 'Central warehouse'], ['BATCHING_PLANT', 'Batching plant'], ['LABOUR_CAMP', 'Labour camp']];
const stateName = (code) => (code ? (STATES.find(([c]) => c === code)?.[1] ?? code) : '');

const TABS = {
  companies: {
    label: 'Companies', title: 'Companies', noun: 'company', permission: 'org.company.manage',
    hint: 'Each company is a separate legal entity with its own data. The system administrator sees every company; everyone else sees their own.',
    columns: [
      { key: 'code', label: 'Code', sort: 'code' }, { key: 'legalName', label: 'Legal name', sort: 'name' }, { key: 'shortName', label: 'Short name' }, { key: 'pan', label: 'PAN' },
      { key: 'gstinPrimary', label: 'Primary GSTIN' }, { key: 'projectCount', label: 'Projects' }, { key: 'status', label: 'Status', sort: 'status' },
    ],
    fields: [
      { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'legalName', label: 'Legal name', type: 'text', required: true }, { name: 'shortName', label: 'Short name', type: 'text', required: true, max: 60 },
      { name: 'pan', label: 'PAN', type: 'text', max: 10, hint: 'For example ABCDE1234F' }, { name: 'gstinPrimary', label: 'Primary GSTIN', type: 'text', max: 15 },
    ],
  },
  branches: {
    label: 'Branches & regions', title: 'Branches', noun: 'branch', permission: 'org.company.manage',
    hint: 'A region groups branches. Each branch carries the state and the GST registration used on its invoices.',
    columns: [
      { key: 'code', label: 'Code', sort: 'code' }, { key: 'name', label: 'Name', sort: 'name' }, { key: 'kind', label: 'Kind', render: (r) => labelOf(BRANCH_KINDS, r.kind), text: (r) => r.kind },
      { key: 'parentCode', label: 'Region' }, { key: 'stateCode', label: 'State', render: (r) => stateName(r.stateCode), text: (r) => r.stateCode }, { key: 'gstin', label: 'GSTIN' }, { key: 'status', label: 'Status', sort: 'status' },
    ],
    filters: [{ name: 'kind', label: 'Kind', options: BRANCH_KINDS }],
    fields: [
      { name: 'kind', label: 'Kind', type: 'select', options: BRANCH_KINDS, required: true, default: 'BRANCH' }, { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'parentId', label: 'Region', type: 'ref', ref: 'branches' }, { name: 'stateCode', label: 'State', type: 'select', options: STATES }, { name: 'address', label: 'Address', type: 'textarea' }, { name: 'gstin', label: 'GSTIN', type: 'text', max: 15 },
    ],
  },
  departments: {
    label: 'Departments', title: 'Departments', noun: 'department', permission: 'org.hr.manage',
    hint: 'Divisions and departments, to any depth. The head is changed from the organisation chart history with an effective date; set the first head here.',
    columns: [
      { key: 'code', label: 'Code', sort: 'code' }, { key: 'name', label: 'Name', sort: 'name' }, { key: 'kind', label: 'Kind', render: (r) => labelOf(DEPT_KINDS, r.kind), text: (r) => r.kind },
      { key: 'parentCode', label: 'Parent' }, { key: 'branchName', label: 'Branch' }, { key: 'headName', label: 'Head' }, { key: 'status', label: 'Status', sort: 'status' },
    ],
    filters: [{ name: 'kind', label: 'Kind', options: DEPT_KINDS }],
    fields: [
      { name: 'kind', label: 'Kind', type: 'select', options: DEPT_KINDS, required: true, default: 'DEPARTMENT' }, { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'parentId', label: 'Parent', type: 'ref', ref: 'departments' }, { name: 'branchId', label: 'Branch', type: 'ref', ref: 'branches' }, { name: 'headUserId', label: 'Head (first assignment)', type: 'user', createOnly: true },
    ],
  },
  designations: {
    label: 'Designations', title: 'Designations', noun: 'designation', permission: 'org.hr.manage',
    columns: [
      { key: 'code', label: 'Code', sort: 'code' }, { key: 'name', label: 'Name', sort: 'name' }, { key: 'grade', label: 'Grade' }, { key: 'level', label: 'Level', sort: 'level' }, { key: 'status', label: 'Status', sort: 'status' },
    ],
    fields: [
      { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'name', label: 'Name', type: 'text', required: true }, { name: 'grade', label: 'Grade', type: 'text', max: 20 },
      { name: 'level', label: 'Level (1 to 20)', type: 'number', min: 1, max: 20, required: true, default: 1 },
    ],
  },
  locations: {
    label: 'Locations', title: 'Locations', noun: 'location', permission: 'org.company.manage',
    hint: 'Offices, central warehouses, batching plants and labour camps that are not tied to one project site.',
    columns: [
      { key: 'code', label: 'Code', sort: 'code' }, { key: 'name', label: 'Name', sort: 'name' }, { key: 'type', label: 'Type', render: (r) => labelOf(LOCATION_TYPES, r.type), text: (r) => r.type, sort: 'type' },
      { key: 'stateCode', label: 'State', render: (r) => stateName(r.stateCode), text: (r) => r.stateCode }, { key: 'address', label: 'Address' },
      { key: 'latitude', label: 'Latitude' }, { key: 'longitude', label: 'Longitude' }, { key: 'status', label: 'Status', sort: 'status' },
    ],
    filters: [{ name: 'type', label: 'Type', options: LOCATION_TYPES }],
    fields: [
      { name: 'type', label: 'Type', type: 'select', options: LOCATION_TYPES, required: true }, { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'stateCode', label: 'State', type: 'select', options: STATES }, { name: 'address', label: 'Address', type: 'textarea' },
      { name: 'latitude', label: 'Latitude', type: 'number', step: 'any', min: -90, max: 90 }, { name: 'longitude', label: 'Longitude', type: 'number', step: 'any', min: -180, max: 180 },
    ],
  },
};

export default function OrganisationPage({ session }) {
  usePageTitle('Organisation');
  const [tab, setTab] = useState('companies');
  const t = TABS[tab];
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Organisation</nav>
      <PageHeader id="page-title" title={"Organisation"} />
      <div role="tablist" aria-label="Organisation lists" className="actions">
        {Object.entries(TABS).map(([id, x]) => (
          <button key={id} type="button" role="tab" id={`tab-${id}`} aria-selected={tab === id} className={`btn${tab === id ? ' btn-primary' : ''}`} onClick={() => setTab(id)}>{x.label}</button>
        ))}
      </div>
      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        <OrgList key={tab} entity={tab} title={t.title} noun={t.noun} columns={t.columns} fields={t.fields} filters={t.filters} hint={t.hint} canManage={can(session, t.permission)} />
      </div>
    </section>
  );
}
