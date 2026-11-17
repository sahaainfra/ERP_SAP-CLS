import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, errorInfo, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { INS_TYPES, st, today } from './api.js';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Issue Instruction (part 14.04, mobile form): a received instruction is registered, an internal instruction or memo is issued to subcontractors and crews; with a back-charge it goes for approval. The server
// checks every rule again; the form only mirrors the ones that need no data (a back-charge needs a subcontractor, an internal instruction needs recipients).
const big = { minHeight: 44 };
const blank = (siteId) => ({ siteId, type: 'ISI', date: today(), theirRef: '', fromParty: '', toParty: '', subject: '', description: '', dueDate: '', locationId: '', activityId: '', costImplication: false, timeImplication: false, backcharge: false, backchargeAmount: '', backchargePartnerId: '', letterId: '', subs: [], crews: [], person: '' });
const fromRecord = (d) => ({ siteId: d.siteId, type: d.type, date: d.date, theirRef: d.theirRef ?? '', fromParty: d.fromParty, toParty: d.toParty ?? '', subject: d.subject, description: d.description ?? '', dueDate: d.dueDate ?? '', locationId: d.locationId ?? '', activityId: d.activityId ?? '', costImplication: d.costImplication, timeImplication: d.timeImplication, backcharge: d.backcharge, backchargeAmount: d.backchargeAmount ?? '', backchargePartnerId: d.backchargePartnerId ?? '', letterId: d.letterId ?? '',
  subs: (d.partiesPlanned ?? []).filter((p) => p.type === 'SUBCONTRACTOR').map((p) => p.id), crews: (d.partiesPlanned ?? []).filter((p) => p.type === 'CREW').map((p) => p.id), person: (d.partiesPlanned ?? []).find((p) => p.type === 'PERSON')?.name ?? '' });
const toggle = (a, v) => (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]);
const num = (v) => (v === '' ? null : Number(v));
const payload = (f, withKey) => {
  const rec = f.type === 'EI' || f.type === 'CI'; const parties = rec ? [] : [...f.subs.map((id) => ({ type: 'SUBCONTRACTOR', id })), ...f.crews.map((id) => ({ type: 'CREW', id })), ...(f.person.trim() ? [{ type: 'PERSON', name: f.person.trim() }] : [])];
  return { ...(withKey ? { siteId: f.siteId, type: f.type } : {}), date: f.date, theirRef: f.theirRef.trim() || null, fromParty: f.fromParty.trim(), toParty: f.toParty.trim() || null, subject: f.subject.trim(), description: f.description.trim() || null, dueDate: f.dueDate || null, locationId: f.locationId ? Number(f.locationId) : null, activityId: f.activityId ? Number(f.activityId) : null,
    costImplication: f.costImplication, timeImplication: f.timeImplication, backcharge: !rec && f.type === 'ISI' && f.backcharge, backchargeAmount: f.backcharge ? num(f.backchargeAmount) : null, backchargePartnerId: f.backcharge && f.backchargePartnerId ? Number(f.backchargePartnerId) : null, letterId: f.letterId ? Number(f.letterId) : null, parties };
};

