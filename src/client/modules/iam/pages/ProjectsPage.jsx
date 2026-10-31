import { useRef, useState } from 'react';
import { formatDate } from '../../../platform/format.js';
import { FormDialog, QueryState, can, errorInfo, usePageTitle } from '../../core/pages/ui.jsx';
import { useOrgDeactivate, useOrgItem, useOrgUpdate, useProjectStatus, useRequestActivation, useRequestGeofence } from '../api/org.js';
import GeofenceEditor from '../components/GeofenceEditor.jsx';
import { AssignDialog, HistoryPanel, ReasonDialog, RequestsPanel } from '../components/ObjectPanels.jsx';
import OrgList, { FieldInput, StatusChip, labelOf, readForm } from '../components/OrgList.jsx';

const PROJECT_TYPES = [['BUILDING', 'Building'], ['ROAD', 'Road'], ['BRIDGE', 'Bridge'], ['INDUSTRIAL', 'Industrial'], ['EPC', 'EPC'], ['WATER', 'Water'], ['RAIL', 'Rail'], ['OTHER', 'Other']];
const SITE_TYPES = [['SITE', 'Site'], ['CAMP', 'Camp'], ['STORE', 'Store'], ['PLANT', 'Plant'], ['OFFICE', 'Office']];

const PROJECT_FIELDS = [
  { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'name', label: 'Name', type: 'text', required: true, max: 160 },
  { name: 'type', label: 'Type', type: 'select', options: PROJECT_TYPES, required: true }, { name: 'branchId', label: 'Branch', type: 'ref', ref: 'branches' },
  { name: 'clientName', label: 'Client', type: 'text', max: 160, hint: 'Linked to the customer master later' }, { name: 'startDate', label: 'Start date', type: 'date' }, { name: 'endDate', label: 'End date', type: 'date' },
  { name: 'pmUserId', label: 'Project manager (first assignment)', type: 'user', createOnly: true },
];
const SITE_FIELDS = [
  { name: 'code', label: 'Code', type: 'text', required: true, max: 30 }, { name: 'name', label: 'Name', type: 'text', required: true, max: 160 },
  { name: 'siteType', label: 'Site type', type: 'select', options: SITE_TYPES, required: true, default: 'SITE' }, { name: 'address', label: 'Address', type: 'textarea' },
  { name: 'workingStart', label: 'Working hours from', type: 'time' }, { name: 'workingEnd', label: 'Working hours to', type: 'time' }, { name: 'timezone', label: 'Time zone', type: 'text', max: 60, default: 'Asia/Kolkata' },
  { name: 'inChargeUserId', label: 'Site in-charge (first assignment)', type: 'user', createOnly: true },
];

const PROJECT_COLUMNS = [
  { key: 'code', label: 'Code', sort: 'code' }, { key: 'name', label: 'Name', sort: 'name' }, { key: 'type', label: 'Type', render: (r) => labelOf(PROJECT_TYPES, r.type), text: (r) => r.type, sort: 'type' },
  { key: 'branchName', label: 'Branch' }, { key: 'clientName', label: 'Client' }, { key: 'pmName', label: 'Project manager' }, { key: 'startDate', label: 'Start', render: (r) => (r.startDate ? formatDate(r.startDate) : ''), text: (r) => r.startDate, sort: 'startDate' },
  { key: 'siteCount', label: 'Sites' }, { key: 'status', label: 'Status', sort: 'status' },
];
const SITE_COLUMNS = [
  { key: 'code', label: 'Code', sort: 'code' }, { key: 'name', label: 'Name', sort: 'name' }, { key: 'siteType', label: 'Type', render: (r) => labelOf(SITE_TYPES, r.siteType), text: (r) => r.siteType, sort: 'type' },
  { key: 'address', label: 'Address' }, { key: 'inChargeName', label: 'In-charge' }, { key: 'geofence', label: 'Geofence', render: (r) => (r.geofence.type === 'NONE' ? 'None' : r.geofence.type === 'CIRCLE' ? `Circle ${r.geofence.radiusM} m` : 'Polygon'), text: (r) => r.geofence.type },
  { key: 'status', label: 'Status', sort: 'status' },
];

