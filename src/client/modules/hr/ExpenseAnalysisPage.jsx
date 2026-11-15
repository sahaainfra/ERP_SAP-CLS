import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, usePageTitle } from '../core/pages/ui.jsx';
import { dayIST, exp } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Expense Analysis (HR, part 07.12, the report): what was claimed on approved, passed and paid claims, by project, by category and by employee for a period, with the GST (input credit), the number of lines and how many were flagged by the
// policy; each group links to the claims behind it. Anybody with the right sees all; a manager sees their team. Download CSV, print.
const inr = (n) => (n == null ? '—' : `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const saveCsv = (name, lines) => { const blob = new Blob([lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href); };
export default function ExpenseAnalysisPage() {
  const t = useT('exp');
  usePageTitle(t('ana.title'));
  const [f, setF] = useState({ from: `${dayIST(0).slice(0, 4)}-04-01`, to: dayIST(0), projectId: '' });
  const q = useQuery({ queryKey: ['exp', 'analysis', f], queryFn: () => exp.analysis({ from: f.from, to: f.to, projectId: f.projectId || undefined }), retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('ana.title')} permission="hr.expense.report" />;
  const d = q.data;
  const block = (key, label) => (
    <div key={key}><h2>{t(label)}</h2>
      {d[key].length === 0 ? <p className="muted">{t('ana.none')}</p> : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label={t(label)}>
          <table className="grid" data-testid={`an-${key}`}><thead><tr><th>{t(label)}</th><th>{t('claim.amount')}</th><th>GST</th><th>{t('ana.lines')}</th><th>{t('ana.flagged')}</th><th>{t('ana.share')}</th></tr></thead>
            <tbody>{d[key].map((g) => <tr key={g.key} data-testid="an-row"><th scope="row" data-label={t(label)}>{g.name}</th><td data-label={t('claim.amount')}>{inr(g.amount)}</td><td data-label="GST">{inr(g.gst)}</td><td data-label={t('ana.lines')}>{g.lines}</td><td data-label={t('ana.flagged')}>{g.flagged}</td><td data-label={t('ana.share')}><span className="trn-bar" role="img" aria-label={`${d.total ? Math.round((g.amount / d.total) * 100) : 0}%`}><span style={{ inlineSize: `${d.total ? Math.round((g.amount / d.total) * 100) : 0}%` }} /></span></td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
  return (
    <section aria-labelledby="an-title" data-testid="analysis">
      <PageHeader id="an-title" title={t('ana.title')} />
      <form className="srch-form mdm-fields no-print" aria-label={t('ana.period')} onSubmit={(e) => e.preventDefault()}>
        <Field label={t('ana.from')} name="from" error={null}><input type="date" value={f.from} onChange={(e) => e.target.value && setF({ ...f, from: e.target.value })} data-testid="an-from" /></Field>
        <Field label={t('ana.to')} name="to" error={null}><input type="date" value={f.to} onChange={(e) => e.target.value && setF({ ...f, to: e.target.value })} data-testid="an-to" /></Field>
        <LookupField id="an-project" label={t('claim.project')} lookup="iam/projects" value={f.projectId} onChange={(x) => setF({ ...f, projectId: x })} />
      </form>
      {q.isPending ? <Skeleton label={t('ana.title')} rows={5} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : d.lines === 0 ? <EmptyState title={t('ana.noneTitle')} message={t('ana.noneHint')} /> : (
        <>
          <dl className="op-figures" data-testid="an-summary"><div><dt>{t('claim.total')}</dt><dd data-testid="an-total">{inr(d.total)}</dd></div><div><dt>GST</dt><dd>{inr(d.gst)}</dd></div><div><dt>{t('ana.lines')}</dt><dd>{d.lines}</dd></div><div><dt>{t('ana.flagged')}</dt><dd>{d.flagged}</dd></div></dl>
          <div className="actions-row no-print"><button type="button" className="btn" onClick={() => saveCsv('expense-analysis.csv', [['Group', 'Name', 'Amount', 'GST', 'Lines', 'Flagged'], ...['byProject', 'byCategory', 'byEmployee'].flatMap((k) => d[k].map((g) => [k, g.name, g.amount, g.gst, g.lines, g.flagged]))])} data-testid="an-export">{t('act.csv')}</button><button type="button" className="btn" onClick={() => window.print()}>{t('act.print')}</button></div>
          {block('byProject', 'ana.byProject')}{block('byCategory', 'ana.byCategory')}{block('byEmployee', 'ana.byEmployee')}
        </>
      )}
      <p className="small"><Link to="/expenses">{t('my.title')}</Link></p>
    </section>
  );
}
