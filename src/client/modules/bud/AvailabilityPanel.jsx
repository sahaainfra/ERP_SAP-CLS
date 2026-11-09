import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { CHECK_TONE, inr, lg } from './api.js';

/**
 * The budget availability panel of a document form (part 12.03, FR-05): what the budget of a WBS node and cost code has, what is committed and spent, what is left, and, when an amount is given, what the check says about it.
 * A purchase request, order or work order form places it beside its lines; the evidence panel of an approval shows the same figures. Props: projectId, wbsId, costCodeId, stage, amount.
 */
export default function AvailabilityPanel({ projectId, wbsId = null, costCodeId = null, stage = 'PO', amount = null }) {
  const t = useT('bud');
  const q = new URLSearchParams({ projectId: String(projectId ?? ''), ...(wbsId ? { wbsId: String(wbsId) } : {}), ...(costCodeId ? { costCodeId: String(costCodeId) } : {}), ...(amount ? { amount: String(amount), stage } : {}) }).toString();
  const a = useQuery({ queryKey: ['bud', 'availability', q], queryFn: () => lg.availability(q), enabled: Boolean(projectId), retry: false });
  if (!projectId) return null;
  if (a.isPending) return <p className="muted" role="status" data-testid="av-loading">{t('av.loading')}</p>;
  if (a.isError) return <p className="field-error" role="alert" data-testid="av-error">{a.error?.status === 403 ? t('av.noRight') : a.error?.message}</p>;
  const d = a.data; const neg = Number(d.available) < 0;
  return (
    <aside className="mdm-panel" aria-label={t('av.title')} data-testid="av-panel" data-available={d.available}>
      <h3>{t('av.title')}</h3>
      {!d.budgetId && <p className="muted" data-testid="av-nobudget">{t('av.noBudget')}</p>}
      <dl className="kv">
        {[['budget', d.budget], ['committed', d.committed], ['actual', d.actual]].map(([k, v]) => <div key={k}><dt>{t(`av.${k}`)}</dt><dd data-testid={`av-${k}`}>₹ {inr(v)}</dd></div>)}
        <div><dt>{t('av.available')}</dt><dd data-testid="av-available" className={neg ? 'field-error' : ''}>₹ {inr(d.available)}</dd></div>
      </dl>
      {d.asked && <p data-testid="av-asked" data-result={d.asked.result}><StatusBadge status={CHECK_TONE[d.asked.result]} label={t(`res.${d.asked.result}`)} /> {t('av.afterAsk', { after: inr(d.asked.after) })}{d.asked.message ? ` · ${d.asked.message}` : ''}</p>}
    </aside>
  );
}
