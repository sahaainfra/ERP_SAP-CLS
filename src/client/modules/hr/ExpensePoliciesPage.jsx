import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, exp } from './api.js';

// Expense Policies (HR, part 07.12, the Config page): the limits by grade, category and city tier (a limit for a line, a per diem, a mileage rate, the amount above which a bill photo is mandatory), each with its effective dates. A new or changed
// policy is a draft until somebody else activates it (maker-checker); every change is in the history with the old and new figures. The most specific active policy in force on the day of a bill applies.
const TONE = { DRAFT: 'DRAFT', ACTIVE: 'COMPLETED', RETIRED: 'CANCELLED' };
const inr = (n) => (n == null || n === 0 ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const CATS = ['TRAVEL', 'LODGING', 'FOOD', 'LOCAL_CONVEYANCE', 'SITE_PURCHASE', 'PER_DIEM', 'MILEAGE', 'OTHER'];
export default function ExpensePoliciesPage() {
  const t = useT('exp');
  usePageTitle(t('pol.title'));
  const qc = useQueryClient();
  const session = useSession();
  const canActivate = (session.data?.permissions ?? []).includes('hr.expense.config_approve');
  const q = useQuery({ queryKey: ['exp', 'policies'], queryFn: exp.policies, retry: false });
  const blank = { grade: 'G3', category: 'LODGING', cityTier: '*', limit: '', perDiem: '', mileageRate: '', receiptAbove: '', effectiveFrom: dayIST(0), effectiveTo: '' };
  const [v, setV] = useState(blank); const [editing, setEditing] = useState(null); const [hist, setHist] = useState(null);
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what={t('pol.title')} permission="hr.expense.configure" />;
  const run = async (fn, done, reset) => { setError(null); setNote(null); try { await fn(); setNote(done); reset?.(); qc.invalidateQueries({ queryKey: ['exp'] }); } catch (e) { setError(errorInfo(e)); } };
  const save = (e) => { e.preventDefault(); run(() => exp.savePolicy({ ...(editing ? { id: editing.id, version: editing.rowVersion } : {}), grade: v.grade.trim() || '*', category: v.category, cityTier: v.cityTier, limit: Number(v.limit || 0), perDiem: Number(v.perDiem || 0), mileageRate: Number(v.mileageRate || 0), receiptAbove: v.receiptAbove === '' ? null : Number(v.receiptAbove), effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo || null }), t('pol.saved'), () => { setV(blank); setEditing(null); }); };
  return (
    <section aria-labelledby="po-title" data-testid="policies">
      <h1 id="po-title">{t('pol.title')}</h1>
      {error?.form && <p className="field-error" role="alert" data-testid="po-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="po-note">{note}</p>}
      {q.isPending ? <Skeleton label={t('pol.title')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.length === 0 ? <EmptyState title={t('pol.none')} message={t('pol.noneHint')} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('pol.title')}>
          <table className="grid" data-testid="po-table"><thead><tr><th>{t('pol.grade')}</th><th>{t('claim.category')}</th><th>{t('claim.tier')}</th><th>{t('pol.limit')}</th><th>{t('pol.perDiem')}</th><th>{t('pol.mileage')}</th><th>{t('pol.receipt')}</th><th>{t('pol.effective')}</th><th>{t('act.status')}</th><th><span className="sr-only">{t('act.actions')}</span></th></tr></thead>
            <tbody>{q.data.map((p) => (
              <tr key={p.id} data-testid="po-row" data-status={p.status}>
                <th scope="row" data-label={t('pol.grade')}>{p.grade}</th><td data-label={t('claim.category')}>{p.category === '*' ? t('pol.any') : t(`cat.${p.category}`)}</td><td data-label={t('claim.tier')}>{p.cityTier === '*' ? t('pol.any') : t(`tier.${p.cityTier}`)}</td>
                <td data-label={t('pol.limit')}>{inr(p.limit)}</td><td data-label={t('pol.perDiem')}>{inr(p.perDiem)}</td><td data-label={t('pol.mileage')}>{inr(p.mileageRate)}</td><td data-label={t('pol.receipt')}>{p.receiptAbove == null ? t('pol.default') : inr(p.receiptAbove)}</td>
                <td data-label={t('pol.effective')}>{p.effectiveFrom}{p.effectiveTo ? ` → ${p.effectiveTo}` : ''}</td><td data-label={t('act.status')}><StatusBadge status={TONE[p.status]} label={t(`pst.${p.status}`)} /></td>
                <td data-label={t('act.actions')}>
                  <button type="button" className="btn btn-small" onClick={() => { setEditing(p); setV({ grade: p.grade, category: p.category, cityTier: p.cityTier, limit: p.limit ? String(p.limit) : '', perDiem: p.perDiem ? String(p.perDiem) : '', mileageRate: p.mileageRate ? String(p.mileageRate) : '', receiptAbove: p.receiptAbove == null ? '' : String(p.receiptAbove), effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo ?? '' }); }} data-testid="po-edit">{t('act.edit')}</button>{' '}
                  {canActivate && p.status === 'DRAFT' && <button type="button" className="btn btn-small btn-primary" onClick={() => run(() => exp.policyAct(p.id, 'activate'), t('pol.activated'))} data-testid="po-activate">{t('pol.activate')}</button>}{' '}
                  {canActivate && p.status === 'ACTIVE' && <button type="button" className="btn btn-small" onClick={() => run(() => exp.policyAct(p.id, 'retire'), t('pol.retired'))} data-testid="po-retire">{t('pol.retire')}</button>}{' '}
                  <button type="button" className="btn btn-small" onClick={async () => setHist({ id: p.id, rows: await exp.policyHistory(p.id) })} data-testid="po-history">{t('act.history')}</button>
                </td>
              </tr>))}</tbody></table>
        </div>
      )}
      {hist && <div className="mdm-panel" data-testid="po-history-panel"><h3>{t('act.history')} #{hist.id}</h3><ul className="mdm-list">{hist.rows.map((h, i) => <li key={i}><span className="muted small">{String(h.at).slice(0, 16).replace('T', ' ')}</span> {h.action} · {h.by}{h.old ? ` · ${JSON.stringify(h.old)} → ${JSON.stringify(h.new)}` : ''}</li>)}</ul><div className="actions"><button type="button" className="btn" onClick={() => setHist(null)}>{t('act.close')}</button></div></div>}
      <form className="mdm-panel mdm-fields" onSubmit={save} data-testid="po-form" aria-label={editing ? t('act.edit') : t('pol.new')}>
        <h2>{editing ? t('act.edit') : t('pol.new')}</h2>
        <Field label={t('pol.grade')} name="grade" error={error} hint={t('pol.gradeHint')}><input value={v.grade} maxLength={20} onChange={(e) => setV({ ...v, grade: e.target.value.toUpperCase() })} required data-testid="po-grade" /></Field>
        <Field label={t('claim.category')} name="category" error={error}><select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} data-testid="po-category"><option value="*">{t('pol.any')}</option>{CATS.map((x) => <option key={x} value={x}>{t(`cat.${x}`)}</option>)}</select></Field>
        <Field label={t('claim.tier')} name="cityTier" error={error}><select value={v.cityTier} onChange={(e) => setV({ ...v, cityTier: e.target.value })} data-testid="po-tier"><option value="*">{t('pol.any')}</option>{['T1', 'T2', 'T3'].map((x) => <option key={x} value={x}>{t(`tier.${x}`)}</option>)}</select></Field>
        <Field label={t('pol.limit')} name="limit" error={error} hint={t('pol.limitHint')}><input type="number" min="0" step="0.01" value={v.limit} onChange={(e) => setV({ ...v, limit: e.target.value })} data-testid="po-limit" /></Field>
        <Field label={t('pol.perDiem')} name="perDiem" error={error}><input type="number" min="0" step="0.01" value={v.perDiem} onChange={(e) => setV({ ...v, perDiem: e.target.value })} data-testid="po-perdiem" /></Field>
        <Field label={t('pol.mileage')} name="mileageRate" error={error}><input type="number" min="0" step="0.01" value={v.mileageRate} onChange={(e) => setV({ ...v, mileageRate: e.target.value })} data-testid="po-mileage" /></Field>
        <Field label={t('pol.receipt')} name="receiptAbove" error={error} hint={t('pol.receiptHint')}><input type="number" min="0" step="0.01" value={v.receiptAbove} onChange={(e) => setV({ ...v, receiptAbove: e.target.value })} data-testid="po-receipt" /></Field>
        <Field label={t('pol.from')} name="effectiveFrom" error={error}><input type="date" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} required data-testid="po-from" /></Field>
        <Field label={t('pol.to')} name="effectiveTo" error={error}><input type="date" value={v.effectiveTo} onChange={(e) => setV({ ...v, effectiveTo: e.target.value })} data-testid="po-to" /></Field>
        <div className="actions">{editing && <button type="button" className="btn" onClick={() => { setEditing(null); setV(blank); }}>{t('act.close')}</button>}<button type="submit" className="btn btn-primary" data-testid="po-save">{t('act.save')}</button></div>
      </form>
      <p className="small"><Link to="/expenses/analysis">{t('ana.title')}</Link> · <Link to="/expenses">{t('my.title')}</Link></p>
    </section>
  );
}
