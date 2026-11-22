import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../platform/api/index.js';
import { Card } from '../../platform/design/Card.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';
import StatusBadge from '../../platform/design/StatusBadge.jsx';
import { EmptyState, ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { useFormat, useT } from '../../platform/i18n/index.js';
import { Field, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSearch } from '../eng/common.js';
import { downloadReport } from '../bi/api.js';

// Part 29.04: template packs by module (list report, UI v3 §3.1) and the bulk data entry workspace (form): a grid checked by the Excel
// engine on every edit, paste from Excel, a draft batch, and the batch submitted whole — approval-controlled data goes to the module approver
// before it is imported all or nothing. Bulk entry is desk work: on a phone the page says so and the grid scrolls inside its frame.

const read = async (path) => (await api.get(path)).data;
const send = (method, path, body) => api[method](path, body, { headers: { 'idempotency-key': globalThis.crypto.randomUUID() } });
const go = (patch) => {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(patch)) { if (v === '' || v == null) p.delete(k); else p.set(k, String(v)); }
  navigateTo(`/admin/bulk${p.toString() ? `?${p}` : ''}`);
};
const ST = { DRAFT: 'DRAFT', SUBMITTED: 'IN_REVIEW', RETURNED: 'RETURNED', REJECTED: 'REJECTED', IMPORTED: 'APPROVED', FAILED: 'REJECTED', CANCELLED: 'CANCELLED' };
const blank = (cols) => Object.fromEntries(cols.map((c) => [c.key, '']));
const filled = (r) => Object.values(r).some((v) => String(v ?? '').trim() !== '');

function Packs() {
  const t = useT('bk');
  const { dateTime } = useFormat();
  const cache = useQueryClient();
  const q = useQuery({ queryKey: ['bk', 'packs'], queryFn: () => read('/admin/bulk/packs'), retry: false });
  const [pub, setPub] = useState({});
  const dl = useMutation({ mutationFn: (p) => downloadReport(`/api/v1/admin/bulk/packs/${p.code}/download`, `${p.code}-pack-v${p.version}.zip`) });
  const publish = useMutation({ mutationFn: (p) => send('post', `/admin/bulk/packs/${p.code}/versions`, { instructions: pub[p.code]?.instructions ?? p.instructions, notes: pub[p.code]?.notes ?? '' }), onSuccess: () => { setPub({}); cache.invalidateQueries({ queryKey: ['bk', 'packs'] }); } });
  if (q.isPending) return <Skeleton label={t('tab.packs')} rows={5} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <>
    {(dl.error || publish.error) && <ErrorState error={dl.error ?? publish.error} />}
    <ul className="bk-cards" data-testid="bk-packs">{q.data.rows.map((p) => <li key={p.code} className="bk-card" data-testid="bk-pack" data-code={p.code}>
      <div className="actions-row"><strong>{p.name}</strong><StatusBadge status="APPROVED" label={t('version', { v: p.version })} size="sm" /></div>
      <p className="muted small">{p.module} · {t('published', { by: p.publishedBy, at: p.publishedAt ? dateTime(p.publishedAt) : t('builtIn') })}</p>
      <p className="small">{p.notes}</p>
      <ul className="bk-templates">{p.templates.map((x) => <li key={x.code} data-testid="bk-template">
        <span><strong>{x.label}</strong> <span className="muted small">{x.needsApproval ? t('approvedBy', { role: x.approver }) : t('ownFlow')}</span></span>
        {x.canImport ? <button type="button" className="btn" onClick={() => go({ tab: 'workspace', template: x.code, pack: p.code, batch: '' })} data-testid="bk-enter">{t('enter')}</button> : <span className="muted small">{t('noRight')}</span>}
      </li>)}</ul>
      {p.missing.length > 0 && <p className="muted small">{t('missing', { n: p.missing.length })}</p>}
      <div className="actions-row"><button type="button" className="btn btn-primary" disabled={dl.isPending} onClick={() => dl.mutate(p)} data-testid="bk-download">{t('download')}</button></div>
      <details className="bk-history"><summary>{t('history')}</summary><ul>{p.history.map((h) => <li key={h.version} className="small">v{h.version} · {t(`ps.${h.status}`)} · {h.notes} · {h.by}</li>)}</ul></details>
      {q.data.canManage && <details className="bk-history"><summary>{t('publish')}</summary>
        <form className="bk-form" onSubmit={(e) => { e.preventDefault(); publish.mutate(p); }}>
          <Field name={`bk-ins-${p.code}`} label={t('instructions')}><textarea rows={3} value={pub[p.code]?.instructions ?? p.instructions} onChange={(e) => setPub({ ...pub, [p.code]: { ...pub[p.code], instructions: e.target.value } })} maxLength={5000} /></Field>
          <Field name={`bk-notes-${p.code}`} label={t('notes')}><input value={pub[p.code]?.notes ?? ''} onChange={(e) => setPub({ ...pub, [p.code]: { ...pub[p.code], notes: e.target.value } })} required minLength={5} maxLength={500} /></Field>
          <button type="submit" className="btn" disabled={publish.isPending}>{t('publishBtn')}</button>
        </form></details>}
    </li>)}</ul>
  </>;
}

