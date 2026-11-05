import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { Field, Link, downloadCsv, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANGE_STATUS, CONTROLS, NATURE, TYPES, TYPE_LABEL, fin, parseLedgers } from './api.js';

// Chart of Accounts (Finance, part 06.05, FR-01, FR-02, FR-06): the group tree of the company (Assets, Liabilities, Equity, Income, Expenses and the groups under them, each with its Schedule III line) with its
// ledgers (type, normal side, control account, manual posting, blocked), search and filters; the Schedule III view that shows whether every group and account lands on a line (T-02); the import of a ledger list
// from Tally or another package with its mapping report (each ledger with the group it lands in, or why not); the export (CSV); and the changes waiting for approval. Every new or changed group or account is a
// change the CFO approves (maker-checker); nothing changes in the chart before that.
const TABS = [['tree', 'Chart'], ['schedule', 'Schedule III'], ['import', 'Import'], ['changes', 'Changes']];
const blankAccount = (groupId) => ({ code: '', name: '', groupId, type: 'EXPENSE', normalBalance: 'DR', isControl: false, controlKind: '', manualPosting: true, reason: '' });
export default function ChartOfAccountsPage() {
  usePageTitle('Chart of Accounts');
  const qc = useQueryClient();
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('tab') ?? (new URLSearchParams(window.location.search).get('change') ? 'changes' : 'tree'));
  const [f, setF] = useState({ q: '', status: '', type: '', control: '' });
  const q = useQuery({ queryKey: ['fin', 'chart', f], queryFn: () => fin.chart(f), retry: false });
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what="the chart of accounts" permission="fin.coa.view" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the chart of accounts" rows={6} />;
  const d = q.data;
  const groupsById = new Map(d.groups.map((g) => [g.id, g]));
  const done = (msg) => { setNote(msg); setForm(null); setError(null); qc.invalidateQueries({ queryKey: ['fin'] }); };
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    try {
      if (form.kind === 'account') { const g = groupsById.get(Number(form.groupId)); const out = await fin.createAccount({ code: form.code, name: form.name, groupId: Number(form.groupId), type: form.type, normalBalance: form.normalBalance, isControl: form.isControl, controlKind: form.isControl ? form.controlKind || null : null, manualPosting: form.manualPosting, ...(g && form.normalBalance !== ({ ASSET: 'DR', EXPENSE: 'DR' }[g.nature] ?? 'CR') ? { contraReason: form.reason } : {}), reason: form.reason }); done(`${out.what} was sent to the CFO for approval (change #${out.id}).`); }
      else { const p = groupsById.get(Number(form.parentId)); const out = await fin.createGroup({ code: form.code, name: form.name, parentId: Number(form.parentId), nature: p?.nature ?? 'ASSET', schedule3: form.schedule3 || null, reason: form.reason }); done(`${out.what} was sent to the CFO for approval (change #${out.id}).`); }
    } catch (err) { setError(errorInfo(err)); }
  };
  const exportCsv = async () => { try { downloadCsv('chart-of-accounts.csv', await fin.exportCsv()); } catch (err) { setError(errorInfo(err)); } };
  const filtered = Boolean(f.q || f.status || f.type || f.control);
  const accountsOf = (gid) => d.accounts.filter((a) => a.groupId === gid);
  const hasAccounts = (gid) => accountsOf(gid).length > 0 || d.groups.some((g) => g.parentId === gid && hasAccounts(g.id));
  const tree = (parent, depth) => d.groups.filter((g) => g.parentId === parent && (!filtered || hasAccounts(g.id))).map((g) => (
    <li key={g.id} data-testid="coa-group">
      <div className="coa-group" style={{ paddingInlineStart: `${depth}rem` }}><strong>{g.code} {g.name}</strong> {g.schedule3Label && <span className="muted small">· {g.schedule3Label}</span>}{!g.parentId && <span className="muted small"> · {NATURE[g.nature]}</span>}{g.pendingChangeId && <span className="small"> · change waiting</span>}</div>
      {accountsOf(g.id).length > 0 && <ul className="coa-accounts">{accountsOf(g.id).map((a) => (
        <li key={a.id} style={{ paddingInlineStart: `${depth + 1}rem` }} data-testid="coa-account"><Link to={`/finance/accounts/account?id=${a.id}`}>{a.code} {a.name}</Link> <span className="muted small">{TYPE_LABEL[a.type]} · {a.normalBalance}</span>
          {a.isControl && <span className="chip small" title="Takes postings from the posting engine only">Control: {a.controlLabel}{a.manualPosting ? ' (manual allowed)' : ''}</span>}{a.status === 'BLOCKED' && <StatusBadge status="SUSPENDED" label="Blocked" />}</li>))}</ul>}
      {d.groups.some((x) => x.parentId === g.id) && <ul className="coa-tree">{tree(g.id, depth + 1)}</ul>}
    </li>));
  return (
    <section aria-labelledby="coa-title" data-testid="chart-of-accounts" className="fin-page">
      <div className="page-head"><h1 id="coa-title">Chart of Accounts</h1>
        <div className="actions-row">{d.canEdit && <><button type="button" className="btn btn-primary btn-small" onClick={() => { setError(null); setForm({ kind: 'account', ...blankAccount(d.groups.find((g) => g.parentId)?.id ?? '') }); }} data-testid="coa-new-account">New account</button><button type="button" className="btn btn-small" onClick={() => { setError(null); setForm({ kind: 'group', code: '', name: '', parentId: d.groups.find((g) => !g.parentId)?.id, schedule3: '', reason: '' }); }} data-testid="coa-new-group">New group</button></>}<button type="button" className="btn btn-small" onClick={exportCsv} data-testid="coa-export">Export CSV</button></div></div>
      {d.missingControls.length > 0 && <p className="mdm-banner is-warning" role="alert" data-testid="coa-missing">Control accounts missing: {d.missingControls.map((m) => m.label).join(', ')}.</p>}
      {d.pending > 0 && <p className="mdm-banner" data-testid="coa-pending">{d.pending} change{d.pending === 1 ? '' : 's'} waiting for approval. <button type="button" className="btn btn-small" onClick={() => setTab('changes')}>See them</button></p>}
      {note && <p className="mdm-banner" role="status" data-testid="coa-note">{note}</p>}
      {error?.form && !form && <p className="field-error" role="alert">{error.form}</p>}
      <div className="seg" role="tablist" aria-label="View">{TABS.map(([k, l]) => (k !== 'import' || d.canImport) && <button key={k} type="button" role="tab" aria-selected={tab === k} className={`btn btn-small ${tab === k ? 'btn-primary' : ''}`} onClick={() => setTab(k)} data-testid={`coa-tab-${k}`}>{l}</button>)}</div>
      {form && (
        <form onSubmit={submit} aria-label={form.kind === 'account' ? 'New account' : 'New group'} className="fin-form" data-testid="coa-form">
          <h2>{form.kind === 'account' ? 'New account' : 'New group'}</h2>
          <div className="mdm-fields">
            <Field label="Code (required)" name="code" error={error}><input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} data-testid="coa-f-code" /></Field>
            <Field label="Name (required)" name="name" error={error}><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="coa-f-name" /></Field>
            {form.kind === 'account' ? <>
              <Field label="Group (required)" name="groupId" error={error}><select value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })} data-testid="coa-f-group">{d.groups.filter((g) => g.parentId).map((g) => <option key={g.id} value={g.id}>{g.code} {g.name} ({NATURE[g.nature]})</option>)}</select></Field>
              <Field label="Type" name="type" error={error}><select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} data-testid="coa-f-type">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <Field label="Normal side" name="normalBalance" error={error} hint="Debit for assets and expenses, credit for the others; a contra account says why in the reason"><select value={form.normalBalance} onChange={(e) => setForm({ ...form, normalBalance: e.target.value })}><option value="DR">Debit</option><option value="CR">Credit</option></select></Field>
              <Field label="Control account" name="controlKind" error={error}><select value={form.isControl ? form.controlKind : ''} onChange={(e) => setForm({ ...form, isControl: Boolean(e.target.value), controlKind: e.target.value, manualPosting: !e.target.value })}><option value="">No</option>{CONTROLS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
              <label className="check"><input type="checkbox" checked={form.manualPosting} onChange={(e) => setForm({ ...form, manualPosting: e.target.checked })} /> Manual journals may post to it{form.isControl ? ' (an exception for a control account)' : ''}</label>
            </> : <>
              <Field label="Under (required)" name="parentId" error={error}><select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} data-testid="coa-f-parent">{d.groups.map((g) => <option key={g.id} value={g.id}>{g.code} {g.name}</option>)}</select></Field>
              <Field label="Schedule III line" name="schedule3" error={error}><select value={form.schedule3} onChange={(e) => setForm({ ...form, schedule3: e.target.value })} data-testid="coa-f-s3"><option value="">Same as the parent</option>{d.schedule3.filter((s) => s.nature === groupsById.get(Number(form.parentId))?.nature).map((s) => <option key={s.code} value={s.code}>{s.section}: {s.label}</option>)}</select></Field>
            </>}
            <Field label="Reason (required)" name="reason" error={error}><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} data-testid="coa-f-reason" /></Field>
          </div>
          {error?.form && <p className="field-error" role="alert" data-testid="coa-error">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => setForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" data-testid="coa-f-save">Send for approval</button></div>
        </form>
      )}
      {tab === 'tree' && <>
        <div className="filters" role="search">
          <label>Search <input type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Code or name" data-testid="coa-q" /></label>
          <label>Type <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">All</option>{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Control <select value={f.control} onChange={(e) => setF({ ...f, control: e.target.value })} data-testid="coa-control"><option value="">All</option><option value="yes">Control accounts</option><option value="no">Others</option></select></label>
          <label>Status <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">All</option><option value="ACTIVE">Active</option><option value="BLOCKED">Blocked</option></select></label>
        </div>
        {d.accounts.length === 0 ? <EmptyState title="No account matches" message="Change the search or the filters." /> : <ul className="coa-tree" aria-label="Chart of accounts">{tree(null, 0)}</ul>}
      </>}
      {tab === 'schedule' && <ScheduleIII />}
      {tab === 'import' && d.canImport && <ImportPanel onDone={done} />}
      {tab === 'changes' && <ChangesPanel />}
    </section>
  );
}

