import { useRef, useState } from 'react';
import {
  useActOnRequest, useChangeRequests, useCloseFinancialYear, useCreateFinancialYear, useFinancialYear, useFinancialYears,
  useRequestReopen, useSetPeriodStatus,
} from '../api/index.js';
import { formatDate } from '../../../platform/format.js';
import { Field, FormDialog, QueryState, can, errorInfo, usePageTitle } from './ui.jsx';

const MODULES = ['finance', 'payroll', 'procurement', 'inventory', 'plant', 'projects'];
const STATUSES = ['Open', 'Soft-closed', 'Closed'];

function RequestsPanel({ session }) {
  const pending = useChangeRequests({ status: 'SUBMITTED' });
  const act = useActOnRequest();
  const [message, setMessage] = useState('');
  if (!pending.data) return null;
  const rows = pending.data.data.filter((r) => r.type === 'period_reopen');
  if (rows.length === 0) return null;
  const decide = async (r, decision) => {
    setMessage('');
    try {
      await act.mutateAsync({ id: r.id, action: decision, comment: decision === 'reject' ? 'Not approved' : 'Approved', version: r.version });
      setMessage(`Request ${r.id} ${decision === 'approve' ? 'approved' : 'rejected'}.`);
    } catch (err) {
      setMessage(errorInfo(err).form);
    }
  };
  return (
    <section aria-labelledby="reopen-title" className="card">
      <h2 id="reopen-title">Reopen requests waiting for a decision</h2>
      <ul className="plain">
        {rows.map((r) => {
          const step = r.chain[r.currentStep - 1];
          const mine = step && [session?.roles ?? []].flat().join(',').split(',').includes(step);
          return (
            <li key={r.id} data-testid={`reopen-${r.id}`}>
              <strong>{r.title}</strong> - {r.reason}
              <div className="muted small">Requested by {r.requestedBy}; waiting for {step ?? 'nobody'} (step {r.currentStep} of {r.chain.length})</div>
              {mine && (
                <div className="actions">
                  <button type="button" className="btn btn-primary" onClick={() => decide(r, 'approve')} disabled={act.isPending}>Approve</button>
                  <button type="button" className="btn" onClick={() => decide(r, 'reject')} disabled={act.isPending}>Reject</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p role="status" className="notice">{message}</p>
    </section>
  );
}

export default function FinancialYearsPage({ session }) {
  usePageTitle('Financial Years & Periods');
  const list = useFinancialYears();
  const [selected, setSelected] = useState(null);
  const years = list.data?.data ?? [];
  const current = selected ?? years[0]?.id ?? null;
  const detail = useFinancialYear(current);
  const create = useCreateFinancialYear();
  const setStatus = useSetPeriodStatus();
  const closeFy = useCloseFinancialYear();
  const reopen = useRequestReopen();
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState(null);
  const createDialog = useRef(null);
  const statusDialog = useRef(null);
  const closeDialog = useRef(null);
  const reopenDialog = useRef(null);
  const canManage = can(session, 'core.period.manage');
  const canConfigure = can(session, 'core.fy.configure');
  const canReopen = can(session, 'core.period.request_reopen');

  const run = async (fn, dialog, done) => {
    setError(null);
    try {
      await fn();
      dialog.current?.close();
      setNotice(done);
    } catch (err) {
      setError(errorInfo(err));
    }
  };

  const open = (dialog, t = null) => {
    setTarget(t);
    setError(null);
    dialog.current?.showModal();
  };

  const fy = detail.data;
  const fyClosed = fy?.status === 'Closed';

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Configuration &rsaquo; Financial Years &amp; Periods</nav>
      <div className="page-head">
        <h1 id="page-title">Financial Years &amp; Periods</h1>
        <button type="button" className="btn btn-primary" disabled={!canConfigure} title={canConfigure ? '' : 'Needs core.fy.configure'} onClick={() => open(createDialog)}>Create financial year</button>
      </div>
      <p className="muted">Each month has a status per module: Open, Soft-closed (only privileged users may post) or Closed. A closed period can only be reopened through an approved request.</p>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={list} what="financial years" permission="core.fy.view" />

      {list.data && years.length === 0 && (
        <div className="state"><h2>No financial year yet</h2><p>Create the first one to start posting. Twelve monthly periods are created for you, all Open.</p></div>
      )}

      {years.length > 0 && (
        <>
          <div className="toolbar">
            <label className="field field-inline">
              <span>Financial year</span>
              <select value={current ?? ''} onChange={(e) => setSelected(Number(e.target.value))} data-testid="fy-select">
                {years.map((y) => <option key={y.id} value={y.id}>{y.code} ({y.status})</option>)}
              </select>
            </label>
            {fy && <span className="muted">{formatDate(fy.startDate)} to {formatDate(fy.endDate)}</span>}
            <button type="button" className="btn" disabled={!canManage || !fy || fyClosed} onClick={() => open(closeDialog)}>Close financial year</button>
          </div>
          {fy && (
            <div className="table-wrap">
              <table>
                <caption className="sr-only">Periods of {fy.code} and their status per module</caption>
                <thead><tr><th>Period</th>{MODULES.map((m) => <th key={m}>{m}</th>)}</tr></thead>
                <tbody>
                  {fy.periods.map((p) => (
                    <tr key={p.id} data-testid={`period-${p.periodNo}`}>
                      <td data-label="Period">{p.name}</td>
                      {MODULES.map((m) => {
                        const status = p.statuses[m];
                        return (
                          <td key={m} data-label={m}>
                            <span className={`chip chip-status-${status.toLowerCase()}`}>{status}</span>
                            {canManage && !fyClosed && status !== 'Closed' && (
                              <button type="button" className="link" aria-label={`Change ${m} status for ${p.name}`} onClick={() => open(statusDialog, { period: p, module: m, status })}>Change</button>
                            )}
                            {canReopen && status === 'Closed' && (
                              <button type="button" className="link" aria-label={`Request reopening of ${m} for ${p.name}`} onClick={() => open(reopenDialog, { period: p, module: m, status })}>Request reopen</button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <RequestsPanel session={session} />

      <FormDialog dialogRef={createDialog} title="Create financial year" error={error} busy={create.isPending} submitLabel="Create"
        onSubmit={(f) => run(() => create.mutateAsync({ startDate: String(f.get('startDate')), reason: String(f.get('reason')) }), createDialog, 'Financial year created with twelve open periods.')}>
        <Field label="Start date" name="startDate" error={error} hint="Normally 1 April. The year runs twelve months."><input name="startDate" type="date" required /></Field>
      </FormDialog>

      <FormDialog dialogRef={statusDialog} title={target ? `${target.module}: ${target.period.name}` : ''} error={error} busy={setStatus.isPending} submitLabel="Change status"
        onSubmit={(f) => run(() => setStatus.mutateAsync({ id: target.period.id, module: target.module, status: String(f.get('status')), reason: String(f.get('reason')), version: target.period.version }), statusDialog, 'Period status changed.')}>
        <Field label="New status" name="status" error={error}>
          <select name="status" defaultValue={target?.status}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </Field>
      </FormDialog>

      <FormDialog dialogRef={closeDialog} title={fy ? `Close ${fy.code}` : ''} error={error} busy={closeFy.isPending} submitLabel="Close year"
        onSubmit={(f) => run(() => closeFy.mutateAsync({ id: fy.id, reason: String(f.get('reason')), version: fy.version }), closeDialog, 'Financial year closed.')}>
        <p>Every module must be Closed in all twelve periods first. A closed year can only be reopened through an approved request.</p>
      </FormDialog>

      <FormDialog dialogRef={reopenDialog} title={target ? `Reopen ${target.module} for ${target.period.name}` : ''} error={error} busy={reopen.isPending} submitLabel="Send request"
        onSubmit={(f) => run(() => reopen.mutateAsync({ periodId: target.period.id, module: target.module, targetStatus: String(f.get('targetStatus')), reason: String(f.get('reason')) }), reopenDialog, 'Reopen request sent for approval by the Accounts Manager, then the CFO.')}>
        <Field label="Reopen to" name="targetStatus" error={error}>
          <select name="targetStatus" defaultValue="Soft-closed"><option>Soft-closed</option><option>Open</option></select>
        </Field>
      </FormDialog>
    </section>
  );
}
