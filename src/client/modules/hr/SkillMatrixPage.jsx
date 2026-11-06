import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { trn } from './api.js';

// Skill Matrix (HR, part 07.10, FR-04): people in the rows, skills in the columns, the latest assessed level (0 to 4) in each cell, for a site, a trade and employees or workers. A manager assesses the people who report to them by choosing a level
// in the cell; HR assesses anybody; nobody assesses themselves. The totals say how many are assessed, skilled (3 or 4) and able to train others (4); the matrix feeds deployment, permits and resource planning.
const TONE = ['muted', 'bad', 'warn', 'ok', 'info'];
export default function SkillMatrixPage() {
  const t = useT('trn');
  usePageTitle(t('skill.title'));
  const qc = useQueryClient();
  const session = useSession();
  const canAssess = (session.data?.permissions ?? []).includes('hr.skill.assess');
  const [f, setF] = useState({ siteId: '', trade: '', kind: 'EMPLOYEE' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null);
  const q = useQuery({ queryKey: ['trn', 'matrix', f], queryFn: () => trn.matrix({ siteId: f.siteId || undefined, trade: f.trade || undefined, kind: f.kind }), retry: false });
  const defs = useQuery({ queryKey: ['trn', 'skill-defs'], queryFn: trn.skillDefs, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('skill.title')} permission="hr.skill.view" />;
  const trades = [...new Set((defs.data ?? []).map((d) => d.trade).filter(Boolean))];
  const d = q.data;
  const assess = async (p, skill, level) => {
    setError(null); setNote(null);
    try { await trn.assess({ personType: f.kind, personId: p.id, skillCode: skill, level: Number(level) }); setNote(t('skill.saved', { name: p.name })); qc.invalidateQueries({ queryKey: ['trn', 'matrix'] }); } catch (e) { setError(errorInfo(e)); }
  };
  const csv = () => {
    const lines = [[t('skill.person'), t('skill.code'), ...d.skills.map((s) => s.name)], ...d.people.map((p) => [p.name, p.code, ...d.skills.map((s) => p.cells[s.code.toUpperCase()]?.level ?? '')])];
    const blob = new Blob([lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'skill-matrix.csv'; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <section aria-labelledby="sk-title" data-testid="skill-matrix">
      <h1 id="sk-title">{t('skill.title')}</h1>
      <form className="srch-form mdm-fields no-print" aria-label={t('skill.filters')} onSubmit={(e) => e.preventDefault()}>
        <LookupField id="sk-site" label={t('s.site')} lookup="iam/sites" value={f.siteId} onChange={(x) => setF({ ...f, siteId: x })} />
        <Field label={t('skill.trade')} name="trade" error={null}><select value={f.trade} onChange={(e) => setF({ ...f, trade: e.target.value })} data-testid="sk-trade"><option value="">{t('skill.allTrades')}</option>{trades.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
        <Field label={t('ses.kind')} name="kind" error={null}><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} data-testid="sk-kind"><option value="EMPLOYEE">{t('ses.employee')}</option><option value="WORKER">{t('ses.worker')}</option></select></Field>
        <div className="actions"><button type="button" className="btn" onClick={csv} disabled={!d} data-testid="sk-export">{t('act.csv')}</button><button type="button" className="btn" onClick={() => window.print()}>{t('cal.print')}</button></div>
      </form>
      {error?.form && <p className="field-error" role="alert" data-testid="sk-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="sk-note">{note}</p>}
      <ul className="trn-legend" aria-label={t('skill.legend')}>{[0, 1, 2, 3, 4].map((l) => <li key={l} className={`trn-lvl att-${TONE[l]}`}>{l} · {t(`level.${l}`)}</li>)}</ul>
      {q.isPending ? <Skeleton label={t('skill.title')} rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : d.skills.length === 0 ? <EmptyState title={t('skill.noSkills')} message={t('skill.noSkillsHint')} /> : d.people.length === 0 ? <EmptyState title={t('skill.noPeople')} message="" /> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t('skill.title')}>
          <table className="grid trn-matrix" data-testid="sk-table">
            <thead><tr><th scope="col">{t('skill.person')}</th>{d.skills.map((s) => <th scope="col" key={s.code} title={s.trade ?? ''}>{s.name}</th>)}</tr></thead>
            <tbody>{d.people.map((p) => (
              <tr key={p.id} data-testid="sk-row" data-code={p.code}>
                <th scope="row">{p.name} <span className="muted small">{p.code}{p.trade ? ` · ${p.trade}` : ''}</span></th>
                {d.skills.map((s) => { const c = p.cells[s.code.toUpperCase()]; return (
                  <td key={s.code} className={`att-${TONE[c?.level ?? 0]}`} data-label={s.name} data-level={c?.level ?? ''}>
                    {canAssess ? <select aria-label={`${p.name} · ${s.name}`} value={c?.level ?? ''} onChange={(e) => e.target.value !== '' && assess(p, s.code, e.target.value)} data-testid="sk-cell"><option value="">–</option>{[0, 1, 2, 3, 4].map((l) => <option key={l} value={l}>{l}</option>)}</select> : (c?.level ?? '–')}
                  </td>); })}
              </tr>))}</tbody>
            <tfoot><tr><th scope="row">{t('skill.skilled')}</th>{d.totals.map((x) => <td key={x.code} data-testid="sk-total">{x.skilled}/{x.assessed}{x.trainers ? ` · ${x.trainers}★` : ''}</td>)}</tr></tfoot>
          </table>
        </div>
      )}
      <p className="small"><Link to="/training/setup">{t('setup.title')}</Link> · <Link to="/training/compliance">{t('comp.title')}</Link></p>
    </section>
  );
}
