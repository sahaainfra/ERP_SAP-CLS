import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import ListReport from '../../platform/list/ListReport.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { authHeaders } from '../../platform/api/index.js';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { fmtDate, hse, qs } from './api.js';
import { ErrorLine, ProjectSite, big, today, useRecord, useRunner } from './HseParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Toolbox Talks (part 19.01, FR-03, on a phone): choose the topic, take the attendance by badge scan, from a search or by name, add photographs, record the talk. BR-01: a person without a valid induction is flagged or refused, as the company configures.
const TONE = { DRAFT: 'IN_REVIEW', APPROVED: 'APPROVED', CANCELLED: 'CANCELLED' }; const transport = browserTransport(authHeaders);
function Talk({ id }) {
  const t = useT('hse'); const { q, guard } = useRecord('/toolbox-talks', id, t('tbt.title'), 'hse.toolbox_talk.view'); const { error, run, busy, note } = useRunner(); const [badge, setBadge] = useState(''); const [name, setName] = useState(''); const [text, setText] = useState(''); usePageTitle(t('tbt.title'));
  const pq = useQuery({ queryKey: ['hse', 'people', text], queryFn: () => hse.get(`/inductions/people${qs({ q: text })}`), enabled: text.trim().length >= 2, retry: false }); if (guard) return guard; const x = q.data;
  const attend = (b, clear) => run(async () => { const r = await hse.post(`/toolbox-talks/${x.id}/attend`, b); clear?.(); return r; }, t('tbt.added'));
  const photo = async (ev) => { const file = ev.target.files?.[0]; ev.target.value = ''; if (!file) return; await run(async () => { const up = await uploadFile(file, { transport, entity: 'hse_toolbox_talks', entityId: x.id }); return hse.post(`/toolbox-talks/${x.id}/photos`, { fileId: up.id }); }, t('tbt.photoAdded')); };
  return (
    <div data-testid="hse-talk-object" data-status={x.status}><PageHeader id="tb-h" title={<>{x.docNo} <StatusBadge status={TONE[x.status]} label={t(`tbt.st.${x.status}`)} /></>} meta={<><Link to="/hse/toolbox">{t('tbt.title')}</Link> · {x.project} · {x.site} · {fmtDate(x.talkDate)} · {x.topic} · {x.conductedBy}</>} />
      <ErrorLine error={error} id="hse-tbt-error" />{note && <p className="mdm-banner" role="status" data-testid="hse-tbt-note">{note}</p>}
      <p data-testid="hse-tbt-count">{t('tbt.attendees', { n: x.attendeeCount })} · {t('tbt.withoutInduction', { n: x.withoutInduction })} · {t('tbt.photos', { n: x.photoCount })} · {t('tbt.mode', { mode: x.mode })}</p>
      {x.can.attend && (
        <div className="mdm-panel no-print" data-testid="hse-tbt-attend"><h2>{t('tbt.attendance')}</h2>
          <div className="form-grid"><Field label={t('ind.badge')} name="badge" error={error}><input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder="LAB:…" autoComplete="off" style={big} data-testid="hse-tbt-badge" /></Field><button type="button" className="btn" style={big} disabled={busy || badge.length < 3} onClick={() => attend({ badge }, () => setBadge(''))} data-testid="hse-tbt-add-badge">{t('tbt.add')}</button>
            <Field label={t('ind.person')} name="search" error={error}><input value={text} onChange={(e) => setText(e.target.value)} style={big} data-testid="hse-tbt-search" /></Field></div>
          <ul>{(pq.data ?? []).map((p) => <li key={`${p.type}${p.id}`}><button type="button" className="btn" style={{ minHeight: 44 }} disabled={busy} onClick={() => attend(p.type === 'WORKER' ? { workerId: p.id } : { employeeId: p.id })} data-testid="hse-tbt-pick">{p.name} · {p.code} · {t(`ind.${p.type}`)}</button></li>)}</ul>
          <div className="form-grid"><Field label={t('tbt.guest')} name="name" error={error}><input value={name} onChange={(e) => setName(e.target.value)} style={big} data-testid="hse-tbt-name" /></Field><button type="button" className="btn" style={big} disabled={busy || name.trim().length < 2} onClick={() => attend({ name }, () => setName(''))} data-testid="hse-tbt-add-name">{t('tbt.add')}</button></div></div>)}
      <div className="table-scroll" data-testid="hse-tbt-list"><table className="data-table"><caption>{t('tbt.attendance')}</caption><thead><tr><th>{t('who')}</th><th>{t('tbt.code')}</th><th>{t('tbt.kind')}</th><th>{t('tbt.induction')}</th></tr></thead><tbody>{x.attendees.map((a, i) => <tr key={i}><td>{a.name}</td><td>{a.code ?? '—'}</td><td>{t(`tbt.k.${a.kind}`)}</td><td>{a.inductionValid == null ? '—' : <StatusBadge status={a.inductionValid ? 'APPROVED' : 'REJECTED'} label={a.inductionValid ? t('ind.valid') : t('ind.notValid')} />}</td></tr>)}</tbody></table></div>
      <div className="actions-row no-print">
        {x.status === 'DRAFT' && x.can.edit && <label className="btn" style={{ minHeight: 44 }}>{t('tbt.addPhoto')}<input type="file" accept="image/*" capture="environment" hidden onChange={photo} disabled={busy} data-testid="hse-tbt-photo" /></label>}
        {x.can.complete && <button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy} onClick={() => run(() => hse.act('/toolbox-talks', x.id, 'complete'), t('tbt.recorded'))} data-testid="hse-tbt-complete">{t('tbt.record')}</button>}
        {x.can.cancel && <button type="button" className="btn" disabled={busy} onClick={() => { const r = globalThis.prompt(t('why')); if (r) run(() => hse.act('/toolbox-talks', x.id, 'cancel', { reason: r }), t('cancelled')); }} data-testid="hse-tbt-cancel">{t('cancel')}</button>}</div>
    </div>
  );
}
function TalkNew() {
  const t = useT('hse'); const { error, run, busy } = useRunner(); usePageTitle(t('tbt.new')); const [v, setV] = useState({ projectId: '', siteId: '' }); const [topicId, setTopicId] = useState(''); const [topicText, setTopicText] = useState(''); const [by, setBy] = useState(''); const [date, setDate] = useState(today());
  const oq = useQuery({ queryKey: ['hse', 'talk-options'], queryFn: () => hse.get('/toolbox-talks/options'), retry: false });
  if (oq.error?.status === 403) return <NoPermission what={t('tbt.title')} permission="hse.toolbox_talk.create" />; if (oq.isPending) return <Skeleton label={t('tbt.title')} rows={3} />; const o = oq.data;
  const topic = o.topics.find((x) => String(x.id) === String(topicId));
  return (
    <section aria-labelledby="tbn-h"><PageHeader id="tbn-h" title={t('tbt.new')} meta={<Link to="/hse/toolbox">{t('tbt.title')}</Link>} /><ErrorLine error={error} id="hse-tbt-error" />
      <div className="mdm-panel" data-testid="hse-talk-form"><div className="form-grid"><ProjectSite o={o} v={v} set={setV} error={error} />
        <Field label={t('tbt.topic')} name="topicId" error={error}><select value={topicId} onChange={(e) => setTopicId(e.target.value)} style={big} data-testid="hse-tbt-topic"><option value="">—</option>{o.topics.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></Field>
        <Field label={t('tbt.topicText')} name="topicText" error={error}><input value={topicText} onChange={(e) => setTopicText(e.target.value)} maxLength={300} style={big} data-testid="hse-tbt-topic-text" /></Field>
        <Field label={t('tbt.date')} name="talkDate" error={error}><input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} style={big} /></Field>
        <Field label={t('tbt.by')} name="conductedBy" error={error}><input value={by} onChange={(e) => setBy(e.target.value)} maxLength={120} style={big} data-testid="hse-tbt-by" /></Field></div>
        {topic?.body && <p className="muted" data-testid="hse-tbt-topic-body">{topic.body}</p>}
        <div className="actions-row"><button type="button" className="btn btn-primary" style={big} disabled={busy || !v.siteId || (!topicId && topicText.trim().length < 2)} onClick={async () => { const r = await run(() => hse.make('/toolbox-talks', { projectId: Number(v.projectId), siteId: Number(v.siteId), talkDate: date, topicId: topicId ? Number(topicId) : null, topicText: topicText || undefined, conductedBy: by || undefined })); if (r) navigateTo(`/hse/toolbox?id=${r.id}`); }} data-testid="hse-tbt-create">{t('tbt.start')}</button></div></div></section>
  );
}
export default function ToolboxPage() {
  const t = useT('hse'); usePageTitle(t('tbt.title')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession();
  if (id) return <section aria-labelledby="tb-h"><Talk id={id} /></section>; if (sp.get('new')) return <TalkNew />;
  return (
    <section aria-labelledby="tbl-h" data-testid="hse-toolbox"><PageHeader id="tbl-h" title={t('tbt.title')} subtitle={t('tbt.intro')} />
      <div className="actions-row no-print"><Link to="/hse/toolbox?new=1" data-testid="hse-tbt-new">{t('tbt.new')}</Link></div>
      <ListReport listCode="hse.toolbox_talks" endpoint="/hse/toolbox-talks" title={t('tbt.title')} session={session.data} rowHref={(r) => `/hse/toolbox?id=${r.id}`} onOpen={(r) => navigateTo(`/hse/toolbox?id=${r.id}`)} cardFields={['docNo', 'topic', 'date', 'attendees']} statusKey="status" dateKey="date" empty={{ title: t('tbt.emptyTitle'), text: t('tbt.emptyBody') }} />
    </section>
  );
}
