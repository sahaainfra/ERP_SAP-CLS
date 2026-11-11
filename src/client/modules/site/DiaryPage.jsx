import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, Link, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { useSession } from '../core/api/index.js';
import { DIARY_CATEGORIES, fmtDate, st, today } from './api.js';
import { useSearch } from './parts.jsx';

// Site Diary (part 14.03, FR-03): the free-form notes of a site and day with a category and attachments; the construction manager signs them off (never the person who wrote them) and a signed note is locked.
function Entry({ t, id, onGone }) {
  const qc = useQueryClient(); const q = useQuery({ queryKey: ['site', 'diary-entry', id], queryFn: () => st.diaryEntry(id), retry: false });
  const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const [up, setUp] = useState(0); const [draft, setDraft] = useState(null); const [note, setNote] = useState(null);
  if (q.error?.status === 403) return <NoPermission what={t('cnd.diary.title')} permission="site.diary.view" />;
  if (q.isPending) return <Skeleton label={t('cnd.diary.title')} rows={4} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const e = q.data; const can = e.can; const refresh = () => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };
  const run = async (fn, done) => { setError(null); setNote(null); setBusy(true); try { const x = await fn(); if (done) setNote(done); refresh(); return x; } catch (x) { setError(errorInfo(x)); return null; } finally { setBusy(false); } };
  const d = draft ?? { category: e.category, text: e.text };
  return (
    <div data-testid="diary-object" data-signed={e.signed ? '1' : '0'}>
      <h1 id="diary-h">{fmtDate(e.date)} · {e.siteCode} · {t(`cnd.diary.c.${e.category}`)} <StatusBadge status={e.signed ? 'APPROVED' : 'DRAFT'} label={e.signed ? t('cnd.diary.signed') : t('cnd.diary.notSigned')} /></h1>
      <p><Link to="/site/diary">{t('cnd.diary.back')}</Link> · {t('cnd.diary.by')} {e.enteredBy}{e.signed ? ` · ${t('cnd.diary.signedBy')} ${e.signedBy}` : ''}</p>
      {error?.form && <p className="field-error" role="alert" data-testid="diary-obj-error">{error.form}</p>}{note && <p className="mdm-banner" role="status">{note}</p>}
      {can.edit ? (
        <form className="mdm-panel" onSubmit={(ev) => { ev.preventDefault(); run(() => st.updateDiary(e.id, { category: d.category, text: d.text.trim(), rowVersion: e.rowVersion }), t('cnd.saved')).then(() => setDraft(null)); }}>
          <div className="form-grid"><Field label={t('cnd.diary.category')} name="category" error={error}><select value={d.category} onChange={(x) => setDraft({ ...d, category: x.target.value })}>{DIARY_CATEGORIES.map((c) => <option key={c} value={c}>{t(`cnd.diary.c.${c}`)}</option>)}</select></Field></div>
          <Field label={t('cnd.diary.text')} name="text" error={error}><textarea rows={5} value={d.text} maxLength={4000} onChange={(x) => setDraft({ ...d, text: x.target.value })} data-testid="diary-edit-text" /></Field>
          <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={busy} data-testid="diary-edit-save">{t('act.save')}</button></div>
        </form>
      ) : <div className="mdm-panel"><p style={{ whiteSpace: 'pre-wrap' }} data-testid="diary-text">{e.text}</p>{e.signed && <p className="muted" data-testid="diary-locked">{t('cnd.diary.locked')}</p>}</div>}
      <div className="actions-row no-print">
        {can.sign && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(() => st.signDiary(e.id), t('cnd.diary.signedNote'))} data-testid="diary-sign">{t('cnd.diary.sign')}</button>}
        {can.delete && <button type="button" className="btn" disabled={busy} onClick={async () => { if (window.confirm(t('cnd.diary.deleteAsk')) && await run(() => st.removeDiary(e.id))) onGone(); }} data-testid="diary-delete">{t('act.delete')}</button>}
      </div>
      <div className="mdm-panel" data-testid="diary-attachments"><h2>{t('cnd.diary.attachments')} ({e.attachments})</h2>
        {can.attach && <FileUploader entity="site_diary" entityId={e.id} onDone={() => { setUp((n) => n + 1); refresh(); }} />}
        <AttachmentList key={up} entity="site_diary" entityId={e.id} canEdit={can.attach} />
      </div>
    </div>
  );
}

