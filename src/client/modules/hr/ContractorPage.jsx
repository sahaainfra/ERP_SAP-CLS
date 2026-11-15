import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { LICENCE_STATE, lab } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Contractor compliance (HR, part 07.08, FR-01): the CLRA licence number and its validity, the most workers the licence allows, the PF and ESI registrations, the work order, and the documents held in the partner master. Whoever
// keeps the compliance (HR, the subcontractor coordinator, commercial) edits it; HR is told when the licence is about to end, and no worker of the contractor is deployed once it has.
export default function ContractorPage() {
  const id = Number(new URLSearchParams(window.location.search).get('id')) || null;
  usePageTitle('Contractor compliance');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['lab', 'contractor', id], queryFn: () => lab.contractor(id), enabled: Boolean(id), retry: false });
  const [f, setF] = useState(null); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  useEffect(() => { const c = q.data?.compliance; setF({ clraLicenceNo: c?.clraLicenceNo ?? '', licenceValidUntil: c?.licenceValidUntil ?? '', maxWorkers: c?.maxWorkers ?? '', pfCode: c?.pfCode ?? '', esiCode: c?.esiCode ?? '', woReference: c?.woReference ?? '', woValidUntil: c?.woValidUntil ?? '' }); }, [q.data]);
  if (!id) return <section aria-labelledby="contractor-h" data-testid="contractor-none"><PageHeader id="contractor-h" title={"Contractor compliance"} subtitle={<>Open a contractor from the list. <Link to="/labour/contractors">Labour Contractors</Link></>} /></section>;
  if (q.error?.status === 403) return <NoPermission what="contractors" permission="hr.worker.view" />;
  if (q.isPending || !f) return <Skeleton label="Loading the contractor" rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const d = q.data; const set = (p) => setF((x) => ({ ...x, ...p }));
  const save = async () => {
    setError(null); setNote(null);
    try { await lab.setCompliance(id, { clraLicenceNo: f.clraLicenceNo.trim() || null, licenceValidUntil: f.licenceValidUntil || null, maxWorkers: f.maxWorkers === '' ? null : Number(f.maxWorkers), pfCode: f.pfCode.trim() || null, esiCode: f.esiCode.trim() || null, woReference: f.woReference.trim() || null, woValidUntil: f.woValidUntil || null, version: d.compliance?.rowVersion ?? 0 }); setNote('The compliance was saved.'); qc.invalidateQueries({ queryKey: ['lab'] }); } catch (e) { setError(errorInfo(e)); }
  };
  return (
    <section aria-labelledby="cp-title" data-testid="contractor">
      <p><Link to="/labour/contractors">← Labour Contractors</Link></p>
      <PageHeader id="cp-title" title={<>{d.name} <span className="muted small">{d.code}</span></>} meta={<><StatusBadge status={LICENCE_STATE[d.state][0]} label={LICENCE_STATE[d.state][1]} data-testid="cp-state" /> <span className="muted small">{d.registered} registered · {d.deployed} deployed today · {d.present} present</span></>} />
      {error?.form && <p className="field-error" role="alert" data-testid="cp-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="cp-note">{note}</p>}
      <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="CLRA licence number" name="clraLicenceNo" error={error}><input value={f.clraLicenceNo} maxLength={60} disabled={!d.can.edit} onChange={(e) => set({ clraLicenceNo: e.target.value })} data-testid="cp-licence" /></Field>
        <Field label="Licence valid until" name="licenceValidUntil" error={error}><input type="date" value={f.licenceValidUntil} disabled={!d.can.edit} onChange={(e) => set({ licenceValidUntil: e.target.value })} data-testid="cp-valid" /></Field>
        <Field label="Most workers allowed" name="maxWorkers" error={error}><input type="number" min="0" value={f.maxWorkers} disabled={!d.can.edit} onChange={(e) => set({ maxWorkers: e.target.value })} data-testid="cp-max" /></Field>
        <Field label="PF registration" name="pfCode" error={error}><input value={f.pfCode} maxLength={40} disabled={!d.can.edit} onChange={(e) => set({ pfCode: e.target.value })} /></Field>
        <Field label="ESI registration" name="esiCode" error={error}><input value={f.esiCode} maxLength={40} disabled={!d.can.edit} onChange={(e) => set({ esiCode: e.target.value })} /></Field>
        <Field label="Work order reference" name="woReference" error={error}><input value={f.woReference} maxLength={80} disabled={!d.can.edit} onChange={(e) => set({ woReference: e.target.value })} /></Field>
        <Field label="Work order valid until" name="woValidUntil" error={error}><input type="date" value={f.woValidUntil} disabled={!d.can.edit} onChange={(e) => set({ woValidUntil: e.target.value })} /></Field>
      </form>
      {d.can.edit && <div className="actions"><button type="button" className="btn btn-primary" onClick={save} data-testid="cp-save">Save</button></div>}
      <h2>Documents in the partner master</h2>
      {d.documents.length === 0 ? <p className="muted">None. Compliance documents are kept on the business partner (06.04).</p> : <ul className="mdm-list" data-testid="cp-docs">{d.documents.map((x, i) => <li key={i}>{x.type}{x.number ? ` ${x.number}` : ''}{x.validTo ? `, valid until ${x.validTo}` : ''}</li>)}</ul>}
    </section>
  );
}
