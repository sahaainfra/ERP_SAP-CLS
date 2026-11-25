import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, authHeaders } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { browserTransport, uploadFile } from '../../platform/files/upload.js';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { downloadReport } from '../bi/api.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { post, qs, read } from './common.js';

// Part 26.04: the closeouts (list and start), a closeout (checklist with the automatic checks, final account, final P&L, performance,
// benchmarks, approval), the lessons learned (knowledge base, write and submit) and the benchmarks of closed projects.
const transport = browserTransport(authHeaders);
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', CANCELLED: 'CANCELLED', OPEN: 'DRAFT', DONE: 'APPROVED', NOT_APPLICABLE: 'CANCELLED', PUBLISHED: 'APPROVED', WITHDRAWN: 'CANCELLED', PROPOSED: 'SUBMITTED' };
const Badge = ({ t, status }) => <StatusBadge status={TONE[status] ?? 'DRAFT'} label={t(`cl.st.${status}`)} size="sm" />;
const patch = async (path, body) => (await api.patch(`/close${path}`, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } })).data;

function Guard({ q, title, permission, children }) {
  if (q.error?.status === 403) return <NoPermission what={title} permission={permission} />;
  if (q.isPending) return <section><PageHeader title={title} /><Skeleton label={title} rows={6} /></section>;
  if (q.error) return <section><PageHeader title={title} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  return children(q.data);
}

export function Closures() {
  const t = useT('close'); usePageTitle(t('cl.title'));
  const { number } = useFormat();
  const q = useQuery({ queryKey: ['close', 'cls', 'list'], queryFn: () => read('/closures'), retry: false });
  const opts = useQuery({ queryKey: ['close', 'cls', 'options'], queryFn: () => read('/closures/options'), retry: false });
  const [projectId, setProjectId] = useState('');
  const start = useMutation({ mutationFn: () => post('/closures', { projectId: Number(projectId) }), onSuccess: (c) => navigateTo(`/close/closure?id=${c.id}`) });
  const exp = useMutation({ mutationFn: () => downloadReport('/api/v1/close/closures/export', 'closeouts.csv') });
  const rs = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  return <Guard q={q} title={t('cl.title')} permission="cls.view">{(rows) => <section aria-labelledby="cl-h" data-testid="close-closures">
    <PageHeader id="cl-h" title={t('cl.title')} subtitle={t('cl.subtitle')} menu={[{ label: t('ca.export'), testid: 'cl-export', onClick: () => exp.mutate() }]} />
    {(start.error || exp.error) && <ErrorState error={start.error ?? exp.error} />}
    {(opts.data?.projects ?? []).length > 0 && <form className="actions-row" onSubmit={(e) => { e.preventDefault(); start.mutate(); }} data-testid="cl-start-form">
      <Field name="cl-project" label={t('f.project')}><select id="cl-project" required value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="cl-project"><option value="">{t('f.choose')}</option>{opts.data.projects.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}</select></Field>
      <button type="submit" className="btn btn-primary" disabled={start.isPending} data-testid="cl-start">{t('cl.start')}</button>
    </form>}
    <KpiRow testid="cl-tiles" label={t('cl.title')}>
      {['DRAFT', 'SUBMITTED', 'APPROVED'].map((s) => <KpiTile key={s} testid={`cl-k-${s}`} label={t(`cl.st.${s}`)} kind="count" value={String(rows.filter((c) => c.status === s).length)}>{t('cl.kCloseouts')}</KpiTile>)}
    </KpiRow>
    <Card title={t('cl.title')} testid="cl-list">
      {!rows.length ? <EmptyState compact title={t('cl.none')} message={t('cl.noneBody')} /> : <div className="table-scroll"><table className="data-table" data-testid="cl-table">
        <thead><tr><th scope="col">{t('f.docNo')}</th><th scope="col">{t('f.project')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('cl.f.finalAccount')}</th><th scope="col">{t('cl.f.margin')}</th><th scope="col">{t('cl.f.ready')}</th></tr></thead>
        <tbody>{rows.map((c) => <tr key={c.id} data-testid="cl-row" data-status={c.status}>
          <td><a href={`/close/closure?id=${c.id}`} onClick={(e) => { e.preventDefault(); navigateTo(`/close/closure?id=${c.id}`); }}>{c.docNo}</a></td><td>{c.project?.code} {c.project?.name}</td><td><Badge t={t} status={c.status} /></td>
          <td>{rs(c.finalAccount)}</td><td>{c.marginPct == null ? '—' : `${c.marginPct} %`}</td><td>{c.readiness.ready ? t('sys.ready') : t('cl.openItems', { n: c.readiness.blockers.length })}</td>
        </tr>)}</tbody>
      </table></div>}
    </Card>
  </section>}</Guard>;
}

