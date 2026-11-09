import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { LETTER_CATS, dayIST, lt } from './api.js';
import { ProjectSelect, useSearch } from './parts.jsx';

// Draft Outward Letter from template (part 11.05, FR-02): a standard text fills the subject and the body from the letter it answers; the letter is saved as a draft and sent for approval from its page.
export default function LetterDraftPage() {
  const t = useT('engg');
  usePageTitle(t('draft.title'));
  const qc = useQueryClient();
  const params = useSearch(); const parent = Number(params.get('parent')) || null; const pid = Number(params.get('projectId')) || '';
  const tq = useQuery({ queryKey: ['engg', 'letter-templates'], queryFn: lt.templates, retry: false });
  const [f, setF] = useState({ projectId: pid, templateCode: '', party: '', subject: '', category: 'OTHER', clauseRef: '', contractual: false, bodyText: '', parentLetterId: parent, timeBarId: '' });
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const bars = useQuery({ queryKey: ['engg', 'letter-bars', f.projectId], queryFn: () => lt.bars(f.projectId), enabled: Boolean(f.projectId), retry: false });
  useEffect(() => { if (parent && pid && !f.templateCode) set('templateCode', 'ACKNOWLEDGE'); }, [parent, pid]);
  const fill = async (code) => {
    set('templateCode', code); if (!code || !f.projectId) return; setError(null);
    try { const r = await lt.render({ projectId: Number(f.projectId), templateCode: code, parentLetterId: f.parentLetterId || null, clauseRef: f.clauseRef.trim() || null }); setF((x) => ({ ...x, templateCode: code, subject: r.subject, bodyText: r.body, category: r.category, party: x.party || r.party || '', clauseRef: x.clauseRef || r.clauseRef || '', contractual: r.category === 'NOTICE' ? true : x.contractual })); } catch (e) { setError(errorInfo(e)); }
  };
  const save = async (e) => {
    e.preventDefault(); setError(null); setBusy(true);
    try { const r = await lt.create({ projectId: Number(f.projectId), direction: 'OUT', letterDate: dayIST(), party: f.party.trim(), subject: f.subject.trim(), category: f.category, clauseRef: f.clauseRef.trim() || null, contractual: f.contractual, bodyText: f.bodyText, templateCode: f.templateCode || null, parentLetterId: f.parentLetterId || null, timeBarId: f.timeBarId ? Number(f.timeBarId) : null }); qc.invalidateQueries({ queryKey: ['engg'] }); navigateTo(`/engg/letter?id=${r.id}`); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  return (
    <section aria-labelledby="draft-h" data-testid="letter-draft">
      <h1 id="draft-h">{t('draft.title')}</h1>
      <form className="mdm-panel" onSubmit={save} data-testid="draft-form">
        <div className="form-grid">
          <ProjectSelect value={f.projectId} onChange={(v) => set('projectId', v)} required testId="draft-project" error={error} />
          <Field label={t('draft.template')} name="templateCode" error={error}><select value={f.templateCode} onChange={(e) => fill(e.target.value)} data-testid="draft-template"><option value="">—</option>{(tq.data ?? []).map((x) => <option key={x.code} value={x.code}>{t(`ltpl.${x.code}`)}</option>)}</select></Field>
          <Field label={t('letter.party')} name="party" error={error}><input value={f.party} onChange={(e) => set('party', e.target.value)} required maxLength={160} data-testid="draft-party" /></Field>
          <Field label={t('letter.subject')} name="subject" error={error}><input value={f.subject} onChange={(e) => set('subject', e.target.value)} required maxLength={300} data-testid="draft-subject" /></Field>
          <Field label={t('letter.category')} name="category" error={error}><select value={f.category} onChange={(e) => set('category', e.target.value)} data-testid="draft-category">{LETTER_CATS.map((k) => <option key={k} value={k}>{t(`lcat.${k}`)}</option>)}</select></Field>
          <Field label={t('letter.clause')} name="clauseRef" error={error}><input value={f.clauseRef} onChange={(e) => set('clauseRef', e.target.value)} maxLength={120} data-testid="draft-clause" /></Field>
          <Field label={t('tb.serves')} name="timeBarId" error={error}><select value={f.timeBarId} onChange={(e) => set('timeBarId', e.target.value)} data-testid="draft-timebar"><option value="">—</option>{(bars.data?.rows ?? []).filter((b) => b.status === 'OPEN').map((b) => <option key={b.id} value={b.id}>{b.barNo} · {b.deadline} · {b.description.slice(0, 40)}</option>)}</select></Field>
          <Field label={t('letter.body')} name="bodyText" error={error}><textarea value={f.bodyText} onChange={(e) => set('bodyText', e.target.value)} rows={10} maxLength={20000} data-testid="draft-body" /></Field>
        </div>
        <label><input type="checkbox" checked={f.contractual} onChange={(e) => set('contractual', e.target.checked)} data-testid="draft-contractual" /> {t('letter.contractualNotice')}</label>
        {error?.form && <p className="field-error" role="alert" data-testid="draft-error">{error.form}{error.fields ? ` ${Object.values(error.fields).slice(0, 4).join('; ')}` : ''}</p>}
        <div className="actions"><button type="submit" className="btn btn-primary" disabled={busy || !f.projectId || f.party.trim().length < 2 || f.subject.trim().length < 3} data-testid="draft-save">{t('draft.save')}</button></div>
      </form>
    </section>
  );
}
