import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { ess, trn } from './api.js';
import { CertForm } from './CertificationsPage.jsx';

// My Training (HR, part 07.10, FR-01 and FR-05): for the employee, the sessions they are nominated to (with sign-in by the QR code of the session, which opens this page with the code in the address), the sessions they went to with
// their scores and a way to rate them, their certificates with their validity, and the certificates their post needs. A phone is enough; English or Hindi.
const CERT_TONE = { VALID: 'COMPLETED', EXPIRING: 'AT_RISK', EXPIRED: 'OVERDUE', UNVERIFIED: 'IN_REVIEW', REVOKED: 'REJECTED' };
export default function MyTrainingPage() {
  const t = useT('trn');
  usePageTitle(t('mine.title'));
  const qc = useQueryClient();
  const session = useSession();
  const [token, setToken] = useState(new URLSearchParams(window.location.search).get('t') ?? '');
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [adding, setAdding] = useState(false); const [rate, setRate] = useState({});
  const q = useQuery({ queryKey: ['trn', 'mine'], queryFn: trn.mine, retry: false });
  if (q.error?.status === 403) return <NoPermission what={t('mine.title')} permission="hr.training.own" />;
  const d = q.data;
  const run = async (fn, done) => { setError(null); setNote(null); try { const r = await fn(); if (done) setNote(typeof done === 'function' ? done(r) : done); qc.invalidateQueries({ queryKey: ['trn'] }); } catch (e) { setError(errorInfo(e)); } };
  const meId = d?.employeeId;
  void meId; void session;
  return (
    <section aria-labelledby="mt-title" data-testid="my-training">
      <h1 id="mt-title">{t('mine.title')}</h1>
      <form className="mdm-panel mdm-fields" aria-label={t('mine.signIn')} onSubmit={(e) => { e.preventDefault(); if (token.trim()) run(() => trn.signIn(token.trim()), (r) => t('mine.signedIn', { course: r.course })); }} data-testid="mt-signin">
        <Field label={t('mine.code')} name="token" error={error} hint={t('mine.codeHint')}><input value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" data-testid="mt-token" /></Field>
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={!token.trim()} data-testid="mt-signin-go">{t('mine.signIn')}</button></div>
      </form>
      {error?.form && <p className="field-error" role="alert" data-testid="mt-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="mt-note">{note}</p>}
      {q.isPending ? <Skeleton label={t('mine.title')} rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : (
        <>
          <h2>{t('mine.upcoming')}</h2>
          {d.upcoming.length === 0 ? <p className="muted" data-testid="mt-none-upcoming">{t('mine.noUpcoming')}</p> : <ul className="mdm-list" data-testid="mt-upcoming">{d.upcoming.map((a) => <li key={a.id} data-testid="mt-up-row"><strong>{a.course}</strong> · {a.startAt.replace('T', ' ')} · {a.venue ?? ''} <StatusBadge status={a.attendance === 'ATTENDED' ? 'COMPLETED' : 'IN_REVIEW'} label={t(`att.${a.attendance}`)} /></li>)}</ul>}
          <h2>{t('mine.history')}</h2>
          {d.history.length === 0 ? <p className="muted">{t('mine.noHistory')}</p> : (
            <ul className="mdm-list" data-testid="mt-history">{d.history.map((a) => (
              <li key={a.id} data-testid="mt-hist-row"><strong>{a.course}</strong> · {a.startAt.slice(0, 10)} · <StatusBadge status={a.attendance === 'ATTENDED' ? 'COMPLETED' : 'OVERDUE'} label={t(`att.${a.attendance}`)} />{a.score != null ? ` · ${t('ses.score')} ${a.score}` : ''}{a.passed != null ? ` · ${a.passed ? t('ses.passed') : t('ses.failed')}` : ''}
                {a.canRate && (
                  <span className="trn-rate"> <label>{t('mine.rate')} <select value={rate[a.id] ?? ''} onChange={(e) => setRate({ ...rate, [a.id]: e.target.value })} data-testid="mt-rating"><option value="">–</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>{' '}
                    <button type="button" className="btn btn-small" disabled={!rate[a.id]} onClick={() => run(() => trn.feedback(a.sessionId, { rating: Number(rate[a.id]) }), t('mine.thanks'))} data-testid="mt-rate-go">{t('act.send')}</button></span>)}
              </li>))}</ul>
          )}
          <h2>{t('mine.certs')}</h2>
          {d.required.length > 0 && <p className="muted small">{t('mine.required')}: {d.required.join(', ')}</p>}
          {d.certificates.length === 0 ? <EmptyState title={t('mine.noCerts')} message={t('mine.noCertsHint')} /> : (
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t('mine.certs')}>
              <table className="grid" data-testid="mt-certs"><thead><tr><th>{t('cert.type')}</th><th>{t('cert.number')}</th><th>{t('cert.until')}</th><th>{t('s.status')}</th></tr></thead>
                <tbody>{d.certificates.map((c) => <tr key={c.id} data-testid="mt-cert-row" data-state={c.state}><th scope="row" data-label={t('cert.type')}>{c.certName}</th><td data-label={t('cert.number')}>{c.number ?? '—'}</td><td data-label={t('cert.until')}>{c.validUntil ?? '—'}</td><td data-label={t('s.status')}><StatusBadge status={CERT_TONE[c.state]} label={t(`cstate.${c.state}`)} /></td></tr>)}</tbody></table>
            </div>
          )}
          <div className="actions-row"><button type="button" className="btn" onClick={() => setAdding(true)} data-testid="mt-add-cert">{t('cert.recordMine')}</button></div>
          {adding && <OwnCert close={() => setAdding(false)} done={(m) => { setNote(m); qc.invalidateQueries({ queryKey: ['trn'] }); }} />}
        </>
      )}
      <p className="small"><Link to="/my-hr">{t('mine.home')}</Link></p>
    </section>
  );
}

function OwnCert({ close, done }) {
  const me = useQuery({ queryKey: ['ess', 'home'], queryFn: ess.home, retry: false });
  if (!me.data) return null;
  return <CertForm close={close} done={done} own={me.data.employee.id} />;
}
