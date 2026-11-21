import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardGrid, Section } from '../../platform/design/Card.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { can, Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { bi, downloadProjectStatus } from './api.js';

const statuses = [
  ['SETUP', 'Setup'], ['MOBILISATION', 'Mobilisation'], ['EXECUTION', 'Execution'],
  ['SUSPENDED', 'Suspended'], ['SUBSTANTIALLY_COMPLETE', 'Substantially complete'],
  ['DLP', 'Defect liability period'], ['CLOSED', 'Closed'], ['ARCHIVED', 'Archived'],
];
const statusColumns = [
  { key: 'code', label: 'Code' }, { key: 'name', label: 'Project' },
  { key: 'stateLabel', label: 'Lifecycle' }, { key: 'statusLabel', label: 'Approval status' },
  { key: 'health', label: 'Health' },
];
const query = (state, page) => ({ page, ...(state ? { 'filter[state]': state } : {}) });
const healthLabel = { NONE: 'Not started', RED: 'At risk', AMBER: 'Watch', GREEN: 'On track' };

function Result({ report, columns, onPage }) {
  if (report.isPending) return <Skeleton label="Report results" />;
  if (report.error?.status === 403) return <NoPermission what="the report" permission="proj.project.view" />;
  if (report.error) return <ErrorState error={report.error} onRetry={report.refetch} />;
  const { data, meta } = report.data;
  if (!data.length) return <EmptyState title="No matching projects" message="Choose another lifecycle state or review your project scope." />;
  return (
    <>
      <CardGrid testid="bi-results">
        {data.map((row, index) => (
          <Card key={row.projectId ?? index} title={row.name}>
            <dl>
              {columns.filter(({ key }) => key !== 'name').map(({ key, label }) => (
                <div key={key}><dt>{label}</dt><dd>{key === 'health' ? (healthLabel[row[key]] ?? row[key]) : row[key]}</dd></div>
              ))}
            </dl>
          </Card>
        ))}
      </CardGrid>
      <nav className="actions-row" aria-label="Report results pagination">
        <button type="button" className="btn" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
        <span>Page {meta.page} of {meta.totalPages} · {meta.total} projects</span>
        <button type="button" className="btn" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>Next</button>
      </nav>
    </>
  );
}

