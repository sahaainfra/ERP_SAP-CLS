import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useT } from '../../platform/i18n/index.js';
import { ErrorState, NoPermission, Skeleton } from '../../platform/feedback/states.jsx';
import { Field, usePageTitle } from '../core/pages/ui.jsx';
import { useSession } from '../core/api/index.js';
import { ro } from './api.js';
import { useRunner } from './InvParts.jsx';
import PageHeader from '../../platform/design/PageHeader.jsx';

// Print Labels (part 16.07, FR-04): QR labels for items, bins and batches, on a thermal roll (50 x 25 mm) or an A4 sheet; every print is logged. The store screens scan the same code.
export default function LabelsPage() {
  const t = useT('inv'); usePageTitle(t('lb.title')); const session = useSession(); const perms = session.data?.permissions ?? [];
  const [type, setType] = useState('ITEM'); const [format, setFormat] = useState('THERMAL'); const [copies, setCopies] = useState('1'); const [storeId, setStoreId] = useState(''); const [q, setQ] = useState(''); const [picked, setPicked] = useState([]); const [out, setOut] = useState(null); const { error, run, busy } = useRunner();
  const tq = useQuery({ queryKey: ['inv', 'label-targets', q, storeId], queryFn: () => ro.targets({ q, storeId }), retry: false });
  if (tq.error?.status === 403 || (session.isSuccess && !perms.includes('inv.label.print'))) return <NoPermission what={t('lb.title')} permission="inv.label.print" />;
  const d = tq.data; const key = (r) => JSON.stringify(r);
  const choices = !d ? [] : type === 'ITEM' ? d.items.map((i) => ({ k: key({ itemId: i.id }), ref: { itemId: i.id }, label: `${i.code} · ${i.name}` })) : type === 'BIN' ? d.bins.map((b) => ({ k: key({ binId: b.id }), ref: { binId: b.id }, label: `${b.code}${b.zone ? ` · ${b.zone}` : ''}` })) : d.batches.map((b) => ({ k: key({ itemId: b.itemId, batchNo: b.batchNo }), ref: { itemId: b.itemId, batchNo: b.batchNo }, label: `${b.code} · ${b.batchNo}` }));
  const toggle = (k) => setPicked((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const go = async () => { const refs = choices.filter((c) => picked.includes(c.k)).map((c) => c.ref); const r = await run(() => ro.print({ type, format, copies: Number(copies) || 1, ...(storeId ? { storeId: Number(storeId) } : {}), refs })); if (r) setOut(r); };
  const sheetStyle = out?.format === 'A4' ? { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 } : { display: 'grid', gap: 8 };
  return (
    <section aria-labelledby="lb-h" data-testid="labels"><PageHeader id="lb-h" className="no-print" title={t('lb.title')} /><p className="muted no-print">{t('lb.intro')}</p>
      <style>{`@media print { .no-print { display: none !important; } ${out?.format === 'THERMAL' ? '@page { size: 50mm 25mm; margin: 1mm; } .label-card { page-break-after: always; }' : '@page { size: A4; margin: 8mm; }'} .label-card { border: 0 !important; } }`}</style>
      <div className="mdm-panel no-print"><div className="form-grid">
        <Field label={t('lb.type')} name="type" error={error}><select value={type} onChange={(ev) => { setType(ev.target.value); setPicked([]); setOut(null); }} style={{ minHeight: 44 }} data-testid="lb-type">{['ITEM', 'BIN', 'BATCH'].map((x) => <option key={x} value={x}>{t(`lb.t.${x}`)}</option>)}</select></Field>
        <Field label={t('lb.format')} name="format" error={error}><select value={format} onChange={(ev) => setFormat(ev.target.value)} style={{ minHeight: 44 }} data-testid="lb-format"><option value="THERMAL">{t('lb.f.THERMAL')}</option><option value="A4">{t('lb.f.A4')}</option></select></Field>
        {type !== 'ITEM' && <Field label={t('tr.store')} name="storeId" error={error}><select value={storeId} onChange={(ev) => { setStoreId(ev.target.value); setPicked([]); }} style={{ minHeight: 44 }} data-testid="lb-store"><option value="">—</option>{(d?.stores ?? []).map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>}
        {type !== 'BIN' && <Field label={t('lb.search')} name="q" error={null}><input value={q} onChange={(ev) => setQ(ev.target.value)} style={{ minHeight: 44 }} data-testid="lb-search" /></Field>}
        <Field label={t('lb.copies')} name="copies" error={error}><input type="number" min="1" max="100" value={copies} onChange={(ev) => setCopies(ev.target.value)} style={{ minHeight: 44 }} data-testid="lb-copies" /></Field></div>
        {error?.form && <p className="field-error" role="alert" data-testid="lb-error">{error.form}{error.fields ? ` ${Object.values(error.fields).join('; ')}` : ''}</p>}
        {tq.isPending ? <Skeleton label={t('lb.title')} rows={2} /> : tq.isError ? <ErrorState error={tq.error} onRetry={tq.refetch} /> : choices.length === 0 ? <p className="muted" data-testid="lb-empty">{type === 'ITEM' ? t('lb.noItems') : t('lb.pickStore')}</p> : <fieldset><legend>{t('lb.pick')}</legend>{choices.map((c) => <label key={c.k} className="check"><input type="checkbox" checked={picked.includes(c.k)} onChange={() => toggle(c.k)} data-testid={`lb-pick-${choices.indexOf(c)}`} /> {c.label}</label>)}</fieldset>}
        <div className="actions-row"><button type="button" className="btn btn-primary" style={{ minHeight: 48 }} disabled={busy || picked.length === 0} onClick={go} data-testid="lb-make">{t('lb.make', { n: picked.length })}</button>{out && <button type="button" className="btn" style={{ minHeight: 48 }} onClick={() => window.print()} data-testid="lb-print">{t('g.print')}</button>}</div></div>
      {out && <div data-testid="lb-sheet" style={sheetStyle}>{out.labels.flatMap((l, n) => Array.from({ length: out.copies }, (_, c) => (
        <div key={`${n}-${c}`} className="label-card mdm-panel" style={{ display: 'flex', gap: 8, alignItems: 'center', width: out.format === 'THERMAL' ? '50mm' : 'auto', minHeight: out.format === 'THERMAL' ? '25mm' : '40mm', padding: 4 }} data-testid={`lb-card-${n}-${c}`}>
          <span style={{ width: out.format === 'THERMAL' ? '20mm' : '30mm', flex: 'none' }} dangerouslySetInnerHTML={{ __html: l.svg }} /><span style={{ fontSize: out.format === 'THERMAL' ? 9 : 13, lineHeight: 1.2 }}><strong>{l.title}</strong>{l.lines.map((x) => <span key={x} style={{ display: 'block' }}>{x}</span>)}<span style={{ display: 'block', fontFamily: 'monospace' }}>{l.code}</span></span></div>)))}</div>}
    </section>
  );
}
