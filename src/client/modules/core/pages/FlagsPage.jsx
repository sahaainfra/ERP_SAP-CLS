import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../../platform/api/index.js';
import { fetchAllFlags, useFeatureFlag, useFlagList, useSetFlag } from '../api/index.js';
import { formatDateTime, levelLabel, toCsv } from '../../../platform/format.js';

const ENVIRONMENTS = ['development', 'test', 'staging', 'production'];

function scopeText(row) {
  if (row.level === 'project') return `Company ${row.companyId} / Project ${row.projectId}`;
  if (row.level === 'company') return `Company ${row.companyId}`;
  if (row.level === 'environment') return row.environment;
  return 'All environments';
}

function ErrorBox({ error, onRetry }) {
  return (
    <div className="state state-error" role="alert">
      <h2>Could not load the feature flags</h2>
      <p>{error.message}</p>
      {error.correlationId && <p className="muted">Correlation ID: <code>{error.correlationId}</code></p>}
      <button type="button" className="btn" onClick={onRetry}>Try again</button>
    </div>
  );
}

function ReasonDialog({ dialogRef, title, children, onSubmit, error, busy, submitLabel }) {
  const titleId = useId();
  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby={titleId}>
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        <label className="field">
          <span>Reason (required, min 5 characters)</span>
          <textarea name="reason" rows="3" required minLength={5} maxLength={500} aria-invalid={Boolean(error?.reason)} />
          {error?.reason && <span className="field-error">{error.reason}</span>}
        </label>
        {error?.form && (
          <p className="field-error" role="alert">
            {error.form}
            {error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

function dialogError(err) {
  if (!(err instanceof ApiError)) return { form: 'Something went wrong. Try again.' };
  const fieldMsg = (name) => err.details.find((d) => d.field === name)?.message;
  return {
    reason: fieldMsg('reason'),
    form: err.details.length && fieldMsg('reason') && err.details.length === 1 ? null : err.message,
    correlationId: err.correlationId,
  };
}

export default function FlagsPage({ session }) {
  const canConfigure = session?.permissions?.includes('core.flag.configure');
  const pageFlag = useFeatureFlag('ff.prog.p0002');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const query = useFlagList({ page, q });
  const setFlag = useSetFlag();
  const [target, setTarget] = useState(null);
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState('');
  const toggleDialog = useRef(null);
  const addDialog = useRef(null);

  // The shape the template below renders: loading, forbidden, error or ready.
  const state = query.isError
    ? { status: query.error.status === 403 ? 'forbidden' : 'error', rows: [], meta: null, error: query.error }
    : query.data
      ? { status: 'ready', rows: query.data.data, meta: query.data.meta, error: null }
      : { status: 'loading', rows: [], meta: null, error: null };
  const load = () => query.refetch();
  const saving = setFlag.isPending;

  useEffect(() => {
    document.title = 'Feature Flags - Administration - ERP';
  }, []);

  const save = async (key, scope, enabled, form, version, dialog) => {
    setFormError(null);
    try {
      await setFlag.mutateAsync({ key, scope, enabled, reason: String(form.get('reason') ?? ''), version });
      dialog.current?.close();
      setNotice(`Saved. ${key} is now ${enabled ? 'ON' : 'OFF'} for ${scopeText({ ...scope })}.`);
    } catch (err) {
      setFormError(dialogError(err));
    }
  };

  const openToggle = (row) => {
    setTarget(row);
    setFormError(null);
    toggleDialog.current?.showModal();
  };

  const submitToggle = (form) => {
    const row = target;
    const scope = { level: row.level, environment: row.environment ?? undefined, companyId: row.companyId ?? undefined, projectId: row.projectId ?? undefined };
    return save(row.key, scope, !row.enabled, form, row.version, toggleDialog);
  };

  const submitAdd = (form) => {
    const level = String(form.get('level'));
    const scope = { level };
    if (level === 'environment') scope.environment = String(form.get('environment'));
    if (level === 'company' || level === 'project') scope.companyId = Number(form.get('companyId'));
    if (level === 'project') scope.projectId = Number(form.get('projectId'));
    return save(String(form.get('key')), scope, form.get('enabled') === 'on', form, undefined, addDialog);
  };

  const exportCsv = async () => {
    const all = await fetchAllFlags(q);
    const csv = toCsv(
      ['Key', 'Level', 'Scope', 'Value', 'Default', 'Changed by', 'Changed at (IST)', 'Version', 'Last reason'],
      all.map((r) => [r.key, levelLabel[r.level], scopeText(r), r.enabled ? 'ON' : 'OFF', r.defaultEnabled ? 'ON' : 'OFF', r.changedBy, formatDateTime(r.changedAt), r.version, r.remarks]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'feature-flags.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  const keys = [...new Set(state.rows.map((r) => r.key))];

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; System &rsaquo; Feature Flags</nav>
      <div className="page-head">
        <h1 id="page-title">Feature Flags</h1>
        <span className={`chip ${pageFlag ? 'chip-on' : 'chip-off'}`} data-testid="page-flag-chip">
          ff.prog.p0002 is {pageFlag ? 'ON' : 'OFF'} for your company
        </span>
      </div>
      <p className="muted">A flag resolves project override, then company override, then environment default, then the flag default.</p>

      <div className="toolbar">
        <label className="field field-inline">
          <span className="sr-only">Search flags</span>
          <input type="search" placeholder="Search key or description" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </label>
        <button type="button" className="btn" onClick={exportCsv} disabled={state.status !== 'ready'}>Export CSV</button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canConfigure}
          title={canConfigure ? '' : 'Your role does not include core.flag.configure'}
          onClick={() => { setFormError(null); addDialog.current?.showModal(); }}
        >
          Add override
        </button>
      </div>
      <p role="status" className="notice">{notice}</p>

      {state.status === 'loading' && (
        <div className="skeleton" aria-busy="true" aria-label="Loading feature flags">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton-row" />)}
        </div>
      )}
      {state.status === 'forbidden' && (
        <div className="state" role="alert">
          <h2>You do not have access to feature flags</h2>
          <p>Viewing flags needs the core.flag.view permission (System Administrator or IT Administrator). Ask a system administrator to grant it.</p>
        </div>
      )}
      {state.status === 'error' && <ErrorBox error={state.error} onRetry={load} />}
      {state.status === 'ready' && state.rows.length === 0 && (
        <div className="state">
          <h2>No flags match</h2>
          <p>{q ? 'Nothing matches that search.' : 'No flags have been defined yet.'}</p>
          {q && <button type="button" className="btn" onClick={() => setQ('')}>Clear search</button>}
        </div>
      )}
      {state.status === 'ready' && state.rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Flag</th><th>Level</th><th>Scope</th><th>Value</th><th>Last change</th><th className="num">Ver.</th></tr>
              </thead>
              <tbody>
                {state.rows.map((r) => (
                  <tr key={r.id} data-testid={`row-${r.key}-${r.level}-${r.environment ?? r.companyId ?? 'all'}-${r.projectId ?? ''}`}>
                    <td data-label="Flag"><code>{r.key}</code><div className="muted small">{r.description}</div></td>
                    <td data-label="Level">{levelLabel[r.level]}</td>
                    <td data-label="Scope">{scopeText(r)}</td>
                    <td data-label="Value">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={r.enabled}
                        aria-label={`${r.key} ${scopeText(r)}: ${r.enabled ? 'ON' : 'OFF'}`}
                        className={`switch ${r.enabled ? 'switch-on' : ''}`}
                        disabled={!canConfigure}
                        title={canConfigure ? 'Toggle with a reason' : 'Your role does not include core.flag.configure'}
                        onClick={() => openToggle(r)}
                      >
                        <span className="switch-label">{r.enabled ? 'ON' : 'OFF'}</span>
                      </button>
                    </td>
                    <td data-label="Last change">
                      {r.changedBy ? <>{r.changedBy}<div className="muted small">{formatDateTime(r.changedAt)}{r.remarks ? ` - ${r.remarks}` : ''}</div></> : <span className="muted">Never changed</span>}
                    </td>
                    <td data-label="Ver." className="num">{r.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span>{state.meta.total} flag rows, page {state.meta.page} of {state.meta.totalPages}</span>
            <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <button type="button" className="btn" disabled={page >= state.meta.totalPages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}

      <ReasonDialog dialogRef={toggleDialog} title={target ? `Turn ${target.enabled ? 'OFF' : 'ON'} ${target.key}` : ''} onSubmit={submitToggle} error={formError} busy={saving} submitLabel="Confirm change">
        {target && <p>Scope: <strong>{levelLabel[target.level]} - {scopeText(target)}</strong>. This is written to the audit trail.</p>}
      </ReasonDialog>

      <ReasonDialog dialogRef={addDialog} title="Add a flag override" onSubmit={submitAdd} error={formError} busy={saving} submitLabel="Save override">
        <label className="field">
          <span>Flag</span>
          <select name="key" required>{keys.map((k) => <option key={k}>{k}</option>)}</select>
        </label>
        <label className="field">
          <span>Level</span>
          <select name="level" defaultValue="company">
            <option value="environment">Environment default</option>
            <option value="company">Company override</option>
            <option value="project">Project override</option>
          </select>
        </label>
        <label className="field"><span>Environment (environment level)</span>
          <select name="environment">{ENVIRONMENTS.map((e) => <option key={e}>{e}</option>)}</select>
        </label>
        <label className="field"><span>Company ID (company and project levels)</span>
          <input name="companyId" type="number" min="1" defaultValue={session?.companyId ?? ''} />
        </label>
        <label className="field"><span>Project ID (project level)</span>
          <input name="projectId" type="number" min="1" />
        </label>
        <label className="check"><input name="enabled" type="checkbox" /> Enabled</label>
      </ReasonDialog>
    </section>
  );
}
