import { useRef, useState } from 'react';
import { api } from '../../../platform/api/index.js';
import { toCsv } from '../../../platform/format.js';
import { Field, FormDialog, Pager, QueryState, downloadCsv, errorInfo } from '../../core/pages/ui.jsx';
import { useOrgActivate, useOrgCreate, useOrgDeactivate, useOrgList, useOrgUpdate, useOrgUsers } from '../api/org.js';

export const STATUS_LABEL = { ACTIVE: 'Active', INACTIVE: 'Inactive', DRAFT: 'Draft', ON_HOLD: 'On hold', COMPLETED: 'Completed', CLOSED: 'Closed' };
const STATUS_CHIP = { ACTIVE: 'chip-pass', INACTIVE: 'chip-never', DRAFT: 'chip-not_applicable', ON_HOLD: 'chip-fail', COMPLETED: 'chip-never', CLOSED: 'chip-never' };
export const StatusChip = ({ status }) => <span className={`chip ${STATUS_CHIP[status] ?? 'chip-not_applicable'}`}>{STATUS_LABEL[status] ?? status}</span>;

const pretty = (v) => String(v ?? '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const labelOf = (options, v) => options.find(([value]) => value === v)?.[1] ?? pretty(v);

function RefSelect({ entity, name, defaultValue, required }) {
  const list = useOrgList(entity, { pageSize: 200, filters: { status: 'ACTIVE' } });
  return (
    <select name={name} defaultValue={defaultValue ?? ''} required={required}>
      <option value="">{required ? 'Choose...' : 'None'}</option>
      {(list.data?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} - {r.name ?? r.legalName}</option>)}
    </select>
  );
}

function UserSelect({ name, defaultValue }) {
  const users = useOrgUsers('');
  return (
    <select name={name} defaultValue={defaultValue ?? ''}>
      <option value="">Nobody yet</option>
      {(users.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.username})</option>)}
    </select>
  );
}

const LINK_TYPES = [['DEPARTMENT', 'Department', 'departments'], ['PROJECT', 'Project', 'projects'], ['SITE', 'Site', 'sites']];

/** Two linked controls: what a cost centre is mapped to (department, project or site) and which one. */
function LinkedPicker({ row, error }) {
  const [type, setType] = useState(row?.linkedType ?? '');
  const entity = LINK_TYPES.find(([v]) => v === type)?.[2];
  const list = useOrgList(entity ?? 'projects', { pageSize: 200, enabled: Boolean(entity) });
  return (
    <>
      <Field label="Mapped to" name="linkedType" error={error}>
        <select name="linkedType" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Nothing (a general cost centre)</option>
          {LINK_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Field>
      {entity && (
        <Field label={LINK_TYPES.find(([v]) => v === type)[1]} name="linkedId" error={error}>
          <select name="linkedId" key={type} defaultValue={row?.linkedType === type ? row.linkedId : ''} required>
            <option value="">Choose...</option>
            {(list.data?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} - {r.name}</option>)}
          </select>
        </Field>
      )}
    </>
  );
}