const Row = ({ label, children }) => <div className="kv"><dt>{label}</dt><dd>{children || '-'}</dd></div>;
const TABS = { project: [['details', 'Details'], ['sites', 'Sites'], ['approvals', 'Approvals'], ['timeline', 'Timeline']], site: [['details', 'Details'], ['geofence', 'Geofence'], ['approvals', 'Approvals'], ['timeline', 'Timeline']] };

function Tabs({ kind, tab, setTab }) {
  return (
    <div role="tablist" aria-label={`${kind} sections`} className="actions">
      {TABS[kind].map(([id, label]) => (
        <button key={id} type="button" role="tab" id={`otab-${id}`} aria-selected={tab === id} className={`btn${tab === id ? ' btn-primary' : ''}`} onClick={() => setTab(id)}>{label}</button>
      ))}
    </div>
  );
}

function EditDialog({ dialogRef, entity, row, fields, onDone }) {
  const update = useOrgUpdate(entity);
  const [error, setError] = useState(null);
  return (
    <FormDialog
      dialogRef={dialogRef}
      title={`Edit ${row?.code ?? ''}`}
      error={error}
      busy={update.isPending}
      onSubmit={async (f) => {
        setError(null);
        try {
          await update.mutateAsync({ id: row.id, version: row.version, ...readForm(f, fields, { creating: false }), reason: String(f.get('reason')) });
          dialogRef.current?.close();
          onDone('Saved.');
        } catch (err) {
          setError(errorInfo(err));
        }
      }}
    >
      <div key={`${row?.id}-${row?.version}`} className="form-grid">{fields.filter((s) => !s.createOnly).map((s) => <FieldInput key={s.name} spec={s} row={row} error={error} />)}</div>
    </FormDialog>
  );
}

