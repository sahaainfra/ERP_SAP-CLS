import { useMemo, useRef, useState } from 'react';
import {
  useConversions, useConvertUnits, useCreateConversion, useCreateFormula, useCreateVersion, useFormula, useFormulas, useRemoveConversion, useRequestActivation,
  useStartShadow, useStopShadow, useTestFormula, useUoms, useUpdateVersion,
} from '../api/index.js';
import { TraceView } from '../components/TraceView.jsx';
import { toCsv } from '../../../platform/format.js';
import { todayIST } from '../../../../shared/dates.js';
import { Field, FormDialog, Link, QueryState, can, downloadCsv, errorInfo, navigateTo, usePageTitle } from './ui.jsx';

const POLICIES = [['half_up', 'Half up (commercial)'], ['bankers', "Banker's (half even, statutory)"], ['down', 'Down'], ['up', 'Up']];
const OWNERS = ['boq', 'billing', 'stores', 'tax', 'payroll', 'finance', 'projects', 'core'];
const STATE_CHIP = { current: 'chip-on', future: 'chip-status-soft-closed', past: 'chip-off', draft: 'chip-status-soft-closed', shadow: 'chip-status-open', retired: 'chip-off' };
const json = (v) => JSON.stringify(v, null, 2);

/** The fields of a formula version, shared by "new formula", "new version" and "edit draft". Values arrive and leave as text. */
function VersionFields({ base, error, withCode = false }) {
  return (
    <>
      {withCode && (
        <>
          <Field label="Code" name="code" error={error} hint="module.name in lower case, for example boq.line_amount"><input name="code" required /></Field>
          <Field label="Owning module" name="ownerModule" error={error}><select name="ownerModule" defaultValue="boq">{OWNERS.map((o) => <option key={o}>{o}</option>)}</select></Field>
          <label className="check"><input name="financial" type="checkbox" /> Financial formula (the CFO also approves new versions)</label>
        </>
      )}
      <Field label="Description" name="description" error={error}><input name="description" required minLength={5} maxLength={300} defaultValue={base?.description ?? ''} /></Field>
      <Field label="Formula" name="expression" error={error} hint="One step per line: name = expression. Functions: round, min, max, abs, floor, ceil, if, percent, sum. # starts a comment.">
        <textarea name="expression" rows="7" required className="mono" defaultValue={base?.expression ?? ''} />
      </Field>
      <Field label="Inputs (JSON)" name="inputs" error={error} hint='[{ "name": "quantity", "type": "quantity", "min": "0" }]. Types: money, rate, quantity, percent, decimal, integer, string, boolean'>
        <textarea name="inputs" rows="5" required className="mono" defaultValue={json(base?.inputs ?? [])} />
      </Field>
      <Field label="Outputs (JSON)" name="outputs" error={error} hint='[{ "name": "amount", "type": "money" }] - each must be a step of the formula'>
        <textarea name="outputs" rows="3" required className="mono" defaultValue={json(base?.outputs ?? [])} />
      </Field>
      <div className="row">
        <Field label="Rounding" name="roundingPolicy" error={error}><select name="roundingPolicy" defaultValue={base?.roundingPolicy ?? 'half_up'}>{POLICIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Effective from" name="effectiveFrom" error={error} hint="Today or later"><input name="effectiveFrom" type="date" required defaultValue={base?.effectiveFrom && base.effectiveFrom >= todayIST() ? base.effectiveFrom : todayIST()} /></Field>
      </div>
      <Field label="Test cases (JSON)" name="tests" error={error} hint='[{ "inputs": { ... }, "expect": { "amount": "1265.43" } }] - a version needs passing tests before it can be compared or activated'>
        <textarea name="tests" rows="5" className="mono" defaultValue={json(base?.tests ?? [])} />
      </Field>
    </>
  );
}

/** Turn the form into the API body; JSON fields that do not parse are reported at the field. */
function readVersionForm(f, withCode) {
  const fieldErrors = {};
  const parse = (name) => {
    try {
      return JSON.parse(String(f.get(name)) || '[]');
    } catch {
      fieldErrors[name] = 'This is not valid JSON.';
      return [];
    }
  };
  const body = {
    description: String(f.get('description')), expression: String(f.get('expression')), inputs: parse('inputs'), outputs: parse('outputs'),
    roundingPolicy: String(f.get('roundingPolicy')), effectiveFrom: String(f.get('effectiveFrom')), tests: parse('tests'), reason: String(f.get('reason')),
  };
  if (withCode) Object.assign(body, { code: String(f.get('code')), ownerModule: String(f.get('ownerModule')), financial: f.get('financial') === 'on' });
  return { body, fieldErrors };
}

function TestBench({ code, version }) {
  const test = useTestFormula();
  const [values, setValues] = useState({});
  const [error, setError] = useState(null);
  const set = (name) => (e) => setValues((v) => ({ ...v, [name]: e.target.value }));
  const run = async (e) => {
    e.preventDefault();
    setError(null);
    const inputs = {};
    for (const i of version.inputs) {
      const raw = values[i.name];
      if (raw === undefined || raw === '') continue;
      inputs[i.name] = i.type === 'boolean' ? raw === 'true' : raw;
    }
    try {
      await test.mutateAsync({ code, version: version.version, inputs });
    } catch (err) {
      setError({ form: err.message, correlationId: err.correlationId, fields: {} });
    }
  };
  return (
    <section aria-labelledby="bench-title" className="card">
      <h3 id="bench-title">Test bench - version {version.version}</h3>
      <form onSubmit={run} className="form-grid" aria-label="Test bench">
        {version.inputs.map((i) => (
          <Field key={i.name} label={`${i.label ?? i.name} (${i.type})`} name={i.name} error={error}>
            {i.allowed ? (
              <select value={values[i.name] ?? ''} onChange={set(i.name)} data-testid={`bench-${i.name}`}><option value="">Select</option>{i.allowed.map((a) => <option key={a}>{a}</option>)}</select>
            ) : i.type === 'boolean' ? (
              <select value={values[i.name] ?? ''} onChange={set(i.name)} data-testid={`bench-${i.name}`}><option value="">Select</option><option>true</option><option>false</option></select>
            ) : (
              <input value={values[i.name] ?? ''} onChange={set(i.name)} inputMode="decimal" data-testid={`bench-${i.name}`} />
            )}
          </Field>
        ))}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={test.isPending}>{test.isPending ? 'Calculating...' : 'Calculate'}</button></div>
      </form>
      {error && <p className="field-error" role="alert">{error.form}{error.correlationId && <> (Correlation ID: <code>{error.correlationId}</code>)</>}</p>}
      {test.data && !error && (
        <div data-testid="bench-result">
          <h4>Result</h4>
          <ul className="plain">{Object.entries(test.data.result).map(([k, v]) => <li key={k}><code>{k}</code> = <strong data-testid={`result-${k}`}>{v}</strong></li>)}</ul>
          <details open><summary>Show calculation</summary><TraceView trace={test.data.trace} /></details>
        </div>
      )}
    </section>
  );
}

function Units({ canManage }) {
  const uoms = useUoms();
  const [item, setItem] = useState('');
  const conversions = useConversions(item);
  const convert = useConvertUnits();
  const create = useCreateConversion();
  const remove = useRemoveConversion();
  const [bench, setBench] = useState({ quantity: '100', from: 'BAG', to: 'MT', itemCode: '' });
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const dialog = useRef(null);
  const codes = uoms.data?.map((u) => u.code) ?? [];
  const run = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await convert.mutateAsync({ quantity: bench.quantity, from: bench.from, to: bench.to, ...(bench.itemCode ? { itemCode: bench.itemCode } : {}) });
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const add = async (f) => {
    setError(null);
    try {
      await create.mutateAsync({ from: String(f.get('from')), to: String(f.get('to')), factor: String(f.get('factor')), itemCode: String(f.get('itemCode')) || undefined, reason: String(f.get('reason')) });
      dialog.current?.close();
      setNotice('Conversion added.');
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  return (
    <details className="card" data-testid="units-panel">
      <summary><strong>Units of measure and conversions</strong></summary>
      <p className="muted small">An item-specific factor (a bag of cement, a bar of steel by diameter) beats the generic one for the same pair, and conversions chain: BAG to KG with the item factor, then KG to MT with the generic one.</p>
      <form onSubmit={run} className="row" aria-label="Convert units">
        <Field label="Quantity" name="quantity" error={error}><input value={bench.quantity} onChange={(e) => setBench({ ...bench, quantity: e.target.value })} inputMode="decimal" /></Field>
        <Field label="From" name="from" error={error}><select value={bench.from} onChange={(e) => setBench({ ...bench, from: e.target.value })} data-testid="conv-from">{codes.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="To" name="to" error={error}><select value={bench.to} onChange={(e) => setBench({ ...bench, to: e.target.value })} data-testid="conv-to">{codes.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Item code (optional)" name="itemCode" error={error}><input value={bench.itemCode} onChange={(e) => setBench({ ...bench, itemCode: e.target.value })} data-testid="conv-item" /></Field>
        <button type="submit" className="btn btn-primary" disabled={convert.isPending}>Convert</button>
      </form>
      {error && <p className="field-error" role="alert">{error.form}</p>}
      {convert.data && !error && (
        <p data-testid="conv-result" role="status">
          <strong>{convert.data.result}</strong> {bench.to}
          <span className="muted small"> via {convert.data.path.length === 0 ? 'no conversion needed' : convert.data.path.map((p) => `${p.from} x ${p.factor} = ${p.to} (${p.source})`).join(', then ')}</span>
        </p>
      )}
      <div className="toolbar">
        <label className="field field-inline"><span>Show factors for item</span><input value={item} onChange={(e) => setItem(e.target.value)} placeholder="all generic factors" /></label>
        <button type="button" className="btn" disabled={!canManage} title={canManage ? '' : 'Needs core.calc.manage'} onClick={() => { setError(null); dialog.current?.showModal(); }}>Add conversion</button>
      </div>
      <p role="status" className="notice">{notice}</p>
      <QueryState query={conversions} what="conversions" permission="core.calc.view" />
      {conversions.data && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Conversion factors</caption>
            <thead><tr><th>1 of</th><th>equals</th><th>of</th><th>Applies to</th><th /></tr></thead>
            <tbody>
              {conversions.data.map((c) => (
                <tr key={c.id}>
                  <td data-label="1 of">{c.from}</td><td data-label="equals" className="num">{c.factor}</td><td data-label="of">{c.to}</td>
                  <td data-label="Applies to"><span className={`chip ${c.scope === 'item' ? 'chip-status-open' : 'chip-off'}`}>{c.scope === 'item' ? c.itemCode : 'every item'}</span></td>
                  <td>{canManage && <button type="button" className="link" onClick={() => remove.mutate(c.id)} aria-label={`Remove ${c.from} to ${c.to} for ${c.itemCode ?? 'every item'}`}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FormDialog dialogRef={dialog} title="Add a conversion factor" error={error} busy={create.isPending} submitLabel="Add" onSubmit={add}>
        <Field label="From unit" name="from" error={error}><select name="from">{codes.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="To unit" name="to" error={error}><select name="to">{codes.map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="1 from unit equals (factor)" name="factor" error={error} hint="for example 50 for 1 BAG = 50 KG"><input name="factor" required inputMode="decimal" /></Field>
        <Field label="Item code (leave empty for every item)" name="itemCode" error={error}><input name="itemCode" maxLength={40} /></Field>
      </FormDialog>
    </details>
  );
}

export default function FormulaRegistryPage({ session }) {
  usePageTitle('Formula Registry');
  const canManage = can(session, 'core.calc.manage');
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState('');
  const [code, setCode] = useState(null);
  const [versionNo, setVersionNo] = useState(null);
  const list = useFormulas({ q, owner });
  const detail = useFormula(code);
  const createFormula = useCreateFormula();
  const createVersion = useCreateVersion();
  const updateVersion = useUpdateVersion();
  const startShadow = useStartShadow();
  const stopShadow = useStopShadow();
  const requestActivation = useRequestActivation();
  const [dialogKind, setDialogKind] = useState('formula');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const formDialog = useRef(null);
  const reasonDialog = useRef(null);
  const [reasonAction, setReasonAction] = useState(null);

  const formulas = list.data?.data ?? [];
  const versions = detail.data?.versions ?? [];
  const selected = useMemo(() => versions.find((v) => v.version === versionNo) ?? versions.find((v) => v.state === 'current') ?? versions[0] ?? null, [versions, versionNo]);

  const openForm = (kind) => {
    setDialogKind(kind);
    setError(null);
    formDialog.current?.showModal();
  };
  const submitForm = async (f) => {
    setError(null);
    const { body, fieldErrors } = readVersionForm(f, dialogKind === 'formula');
    if (Object.keys(fieldErrors).length) return setError({ form: 'Please correct the highlighted fields.', fields: fieldErrors });
    try {
      let out;
      if (dialogKind === 'formula') out = await createFormula.mutateAsync(body);
      else if (dialogKind === 'version') out = await createVersion.mutateAsync({ code, ...body });
      else out = await updateVersion.mutateAsync({ code, versionNo: selected.version, rowVersion: selected.rowVersion, ...body });
      formDialog.current?.close();
      setCode(out.code);
      setVersionNo(out.version);
      setNotice(`Version ${out.version} of ${out.code} saved as a draft. Add tests, try it on the bench, compare it in shadow mode, then ask for activation.`);
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const askReason = (kind) => {
    setReasonAction(kind);
    setError(null);
    reasonDialog.current?.showModal();
  };
  const submitReason = async (f) => {
    setError(null);
    const reason = String(f.get('reason'));
    try {
      if (reasonAction === 'shadow') await startShadow.mutateAsync({ code, version: selected.version, reason });
      else if (reasonAction === 'stop') await stopShadow.mutateAsync({ code, version: selected.version, reason });
      else await requestActivation.mutateAsync({ code, version: selected.version, reason });
      reasonDialog.current?.close();
      setNotice(
        reasonAction === 'shadow' ? `Version ${selected.version} now runs beside the active version; differences are collected.` : reasonAction === 'stop' ? 'Shadow mode stopped.' : `Activation requested. It needs approval by ${detail.data.approvalChain.join(', then ')}: open Approvals to decide.`,
      );
    } catch (err) {
      setError(errorInfo(err));
    }
  };
  const exportCsv = () =>
    downloadCsv('formulas.csv', toCsv(['Code', 'Description', 'Owner', 'Financial', 'Current version', 'Latest version', 'Rounding'], formulas.map((f) => [f.code, f.description, f.ownerModule, f.financial ? 'Yes' : 'No', f.currentVersion ?? '', f.latestVersion, f.roundingPolicy])));

  return (
    <section aria-labelledby="page-title">
      <nav aria-label="Breadcrumb" className="breadcrumb">Administration &rsaquo; Calculations &rsaquo; Formula Registry</nav>
      <div className="page-head">
        <h1 id="page-title">Formula Registry</h1>
        <Link to="/admin/formulas/shadow">Shadow comparison</Link>
        <button type="button" className="btn" onClick={exportCsv} disabled={formulas.length === 0}>Export CSV</button>
        <button type="button" className="btn btn-primary" disabled={!canManage} title={canManage ? '' : 'Needs core.calc.manage (System Administrator)'} onClick={() => openForm('formula')}>New formula</button>
      </div>
      <p className="muted">Every business calculation is registered here once, with exact decimal arithmetic, a rounding policy and versions. A version that is active can never be edited: a new version is drafted, tested, optionally compared in shadow mode, and activated only after approval.</p>
      <p role="status" className="notice">{notice}</p>

      <div className="toolbar">
        <label className="field field-inline"><span className="sr-only">Search formulas</span><input type="search" placeholder="Search code or description" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <label className="field field-inline"><span>Owner</span><select value={owner} onChange={(e) => setOwner(e.target.value)}><option value="">All</option>{OWNERS.map((o) => <option key={o}>{o}</option>)}</select></label>
      </div>
      <QueryState query={list} what="the formula registry" permission="core.calc.view" />
      {list.data && formulas.length === 0 && <div className="state"><h2>No formulas match</h2><p>{q || owner ? 'Nothing matches those filters.' : 'No formula is registered yet.'}</p>{(q || owner) && <button type="button" className="btn" onClick={() => { setQ(''); setOwner(''); }}>Clear filters</button>}</div>}
      {formulas.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Registered formulas</caption>
            <thead><tr><th>Formula</th><th>Owner</th><th>Rounding</th><th className="num">In force</th><th className="num">Latest</th><th>Pending</th><th /></tr></thead>
            <tbody>
              {formulas.map((f) => (
                <tr key={f.code} className={code === f.code ? 'row-selected' : ''} data-testid={`formula-${f.code}`}>
                  <td data-label="Formula"><code>{f.code}</code>{f.financial && <span className="chip chip-off"> financial</span>}<div className="muted small">{f.description}</div></td>
                  <td data-label="Owner">{f.ownerModule}</td>
                  <td data-label="Rounding">{f.roundingPolicy === 'bankers' ? "Banker's" : f.roundingPolicy.replace('_', ' ')}</td>
                  <td data-label="In force" className="num">{f.currentVersion ? `v${f.currentVersion}` : '-'}</td>
                  <td data-label="Latest" className="num">v{f.latestVersion}</td>
                  <td data-label="Pending">{f.hasDraft && <span className="chip chip-status-soft-closed">draft</span>} {f.hasShadow && <span className="chip chip-status-open">shadow</span>}</td>
                  <td><button type="button" className="link" onClick={() => { setCode(f.code); setVersionNo(null); }} aria-label={`Open ${f.code}`}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {code && (
        <section aria-labelledby="detail-title" className="card" data-testid="formula-detail">
          <QueryState query={detail} what="the formula" permission="core.calc.view" />
          {detail.data && selected && (
            <>
              <div className="page-head">
                <h2 id="detail-title"><code>{detail.data.code}</code></h2>
                <button type="button" className="btn" disabled={!canManage} onClick={() => openForm('version')} title={canManage ? '' : 'Needs core.calc.manage'}>New version</button>
              </div>
              <p className="muted">{detail.data.description}. Owner: {detail.data.ownerModule}. New versions are approved by <strong>{detail.data.approvalChain.join(', then ')}</strong>.</p>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Versions of {detail.data.code}</caption>
                  <thead><tr><th>Version</th><th>State</th><th>From</th><th>To</th><th>Activated by</th><th /></tr></thead>
                  <tbody>
                    {versions.map((v) => (
                      <tr key={v.version} className={v.version === selected.version ? 'row-selected' : ''} data-testid={`version-${v.version}`}>
                        <td data-label="Version"><button type="button" className="link" onClick={() => setVersionNo(v.version)} aria-label={`Show version ${v.version}`}>v{v.version}</button></td>
                        <td data-label="State"><span className={`chip ${STATE_CHIP[v.state]}`}>{v.state}</span>{v.activationRequestId ? <div className="muted small">activation requested</div> : null}</td>
                        <td data-label="From">{v.effectiveFrom}</td><td data-label="To">{v.effectiveTo ?? 'open'}</td><td data-label="Activated by">{v.activatedBy ?? '-'}</td>
                        <td />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3>Version {selected.version}</h3>
              <p>{selected.description}</p>
              <pre className="payload" data-testid="expression">{selected.expression}</pre>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Inputs and outputs</caption>
                  <thead><tr><th>Kind</th><th>Name</th><th>Type</th><th>Rule</th></tr></thead>
                  <tbody>
                    {selected.inputs.map((i) => <tr key={`i-${i.name}`}><td data-label="Kind">input</td><td data-label="Name"><code>{i.name}</code></td><td data-label="Type">{i.type}</td><td data-label="Rule">{[i.min !== undefined && `min ${i.min}`, i.max !== undefined && `max ${i.max}`, i.allowed && `one of ${i.allowed.join(', ')}`].filter(Boolean).join('; ') || '-'}</td></tr>)}
                    {selected.outputs.map((o) => <tr key={`o-${o.name}`}><td data-label="Kind">output</td><td data-label="Name"><code>{o.name}</code></td><td data-label="Type">{o.type}</td><td data-label="Rule">{o.label ?? '-'}</td></tr>)}
                  </tbody>
                </table>
              </div>
              <p className="muted small">{selected.tests.length} test case(s). Rounding: {POLICIES.find(([p]) => p === selected.roundingPolicy)?.[1]}.</p>

              {canManage && (
                <div className="actions">
                  {selected.status === 'DRAFT' && <button type="button" className="btn" onClick={() => openForm('edit')}>Edit draft</button>}
                  {selected.status === 'DRAFT' && <button type="button" className="btn" onClick={() => askReason('shadow')}>Start shadow mode</button>}
                  {selected.status === 'SHADOW' && <button type="button" className="btn" onClick={() => askReason('stop')}>Stop shadow mode</button>}
                  {['DRAFT', 'SHADOW'].includes(selected.status) && <button type="button" className="btn btn-primary" disabled={Boolean(selected.activationRequestId)} onClick={() => askReason('activate')}>Request activation</button>}
                  {selected.status === 'SHADOW' && <button type="button" className="btn" onClick={() => navigateTo(`/admin/formulas/shadow?code=${detail.data.code}&candidate=${selected.version}`)}>See the comparison</button>}
                </div>
              )}
              <TestBench key={`${detail.data.code}-${selected.version}`} code={detail.data.code} version={selected} />
            </>
          )}
        </section>
      )}

      <Units canManage={canManage} />

      <FormDialog
        dialogRef={formDialog}
        title={dialogKind === 'formula' ? 'New formula' : dialogKind === 'version' ? `New version of ${code}` : `Edit draft version ${selected?.version ?? ''}`}
        error={error}
        busy={createFormula.isPending || createVersion.isPending || updateVersion.isPending}
        submitLabel="Save draft"
        onSubmit={submitForm}
      >
        <VersionFields key={`${dialogKind}-${code}-${selected?.version}`} base={dialogKind === 'formula' ? null : selected} error={error} withCode={dialogKind === 'formula'} />
      </FormDialog>

      <FormDialog
        dialogRef={reasonDialog}
        title={reasonAction === 'shadow' ? 'Start shadow mode' : reasonAction === 'stop' ? 'Stop shadow mode' : 'Request activation'}
        error={error}
        busy={startShadow.isPending || stopShadow.isPending || requestActivation.isPending}
        submitLabel={reasonAction === 'activate' ? 'Send for approval' : 'Confirm'}
        onSubmit={submitReason}
      >
        <p>
          {reasonAction === 'shadow' && 'The draft runs beside the active version on every calculation from now on. The active version still decides every result; the differences are recorded for the comparison report. The draft can no longer be edited.'}
          {reasonAction === 'stop' && 'The version stops being compared and can no longer be activated.'}
          {reasonAction === 'activate' && `The version must pass its own tests and start today or later. It needs approval by ${detail.data?.approvalChain.join(', then ')}. Nothing changes until the last approver agrees.`}
        </p>
      </FormDialog>
    </section>
  );
}
