import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../site/parts.jsx';
import { fmtQty, fmtRs, hr } from './api.js';
import { useRunner } from './PlantParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Compute hire bill (part 17.06, FR-02, BR-01): choose an approved agreement and a period; the server works out the hours from the verified logs (the hours still waiting are shown, not billed), the minimum guarantee, the breakdown deduction, fuel recovered and GST. A dispute is entered with its reason.
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); const back = (n) => new Date(Date.parse(`${today()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
export default function HireBillPage() {
  const t = useT('plant'); usePageTitle(t('h.computeBill')); const sp = useSearch(); const [f, setF] = useState({ agreementId: sp.get('agreementId') ?? '', periodFrom: back(30), periodTo: back(1), disputeHrs: '', disputeReason: '' }); const [pv, setPv] = useState(null); const { error, run, busy } = useRunner(); const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); setPv(null); };
  const aq = useQuery({ queryKey: ['plant', 'hire-approved'], queryFn: () => hr.agreements({ pageSize: 100, 'filter[status]': 'APPROVED' }), retry: false });
  if (aq.error?.status === 403) return <NoPermission what={t('h.computeBill')} permission="plant.hire_bill.create" />; if (aq.isPending) return <Skeleton label={t('h.computeBill')} rows={4} />; if (aq.isError) return <ErrorState error={aq.error} onRetry={aq.refetch} />;
  const body = () => ({ agreementId: Number(f.agreementId), periodFrom: f.periodFrom, periodTo: f.periodTo, ...(f.disputeHrs !== '' ? { disputeHrs: Number(f.disputeHrs) } : {}), ...(f.disputeReason ? { disputeReason: f.disputeReason } : {}) });
  const rs = (v) => (v == null ? '—' : fmtRs(v));
  return (
    <section aria-labelledby="hc-h" data-testid="plant-hire-bill"><PageHeader id="hc-h" title={t('h.computeBill')} subtitle={<>{t('h.computeIntro')} <Link to="/plant/hire-agreements">{t('h.agreementsTitle')}</Link></>} />
      {error?.form && <p className="field-error" role="alert" data-testid="hc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      <div className="mdm-panel"><div className="form-grid"><Field label={t('h.agreement')} name="agreementId" error={error}><select value={f.agreementId} onChange={(ev) => set('agreementId', ev.target.value)} style={{ minHeight: 48 }} data-testid="hc-agreement"><option value="">—</option>{(aq.data.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.docNo} · {a.assetCode} · {t(`h.dir.${a.direction}`)}</option>)}</select></Field>
        <Field label={t('h.from')} name="periodFrom" error={error}><input type="date" value={f.periodFrom} max={today()} onChange={(ev) => set('periodFrom', ev.target.value)} style={{ minHeight: 48 }} data-testid="hc-from" /></Field><Field label={t('h.to')} name="periodTo" error={error}><input type="date" value={f.periodTo} max={today()} onChange={(ev) => set('periodTo', ev.target.value)} style={{ minHeight: 48 }} data-testid="hc-to" /></Field>
        <Field label={t('h.disputeHrs')} name="disputeHrs" error={error}><input type="number" step="any" value={f.disputeHrs} onChange={(ev) => set('disputeHrs', ev.target.value)} style={{ minHeight: 48 }} data-testid="hc-dispute-hrs" /></Field><Field label={t('h.disputeReason')} name="disputeReason" error={error}><input value={f.disputeReason} maxLength={300} onChange={(ev) => set('disputeReason', ev.target.value)} style={{ minHeight: 48 }} data-testid="hc-dispute-reason" /></Field></div>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || !f.agreementId} onClick={async () => { const d = await run(() => hr.billPreview(body()), null); if (d) setPv(d); }} data-testid="hc-preview">{t('h.preview')}</button></div></div>
      {pv && <div className="mdm-panel" data-testid="hc-result"><h2>{t('h.figures')}</h2>{pv.pendingHrs > 0 && <p className="mdm-banner" data-testid="hc-pending">{t('h.pending', { n: fmtQty(pv.pendingHrs) })}</p>}
        <dl className="kv"><div><dt>{t('h.working')}</dt><dd data-testid="hc-working">{fmtQty(pv.workingHrs)}</dd></div><div><dt>{t('h.idle')}</dt><dd>{fmtQty(pv.idleHrs)}</dd></div><div><dt>{t('h.breakdown')}</dt><dd>{fmtQty(pv.breakdownHrs)}</dd></div><div><dt>{t('h.guarantee')}</dt><dd>{fmtQty(pv.guaranteeHrs)}</dd></div><div><dt>{t('h.billable')}</dt><dd data-testid="hc-billable">{fmtQty(pv.billableHrs)}</dd></div><div><dt>{t('h.hireAmount')}</dt><dd>{rs(pv.hireAmount)}</dd></div><div><dt>{t('h.mobAmount')}</dt><dd>{rs(pv.mobAmount)}</dd></div><div><dt>{t('h.fuelRecovery')}</dt><dd>{rs(pv.fuelRecovery)}</dd></div><div><dt>{t('h.gst')}</dt><dd>{rs(pv.gstAmount)}</dd></div><div><dt>{t('h.amount')}</dt><dd data-testid="hc-amount">{rs(pv.amount)}</dd></div></dl>
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} disabled={busy} onClick={async () => { const d = await run(() => hr.billCreate(body()), t('h.billSaved')); if (d) navigateTo(`/plant/hire-agreements?bill=${d.id}`); }} data-testid="hc-save">{t('h.saveBill')}</button></div></div>}
    </section>
  );
}