export function InstructionForm({ t, editing, onSaved, onCancel }) {
  const qc = useQueryClient(); const sitesQ = useQuery({ queryKey: ['site', 'ins-sites'], queryFn: st.insSites, retry: false });
  const [f, setF] = useState(editing ? fromRecord(editing) : null); const [error, setError] = useState(null); const [busy, setBusy] = useState(false);
  const sites = (sitesQ.data ?? []).filter((s) => s.canCreate || editing); const siteId = f?.siteId ?? (sites.length === 1 ? sites[0].id : null);
  const oq = useQuery({ queryKey: ['site', 'ins-options', siteId], queryFn: () => st.insOptions(siteId), enabled: Boolean(siteId), retry: false });
  if (sitesQ.error?.status === 403) return <NoPermission what={t('cnd.ins.issueTitle')} permission="site.instruction.view" />;
  if (sitesQ.isPending) return <Skeleton label={t('cnd.ins.issueTitle')} rows={5} />;
  if (sitesQ.isError) return <ErrorState error={sitesQ.error} onRetry={sitesQ.refetch} />;
  const form = f ?? blank(siteId); const set = (k, v) => setF({ ...form, siteId, [k]: v }); const o = oq.data; const rec = form.type === 'EI' || form.type === 'CI';
  const save = async (andSend) => {
    setError(null); if (!siteId) { setError({ form: t('f.chooseSite'), fields: { siteId: t('f.chooseSite') } }); return; } setBusy(true);
    try {
      let d = editing ? await st.updateInstruction(editing.id, { ...payload(form, false), rowVersion: editing.rowVersion }) : await st.createInstruction(payload({ ...form, siteId }, true));
      if (andSend) d = await st.insAct(d.id, 'submit'); qc.invalidateQueries({ queryKey: ['site'] }); qc.invalidateQueries({ queryKey: ['list'] }); onSaved(d);
    } catch (x) { setError(errorInfo(x)); } finally { setBusy(false); }
  };
  const sendLabel = rec ? t('cnd.ins.register') : form.backcharge ? t('act.submit') : t('cnd.ins.issue');
  return (
    <form className="mdm-panel" onSubmit={(e) => { e.preventDefault(); save(false); }} aria-label={editing ? t('cnd.ins.edit') : t('cnd.ins.issueTitle')} data-testid="ins-form">
      <h2>{editing ? t('cnd.ins.edit') : t('cnd.ins.issueTitle')}</h2>
      <fieldset><legend>{t('cnd.ins.secWhat')}</legend>
        <div className="form-grid">
          <Field label={t('f.site')} name="siteId" error={error}><select style={big} value={siteId ?? ''} disabled={Boolean(editing)} onChange={(e) => setF({ ...form, siteId: e.target.value ? Number(e.target.value) : null, locationId: '', activityId: '', letterId: '', subs: [], crews: [], backchargePartnerId: '' })} data-testid="ins-site"><option value="">{t('f.chooseSite')}</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.projectCode} · {s.code} {s.name}</option>)}</select></Field>
          <Field label={t('cnd.ins.type')} name="type" error={error}><select style={big} value={form.type} disabled={Boolean(editing)} onChange={(e) => set('type', e.target.value)} data-testid="ins-type">{INS_TYPES.map((x) => <option key={x} value={x}>{t(`cnd.ins.t.${x}`)}</option>)}</select></Field>
          <Field label={t('f.date')} name="date" error={error}><input style={big} type="date" value={form.date} max={today()} onChange={(e) => e.target.value && set('date', e.target.value)} data-testid="ins-date" /></Field>
          {rec && <Field label={t('cnd.ins.theirRef')} name="theirRef" error={error}><input style={big} value={form.theirRef} maxLength={80} onChange={(e) => set('theirRef', e.target.value)} data-testid="ins-ref" /></Field>}
          <Field label={t('cnd.ins.from')} name="fromParty" error={error}><input style={big} value={form.fromParty} maxLength={160} onChange={(e) => set('fromParty', e.target.value)} data-testid="ins-from" /></Field>
          <Field label={t('cnd.ins.to')} name="toParty" error={error}><input style={big} value={form.toParty} maxLength={160} onChange={(e) => set('toParty', e.target.value)} data-testid="ins-to" /></Field>
        </div>
        <Field label={t('cnd.ins.subject')} name="subject" error={error}><input style={big} value={form.subject} maxLength={200} onChange={(e) => set('subject', e.target.value)} data-testid="ins-subject" /></Field>
        <Field label={t('cnd.hin.description')} name="description" error={error}><textarea rows={4} value={form.description} maxLength={4000} onChange={(e) => set('description', e.target.value)} data-testid="ins-desc" /></Field>
        <div className="form-grid">
          <Field label={t('cnd.ins.location')} name="locationId" error={error}><select style={big} value={form.locationId} onChange={(e) => set('locationId', e.target.value)}><option value="">—</option>{(o?.locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
          <Field label={t('cnd.ins.activity')} name="activityId" error={error}><select style={big} value={form.activityId} onChange={(e) => set('activityId', e.target.value)}><option value="">—</option>{(o?.activities ?? []).map((l) => <option key={l.id} value={l.id}>{l.code} {l.name}</option>)}</select></Field>
          <Field label={t('cnd.ins.due')} name="dueDate" error={error}><input style={big} type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} data-testid="ins-due" /></Field>
          <Field label={t('cnd.hin.letter')} name="letterId" error={error}><select style={big} value={form.letterId} onChange={(e) => set('letterId', e.target.value)} data-testid="ins-letter"><option value="">{t('cnd.hin.noLetter')}</option>{(o?.letters ?? []).map((l) => <option key={l.id} value={l.id}>{l.letterNo} · {l.subject}</option>)}</select></Field>
        </div>
        <label className="field" style={{ minHeight: 44 }}><input type="checkbox" checked={form.costImplication} onChange={(e) => set('costImplication', e.target.checked)} data-testid="ins-cost" /> <span>{t('cnd.ins.cost')}</span></label>
        <label className="field" style={{ minHeight: 44 }}><input type="checkbox" checked={form.timeImplication} onChange={(e) => set('timeImplication', e.target.checked)} data-testid="ins-time" /> <span>{t('cnd.ins.time')}</span></label>
        {rec && (form.costImplication || form.timeImplication) && <p className="muted" data-testid="ins-notice-help">{t('cnd.ins.noticeHelp', { n: o?.noticeDays ?? 7 })}</p>}
      </fieldset>
      {!rec && (
        <fieldset><legend>{t('cnd.ins.recipients')}</legend>
          {o && o.subcontractors.length > 0 && <div style={{ maxHeight: 160, overflow: 'auto' }}>{o.subcontractors.map((s) => <label key={s.id} style={{ display: 'block', minHeight: 36 }}><input type="checkbox" checked={form.subs.includes(s.id)} onChange={() => set('subs', toggle(form.subs, s.id))} data-testid={`ins-sub-${s.id}`} /> {s.name}</label>)}</div>}
          {o && o.crews.length > 0 && <div>{o.crews.map((s) => <label key={s.id} style={{ display: 'block', minHeight: 36 }}><input type="checkbox" checked={form.crews.includes(s.id)} onChange={() => set('crews', toggle(form.crews, s.id))} /> {s.code} {s.name}</label>)}</div>}
          <Field label={t('cnd.ins.person')} name="parties" error={error}><input style={big} value={form.person} maxLength={160} onChange={(e) => set('person', e.target.value)} data-testid="ins-person" /></Field>
        </fieldset>
      )}
      {form.type === 'ISI' && (
        <fieldset><legend>{t('cnd.ins.backcharge')}</legend>
          <label className="field" style={{ minHeight: 44 }}><input type="checkbox" checked={form.backcharge} onChange={(e) => set('backcharge', e.target.checked)} data-testid="ins-bc" /> <span>{t('cnd.ins.backchargeTick')}</span></label>
          {form.backcharge && <div className="form-grid">
            <Field label={t('cnd.ins.chargeTo')} name="backchargePartnerId" error={error}><select style={big} value={form.backchargePartnerId} onChange={(e) => set('backchargePartnerId', e.target.value)} data-testid="ins-bc-partner"><option value="">—</option>{(o?.subcontractors ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            {(o?.canCost ?? true) && <Field label={t('cnd.ins.amount')} name="backchargeAmount" error={error}><input style={big} type="number" min="0" step="0.01" inputMode="decimal" value={form.backchargeAmount} onChange={(e) => set('backchargeAmount', e.target.value)} data-testid="ins-bc-amount" /></Field>}
          </div>}
          {form.backcharge && <p className="muted">{t('cnd.ins.backchargeHelp')}</p>}
        </fieldset>
      )}
      {error?.form && <p className="field-error" role="alert" data-testid="ins-error">{error.form}{error.correlationId ? ` (${error.correlationId})` : ''}</p>}
      <div className="actions-row">
        <button type="submit" className="btn" style={{ minHeight: 48 }} disabled={busy} data-testid="ins-save">{t('cnd.ins.saveDraft')}</button>
        <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => save(true)} data-testid="ins-send">{sendLabel}</button>
        <button type="button" className="btn" style={{ minHeight: 48 }} onClick={onCancel}>{t('cnd.close')}</button>
      </div>
    </form>
  );
}

export default function InstructionIssuePage() {
  const t = useT('site'); usePageTitle(t('cnd.ins.issueTitle'));
  return (
    <section data-testid="site-instruction-issue"><PageHeader srOnly title={t('cnd.ins.issueTitle')} />
      <InstructionForm t={t} editing={null} onSaved={(d) => navigateTo(`/site/instructions?id=${d.id}`)} onCancel={() => navigateTo('/site/instructions')} />
    </section>
  );
}
