import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { REQ_STATUS, ess } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Letter Request (HR, part 07.09, FR-03): an employee asks for an employment, salary or no-objection certificate and says what it is for; the HR manager approves and HR issues it from the template library, with a number and a QR
// to verify it; the employee downloads it here. HR sees the approved requests that wait to be issued (a salary certificate states the gross salary HR gives).
const TONE = { ISSUED: 'COMPLETED' };
export default function LetterRequestPage() {
  const t = useT('ess');
  usePageTitle(t('letter.title'));
  const qc = useQueryClient();
  const session = useSession();
  const hr = (session.data?.permissions ?? []).includes('hr.ess.issue');
  const [v, setV] = useState({ letterType: 'EMPLOYMENT', purpose: '', addressedTo: '' });
  const [error, setError] = useState(null); const [note, setNote] = useState(null); const [busy, setBusy] = useState(false); const [salary, setSalary] = useState({});
  const mine = useQuery({ queryKey: ['ess', 'letters', 'mine'], queryFn: () => ess.letters('mine'), retry: false });
  const queue = useQuery({ queryKey: ['ess', 'letters', 'all'], queryFn: () => ess.letters('all'), enabled: hr, retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['ess'] });
  const save = async (submit) => {
    setBusy(true); setError(null); setNote(null);
    try { const out = await ess.createLetter({ letterType: v.letterType, purpose: v.purpose.trim(), addressedTo: v.addressedTo.trim() || null, submit }); setNote(t(submit ? 'letter.sent' : 'letter.saved', { no: out.docNo })); setV({ ...v, purpose: '', addressedTo: '' }); refresh(); } catch (e) { setError(errorInfo(e)); } finally { setBusy(false); }
  };
  const act = async (fn, done) => { setError(null); setNote(null); try { await fn(); if (done) setNote(done); refresh(); } catch (e) { setError(errorInfo(e)); } };
  const row = (r, issue) => (
    <tr key={r.id} data-testid={issue ? 'lq-row' : 'lr-row'} data-status={r.status}>
      <th scope="row" data-label="No">{r.docNo}</th><td data-label={t('letter.type')}>{t(`letter.${r.letterType}`)}{issue ? ` · ${r.employee}` : ''}</td><td data-label={t('letter.purpose')}>{r.purpose}</td>
      <td data-label="Status"><StatusBadge status={TONE[r.status] ?? (REQ_STATUS[r.status] ?? [r.status])[0]} label={r.statusLabel} /></td>
      <td data-label="">
        {r.can.submit && <button type="button" className="btn btn-small" onClick={() => act(() => ess.submitLetter(r.id), t('letter.sent', { no: r.docNo }))} data-testid="lr-submit">{t('letter.send')}</button>}{' '}
        {r.can.delete && <button type="button" className="btn btn-small" onClick={() => act(() => ess.removeLetter(r.id))} data-testid="lr-delete">×</button>}{' '}
        {r.can.withdraw && <button type="button" className="btn btn-small" onClick={() => { const w = window.prompt('Why? (at least 5 characters)'); if (w) act(() => ess.withdrawLetter(r.id, w)); }} data-testid="lr-withdraw">↩</button>}{' '}
        {r.can.download && <a className="btn btn-small" href={`/api/v1/hr/ess/letters/${r.id}/content`} target="_blank" rel="noreferrer" data-testid="lr-download">{t('letter.download')}</a>}
        {issue && r.can.issue && <>{r.letterType === 'SALARY' && <input type="number" min="1" aria-label="Gross monthly salary" placeholder="₹ / month" value={salary[r.id] ?? ''} onChange={(e) => setSalary({ ...salary, [r.id]: e.target.value })} data-testid="lq-salary" />} <button type="button" className="btn btn-small btn-primary" onClick={() => act(() => ess.issueLetter(r.id, r.letterType === 'SALARY' ? { salaryMonthly: Number(salary[r.id]) } : {}), `${r.docNo} issued.`)} data-testid="lq-issue">Issue</button></>}
      </td>
    </tr>
  );
  const head = <thead><tr><th>No</th><th>{t('letter.type')}</th><th>{t('letter.purpose')}</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>;
  return (
    <section aria-labelledby="lr-title" data-testid="letters">
      <PageHeader id="lr-title" title={t('letter.title')} subtitle={t('letter.intro')} />
      {error?.form && <p className="field-error" role="alert" data-testid="lr-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="lr-note">{note}</p>}
      <form className="mdm-fields" onSubmit={(e) => { e.preventDefault(); save(false); }}>
        <Field label={t('letter.type')} name="letterType" error={error}><select value={v.letterType} onChange={(e) => setV({ ...v, letterType: e.target.value })} data-testid="lr-type">{['EMPLOYMENT', 'SALARY', 'NOC'].map((k) => <option key={k} value={k}>{t(`letter.${k}`)}</option>)}</select></Field>
        <Field label={t('letter.purpose')} name="purpose" error={error}><textarea rows="2" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value })} data-testid="lr-purpose" /></Field>
        <Field label={t('letter.addressed')} name="addressedTo" error={error}><input value={v.addressedTo} maxLength={150} onChange={(e) => setV({ ...v, addressedTo: e.target.value })} data-testid="lr-to" /></Field>
        <div className="actions"><button type="button" className="btn" disabled={busy} onClick={() => save(false)} data-testid="lr-save">{t('letter.save')}</button><button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)} data-testid="lr-send">{t('letter.send')}</button></div>
      </form>
      <h2>{t('letter.mine')}</h2>
      {mine.isPending ? <Skeleton label={t('letter.mine')} rows={2} /> : mine.isError ? <ErrorState error={mine.error} onRetry={mine.refetch} /> : mine.data.length === 0 ? <p className="muted" data-testid="lr-none">{t('letter.none')}</p> : <div className="table-wrap" tabIndex={0} role="region" aria-label={t('letter.mine')}><table className="grid" data-testid="lr-table">{head}<tbody>{mine.data.map((r) => row(r, false))}</tbody></table></div>}
      {hr && (
        <>
          <h2>HR</h2>
          {queue.isPending ? <Skeleton label="HR" rows={2} /> : queue.isError ? <ErrorState error={queue.error} onRetry={queue.refetch} /> : <div className="table-wrap" tabIndex={0} role="region" aria-label="Requests of everyone"><table className="grid" data-testid="lq-table">{head}<tbody>{queue.data.map((r) => row(r, true))}</tbody></table></div>}
        </>
      )}
      <p className="small"><Link to="/my-hr">{t('home.title')}</Link></p>
    </section>
  );
}