export function Closure() {
  const t = useT('close'); const { number } = useFormat(); const id = useSearch().get('id'); const cache = useQueryClient();
  const q = useQuery({ queryKey: ['close', 'cls', 'one', id], queryFn: () => read(`/closures/${id}`), retry: false, enabled: Boolean(id) });
  usePageTitle(q.data ? q.data.docNo : t('cl.one'));
  const refresh = () => cache.invalidateQueries({ queryKey: ['close', 'cls'] });
  const req = useMutation({ mutationFn: () => post(`/closures/${id}/request`), onSuccess: refresh });
  const rs = (v) => (v == null ? '—' : number(String(v), { decimals: 0 }));
  if (!id) return <section><PageHeader title={t('cl.one')} /><EmptyState title={t('cl.pick')} message={t('cl.pickBody')} /></section>;
  return <Guard q={q} title={t('cl.one')} permission="cls.view">{(c) => {
    const editable = c.can.manage && ['DRAFT', 'REJECTED'].includes(c.status);
    return <section aria-labelledby="cs-h" data-testid="close-closure" data-status={c.status}>
      <PageHeader id="cs-h" title={`${c.docNo} ${c.project?.code ?? ''}`} subtitle={c.project?.name} status={<Badge t={t} status={c.status} />}
        actions={['DRAFT', 'REJECTED'].includes(c.status) && c.can.request && c.readiness.ready ? <button type="button" className="btn btn-primary" disabled={req.isPending} onClick={() => req.mutate()} data-testid="cs-request">{t('cl.request')}</button> : null} />
      {req.error && <ErrorState error={req.error} />}
      <KpiRow testid="cs-tiles" label={c.docNo}>
        <KpiTile testid="cs-k-final" label={t('cl.f.finalAccount')} kind="money" value={rs(c.finalAccount)}>{c.finalAccountAgreedOn ? t('cl.agreedOn', { d: c.finalAccountAgreedOn }) : t('cl.notAgreed')}</KpiTile>
        <KpiTile testid="cs-k-revenue" label={t('cl.f.revenue')} kind="money" value={rs(c.revenue)}>{t('cl.fromSnapshot')}</KpiTile>
        <KpiTile testid="cs-k-margin" label={t('cl.f.margin')} kind="quality" value={c.marginPct == null ? '—' : `${c.marginPct} %`}>{rs(c.margin)}</KpiTile>
        <KpiTile testid="cs-k-delay" label={t('cl.f.delay')} kind="count" value={c.performance.delayDays == null ? '—' : String(c.performance.delayDays)} tone={c.performance.delayDays > 0 ? 'warning' : 'success'}>{t('cl.f.delayBody')}</KpiTile>
      </KpiRow>
      <Checklist t={t} c={c} editable={editable} refresh={refresh} />
      {editable && <FinalAccount t={t} c={c} refresh={refresh} />}
      <Card title={t('cl.performance')} testid="cs-performance">
        <dl className="small">{['startDate', 'scheduledCompletion', 'handedOverOn', 'durationDays', 'ncrs', 'snags', 'incidents', 'dlpComplaints'].map((k) => <div key={k}><dt>{t(`cl.p.${k}`)}</dt><dd>{c.performance[k] ?? '—'}</dd></div>)}</dl>
      </Card>
      <Benchmarks t={t} c={c} editable={editable} refresh={refresh} />
    </section>;
  }}</Guard>;
}