function ScheduleIII() {
  const q = useQuery({ queryKey: ['fin', 'schedule3'], queryFn: fin.schedule3, retry: false });
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading Schedule III" rows={4} />;
  const s = q.data;
  return (
    <div data-testid="coa-s3">
      <p className={`mdm-banner ${s.complete ? '' : 'is-warning'}`} role="status" data-testid="coa-s3-status">{s.complete ? 'Every group and account lands on a line of Schedule III.' : `Incomplete: ${[s.unmappedGroups.length && `${s.unmappedGroups.length} group(s) without a line (${s.unmappedGroups.map((g) => g.code).join(', ')})`, s.unmappedAccounts.length && `${s.unmappedAccounts.length} account(s) without a line`, s.wrongNature.length && `${s.wrongNature.length} account(s) on a line of another nature`, s.linesWithoutGroup.length && `${s.linesWithoutGroup.length} line(s) with no group`].filter(Boolean).join('; ')}.`}</p>
      {['BS', 'PL'].map((st) => (
        <div key={st}><h2>{st === 'BS' ? 'Balance sheet' : 'Statement of profit and loss'}</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label={st === 'BS' ? 'Balance sheet lines' : 'Profit and loss lines'}><table className="grid"><thead><tr><th>Section</th><th>Line</th><th>Groups</th><th>Accounts</th></tr></thead>
            <tbody>{s.lines.filter((l) => l.statement === st).map((l) => <tr key={l.code} data-testid="coa-s3-line"><td data-label="Section">{l.section}</td><th scope="row" data-label="Line">{l.label}</th><td data-label="Groups">{l.groups.map((g) => `${g.code} ${g.name}`).join(', ') || <span className="muted">none</span>}</td><td data-label="Accounts">{l.accounts.length}</td></tr>)}</tbody></table></div>
        </div>))}
    </div>
  );
}