export function LifecycleFilter({ state, onChange, options = statuses }) {
  return <Field name="bi-state" label="Lifecycle state">
    <select value={state} onChange={(e) => onChange(e.target.value)}>
      <option value="">All states</option>
      {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  </Field>;
}

export function ReportCatalogue({ session }) {
  usePageTitle('Report Catalogue');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [format, setFormat] = useState('csv');
  const [search, setSearch] = useState('');
  const params = query(state, page);
  const catalogue = useQuery({ queryKey: ['bi', 'catalogue'], queryFn: bi.catalogue, retry: false });
  const matches = catalogue.data?.filter(({ title }) => title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [];
  const projectStatus = matches.find(({ code }) => code === 'project-status');
  const ownerReports = matches.filter(({ route }) => route);
  const report = useQuery({ queryKey: ['bi', 'report', params], queryFn: () => bi.report(params), enabled: Boolean(projectStatus), retry: false });
  const exportFile = useMutation({ mutationFn: () => downloadProjectStatus({ ...(state ? { 'filter[state]': state } : {}), format }) });
  return <section>
    <PageHeader title="Report Catalogue" />
    {catalogue.isPending && <Skeleton label="Report catalogue" />}
    {catalogue.error && <ErrorState error={catalogue.error} onRetry={catalogue.refetch} />}
    {Boolean(catalogue.data?.length) && <Field name="bi-search" label="Find a report">
      <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
    </Field>}
    {catalogue.isSuccess && !matches.length && <EmptyState title="No reports found" />}
    {projectStatus && <Section title={projectStatus.title} description={projectStatus.description}>
      <div className="actions-row">
        <LifecycleFilter state={state} onChange={(value) => { setState(value); setPage(1); }} />
        {projectStatus.formats.length > 0 && can(session, 'proj.project.export') && <>
          <Field name="bi-format" label="Export format">
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              {projectStatus.formats.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
            </select>
          </Field>
          <button type="button" className="btn" disabled={exportFile.isPending || report.isPending || report.isError} onClick={() => exportFile.mutate()}>Export</button>
        </>}
      </div>
      {exportFile.error && <ErrorState error={exportFile.error} />}
      {exportFile.data && <p role="status">The export is queued. <Link to="/account/exports">Open My Exports</Link>.</p>}
      <Result report={report} columns={statusColumns} onPage={setPage} />
    </Section>}
    {Boolean(ownerReports.length) && <Section title="Module reports">
      <ul>{ownerReports.map(({ code, route, title }) => <li key={code}><Link to={route}>{title}</Link></li>)}</ul>
    </Section>}
  </section>;
}

const blank = { name: '', fields: ['code', 'name', 'stateLabel'], state: '', groupBy: '', shared: false, role: '' };
const previewOf = ({ fields, state, groupBy }) => ({
  fields, ...query(state, 1), ...(groupBy ? { groupBy } : {}),
});

function ProjectCounts({ summary, total }) {
  if (!summary?.rows.length) return null;
  const title = summary.groupBy === 'state' ? 'Projects by lifecycle' : 'Projects by approval status';
  return <figure>
    <figcaption>{title}</figcaption>
    <ul>{summary.rows.map(({ code, label, count }) => <li key={code}>
      <span>{label} · {count} of {total}</span>
      {' '}
      <meter min={0} max={total} value={count} aria-label={label} />
    </li>)}</ul>
  </figure>;
}

export function ReportBuilder({ session }) {
  usePageTitle('Report Builder');
  const cache = useQueryClient();
  const [form, setForm] = useState(blank);
  const [active, setActive] = useState(null);
  const [notice, setNotice] = useState('');
  const [format, setFormat] = useState('csv');
  const dataset = useQuery({ queryKey: ['bi', 'dataset'], queryFn: bi.dataset, retry: false });
  const saved = useQuery({ queryKey: ['bi', 'saved'], queryFn: bi.saved, enabled: Boolean(dataset.data), retry: false });
  const report = useQuery({ queryKey: ['bi', 'preview', active], queryFn: () => bi.preview(active), enabled: Boolean(active), retry: false });
  const exportFile = useMutation({ mutationFn: () => downloadProjectStatus({
    fields: active.fields.join(','), format,
    ...(active['filter[state]'] ? { 'filter[state]': active['filter[state]'] } : {}),
  }, true) });
  const save = useMutation({ mutationFn: bi.save, onSuccess: ({ data }) => {
    setForm((prior) => ({ ...prior, id: data.id, version: data.version }));
    setNotice('Report saved.');
    cache.invalidateQueries({ queryKey: ['bi', 'saved'] });
  } });
  const remove = useMutation({ mutationFn: bi.remove, onSuccess: () => {
    setForm(blank);
    setActive(null);
    setNotice('Report deleted.');
    cache.invalidateQueries({ queryKey: ['bi', 'saved'] });
  } });
  const update = (field, value) => setForm((prior) => ({ ...prior, [field]: value }));
  const open = (item) => {
    const state = item.config.filters.find((f) => f.key === 'state')?.value ?? '';
    const reportForm = { name: item.name, fields: item.config.columns, state, groupBy: item.config.groupBy ?? '', shared: item.isShared,
      role: item.shareScope.roles?.join(', ') ?? '', ...(item.mine ? { id: item.id, version: item.version } : {}) };
    setForm(reportForm);
    setActive(previewOf(reportForm));
    setNotice(item.mine ? '' : 'Shared report opened. Save to make your own copy.');
    save.reset();
    remove.reset();
  };
  const shareAllowed = can(session, 'ui.view.share');
  return <section>
    <PageHeader title="Report Builder" />
    {dataset.isPending && <Skeleton label="Project status dataset" />}
    {dataset.error?.status === 403 && <NoPermission what="the report builder" permission="proj.project.view" />}
    {dataset.error && dataset.error.status !== 403 && <ErrorState error={dataset.error} onRetry={dataset.refetch} />}
    {dataset.data && <>
      <Section title={dataset.data.title}>
        <form onSubmit={(e) => {
          e.preventDefault();
          const { role, ...config } = form;
          save.mutate({ ...config, shared: shareAllowed && form.shared,
            roles: shareAllowed && form.shared ? role.split(',').map((r) => r.trim()).filter(Boolean) : [] });
        }}>
          <Field name="bi-name" label="Report name"><input value={form.name} maxLength={80} required onChange={(e) => update('name', e.target.value)} /></Field>
          <LifecycleFilter state={form.state} onChange={(value) => update('state', value)} options={dataset.data.states} />
          <Field name="bi-group" label="Group project count by">
            <select value={form.groupBy} onChange={(event) => update('groupBy', event.target.value)}>
              <option value="">No grouping</option>
              {dataset.data.groups.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <fieldset className="mdm-panel">
            <legend>Fields</legend>
            {dataset.data.columns.map(({ key, label }) => <div key={key}><label>
              <input type="checkbox" checked={form.fields.includes(key)} onChange={(e) => update('fields', e.target.checked ? [...form.fields, key] : form.fields.filter((f) => f !== key))} /> {label}
            </label></div>)}
          </fieldset>
          {shareAllowed && <Field name="bi-sharing" label="Visibility">
            <select value={form.shared ? 'shared' : 'personal'} onChange={(e) => update('shared', e.target.value === 'shared')}>
              <option value="personal">Personal</option><option value="shared">Shared with roles</option>
            </select>
          </Field>}
          {shareAllowed && form.shared && <Field name="bi-roles" label="Role codes">
            <input value={form.role} required placeholder="PM, PD" onChange={(e) => update('role', e.target.value)} />
          </Field>}
          <div className="actions-row">
            <button type="button" className="btn" disabled={!form.fields.length} onClick={() => setActive(previewOf(form))}>Preview</button>
            <button type="submit" className="btn btn-primary" disabled={!form.fields.length || save.isPending}>Save report</button>
            <button type="button" className="btn" disabled={save.isPending || remove.isPending} onClick={() => { setForm(blank); setActive(null); setNotice(''); save.reset(); remove.reset(); }}>New report</button>
            {form.id && <button type="button" className="btn" disabled={save.isPending || remove.isPending} onClick={() => {
              if (window.confirm(`Delete ${form.name}?`)) remove.mutate(form);
            }}>Delete report</button>}
          </div>
        </form>
        {notice && <p role="status">{notice}</p>}
        {(save.error || remove.error) && <ErrorState error={save.error ?? remove.error} />}
      </Section>
      {active && <Section title="Preview">
        {report.isSuccess && <ProjectCounts summary={report.data.summary} total={report.data.meta.total} />}
        {dataset.data.formats.length > 0 && can(session, 'proj.project.export') && <div className="actions-row">
          <Field name="bi-preview-format" label="Export format">
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              {dataset.data.formats.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
            </select>
          </Field>
          <button type="button" className="btn" disabled={exportFile.isPending || !report.isSuccess} onClick={() => exportFile.mutate()}>Export rows</button>
        </div>}
        {exportFile.error && <ErrorState error={exportFile.error} />}
        {exportFile.data && <p role="status">The export is queued. <Link to="/account/exports">Open My Exports</Link>.</p>}
        <Result report={report} columns={active.fields.map((key) => dataset.data.columns.find((c) => c.key === key))}
          onPage={(page) => setActive({ ...active, page })} />
      </Section>}
      <Section title="My & Shared Custom Reports">
        {saved.isPending && <Skeleton label="Saved reports" />}
        {saved.error && <ErrorState error={saved.error} onRetry={saved.refetch} />}
        {saved.data?.length === 0 && <EmptyState title="No saved reports" message="Select fields above and save a report." />}
        {saved.data?.map((item) => <div key={item.id} className="actions-row">
          <button type="button" className="btn" disabled={save.isPending || remove.isPending} onClick={() => open(item)}>{item.name}</button>
          <span>{item.mine ? (item.isShared ? 'Shared by you' : 'Personal') : 'Shared'}</span>
        </div>)}
      </Section>
    </>}
  </section>;
}
