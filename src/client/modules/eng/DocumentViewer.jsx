import { useEffect, useRef, useState } from 'react';
import { ErrorState, Skeleton } from '../../platform/feedback/states.jsx';
import { fetchContent, saveBlob, useAddAnnotation, useAnnotations, useSetAnnotation } from '../../platform/documents/api.js';
import { errorInfo } from '../core/pages/ui.jsx';

// The viewer (part 04.10, FR-07): a PDF is drawn page by page in the browser (pdf.js), a picture as it is; markups are drawn over each page as a layer and saved with the revision, never in the file.
// The file is fetched with the person's own sign-in, so a link cannot be passed on. Coordinates of a markup are fractions of the page, so they stay put at any size.
const TOOLS = [['', 'Look'], ['rect', 'Box'], ['ellipse', 'Circle'], ['arrow', 'Arrow'], ['pen', 'Pencil'], ['note', 'Note']];
const COLORS = { red: 'var(--erp-color-status-error-solid)', blue: 'var(--erp-color-status-info-solid)', green: 'var(--erp-color-status-success-solid)', orange: 'var(--erp-color-status-warning-solid)' };
const MAX_PAGES = 60;

function Shape({ s, w, h, dim }) {
  const stroke = COLORS[s.color ?? 'red'];
  const common = { style: { stroke, strokeWidth: 2, fill: 'none', opacity: dim ? 0.35 : 1 }, vectorEffect: 'non-scaling-stroke' }; // a colour from the design tokens works in a style, not in an attribute
  if (s.kind === 'rect') return <rect x={Math.min(s.x, s.x + s.w) * w} y={Math.min(s.y, s.y + s.h) * h} width={Math.abs(s.w) * w} height={Math.abs(s.h) * h} {...common} />;
  if (s.kind === 'ellipse') return <ellipse cx={(s.x + s.w / 2) * w} cy={(s.y + s.h / 2) * h} rx={Math.abs(s.w / 2) * w} ry={Math.abs(s.h / 2) * h} {...common} />;
  if (s.kind === 'arrow') {
    const x1 = s.x * w; const y1 = s.y * h; const x2 = s.x2 * w; const y2 = s.y2 * h;
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = (d) => `${x2 - 12 * Math.cos(a + d)},${y2 - 12 * Math.sin(a + d)}`;
    return <g {...common}><line x1={x1} y1={y1} x2={x2} y2={y2} /><polyline points={`${head(0.4)} ${x2},${y2} ${head(-0.4)}`} /></g>;
  }
  if (s.kind === 'pen') return <polyline points={(s.points ?? []).map(([x, y]) => `${x * w},${y * h}`).join(' ')} {...common} />;
  return <g opacity={dim ? 0.35 : 1}><circle cx={s.x * w} cy={s.y * h} r="9" style={{ fill: stroke }} /><text x={s.x * w + 14} y={s.y * h + 4} fontSize="13" style={{ fill: stroke }}>{s.text ?? ''}</text></g>;
}