function Grid({ cols, rows, setRows, errors }) {
  const t = useT('bk');
  const paste = (r0, c0) => (e) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    const next = rows.map((r) => ({ ...r }));
    lines.forEach((cells, i) => {
      const ri = r0 + i; while (next.length <= ri) next.push(blank(cols));
      cells.forEach((v, j) => { const c = cols[c0 + j]; if (c) next[ri][c.key] = v.trim(); });
    });
    setRows(next);
  };
  const set = (ri, key, v) => setRows(rows.map((r, i) => (i === ri ? { ...r, [key]: v } : r)));
  return <div className="bk-grid-frame" role="region" aria-label={t('grid')} tabIndex={0}>
    <table className="bk-grid" data-testid="bk-grid">
      <thead><tr><th scope="col">#</th>{cols.map((c) => <th key={c.key} scope="col" title={c.help}>{c.label}{c.required ? ' *' : ''}</th>)}<th scope="col"><span className="sr-only">{t('remove')}</span></th></tr></thead>
      <tbody>{rows.map((r, ri) => <tr key={ri} data-testid="bk-row">
        <th scope="row">{ri + 1}</th>
        {cols.map((c, ci) => { const err = errors[`${ri}:${c.key}`]; const id = `bk-${ri}-${c.key}`; const props = { id, value: r[c.key] ?? '', 'aria-label': `${c.label} ${ri + 1}`, 'aria-invalid': err ? 'true' : undefined, title: err ?? c.help, className: err ? 'bk-bad' : undefined, onPaste: paste(ri, ci), 'data-cell': `${ri}:${c.key}` };
          return <td key={c.key}>{c.type === 'enum' || c.type === 'bool'
            ? <select {...props} onChange={(e) => set(ri, c.key, e.target.value)}><option value="" />{(c.values ?? []).map((v) => <option key={v} value={v}>{v}</option>)}</select>
            : <input {...props} inputMode={['int', 'decimal', 'money'].includes(c.type) ? 'decimal' : undefined} list={c.type === 'lookup' && c.values?.length ? `bk-list-${c.key}` : undefined} onChange={(e) => set(ri, c.key, e.target.value)} />}</td>; })}
        <td><button type="button" className="btn bk-x" aria-label={t('removeRow', { n: ri + 1 })} onClick={() => setRows(rows.length > 1 ? rows.filter((_, i) => i !== ri) : [blank(cols)])}>×</button></td>
      </tr>)}</tbody>
    </table>
    {cols.filter((c) => c.type === 'lookup' && c.values?.length).map((c) => <datalist key={c.key} id={`bk-list-${c.key}`}>{c.values.map((v) => <option key={v} value={v} />)}</datalist>)}
  </div>;
}

