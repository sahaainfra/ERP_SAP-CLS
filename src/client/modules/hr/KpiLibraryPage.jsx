import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, perf } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// KPI Library & Cycles (HR, part 07.11, FR-01 and the Config page): the KPIs (a metric the system computes, a target, a direction, a weight, who it applies to, effective dates) and the review cycles. A KPI that is new or changed is a draft until
// a second person activates it; the history of each KPI is the audit trail. HR opens and closes cycles and runs the daily computation on demand.
const KTONE = { DRAFT: 'DRAFT', ACTIVE: 'COMPLETED', RETIRED: 'CANCELLED' };
const CTONE = { DRAFT: 'DRAFT', OPEN: 'ACTIVE', CLOSED: 'CLOSED' };
const csv = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
export default function KpiLibraryPage() {
  const t = useT('prf');
  usePageTitle(t('kpi.title'));
  const qc = useQueryClient();
  const session = useSession();
  const canActivate = (session.data?.permissions ?? []).includes('hr.perf.config_approve');
  const kpis = useQuery({ queryKey: ['perf', 'kpis'], queryFn: perf.kpis, retry: false });
  const metrics = useQuery({ queryKey: ['perf', 'metrics'], queryFn: perf.metrics, retry: false });
  const cycles = useQuery({ queryKey: ['perf', 'cycles'], queryFn: perf.cycles, retry: false });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [hist, setHist] = useState(null);
  const blank = { code: '', name: '', nameHi: '', formulaRef: 'TASK_ONTIME_PCT', direction: 'HIGHER', target: '80', weight: '20', all: true, designations: '', departments: '', effectiveFrom: dayIST(0), effectiveTo: '' };
  const [k, setK] = useState(blank); const [editing, setEditing] = useState(null);
  const [c, setC] = useState({ code: '', name: '', kind: 'ANNUAL', startDate: `${dayIST(0).slice(0, 4)}-04-01`, endDate: `${Number(dayIST(0).slice(0, 4)) + 1}-03-31`, selfDue: '', seniorFromLevel: '7' });
  if (kpis.error?.status === 403) return <NoPermission what={t('kpi.title')} permission="hr.perf.configure" />;
  const run = async (fn, done, reset) => { setError(null); setNote(null); try { await fn(); setNote(done); reset?.(); qc.invalidateQueries({ queryKey: ['perf'] }); } catch (e) { setError(errorInfo(e)); } };
  const saveKpi = (e) => {
    e.preventDefault();
    run(() => perf.saveKpi({ ...(editing ? { id: editing.id, version: editing.rowVersion } : {}), code: k.code, name: k.name.trim(), nameHi: k.nameHi.trim() || null, formulaRef: k.formulaRef, direction: k.direction, target: Number(k.target), weight: Number(k.weight), appliesTo: { ...(k.all ? { all: true } : {}), ...(csv(k.designations).length ? { designationCodes: csv(k.designations) } : {}), ...(csv(k.departments).length ? { departmentCodes: csv(k.departments) } : {}) }, effectiveFrom: k.effectiveFrom, effectiveTo: k.effectiveTo || null }), t('kpi.saved'), () => { setK(blank); setEditing(null); });
  };
  return (
    <section aria-labelledby="kl-title" data-testid="kpi-library">
      <PageHeader id="kl-title" title={t('kpi.title')} />
      {error?.form && <p className="field-error" role="alert" data-testid="kl-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="kl-note">{note}</p>}
      <h2>{t('kpi.library')}</h2>
      {kpis.isPending ? <Skeleton label={t('kpi.library')} rows={3} /> : kpis.isError ? <ErrorState error={kpis.error} onRetry={kpis.refetch} /> : kpis.data.length === 0 ? <EmptyState title={t('kpi.none')} message={t('kpi.noneHint')} /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('kpi.library')}>
          <table className="grid" data-testid="kl-table"><thead><tr><th>{t('kpi.code')}</th><th>{t('kpi.name')}</th><th>{t('kpi.metric')}</th><th>{t('my.target')}</th><th>{t('my.weight')}</th><th>{t('kpi.appliesTo')}</th><th>{t('s.status')}</th><th><span className="sr-only">{t('act.actions')}</span></th></tr></thead>
            <tbody>{kpis.data.map((x) => (
              <tr key={x.id} data-testid="kl-row" data-code={x.code} data-status={x.status}>
                <th scope="row" data-label={t('kpi.code')}>{x.code}</th><td data-label={t('kpi.name')}>{x.name}</td><td data-label={t('kpi.metric')}>{x.metricLabel}</td><td data-label={t('my.target')}>{x.target}{x.direction === 'LOWER' ? ` (${t('my.lower')})` : ''}</td><td data-label={t('my.weight')}>{x.weight}%</td>
                <td data-label={t('kpi.appliesTo')}>{x.appliesTo.all ? t('setup.everyone') : [...(x.appliesTo.designationCodes ?? []), ...(x.appliesTo.departmentCodes ?? [])].join(', ') || '—'}</td>
                <td data-label={t('s.status')}><StatusBadge status={KTONE[x.status]} label={t(`kpi.st.${x.status}`)} /></td>
                <td data-label={t('act.actions')}>
                  <button type="button" className="btn btn-small" onClick={() => { setEditing(x); setK({ code: x.code, name: x.name, nameHi: x.nameHi ?? '', formulaRef: x.formulaRef, direction: x.direction, target: String(x.target), weight: String(x.weight), all: Boolean(x.appliesTo.all), designations: (x.appliesTo.designationCodes ?? []).join(', '), departments: (x.appliesTo.departmentCodes ?? []).join(', '), effectiveFrom: x.effectiveFrom, effectiveTo: x.effectiveTo ?? '' }); }} data-testid="kl-edit">{t('act.edit')}</button>{' '}
                  {canActivate && x.status === 'DRAFT' && <button type="button" className="btn btn-small btn-primary" onClick={() => run(() => perf.kpiAct(x.id, 'activate'), t('kpi.activated'))} data-testid="kl-activate">{t('kpi.activate')}</button>}{' '}
                  {canActivate && x.status === 'ACTIVE' && <button type="button" className="btn btn-small" onClick={() => run(() => perf.kpiAct(x.id, 'retire'), t('kpi.retired'))} data-testid="kl-retire">{t('kpi.retire')}</button>}{' '}
                  <button type="button" className="btn btn-small" onClick={async () => setHist({ code: x.code, rows: await perf.kpiHistory(x.id) })} data-testid="kl-history">{t('ses.history')}</button>
                </td>
              </tr>))}</tbody></table>
        </div>
      )}
      {hist && <div className="mdm-panel" data-testid="kl-history-panel"><h3>{hist.code}</h3><ul className="mdm-list">{hist.rows.map((h, i) => <li key={i}><span className="muted small">{String(h.at).slice(0, 16).replace('T', ' ')}</span> {h.action} · {h.by}{h.old ? ` · ${JSON.stringify(h.old)} → ${JSON.stringify(h.new)}` : ''}</li>)}</ul><div className="actions"><button type="button" className="btn" onClick={() => setHist(null)}>{t('act.close')}</button></div></div>}
      <form className="mdm-panel mdm-fields" onSubmit={saveKpi} data-testid="kl-form" aria-label={editing ? t('act.edit') : t('kpi.new')}>
        <h3>{editing ? `${t('act.edit')}: ${editing.code}` : t('kpi.new')}</h3>
        <Field label={t('kpi.code')} name="code" error={error}><input value={k.code} maxLength={30} disabled={Boolean(editing)} onChange={(e) => setK({ ...k, code: e.target.value.toUpperCase() })} required data-testid="kl-code" /></Field>
        <Field label={t('kpi.name')} name="name" error={error}><input value={k.name} maxLength={120} onChange={(e) => setK({ ...k, name: e.target.value })} required data-testid="kl-name" /></Field>
        <Field label={t('setup.titleHi')} name="nameHi" error={error}><input value={k.nameHi} maxLength={120} onChange={(e) => setK({ ...k, nameHi: e.target.value })} data-testid="kl-namehi" /></Field>
        <Field label={t('kpi.metric')} name="formulaRef" error={error}><select value={k.formulaRef} onChange={(e) => setK({ ...k, formulaRef: e.target.value })} data-testid="kl-metric">{(metrics.data ?? []).map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}</select></Field>
        <Field label={t('kpi.direction')} name="direction" error={error}><select value={k.direction} onChange={(e) => setK({ ...k, direction: e.target.value })} data-testid="kl-direction"><option value="HIGHER">{t('kpi.higher')}</option><option value="LOWER">{t('kpi.lower')}</option></select></Field>
        <Field label={t('my.target')} name="target" error={error}><input type="number" min="0" step="any" value={k.target} onChange={(e) => setK({ ...k, target: e.target.value })} required data-testid="kl-target" /></Field>
        <Field label={t('my.weight')} name="weight" error={error}><input type="number" min="1" max="100" value={k.weight} onChange={(e) => setK({ ...k, weight: e.target.value })} required data-testid="kl-weight" /></Field>
        <label className="check"><input type="checkbox" checked={k.all} onChange={(e) => setK({ ...k, all: e.target.checked })} data-testid="kl-all" /> {t('setup.everyone')}</label>
        <Field label={t('setup.designations')} name="designations" error={error} hint={t('setup.csvHint')}><input value={k.designations} onChange={(e) => setK({ ...k, designations: e.target.value })} data-testid="kl-desig" /></Field>
        <Field label={t('kpi.departments')} name="departments" error={error} hint={t('setup.csvHint')}><input value={k.departments} onChange={(e) => setK({ ...k, departments: e.target.value })} data-testid="kl-dept" /></Field>
        <Field label={t('kpi.from')} name="effectiveFrom" error={error}><input type="date" value={k.effectiveFrom} onChange={(e) => setK({ ...k, effectiveFrom: e.target.value })} required data-testid="kl-from" /></Field>
        <Field label={t('kpi.to')} name="effectiveTo" error={error}><input type="date" value={k.effectiveTo} onChange={(e) => setK({ ...k, effectiveTo: e.target.value })} data-testid="kl-to" /></Field>
        <div className="actions">{editing && <button type="button" className="btn" onClick={() => { setEditing(null); setK(blank); }}>{t('act.close')}</button>}<button type="submit" className="btn btn-primary" data-testid="kl-save">{t('act.save')}</button></div>
      </form>
      <h2>{t('kpi.cycles')}</h2>
      {cycles.isPending ? <Skeleton label={t('kpi.cycles')} rows={2} /> : (cycles.data ?? []).length === 0 ? <p className="muted">{t('kpi.noCycles')}</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('kpi.cycles')}>
          <table className="grid" data-testid="cy-table"><thead><tr><th>{t('kpi.code')}</th><th>{t('kpi.name')}</th><th>{t('cyc.period')}</th><th>{t('rvl.title')}</th><th>{t('s.status')}</th><th><span className="sr-only">{t('act.actions')}</span></th></tr></thead>
            <tbody>{cycles.data.map((x) => (
              <tr key={x.id} data-testid="cy-row" data-code={x.code} data-status={x.status}>
                <th scope="row" data-label={t('kpi.code')}>{x.code}</th><td data-label={t('kpi.name')}>{x.name}</td><td data-label={t('cyc.period')}>{x.startDate} → {x.endDate}</td><td data-label={t('rvl.title')}>{x.reviews}</td>
                <td data-label={t('s.status')}><StatusBadge status={CTONE[x.status]} label={t(`cyc.st.${x.status}`)} /></td>
                <td data-label={t('act.actions')}>
                  {x.status === 'DRAFT' && <button type="button" className="btn btn-small btn-primary" onClick={() => run(() => perf.cycleAct(x.id, 'open'), t('cyc.opened'))} data-testid="cy-open">{t('cyc.open')}</button>}
                  {x.status === 'OPEN' && <button type="button" className="btn btn-small" onClick={() => run(() => perf.cycleAct(x.id, 'close'), t('cyc.closed'))} data-testid="cy-close">{t('cyc.close')}</button>}
                </td>
              </tr>))}</tbody></table>
        </div>
      )}
      <form className="mdm-panel mdm-fields" onSubmit={(e) => { e.preventDefault(); run(() => perf.saveCycle({ code: c.code, name: c.name.trim(), kind: c.kind, startDate: c.startDate, endDate: c.endDate, selfDue: c.selfDue || null, seniorFromLevel: Number(c.seniorFromLevel) }), t('cyc.saved'), () => setC({ ...c, code: '', name: '' })); }} data-testid="cy-form" aria-label={t('cyc.new')}>
        <h3>{t('cyc.new')}</h3>
        <Field label={t('kpi.code')} name="code" error={error}><input value={c.code} maxLength={30} onChange={(e) => setC({ ...c, code: e.target.value.toUpperCase() })} required data-testid="cy-code" /></Field>
        <Field label={t('kpi.name')} name="name" error={error}><input value={c.name} maxLength={120} onChange={(e) => setC({ ...c, name: e.target.value })} required data-testid="cy-name" /></Field>
        <Field label={t('cyc.kind')} name="kind" error={error}><select value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value })} data-testid="cy-kind">{['ANNUAL', 'HALF_YEARLY', 'QUARTERLY'].map((x) => <option key={x} value={x}>{t(`cyc.kind.${x}`)}</option>)}</select></Field>
        <Field label={t('kpi.from')} name="startDate" error={error}><input type="date" value={c.startDate} onChange={(e) => setC({ ...c, startDate: e.target.value })} required data-testid="cy-start" /></Field>
        <Field label={t('kpi.to')} name="endDate" error={error}><input type="date" value={c.endDate} onChange={(e) => setC({ ...c, endDate: e.target.value })} required data-testid="cy-end" /></Field>
        <Field label={t('cyc.selfDue')} name="selfDue" error={error}><input type="date" value={c.selfDue} onChange={(e) => setC({ ...c, selfDue: e.target.value })} data-testid="cy-due" /></Field>
        <Field label={t('cyc.senior')} name="seniorFromLevel" error={error} hint={t('cyc.seniorHint')}><input type="number" min="1" max="20" value={c.seniorFromLevel} onChange={(e) => setC({ ...c, seniorFromLevel: e.target.value })} data-testid="cy-senior" /></Field>
        <div className="actions"><button type="submit" className="btn btn-primary" data-testid="cy-save">{t('act.save')}</button></div>
      </form>
      <p className="small"><Link to="/performance/reviews">{t('rvl.title')}</Link> · <Link to="/performance/team">{t('team.title')}</Link></p>
    </section>
  );
}