function ProjectObject({ id, session, back, openSite }) {
  const q = useOrgItem('projects', id);
  const [tab, setTab] = useState('details');
  const [notice, setNotice] = useState('');
  const edit = useRef(null);
  const assign = useRef(null);
  const activation = useRef(null);
  const statusDialog = useRef(null);
  const [move, setMove] = useState(null);
  const status = useProjectStatus();
  const request = useRequestActivation('projects');
  const p = q.data;
  const manage = can(session, 'org.project.manage');
  const moves = { ACTIVE: [['ON_HOLD', 'Put on hold'], ['COMPLETED', 'Mark completed']], ON_HOLD: [['ACTIVE', 'Resume'], ['COMPLETED', 'Mark completed']], COMPLETED: [['CLOSED', 'Close']] }[p?.status] ?? [];
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb"><a href="#back" onClick={(e) => { e.preventDefault(); back(); }}>Projects</a> &rsaquo; {p?.code ?? '...'}</nav>
      <QueryState query={q} what="the project" permission="org.view" />
      {p && (
        <>
          <div className="page-head">
            <h1 id="page-title">{p.code} <span className="muted">{p.name}</span> <StatusChip status={p.status} /></h1>
            <div className="actions">
              {manage && p.status !== 'CLOSED' && <button type="button" className="btn" onClick={() => edit.current?.showModal()}>Edit</button>}
              {manage && p.status !== 'CLOSED' && <button type="button" className="btn" onClick={() => assign.current?.showModal()}>Change manager</button>}
              {manage && p.status === 'DRAFT' && <button type="button" className="btn btn-primary" onClick={() => activation.current?.showModal()}>Request activation</button>}
              {manage && moves.map(([to, label]) => <button key={to} type="button" className="btn" onClick={() => { setMove({ to, label }); statusDialog.current?.showModal(); }}>{label}</button>)}
            </div>
          </div>
          <div className="tiles">
            <div className="tile"><span className="tile-value">{p.siteCount}</span><span className="tile-label">Sites</span></div>
            <div className="tile"><span className="tile-value">{p.pmName ?? 'Vacant'}</span><span className="tile-label">Project manager</span></div>
            <div className="tile"><span className="tile-value">{p.startDate ? formatDate(p.startDate) : '-'}</span><span className="tile-label">Start</span></div>
            <div className="tile"><span className="tile-value">{p.endDate ? formatDate(p.endDate) : '-'}</span><span className="tile-label">End</span></div>
          </div>
          <p role="status" className="notice" data-testid="object-notice">{notice}</p>
          <Tabs kind="project" tab={tab} setTab={setTab} />
          <div role="tabpanel" aria-labelledby={`otab-${tab}`}>
            {tab === 'details' && (
              <dl className="kv-list">
                <Row label="Type">{labelOf(PROJECT_TYPES, p.type)}</Row><Row label="Branch">{p.branchName}</Row><Row label="Client">{p.clientName}</Row>
                <Row label="Project manager">{p.pmName}</Row><Row label="Created by">{p.createdBy}</Row>
              </dl>
            )}
            {tab === 'sites' && <OrgList entity="sites" title="Sites" noun="site" newLabel="New site" columns={SITE_COLUMNS} fields={SITE_FIELDS} fixedFilters={{ projectId: String(p.id) }} defaults={{ projectId: p.id }} controlled canManage={can(session, 'org.site.manage') && p.status !== 'CLOSED'} onOpen={(r) => openSite(r.id)} hint="A site belongs to exactly one project. A new site is a draft until it is activated through approval." />}
            {tab === 'approvals' && <RequestsPanel entity="projects" id={p.id} />}
            {tab === 'timeline' && <HistoryPanel entity="projects" id={p.id} canManage={manage} />}
          </div>
          <EditDialog dialogRef={edit} entity="projects" row={p} fields={PROJECT_FIELDS} onDone={setNotice} />
          <AssignDialog dialogRef={assign} entity="projects" row={p} role="PROJECT_MANAGER" onDone={setNotice} />
          <ReasonDialog dialogRef={activation} title={`Request activation of ${p.code}`} submitLabel="Send request" onDone={() => setNotice('The activation request was sent to the project director.')} onRun={(reason) => request.mutateAsync({ id: p.id, reason })}>
            <p className="muted">The project director approves first, then project control. The project stays a draft until both have approved.</p>
          </ReasonDialog>
          <ReasonDialog dialogRef={statusDialog} title={`${move?.label ?? ''} ${p.code}`} submitLabel={move?.label} onDone={() => setNotice(`The project is now ${labelOf([], move?.to).toLowerCase()}.`)} onRun={(reason) => status.mutateAsync({ id: p.id, status: move.to, reason, version: p.version })}>
            <p className="muted">Completing or closing a project is blocked while it still has active sites or other open records.</p>
          </ReasonDialog>
        </>
      )}
    </section>
  );
}

