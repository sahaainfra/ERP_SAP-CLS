import { usePageTitle, navigateTo } from '../core/pages/ui.jsx';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { OPERATOR_LABELS } from '../../platform/list/state.js';

// The List Report's documentation (part 03.03, section 7): how a register uses the component and the server contract, with the live
// description of the reference register's columns. The working example is Sample Material Requests.

const PROPS = [
  ['listCode', 'string', 'The list as the server declares it (defineList), for example ui.sample_requests. Saved views and column choices are kept per list.'],
  ['endpoint', 'string', 'The register\'s list address, for example /ui/sample-requests. Exports call endpoint + /export.'],
  ['title', 'string', 'Plural noun used in counts, empty states and the export file.'],
  ['permission', 'string', 'Named in the no-permission state.'],
  ['session', 'object', 'The shell\'s session: permissions decide which bulk actions, "New" and view sharing are offered.'],
  ['rowHref(row)', 'function', 'The record\'s address; the first cell is a link, so middle-click and Ctrl+click open it in a new tab.'],
  ['onOpen(row)', 'function', 'Opens the record in place (row click).'],
  ['cardFields', 'string[]', 'Columns shown on a phone (below 768 px the table becomes cards).'],
  ['statusKey', 'string', 'An enum column whose values become quick-filter chips.'],
  ['mineFilter', '{ key }', 'Adds "My records": key equals the signed-in person.'],
  ['dateKey', 'string', 'A date column for the presets: today, this month, last month, this quarter, this FY, last FY.'],
  ['bulkActions', '[{ id, label, permission, confirm, run(ids) }]', 'Shown when rows are selected and the person holds the permission; run returns { results: [{ id, label, ok, message }] }, summarised after.'],
  ['rowActions(row)', 'function', 'The row\'s actions menu: [{ label, onSelect, disabled }].'],
  ['newAction', '{ label, onClick, permission }', 'The "New" button.'],
  ['empty', '{ title, text }', 'What an empty register says, with "New" as the call to action.'],
];

const CONTRACT = [
  ['GET <endpoint>?q=&sort=-a,b&page=&pageSize=', 'pageSize 25, 50, 100 or 200; sort by any sortable column, several, "-" for descending'],
  ['filter[key]=v  or  filter[key][op]=v', `operators: ${Object.entries(OPERATOR_LABELS).map(([k, l]) => `${k} (${l})`).join(', ')}`],
  ['{ data, meta: { page, pageSize, total, totalPages, totals } }', 'totals of the numeric columns over the whole filtered set (masked values stay masked)'],
  ['GET /ui/lists/<code>', 'columns, types, operators; columns masked for the person cannot be sorted or filtered'],
  ['GET <endpoint>/export?format=xlsx|csv|pdf&<same query>', 'the screen\'s own query and masks; above core.export.max_rows a 202 and a background job (My Exports)'],
  ['GET|POST|PATCH|DELETE /ui/saved-views', 'personal views, or shared with roles and projects (ui.view.share); one default per person and list'],
  ['PATCH /ui/preferences { tableSettings: { <code>: { pageSize, columns, hidden, widths } } }', 'the person\'s column choices (the component saves them)'],
];

export default function ListReportDocsPage() {
  usePageTitle('List Report');
  const d = useQuery({ queryKey: ['ui', 'list', 'ui.sample_requests'], queryFn: async () => (await api.get('/ui/lists/ui.sample_requests')).data, retry: false });
  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Design System &rsaquo; List Report</nav>
      <div className="page-head"><h1 id="page-title">List Report</h1><span className="spacer" /><button type="button" className="btn btn-primary" onClick={() => navigateTo('/admin/sample-requests')}>Open the reference register</button></div>
      <p className="muted">One component for every register: the server searches, filters, sorts, pages and totals (nothing is filtered in the browser); the component adds the filter bar, saved views, the column chooser, bulk actions, exports and a card layout on phones. Sample Material Requests uses it.</p>
      <h2>Using it in a page</h2>
      <pre className="doc-code"><code>{`import ListReport from '../../platform/list/ListReport.jsx';

<ListReport listCode="ui.sample_requests" endpoint="/ui/sample-requests" title="Requests"
  permission="core.sample.use" session={session}
  rowHref={(r) => \`/admin/sample-requests?open=\${r.id}\`} onOpen={(r) => open(r.id)}
  statusKey="status" mineFilter={{ key: 'requestedBy' }} dateKey="docDate"
  bulkActions={[{ id: 'submit', label: 'Submit selected', permission: 'core.sample.use', run: (ids) => bulk('submit', ids) }]} />`}</code></pre>
      <div className="table-wrap">
        <table>
          <caption>Properties</caption>
          <thead><tr><th scope="col">Property</th><th scope="col">Type</th><th scope="col">What it does</th></tr></thead>
          <tbody>{PROPS.map(([p, t, w]) => <tr key={p}><td data-label="Property"><code>{p}</code></td><td data-label="Type"><code>{t}</code></td><td data-label="What it does">{w}</td></tr>)}</tbody>
        </table>
      </div>
      <h2>On the server</h2>
      <pre className="doc-code"><code>{`import { defineList, parseListRequest, runList } from '../../platform/list/index.js';

export const myList = defineList({ code: 'mod.things', label: 'Things', permission: 'mod.thing.view',
  from: 'mod_things t', where: 't.deleted_at IS NULL', searchable: ['t.name'], defaultSort: '-createdAt',
  columns: { name: { sql: 't.name', type: 'text', label: 'Name' }, amount: moneyColumn('t.amount', 'Amount', { total: true }) } });

list(actor, query) {
  const req = parseListRequest(myList, query);
  return runList(db, myList, req, { select: 't.*', scopeSql: authz.scopeFilter(actor, 'mod.thing.view', { project: 't.project_id' }).sql, params: {}, map: present });
}`}</code></pre>
      <div className="table-wrap">
        <table>
          <caption>Contract</caption>
          <thead><tr><th scope="col">Request or answer</th><th scope="col">Rules</th></tr></thead>
          <tbody>{CONTRACT.map(([r, w]) => <tr key={r}><td data-label="Request or answer"><code>{r}</code></td><td data-label="Rules">{w}</td></tr>)}</tbody>
        </table>
      </div>
      <h2>The reference register's columns (live)</h2>
      {d.data ? (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">Columns of ui.sample_requests</caption>
            <thead><tr><th scope="col">Key</th><th scope="col">Label</th><th scope="col">Type</th><th scope="col">Sort</th><th scope="col">Operators</th><th scope="col">Total</th></tr></thead>
            <tbody>{d.data.columns.map((c) => <tr key={c.key}><td data-label="Key"><code>{c.key}</code></td><td data-label="Label">{c.label}{c.masked ? ' (masked for you)' : ''}</td><td data-label="Type">{c.type}</td><td data-label="Sort">{c.sortable ? 'Yes' : 'No'}</td><td data-label="Operators">{c.operators.join(', ') || '-'}</td><td data-label="Total">{c.total ? 'Yes' : ''}</td></tr>)}</tbody>
          </table>
        </div>
      ) : <p className="muted">{d.isError ? `The column description could not be loaded: ${d.error.message}` : 'Loading the columns...'}</p>}
    </section>
  );
}