function ImportPanel({ onDone }) {
  const [text, setText] = useState('');
  const [format, setFormat] = useState('TALLY');
  const [rep, setRep] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const rows = parseLedgers(text);
  const preview = async () => { setError(null); try { setRep(await fin.importPreview({ format, rows })); } catch (err) { setError(errorInfo(err)); } };
  const send = async () => { setError(null); try { const out = await fin.importSubmit({ format, rows, reason }); onDone(`${out.change.what} was sent to the CFO for approval (change #${out.change.id}); ${out.report.unmapped} ledger(s) were left out.`); setRep(null); setText(''); } catch (err) { setError(errorInfo(err)); } };
  const file = async (e) => { const fl = e.target.files?.[0]; if (fl) setText(await fl.text()); };
  return (
    <div data-testid="coa-import">
      <p className="small">Export the <strong>List of Ledgers</strong> from Tally (or any package) as CSV with the ledger name and its group (“Under”), and an account code when you have one. The report shows where each ledger lands before anything is sent.</p>
      <div className="mdm-fields">
        <Field label="Source" name="format" error={error}><select value={format} onChange={(e) => setFormat(e.target.value)}><option value="TALLY">Tally</option><option value="GENERIC">Another package</option></select></Field>
        <Field label="File (CSV)" name="file" error={error}><input type="file" accept=".csv,text/csv,.txt" onChange={file} data-testid="coa-import-file" /></Field>
      </div>
      <Field label="Or paste the rows (name, group[, code])" name="rows" error={error}><textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setRep(null); }} data-testid="coa-import-text" /></Field>
      <div className="actions-row"><button type="button" className="btn" disabled={!rows.length} onClick={preview} data-testid="coa-import-preview">Show the mapping report ({rows.length} ledger{rows.length === 1 ? '' : 's'})</button></div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {rep && <>
        <p className="mdm-banner" role="status" data-testid="coa-import-summary">{rep.mapped} of {rep.total} ledgers map to this chart{rep.unmapped ? `; ${rep.unmapped} do not` : ''}{rep.unknownGroups.length ? ` (unknown groups: ${rep.unknownGroups.join(', ')})` : ''}.</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Mapping report"><table className="grid"><thead><tr><th>#</th><th>Ledger</th><th>Group in the file</th><th>Lands in</th><th>Type</th><th>Code</th><th>Result</th></tr></thead>
          <tbody>{rep.rows.map((r) => <tr key={r.row} className={r.ok ? '' : 'is-overdue'} data-testid="coa-import-row"><td data-label="#">{r.row}</td><th scope="row" data-label="Ledger">{r.name}</th><td data-label="Group in the file">{r.parent}</td><td data-label="Lands in">{r.group ?? '—'}{r.controlKind ? ` (control ${r.controlKind})` : ''}</td><td data-label="Type">{r.type ? TYPE_LABEL[r.type] : '—'}</td><td data-label="Code">{r.code}</td><td data-label="Result">{r.ok ? `Mapped (${r.mappedBy})` : r.problems.join('; ')}</td></tr>)}</tbody></table></div>
        {rep.mapped > 0 && <div className="mdm-fields"><Field label="Reason (required)" name="reason" error={error}><input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="coa-import-reason" /></Field>
          <div className="actions"><button type="button" className="btn btn-primary" onClick={send} data-testid="coa-import-send">Send {rep.mapped} account{rep.mapped === 1 ? '' : 's'} for approval</button></div></div>}
      </>}
    </div>
  );
}