/** One input of a form, from its description: text, textarea, number, date, time, select, ref (another list) or user. */
export function FieldInput({ spec, row, error }) {
  if (spec.type === 'link') return <LinkedPicker row={row} error={error} />;
  const value = row?.[spec.name];
  const common = { name: spec.name, required: spec.required, 'aria-invalid': Boolean(error?.fields?.[spec.name]) };
  let input;
  if (spec.type === 'select') {
    input = (
      <select {...common} defaultValue={value ?? spec.default ?? ''}>
        {!spec.required && <option value="">None</option>}
        {spec.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  } else if (spec.type === 'ref') input = <RefSelect entity={spec.ref} name={spec.name} defaultValue={value} required={spec.required} />;
  else if (spec.type === 'user') input = <UserSelect name={spec.name} defaultValue={value} />;
  else if (spec.type === 'textarea') input = <textarea {...common} rows="2" defaultValue={value ?? ''} maxLength={spec.max ?? 400} />;
  else if (spec.type === 'number') input = <input {...common} type="number" step={spec.step ?? 1} min={spec.min} max={spec.max} defaultValue={value ?? spec.default ?? ''} />;
  else input = <input {...common} type={spec.type === 'date' ? 'date' : spec.type === 'time' ? 'time' : 'text'} defaultValue={value ?? ''} maxLength={spec.max ?? 200} />;
  return <Field label={`${spec.label}${spec.required ? ' *' : ''}`} name={spec.name} error={error} hint={spec.hint}>{input}</Field>;
}

/** Turn the submitted form into the body the API expects. */
export function readForm(f, fields, { creating }) {
  const body = {};
  for (const spec of fields) {
    if (spec.type === 'link') {
      const type = String(f.get('linkedType') ?? '');
      if (type) { body.linkedType = type; body.linkedId = Number(f.get('linkedId')); } else if (!creating) { body.linkedType = null; body.linkedId = null; }
      continue;
    }
    if (!f.has(spec.name)) continue;
    if (spec.createOnly && !creating) continue;
    const raw = String(f.get(spec.name)).trim();
    if (raw === '') {
      if (!creating && !spec.required) body[spec.name] = null;
      continue;
    }
    body[spec.name] = ['number', 'ref', 'user'].includes(spec.type) ? Number(raw) : raw;
  }
  return body;
}

const COL_KEY = (entity) => `erp.cols.${entity}`;
const loadCols = (entity, columns) => {
  try {
    const saved = JSON.parse(localStorage.getItem(COL_KEY(entity)) ?? 'null');
    if (Array.isArray(saved)) return saved.filter((k) => columns.some((c) => c.key === k));
  } catch {
    /* defaults */
  }
  return columns.map((c) => c.key);
};

/**
 * A list report of one organisation entity: search, filters, sortable columns, column chooser, paging, CSV export, and the
 * create, edit, deactivate and activate dialogs. `fields` describes the form; `onOpen` makes the code a link to an object page.
 */
export default function OrgList({ entity, title, noun, columns, fields, filters = [], fixedFilters = {}, defaults = {}, canManage, controlled = false, onOpen, hint, newLabel }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('code');
  const [filter, setFilter] = useState({});
  const [visible, setVisible] = useState(() => loadCols(entity, columns));
  const list = useOrgList(entity, { page, pageSize, q, sort, filters: { ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)), ...fixedFilters } });
  const create = useOrgCreate(entity);
  const update = useOrgUpdate(entity);
  const deactivate = useOrgDeactivate(entity);
  const activate = useOrgActivate(entity);
  const formDialog = useRef(null);
  const stateDialog = useRef(null);
  const [target, setTarget] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const rows = list.data?.data ?? [];
  const shown = columns.filter((c) => visible.includes(c.key));

  const toggleSort = (key) => setSort((s) => (s === key ? `-${key}` : key));
  const setCols = (next) => {
    setVisible(next);
    try { localStorage.setItem(COL_KEY(entity), JSON.stringify(next)); } catch { /* the choice lasts for this page view */ }
  };

  const exportCsv = async () => {
    const all = [];
    for (let p = 1; p <= 50; p += 1) {
      const params = new URLSearchParams({ page: String(p), pageSize: '200', q, sort });
      for (const [k, v] of Object.entries({ ...filter, ...fixedFilters })) if (v) params.set(`filter[${k}]`, v);
      const res = await api.get(`/iam/org/${entity}?${params}`);
      all.push(...res.data);
      if (p >= res.meta.totalPages) break;
    }
    downloadCsv(`${entity}.csv`, toCsv(shown.map((c) => c.label), all.map((r) => shown.map((c) => (c.text ? c.text(r) : r[c.key] ?? '')))));
  };

  const openForm = (row) => { setTarget(row ?? null); setError(null); formDialog.current?.showModal(); };
  const openState = (row, kind) => { setState({ row, kind }); setError(null); stateDialog.current?.showModal(); };
  const blockers = (error?.raw ?? []).filter((d) => d.field === 'blockers');

  return (
    <>
      {hint && <p className="muted">{hint}</p>}
      <p role="status" className="notice" data-testid={`${entity}-notice`}>{notice}</p>
      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search {title}</span><input type="search" placeholder={`Search ${title.toLowerCase()}`} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></label>
        <label className="field field-inline"><span className="sr-only">Status</span>
          <select value={filter.status ?? ''} onChange={(e) => { setFilter((f) => ({ ...f, status: e.target.value })); setPage(1); }} aria-label="Status">
            <option value="">Any status</option>
            {Object.entries(STATUS_LABEL).filter(([k]) => !(entity !== 'projects' && ['ON_HOLD', 'COMPLETED', 'CLOSED'].includes(k)) && !(!['projects', 'sites'].includes(entity) && k === 'DRAFT')).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        {filters.map((fl) => (
          <label key={fl.name} className="field field-inline"><span className="sr-only">{fl.label}</span>
            <select aria-label={fl.label} value={filter[fl.name] ?? ''} onChange={(e) => { setFilter((f) => ({ ...f, [fl.name]: e.target.value })); setPage(1); }}>
              <option value="">{fl.label}: any</option>
              {fl.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
        <label className="field field-inline"><span className="sr-only">Rows per page</span>
          <select aria-label="Rows per page" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}</select>
        </label>
        <details className="col-chooser">
          <summary className="btn">Columns</summary>
          <div className="col-chooser-list" role="group" aria-label="Choose columns">
            {columns.map((c) => (
              <label key={c.key}><input type="checkbox" checked={visible.includes(c.key)} disabled={visible.length === 1 && visible.includes(c.key)} onChange={(e) => setCols(e.target.checked ? [...visible, c.key] : visible.filter((k) => k !== c.key))} /> {c.label}</label>
            ))}
          </div>
        </details>
        <button type="button" className="btn" disabled={rows.length === 0} onClick={exportCsv}>Export CSV</button>
        {canManage && <button type="button" className="btn btn-primary" onClick={() => openForm(null)}>{newLabel ?? `New ${noun}`}</button>}
      </div>
      <QueryState query={list} what={title.toLowerCase()} permission="org.view" />
      {list.data && rows.length === 0 && (
        <div className="state">
          <h2>No {title.toLowerCase()}</h2>
          <p>{q || Object.values(filter).some(Boolean) ? 'Nothing matches those filters.' : canManage ? `Add the first ${noun} to get started.` : `No ${title.toLowerCase()} have been set up yet.`}</p>
          {canManage && !q && <button type="button" className="btn btn-primary" onClick={() => openForm(null)}>{newLabel ?? `New ${noun}`}</button>}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  {shown.map((c) => (
                    <th key={c.key} aria-sort={sort === c.key ? 'ascending' : sort === `-${c.key}` ? 'descending' : undefined}>
                      {c.sort ? <button type="button" className="th-sort" onClick={() => toggleSort(c.sort)}>{c.label}{sort === c.sort ? ' ▲' : sort === `-${c.sort}` ? ' ▼' : ''}</button> : c.label}
                    </th>
                  ))}
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`${entity}-row-${r.code}`}>
                    {shown.map((c, i) => (
                      <td key={c.key} data-label={c.label}>
                        {i === 0 && onOpen ? <a href="#open" onClick={(e) => { e.preventDefault(); onOpen(r); }}>{c.render ? c.render(r) : r[c.key]}</a> : c.key === 'status' ? <StatusChip status={r.status} /> : c.render ? c.render(r) : (r[c.key] ?? '')}
                      </td>
                    ))}
                    <td data-label="Actions">
                      {canManage && (
                        <div className="actions">
                          {!onOpen && <button type="button" className="btn btn-small" onClick={() => openForm(r)} aria-label={`Edit ${r.code}`}>Edit</button>}
                          {r.status === 'INACTIVE' && !controlled && <button type="button" className="btn btn-small" onClick={() => openState(r, 'activate')} aria-label={`Activate ${r.code}`}>Activate</button>}
                          {r.status !== 'INACTIVE' && !controlled && <button type="button" className="btn btn-small" onClick={() => openState(r, 'deactivate')} aria-label={`Deactivate ${r.code}`}>Deactivate</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager meta={list.data.meta} page={page} setPage={setPage} noun={title.toLowerCase()} />
        </>
      )}

      <FormDialog
        dialogRef={formDialog}
        title={target ? `Edit ${noun} ${target.code}` : `New ${noun}`}
        reason={Boolean(target)}
        error={error}
        busy={create.isPending || update.isPending}
        onSubmit={async (f) => {
          setError(null);
          try {
            const body = readForm(f, fields, { creating: !target });
            if (target) await update.mutateAsync({ id: target.id, version: target.version, ...body, reason: String(f.get('reason')) });
            else await create.mutateAsync({ ...defaults, ...body });
            formDialog.current?.close();
            setNotice(target ? `${noun} ${target.code} was saved.` : `The ${noun} was created.`);
          } catch (err) {
            setError(errorInfo(err));
          }
        }}
      >
        <div key={target?.id ?? 'new'} className="form-grid">
          {fields.filter((s) => !(target && s.createOnly)).map((s) => <FieldInput key={s.name} spec={s} row={target} error={error} />)}
        </div>
      </FormDialog>

      <FormDialog
        dialogRef={stateDialog}
        title={state?.kind === 'activate' ? `Activate ${noun} ${state?.row.code}` : `Deactivate ${noun} ${state?.row.code ?? ''}`}
        submitLabel={state?.kind === 'activate' ? 'Activate' : 'Deactivate'}
        error={error?.raw?.some?.((d) => d.field === 'blockers') ? { ...error, form: error.form } : error}
        busy={deactivate.isPending || activate.isPending}
        onSubmit={async (f) => {
          setError(null);
          try {
            const body = { id: state.row.id, version: state.row.version, reason: String(f.get('reason')) };
            if (state.kind === 'activate') await activate.mutateAsync(body);
            else await deactivate.mutateAsync(body);
            stateDialog.current?.close();
            setNotice(`${noun} ${state.row.code} is now ${state.kind === 'activate' ? 'active' : 'inactive'}.`);
          } catch (err) {
            setError({ ...errorInfo(err), raw: err.details ?? [] });
          }
        }}
      >
        <p className="muted">Recorded in the audit trail with your reason. Nothing is deleted.</p>
        {blockers.length > 0 && (
          <div className="state state-error" role="alert" data-testid="blockers">
            <h3>Blocked by open records</h3>
            <ul>{blockers.map((b, i) => <li key={i}>{b.message}</li>)}</ul>
          </div>
        )}
      </FormDialog>
    </>
  );
}
