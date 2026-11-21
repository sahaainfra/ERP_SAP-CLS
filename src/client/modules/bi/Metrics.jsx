import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card, CardGrid, Section } from '../../platform/design/Card.jsx';
import { KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat } from '../../platform/i18n/index.js';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { downloadReport } from './api.js';

const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const catalogueKey = ['bi', 'metrics'];
const requestKey = ['bi', 'metric-certifications'];
const freshnessLabels = { MISSING: 'Awaiting first capture', CURRENT: 'Captured this month', STALE: 'Awaiting current month' };

function Certification({ certified, session, code = 'project-count' }) {
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const cache = useQueryClient();
  const requests = useQuery({ queryKey: [...requestKey, code], queryFn: () => read(`/bi/metrics/certifications?code=${code}`), retry: false });
  const refresh = () => Promise.all([
    cache.invalidateQueries({ queryKey: catalogueKey }),
    cache.invalidateQueries({ queryKey: requestKey }),
    cache.invalidateQueries({ queryKey: ['bi', 'domain-metrics'] }),
  ]);
  const submit = useMutation({ mutationFn: () => write('/bi/metrics/certifications', { code, certify: !certified, reason }),
    onSuccess: () => { setReason(''); return refresh(); } });
  const decide = useMutation({ mutationFn: ({ id, action, version }) => write(`/bi/metrics/certifications/${id}/act`, { action, version, comment }),
    onSuccess: () => { setComment(''); return refresh(); } });
  const pending = requests.data?.find((request) => request.status === 'SUBMITTED');
  const reviewRole = pending?.chain[pending.currentStep - 1];
  const canDecide = pending && session?.user !== pending.requestedBy
    && reviewRole?.split('|').some((role) => session?.roles?.includes(role));
  return <Section title="Certification">
    {requests.isPending && <Skeleton label="Certification requests" />}
    {requests.error && <ErrorState error={requests.error} onRetry={requests.refetch} />}
    {requests.isSuccess && !pending && <form onSubmit={(event) => { event.preventDefault(); submit.mutate(); }}>
      <Field name="metric-reason" label="Reason">
        <textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      <button className="btn btn-primary" disabled={submit.isPending} type="submit">{certified ? 'Request revocation' : 'Request certification'}</button>
    </form>}
    {pending && <Card title={pending.title}>
      <p>{pending.reason}</p>
      <p>Awaiting review · {pending.requestedBy}</p>
      {canDecide && <>
        <Field name="metric-comment" label="Review comment">
          <textarea maxLength={500} value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
        <div className="actions-row">
          {['approve', 'reject', 'return'].map((action) => <button key={action} className="btn" type="button"
            disabled={decide.isPending || (action !== 'approve' && comment.trim().length < 5)}
            onClick={() => decide.mutate({ id: pending.id, action, version: pending.version })}>
            {action[0].toUpperCase() + action.slice(1)}
          </button>)}
        </div>
      </>}
    </Card>}
    {requests.data?.some((request) => request.status !== 'SUBMITTED') && <details>
      <summary>Decision history</summary>
      <ul>{requests.data.filter((request) => request.status !== 'SUBMITTED').map((request) =>
        <li key={request.id}>
          {request.title} · {request.status} · {request.requestedBy}
          {request.steps.map((step) => <p key={step.stepNo}>{step.decision} · {step.decidedBy}{step.comment ? ` · ${step.comment}` : ''}</p>)}
        </li>)}</ul>
    </details>}
    {(submit.error || decide.error) && <ErrorState error={submit.error ?? decide.error} />}
  </Section>;
}

