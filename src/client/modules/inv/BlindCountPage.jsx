import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Link, navigateTo, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { useSearch } from '../site/parts.jsx';
import { cn } from './api.js';
import { useRunner } from './InvParts.jsx';

// Blind Count (part 16.06, FR-02), made for the phone in the yard: the counter sees the item and the bin, never the book quantity; scanning or typing the item code finds the line; a difference beyond the tolerance comes back as a recount for another person.
function Sheet({ t, id }) {
  const q = useQuery({ queryKey: ['inv', 'sheet', id], queryFn: () => cn.sheet(id), retry: false }); const { error, note, busy, run } = useRunner(); const [vals, setVals] = useState({}); const [scan, setScan] = useState(''); const [mode, setMode] = useState('count');
  if (q.error?.status === 403 || q.error?.status === 404) return <NoPermission what={t('cn.blindTitle')} permission="inv.count_plan.count" />;
  if (q.isPending) return <Skeleton label={t('cn.blindTitle')} rows={4} />; if (q.isError) return <ErrorState error={q.error} onRetry={q.refetch} />;
  const s = q.data; const recount = mode === 'recount'; const lines = s.lines.filter((l) => (recount ? l.needsRecount && !l.recounted : !l.counted)).filter((l) => !scan || l.itemCode.toLowerCase().includes(scan.trim().toLowerCase()) || l.item.toLowerCase().includes(scan.trim().toLowerCase()));
  const send = async () => { const list = lines.filter((l) => vals[l.id] !== undefined && vals[l.id] !== '').map((l) => ({ lineId: l.id, qty: Number(vals[l.id]) })); if (!list.length) return; const r = await run(() => cn.counts(id, { lines: list, ...(recount ? { recount: true } : {}) }), t('cn.saved')); if (r) setVals({}); };
  const left = s.lines.filter((l) => !l.counted).length; const need = s.lines.filter((l) => l.needsRecount && !l.recounted).length;
  return (
    <section aria-labelledby="bc-h" data-testid="blind-sheet"><h1 id="bc-h">{s.docNo} · {s.store}</h1><p className="muted">{t('cn.blindIntro')}</p><p><Link to={`/inv/count-plans?id=${id}`}>{t('cn.title')}</Link> · <span data-testid="sheet-left">{t('cn.leftToCount', { n: left })}</span> · <span data-testid="sheet-recount">{t('cn.recountLines', { n: need })}</span></p>
      {error?.form && <p className="field-error" role="alert" data-testid="sheet-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}{note && <p className="mdm-banner" role="status" data-testid="sheet-note">{note}</p>}
      <div className="actions-row"><button type="button" className={`btn${recount ? '' : ' btn-primary'}`} style={{ minHeight: 48 }} onClick={() => setMode('count')} data-testid="mode-count">{t('cn.count')}</button><button type="button" className={`btn${recount ? ' btn-primary' : ''}`} style={{ minHeight: 48 }} onClick={() => setMode('recount')} data-testid="mode-recount">{t('cn.recount')}</button></div>
      <label>{t('cn.scanItem')}<input value={scan} onChange={(ev) => setScan(ev.target.value)} inputMode="search" autoComplete="off" style={{ minHeight: 48 }} data-testid="sheet-scan" /></label>
      {lines.length === 0 ? <div className="mdm-panel" data-testid="sheet-empty"><h2>{t('cn.sheetEmptyTitle')}</h2><p>{t('cn.sheetEmptyBody')}</p></div> : (
        <ul className="card-list" data-testid="sheet-lines">{lines.map((l) => <li key={l.id} className="mdm-panel" data-testid={`sheet-line-${l.lineNo}`}><strong>{l.item}</strong><div className="muted">{l.bin}{l.batchNo ? ` · ${l.batchNo}` : ''} · {l.uom}</div>
          <label>{t('cn.qtyFound')}<input type="number" inputMode="decimal" min="0" step="any" value={vals[l.id] ?? ''} onChange={(ev) => setVals({ ...vals, [l.id]: ev.target.value })} style={{ minHeight: 56, fontSize: 20 }} data-testid={`sheet-qty-${l.lineNo}`} /></label></li>)}</ul>)}
      <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} disabled={busy || lines.length === 0} onClick={send} data-testid="sheet-save">{t('cn.saveCounts')}</button></div>
    </section>
  );
}
export default function BlindCountPage() {
  const t = useT('inv'); usePageTitle(t('cn.blindTitle')); const sp = useSearch(); const id = Number(sp.get('id')) || null; const session = useSession(); const perms = session.data?.permissions ?? [];
  const qq = useQuery({ queryKey: ['inv', 'count-queue'], queryFn: cn.queue, retry: false, enabled: !id });
  if (session.isSuccess && !perms.includes('inv.count_plan.count')) return <NoPermission what={t('cn.blindTitle')} permission="inv.count_plan.count" />;
  if (id) return <Sheet key={id} t={t} id={id} />;
  if (qq.isPending) return <Skeleton label={t('cn.blindTitle')} rows={3} />; if (qq.isError) return <ErrorState error={qq.error} onRetry={qq.refetch} />;
  return (
    <section aria-labelledby="bq-h" data-testid="blind-queue"><h1 id="bq-h">{t('cn.blindTitle')}</h1><p className="muted">{t('cn.blindIntro')}</p>
      {qq.data.length === 0 ? <div className="mdm-panel" data-testid="blind-empty"><h2>{t('cn.queueEmptyTitle')}</h2><p>{t('cn.queueEmptyBody')}</p></div> : (
        <ul className="card-list">{qq.data.map((p) => <li key={p.id} className="mdm-panel" data-testid={`queue-${p.id}`}><strong>{p.docNo}</strong> · {p.store}<div className="muted">{t('cn.progressOf', { d: p.done, n: p.total })}</div><button type="button" className="btn btn-primary" style={{ minHeight: 56 }} onClick={() => navigateTo(`/inv/blind-count?id=${p.id}`)} data-testid={`queue-open-${p.id}`}>{t('cn.countNow')}</button></li>)}</ul>)}
    </section>
  );
}