function Checklist({ t, c, editable, refresh }) {
  const [edit, setEdit] = useState(null); const [v, setV] = useState({ note: '', file: null });
  const rec = useMutation({ mutationFn: async ([i, status]) => { const body = { status, ...(v.note ? { note: v.note } : {}) }; if (status === 'DONE' && v.file) body.fileId = (await uploadFile(v.file, { transport, entity: 'cls_closures', entityId: c.id })).id; return post(`/closure-items/${i.id}/record`, body); }, onSuccess: () => { setEdit(null); setV({ note: '', file: null }); refresh(); } });
  return <Card title={t('cl.checklist')} subtitle={t('cl.checklistBody')} testid="cs-checklist">
    {rec.error && <ErrorState error={rec.error} />}
    <div className="table-scroll"><table className="data-table" data-testid="cs-items">
      <thead><tr><th scope="col">{t('ho.f.item')}</th><th scope="col">{t('cl.f.kind')}</th><th scope="col">{t('f.status')}</th><th scope="col">{t('f.note')}</th>{editable && <th scope="col">{t('f.record')}</th>}</tr></thead>
      <tbody>{c.checklist.map((i) => <tr key={i.code} data-testid="cs-item" data-code={i.code} data-status={i.status}>
        <td>{i.title}{i.mandatory ? ' *' : ''}</td><td>{t(`cl.kind.${i.kind}`)}</td><td><Badge t={t} status={i.status} /></td><td className="small">{i.note ?? ''}</td>
        {editable && <td>{i.kind === 'MANUAL' && (edit === i.id ? <div className="form-grid">
          <Field name={`ci-f-${i.id}`} label={t('ho.f.evidence')}><input id={`ci-f-${i.id}`} type="file" onChange={(e) => setV({ ...v, file: e.target.files?.[0] ?? null })} data-testid={`ci-file-${i.code}`} /></Field>
          <Field name={`ci-n-${i.id}`} label={t('f.note')}><input id={`ci-n-${i.id}`} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} data-testid={`ci-note-${i.code}`} /></Field>
          <div className="actions-row">
            <button type="button" className="btn btn-small btn-primary" disabled={rec.isPending} onClick={() => rec.mutate([i, 'DONE'])} data-testid={`ci-done-${i.code}`}>{t('ho.done')}</button>
            {!i.mandatory && <button type="button" className="btn btn-small" disabled={rec.isPending} onClick={() => rec.mutate([i, 'NOT_APPLICABLE'])}>{t('ho.na')}</button>}
            {i.status !== 'OPEN' && <button type="button" className="btn btn-small" disabled={rec.isPending} onClick={() => rec.mutate([i, 'OPEN'])}>{t('ho.reopen')}</button>}
            <button type="button" className="btn btn-small" onClick={() => setEdit(null)}>{t('cancel')}</button>
          </div>
        </div> : <button type="button" className="btn btn-small" onClick={() => setEdit(i.id)} data-testid={`ci-edit-${i.code}`}>{t('f.record')}</button>)}</td>}
      </tr>)}</tbody>
    </table></div>
  </Card>;
}

function FinalAccount({ t, c, refresh }) {
  const [v, setV] = useState({ finalAccount: c.finalAccount ?? '', agreedOn: c.finalAccountAgreedOn ?? '', file: null, snapshotId: c.plSnapshotId ?? '', summary: c.summary ?? '' });
  const save = useMutation({
    mutationFn: async () => {
      const body = { summary: v.summary || null, rowVersion: c.version };
      if (v.finalAccount !== '' && (v.file || c.finalAccountFileId)) Object.assign(body, { finalAccount: Number(v.finalAccount), agreedOn: v.agreedOn, fileId: v.file ? (await uploadFile(v.file, { transport, entity: 'cls_closures', entityId: c.id })).id : c.finalAccountFileId });
      if (v.snapshotId !== '' && Number(v.snapshotId) !== c.plSnapshotId) body.snapshotId = Number(v.snapshotId);
      return patch(`/closures/${c.id}`, body);
    },
    onSuccess: refresh,
  });
  return <Card title={t('cl.finalAccount')} subtitle={t('cl.finalAccountBody')} testid="cs-final">
    {save.error && <ErrorState error={save.error} />}
    <form className="form-grid" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field name="fa-value" label={t('cl.f.finalAccount')}><input id="fa-value" inputMode="decimal" value={v.finalAccount} onChange={(e) => setV({ ...v, finalAccount: e.target.value })} data-testid="fa-value" /></Field>
      <Field name="fa-on" label={t('cl.f.agreedOn')}><input id="fa-on" type="date" value={v.agreedOn} onChange={(e) => setV({ ...v, agreedOn: e.target.value })} data-testid="fa-on" /></Field>
      <Field name="fa-file" label={t('f.signedCopy')}><input id="fa-file" type="file" accept=".pdf,image/*" onChange={(e) => setV({ ...v, file: e.target.files?.[0] ?? null })} data-testid="fa-file" /></Field>
      <Field name="fa-snap" label={t('cl.f.snapshot')} hint={t('cl.f.snapshotHint')}><select id="fa-snap" value={v.snapshotId} onChange={(e) => setV({ ...v, snapshotId: e.target.value })} data-testid="fa-snap"><option value="">{t('f.choose')}</option>{c.snapshots.map((x) => <option key={x.id} value={x.id}>{x.period} {x.docNo}</option>)}</select></Field>
      <Field name="fa-sum" label={t('cl.f.summary')}><textarea id="fa-sum" rows={3} value={v.summary} onChange={(e) => setV({ ...v, summary: e.target.value })} data-testid="fa-sum" /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={save.isPending} data-testid="fa-save">{t('save')}</button></div>
    </form>
  </Card>;
}

