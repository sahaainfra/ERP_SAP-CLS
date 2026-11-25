import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card } from '../../platform/design/Card.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { Pager, ParamPanel, PillTabs, download, go, post, qs, read } from './common.jsx';

// Part 30.09: Documentation Library (list report, in Help). Every person finds the manuals of their roles, the guides of the modules they
// work in and the training exercises, as PDF or editable DOCX. The technical writer generates the package from the build (all manuals in one
// ZIP) and sends the drafts to their owners; an owner approves or rejects many at once (multi-select). The drift tab shows what changed on the
// screens since the manuals were made. On a phone the rows are cards, the parameters a bottom sheet and "Generate" a full-width button.
const BASE = '/help/documentation';
const KINDS = ['ROLE', 'MODULE', 'GUIDE', 'QUICKREF', 'EXERCISES'];
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'STALE'];
const TONE = { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED', APPROVED: 'APPROVED', REJECTED: 'REJECTED', STALE: 'AT_RISK', READY: 'SUBMITTED', GENERATING: 'SUBMITTED', QUEUED: 'SUBMITTED', FAILED: 'REJECTED', SUPERSEDED: 'CANCELLED' };
const DRIFT_TONE = { SAME: 'APPROVED', CHANGED: 'AT_RISK', NEW: 'SUBMITTED' };
const SORTS = ['kind', 'title', 'status', 'owner', 'pages:desc'];

export function DocumentationLibrary() {
  const t = useT('tst');
  const { number, dateTime } = useFormat();
  const search = useSearch();
  const cache = useQueryClient();
  usePageTitle(t('dl.title'));
  const tab = search.get('tab') === 'drift' ? 'drift' : 'manuals';
  const params = { kind: search.get('kind') ?? '', language: search.get('language') ?? '', status: search.get('status') ?? '', q: search.get('q') ?? '', sort: search.get('sort') ?? '', page: search.get('page') ?? '', pageSize: search.get('pageSize') ?? '' };
  const [text, setText] = useState(params.q);
  const [picked, setPicked] = useState([]);
  const [comment, setComment] = useState('');
  const q = useQuery({ queryKey: ['tst', 'manuals', params], queryFn: () => read(`/tst/manuals${qs(params)}`), retry: false, placeholderData: (p) => p, refetchInterval: (query) => (query.state.data?.running && ['QUEUED', 'GENERATING'].includes(query.state.data.running.status) ? 3000 : false) });
  const refresh = () => { setPicked([]); cache.invalidateQueries({ queryKey: ['tst', 'manuals'] }); };
  const gen = useMutation({ mutationFn: () => post('/tst/manuals/packages', {}), onSuccess: refresh });
  const submit = useMutation({ mutationFn: () => post('/tst/manuals/submissions', { reason: t('dl.submitReason') }), onSuccess: refresh });
  const decide = useMutation({ mutationFn: (action) => post('/tst/manuals/decisions', { ids: picked, action, ...(comment.trim() ? { comment: comment.trim() } : {}) }), onSuccess: () => { setComment(''); refresh(); } });
  const exp = useMutation({ mutationFn: (f) => download('/tst/manuals/export', { kind: params.kind, language: params.language, status: params.status, q: params.q, format: f }, `documentation-library.${f}`) });
  const file = useMutation({ mutationFn: ([m, f]) => download(`/tst/manuals/${m.id}/download`, { format: f }, `${m.code.replace(/\./g, '-')}-v${m.versionNo}.${f}`) });
  const zip = useMutation({ mutationFn: (p) => download(`/tst/manuals/packages/${p.id}/download`, {}, `${p.packageNo}.zip`) });
  const n = (v) => number(String(v ?? 0), { decimals: 0 });
  const set = (patch) => go(BASE, { ...params, tab: tab === 'drift' ? 'drift' : '', ...patch });

  if (q.error?.status === 403) return <NoPermission what={t('dl.title')} permission="hd.ticket.raise" />;
  if (q.isPending) return <section><PageHeader title={t('dl.title')} /><Skeleton label={t('dl.title')} rows={8} /></section>;
  if (q.error) return <section><PageHeader title={t('dl.title')} /><ErrorState error={q.error} onRetry={q.refetch} /></section>;
  const d = q.data; const P = d.package; const busy = d.running && ['QUEUED', 'GENERATING'].includes(d.running.status);
  const awaiting = d.rows.filter((m) => m.awaitingMe).map((m) => m.id);
  const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const menu = [...['xlsx', 'csv', 'pdf'].map((f) => ({ label: t('exportAs', { f: f.toUpperCase() }), testid: `dl-export-${f}`, onClick: () => exp.mutate(f) })), ...(d.can.package ? [{ label: t('dl.zip'), testid: 'dl-zip', onClick: () => zip.mutate(P) }] : [])];
  const actions = d.can.generate ? <button type="button" className="btn btn-primary" onClick={() => gen.mutate()} disabled={gen.isPending || busy} data-testid="dl-generate">{busy ? t('dl.generating', { pct: d.running.progress }) : t('dl.generate')}</button> : null;
  return <section aria-labelledby="dl-h" data-testid="tst-docs" data-tab={tab}>
    <PageHeader id="dl-h" title={t('dl.title')} subtitle={t('dl.subtitle')} actions={actions} menu={menu}
      status={P ? <StatusBadge status={TONE[P.status]} label={t('dl.packageOf', { no: P.packageNo, build: P.buildId, status: t(`dl.pk.${P.status}`) })} variant="solid" /> : null} />
    {[gen, submit, decide, exp, file, zip].map((m) => m.error).filter(Boolean).slice(0, 1).map((e) => <ErrorState key="e" error={e} />)}
    {d.running?.status === 'FAILED' && <p role="alert" className="small" data-testid="dl-failed">{t('dl.failed', { no: d.running.packageNo, error: d.running.error ?? '' })}</p>}
    {decide.data && <p role="status" className="small" data-testid="dl-decided">{t('dl.decided', { n: n(decide.data.decided) })}</p>}
    {submit.data && <p role="status" className="small" data-testid="dl-submitted">{t('dl.submitted', { n: n(submit.data.submitted) })}</p>}
    {d.can.viewAll && <PillTabs label={t('dl.title')} tabs={[['manuals', t('dl.tabManuals')], ['drift', t('dl.tabDrift')]]} value={tab} onChange={(k) => go(BASE, { tab: k === 'drift' ? 'drift' : '' })} testid="dl-tabs" />}
    {tab === 'drift' && d.can.viewAll ? <Drift t={t} d={d} n={n} dateTime={dateTime} refresh={refresh} /> : <>
      {!P ? <EmptyState title={t('dl.noPackage')} message={d.can.generate ? t('dl.noPackageWriter') : t('dl.noPackageBody')} /> : <Card title={t('dl.manuals')} subtitle={t('dl.counts', { total: n(d.counts.total), approved: n(d.counts.byStatus.APPROVED), stale: n(d.counts.byStatus.STALE) })} testid="dl-list">
        <form className="actions-row" role="search" onSubmit={(e) => { e.preventDefault(); set({ q: text.trim() }); }}>
          <input type="search" value={text} onChange={(e) => setText(e.target.value)} aria-label={t('dl.search')} placeholder={t('dl.search')} data-testid="dl-q" />
          <button type="submit" className="btn">{t('dl.find')}</button>
        </form>
        <ParamPanel label={t('params')} done={t('done')} count={[params.kind, params.language, params.status].filter(Boolean).length} testid="dl-params">
          <Field name="dl-kind" label={t('dl.kind')}><select value={params.kind} onChange={(e) => set({ kind: e.target.value })} data-testid="dl-f-kind"><option value="">{t('all')}</option>{KINDS.map((k) => <option key={k} value={k}>{t(`dl.k.${k}`)}</option>)}</select></Field>
          <Field name="dl-lang" label={t('dl.language')}><select value={params.language} onChange={(e) => set({ language: e.target.value })} data-testid="dl-f-lang"><option value="">{t('all')}</option><option value="en">English</option><option value="hi">हिन्दी</option></select></Field>
          <Field name="dl-status" label={t('status')}><select value={params.status} onChange={(e) => set({ status: e.target.value })} data-testid="dl-f-status"><option value="">{t('all')}</option>{STATUSES.map((k) => <option key={k} value={k}>{t(`dl.st.${k}`)}</option>)}</select></Field>
          <Field name="dl-sort" label={t('dl.sort')}><select value={params.sort} onChange={(e) => set({ sort: e.target.value })} data-testid="dl-f-sort">{SORTS.map((k) => <option key={k} value={k === 'kind' ? '' : k}>{t(`dl.sortBy.${k.replace(':desc', '')}`)}</option>)}</select></Field>
          <Field name="dl-size" label={t('dl.pageSize')}><select value={params.pageSize || '25'} onChange={(e) => set({ pageSize: e.target.value === '25' ? '' : e.target.value })} data-testid="dl-f-size">{['25', '50', '100'].map((k) => <option key={k} value={k}>{k}</option>)}</select></Field>
        </ParamPanel>
        {(awaiting.length > 0 || (d.can.generate && d.counts.byStatus.DRAFT + d.counts.byStatus.REJECTED > 0)) && <div className="actions-row" data-testid="dl-bulk">
          {d.can.generate && d.counts.byStatus.DRAFT + d.counts.byStatus.REJECTED > 0 && <button type="button" className="btn" onClick={() => submit.mutate()} disabled={submit.isPending} data-testid="dl-submit">{t('dl.submit', { n: n(d.counts.byStatus.DRAFT + d.counts.byStatus.REJECTED) })}</button>}
          {awaiting.length > 0 && <>
            <button type="button" className="btn" onClick={() => setPicked(picked.length === awaiting.length ? [] : awaiting)} data-testid="dl-pick-all">{picked.length === awaiting.length ? t('dl.pickNone') : t('dl.pickAll', { n: n(awaiting.length) })}</button>
            <input value={comment} onChange={(e) => setComment(e.target.value)} aria-label={t('dl.comment')} placeholder={t('dl.comment')} data-testid="dl-comment" />
            <button type="button" className="btn btn-primary" disabled={!picked.length || decide.isPending} onClick={() => decide.mutate('approve')} data-testid="dl-approve">{t('dl.approveN', { n: n(picked.length) })}</button>
            <button type="button" className="btn" disabled={!picked.length || comment.trim().length < 5 || decide.isPending} onClick={() => decide.mutate('reject')} data-testid="dl-reject">{t('dl.rejectN', { n: n(picked.length) })}</button>
          </>}
        </div>}
        {!d.rows.length ? <EmptyState compact title={t('dl.none')} message={t('dl.noneBody')} /> : <>
          <div className="table-scroll"><table className="data-table" data-testid="dl-table">
            <thead><tr>{awaiting.length > 0 && <th><span className="sr-only">{t('dl.pick')}</span></th>}<th>{t('dl.manual')}</th><th>{t('dl.kind')}</th><th>{t('dl.owner')}</th><th className="num">{t('dl.pages')}</th><th>{t('status')}</th><th>{t('dl.files')}</th></tr></thead>
            <tbody>{d.rows.map((m) => <tr key={m.id} data-testid="dl-row" data-code={m.code} data-status={m.status}>
              {awaiting.length > 0 && <td>{m.awaitingMe ? <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} aria-label={t('dl.pickOne', { title: m.title })} data-testid={`dl-pick-${m.code}`} /> : null}</td>}
              <td data-label={t('dl.manual')}><strong>{m.title}</strong> <span className="muted small">{m.language === 'hi' ? 'हिन्दी' : 'English'} · v{m.versionNo}</span>{m.staleReason && m.status === 'STALE' ? <><br /><span className="small">{m.staleReason}</span></> : null}{m.remarks ? <><br /><span className="muted small">{m.remarks}</span></> : null}</td>
              <td data-label={t('dl.kind')}>{t(`dl.k.${m.kind}`)}</td>
              <td data-label={t('dl.owner')}>{m.owner}{m.approvedBy ? <span className="muted small"> · {m.approvedBy}</span> : null}</td>
              <td data-label={t('dl.pages')} className="num">{n(m.pages)}</td>
              <td data-label={t('status')}><StatusBadge status={TONE[m.status]} label={t(`dl.st.${m.status}`)} size="sm" />{m.awaitingMe ? <span className="small"> · {t('dl.yours')}</span> : null}</td>
              <td data-label={t('dl.files')}><span className="actions-row"><button type="button" className="btn btn-small" onClick={() => file.mutate([m, 'pdf'])} data-testid={`dl-pdf-${m.code}`} aria-label={t('dl.pdfOf', { title: m.title })}>PDF</button><button type="button" className="btn btn-small" onClick={() => file.mutate([m, 'docx'])} data-testid={`dl-docx-${m.code}`} aria-label={t('dl.docxOf', { title: m.title })}>DOCX</button></span></td>
            </tr>)}</tbody>
            <tfoot className="sticky-total"><tr><th scope="row" colSpan={awaiting.length > 0 ? 4 : 3}>{t('dl.total', { n: n(d.total) })}</th><td className="num">{n(d.rows.reduce((a, m) => a + m.pages, 0))}</td><td colSpan={2} /></tr></tfoot>
          </table></div>
          <Pager page={d.page} pageSize={d.pageSize} total={d.total} onPage={(p) => set({ page: p })} t={t} testid="dl-pager" />
        </>}
      </Card>}
    </>}
  </section>;
}

