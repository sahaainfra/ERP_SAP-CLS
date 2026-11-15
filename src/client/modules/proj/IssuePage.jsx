import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { ISSUE_TONE, downloadFile, inr, rk } from './api.js';
import { useSearch } from './parts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Issue (part 10.06, FR-03): one issue with its impact; the owner works it and resolves it with the resolution, and a resolved issue is reopened by an amendment.
export default function IssuePage() {
  const t = useT('proj');
  const qc = useQueryClient();
  const id = Number(useSearch().get('id')) || null;
  const q = useQuery({ queryKey: ['proj', 'issue', id], queryFn: () => rk.issue(id), enabled: Boolean(id), retry: false });
  const h = useQuery({ queryKey: ['proj', 'issue-history', id], queryFn: () => rk.issueHistory(id), enabled: Boolean(id) && q.isSuccess, retry: false });
  const [resolution, setResolution] = useState(''); const [error, setError] = useState(null); const [note, setNote] = useState(null);
  usePageTitle(q.data ? `${q.data.docNo} ${q.data.title}` : t('rk.issueTitle'));
  if (!id) return <section aria-labelledby="iss-h" data-testid="iss-none"><PageHeader id="iss-h" title={t('rk.issueTitle')} subtitle={<Link to="/proj/issues">{t('rk.issuesTitle')}</Link>} /></section>;
  if (q.error?.status === 403) return <NoPermission what={t('rk.issuesTitle')} permission="proj.issue.view" />;
  if (q.isPending) return <Skeleton label={t('rk.issueTitle')} rows={5} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const i = q.data; const c = i.can;
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); qc.invalidateQueries({ queryKey: ['proj'] }); } catch (e) { setError(errorInfo(e)); } };
  const why = (action, done) => { const r = window.prompt(t('act.why')); if (r) run(() => rk.issueAct(i.id, action, { reason: r }), done); };
  return (
    <section aria-labelledby="iss-h" data-testid="issue" data-status={i.status}>
      <header>
        <PageHeader id="iss-h" title={<>{i.docNo} · {i.title} <StatusBadge status={ISSUE_TONE[i.status]} label={i.statusLabel} /></>} subtitle={<>{i.projectCode} · {t('rk.priority')}: {t(`rk.level.${i.priority}`)} · {t('rk.col.owner')}: {i.ownerUser}{i.dueDate ? ` · ${t('rk.due')}: ${i.dueDate}` : ''}{i.overdue ? ` · ${t('rk.overdue')}` : ''}{i.riskId ? <> · <Link to={`/proj/risk?id=${i.riskId}`}>{t('rk.linkedRisk')}</Link></> : null}</>} />
        {error?.form && <p className="field-error" role="alert" data-testid="iss-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        {note && <p className="mdm-banner" role="status" data-testid="iss-note">{note}</p>}
        <div className="actions-row no-print">
          {c.edit && i.status === 'OPEN' && <button type="button" className="btn" onClick={() => run(() => rk.updateIssue(i.id, { status: 'IN_PROGRESS' }), t('rk.started'))} data-testid="iss-start">{t('rk.start')}</button>}
          {c.withdraw && <button type="button" className="btn" onClick={() => why('withdraw', t('rk.reopened'))} data-testid="iss-withdraw">{t('act.withdraw')}</button>}
          {c.amend && <button type="button" className="btn" onClick={() => why('amend', t('rk.reopened'))} data-testid="iss-amend">{t('rk.reopen')}</button>}
          {c.cancel && <button type="button" className="btn" onClick={() => why('cancel', t('rk.issueCancelled'))} data-testid="iss-cancel">{t('act.cancel')}</button>}
          {c.print && <button type="button" className="btn" onClick={() => downloadFile(`/issues/${i.id}/print?format=html`, `${i.docNo}.html`)} data-testid="iss-print">{t('act.print')}</button>}
        </div>
      </header>
      <div className="mdm-panel">
        <dl>
          <dt>{t('rk.description')}</dt><dd>{i.description || '—'}</dd>
          <dt>{t('rk.impactCostRs')}</dt><dd>{inr(i.impactCost)}</dd><dt>{t('rk.delayDays')}</dt><dd>{i.impactTime}</dd><dt>{t('rk.impactText')}</dt><dd>{i.impactText || '—'}</dd>
          <dt>{t('rk.resolution')}</dt><dd data-testid="iss-resolution">{i.resolution || '—'}</dd>
        </dl>
      </div>
      {c.submit && (
        <form className="mdm-panel" aria-label={t('rk.resolve')} data-testid="iss-resolve" onSubmit={(e) => { e.preventDefault(); run(() => rk.issueAct(i.id, 'submit', { resolution }), t('rk.resolved')); }}>
          <h2>{t('rk.resolve')}</h2>
          <Field label={t('rk.resolution')} name="resolution" error={error}><textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} maxLength={2000} data-testid="iss-resolution-input" /></Field>
          <div className="actions"><button type="submit" className="btn btn-primary" disabled={resolution.trim().length < 10} data-testid="iss-resolve-btn">{t('rk.resolveBtn')}</button></div>
        </form>
      )}
      <div className="mdm-panel" data-testid="iss-history"><h2>{t('rk.history')}</h2>
        <ol>{(h.data?.audit ?? []).map((a, n) => <li key={n}>{String(a.at).slice(0, 16).replace('T', ' ')} · {a.actor} · {a.action}{a.reason ? ` — ${a.reason}` : ''}</li>)}</ol></div>
    </section>
  );
}