function Benchmarks({ t, c, editable, refresh }) {
  const add = useMutation({ mutationFn: (s) => post(`/closures/${c.id}/benchmarks`, s), onSuccess: refresh });
  const proposed = new Set(c.benchmarks.map((b) => b.metricCode));
  return <Card title={t('bm.title')} subtitle={t('bm.closureBody')} testid="cs-benchmarks">
    {add.error && <ErrorState error={add.error} />}
    {c.benchmarks.length > 0 && <ul className="plain-list">{c.benchmarks.map((b) => <li key={b.id} data-testid="cs-benchmark" data-status={b.status}>{b.label}: {b.value} {b.unit} <Badge t={t} status={b.status} /></li>)}</ul>}
    {editable && c.suggestions.filter((s) => !proposed.has(s.metricCode)).map((s) => <button key={s.metricCode} type="button" className="btn btn-small" disabled={add.isPending} onClick={() => add.mutate(s)} data-testid={`cs-suggest-${s.metricCode}`}>{t('bm.propose', { label: s.label, value: s.value, unit: s.unit })}</button>)}
    {!c.benchmarks.length && !c.suggestions.length && <EmptyState compact title={t('bm.none')} message={t('bm.noneBody')} />}
  </Card>;
}

const CATS = ['DESIGN', 'PROCUREMENT', 'EXECUTION', 'QUALITY', 'SAFETY', 'COMMERCIAL', 'CONTRACT', 'PLANNING', 'OTHER'];
export function Lessons() {
  const t = useT('close'); usePageTitle(t('ll.title')); const search = useSearch(); const cache = useQueryClient();
  const params = { q: search.get('q') ?? '', category: search.get('category') ?? '', mine: search.get('mine') ?? '' };
  const q = useQuery({ queryKey: ['close', 'kb', params], queryFn: () => read(`/lessons${qs(params)}`), retry: false });
  const [text, setText] = useState(params.q); const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ title: '', category: 'EXECUTION', impact: 'NEGATIVE', whatHappened: '', recommendation: '', tags: '' });
  const refresh = () => cache.invalidateQueries({ queryKey: ['close', 'kb'] });
  const add = useMutation({ mutationFn: () => post('/lessons', Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''))), onSuccess: () => { setAdding(false); setV({ title: '', category: 'EXECUTION', impact: 'NEGATIVE', whatHappened: '', recommendation: '', tags: '' }); refresh(); } });
  const submit = useMutation({ mutationFn: (id) => post(`/lessons/${id}/submit`), onSuccess: refresh });
  const set = (patchQ) => navigateTo(`/close/lessons${qs({ ...params, ...patchQ })}`);
  return <Guard q={q} title={t('ll.title')} permission="kb.lesson.view">{(rows) => <section aria-labelledby="ll-h" data-testid="close-lessons">
    <PageHeader id="ll-h" title={t('ll.title')} subtitle={t('ll.subtitle')} actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(!adding)} data-testid="ll-add">{t('ll.add')}</button>} />
    {(add.error || submit.error) && <ErrorState error={add.error ?? submit.error} />}
    {adding && <Card title={t('ll.add')} testid="ll-new"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <Field name="ll-title" label={t('ho.f.title')}><input id="ll-title" required value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} data-testid="ll-title" /></Field>
      <Field name="ll-cat" label={t('ll.f.category')}><select id="ll-cat" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} data-testid="ll-cat">{CATS.map((x) => <option key={x} value={x}>{t(`ll.cat.${x}`)}</option>)}</select></Field>
      <Field name="ll-impact" label={t('ll.f.impact')}><select id="ll-impact" value={v.impact} onChange={(e) => setV({ ...v, impact: e.target.value })} data-testid="ll-impact"><option value="NEGATIVE">{t('ll.negative')}</option><option value="POSITIVE">{t('ll.positive')}</option></select></Field>
      <Field name="ll-what" label={t('ll.f.what')}><textarea id="ll-what" rows={3} required value={v.whatHappened} onChange={(e) => setV({ ...v, whatHappened: e.target.value })} data-testid="ll-what" /></Field>
      <Field name="ll-rec" label={t('ll.f.recommendation')}><textarea id="ll-rec" rows={3} required value={v.recommendation} onChange={(e) => setV({ ...v, recommendation: e.target.value })} data-testid="ll-rec" /></Field>
      <Field name="ll-tags" label={t('ll.f.tags')}><input id="ll-tags" value={v.tags} onChange={(e) => setV({ ...v, tags: e.target.value })} data-testid="ll-tags" /></Field>
      <div className="actions-row"><button type="submit" className="btn btn-primary" disabled={add.isPending} data-testid="ll-save">{t('save')}</button></div>
    </form></Card>}
    <form className="actions-row" role="search" onSubmit={(e) => { e.preventDefault(); set({ q: text }); }}>
      <Field name="ll-q" label={t('ll.search')}><input id="ll-q" type="search" value={text} onChange={(e) => setText(e.target.value)} data-testid="ll-q" /></Field>
      <Field name="ll-fcat" label={t('ll.f.category')}><select id="ll-fcat" value={params.category} onChange={(e) => set({ category: e.target.value })} data-testid="ll-fcat"><option value="">{t('dc.all')}</option>{CATS.map((x) => <option key={x} value={x}>{t(`ll.cat.${x}`)}</option>)}</select></Field>
      <label className="small"><input type="checkbox" checked={Boolean(params.mine)} onChange={(e) => set({ mine: e.target.checked ? '1' : '' })} data-testid="ll-mine" /> {t('ll.mine')}</label>
    </form>
    {!rows.length ? <EmptyState title={t('ll.none')} message={t('ll.noneBody')} /> : rows.map((l) => <Card key={l.id} title={l.title} testid="ll-card" level={3}>
      <div data-status={l.status} data-testid={`ll-${l.id}`}>
        <p className="small muted">{l.docNo} · {t(`ll.cat.${l.category}`)} · {l.impact === 'POSITIVE' ? t('ll.positive') : t('ll.negative')}{l.project ? ` · ${l.project}` : ''} · <Badge t={t} status={l.status} /></p>
        <p><strong>{t('ll.f.what')}:</strong> {l.whatHappened}</p><p><strong>{t('ll.f.recommendation')}:</strong> {l.recommendation}</p>
        {['DRAFT', 'REJECTED'].includes(l.status) && <button type="button" className="btn btn-small" disabled={submit.isPending} onClick={() => submit.mutate(l.id)} data-testid={`ll-submit-${l.id}`}>{t('ll.submit')}</button>}
      </div>
    </Card>)}
  </section>}</Guard>;
}

