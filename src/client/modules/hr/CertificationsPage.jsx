import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { LookupField } from '../../platform/forms/LookupField.jsx';
import ListReport from '../../platform/list/ListReport.jsx';
import { Field, Link, errorInfo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { dayIST, trn } from './api.js';

// Certifications & Licences (HR, part 07.10, FR-03): the register of the certificates and licences of employees and workers (operator licences, safety tickets, welding certificates) with the filters for what has expired, what ends soon
// and what nobody has verified. Recording a certificate is open to HR and to each person for their own; a certificate counts for a check (permits, operator assignment, deployment) only when somebody else has verified it.
export default function CertificationsPage() {
  const t = useT('trn');
  usePageTitle(t('cert.title'));
  const qc = useQueryClient();
  const session = useSession();
  const perms = session.data?.permissions ?? [];
  const [adding, setAdding] = useState(false); const [note, setNote] = useState(null); const [error, setError] = useState(null);
  const run = async (fn, done) => { setError(null); setNote(null); try { await fn(); setNote(done); qc.invalidateQueries({ queryKey: ['ui', 'list'] }); qc.invalidateQueries({ queryKey: ['trn'] }); } catch (e) { setError(errorInfo(e)); } };
  return (
    <section aria-labelledby="cr-title" data-testid="certifications">
      <h1 id="cr-title" className="sr-only">{t('cert.title')}</h1>
      {error?.form && <p className="field-error" role="alert" data-testid="cr-error">{error.form}</p>}
      {note && <p className="mdm-banner" role="status" data-testid="cr-note">{note}</p>}
      <ListReport listCode="hr.certifications" endpoint="/hr/training/certs" title={t('cert.title')} session={session.data}
        cardFields={['person', 'certType', 'validUntil', 'state']} statusKey="state"
        newAction={perms.includes('hr.cert.create') || perms.includes('hr.training.own') ? { label: t('cert.record'), onClick: () => setAdding(true) } : undefined}
        rowActions={(r) => [
          { label: t('cert.verify'), disabled: !r.can?.verify, onSelect: () => run(() => trn.verifyCert(r.id), t('cert.verified')) },
          { label: t('cert.revoke'), disabled: !r.can?.revoke, onSelect: () => { const why = window.prompt(t('cert.why')); if (why) run(() => trn.revokeCert(r.id, why), t('cert.revoked')); } },
          { label: t('cert.delete'), disabled: !r.can?.delete, onSelect: () => run(() => trn.removeCert(r.id), t('cert.deleted')) },
        ]}
        empty={{ title: t('cert.emptyTitle'), text: t('cert.emptyText') }} />
      {adding && <CertForm close={() => setAdding(false)} done={(m) => { setNote(m); qc.invalidateQueries({ queryKey: ['ui', 'list'] }); }} />}
      <p className="small"><Link to="/training/compliance">{t('comp.title')}</Link> · <Link to="/training/skills">{t('skill.title')}</Link></p>
    </section>
  );
}

export function CertForm({ close, done, own = null }) {
  const t = useT('trn');
  const types = useQuery({ queryKey: ['trn', 'cert-types'], queryFn: trn.certTypes, retry: false });
  const [v, setV] = useState({ kind: 'EMPLOYEE', personId: own ? String(own) : '', certType: '', number: '', issuer: '', validFrom: dayIST(0), validUntil: '' });
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (p) => setV((x) => ({ ...x, ...p }));
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { const c = await trn.createCert({ personType: v.kind, personId: Number(v.personId), certType: v.certType, number: v.number.trim() || null, issuer: v.issuer.trim() || null, validFrom: v.validFrom, validUntil: v.validUntil || null, fileId: null }); done(t('cert.saved', { name: c.certName })); close(); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <form className="mdm-panel mdm-fields" onSubmit={go} data-testid="cert-form" aria-label={t('cert.record')}>
      {!own && <label>{t('ses.kind')} <select value={v.kind} onChange={(e) => set({ kind: e.target.value, personId: '' })} data-testid="cf-kind"><option value="EMPLOYEE">{t('ses.employee')}</option><option value="WORKER">{t('ses.worker')}</option></select></label>}
      {!own && <LookupField id={`cf-person-${v.kind}`} label={t('ses.person')} lookup={v.kind === 'EMPLOYEE' ? 'hr/employees' : 'hr/workers'} value={v.personId} onChange={(x) => set({ personId: x })} error={error?.fields?.personId} required />}
      <Field label={t('cert.type')} name="certType" error={error}><select value={v.certType} onChange={(e) => set({ certType: e.target.value })} required data-testid="cf-type"><option value="">{t('s.pick')}</option>{(types.data ?? []).map((x) => <option key={x.code} value={x.code}>{x.name}</option>)}</select></Field>
      <Field label={t('cert.number')} name="number" error={error}><input value={v.number} maxLength={60} onChange={(e) => set({ number: e.target.value })} data-testid="cf-number" /></Field>
      <Field label={t('cert.issuer')} name="issuer" error={error}><input value={v.issuer} maxLength={100} onChange={(e) => set({ issuer: e.target.value })} data-testid="cf-issuer" /></Field>
      <Field label={t('cert.from')} name="validFrom" error={error}><input type="date" value={v.validFrom} onChange={(e) => set({ validFrom: e.target.value })} required data-testid="cf-from" /></Field>
      <Field label={t('cert.until')} name="validUntil" error={error} hint={t('cert.untilHint')}><input type="date" value={v.validUntil} onChange={(e) => set({ validUntil: e.target.value })} data-testid="cf-until" /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="cf-error">{error.form}</p>}
      <div className="actions"><button type="button" className="btn" onClick={close}>{t('act.close')}</button><button type="submit" className="btn btn-primary" disabled={busy || !v.personId || !v.certType} data-testid="cf-save">{t('act.save')}</button></div>
    </form>
  );
}