function DomainMetrics({ session }) {
  const { dateTime, money, number } = useFormat();
  const [code, setCode] = useState('');
  const [search, setSearch] = useState('');
  const [projectId, setProjectId] = useState('');
  const [format, setFormat] = useState('csv');
  const base = ['bi', 'domain-metrics'];
  const list = useQuery({ queryKey: base, queryFn: () => read('/bi/metrics/domains'), retry: false });
  const params = new URLSearchParams(search ? { search } : {});
  const options = useQuery({ queryKey: [...base, code, 'projects', search],
    queryFn: () => read(`/bi/metrics/domains/${code}?${params}`), enabled: Boolean(code), retry: false });
  const observation = useQuery({ queryKey: [...base, code, projectId],
    queryFn: () => read(`/bi/metrics/domains/${code}?projectId=${projectId}`), enabled: Boolean(code && projectId), retry: false });
  const download = useMutation({ mutationFn: () => {
    const query = new URLSearchParams({ 'filter[projectId]': projectId, format });
    return downloadReport(`/api/v1/bi/metrics/domains/${code}/export?${query}`, `${code}-history.${format}`);
  } });
  const describe = (metric, value) => {
    if (value == null) return 'Unavailable';
    if (metric.unit === 'INR') return money(String(value));
    const formatted = number(String(value), { decimals: Math.log10(metric.scale) });
    return metric.lineage.aggregate ? `${formatted} ${metric.unit}` : metric.unit === '%' ? `${formatted}%` : formatted;
  };
  if (list.isPending) return <Skeleton label="Approved source metrics" />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.refetch} />;
  if (!list.data?.length) return null;
  const info = options.data;
  const data = observation.data;
  return <Section title="Project metrics">
    <Field name="domain-metric-code" label="Metric">
      <select value={code} onChange={(event) => { setCode(event.target.value); setSearch(''); setProjectId(''); download.reset(); }}>
        <option value="">Select a metric</option>
        {list.data.map((metric) => <option key={metric.code} value={metric.code}>{metric.name}</option>)}
      </select>
    </Field>
    {code && options.isPending && <Skeleton label="Metric projects" />}
    {options.error && <ErrorState error={options.error} onRetry={options.refetch} />}
    {info && <>
      <Card title={info.name} subtitle={info.definition}>
        <p><strong>{info.certified ? 'Certified' : 'Uncertified'}</strong></p>
        <details>
          <summary>Metric lineage</summary>
          <dl>
            <dt>Calculation</dt><dd>{info.formula}</dd>
            <dt>Owner</dt><dd>{info.owner}</dd>
            <dt>Refresh</dt><dd>Live on demand · Monthly observations</dd>
            <dt>Dataset</dt><dd>{info.lineage.dataset} · version {info.lineage.datasetVersion}</dd>
            <dt>Register</dt><dd>{info.lineage.source}</dd>
          </dl>
        </details>
      </Card>
      {info.canRead && <>
        <Field name="domain-project-search" label="Find a project">
          <input type="search" maxLength={80} value={search}
            onChange={(event) => { setSearch(event.target.value); setProjectId(''); download.reset(); }} />
        </Field>
        <Field name="domain-project-id" label="Metric project">
          <select value={projectId} onChange={(event) => { setProjectId(event.target.value); download.reset(); }}>
            <option value="">Select a project</option>
            {info.projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
          </select>
        </Field>
        {!info.projects.length && <EmptyState title="No projects match" />}
      </>}
      {projectId && observation.isPending && <Skeleton label="Metric observations" />}
      {observation.error && <ErrorState error={observation.error} onRetry={observation.refetch} />}
      {data && <>
        {data.live ? <Card title={data.lineage.aggregate ? 'Latest source value' : 'Latest approved value'} subtitle={data.live.sourcePeriod}>
          <p>{describe(data, data.live.value)}{!data.lineage.aggregate && ` · Source revision ${data.live.sourceVersion}`}</p>
          <Link to={data.live.sourceRoute}>{data.lineage.aggregate ? 'Open source report' : 'Open source record'}</Link>
        </Card> : <EmptyState title="No eligible source data" />}
        <Section title="Monthly observations">
          {data.canExport && data.periods.length > 0 && <div className="actions-row">
            <Field name="domain-export-format" label="Metric file format">
              <select value={format} onChange={(event) => setFormat(event.target.value)}>
                {['csv', 'xlsx', 'pdf'].map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}
              </select>
            </Field>
            <button type="button" className="btn" disabled={download.isPending} onClick={() => download.mutate()}>Export metric history</button>
          </div>}
          {download.error && <ErrorState error={download.error} />}
          {download.data === true && <p role="status">Export queued. <Link to="/account/exports">Open My Exports</Link></p>}
          {!data.periods.length && <EmptyState title="No monthly observations yet" />}
          <CardGrid>{data.periods.map((row) => <Card key={row.period} title={row.period} subtitle={dateTime(row.capturedAt)}>
            <p>{describe(data, row.value)} · Source period {row.sourcePeriod}{!data.lineage.aggregate && ` · Revision ${row.sourceVersion}`}</p>
            <Link to={row.sourceRoute}>{data.lineage.aggregate ? 'Open source report' : 'Open captured source'}</Link>
          </Card>)}</CardGrid>
        </Section>
      </>}
      {info.canCertify && <Certification key={code} code={code} certified={info.certified} session={session} />}
    </>}
  </Section>;
}

