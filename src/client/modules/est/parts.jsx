import { useEffect, useState } from 'react';
import { useT } from '../../platform/i18n/index.js';
import { AttachmentList, FileUploader } from '../core/components/Attachments.jsx';
import { fetchFileUrl, useFiles } from '../core/api/index.js';

/** The query of the address, followed when the page moves to another record of the same route. */
export function useSearch() {
  const [search, setSearch] = useState(window.location.search);
  useEffect(() => { const on = () => setSearch(window.location.search); window.addEventListener('popstate', on); return () => window.removeEventListener('popstate', on); }, []);
  return new URLSearchParams(search);
}
/** The tabs of the estimate: a tab list a keyboard walks with the arrow keys. */
export function Tabs({ tabs, active, onChange, label }) {
  const t = useT('est');
  const move = (e, i) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length; onChange(tabs[n]); document.getElementById(`etab-${tabs[n]}`)?.focus(); } };
  return (
    <div role="tablist" aria-label={label} className="tabs no-print" data-testid="tabs">
      {tabs.map((k, i) => <button key={k} id={`etab-${k}`} type="button" role="tab" aria-selected={active === k} tabIndex={active === k ? 0 : -1} className={`btn${active === k ? ' btn-primary' : ''}`} onClick={() => onChange(k)} onKeyDown={(e) => move(e, i)} data-testid={`tab-${k}`}>{t(`tab.${k}`)}</button>)}
    </div>
  );
}
/** An estimate chosen from the list (for the reports and the import). */
export function EstimatePicker({ id, value, onChange, rows, label }) {
  return <label htmlFor={id}>{label} <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} data-testid={id}><option value="">–</option>{rows.map((r) => <option key={r.id} value={r.id}>{r.ref} · {r.title} ({r.statusLabel})</option>)}</select></label>;
}

/** The drawing beside the sheet (FR-01): the files attached to the record, the chosen one shown (an image or a PDF), the others a click away. */
export function DrawingViewer({ entity, entityId, canEdit }) {
  const t = useT('est');
  const files = useFiles({ entity, entityId });
  const [pick, setPick] = useState(null); const [url, setUrl] = useState(null);
  const list = (files.data ?? []).filter((f) => f.current !== false);
  const shown = list.find((f) => f.id === pick) ?? list.find((f) => f.scanStatus === 'CLEAN');
  useEffect(() => { let live = true; setUrl(null); if (shown?.scanStatus === 'CLEAN') fetchFileUrl(shown.id).then((l) => live && setUrl(l.url)).catch(() => {}); return () => { live = false; }; }, [shown?.id, shown?.scanStatus]);
  const ext = String(shown?.extension ?? '').toLowerCase();
  return (
    <aside className="mdm-panel" aria-label={t('to.drawing')} data-testid="drawing-viewer">
      <h2>{t('to.drawing')}</h2>
      {list.length > 1 && <select value={shown?.id ?? ''} onChange={(e) => setPick(Number(e.target.value))} aria-label={t('to.drawingPick')}>{list.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>}
      {!shown ? <p className="muted">{t('to.noDrawing')}</p> : !url ? <p className="muted">{shown.scanStatus === 'CLEAN' ? '…' : t('to.scanning')}</p>
        : ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? <img src={url} alt={shown.name} style={{ maxWidth: '100%' }} data-testid="drawing-image" />
          : ext === 'pdf' ? <iframe src={url} title={shown.name} style={{ width: '100%', minHeight: 420, border: 0 }} />
            : <a href={url} target="_blank" rel="noreferrer">{shown.name}</a>}
      {canEdit && <FileUploader entity={entity} entityId={entityId} />}
      <AttachmentList entity={entity} entityId={entityId} canEdit={canEdit} />
    </aside>
  );
}