function Layer({ page, width, height, tool, color, items, canMark, onDone }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(null);
  const at = (e) => { const r = ref.current.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const down = (e) => {
    if (!tool || !canMark) return;
    e.preventDefault();
    ref.current.setPointerCapture?.(e.pointerId);
    const [x, y] = at(e);
    setDraft(tool === 'pen' ? { kind: 'pen', points: [[x, y]], color } : { kind: tool, x, y, w: 0, h: 0, x2: x, y2: y, color });
  };
  const move = (e) => {
    if (!draft) return;
    const [x, y] = at(e);
    setDraft((d) => (d.kind === 'pen' ? { ...d, points: [...d.points, [x, y]].slice(-400) } : { ...d, w: x - d.x, h: y - d.y, x2: x, y2: y }));
  };
  const up = () => {
    if (!draft) return;
    const d = draft;
    setDraft(null);
    const tiny = d.kind === 'pen' ? d.points.length < 3 : d.kind !== 'note' && Math.hypot(d.x2 - d.x, d.y2 - d.y) < 0.01;
    if (!tiny) onDone(page, d.kind === 'pen' ? { kind: 'pen', points: d.points, color: d.color } : d.kind === 'arrow' ? { kind: 'arrow', x: d.x, y: d.y, x2: d.x2, y2: d.y2, color: d.color } : d.kind === 'note' ? { kind: 'note', x: d.x, y: d.y, color: d.color } : { kind: d.kind, x: d.x, y: d.y, w: d.w, h: d.h, color: d.color });
  };
  return (
    <svg ref={ref} className="doc-layer" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Markups on page ${page}`} data-testid={`layer-${page}`} style={{ touchAction: tool ? 'none' : 'auto', cursor: tool && canMark ? 'crosshair' : 'default' }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
      {items.map((a) => <Shape key={a.id} s={a.shape} w={width} h={height} dim={a.resolved} />)}
      {draft && <Shape s={draft} w={width} h={height} />}
    </svg>
  );
}

function PdfPages({ buffer, render }) {
  const [pages, setPages] = useState(null);
  const [error, setError] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist/build/pdf.min.mjs');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer.slice(0)) }).promise;
        const avail = Math.max(280, Math.min(900, (box.current?.clientWidth ?? 800) - 8));
        const out = [];
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n += 1) {
          const page = await pdf.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = avail / base.width;
          const vp = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width * 2);
          canvas.height = Math.floor(vp.height * 2);
          const ctx = canvas.getContext('2d');
          ctx.scale(2, 2);
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
          out.push({ n, url: canvas.toDataURL('image/png'), width: Math.floor(vp.width), height: Math.floor(vp.height) });
          if (dead) return;
        }
        if (!dead) setPages({ list: out, total: pdf.numPages });
      } catch (e) { if (!dead) setError(e); }
    })();
    return () => { dead = true; };
  }, [buffer]);
  return (
    <div ref={box} data-testid="pdf-pages">
      {error && <p role="alert" className="error">The page could not be drawn: {String(error.message ?? error)}</p>}
      {!pages && !error && <Skeleton label="Drawing the pages" rows={3} />}
      {pages && pages.total > MAX_PAGES && <p className="muted small">Showing the first {MAX_PAGES} of {pages.total} pages. Download the file to see the rest.</p>}
      {pages?.list.map((p) => render(p))}
    </div>
  );
}

export default function DocumentViewer({ version, canMark }) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [tool, setTool] = useState('');
  const [color, setColor] = useState('red');
  const [comment, setComment] = useState('');
  const [note, setNote] = useState('');
  const [fail, setFail] = useState(null);
  const ann = useAnnotations(version.id);
  const add = useAddAnnotation();
  const set = useSetAnnotation();
  const [img, setImg] = useState(null);
  useEffect(() => {
    let dead = false;
    let url = null;
    setFile(null); setError(null); setImg(null);
    fetchContent(version.id).then((f) => {
      if (dead) return;
      setFile(f);
      if (/^image\//.test(f.type)) { url = URL.createObjectURL(new Blob([f.buffer], { type: f.type })); setImg(url); }
    }).catch((e) => !dead && setError(e));
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [version.id]);
  if (error) return <ErrorState title="The file could not be opened" error={error} />;
  if (!file) return <Skeleton label="Opening the file" rows={3} />;
  const items = ann.data ?? [];
  const isPdf = file.type === 'application/pdf';
  const save = (page, shape) => { setFail(null); add.mutate({ versionId: version.id, page, shape, ...(comment ? { comment } : {}) }, { onSuccess: () => setComment(''), onError: (e) => setFail(errorInfo(e)) }); };
  const layer = (page, w, h) => <Layer key={`l${page}`} page={page} width={w} height={h} tool={tool} color={color} items={items.filter((a) => a.page === page)} canMark={canMark} onDone={save} />;
  return (
    <div data-testid="doc-viewer">
      {file.watermark && <p role="status" className="notice" data-testid="viewer-watermark">This revision was superseded. {file.watermark === 'applied' ? 'The copy carries a watermark.' : 'The kind of file cannot carry a watermark; do not use it.'}</p>}
      <div className="srch-tools" role="toolbar" aria-label="Markup tools">
        {TOOLS.map(([k, l]) => <button key={k} type="button" className={`btn${tool === k ? ' btn-primary' : ''}`} aria-pressed={tool === k} disabled={Boolean(k) && !canMark} onClick={() => setTool(k)}>{l}</button>)}
        <label className="field"><span>Colour</span><select value={color} onChange={(e) => setColor(e.target.value)}>{Object.keys(COLORS).map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="field"><span>Comment for the next markup</span><input value={comment} maxLength={300} onChange={(e) => setComment(e.target.value)} /></label>
        <button type="button" className="btn" onClick={() => saveBlob(file.buffer, file.type, file.name)}>Download this revision</button>
      </div>
      <p className="muted small">Markups are kept as a layer over the revision; the file itself is never changed.{!canMark ? ' You may look at the markups but not add any.' : ''}</p>
      {fail?.form && <p role="alert" className="error">{fail.form}</p>}
      <div className="doc-pages">
        {isPdf && <PdfPages buffer={file.buffer} render={(p) => (
          <div key={p.n} className="doc-page" style={{ width: p.width, height: p.height }} data-testid={`page-${p.n}`}><img src={p.url} width={p.width} height={p.height} alt={`Page ${p.n}`} />{layer(p.n, p.width, p.height)}</div>)} />}
        {img && <div className="doc-page" style={{ maxWidth: '100%' }} data-testid="page-1"><ImageWithLayer src={img} layer={layer} /></div>}
        {!isPdf && !img && <p className="muted">This kind of file ({file.name.split('.').pop()}) cannot be shown here. Download it to open it.</p>}
      </div>
      <section aria-label="Markups" data-testid="markup-list">
        <h3>Markups ({items.length})</h3>
        {items.length === 0 ? <p className="muted">No markups yet.</p> : (
          <ul>{items.map((a) => (
            <li key={a.id} data-testid={`markup-${a.id}`}><strong>{a.user}</strong>, page {a.page}, {a.shape.kind}{a.comment ? `: ${a.comment}` : ''}{a.resolved ? ' (resolved)' : ''}
              {canMark && <> <button type="button" className="btn btn-small" onClick={() => set.mutate({ id: a.id, resolved: !a.resolved })}>{a.resolved ? 'Reopen' : 'Resolve'}</button> <button type="button" className="btn btn-small" aria-label={`Remove markup ${a.id}`} onClick={() => { setNote(''); set.mutate({ id: a.id, remove: true }, { onError: (e) => setFail(errorInfo(e)) }); }}>Remove</button></>}</li>))}</ul>)}
        <span className="sr-only">{note}</span>
      </section>
    </div>
  );
}

function ImageWithLayer({ src, layer }) {
  const [size, setSize] = useState(null);
  return (
    <div style={{ position: 'relative', width: size?.w, maxWidth: '100%' }}>
      <img src={src} alt="The revision" style={{ display: 'block', maxWidth: '100%', height: 'auto' }} onLoad={(e) => setSize({ w: e.currentTarget.clientWidth, h: e.currentTarget.clientHeight })} data-testid="doc-image" />
      {size && layer(1, size.w, size.h)}
    </div>
  );
}