function Workspace() {
  const t = useT('bk');
  const { number } = useFormat();
  const cache = useQueryClient();
  const search = useSearch();
  const code = search.get('template') ?? '';
  const batchId = search.get('batch') ?? '';
  const packCode = search.get('pack') ?? '';
  const packs = useQuery({ queryKey: ['bk', 'packs'], queryFn: () => read('/admin/bulk/packs'), retry: false });
  const batchQ = useQuery({ queryKey: ['bk', 'batch', batchId], queryFn: () => read(`/admin/bulk/batches/${batchId}`), enabled: Boolean(batchId), retry: false });
  const tcode = batchQ.data?.templateCode ?? code;
  const colsQ = useQuery({ queryKey: ['bk', 'cols', tcode], queryFn: () => read(`/admin/bulk/templates/${tcode}`), enabled: Boolean(tcode), retry: false });
  const [rows, setRows] = useState([]);
  const [title, setTitle] = useState('');
  const [onExisting, setOnExisting] = useState('ERROR');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [summary, setSummary] = useState(null);
  const [batch, setBatch] = useState(null);
  const loadedFor = useRef('');
  const cols = useMemo(() => colsQ.data?.columns ?? [], [colsQ.data]);
  useEffect(() => {
    const k = `${tcode}:${batchId}:${batchQ.data?.rowVersion ?? ''}`;
    if (!cols.length || loadedFor.current === k || (batchId && !batchQ.data)) return;
    loadedFor.current = k;
    if (batchQ.data) { setRows([...batchQ.data.data.map((r) => ({ ...blank(cols), ...r })), blank(cols)]); setTitle(batchQ.data.title); setOnExisting(batchQ.data.onExisting); setBatch(batchQ.data); }
    else { setRows(Array.from({ length: 8 }, () => blank(cols))); setTitle(''); setBatch(null); }
  }, [cols, tcode, batchId, batchQ.data]);
  // FR-02: every edit is checked by the engine (debounced); the cells in error are highlighted with the reason
  useEffect(() => {
    if (!cols.length || !rows.some(filled)) { setErrors({}); setSummary(null); return undefined; }
    const timer = setTimeout(async () => {
      const idx = rows.map((r, i) => (filled(r) ? i : -1)).filter((i) => i >= 0);
      try {
        const res = (await api.post('/admin/bulk/check', { templateCode: tcode, rows: idx.map((i) => rows[i]), onExisting })).data.results;
        const map = {}; let bad = 0;
        for (const r of res) { if (r.errors.length) bad += 1; for (const e of r.errors) map[`${idx[r.line - 1]}:${e.column ?? cols[0].key}`] = e.message; }
        setErrors(map); setSummary({ rows: res.length, bad, create: res.filter((r) => r.action === 'CREATE').length, update: res.filter((r) => r.action === 'UPDATE').length, list: res.filter((r) => r.errors.length).slice(0, 8).map((r) => ({ row: idx[r.line - 1] + 1, text: r.errors.map((e) => e.message).join(' ') })) });
      } catch { /* the check runs again on the next edit */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [rows, cols, tcode, onExisting]);
  const save = useMutation({ mutationFn: () => {
    const body = { templateCode: tcode, title: title.trim(), rows: rows.filter(filled), onExisting, ...(packCode ? { packCode } : {}) };
    return batch ? send('put', `/admin/bulk/batches/${batch.id}`, { ...body, version: batch.rowVersion }) : send('post', '/admin/bulk/batches', body);
  }, onSuccess: (r) => { setBatch(r.data); loadedFor.current = `${tcode}:${r.data.id}:${r.data.rowVersion}`; go({ batch: r.data.id }); cache.invalidateQueries({ queryKey: ['bk', 'batches'] }); } });
  const submit = useMutation({ mutationFn: () => send('post', `/admin/bulk/batches/${batch.id}/submit`, { reason, version: batch.rowVersion }), onSuccess: (r) => { setBatch(r.data); cache.invalidateQueries({ queryKey: ['bk'] }); } });
  const importable = (packs.data?.rows ?? []).flatMap((p) => p.templates.filter((x) => x.canImport).map((x) => ({ ...x, pack: p.code, packName: p.name })));
  const locked = batch && !batch.canEdit;
  return <>
    <p className="bk-desk" data-testid="bk-desk">{t('desk')}</p>
    <div className="toolbar">
      <Field name="bk-template" label={t('template')}><select value={tcode} onChange={(e) => { const x = importable.find((i) => i.code === e.target.value); go({ template: e.target.value, pack: x?.pack ?? '', batch: '' }); }} disabled={Boolean(batchId)}>
        <option value="">{t('choose')}</option>{importable.map((x) => <option key={`${x.pack}-${x.code}`} value={x.code}>{x.packName} · {x.label}</option>)}</select></Field>
    </div>
    {!tcode ? <EmptyState title={t('pick')} message={t('pickBody')} action={<button type="button" className="btn" onClick={() => go({ tab: '' })}>{t('tab.packs')}</button>} />
      : colsQ.isPending || (batchId && batchQ.isPending) ? <Skeleton label={t('tab.workspace')} rows={6} />
      : colsQ.error ? (colsQ.error.status === 403 ? <NoPermission message={colsQ.error.message} /> : <ErrorState error={colsQ.error} onRetry={colsQ.refetch} />)
      : <Card title={colsQ.data.label} subtitle={colsQ.data.needsApproval ? t('needsApproval', { role: colsQ.data.approver }) : t('ownFlowLong')} testid="bk-workspace">
        {batch && <p className="small" data-testid="bk-batch">{batch.docNo} · <StatusBadge status={ST[batch.status]} label={t(`s.${batch.status}`)} size="sm" />{batch.result ? ` · ${t('result', { c: number(batch.result.created, { decimals: 0 }), u: number(batch.result.updated, { decimals: 0 }) })}` : ''}</p>}
        {batch?.rowErrors?.length > 0 && batch.status === 'FAILED' && <p role="alert" className="small bk-problem">{batch.rowErrors.flatMap((r) => r.errors.map((e) => e.message)).join(' ')}</p>}
        <div className="bk-form">
          <Field name="bk-title" label={t('title')}><input value={title} onChange={(e) => setTitle(e.target.value)} disabled={locked} maxLength={120} /></Field>
          <Field name="bk-existing" label={t('existing')}><select value={onExisting} onChange={(e) => setOnExisting(e.target.value)} disabled={locked}>{colsQ.data.onExisting.map((o) => <option key={o} value={o}>{t(`ex.${o}`)}</option>)}</select></Field>
        </div>
        <p className="muted small">{t('pasteHelp')}</p>
        <Grid cols={cols} rows={rows} setRows={locked ? () => {} : setRows} errors={errors} />
        <div className="actions-row bk-bar">
          <button type="button" className="btn" disabled={locked} onClick={() => setRows([...rows, ...Array.from({ length: 5 }, () => blank(cols))])}>{t('addRows')}</button>
          {summary && <span className="small" role="status" data-testid="bk-summary">{t('summary', { n: number(summary.rows, { decimals: 0 }), bad: number(summary.bad, { decimals: 0 }), c: number(summary.create, { decimals: 0 }), u: number(summary.update, { decimals: 0 }) })}</span>}
        </div>
        {summary?.list?.length > 0 && <ul className="bk-errors" data-testid="bk-errors">{summary.list.map((e) => <li key={e.row} className="small">{t('rowErr', { n: e.row, text: e.text })}</li>)}</ul>}
        {(save.error || submit.error) && <ErrorState error={save.error ?? submit.error} />}
        {!locked && <div className="bk-form">
          <button type="button" className="btn" disabled={save.isPending || title.trim().length < 3 || !rows.some(filled)} onClick={() => save.mutate()} data-testid="bk-save">{t('saveDraft')}</button>
          {batch && <><Field name="bk-reason" label={t('reason')}><input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} /></Field>
            <button type="button" className="btn btn-primary" disabled={submit.isPending || reason.trim().length < 5 || summary?.bad > 0} onClick={() => submit.mutate()} data-testid="bk-submit">{colsQ.data.needsApproval ? t('submit') : t('submitImport')}</button></>}
        </div>}
      </Card>}
  </>;
}

function Batches() {
  const t = useT('bk');
  const { dateTime, number } = useFormat();
  const cache = useQueryClient();
  const search = useSearch();
  const scope = search.get('scope') ?? 'mine';
  const status = search.get('status') ?? '';
  const q = useQuery({ queryKey: ['bk', 'batches', scope, status], queryFn: () => read(`/admin/bulk/batches?scope=${scope}${status ? `&status=${status}` : ''}`), retry: false });
  const [comment, setComment] = useState({});
  const act = useMutation({ mutationFn: ({ b, action }) => send('post', `/admin/bulk/batches/${b.id}/act`, { action, comment: comment[b.id] || undefined }), onSuccess: () => cache.invalidateQueries({ queryKey: ['bk'] }) });
  const cancel = useMutation({ mutationFn: (b) => send('post', `/admin/bulk/batches/${b.id}/cancel`, {}), onSuccess: () => cache.invalidateQueries({ queryKey: ['bk'] }) });
  if (q.isPending) return <Skeleton label={t('tab.batches')} rows={4} />;
  if (q.error?.status === 403) return <NoPermission message={q.error.message} />;
  if (q.error) return <ErrorState error={q.error} onRetry={q.refetch} />;
  return <>
    <div className="toolbar">
      <Field name="bk-scope" label={t('show')}><select value={scope} onChange={(e) => go({ scope: e.target.value === 'mine' ? '' : e.target.value })}><option value="mine">{t('sc.mine')}</option><option value="approve">{t('sc.approve', { n: q.data.awaiting })}</option>{q.data.canViewAll && <option value="all">{t('sc.all')}</option>}</select></Field>
      <Field name="bk-status" label={t('status')}><select value={status} onChange={(e) => go({ status: e.target.value })}><option value="">{t('all')}</option>{Object.keys(ST).map((s) => <option key={s} value={s}>{t(`s.${s}`)}</option>)}</select></Field>
    </div>
    {(act.error || cancel.error) && <ErrorState error={act.error ?? cancel.error} />}
    {!q.data.rows.length ? <EmptyState title={t('noBatches')} message={t('noBatchesBody')} action={<button type="button" className="btn" onClick={() => go({ tab: '', scope: '', status: '' })}>{t('tab.packs')}</button>} /> :
      <Card title={t('tab.batches')} count={{ shown: q.data.rows.length, total: q.data.total }} testid="bk-batches">
        <ul className="bk-cards">{q.data.rows.map((b) => <li key={b.id} className="bk-card" data-testid="bk-batch-card">
          <div className="actions-row"><strong>{b.docNo} · {b.title}</strong><StatusBadge status={ST[b.status]} label={t(`s.${b.status}`)} size="sm" /></div>
          <p className="muted small">{b.template} · {t('rowsN', { n: number(b.rows, { decimals: 0 }), e: number(b.errors, { decimals: 0 }) })} · {b.by} · {dateTime(b.createdAt)}</p>
          {b.needsApproval && <p className="muted small">{t('approvedBy', { role: b.approver })}</p>}
          {b.result && <p className="small">{t('result', { c: number(b.result.created, { decimals: 0 }), u: number(b.result.updated, { decimals: 0 }) })}</p>}
          <div className="actions-row">
            {(b.canEdit || b.status !== 'DRAFT') && <button type="button" className="btn" onClick={() => go({ tab: 'workspace', batch: b.id, template: b.templateCode, scope: '', status: '' })}>{b.canEdit ? t('open') : t('view')}</button>}
            {b.canEdit && b.status !== 'FAILED' && <button type="button" className="btn" disabled={cancel.isPending} onClick={() => cancel.mutate(b)}>{t('cancel')}</button>}
          </div>
          {b.canApprove && b.status === 'SUBMITTED' && <div className="bk-decide">
            <Field name={`bk-c-${b.id}`} label={t('comment')}><input value={comment[b.id] ?? ''} onChange={(e) => setComment({ ...comment, [b.id]: e.target.value })} /></Field>
            <div className="actions-row"><button type="button" className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate({ b, action: 'approve' })} data-testid="bk-approve">{t('approve')}</button>
              <button type="button" className="btn" disabled={act.isPending || (comment[b.id] ?? '').trim().length < 5} onClick={() => act.mutate({ b, action: 'return' })}>{t('return')}</button>
              <button type="button" className="btn" disabled={act.isPending || (comment[b.id] ?? '').trim().length < 5} onClick={() => act.mutate({ b, action: 'reject' })}>{t('reject')}</button></div>
          </div>}
        </li>)}</ul>
      </Card>}
  </>;
}

export function BulkEntry() {
  const t = useT('bk');
  const search = useSearch();
  usePageTitle(t('pageTitle'));
  const tabs = ['packs', 'workspace', 'batches'];
  const tab = tabs.includes(search.get('tab')) ? search.get('tab') : 'packs';
  return <section aria-labelledby="bk-h" data-testid="bk-page">
    <PageHeader id="bk-h" title={t('pageTitle')} subtitle={t('subtitle')} />
    <div role="tablist" aria-label={t('pageTitle')} className="tabs" data-testid="bk-tabs">{tabs.map((k) => <button key={k} type="button" role="tab" aria-selected={tab === k} data-tab={k} className={`btn${tab === k ? ' btn-primary' : ''}`} onClick={() => go({ tab: k === 'packs' ? '' : k, template: '', batch: '', pack: '', scope: '', status: '' })}>{t(`tab.${k}`)}</button>)}</div>
    {tab === 'packs' && <Packs />}
    {tab === 'workspace' && <Workspace />}
    {tab === 'batches' && <Batches />}
  </section>;
}
