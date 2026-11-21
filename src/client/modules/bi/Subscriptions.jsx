import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardGrid, Section } from '../../platform/design/Card.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { EmptyState, ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat } from '../../platform/i18n/index.js';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { bi } from './api.js';
import { LifecycleFilter } from './Pages.jsx';

const frequencies = { DAILY: 'Daily', WEEKLY: 'Weekly on Monday', MONTHLY: 'Monthly on the first day' };
const channels = { IN_APP: 'In-app notification', EMAIL: 'Email', WHATSAPP: 'WhatsApp' };
const runStatuses = { QUEUED: 'Queued', READY: 'Ready', FAILED: 'Failed', SKIPPED: 'Skipped' };
const deliveryStatuses = { SENT: 'Sent', DELIVERED: 'Delivered', PENDING: 'Pending', DEFERRED: 'Deferred', SKIPPED: 'Skipped', FAILED: 'Failed', PREFERENCE_DISABLED: 'Disabled in notification preferences' };
const initial = { name: '', savedReportId: '', state: '', frequency: 'WEEKLY', format: 'csv', channel: 'IN_APP' };

export function ReportSubscriptions() {
  usePageTitle('Report Subscriptions');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const [form, setForm] = useState(initial);
  const update = (field, value) => setForm((previous) => ({ ...previous, [field]: value }));
  const key = ['bi', 'subscriptions'];
  const result = useQuery({ queryKey: key, queryFn: bi.subscriptions, retry: false });
  const refresh = () => cache.invalidateQueries({ queryKey: key });
  const subscribe = useMutation({ mutationFn: bi.saveSubscription, onSuccess: () => { setForm(initial); return refresh(); } });
  const change = useMutation({ mutationFn: bi.changeSubscription, onSuccess: refresh });
  const remove = useMutation({ mutationFn: bi.removeSubscription, onSuccess: refresh });
  const busy = subscribe.isPending || change.isPending || remove.isPending;
  const error = subscribe.error ?? change.error ?? remove.error;

  return <section>
    <PageHeader title="Report Subscriptions" />
    {result.isPending && <Skeleton label="Report subscriptions" />}
    {result.error && <ErrorState error={result.error} onRetry={result.refetch} />}
    {result.data && <>
      <Section title={form.id ? 'Edit subscription' : 'New subscription'}>
        <form onSubmit={(event) => {
          event.preventDefault();
          const { savedReportId, state, ...rest } = form;
          subscribe.mutate({ ...rest, ...(savedReportId ? { savedReportId: Number(savedReportId) } : state ? { state } : {}) });
        }}>
          <Field name="subscription-name" label="Subscription name">
            <input required maxLength={80} value={form.name} onChange={(event) => update('name', event.target.value)} />
          </Field>
          <Field name="subscription-report" label="Report">
            <select value={form.savedReportId} onChange={(event) => update('savedReportId', event.target.value)}>
              <option value="">Project Status</option>
              {result.data.savedReports.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
              {form.savedReportId && !result.data.savedReports.some(({ id }) => String(id) === form.savedReportId)
                && <option value={form.savedReportId} disabled>Unavailable saved report</option>}
            </select>
          </Field>
          {!form.savedReportId && <LifecycleFilter state={form.state} onChange={(value) => update('state', value)} />}
          <Field name="subscription-frequency" label="Frequency" hint="Runs at 08:00 IST.">
            <select value={form.frequency} onChange={(event) => update('frequency', event.target.value)}>
              {Object.entries(frequencies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field name="subscription-format" label="File format">
            <select value={form.format} onChange={(event) => update('format', event.target.value)}>
              {['csv', 'xlsx', 'pdf'].map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field name="subscription-channel" label="Notify me by" hint="Delivery follows your notification preferences. Files are available in My Exports.">
            <select value={form.channel} onChange={(event) => update('channel', event.target.value)}>
              {Object.entries(channels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <div className="actions-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>{form.id ? 'Save subscription' : 'Create subscription'}</button>
            {form.id && <button type="button" className="btn" disabled={busy} onClick={() => { setForm(initial); subscribe.reset(); }}>Cancel edit</button>}
          </div>
        </form>
        {subscribe.isSuccess && <p role="status">Subscription saved.</p>}
        {error && <ErrorState error={error} />}
      </Section>
      <Section title="My subscriptions">
        {!result.data.subscriptions.length && <EmptyState title="No subscriptions" />}
        <CardGrid>
          {result.data.subscriptions.map((item) => <Card key={item.id} title={item.name}>
            <p>{frequencies[item.frequency]} · {item.format.toUpperCase()} · {channels[item.channel]}</p>
            <p>{item.nextRunAt ? `Next run ${dateTime(item.nextRunAt)}` : 'Paused'}</p>
            <div className="actions-row">
              <button type="button" className="btn" disabled={busy} onClick={() => {
                const { id, version, name, savedReportId, state, frequency, format, channel } = item;
                subscribe.reset();
                setForm({ id, version, name, savedReportId: savedReportId ? String(savedReportId) : '', state: state ?? '', frequency, format, channel });
              }}>Edit</button>
              <button type="button" className="btn" disabled={busy || form.id === item.id} onClick={() => change.mutate({ ...item, status: item.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}>
                {item.status === 'ACTIVE' ? 'Pause' : 'Resume'}
              </button>
              <button type="button" className="btn" disabled={busy || form.id === item.id} onClick={() => {
                if (window.confirm(`Remove ${item.name}?`)) remove.mutate(item);
              }}>Remove</button>
            </div>
          </Card>)}
        </CardGrid>
      </Section>
      <Section title="Run and delivery history">
        {result.data.usage.length > 0 && <p>Last 30 days · {result.data.usage.map(({ status, total }) => `${runStatuses[status]} ${number(total, { decimals: 0 })}`).join(' · ')}</p>}
        {!result.data.runs.length && <EmptyState title="No runs yet" />}
        <CardGrid>
          {result.data.runs.map((item) => <Card key={item.id} title={item.name} subtitle={dateTime(item.scheduledAt)}>
            <p>{runStatuses[item.status]}</p>
            {item.detail && <p>{item.detail}</p>}
            {item.deliveryStatus && <p>Notification · {deliveryStatuses[item.deliveryStatus] ?? item.deliveryStatus}</p>}
            {item.status === 'READY' && <Link to="/account/exports">Open My Exports</Link>}
          </Card>)}
        </CardGrid>
      </Section>
    </>}
  </section>;
}

export function ReportUsage() {
  usePageTitle('Report Usage');
  const [days, setDays] = useState('30');
  const { number } = useFormat();
  const result = useQuery({ queryKey: ['bi', 'usage', days], queryFn: () => bi.usage(days), retry: false });
  return <section>
    <PageHeader title="Report Usage" />
    <Field name="report-usage-period" label="Period">
      <select value={days} onChange={(event) => setDays(event.target.value)}>
        {['7', '30', '90'].map((value) => <option key={value} value={value}>Last {value} days</option>)}
      </select>
    </Field>
    {result.isPending && <Skeleton label="Report usage" />}
    {result.error && <ErrorState error={result.error} onRetry={result.refetch} />}
    {result.data && <>
      <Section title="Completed exports">
        {result.data.exports.length ? <ul>{result.data.exports.map(({ report, format, total }) => (
          <li key={`${report}:${format}`}>{report === 'bi.project_status' ? 'Project Status' : 'Project Status Builder'} · {format.toUpperCase()} · {number(total, { decimals: 0 })}</li>
        ))}</ul> : <EmptyState title="No exports in this period" />}
      </Section>
      <Section title="Scheduled runs">
        {result.data.scheduledRuns.length ? <ul>{result.data.scheduledRuns.map(({ status, total }) => (
          <li key={status}>{runStatuses[status]} · {number(total, { decimals: 0 })}</li>
        ))}</ul> : <EmptyState title="No scheduled runs in this period" />}
      </Section>
    </>}
  </section>;
}
