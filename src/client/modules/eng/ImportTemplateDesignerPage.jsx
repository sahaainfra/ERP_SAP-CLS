import { useEffect, useState } from 'react';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDateTime } from '../../platform/format.js';
import { useDesigner, useProposeTemplate } from '../../platform/excel/api.js';
import { Field, Link, can, errorInfo, usePageTitle } from '../core/pages/ui.jsx';

// Import Template Designer (part 04.13, section 7.3): the wording of each import template (labels, help, instructions), the columns that are made required, and whether a large file may be saved in chunks.
// The columns, their types and the rules belong to the module that registered the import and are shown, not edited. A change waits for a second person to approve it (maker-checker); the history lists every version.
export default function ImportTemplateDesignerPage({ session }) {
  usePageTitle('Import Template Designer');
  const q = useDesigner();
  const propose = useProposeTemplate();
  const [code, setCode] = useState('');
  const [cols, setCols] = useState({});
  const [instr, setInstr] = useState('');
  const [settings, setSettings] = useState({ allowChunked: false, chunkSize: 500 });
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const types = q.data?.types ?? [];
  const t = types.find((x) => x.code === code);
  useEffect(() => { if (!code && types.length) setCode(types[0].code); }, [types, code]);
  useEffect(() => { setSent(false); setError(null); }, [code]);
  useEffect(() => {
    if (t) { setCols(Object.fromEntries(t.columns.map((c) => [c.key, { label: c.label, help: c.help ?? '', required: Boolean(c.required) }]))); setInstr(t.instructions); setSettings({ allowChunked: Boolean(t.settings.allowChunked), chunkSize: t.settings.chunkSize }); }
  }, [code, q.data]);
  if (!can(session, 'xl.template.view')) return <NoPermission what="the import templates" permission="xl.template.view" />;
  if (q.isPending) return <Skeleton label="Loading the templates" rows={4} />;
  if (q.isError) return <ErrorState title="The templates could not be loaded" error={q.error} onRetry={() => q.refetch()} />;
  if (!types.length) return <section aria-labelledby="dt-title"><h1 id="dt-title">Import Template Designer</h1><EmptyState title="No import registered" message="Modules register their imports; none is registered yet." /></section>;
  const edit = q.data.canEdit && !t?.pending;
  const set = (key, patch) => setCols((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  const send = (e) => {
    e.preventDefault(); setError(null);
    const columns = Object.fromEntries(t.columns.flatMap((c) => { const v = cols[c.key]; const o = {}; if (v.label !== c.defaultLabel) o.label = v.label; if ((v.help ?? '') !== (c.defaultHelp ?? '')) o.help = v.help; if (v.required && !c.defaultRequired) o.required = true; return Object.keys(o).length ? [[c.key, o]] : []; }));
    propose.mutate({ importType: t.code, columns, instructions: instr, settings, reason }, { onSuccess: () => { setSent(true); setReason(''); }, onError: (er) => setError(errorInfo(er)) });
  };
  return (
    <section aria-labelledby="dt-title" data-testid="template-designer">
      <h1 id="dt-title">Import Template Designer</h1>
      <p className="muted">Change the wording and the instructions of an import template, make a column required, or allow large files to be saved in chunks. The columns themselves and their rules belong to the module. A change takes effect when a second person approves it.</p>
      <label className="field"><span>Import</span><select value={code} onChange={(e) => setCode(e.target.value)} data-testid="designer-type">{types.map((x) => <option key={x.code} value={x.code}>{x.label} (version {x.version})</option>)}</select></label>
      {t?.pending && <p role="status" className="notice" data-testid="designer-pending">A change is waiting for approval (proposed by {t.pending.by}: {t.pending.reason}).{t.pending.instanceId ? <> <Link to={`/workflow/instance?id=${t.pending.instanceId}`}>Open the approval</Link></> : ''}</p>}
      {sent && <p role="status" className="notice" data-testid="designer-sent">Sent for approval. The change takes effect when it is approved.</p>}
      {t && (
        <form className="form-grid" onSubmit={send} aria-label="Change the template">
          <fieldset disabled={!edit} className="form-section">
            <legend>Columns</legend>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Columns"><table className="grid" data-testid="designer-columns"><thead><tr><th>Column</th><th>Kind</th><th>Label in the template</th><th>Help</th><th>Required</th></tr></thead>
              <tbody>{t.columns.map((c) => (
                <tr key={c.key}><th scope="row" data-label="Column">{c.key}</th><td data-label="Kind">{c.type}</td>
                  <td data-label="Label"><input aria-label={`Label of ${c.key}`} value={cols[c.key]?.label ?? ''} maxLength={60} onChange={(e) => set(c.key, { label: e.target.value })} /></td>
                  <td data-label="Help"><input aria-label={`Help of ${c.key}`} value={cols[c.key]?.help ?? ''} maxLength={300} onChange={(e) => set(c.key, { help: e.target.value })} /></td>
                  <td data-label="Required"><input type="checkbox" aria-label={`${c.key} is required`} checked={Boolean(cols[c.key]?.required)} disabled={c.defaultRequired} onChange={(e) => set(c.key, { required: e.target.checked })} /></td></tr>))}</tbody></table></div>
          </fieldset>
          <Field label="Instructions (one line each, shown on the Instructions sheet)" name="instructions" error={error}><textarea rows="4" value={instr} maxLength={2000} onChange={(e) => setInstr(e.target.value)} /></Field>
          <fieldset disabled={!edit || !t.chunkedPossible} className="form-section">
            <legend>Large files</legend>
            <label className="field"><span><input type="checkbox" checked={settings.allowChunked} onChange={(e) => setSettings({ ...settings, allowChunked: e.target.checked })} /> Allow saving in chunks{t.chunkedPossible ? '' : ' (this import is always all or nothing)'}</span></label>
            <Field label="Rows in a chunk (10 to 5000)" name="settings.chunkSize" error={error}><input type="number" min="10" max="5000" value={settings.chunkSize} onChange={(e) => setSettings({ ...settings, chunkSize: Number(e.target.value) })} /></Field>
          </fieldset>
          {edit && <>
            <Field label="Reason for the change (at least 5 characters)" name="reason" error={error}><input value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="designer-reason" /></Field>
            {error?.form && <p role="alert" className="error" data-testid="designer-error">{error.form}{error.correlationId ? ` (reference ${error.correlationId})` : ''}</p>}
            <div className="actions"><button type="submit" className="btn btn-primary" disabled={propose.isPending || reason.trim().length < 5} data-testid="designer-send">Send for approval</button></div>
          </>}
        </form>)}
      {t && t.history.length > 0 && (
        <section className="card" aria-labelledby="dt-history"><h2 id="dt-history">History</h2>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Versions"><table className="grid" data-testid="designer-history"><thead><tr><th>Version</th><th>Status</th><th>By</th><th>When</th><th>Reason</th></tr></thead>
            <tbody>{t.history.map((h) => <tr key={h.version}><th scope="row" data-label="Version">{h.version}</th><td data-label="Status"><StatusBadge status={h.status === 'ACTIVE' ? 'approved' : h.status === 'PENDING' ? 'submitted' : h.status === 'REJECTED' ? 'rejected' : 'cancelled'} label={h.status.charAt(0) + h.status.slice(1).toLowerCase()} /></td><td data-label="By">{h.by}</td><td data-label="When">{formatDateTime(h.at)}</td><td data-label="Reason">{h.reason}</td></tr>)}</tbody></table></div>
        </section>)}
    </section>
  );
}