function ChangesPanel() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['fin', 'changes', status], queryFn: () => fin.changes({ status: status || undefined }), retry: false });
  const [error, setError] = useState(null);
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the changes" rows={3} />;
  const doIt = async (fn) => { setError(null); try { await fn(); qc.invalidateQueries({ queryKey: ['fin'] }); } catch (err) { setError(errorInfo(err)); } };
  return (
    <div data-testid="coa-changes">
      <div className="filters"><label>Status <select value={status} onChange={(e) => setStatus(e.target.value)} data-testid="coa-changes-status"><option value="">All</option>{Object.entries(CHANGE_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></label></div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {q.data.rows.length === 0 ? <EmptyState title="No change" message="New and changed accounts, groups, cost codes and mappings appear here until the CFO decides them." /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Changes"><table className="grid"><thead><tr><th>#</th><th>What</th><th>By</th><th>Reason</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{q.data.rows.map((c) => <tr key={c.id} data-testid="coa-change"><td data-label="#">{c.id}</td><th scope="row" data-label="What">{c.what}</th><td data-label="By">{c.requestedBy} ({c.makerRole})<div className="muted small">{formatDateTime(c.createdAt)}</div></td><td data-label="Reason">{c.reason}</td><td data-label="Status"><StatusBadge status={CHANGE_STATUS[c.status][0]} label={CHANGE_STATUS[c.status][1]} />{c.decidedBy && <div className="muted small">{c.decidedBy}</div>}</td>
            <td>{c.mine ? <button type="button" className="btn btn-small btn-primary" onClick={() => navigateTo('/approvals')} data-testid="coa-decide">Decide</button> : c.own && c.status === 'RETURNED' ? <><button type="button" className="btn btn-small" onClick={() => doIt(() => fin.resubmit(c.id, 'Checked and sent again'))}>Send again</button> <button type="button" className="btn btn-small" onClick={() => doIt(() => fin.withdraw(c.id, 'Withdrawn by the maker'))}>Withdraw</button></> : c.own && c.status === 'PENDING' ? <button type="button" className="btn btn-small" onClick={() => doIt(() => fin.withdraw(c.id, 'Withdrawn by the maker'))} data-testid="coa-withdraw">Withdraw</button> : c.entity === 'ACCOUNT' && c.appliedId ? <Link to={`/finance/accounts/account?id=${c.appliedId}`}>Open</Link> : null}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}