function SiteObject({ id, session, back, openProject }) {
  const q = useOrgItem('sites', id);
  const [tab, setTab] = useState('details');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState(null);
  const edit = useRef(null);
  const assign = useRef(null);
  const activation = useRef(null);
  const deactivate = useRef(null);
  const geofenceRequest = useRef(null);
  const update = useOrgUpdate('sites');
  const request = useRequestActivation('sites');
  const stop = useOrgDeactivate('sites');
  const geofence = useRequestGeofence();
  const [saveError, setSaveError] = useState(null);
  const s = q.data;
  const manage = can(session, 'org.site.manage');
  const mayRequest = can(session, 'org.geofence.request');
  const value = draft ?? s?.geofence;
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(s.geofence);
  const valid = Boolean(draft && draft.type !== 'NONE') || draft?.type === 'NONE';

  const saveDirect = async () => {
    setSaveError(null);
    try {
      await update.mutateAsync({ id: s.id, version: s.version, geofenceType: draft.type, latitude: draft.latitude ?? null, longitude: draft.longitude ?? null, geofenceRadiusM: draft.radiusM ?? null, geofencePolygon: draft.polygon ?? null });
      setDraft(null);
      setNotice('The geofence was saved.');
    } catch (err) {
      setSaveError(errorInfo(err));
    }
  };
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb"><a href="#back" onClick={(e) => { e.preventDefault(); back(); }}>Projects</a> &rsaquo; {s ? <a href="#project" onClick={(e) => { e.preventDefault(); openProject(s.projectId); }}>{s.projectCode}</a> : '...'} &rsaquo; {s?.code ?? '...'}</nav>
      <QueryState query={q} what="the site" permission="org.view" />
      {s && (
        <>
          <div className="page-head">
            <h1 id="page-title">{s.code} <span className="muted">{s.name}</span> <StatusChip status={s.status} /></h1>
            <div className="actions">
              {manage && s.status !== 'INACTIVE' && <button type="button" className="btn" onClick={() => edit.current?.showModal()}>Edit</button>}
              {manage && s.status !== 'INACTIVE' && <button type="button" className="btn" onClick={() => assign.current?.showModal()}>Change in-charge</button>}
              {manage && ['DRAFT', 'INACTIVE'].includes(s.status) && <button type="button" className="btn btn-primary" onClick={() => activation.current?.showModal()}>Request activation</button>}
              {manage && s.status !== 'INACTIVE' && <button type="button" className="btn" onClick={() => deactivate.current?.showModal()}>Deactivate</button>}
            </div>
          </div>
          <div className="tiles">
            <div className="tile"><span className="tile-value">{s.inChargeName ?? 'Vacant'}</span><span className="tile-label">In-charge</span></div>
            <div className="tile"><span className="tile-value">{s.geofence.type === 'NONE' ? 'None' : s.geofence.type === 'CIRCLE' ? `${s.geofence.radiusM} m circle` : 'Polygon'}</span><span className="tile-label">Geofence</span></div>
            <div className="tile"><span className="tile-value">{s.workingStart && s.workingEnd ? `${s.workingStart} - ${s.workingEnd}` : '-'}</span><span className="tile-label">Working hours</span></div>
          </div>
          <p role="status" className="notice" data-testid="object-notice">{notice}</p>
          <Tabs kind="site" tab={tab} setTab={setTab} />
          <div role="tabpanel" aria-labelledby={`otab-${tab}`}>
            {tab === 'details' && (
              <dl className="kv-list">
                <Row label="Project">{`${s.projectCode} ${s.projectName}`}</Row><Row label="Type">{labelOf(SITE_TYPES, s.siteType)}</Row><Row label="Address">{s.address}</Row>
                <Row label="Centre">{s.latitude != null ? `${s.latitude}, ${s.longitude}` : ''}</Row><Row label="Time zone">{s.timezone}</Row><Row label="Created by">{s.createdBy}</Row>
              </dl>
            )}
            {tab === 'geofence' && (
              <>
                <p className="muted">
                  {s.status === 'DRAFT' ? 'A draft site takes its geofence directly. After activation, a change needs approval with a reason.' : 'The geofence of an active site changes only through an approved request (maker-checker). You can still draw a proposal and test coordinates.'}
                </p>
                <GeofenceEditor key={`${s.id}-${s.version}`} value={value} onChange={setDraft} readOnly={!(s.status === 'DRAFT' ? manage : mayRequest)} />
                {saveError && <p className="field-error" role="alert">{saveError.form}</p>}
                <div className="actions">
                  {s.status === 'DRAFT' && manage && <button type="button" className="btn btn-primary" disabled={!dirty || !valid || update.isPending} onClick={saveDirect}>Save geofence</button>}
                  {s.status !== 'DRAFT' && mayRequest && <button type="button" className="btn btn-primary" disabled={!dirty || !valid} onClick={() => geofenceRequest.current?.showModal()}>Request geofence change</button>}
                  {dirty && <button type="button" className="btn" onClick={() => setDraft(null)}>Discard changes</button>}
                </div>
              </>
            )}
            {tab === 'approvals' && <RequestsPanel entity="sites" id={s.id} />}
            {tab === 'timeline' && <HistoryPanel entity="sites" id={s.id} canManage={manage} />}
          </div>
          <EditDialog dialogRef={edit} entity="sites" row={s} fields={SITE_FIELDS} onDone={setNotice} />
          <AssignDialog dialogRef={assign} entity="sites" row={s} role="IN_CHARGE" onDone={setNotice} />
          <ReasonDialog dialogRef={activation} title={`Request activation of ${s.code}`} submitLabel="Send request" onDone={() => setNotice('The activation request was sent to the project director.')} onRun={(reason) => request.mutateAsync({ id: s.id, reason })}>
            <p className="muted">The project director approves first, then project control. The project must already be active.</p>
          </ReasonDialog>
          <ReasonDialog dialogRef={deactivate} title={`Deactivate site ${s.code}`} submitLabel="Deactivate" onDone={() => setNotice('The site is now inactive.')} onRun={(reason) => stop.mutateAsync({ id: s.id, version: s.version, reason })}>
            <p className="muted">A site with open records cannot be deactivated; every blocker is listed so you can clear it.</p>
          </ReasonDialog>
          <ReasonDialog dialogRef={geofenceRequest} title={`Request a geofence change for ${s.code}`} submitLabel="Send request" onDone={() => { setDraft(null); setNotice('The geofence change was sent to the system administrator for approval.'); setTab('approvals'); }}
            onRun={(reason) => geofence.mutateAsync({ id: s.id, reason, geofence: { type: draft.type, latitude: draft.latitude ?? null, longitude: draft.longitude ?? null, radiusM: draft.radiusM ?? null, polygon: draft.polygon ?? null } })}>
            <p className="muted">The system administrator decides. The current geofence stays in force until then.</p>
          </ReasonDialog>
        </>
      )}
    </section>
  );
}