function DomainQuality() {
  const result = useQuery({ queryKey: ['bi', 'domain-quality'], queryFn: () => read('/bi/metrics/domain-quality'), retry: false });
  if (result.isPending) return <Skeleton label="Source capture quality" />;
  if (result.error) return <ErrorState error={result.error} onRetry={result.refetch} />;
  if (!result.data?.length) return null;
  const qualityLabel = { COMPLETE: 'Complete', INCOMPLETE: 'Missing values', MISMATCH: 'Stored row count differs', NO_DATA: 'No approved source records' };
  return <CardGrid>{result.data.map((item) => <Card key={item.code} title={item.name}>
    <p>{freshnessLabels[item.freshness]}</p>
    {item.completeness && <p>{qualityLabel[item.completeness]} · {item.rows} source rows · {item.missing} missing values</p>}
  </Card>)}</CardGrid>;
}

export function MetricCatalogue({ session }) {
  usePageTitle('Metric Catalogue');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const result = useQuery({ queryKey: catalogueKey, queryFn: () => read('/bi/metrics'), retry: false });
  const snapshot = useMutation({ mutationFn: () => write('/bi/metrics/snapshots', {}) });
  const [format, setFormat] = useState('csv');
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/bi/metrics/history/export?format=${format}`, `project-history.${format}`) });
  const data = result.data;
  const metric = data?.metric;
  const count = (value) => number(value, { decimals: 0 });
  return <section>
    <PageHeader title="Metric Catalogue" />
    {result.isPending && <Skeleton label="Metric catalogue" />}
    {result.error && <ErrorState error={result.error} onRetry={result.refetch} />}
    {data && <>
      {metric && (
      <Section title={metric.name} description={metric.definition}>
        <p><strong>{metric.certified ? 'Certified' : 'Uncertified'}</strong></p>
        {metric.evaluatedAt && <KpiTile label="Visible projects" value={count(metric.value)} unit="projects" to="/bi/reports" />}
        <details>
          <summary>Source lineage</summary>
          <dl>
            <dt>Dataset</dt><dd>{metric.lineage.dataset} · version {metric.lineage.datasetVersion}</dd>
            <dt>Source register</dt><dd>{metric.lineage.source}</dd>
            <dt>Grouping</dt><dd>{metric.lineage.groupedBy}</dd>
            <dt>Calculation</dt><dd>Count of visible project records</dd>
          </dl>
          {metric.evaluatedAt && <Link to="/bi/reports">Open source report</Link>}
        </details>
      </Section>
      )}
      {(data.freshness || data.canCapture) && <Section title="Data Freshness & Quality">
        {data.freshness && <p>{freshnessLabels[data.freshness]}</p>}
        {data.canCapture && <div className="actions-row">
          <button type="button" className="btn" disabled={snapshot.isPending} onClick={() => snapshot.mutate()}>Queue monthly capture</button>
          <button type="button" className="btn" disabled={result.isFetching} onClick={() => {
            result.refetch();
            cache.invalidateQueries({ queryKey: ['bi', 'domain-quality'] });
            cache.invalidateQueries({ queryKey: ['bi', 'domain-metrics'] });
          }}>Refresh status</button>
        </div>}
        {snapshot.isSuccess && <p role="status">Capture queued. <Link to="/admin/operations/jobs">Open jobs</Link></p>}
        {snapshot.error && <ErrorState error={snapshot.error} />}
        {data.canExport && data.periods.length > 0 && <div className="actions-row">
          <Field name="metric-export-format" label="File format">
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              {['csv', 'xlsx', 'pdf'].map((item) => <option value={item} key={item}>{item.toUpperCase()}</option>)}
            </select>
          </Field>
          <button type="button" className="btn" disabled={download.isPending} onClick={() => download.mutate()}>Export history</button>
        </div>}
        {download.error && <ErrorState error={download.error} />}
        {download.data === true && <p role="status">Export queued. <Link to="/account/exports">Open My Exports</Link></p>}
        {data.freshness && !data.periods.length && <EmptyState title="No monthly captures yet" />}
        <CardGrid>{data.periods.map(({ period, value, capturedAt, completeness }) =>
          <Card key={period} title={period} subtitle={dateTime(capturedAt)}>
            <p>{value !== undefined && `${count(value)} ${value === 1 ? 'project' : 'projects'} · `}{completeness === 'COMPLETE' ? 'Capture complete' : 'Capture incomplete'}</p>
          </Card>)}</CardGrid>
        {data.canCapture && <DomainQuality />}
      </Section>}
      {metric && data.canCertify && <Certification certified={metric.certified} session={session} />}
      <DomainMetrics session={session} />
    </>}
  </section>;
}
