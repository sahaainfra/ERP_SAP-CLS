import { useMemo, useRef, useState } from 'react';
import { exportRegistry, useDecideChange, useImportRegistry, useProposeChange, useRegistry, useRegistryHistory } from '../../platform/shell/api.js';
import { Banner } from '../../platform/feedback/Feedback.jsx';
import { EmptyState } from '../../platform/feedback/states.jsx';
import { Field, FormDialog, QueryState, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import Icon from '../../platform/design/Icon.jsx';
import { fmtDateTime } from '../../../shared/dates.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

const PLACEMENT = { sidebar: 'Menu', user_menu: 'Account menu', console: 'Technical Console' };
const CONTEXT = { '': 'Not needed', project: 'A project', site: 'A site' };

/** Only what the person changed in the form, in the shape the server's change request takes. */
function changesFrom(entry, data) {
  const out = {};
  const text = (k, key, nullable) => { const v = String(data.get(k) ?? '').trim(); const next = v === '' && nullable ? null : v; if (next !== (entry[key] ?? (nullable ? null : ''))) out[key] = next; };
  text('label', 'label'); text('labelHi', 'labelHi', true); text('icon', 'icon', true); text('permissionKey', 'permissionKey', true); text('featureFlag', 'featureFlag', true);
  text('keywords', 'keywords', true); text('shortcut', 'shortcut', true);
  const parent = String(data.get('parentCode') ?? '');
  if (parent && parent !== entry.parentCode) out.parentCode = parent;
  const order = Number(data.get('sortOrder'));
  if (Number.isFinite(order) && order !== entry.sortOrder) out.sortOrder = order;
  const ctx = String(data.get('requiresContext') ?? '') || null;
  if (ctx !== (entry.requiresContext ?? null)) out.requiresContext = ctx;
  for (const [k, key] of [['mobileVisible', 'mobileVisible'], ['tile', 'tile'], ['isActive', 'isActive']]) {
    const v = data.get(k) === 'on';
    if (v !== entry[key]) out[key] = v;
  }
  return out;
}

function EditDialog({ entry, options, dialogRef, onDone }) {
  const propose = useProposeChange();
  const [error, setError] = useState(null);
  if (!entry) return <dialog ref={dialogRef} className="dialog" aria-label="Edit navigation entry" />;
  const isGroup = entry.kind === 'group';
  const submit = (data) => {
    const changes = changesFrom(entry, data);
    if (Object.keys(changes).length === 0) { setError({ form: 'Nothing is different from the stored settings.', fields: {} }); return; }
    setError(null);
    propose.mutate({ code: entry.code, changes, reason: String(data.get('reason') ?? ''), version: entry.version }, {
      onSuccess: (req) => { dialogRef.current?.close(); onDone(`Change to "${entry.label}" requested (request ${req.id}). Another system administrator must approve it before it applies.`); },
      onError: (e) => setError(errorInfo(e)),
    });
  };
  return (
    <FormDialog dialogRef={dialogRef} title={`Change ${entry.label}`} onSubmit={submit} error={error} busy={propose.isPending} submitLabel="Request change">
      <p className="muted small">Code <code>{entry.code}</code>{entry.route ? <> opens <code>{entry.route}</code></> : ' (a group)'}. The change applies after another system administrator approves it.</p>
      <Field label="Label" name="label" error={error}><input name="label" defaultValue={entry.label} required maxLength={60} /></Field>
      <Field label="Label in Hindi" name="labelHi" error={error}><input name="labelHi" defaultValue={entry.labelHi ?? ''} maxLength={60} /></Field>
      <Field label="Icon" name="icon" error={error}>
        <select name="icon" defaultValue={entry.icon ?? ''}><option value="">None</option>{options.icons.map((i) => <option key={i}>{i}</option>)}</select>
      </Field>
      <Field label="Order in its group" name="sortOrder" error={error}><input name="sortOrder" type="number" min="0" defaultValue={entry.sortOrder} /></Field>
      {!isGroup && (
        <>
          <Field label="Group" name="parentCode" error={error}>
            <select name="parentCode" defaultValue={entry.parentCode}>{options.groups.map((g) => <option key={g.code} value={g.code}>{g.label}</option>)}</select>
          </Field>
          <Field label="Permission key" name="permissionKey" error={error} hint="'self' means any signed-in person. Only Home and Profile may have none.">
            <select name="permissionKey" defaultValue={entry.permissionKey ?? ''}>
              {['home', 'profile'].includes(entry.code) && <option value="">None</option>}
              {options.permissions.map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Feature flag" name="featureFlag" error={error}>
            <select name="featureFlag" defaultValue={entry.featureFlag ?? ''}><option value="">None</option>{options.flags.map((f) => <option key={f}>{f}</option>)}</select>
          </Field>
          <Field label="Needs a working context" name="requiresContext" error={error}>
            <select name="requiresContext" defaultValue={entry.requiresContext ?? ''}>{Object.entries(CONTEXT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Field>
          <Field label="Search keywords" name="keywords" error={error}><input name="keywords" defaultValue={entry.keywords ?? ''} maxLength={300} /></Field>
          <Field label="Keyboard shortcut (g then a letter)" name="shortcut" error={error}><input name="shortcut" defaultValue={entry.shortcut ?? ''} maxLength={1} pattern="[a-z]" /></Field>
          <label className="check"><input type="checkbox" name="mobileVisible" defaultChecked={entry.mobileVisible} /> Show in the menu on phones</label>
          <label className="check"><input type="checkbox" name="tile" defaultChecked={entry.tile} /> Offer as a tile on the launchpad</label>
        </>
      )}
      <label className="check"><input type="checkbox" name="isActive" defaultChecked={entry.isActive} /> Active</label>
    </FormDialog>
  );
}

function HistoryDialog({ code, dialogRef }) {
  const h = useRegistryHistory(code);
  return (
    <dialog ref={dialogRef} className="dialog" aria-label="Change history">
      <h2>Change history{code ? `: ${code}` : ''}</h2>
      {code && <QueryState query={h} what="the change history" />}
      {h.data && h.data.length === 0 && <p className="muted">This entry has not been changed since it was seeded.</p>}
      {h.data?.length > 0 && (
        <ol className="history">
          {h.data.map((a) => (
            <li key={a.id}>
              <strong>{a.actor}</strong> <span className="muted">{fmtDateTime(a.at)}</span> {a.reason && <em>{a.reason}</em>}
              <ul>{Object.keys(a.newValues ?? {}).map((k) => <li key={k}><code>{k}</code>: {String(a.oldValues?.[k] ?? 'none')} → {String(a.newValues[k] ?? 'none')}</li>)}</ul>
            </li>
          ))}
        </ol>
      )}
      <div className="actions"><button type="button" className="btn" onClick={() => dialogRef.current?.close()}>Close</button></div>
    </dialog>
  );
}

function Pending({ pending, me }) {
  const decide = useDecideChange();
  const [comment, setComment] = useState({});
  if (pending.length === 0) return <p className="muted">No changes are waiting for approval.</p>;
  return (
    <table className="grid" aria-label="Changes waiting for approval">
      <thead><tr><th>Entry</th><th>Change</th><th>Requested by</th><th>Reason</th><th>Decision</th></tr></thead>
      <tbody>
        {pending.map((p) => {
          const own = p.requestedBy === me;
          return (
            <tr key={p.id}>
              <td><code>{p.code}</code></td>
              <td>{Object.entries(p.changes ?? {}).map(([k, v]) => <div key={k}><code>{k}</code> = {String(v ?? 'none')}</div>)}</td>
              <td>{p.requestedBy}</td>
              <td>{p.reason}</td>
              <td>
                {own ? <span className="muted">Waiting for another administrator</span> : (
                  <>
                    <input aria-label={`Comment for request ${p.id}`} placeholder="Comment (needed to reject)" value={comment[p.id] ?? ''} onChange={(e) => setComment({ ...comment, [p.id]: e.target.value })} />
                    <button type="button" className="btn btn-small btn-primary" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, action: 'approve', comment: comment[p.id] || 'Approved' })}>Approve</button>
                    <button type="button" className="btn btn-small btn-danger" disabled={decide.isPending} onClick={() => decide.mutate({ id: p.id, action: 'reject', comment: comment[p.id] ?? '' })}>Reject</button>
                    {decide.isError && decide.variables?.id === p.id && <span className="field-error" role="alert">{errorInfo(decide.error).form}</span>}
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Administration: the navigation registry (FR-01, AC-05): order, labels, icons, permissions and flags, changed by request and approval. */
export default function NavigationRegistryPage({ session }) {
  usePageTitle('Navigation Registry');
  const reg = useRegistry();
  const importer = useImportRegistry();
  const [q, setQ] = useState('');
  const [placement, setPlacement] = useState('');
  const [editing, setEditing] = useState(null);
  const [historyOf, setHistoryOf] = useState(null);
  const [notice, setNotice] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState(null);
  const editRef = useRef(null);
  const historyRef = useRef(null);
  const fileRef = useRef(null);
  const importReasonRef = useRef(null);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (reg.data?.entries ?? []).filter((e) => (!placement || e.placement === placement) && (!needle || `${e.label} ${e.code} ${e.route ?? ''} ${e.permissionKey ?? ''}`.toLowerCase().includes(needle)));
  }, [reg.data, q, placement]);

  const edit = (e) => { setEditing(e); setTimeout(() => editRef.current?.showModal(), 0); };
  const history = (e) => { setHistoryOf(e.code); setTimeout(() => historyRef.current?.showModal(), 0); };
  const download = async () => {
    const data = await exportRegistry();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'navigation-registry.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const upload = async (e) => {
    setImportError(null); setImportResult(null);
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let entries;
    try { entries = JSON.parse(await file.text()).entries; } catch { setImportError('That file is not a registry export (JSON).'); return; }
    if (!Array.isArray(entries)) { setImportError('That file has no list of entries.'); return; }
    const reason = importReasonRef.current?.value?.trim() ?? '';
    if (reason.length < 5) { setImportError('Say why you import these settings (at least 5 characters) before choosing the file.'); return; }
    importer.mutate({ entries: entries.slice(0, 100), reason }, { onSuccess: setImportResult, onError: (err) => setImportError(errorInfo(err).form) });
  };

  return (
    <section aria-labelledby="page-title">
      <PageHeader id="page-title" title={"Navigation Registry"} subtitle={"What the menu holds, for every role: each page with its group, order, icon, permission key and feature flag. A change is a request that another system administrator approves; it is audited with the old and new values."} />
      {notice && <Banner tone="success" onClose={() => setNotice('')} testId="registry-notice">{notice}</Banner>}
      <QueryState query={reg} what="the navigation registry" permission="ui.nav.manage" />
      {reg.data && (
        <>
          <div className="toolbar" role="search">
            <label className="shell-field"><span>Find an entry</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Label, code, route or permission" /></label>
            <label className="shell-field"><span>Shown in</span>
              <select value={placement} onChange={(e) => setPlacement(e.target.value)}><option value="">Everywhere</option>{Object.entries(PLACEMENT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <button type="button" className="btn" onClick={download}><Icon name="erp.action.export" size={14} /> Export settings</button>
          </div>
          <div className="table-wrap">
            <table className="grid" aria-label="Navigation entries">
              <thead><tr><th>Entry</th><th>Where</th><th>Route</th><th>Permission</th><th>Flag</th><th>Order</th><th>Phones</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.code} data-code={e.code} className={e.kind === 'group' ? 'row-group' : undefined}>
                    <td>{e.icon && <Icon name={e.icon} size={16} />} <strong>{e.label}</strong><div className="muted small"><code>{e.code}</code>{e.kind === 'page' && e.groupLabel ? ` in ${e.groupLabel}` : ' (group)'}</div></td>
                    <td>{PLACEMENT[e.placement]}</td>
                    <td>{e.route ? <code>{e.route}</code> : ''}</td>
                    <td>{e.permissionKey ? <code>{e.permissionKey}</code> : e.kind === 'page' ? 'None (allowed)' : ''}</td>
                    <td>{e.featureFlag ? <code>{e.featureFlag}</code> : ''}</td>
                    <td>{e.sortOrder}</td>
                    <td>{e.kind === 'page' ? (e.mobileVisible ? 'Yes' : 'No') : ''}</td>
                    <td>{e.isActive ? 'Active' : 'Hidden'}</td>
                    <td>
                      <button type="button" className="btn btn-small" onClick={() => edit(e)} aria-label={`Change ${e.label}`}>Change</button>
                      <button type="button" className="btn btn-small" onClick={() => history(e)} aria-label={`History of ${e.label}`}>History</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <EmptyState title="No entry matches" message="Clear the search to see every entry." />}
          </div>
          <h2>Waiting for approval</h2>
          <Pending pending={reg.data.pending} me={session.user} />
          <h2>Import settings</h2>
          <p className="muted small">Choose a file made with Export settings. Nothing is written directly: each difference becomes a change request for another administrator to approve.</p>
          <div className="toolbar">
            <label className="shell-field"><span>Reason for the import</span><input ref={importReasonRef} maxLength={500} placeholder="At least 5 characters" /></label>
            <label className="btn" htmlFor="registry-import">Choose a settings file</label>
            <input id="registry-import" ref={fileRef} type="file" accept="application/json,.json" className="visually-hidden" onChange={upload} />
          </div>
          {importError && <p className="field-error" role="alert">{importError}</p>}
          {importResult && (
            <Banner tone={importResult.errors.length ? 'warning' : 'success'} title="Import result" testId="import-result">
              {importResult.requested.length} change request(s) raised, {importResult.unchanged.length} entries unchanged, {importResult.errors.length} not accepted.
              {importResult.errors.length > 0 && <ul>{importResult.errors.map((x) => <li key={x.code}><code>{x.code}</code>: {x.message}</li>)}</ul>}
            </Banner>
          )}
        </>
      )}
      <EditDialog key={editing?.code ?? 'none'} entry={editing} options={reg.data?.options ?? { icons: [], groups: [], permissions: [], flags: [] }} dialogRef={editRef} onDone={setNotice} />
      <HistoryDialog code={historyOf} dialogRef={historyRef} />
    </section>
  );
}
