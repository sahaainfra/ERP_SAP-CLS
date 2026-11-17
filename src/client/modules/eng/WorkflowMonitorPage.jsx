import { useMemo, useState } from 'react';
import Chart from '../../platform/charts/Chart.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { formatDateTime } from '../../platform/format.js';
import { monitorUrl, useDefinitionOptions, useMonitor } from '../../platform/workflow/api.js';
import { Link, usePageTitle } from '../core/pages/ui.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Workflow Monitor (part 04.01, section 7.4): the documents running through the workflows by type, the ones that are stuck or overdue and how long an
// approval takes. Every figure leads to the instances behind it; the table can be exported.
export default function WorkflowMonitorPage() {
  usePageTitle('Workflow Monitor');
  const [filters, setFilters] = useState({ docType: '', from: '', to: '' });
  const [notice, setNotice] = useState('');
  const monitor = useMonitor(filters);
  const options = useDefinitionOptions();
  const data = monitor.data;
  const chart = useMemo(() => data && ({
    categories: data.byType.map((r) => r.label),
    series: [['running', 'Running'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['returned', 'Returned'], ['cancelled', 'Cancelled or withdrawn']].map(([k, name]) => ({ name, values: data.byType.map((r) => r[k]) })),
    unit: 'documents',
  }), [data]);
  const download = async (format) => {
    const res = await fetch(monitorUrl(format, filters), { headers: { ...authHeaders(), 'x-correlation-id': globalThis.crypto.randomUUID() } });
    if (!res.ok) { setNotice('The export could not be prepared.'); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement('a'), { href: url, download: `workflow-monitor.${format}` }).click();
    URL.revokeObjectURL(url);
    setNotice('');
  };
  if (monitor.error?.status === 403) return <NoPermission what="the workflow monitor" permission="eng.workflow.view" />;
  const t = data?.totals;
  return (
    <section aria-labelledby="wm-title" data-testid="workflow-monitor">
      <PageHeader id="wm-title" title={"Workflow Monitor"} subtitle={"Documents in approval, by type; the ones that are stuck (no approver could be found) or overdue; and the average time an approval takes."} />
      {notice && <p role="status" className="notice">{notice}</p>}
      <form className="srch-form" role="search" aria-label="Report parameters" onSubmit={(e) => e.preventDefault()}>
        <label className="field"><span>Document type</span><select value={filters.docType} onChange={(e) => setFilters({ ...filters, docType: e.target.value })}><option value="">All document types</option>{(options.data?.docTypes ?? []).map((d) => <option key={d.docType} value={d.docType}>{d.label}</option>)}</select></label>
        <label className="field"><span>Submitted from</span><input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
        <label className="field"><span>Submitted to</span><input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
      </form>
      {monitor.isPending && <Skeleton label="Loading the monitor" rows={4} />}
      {monitor.isError && monitor.error?.status !== 403 && <ErrorState title="The monitor could not be loaded" error={monitor.error} onRetry={() => monitor.refetch()} />}
      {data && (
        <>
          <ul className="srch-meta" aria-label="Totals" data-testid="wm-totals">
            <li><strong data-testid="wm-running">{t.running}</strong> running</li><li><strong data-testid="wm-stuck">{t.stuck}</strong> waiting for an administrator</li><li><strong data-testid="wm-overdue">{t.overdue}</strong> overdue</li>
            <li><strong>{t.approved}</strong> approved</li><li><strong>{t.rejected}</strong> rejected</li><li><strong>{t.returned}</strong> returned</li><li><strong>{t.cancelled}</strong> cancelled or withdrawn</li>
            <li><strong>{t.avgCycleHours == null ? 'no figure yet' : `${t.avgCycleHours} h`}</strong> average time to approve</li>
          </ul>
          {data.byType.length === 0 ? <EmptyState title="Nothing has been submitted yet" message="Documents appear here as soon as one is submitted into approval." /> : (
            <>
              <div className="wd-body" style={{ maxWidth: '44rem' }}><Chart type="stacked" data={chart} title="Documents by type and outcome" exportName="workflow-monitor" /></div>
              <div className="srch-tools">
                <button type="button" className="btn" onClick={() => download('xlsx')}><Icon name="erp.action.export" size={16} /> Export XLSX</button>
                <button type="button" className="btn" onClick={() => download('csv')}><Icon name="erp.action.export" size={16} /> Export CSV</button>
              </div>
              <div className="table-wrap" tabIndex={0} role="region" aria-label="By document type">
                <table className="grid">
                  <thead><tr><th>Document type</th><th className="num">Running</th><th className="num">Waiting for an administrator</th><th className="num">Overdue</th><th className="num">Approved</th><th className="num">Rejected</th><th className="num">Returned</th><th className="num">Average hours to approve</th></tr></thead>
                  <tbody>
                    {data.byType.map((r) => (
                      <tr key={r.docType}>
                        <th scope="row" data-label="Document type"><Link to={`/admin/workflows?docType=${r.docType}`}>{r.label}</Link></th>
                        <td className="num" data-label="Running">{r.running}</td><td className="num" data-label="Waiting for an administrator">{r.stuck}</td><td className="num" data-label="Overdue">{r.overdue}</td>
                        <td className="num" data-label="Approved">{r.approved}</td><td className="num" data-label="Rejected">{r.rejected}</td><td className="num" data-label="Returned">{r.returned}</td><td className="num" data-label="Average hours to approve">{r.avgCycleHours ?? 'no figure'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th scope="row">Total</th><td className="num">{t.running}</td><td className="num">{t.stuck}</td><td className="num">{t.overdue}</td><td className="num">{t.approved}</td><td className="num">{t.rejected}</td><td className="num">{t.returned}</td><td className="num">{t.avgCycleHours ?? ''}</td></tr></tfoot>
                </table>
              </div>
            </>
          )}
          <h2>Needing attention</h2>
          {data.attention.length === 0 ? <p className="muted" data-testid="wm-clear">Nothing is stuck or overdue.</p> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Stuck and overdue documents">
              <table className="grid">
                <thead><tr><th>Document</th><th>Raised by</th><th>At step</th><th>Why</th><th>Due</th></tr></thead>
                <tbody>
                  {data.attention.map((a) => (
                    <tr key={a.id} data-testid={`wm-attention-${a.id}`}>
                      <th scope="row" data-label="Document"><Link to={`/workflow/instance?id=${a.id}`}>{a.docRef ?? a.title ?? a.id}</Link></th>
                      <td data-label="Raised by">{a.submittedBy}</td><td data-label="At step">{a.currentStep}</td><td data-label="Why">{a.reason}</td><td data-label="Due">{a.dueAt ? formatDateTime(a.dueAt) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Scheduling this report by e-mail comes with the report service (part 04.x); until then it is exported from this page.</p>
        </>
      )}
    </section>
  );
}
