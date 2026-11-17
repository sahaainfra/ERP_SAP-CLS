import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { SKILL_LABELS, dayIST, lab } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';
import { useFlagOn } from '../../platform/shell/api.js';

// Wage Rates & Minimum Wages (HR, part 07.08, FR-04): the minimum wage notifications by state and skill, and the rates contracted with each contractor by trade; effective-dated, daily, hourly or by the piece. A new rate is approved
// (HR manager; the commercial manager too for a contract rate) and replaces the old one from its date; a contract rate below the minimum wage of the state and skill on its date is refused. "What to pay" shows the rate that applies.
const blank = () => ({ kind: 'MINIMUM', contractorId: '', tradeCode: '', skillCategory: 'UNSKILLED', stateCode: '', payBasis: 'DAILY', rate: '', minWageRef: '', effectiveFrom: dayIST(0), reason: '' });
export default function WageRatesPage() {
  const codes = useFlagOn('ff.mdm.p16608'); // part 166.8 (S-05)
  usePageTitle('Wage Rates & Minimum Wages');
  const qc = useQueryClient();
  const session = useSession();
  const canEdit = (session.data?.permissions ?? []).includes('hr.worker.configure');
  const [v, setV] = useState(blank); const [open, setOpen] = useState(false); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const [what, setWhat] = useState({ contractorId: '', tradeCode: '', skillCategory: 'SKILLED', stateCode: '', payBasis: 'DAILY' });
  const ap = useQuery({ queryKey: ['lab', 'applicable', what], queryFn: () => lab.wages.applicable({ ...what, tradeCode: what.tradeCode || undefined }), enabled: Boolean(what.contractorId && what.stateCode.length >= 2), retry: false });
  const trades = useQuery({ queryKey: ['lab', 'trades'], queryFn: lab.trades, retry: false });
  if (session.data && !(session.data.permissions ?? []).includes('hr.worker.view')) return <NoPermission what="wage rates" permission="hr.worker.view" />;
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const save = async (submit) => {
    setError(null); setNote(null);
    try {
      const out = await lab.wages.create({ kind: v.kind, contractorId: v.kind === 'CONTRACT' ? Number(v.contractorId) || null : null, tradeCode: v.tradeCode || null, skillCategory: v.skillCategory, stateCode: v.stateCode.trim(), payBasis: v.payBasis, rate: Number(v.rate), minWageRef: v.minWageRef.trim() || null, effectiveFrom: v.effectiveFrom, reason: v.reason.trim() || null, submit });
      setNote(`${out.docNo} ${submit ? 'was sent for approval' : 'was saved as a draft'}.`); setOpen(false); setV(blank()); qc.invalidateQueries({ queryKey: ['lab'] }); qc.invalidateQueries({ queryKey: ['list'] });
    } catch (e) { setError(errorInfo(e)); }
  };
  return (
    <section aria-labelledby="wr-title" data-testid="wages">
      <PageHeader id="wr-title" title={"Wage Rates & Minimum Wages"} />
      {codes && <p className="small muted" role="note" data-testid="wr-code">Minimum wages are notified under the Code on Wages, 2019 (in force from 21-Nov-2025); each state's rules and their dates are in <Link to="/admin/master-data/common/labour-rules">Labour Code Rules</Link>.</p>}
      {note && <p className="mdm-banner" role="status" data-testid="wr-note">{note}</p>}
      {canEdit && <div className="actions-row"><button type="button" className="btn btn-primary" onClick={() => setOpen(true)} data-testid="wr-new">New rate</button></div>}
      {open && (
        <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); save(false); }} aria-label="Wage rate" data-testid="wr-form">
          {error?.form && <p className="field-error" role="alert" data-testid="wr-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
          <Field label="Kind" name="kind" error={error}><select value={v.kind} onChange={(e) => set({ kind: e.target.value })} data-testid="wr-kind"><option value="MINIMUM">Minimum wage notification</option><option value="CONTRACT">Contract rate</option></select></Field>
          {v.kind === 'CONTRACT' && <LookupField id="wr-contractor" label="Labour contractor" lookup="mdm/labour-contractors" value={v.contractorId} onChange={(x) => set({ contractorId: x })} required />}
          <Field label="State" name="stateCode" error={error}><input value={v.stateCode} maxLength={40} onChange={(e) => set({ stateCode: e.target.value })} data-testid="wr-state" /></Field>
          <Field label="Skill" name="skillCategory" error={error}><select value={v.skillCategory} onChange={(e) => set({ skillCategory: e.target.value })} data-testid="wr-skill">{Object.entries(SKILL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Trade (empty for all)" name="tradeCode" error={error}><select value={v.tradeCode} onChange={(e) => set({ tradeCode: e.target.value })} data-testid="wr-trade"><option value="">All trades</option>{(trades.data ?? []).map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ').toLowerCase()}</option>)}</select></Field>
          <Field label="Basis" name="payBasis" error={error}><select value={v.payBasis} onChange={(e) => set({ payBasis: e.target.value })} data-testid="wr-basis"><option value="DAILY">Daily</option><option value="HOURLY">Hourly</option>{v.kind === 'CONTRACT' && <option value="PIECE">By the piece</option>}</select></Field>
          <Field label="Rate (₹)" name="rate" error={error}><input type="number" min="0" step="0.01" value={v.rate} onChange={(e) => set({ rate: e.target.value })} data-testid="wr-rate" /></Field>
          <Field label="Effective from" name="effectiveFrom" error={error}><input type="date" value={v.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} data-testid="wr-from" /></Field>
          {v.kind === 'MINIMUM' && <Field label="Notification (number and date)" name="minWageRef" error={error}><input value={v.minWageRef} maxLength={120} onChange={(e) => set({ minWageRef: e.target.value })} data-testid="wr-ref" /></Field>}
          <div className="actions"><button type="button" className="btn" onClick={() => setOpen(false)}>Close</button><button type="button" className="btn" onClick={() => save(false)} data-testid="wr-save">Save draft</button><button type="button" className="btn btn-primary" onClick={() => save(true)} data-testid="wr-send">Send for approval</button></div>
        </form>
      )}
      <ListReport listCode="hr.wage_rates" endpoint="/hr/labour/wage-rates" title="Wage rates" session={session.data} cardFields={['docNo', 'kind', 'state', 'rate', 'effectiveFrom']} statusKey="status" empty={{ title: 'No rate yet', text: canEdit ? 'Start with the minimum wage notification of the state.' : 'Rates appear here once they are approved.' }} />
      <h2>What to pay</h2>
      <form className="srch-form" aria-label="What to pay" onSubmit={(e) => e.preventDefault()}>
        <LookupField id="wp-contractor" label="Contractor" lookup="mdm/labour-contractors" value={what.contractorId} onChange={(x) => setWhat((w) => ({ ...w, contractorId: x }))} />
        <Field label="State" name="state" error={null}><input value={what.stateCode} onChange={(e) => setWhat({ ...what, stateCode: e.target.value })} data-testid="wp-state" /></Field>
        <Field label="Skill" name="skill" error={null}><select value={what.skillCategory} onChange={(e) => setWhat({ ...what, skillCategory: e.target.value })}>{Object.entries(SKILL_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      </form>
      {ap.isPending && what.contractorId && what.stateCode.length >= 2 ? <Skeleton label="Looking up" rows={1} /> : ap.isError ? <ErrorState error={ap.error} onRetry={ap.refetch} /> : ap.data ? <p data-testid="wr-applicable">{ap.data.rate ? <>Pay <strong>{ap.data.rate.rate}</strong> a day <StatusBadge status="ACTIVE" label={ap.data.rate.source === 'CONTRACT' ? 'Contract rate' : 'Minimum wage'} /> (minimum wage {ap.data.minimum?.rate ?? 'not on file'}).</> : 'No rate and no minimum wage on file for this.'}</p> : <p className="muted">Choose a contractor and a state to see the rate that applies.</p>}
      <p className="small"><Link to="/labour/contractors">Labour Contractors</Link> · <Link to="/labour/workers">Workers Register</Link></p>
    </section>
  );
}