export function BenchmarkReport() {
  const t = useT('close'); usePageTitle(t('bm.title'));
  const q = useQuery({ queryKey: ['close', 'bm'], queryFn: () => read('/benchmarks'), retry: false });
  return <Guard q={q} title={t('bm.title')} permission="kb.benchmark.view">{(rows) => <section aria-labelledby="bm-h" data-testid="close-benchmarks">
    <PageHeader id="bm-h" title={t('bm.title')} subtitle={t('bm.subtitle')} />
    {!rows.length ? <EmptyState title={t('bm.none')} message={t('bm.noneBody')} /> : <Card title={t('bm.title')}><div className="table-scroll"><table className="data-table" data-testid="bm-table">
      <thead><tr><th scope="col">{t('bm.f.metric')}</th><th scope="col">{t('bm.f.unit')}</th><th scope="col">{t('bm.f.projects')}</th><th scope="col">{t('bm.f.min')}</th><th scope="col">{t('bm.f.median')}</th><th scope="col">{t('bm.f.max')}</th></tr></thead>
      <tbody>{rows.map((m) => <tr key={m.metricCode} data-testid="bm-row"><td>{m.label}</td><td>{m.unit}</td><td>{m.count}</td><td>{m.min}</td><td>{m.median}</td><td>{m.max}</td></tr>)}</tbody>
    </table></div></Card>}
  </section>}</Guard>;
}