export default function ProjectsPage({ session }) {
  usePageTitle('Projects & Sites');
  const [sel, setSel] = useState(null);
  if (sel?.kind === 'project') return <ProjectObject id={sel.id} session={session} back={() => setSel(null)} openSite={(id) => setSel({ kind: 'site', id })} />;
  if (sel?.kind === 'site') return <SiteObject id={sel.id} session={session} back={() => setSel(null)} openProject={(id) => setSel({ kind: 'project', id })} />;
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Projects</nav>
      <div className="page-head"><h1 id="page-title">Projects &amp; Sites</h1></div>
      <OrgList entity="projects" title="Projects" noun="project" columns={PROJECT_COLUMNS} fields={PROJECT_FIELDS} controlled canManage={can(session, 'org.project.manage')} onOpen={(r) => setSel({ kind: 'project', id: r.id })} filters={[{ name: 'type', label: 'Type', options: PROJECT_TYPES }]}
        hint="The basic project master. A new project is a draft until the project director and project control approve it; later parts enrich it." />
      <h2>Sites</h2>
      <OrgList entity="sites" title="Sites" noun="site" columns={[{ key: 'code', label: 'Code', sort: 'code' }, { key: 'projectCode', label: 'Project' }, ...SITE_COLUMNS.slice(1)]} fields={SITE_FIELDS} controlled canManage={false} onOpen={(r) => setSel({ kind: 'site', id: r.id })} filters={[{ name: 'siteType', label: 'Type', options: SITE_TYPES }]} hint="Every site of every project. Add a site from its project." />
    </section>
  );
}
