import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { ess } from './api.js';

// Profile Change Request (HR, part 07.09, FR-01): an employee asks for a change of their own contact details; it is the change document of part 07.01 (approved by HR, the bank and statutory details by the HR manager) and takes effect
// only when approved. The list shows my requests and where each stands.
const TONE = { PENDING: 'IN_REVIEW', SCHEDULED: 'AT_RISK', APPLIED: 'APPROVED', REJECTED: 'REJECTED', RETURNED: 'RETURNED', CANCELLED: 'CANCELLED' };
export default function ProfileChangePage() {
  const t = useT('ess');
  usePageTitle(t('profile.title'));
  const qc = useQueryClient();
  const [v, setV] = useState({ mobile: '', email: '', reason: '' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false);
  const q = useQuery({ queryKey: ['ess', 'profile-changes'], queryFn: ess.profileChanges, retry: false });
  const send = async () => {
    setBusy(true); setError(null); setNote(null);
    const changes = {}; if (v.mobile.trim()) changes.mobile = v.mobile.trim(); if (v.email.trim()) changes.email = v.email.trim();
    try { await ess.amendMine({ type: 'PROFILE', changes, reason: v.reason.trim() }); setNote(t('profile.sent')); setV({ mobile: '', email: '', reason: '' }); qc.invalidateQueries({ queryKey: ['ess'] }); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="pc-title" data-testid="profile-change">
      <h1 id="pc-title">{t('profile.title')}</h1>
      <p className="muted">{t('profile.intro')}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="pc-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="pc-note">{note}</p>}
      <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <Field label={t('profile.mobile')} name="mobile" error={error}><input inputMode="numeric" maxLength={10} value={v.mobile} onChange={(e) => setV({ ...v, mobile: e.target.value.replace(/\D/g, '') })} data-testid="pc-mobile" /></Field>
        <Field label={t('profile.email')} name="email" error={error}><input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} data-testid="pc-email" /></Field>
        <Field label={t('profile.reason')} name="reason" error={error}><textarea rows="2" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} data-testid="pc-reason" /></Field>
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || (!v.mobile && !v.email)} data-testid="pc-send">{t('profile.send')}</button></div>
      </form>
      <h2>{t('profile.mine')}</h2>
      {q.isPending ? <Skeleton label={t('profile.mine')} rows={2} /> : q.isError ? <ErrorState error={q.error} onRetry={q.refetch} /> : q.data.length === 0 ? <p className="muted" data-testid="pc-none">{t('profile.none')}</p> : (
        <ul className="mdm-list" data-testid="pc-list">{q.data.map((c) => <li key={c.id} data-status={c.status}>{c.type.toLowerCase()} · {c.effectiveDate} · <StatusBadge status={TONE[c.status] ?? 'IN_REVIEW'} label={c.status.toLowerCase()} /> {Object.entries(c.summary ?? {}).map(([k, x]) => `${k}: ${x}`).join('; ')}</li>)}</ul>
      )}
      <p className="small"><Link to="/my-hr">{t('home.title')}</Link></p>
    </section>
  );
}