function NewEntry({ t, sites, onSaved }) {
  const [f, setF] = useState({ siteId: sites.length === 1 ? sites[0].id : null, date: today(), category: 'GENERAL', text: '' }); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const save = async (e) => { e.preventDefault(); setError(null); if (!f.siteId) { setError({ form: t('f.chooseSite'), fields: { siteId: t('f.chooseSite') } }); return; } setBusy(true); try { const x = await st.createDiary({ ...f, text: f.text.trim() }); setF((v) => ({ ...v, text: '' })); onSaved(x); } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); } };
  return (
    <form className="mdm-panel no-print" onSubmit={save} aria-label={t('cnd.diary.new')} data-testid="diary-form">
      <h2>{t('cnd.diary.new')}</h2>
      <div className="form-grid">
        <Field label={t('f.site')} name="siteId" error={error}><select value={f.siteId ?? ''} onChange={(e) => set('siteId', e.target.value ? Number(e.target.value) : null)} data-testid="diary-site"><option value="">{t('f.chooseSite')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code} {s.name}</option>)}</select></Field>
        <Field label={t('f.date')} name="date" error={error}><input type="date" value={f.date} max={today()} onChange={(e) => e.target.value && set('date', e.target.value)} data-testid="diary-date" /></Field>
        <Field label={t('cnd.diary.category')} name="category" error={error}><select value={f.category} onChange={(e) => set('category', e.target.value)} data-testid="diary-category">{DIARY_CATEGORIES.map((c) => <option key={c} value={c}>{t(`cnd.diary.c.${c}`)}</option>)}</select></Field>
      </div>
      <Field label={t('cnd.diary.text')} name="text" error={error}><textarea rows={3} value={f.text} maxLength={4000} onChange={(e) => set('text', e.target.value)} data-testid="diary-text-input" /></Field>
      {error?.form && <p className="field-error" role="alert" data-testid="diary-error">{error.form}{error.correlationId ? ` (${error.correlationId})` : ''}</p>}
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={busy} data-testid="diary-save">{t('cnd.diary.add')}</button></div>
    </form>
  );
}

function SignDay({ t, sites, onDone }) {
  const [f, setF] = useState({ siteId: sites.length === 1 ? sites[0].id : '', date: today() }); const [msg, setMsg] = useState(null); const [error, setError] = useState(null);
  return (
    <form className="mdm-panel no-print" aria-label={t('cnd.diary.signDay')} data-testid="diary-signday" onSubmit={async (e) => { e.preventDefault(); setError(null); setMsg(null); try { const r = await st.signDay({ siteId: Number(f.siteId), date: f.date }); setMsg(t('cnd.diary.signedN', { n: r.signed })); onDone(); } catch (x) { setError(errorInfo(x)); } }}>
      <h2>{t('cnd.diary.signDay')}</h2><p className="muted">{t('cnd.diary.signDayHelp')}</p>
      <div className="form-grid"><Field label={t('f.site')} name="sd-site"><select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })} data-testid="diary-sd-site"><option value="">{t('f.chooseSite')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code}</option>)}</select></Field>
        <Field label={t('f.date')} name="sd-date"><input type="date" value={f.date} max={today()} onChange={(e) => e.target.value && setF({ ...f, date: e.target.value })} /></Field></div>
      {error?.form && <p className="field-error" role="alert">{error.form}</p>}{msg && <p className="mdm-banner" role="status" data-testid="diary-sd-note">{msg}</p>}
      <button type="submit" className="btn" disabled={!f.siteId} data-testid="diary-sd-go">{t('cnd.diary.signDay')}</button>
    </form>
  );
}

export default function DiaryPage() {
  const t = useT('site'); usePageTitle(t('cnd.diary.title'));
  const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? []; const qc = useQueryClient();
  const sitesQ = useQuery({ queryKey: ['site', 'diary-sites'], queryFn: st.diarySites, retry: false });
  if (id) return <section aria-labelledby="diary-h" data-testid="site-diary"><Entry key={id} t={t} id={id} onGone={() => navigateTo('/site/diary')} /></section>;
  if (sitesQ.error?.status === 403) return <NoPermission what={t('cnd.diary.title')} permission="site.diary.view" />;
  if (sitesQ.isPending) return <Skeleton label={t('cnd.diary.title')} rows={5} />;
  if (sitesQ.isError) return <ErrorState error={sitesQ.error} onRetry={sitesQ.refetch} />;
  const sites = sitesQ.data; const refresh = () => { qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); };
  return (
    <section aria-labelledby="diary-h" data-testid="site-diary">
      <h1 id="diary-h">{t('cnd.diary.title')}</h1><p className="muted">{t('cnd.diary.intro')}</p>
      {perms.includes('site.diary.create') && <NewEntry t={t} sites={sites.filter((s) => s.canCreate)} onSaved={refresh} />}
      {perms.includes('site.diary.sign') && <SignDay t={t} sites={sites} onDone={refresh} />}
      <ListReport listCode="site.diary" endpoint="/site/diary" title={t('cnd.diary.title')} session={session.data} rowHref={(r) => `/site/diary?id=${r.id}`} onOpen={(r) => navigateTo(`/site/diary?id=${r.id}`)}
        cardFields={['date', 'site', 'category', 'text', 'signed']}
        empty={{ title: t('cnd.diary.emptyTitle'), text: t('cnd.diary.emptyBody') }} />
    </section>
  );
}
