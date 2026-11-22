import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import { KpiRow, KpiTile } from '../../platform/design/Kpi.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 28.04: Extraction Review (worklist, UI v3 §3.1). The queue of documents read on upload, oldest first with its SLA chip; a document opens
// beside its suggested fields, each with its confidence and the place in the text it came from. Accepting creates a draft in the owner module
// (22.06 invoice, 11.05 letter, 21.01 clauses, 04.10 validity); a field below the confidence threshold must be confirmed or corrected (BR-01).

const read = async (path) => (await api.get(path)).data;
const write = (path, body) => api.post(path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const qs = (o) => { const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)); const s = p.toString(); return s ? `?${s}` : ''; };
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/ai/documents${p.toString() ? `?${p}` : ''}`);
};
const SLA_TONE = { ON_TIME: 'APPROVED', DUE_SOON: 'AT_RISK', OVERDUE: 'REJECTED' };
const STATUS_TONE = { EXTRACTED: 'IN_REVIEW', NO_TEXT: 'DRAFT', ACCEPTED: 'APPROVED', REJECTED: 'CANCELLED', FAILED: 'REJECTED' };
const CATS = ['NOTICE', 'TIME_BAR', 'VARIATION', 'PAYMENT', 'TERMINATION', 'LD', 'PVC', 'DISPUTE', 'INSURANCE', 'SECURITY', 'OTHER'];
const pct = (v) => `${Math.round(Number(v) * 100)}%`;

/** The text with the source of each suggested field marked. */
function SourceText({ text, fields, active }) {
  const spans = fields.filter((f) => f.start != null).sort((a, b) => a.start - b.start);
  const parts = []; let at = 0;
  for (const f of spans) { if (f.start < at) continue; parts.push(text.slice(at, f.start)); parts.push(<mark key={f.key} className={active === f.key ? 'di-mark is-active' : 'di-mark'} data-field={f.key}>{text.slice(f.start, f.end)}</mark>); at = f.end; }
  parts.push(text.slice(at));
  return <pre className="di-text" data-testid="di-text">{parts}</pre>;
}

function Review({ id }) {
  const t = useT('di');
  const { date } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['di', 'one', id], queryFn: () => read(`/ai/documents/${id}`), retry: false });
  const [values, setValues] = useState({});
  const [confirmed, setConfirmed] = useState([]);
  const [target, setTarget] = useState({});
  const [clauses, setClauses] = useState({});
  const [active, setActive] = useState(null);
  const [why, setWhy] = useState('');
  const done = () => cache.invalidateQueries({ queryKey: ['di'] });
  const accept = useMutation({ mutationFn: (body) => write(`/ai/documents/${id}/accept`, body), onSuccess: done });
  const reject = useMutation({ mutationFn: (body) => write(`/ai/documents/${id}/reject`, body), onSuccess: done });
  if (q.isPending) return <Skeleton label={t('detail')} rows={8} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const x = q.data;
  const isImage = /\.(png|jpe?g)$/i.test(x.fileName);
  const tg = x.targets ?? {};
  const pending = x.fields.filter((f) => f.mustConfirm && !confirmed.includes(f.key) && (values[f.key] === undefined || String(values[f.key]) === String(f.value)));
  const picked = Object.entries(clauses).filter(([, c]) => c.pick).map(([i, c]) => ({ index: Number(i), category: c.category, confirmed: Boolean(c.confirmed) }));
  const needsTarget = (x.docType === 'INVOICE' && !target.poId) || (x.docType === 'LETTER' && !target.projectId) || (x.docType === 'CONTRACT' && (!target.contractId || !picked.length));
  const submit = (e) => { e.preventDefault(); accept.mutate({ values, confirmed, target: Object.fromEntries(Object.entries(target).map(([k, v]) => [k, Number(v)])), ...(x.docType === 'CONTRACT' ? { clauses: picked } : {}), rowVersion: x.rowVersion }); };
  return <Card title={`${x.fileName}`} subtitle={`${x.docNo} · ${x.docTypeLabel} (${pct(x.classConfidence)}) · ${t(`engine.${x.engine}`)}`} testid="di-review" menu={<button type="button" className="btn" onClick={() => go({ id: '' })}>{t('back')}</button>}>
    <div className="actions-row"><StatusBadge status={STATUS_TONE[x.status]} label={t(`st.${x.status}`)} />{x.sla && <StatusBadge status={SLA_TONE[x.sla]} label={t(`sla.${x.sla}`, { h: x.ageHours })} size="sm" />}
      {x.duplicate && <StatusBadge status="AT_RISK" label={t(x.duplicate.kind === 'EXACT' ? 'dupExact' : 'dupNear', { name: x.duplicate.name, pct: pct(x.duplicate.similarity) })} />}</div>
    {x.reason && <p className="muted" role="status">{x.reason}</p>}
    <div className="di-split">
      <section className="di-doc" aria-label={t('document')}>
        {x.preview ? (isImage ? <img src={x.preview} alt={x.fileName} className="di-preview" /> : <p className="muted small"><a href={x.preview} target="_blank" rel="noreferrer">{t('openFile')}</a></p>) : <p className="muted small">{t('noPreview')}</p>}
        {x.text ? <SourceText text={x.text} fields={x.fields} active={active} /> : <EmptyState compact title={t('noText')} message={x.reason ?? ''} />}
      </section>
      <section className="di-fields" aria-label={t('fields')}>
        {x.status === 'ACCEPTED' && x.applied && <p role="status" data-testid="di-applied"><StatusBadge status="APPROVED" label={t('applied')} /> <Link to={x.applied.route}>{x.applied.label}</Link></p>}
        {x.status === 'REJECTED' && <p role="status">{t('rejectedBy', { by: x.reviewedBy, note: x.reviewNote })}</p>}
        <form onSubmit={submit} data-testid="di-form">
          {x.fields.map((f) => <div key={f.key} className="di-field" data-testid="di-field" data-key={f.key} onFocus={() => setActive(f.key)}>
            <Field name={`di-${f.key}`} label={`${f.label}${f.mustConfirm ? ' *' : ''}`} hint={f.quote ? t('from', { quote: f.quote }) : null}>
              <input value={values[f.key] ?? f.value ?? ''} inputMode={typeof f.value === 'number' ? 'decimal' : 'text'} disabled={!x.can.review} onChange={(e) => setValues({ ...values, [f.key]: typeof f.value === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value })} />
            </Field>
            <div className="actions-row"><StatusBadge status={f.mustConfirm ? 'AT_RISK' : 'APPROVED'} label={t('confidence', { pct: pct(f.confidence) })} size="sm" />
              {f.mustConfirm && x.can.review && <label className="di-confirm"><input type="checkbox" checked={confirmed.includes(f.key)} onChange={(e) => setConfirmed(e.target.checked ? [...confirmed, f.key] : confirmed.filter((k) => k !== f.key))} data-testid={`di-confirm-${f.key}`} /> {t('confirm')}</label>}</div>
          </div>)}
          {x.docType === 'CONTRACT' && <>
            {x.summary && <p className="muted small">{x.summary}</p>}
            <ul className="di-clauses" data-testid="di-clauses">{x.clauses.map((c) => { const s = clauses[c.index] ?? {}; return <li key={c.index}>
              <label><input type="checkbox" checked={Boolean(s.pick)} disabled={!x.can.review} onChange={(e) => setClauses({ ...clauses, [c.index]: { ...s, pick: e.target.checked, category: s.category ?? c.category } })} /> <strong>{c.clauseNo}</strong> {c.title}</label>
              <div className="muted small">{c.summary}{c.timeBarDays ? ` · ${t('timeBar', { n: c.timeBarDays })}` : ''}</div>
              <div className="actions-row"><label className="sr-only" htmlFor={`di-cat-${c.index}`}>{t('category')}</label><select id={`di-cat-${c.index}`} value={s.category ?? c.category} disabled={!x.can.review} onChange={(e) => setClauses({ ...clauses, [c.index]: { ...s, category: e.target.value } })}>{CATS.map((k) => <option key={k} value={k}>{t(`cat.${k}`)}</option>)}</select>
                <StatusBadge status={c.mustConfirm ? 'AT_RISK' : 'APPROVED'} label={t('confidence', { pct: pct(c.confidence) })} size="sm" />
                {c.mustConfirm && <label className="di-confirm"><input type="checkbox" checked={Boolean(s.confirmed)} disabled={!x.can.review} onChange={(e) => setClauses({ ...clauses, [c.index]: { ...s, confirmed: e.target.checked } })} /> {t('confirm')}</label>}</div>
            </li>; })}</ul>
          </>}
          {x.can.review && <>
            <h3>{tg.label ?? t('noTarget')}</h3>
            {x.docType === 'INVOICE' && <>
              <p className="muted small">{x.vendor ? t('vendorFound', { name: x.vendor.name }) : t('vendorMissing')}</p>
              <Field name="di-po" label={`${t('order')} *`}><select value={target.poId ?? ''} onChange={(e) => setTarget({ poId: e.target.value })}><option value="">{t('choose')}</option>{(tg.orders ?? []).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Field>
            </>}
            {x.docType === 'LETTER' && <Field name="di-project" label={`${t('project')} *`}><select value={target.projectId ?? ''} onChange={(e) => setTarget({ projectId: e.target.value })}><option value="">{t('choose')}</option>{(tg.projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></Field>}
            {x.docType === 'CONTRACT' && <Field name="di-contract" label={`${t('contract')} *`}><select value={target.contractId ?? ''} onChange={(e) => setTarget({ contractId: e.target.value })}><option value="">{t('choose')}</option>{(tg.contracts ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>}
            {x.docType === 'CERTIFICATE' && <p className="muted small">{tg.document ? t('certDoc', { doc: tg.document.label, until: tg.document.validUntil ? date(tg.document.validUntil) : '—' }) : t('certNoDoc')}</p>}
            {pending.length > 0 && <p className="muted small" role="status" data-testid="di-pending">{t('pending', { fields: pending.map((f) => f.label).join(', ') })}</p>}
            {accept.error && <ErrorState error={accept.error} />}
            <div className="actions-row di-actions">
              <button type="submit" className="btn btn-primary" disabled={accept.isPending || pending.length > 0 || needsTarget || !tg.kind} data-testid="di-accept">{t('accept')}</button>
            </div>
          </>}
        </form>
        {x.can.reject ? (<form className="form-grid" onSubmit={(e) => { e.preventDefault(); reject.mutate({ reason: why, rowVersion: x.rowVersion }); }}>
          <Field name="di-why" label={t('rejectWhy')}><input value={why} minLength={5} onChange={(e) => setWhy(e.target.value)} /></Field>
          <div className="actions-row di-actions"><button type="submit" className="btn" disabled={why.trim().length < 5 || reject.isPending} data-testid="di-reject">{t('reject')}</button></div>
          {reject.error && <ErrorState error={reject.error} />}
        </form>) : null}
      </section>
    </div>
  </Card>;
}

export function DocumentsPage() {
  const t = useT('di');
  const { number, dateTime } = useFormat();
  const search = useSearch();
  usePageTitle(t('title'));
  const id = search.get('id');
  const status = search.get('status') ?? 'OPEN'; const docType = search.get('docType') ?? ''; const text = search.get('q') ?? '';
  const [qText, setQText] = useState(text);
  const [format, setFormat] = useState('xlsx');
  const q = useQuery({ queryKey: ['di', 'list', status, docType, text], queryFn: () => read(`/ai/documents${qs({ status, docType, q: text })}`), retry: false, enabled: !id });
  const download = useMutation({ mutationFn: () => downloadReport(`/api/v1/ai/documents/export${qs({ status, docType, q: text, format })}`, `document-extractions.${format}`) });
  const header = <PageHeader id="di-h" title={t('title')} subtitle={t('subtitle')} />;
  if (id) return <section aria-labelledby="di-h" data-testid="di-page">{header}<Review id={id} /></section>;
  let body;
  if (q.isPending) body = <Skeleton label={t('title')} rows={6} />;
  else if (q.error?.status === 403) body = <NoPermission message={q.error.message} />;
  else if (q.error) body = <ErrorState error={q.error} onRetry={q.refetch} />;
  else {
    const d = q.data;
    body = <>
      <KpiRow testid="di-tiles" label={t('title')}>
        <KpiTile label={t('toReview')} value={number(Object.values(d.open).reduce((a, b) => a + b, 0), { decimals: 0 })} tone="warning" to="/ai/documents">{t('oldestFirst')}</KpiTile>
        {d.types.filter((x) => x.code !== 'OTHER').map((x) => <KpiTile key={x.code} label={t(`type.${x.code}`)} value={number(d.open[x.code] ?? 0, { decimals: 0 })} to={`/ai/documents?docType=${x.code}`} />)}
      </KpiRow>
      <div className="toolbar">
        <Field name="di-status" label={t('status')}><select value={status} onChange={(e) => go({ status: e.target.value === 'OPEN' ? '' : e.target.value })}>{['OPEN', 'ACCEPTED', 'REJECTED', 'ALL'].map((s) => <option key={s} value={s}>{t(`f.${s}`)}</option>)}</select></Field>
        <Field name="di-type" label={t('docType')}><select value={docType} onChange={(e) => go({ docType: e.target.value })}><option value="">{t('allTypes')}</option>{d.types.map((x) => <option key={x.code} value={x.code}>{t(`type.${x.code}`)}</option>)}</select></Field>
        <form onSubmit={(e) => { e.preventDefault(); go({ q: qText.trim().length >= 2 ? qText.trim() : '' }); }} role="search"><Field name="di-q" label={t('search')}><input type="search" inputMode="search" value={qText} onChange={(e) => setQText(e.target.value)} /></Field></form>
        <span className="actions-row"><label className="sr-only" htmlFor="di-format">{t('format')}</label><select id="di-format" value={format} onChange={(e) => setFormat(e.target.value)}>{['xlsx', 'csv', 'pdf'].map((x) => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select>
          <button type="button" className="btn" onClick={() => download.mutate()} disabled={download.isPending}>{t('export')}</button></span>
      </div>
      {download.error && <ErrorState error={download.error} />}
      <p className="muted small">{t('rule', { pct: pct(d.threshold) })}</p>
      {!d.rows.length ? <EmptyState title={t('empty')} message={t('emptyBody')} action={<Link to="/documents">{t('toRegister')}</Link>} /> :
        <Card title={t('queue')} count={{ shown: d.rows.length, total: d.total }} testid="di-card-queue">
          <div className="table-scroll"><table className="data-table" data-testid="di-queue">
            <thead><tr><th>{t('file')}</th><th>{t('docType')}</th><th>{t('sla')}</th><th className="num">{t('toConfirm')}</th><th>{t('status')}</th><th>{t('extracted')}</th></tr></thead>
            <tbody>{d.rows.map((r) => <tr key={r.id} data-testid="di-row" data-type={r.docType}>
              <td data-label={t('file')}><Link to={`/ai/documents?id=${r.id}`}>{r.fileName}</Link><div className="muted small">{r.docNo}{r.duplicate ? ` · ${t(r.duplicate.kind === 'EXACT' ? 'dupShortExact' : 'dupShortNear')}` : ''}</div></td>
              <td data-label={t('docType')}>{t(`type.${r.docType}`)} <span className="muted small">{pct(r.classConfidence)}</span></td>
              <td data-label={t('sla')}>{r.sla ? <StatusBadge status={SLA_TONE[r.sla]} label={t(`sla.${r.sla}`, { h: r.ageHours })} size="sm" /> : '—'}</td>
              <td data-label={t('toConfirm')} className="num">{number(r.lowConfidence, { decimals: 0 })}</td>
              <td data-label={t('status')}><StatusBadge status={STATUS_TONE[r.status]} label={t(`st.${r.status}`)} size="sm" /></td>
              <td data-label={t('extracted')}>{dateTime(r.extractedAt)}</td>
            </tr>)}</tbody>
          </table></div>
        </Card>}
    </>;
  }
  return <section aria-labelledby="di-h" data-testid="di-page">{header}{body}</section>;
}