function Drift({ t, d, n, dateTime, refresh }) {
  const C = d.capture; const [only, setOnly] = useState('CHANGED');
  const s = useQuery({ queryKey: ['tst', 'manuals', 'capture', C?.id, only], queryFn: () => read(`/tst/manuals/captures/${C.id}${qs({ drift: only })}`), enabled: Boolean(C), retry: false });
  const accept = useMutation({ mutationFn: () => post(`/tst/manuals/captures/${C.id}/accept`), onSuccess: refresh });
  const compare = useMutation({ mutationFn: () => post(`/tst/manuals/captures/${C.id}/compare`), onSuccess: () => { refresh(); s.refetch(); } });
  if (!C) return <EmptyState title={t('dl.noCapture')} message={t('dl.noCaptureBody')} />;
  return <Card title={t('dl.capture', { no: C.captureNo, build: C.buildId })} subtitle={C.baselineId ? t('dl.against', { no: d.baseline?.captureNo ?? C.baselineId }) : t('dl.firstCapture')} testid="dl-drift">
    <dl className="kv" data-testid="dl-drift-counts">
      <div><dt>{t('dl.screens')}</dt><dd>{n(C.screens)}</dd></div><div><dt>{t('dl.dr.CHANGED')}</dt><dd data-testid="dl-changed">{n(C.changed)}</dd></div>
      <div><dt>{t('dl.dr.NEW')}</dt><dd>{n(C.added)}</dd></div><div><dt>{t('dl.removed')}</dt><dd>{n(C.removed)}</dd></div>
      <div><dt>{t('status')}</dt><dd><StatusBadge status={C.status === 'ACCEPTED' ? 'APPROVED' : 'SUBMITTED'} label={t(`dl.cap.${C.status}`)} size="sm" /></dd></div>
      {C.comparedAt && <div><dt>{t('dl.compared')}</dt><dd>{dateTime(C.comparedAt)}</dd></div>}
    </dl>
    {(accept.error || compare.error) && <ErrorState error={accept.error ?? compare.error} />}
    {d.can.generate && <div className="actions-row">
      {C.status === 'OPEN' && <button type="button" className="btn btn-primary" onClick={() => compare.mutate()} disabled={compare.isPending} data-testid="dl-compare">{t('dl.compare')}</button>}
      {C.status === 'COMPARED' && <button type="button" className="btn btn-primary" onClick={() => accept.mutate()} disabled={accept.isPending} data-testid="dl-accept">{t('dl.accept')}</button>}
    </div>}
    <PillTabs label={t('dl.tabDrift')} tabs={['CHANGED', 'NEW', 'SAME'].map((k) => [k, t(`dl.dr.${k}`)])} value={only} onChange={setOnly} testid="dl-drift-tabs" />
    {s.isPending ? <Skeleton label={t('dl.tabDrift')} rows={4} /> : s.error ? <ErrorState error={s.error} onRetry={s.refetch} /> : !s.data.screens.length ? <EmptyState compact title={t('dl.noDrift')} message={t('dl.noDriftBody')} /> : <ul className="lp-list" data-testid="dl-drift-list">{s.data.screens.map((x) => <li key={x.id} data-testid="dl-screen" data-drift={x.drift}>
      <StatusBadge status={DRIFT_TONE[x.drift]} label={t(`dl.dr.${x.drift}`)} size="sm" /> <strong>{x.title ?? x.route}</strong> <span className="muted small">{x.route} · {x.viewport === 'MOBILE' ? t('dl.phone') : t('dl.desktop')}</span>
      {x.diff && <ul className="small">{Object.entries(x.diff).map(([k, v]) => <li key={k}>{k === 'title' ? t('dl.titleChanged', { from: v.from, to: v.to }) : t('dl.itemChange', { what: t(`dl.part.${k}`), added: v.added.join(', ') || '—', removed: v.removed.join(', ') || '—' })}</li>)}</ul>}
    </li>)}</ul>}
    {C.removedRoutes?.length > 0 && <p className="small" data-testid="dl-removed">{t('dl.removedList', { list: C.removedRoutes.map((r) => r.route).join(', ') })}</p>}
  </Card>;
}
