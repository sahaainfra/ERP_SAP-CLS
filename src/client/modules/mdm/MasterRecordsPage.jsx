import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { formatDate, formatDateTime } from '../../platform/format.js';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { CHANGE, RECORD_STATUS, REQUEST_STATUS, mdm, scoreTone, todayIST } from './api.js';

// Master Records (Administration, part 06.01): the records of a governed master (the business partner first), with filters, "as of" a date (FR-03) and the quality score (FR-04). A record opens with its versions (each with
// the date it applies from), its quality checks, its change requests and who refers to it; a merged record shows the record it was merged into (BR-01). A new record or a change is checked for duplicates before it is sent
// (FR-02): an identical PAN or GSTIN blocks, a similar name or the same mobile asks the person to confirm. Everything is a request to the steward unless it changes only fields that are not sensitive and the person may edit.
const params = () => new URLSearchParams(window.location.search);
const setParam = (k, v) => { const p = params(); if (v) p.set(k, v); else p.delete(k); window.history.replaceState(null, '', `${window.location.pathname}${p.toString() ? `?${p}` : ''}`); };
export default function MasterRecordsPage() {
  usePageTitle('Master Records');
  const [openId, setOpenId] = useState(() => Number(params().get('id')) || null);
  const [type, setType] = useState(() => params().get('type') || 'PARTNER');
  const masters = useQuery({ queryKey: ['mdm', 'masters'], queryFn: mdm.masters, retry: false });
  useEffect(() => { const on = () => setOpenId(Number(params().get('id')) || null); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  if (masters.error?.status === 403) return <NoPermission what="the master records" permission="mdm.record.view" />;
  if (masters.isError) return <ErrorState error={masters.error} onRetry={masters.refetch} />;
  if (masters.isPending) return <Skeleton label="Loading the masters" rows={3} />;
  const def = masters.data.rows.find((m) => m.type === type) ?? masters.data.rows[0];
  const open = (id) => { setParam('id', id ? String(id) : ''); setOpenId(id); };
  return openId ? <RecordDetail def={def} id={openId} onBack={() => open(null)} onOpen={open} /> : <RecordList def={def} masters={masters.data.rows} setType={(t) => { setParam('type', t); setType(t); }} onOpen={open} />;
}

function RecordList({ def, masters, setType, onOpen }) {
  const [f, setF] = useState(() => ({ q: '', status: params().get('status') ?? '', maxScore: params().get('maxScore') ?? '', asOf: '', sort: 'code', offset: 0, limit: 25 }));
  const q = useQuery({ queryKey: ['mdm', 'records', def.type, f], queryFn: () => mdm.records(def.type, f), retry: false, placeholderData: (p) => p });
  const formRef = useRef(null);
  const set = (p) => setF({ ...f, offset: 0, ...p });
  return (
    <section aria-labelledby="mdr-title" data-testid="mdm-records">
      <div className="page-head"><h1 id="mdr-title">Master Records</h1><button type="button" className="btn btn-primary" onClick={() => formRef.current?.open()} data-testid="mdm-new">{def.canEdit ? `New ${def.label.toLowerCase()}` : `Request a new ${def.label.toLowerCase()}`}</button></div>
      <p className="muted">{def.label}: every new record and every change of a sensitive field is approved by the steward{def.financial ? ' and the accounts manager' : ''}. Inactive records stay here but cannot be chosen in new transactions.</p>
      <form className="srch-form" role="search" aria-label="Filter the records" onSubmit={(e) => e.preventDefault()}>
        {masters.length > 1 && <Field label="Master" name="type" error={null}><select value={def.type} onChange={(e) => setType(e.target.value)}>{masters.map((m) => <option key={m.type} value={m.type}>{m.label}</option>)}</select></Field>}
        <Field label="Search" name="q" error={null}><input type="search" value={f.q} onChange={(e) => set({ q: e.target.value })} placeholder="Name or code" data-testid="mdr-q" /></Field>
        <Field label="Status" name="status" error={null}><select value={f.status} onChange={(e) => set({ status: e.target.value })} data-testid="mdr-status"><option value="">All but rejected</option>{Object.entries(RECORD_STATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Score at most" name="maxScore" error={null}><input type="number" min="0" max="100" value={f.maxScore} onChange={(e) => set({ maxScore: e.target.value })} /></Field>
        <Field label="As of" name="asOf" error={null} hint="The data that applied on that date"><input type="date" value={f.asOf} onChange={(e) => set({ asOf: e.target.value })} data-testid="mdr-asof" /></Field>
        <Field label="Sort" name="sort" error={null}><select value={f.sort} onChange={(e) => set({ sort: e.target.value })}><option value="code">Code</option><option value="name">Name</option><option value="score">Lowest score</option><option value="changed">Last changed</option></select></Field>
      </form>
      {q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.isPending ? <Skeleton label="Loading the records" rows={4} /> : q.data.rows.length === 0 ? <EmptyState title="No record" message={f.q || f.status ? 'Nothing matches these filters.' : `No ${def.label.toLowerCase()} yet. Request the first one.`} /> : (
        <>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Records"><table className="grid"><thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Status</th><th className="num">Quality</th><th>Version from</th><th>Mobile</th></tr></thead>
            <tbody>{q.data.rows.map((r) => (
              <tr key={r.id} data-testid="mdr-row">
                <th scope="row" data-label="Code"><a href={`?id=${r.id}`} onClick={(e) => { e.preventDefault(); onOpen(r.id); }}>{r.code}</a></th>
                <td data-label="Name">{r.name}</td><td data-label="Kind">{r.data.kind ?? '—'}</td>
                <td data-label="Status"><StatusBadge status={RECORD_STATUS[r.status]?.[0] ?? r.status} label={RECORD_STATUS[r.status]?.[1]} /></td>
                <td data-label="Quality" className="num"><span className={`mdm-score mdm-score-${scoreTone(r.dqScore)}`}>{r.dqScore ?? '—'}</span></td>
                <td data-label="Version from">{r.effectiveFrom ? formatDate(r.effectiveFrom) : '—'}</td><td data-label="Mobile">{r.data.mobile ?? '—'}</td>
              </tr>))}</tbody></table></div>
          <div className="pager"><span>{q.data.total} record(s)</span><button type="button" className="btn" disabled={f.offset === 0} onClick={() => setF({ ...f, offset: Math.max(0, f.offset - f.limit) })}>Previous</button><button type="button" className="btn" disabled={f.offset + f.limit >= q.data.total} onClick={() => setF({ ...f, offset: f.offset + f.limit })}>Next</button></div>
        </>
      )}
      <RecordForm ref={formRef} def={def} onDone={(r) => r?.record?.id && onOpen(r.record.id)} />
    </section>
  );
}

/** The form of a new record or a change: live check (errors, warnings, possible duplicates), the date it applies from and the justification. */
function RecordForm({ ref, def, record = null, onDone }) {
  const qc = useQueryClient();
  const dlg = useRef(null);
  const [data, setData] = useState({});
  const [meta, setMeta] = useState({ justification: '', effectiveFrom: todayIST(), ack: false });
  const [check, setCheck] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  useEffect(() => { if (ref) ref.current = { open: () => { setData(record ? { ...record.data } : {}); setMeta({ justification: '', effectiveFrom: todayIST(), ack: false }); setCheck(null); setError(null); setDone(null); dlg.current?.showModal(); } }; });
  const changed = record ? Object.fromEntries(Object.entries(data).filter(([k, v]) => (v ?? '') !== (record.data[k] ?? ''))) : data;
  const sensitive = record && Object.keys(changed).some((k) => def.fields.find((x) => x.key === k)?.sensitive);
  const direct = record && def.canEdit && !sensitive;
  const runCheck = async () => { try { setCheck(await mdm.check(def.type, Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v === '' ? null : v])), record?.id)); } catch { setCheck(null); } };
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    const payload = Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v === '' ? null : v]));
    try {
      const r = record
        ? await mdm.update(def.type, record.id, { data: payload, effectiveFrom: meta.effectiveFrom, justification: meta.justification || undefined, version: record.rowVersion })
        : await mdm.create(def.type, { data: payload, justification: meta.justification, effectiveFrom: meta.effectiveFrom, acknowledgeDuplicates: meta.ack });
      qc.invalidateQueries({ queryKey: ['mdm'] });
      setDone(r.applied ? `Saved. It applies from ${formatDate(r.effectiveFrom)}.` : `Sent to the steward for approval (request ${r.changeRequestId}).`);
      onDone?.(r);
    } catch (err) { setError(errorInfo(err)); if (err.code === 'DUPLICATE_WARNING' || err.code === 'DUPLICATE') runCheck(); } finally { setBusy(false); }
  };
  const warnDup = check?.duplicates?.filter((d) => !d.block) ?? [];
  const blockDup = check?.duplicates?.filter((d) => d.block) ?? [];
  return (
    <dialog ref={dlg} className="dialog dialog-wide" aria-labelledby="mdf-title" data-testid="mdm-form">
      <form onSubmit={submit}>
        <h2 id="mdf-title">{record ? `Change ${record.code} ${record.name}` : `New ${def.label.toLowerCase()}`}</h2>
        {done ? <><p role="status" data-testid="mdm-form-done">{done}</p><div className="actions"><button type="button" className="btn btn-primary" onClick={() => dlg.current?.close()}>Close</button></div></> : <>
          <div className="mdm-fields">{def.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? ' (required)' : ''}${f.sensitive ? ' · sensitive' : ''}`} name={f.key} error={error} hint={f.formatHint}>
              {f.type === 'enum'
                ? <select name={f.key} value={data[f.key] ?? ''} required={f.required} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} onBlur={runCheck} data-testid={`mdf-${f.key}`}><option value="">Choose</option>{f.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                : <input name={f.key} value={data[f.key] ?? ''} maxLength={f.max ?? 300} required={f.required} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} onBlur={runCheck} autoComplete="off" data-testid={`mdf-${f.key}`} />}
            </Field>))}</div>
          {check && (check.errors.length > 0 || check.warnings.length > 0 || check.duplicates.length > 0) && (
            <div className="mdm-check" role="status" data-testid="mdm-check">
              {blockDup.map((d) => <p key={d.id} className="field-error">Already exists: <strong>{d.code} {d.name}</strong> ({d.rules.join(', ')}). It cannot be saved again.</p>)}
              {warnDup.length > 0 && <><p><strong>This looks like:</strong></p><ul>{warnDup.map((d) => <li key={d.id} data-testid="mdm-similar">{d.code} {d.name} · {d.rules.join(', ')} · {d.score}%</li>)}</ul></>}
              {check.errors.map((x) => <p key={`${x.field}${x.message}`} className="field-error">{x.message}</p>)}
              {check.warnings.map((x) => <p key={`${x.field}${x.message}`} className="muted small">{x.message}</p>)}
              <p className="muted small">Quality score after this: {check.score}</p>
            </div>
          )}
          {!record && warnDup.length > 0 && <label className="check"><input type="checkbox" checked={meta.ack} onChange={(e) => setMeta({ ...meta, ack: e.target.checked })} data-testid="mdf-ack" /> I checked: this is a different {def.label.toLowerCase()}</label>}
          <Field label="Applies from" name="effectiveFrom" error={error} hint="Today or a later date"><input type="date" min={todayIST()} value={meta.effectiveFrom} onChange={(e) => setMeta({ ...meta, effectiveFrom: e.target.value })} data-testid="mdf-from" /></Field>
          <Field label={direct ? 'Justification (optional: this change applies without approval)' : 'Justification (required, min 10 characters)'} name="justification" error={error}><textarea rows="2" value={meta.justification} required={!direct} minLength={direct ? undefined : 10} maxLength={500} onChange={(e) => setMeta({ ...meta, justification: e.target.value })} data-testid="mdf-why" /></Field>
          {record && <p className="muted small" data-testid="mdf-route">{Object.keys(changed).length === 0 ? 'Nothing changed yet.' : direct ? 'Only fields that are not sensitive: saved at once, audited.' : 'Goes to the steward for approval.'}</p>}
          {error?.form && <p className="field-error" role="alert" data-testid="mdf-error">{error.form}</p>}
          <div className="actions"><button type="button" className="btn" onClick={() => dlg.current?.close()}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || (record && Object.keys(changed).length === 0)} data-testid="mdf-submit">{busy ? 'Sending...' : record ? (direct ? 'Save' : 'Send for approval') : 'Send for approval'}</button></div>
        </>}
      </form>
    </dialog>
  );
}

function RecordDetail({ def, id, onBack, onOpen }) {
  const qc = useQueryClient();
  const [asOf, setAsOf] = useState('');
  const q = useQuery({ queryKey: ['mdm', 'record', def.type, id, asOf], queryFn: () => mdm.record(def.type, id, asOf || undefined), retry: false, placeholderData: (p) => p });
  const refs = useQuery({ queryKey: ['mdm', 'refs', def.type, id], queryFn: () => mdm.references(def.type, id), retry: false });
  const formRef = useRef(null);
  const statusRef = useRef(null);
  const [error, setError] = useState(null);
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  if (q.isPending) return <Skeleton label="Loading the record" rows={5} />;
  const r = q.data;
  const review = async () => { setError(null); try { await mdm.review(def.type, id); qc.invalidateQueries({ queryKey: ['mdm'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="mdd-title" data-testid="mdm-record">
      <p><a href="?" onClick={(e) => { e.preventDefault(); onBack(); }} data-testid="mdd-back">← All records</a></p>
      <div className="page-head"><h1 id="mdd-title">{r.code} {r.name}</h1><StatusBadge status={RECORD_STATUS[r.status]?.[0] ?? r.status} label={RECORD_STATUS[r.status]?.[1]} /></div>
      {r.survivor && <p className="mdm-banner" role="note" data-testid="mdd-merged">Merged into <a href={`?id=${r.survivor.id}`} onClick={(e) => { e.preventDefault(); onOpen(r.survivor.id); }}>{r.survivor.code} {r.survivor.name}</a>. This record is kept; everything that refers to it now resolves to {r.survivor.code}.</p>}
      {r.merged.length > 0 && <p className="muted small">Records merged into this one: {r.merged.map((m) => `${m.code} ${m.name}`).join(', ')}</p>}
      <div className="actions-row">
        {r.canEdit && <button type="button" className="btn btn-primary" onClick={() => formRef.current?.open()} data-testid="mdd-change">{def.canEdit ? 'Change' : 'Request a change'}</button>}
        {r.canEdit && <button type="button" className="btn" onClick={() => statusRef.current?.showModal()} data-testid="mdd-status">{r.status === 'ACTIVE' ? 'Make inactive' : 'Make active again'}</button>}
        {r.canEdit && def.canEdit && <button type="button" className="btn" onClick={review} data-testid="mdd-review">Confirm still correct</button>}
        <Field label="Show as of" name="asOf" error={null}><input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} data-testid="mdd-asof" /></Field>
      </div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}
      {asOf && <p className="mdm-banner" role="status" data-testid="mdd-asof-note">{r.versionNo ? `As of ${formatDate(asOf)}: version ${r.versionNo}, in force from ${formatDate(r.effectiveFrom)}.` : `Nothing applied on ${formatDate(asOf)}.`}</p>}
      <div className="mdm-two">
        <section aria-labelledby="mdd-data"><h2 id="mdd-data">Data{r.masked ? <span className="muted small"> · sensitive fields masked</span> : null}</h2>
          <dl className="kv-list">{def.fields.map((f) => <div className="kv" key={f.key}><dt>{f.label}</dt><dd data-testid={`mdd-${f.key}`}>{r.data[f.key] ?? '—'}</dd></div>)}</dl>
        </section>
        <section aria-labelledby="mdd-q"><h2 id="mdd-q">Quality <span className={`mdm-score mdm-score-${scoreTone(r.quality.score)}`} data-testid="mdd-score">{r.quality.score}</span></h2>
          <ul className="mdm-list">{r.quality.results.filter((x) => !x.pass).map((x) => <li key={`${x.rule}${x.field}`} className={`mdm-sev-${x.severity.toLowerCase()}`}>{x.severity.toLowerCase()}: {x.message}</li>)}{r.quality.results.every((x) => x.pass) && <li>Every rule passes.</li>}</ul>
          <p className="muted small">Stewards: {r.stewards.length ? r.stewards.map((s) => `${s.name} (${s.role.toLowerCase()})`).join(', ') : 'none named'}</p>
        </section>
      </div>
      <h2>History</h2>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Versions"><table className="grid"><thead><tr><th className="num">Version</th><th>Applies from</th><th>State</th><th>Record after</th><th>Approved by</th><th>Changed</th></tr></thead>
        <tbody>{r.versions.map((v, i) => { const prev = r.versions[i + 1]; const diff = prev ? def.fields.filter((f) => (v.data[f.key] ?? null) !== (prev.data[f.key] ?? null)).map((f) => f.label) : ['first version']; return (
          <tr key={v.id} data-testid="mdd-version"><td className="num" data-label="Version">{v.version}</td><td data-label="Applies from">{formatDate(v.effectiveFrom)}</td><td data-label="State"><StatusBadge status={v.status === 'SUPERSEDED' ? 'RETIRED' : v.status} label={v.status.toLowerCase().replace(/^./, (c) => c.toUpperCase())} /></td><td data-label="Record after">{v.statusAfter.toLowerCase()}</td><td data-label="Approved by">{v.approvedBy ?? '—'}{v.approvedAt ? <div className="muted small">{formatDateTime(v.approvedAt)}</div> : null}</td><td data-label="Changed">{diff.join(', ') || 'status only'}</td></tr>); })}</tbody></table></div>
      <h2>Change requests</h2>
      {r.requests.length === 0 ? <p className="muted">None.</p> : <ul className="mdm-list">{r.requests.map((c) => <li key={c.id}><Link to={`/admin/master-data/change-requests?view=${c.mine ? 'mine' : 'all'}&open=${c.id}`}>{CHANGE[c.changeType]} · {formatDate(c.createdAt)}</Link> · <StatusBadge status={REQUEST_STATUS[c.status][0]} label={REQUEST_STATUS[c.status][1]} /> <span className="muted small">{c.justification}</span></li>)}</ul>}
      <h2>Referred to by</h2>
      {refs.data?.rows?.length ? <ul className="mdm-list" data-testid="mdd-refs">{refs.data.rows.map((x) => <li key={`${x.entity}${x.id}`}>{x.source}: {x.route ? <Link to={x.route}>{x.label}</Link> : x.label}{x.redirectedFrom ? <span className="muted small"> (through merged {x.redirectedFrom})</span> : null}</li>)}</ul> : <p className="muted">Nothing refers to this record yet.</p>}
      <RecordForm ref={formRef} def={def} record={r} />
      <StatusDialog dialogRef={statusRef} def={def} record={r} />
    </section>
  );
}

function StatusDialog({ dialogRef, def, record }) {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const action = record.status === 'ACTIVE' ? 'INACTIVATE' : 'REACTIVATE';
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    const fd = new FormData(e.currentTarget);
    try { const r = await mdm.setStatus(def.type, record.id, { action, justification: String(fd.get('justification')), effectiveFrom: String(fd.get('effectiveFrom')) || undefined }); setDone(`Sent to the steward (request ${r.changeRequestId}).`); qc.invalidateQueries({ queryKey: ['mdm'] }); } catch (err) { setError(errorInfo(err)); }
  };
  return (
    <dialog ref={dialogRef} className="dialog" aria-labelledby="mds-title" data-testid="mdm-status-dialog">
      <form onSubmit={submit}>
        <h2 id="mds-title">{action === 'INACTIVATE' ? `Make ${record.code} inactive` : `Make ${record.code} active again`}</h2>
        {done ? <p role="status">{done}</p> : <>
          <p className="muted small">{action === 'INACTIVATE' ? 'An inactive record stays in every report and old transaction, but cannot be chosen in a new one.' : 'It can be chosen again once the steward approves.'}</p>
          <Field label="Applies from" name="effectiveFrom" error={error}><input type="date" name="effectiveFrom" min={todayIST()} defaultValue={todayIST()} /></Field>
          <Field label="Justification (required, min 10 characters)" name="justification" error={error}><textarea name="justification" rows="2" required minLength={10} maxLength={500} data-testid="mds-why" /></Field>
          {error?.form && <p className="field-error" role="alert">{error.form}</p>}
        </>}
        <div className="actions"><button type="button" className="btn" onClick={() => { setDone(null); dialogRef.current?.close(); }}>{done ? 'Close' : 'Cancel'}</button>{!done && <button type="submit" className="btn btn-primary" data-testid="mds-submit">Send for approval</button>}</div>
      </form>
    </dialog>
  );
}
