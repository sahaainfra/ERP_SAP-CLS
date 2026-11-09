import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { forbidden } from '../../platform/http/errors.js';
import { woffToSfnt } from '../eng/tpl-pdf.js';
import { isoOf, ordOf } from './cpm.js';

// The printable programme (part 13.02, FR-04): the Gantt laid out once on paper (A3 or A1, landscape) and written as PDF pages or as one SVG image. The layout is a list of shapes on a page in points
// (top-left origin), so the PDF and the image show the same thing and a test can check what is drawn: the activities on each page, the size of the text and the pitch of the rows (T-02).
// Each page repeats the title block, the column heads, the time scale and the legend; WBS nodes are summary rows; critical work is red, the rest blue, the done part darker; milestones are diamonds;
// the data date is a dashed line; links are drawn when both ends are on the same page.
const require = createRequire(import.meta.url);
export const PAPER = { A3: { w: 1190.55, h: 841.89, k: 1 }, A1: { w: 2383.94, h: 1683.78, k: 1.45 }, IMAGE: { w: 1600, h: 0, k: 1.1 } };
const COLOURS = { crit: [0.776, 0.157, 0.157], critDone: [0.48, 0.05, 0.05], norm: [0.082, 0.396, 0.753], normDone: [0.03, 0.2, 0.45], summary: [0.13, 0.13, 0.13], grid: [0.86, 0.86, 0.86], head: [0.94, 0.95, 0.97], text: [0.1, 0.1, 0.1], muted: [0.38, 0.38, 0.38], dataDate: [0.8, 0.33, 0], link: [0.45, 0.45, 0.45], band: [0.975, 0.975, 0.975] };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => (iso ? `${iso.slice(8, 10)}-${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(2, 4)}` : '');

/**
 * Lay the programme out. `rows` are { kind: 'wbs', label, level, start, finish } or { kind: 'act', id, code, name, duration, es, ef, totalFloat, critical, type, pct, done }; `links` are { predId, succId, type }.
 * Returns { pages: [{ w, h, shapes, rowIds }], meta: { rowsPerPage, fontSize, rowPitch, from, to } }.
 */
export function layoutProgramme({ title, lines = [], rows, links = [], from, to, dataDate = null, paper = 'A3', scale = 'week', showLinks = true, footer = '' }) {
  const P = PAPER[paper]; const k = P.k; const M = 22 * k; const font = 7 * k; const pitch = 11 * k; const headH = 46 * k; const scaleH = 24 * k; const legendH = 18 * k;
  const cols = [{ key: 'code', label: 'Code', w: 56 }, { key: 'name', label: 'Activity', w: 176 }, { key: 'duration', label: 'Dur', w: 26, right: true }, { key: 'start', label: 'Start', w: 46 }, { key: 'finish', label: 'Finish', w: 46 }, { key: 'tf', label: 'TF', w: 24, right: true }].map((c) => ({ ...c, w: c.w * k }));
  const tableW = cols.reduce((a, c) => a + c.w, 0); const W = P.w; const x0 = M + tableW; const tlW = W - M - x0;
  const f0 = ordOf(from); const days = Math.max(1, ordOf(to) - f0 + 1); const dayW = tlW / days; const X = (iso) => x0 + (ordOf(iso) - f0) * dayW;
  const perPage = paper === 'IMAGE' ? Math.max(1, rows.length) : Math.max(1, Math.floor((P.h - 2 * M - headH - scaleH - legendH) / pitch));
  const H = paper === 'IMAGE' ? 2 * M + headH + scaleH + legendH + Math.max(1, rows.length) * pitch : P.h;
  const chunks = []; for (let i = 0; i < Math.max(1, rows.length); i += perPage) chunks.push(rows.slice(i, i + perPage));
  // the time scale: major ticks (months, or years) and minor ticks by the chosen scale
  const ticks = { major: [], minor: [] };
  for (let o = f0; o < f0 + days; o += 1) {
    const iso = isoOf(o); const d = iso.slice(8, 10); const m = Number(iso.slice(5, 7)); const wd = (o + 3) % 7;
    const majorStart = scale === 'month' || scale === 'quarter' ? (d === '01' && m === 1) || o === f0 : d === '01' || o === f0;
    if (majorStart) ticks.major.push({ o, label: scale === 'month' || scale === 'quarter' ? iso.slice(0, 4) : `${MONTHS[m - 1]} ${iso.slice(0, 4)}` });
    if (scale === 'day') ticks.minor.push({ o, label: String(Number(d)) });
    else if (scale === 'week' && wd === 0) ticks.minor.push({ o, label: String(Number(d)) });
    else if (scale === 'month' && d === '01') ticks.minor.push({ o, label: MONTHS[m - 1] });
    else if (scale === 'quarter' && d === '01' && [1, 4, 7, 10].includes(m)) ticks.minor.push({ o, label: `Q${(m + 2) / 3}` });
  }
  const minGap = (scale === 'day' ? 9 : 14) * k; // a label is drawn only where there is room for it
  const pages = chunks.map((chunk, p) => {
    const shapes = []; const rect = (x, y, w, h, fill, stroke = null) => shapes.push({ t: 'rect', x, y, w, h, fill, stroke }); const line = (x1, y1, x2, y2, color, w = 0.5 * k, dash = null) => shapes.push({ t: 'line', x1, y1, x2, y2, color, w, dash });
    const text = (x, y, s, o = {}) => shapes.push({ t: 'text', x, y, s: String(s ?? ''), size: o.size ?? font, bold: Boolean(o.bold), color: o.color ?? COLOURS.text, maxW: o.maxW ?? null, align: o.align ?? 'left' });
    // title block
    text(M, M + 12 * k, title, { size: 12 * k, bold: true, maxW: W - 2 * M - 160 * k });
    lines.forEach((l, i) => text(M, M + (24 + i * 10) * k, l, { size: 7.5 * k, color: COLOURS.muted, maxW: W - 2 * M - 160 * k }));
    text(W - M, M + 12 * k, paper === 'IMAGE' ? '' : `Page ${p + 1} of ${chunks.length}`, { size: 8 * k, align: 'right' });
    if (footer) text(W - M, M + 24 * k, footer, { size: 6.5 * k, color: COLOURS.muted, align: 'right', maxW: 300 * k });
    // column heads and time scale
    const yh = M + headH; rect(M, yh, W - 2 * M, scaleH, COLOURS.head); line(M, yh + scaleH, W - M, yh + scaleH, COLOURS.grid);
    let cx = M; for (const c of cols) { text(c.right ? cx + c.w - 3 * k : cx + 2 * k, yh + scaleH - 7 * k, c.label, { bold: true, align: c.right ? 'right' : 'left', maxW: c.w - 4 * k }); cx += c.w; }
    let lastMajor = -1e9; for (const t of ticks.major) { const x = x0 + (t.o - f0) * dayW; line(x, yh, x, yh + scaleH / 2, COLOURS.grid); if (x - lastMajor >= 40 * k) { text(x + 2 * k, yh + 9 * k, t.label, { size: 6.5 * k, bold: true, maxW: Math.max(20 * k, tlW - (x - x0) - 4 * k) }); lastMajor = x; } }
    let lastMinor = -1e9; for (const t of ticks.minor) { const x = x0 + (t.o - f0) * dayW; if (x - lastMinor >= minGap) { text(x + 1.5 * k, yh + scaleH - 4 * k, t.label, { size: 6 * k, color: COLOURS.muted }); lastMinor = x; } }
    line(x0, yh, x0, yh + scaleH + chunk.length * pitch, COLOURS.grid);
    // rows
    const top = yh + scaleH; const rowY = new Map();
    for (const t of ticks.major) { const x = x0 + (t.o - f0) * dayW; line(x, top, x, top + chunk.length * pitch, COLOURS.grid, 0.3 * k); }
    chunk.forEach((r, i) => {
      const y = top + i * pitch; const mid = y + pitch / 2; if (i % 2 === 1) rect(M, y, W - 2 * M, pitch, COLOURS.band);
      if (r.kind === 'wbs') {
        text(M + 2 * k + (r.level - 1) * 5 * k, y + pitch - 3 * k, `${r.label}`, { bold: true, maxW: tableW - 6 * k - (r.level - 1) * 5 * k });
        if (r.start && r.finish) { const a = X(r.start); const b = X(r.finish) + dayW; rect(a, mid - 1.6 * k, Math.max(1, b - a), 3.2 * k, COLOURS.summary); shapes.push({ t: 'poly', pts: [[a, mid + 1.6 * k], [a + 3 * k, mid + 1.6 * k], [a, mid + 4.6 * k]], fill: COLOURS.summary }); shapes.push({ t: 'poly', pts: [[b, mid + 1.6 * k], [b - 3 * k, mid + 1.6 * k], [b, mid + 4.6 * k]], fill: COLOURS.summary }); }
        return;
      }
      rowY.set(r.id, { y: mid, s: r.es ? X(r.es) : null, f: r.ef ? X(r.ef) + (r.type === 'MILESTONE' ? 0 : dayW) : null });
      const vals = { code: r.code, name: r.name, duration: r.type === 'MILESTONE' ? '0' : String(r.duration ?? ''), start: fmt(r.es), finish: fmt(r.ef), tf: r.totalFloat ?? '' };
      let x = M; for (const c of cols) { text(c.right ? x + c.w - 3 * k : x + 2 * k, y + pitch - 3 * k, vals[c.key], { align: c.right ? 'right' : 'left', maxW: c.w - 4 * k, color: c.key === 'tf' && r.totalFloat < 0 ? COLOURS.crit : COLOURS.text, bold: c.key === 'code' && r.critical }); x += c.w; }
      if (!r.es || !r.ef) return;
      const a = X(r.es);
      if (r.type === 'MILESTONE') { const h = 3.6 * k; shapes.push({ t: 'poly', pts: [[a, mid - h], [a + h, mid], [a, mid + h], [a - h, mid]], fill: r.critical ? COLOURS.crit : COLOURS.text }); return; }
      const b = X(r.ef) + dayW; const w = Math.max(1, b - a); const h = pitch * 0.56;
      rect(a, mid - h / 2, w, h, r.critical ? COLOURS.crit : COLOURS.norm);
      const pct = r.done ? 1 : Math.max(0, Math.min(1, (r.pct ?? 0) / 100)); if (pct > 0) rect(a, mid - h / 6, w * pct, h / 3, r.critical ? COLOURS.critDone : COLOURS.normDone);
    });
    if (showLinks) for (const l of links) {
      const p0 = rowY.get(l.predId); const s0 = rowY.get(l.succId); if (!p0 || !s0 || p0.s == null || s0.s == null) continue;
      const xa = l.type[0] === 'S' ? p0.s : p0.f; const xb = l.type[1] === 'S' ? s0.s : s0.f; const bend = Math.max(xa + 2 * k, Math.min(xb - 2 * k, xa + 3 * k));
      line(xa, p0.y, bend, p0.y, COLOURS.link, 0.4 * k); line(bend, p0.y, bend, s0.y, COLOURS.link, 0.4 * k); line(bend, s0.y, xb, s0.y, COLOURS.link, 0.4 * k);
      const dir = xb >= bend ? 1 : -1; shapes.push({ t: 'poly', pts: [[xb, s0.y], [xb - dir * 2.2 * k, s0.y - 1.4 * k], [xb - dir * 2.2 * k, s0.y + 1.4 * k]], fill: COLOURS.link });
    }
    if (dataDate && dataDate >= from && dataDate <= to) { const x = X(dataDate); line(x, yh, x, top + chunk.length * pitch, COLOURS.dataDate, 0.9 * k, [3 * k, 2 * k]); text(x + 2 * k, top + chunk.length * pitch + 8 * k, `Data date ${fmt(dataDate)}`, { size: 6 * k, color: COLOURS.dataDate }); }
    // legend
    const ly = H - M - 4 * k; let lx = M;
    const key = (draw, label) => { draw(lx); lx += 14 * k; text(lx, ly, label, { size: 6.5 * k, color: COLOURS.muted }); lx += (label.length * 3.4 + 14) * k; };
    key((x) => rect(x, ly - 6 * k, 11 * k, 5 * k, COLOURS.crit), 'Critical'); key((x) => rect(x, ly - 6 * k, 11 * k, 5 * k, COLOURS.norm), 'Not critical'); key((x) => rect(x, ly - 4.5 * k, 11 * k, 2 * k, COLOURS.normDone), 'Done');
    key((x) => shapes.push({ t: 'poly', pts: [[x + 5 * k, ly - 7 * k], [x + 9 * k, ly - 3.5 * k], [x + 5 * k, ly], [x + 1 * k, ly - 3.5 * k]], fill: COLOURS.text }), 'Milestone'); key((x) => rect(x, ly - 5 * k, 11 * k, 2.5 * k, COLOURS.summary), 'WBS summary');
    key((x) => line(x, ly - 3.5 * k, x + 11 * k, ly - 3.5 * k, COLOURS.dataDate, 1 * k, [2 * k, 1.5 * k]), 'Data date');
    return { w: W, h: H, shapes, rowIds: chunk.filter((r) => r.kind === 'act').map((r) => r.id) };
  });
  return { pages, meta: { rowsPerPage: perPage, fontSize: font, rowPitch: pitch, from, to, paper, scale } };
}

// ---- writers ----------------------------------------------------------------------------------------------------------------------------------------------------------
const FONT_FILES = { n: '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff', b: '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff', d: '@fontsource/ibm-plex-sans-devanagari/files/ibm-plex-sans-devanagari-devanagari-400-normal.woff' };
const fontCache = new Map();
const fontBytes = (k) => { if (!fontCache.has(k)) fontCache.set(k, woffToSfnt(readFileSync(require.resolve(FONT_FILES[k])))); return fontCache.get(k); };
const DEVA = /[ऀ-ॿ]/;
const LATIN = /^[\u0020-\u007E\u00A0-\u00FF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u20B9]*$/;

/** The layout as a PDF: one page per layout page, IBM Plex Sans (Devanagari where a name is in Hindi). */
export async function programmePdf(layout, { title = 'Programme', author = '' } = {}) {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit); pdf.setTitle(title); if (author) pdf.setAuthor(author); pdf.setCreator('Construction ERP: plan programme (part 13.02)');
  const F = { n: await pdf.embedFont(fontBytes('n'), { subset: true }), b: await pdf.embedFont(fontBytes('b'), { subset: true }) }; let deva = null;
  const col = (c) => rgb(c[0], c[1], c[2]);
  for (const pg of layout.pages) {
    const page = pdf.addPage([pg.w, pg.h]); const Y = (y) => pg.h - y;
    for (const s of pg.shapes) {
      if (s.t === 'rect') page.drawRectangle({ x: s.x, y: Y(s.y + s.h), width: s.w, height: s.h, color: col(s.fill) });
      else if (s.t === 'line') page.drawLine({ start: { x: s.x1, y: Y(s.y1) }, end: { x: s.x2, y: Y(s.y2) }, thickness: s.w, color: col(s.color), dashArray: s.dash ?? undefined });
      else if (s.t === 'poly') page.drawSvgPath(`M ${s.pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`, { x: 0, y: pg.h, color: col(s.fill) });
      else if (s.t === 'text' && s.s) {
        // runs of one script: Devanagari in its font, the rest in Plex Sans (a character neither has becomes "?"); cut to the width with "..."
        const latin = s.bold ? F.b : F.n; let runs = [];
        for (const ch of s.s) { const dv = DEVA.test(ch) || ((ch === ' ' || ch === '\u200C' || ch === '\u200D') && runs.at(-1)?.dv); const c = dv || LATIN.test(ch) ? ch : '?'; if (runs.at(-1)?.dv === dv) runs.at(-1).t += c; else runs.push({ dv, t: c }); }
        if (runs.some((r) => r.dv)) deva ??= await pdf.embedFont(fontBytes('d'), { subset: true });
        const fontOf = (r) => (r.dv ? deva : latin); const widthOf = (rs) => rs.reduce((w, r) => w + fontOf(r).widthOfTextAtSize(r.t, s.size), 0);
        if (s.maxW && widthOf(runs) > s.maxW) {
          const dots = latin.widthOfTextAtSize('...', s.size);
          while (runs.length && widthOf(runs) + dots > s.maxW) { const last = runs.at(-1); last.t = [...last.t].slice(0, -1).join(''); if (!last.t) runs.pop(); }
          runs = runs.length ? [...runs, { dv: false, t: '...' }] : [];
        }
        if (!runs.length) continue; let x = s.align === 'right' ? s.x - widthOf(runs) : s.x;
        for (const r of runs) { if (!r.t) continue; page.drawText(r.t, { x, y: Y(s.y), size: s.size, font: fontOf(r), color: col(s.color) }); x += fontOf(r).widthOfTextAtSize(r.t, s.size); }
      }
    }
  }
  return Buffer.from(await pdf.save());
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
/** The layout as one SVG image (the pages one under the other). */
export function programmeSvg(layout) {
  const W = Math.max(...layout.pages.map((p) => p.w)); const H = layout.pages.reduce((a, p) => a + p.h, 0); const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" font-family="IBM Plex Sans, Noto Sans, Arial, sans-serif"><rect width="100%" height="100%" fill="#fff"/>`];
  let off = 0;
  for (const pg of layout.pages) {
    out.push(`<g transform="translate(0 ${off.toFixed(1)})">`);
    for (const s of pg.shapes) {
      if (s.t === 'rect') out.push(`<rect x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" width="${s.w.toFixed(1)}" height="${s.h.toFixed(1)}" fill="${css(s.fill)}"/>`);
      else if (s.t === 'line') out.push(`<line x1="${s.x1.toFixed(1)}" y1="${s.y1.toFixed(1)}" x2="${s.x2.toFixed(1)}" y2="${s.y2.toFixed(1)}" stroke="${css(s.color)}" stroke-width="${s.w.toFixed(2)}"${s.dash ? ` stroke-dasharray="${s.dash.map((d) => d.toFixed(1)).join(' ')}"` : ''}/>`);
      else if (s.t === 'poly') out.push(`<polygon points="${s.pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="${css(s.fill)}"/>`);
      else if (s.t === 'text' && s.s) { let str = s.s; const max = s.maxW ? Math.floor(s.maxW / (s.size * 0.55)) : Infinity; if (str.length > max) str = max > 3 ? `${str.slice(0, max - 3)}...` : ''; if (str) out.push(`<text x="${s.x.toFixed(1)}" y="${s.y.toFixed(1)}" font-size="${s.size.toFixed(1)}"${s.bold ? ' font-weight="700"' : ''} fill="${css(s.color)}"${s.align === 'right' ? ' text-anchor="end"' : ''}>${esc(str)}</text>`); }
    }
    out.push('</g>'); off += pg.h;
  }
  out.push('</svg>');
  return out.join('');
}

/** The programme of a schedule for a person who may print (PDF) or export (image) it. */
export function createProgramme({ db, gantt }) {
  const authz = authzOf(db);
  function build(actor, id, q) {
    const d = gantt.data(actor, id); const s = d.schedule;
    // the PDF is a print; the image (also the page's preview) is open to whoever may print or export the schedule
    const may = (k) => authz.check(actor, k, { companyId: actor.companyId, projectId: s.projectId }).allowed;
    if (q.format === 'pdf' ? !may('plan.schedule.print') : !(may('plan.schedule.export') || may('plan.schedule.print'))) throw forbidden(`You may not ${q.format === 'pdf' ? 'print' : 'export'} this schedule (permission ${q.format === 'pdf' ? 'plan.schedule.print' : 'plan.schedule.export'}).`);
    // the WBS branch, then the filter
    let acts = d.activities;
    if (q.wbsId) { const keep = new Set([q.wbsId]); let grew = true; while (grew) { grew = false; for (const w of d.wbs) if (w.parentId && keep.has(w.parentId) && !keep.has(w.id)) { keep.add(w.id); grew = true; } } acts = acts.filter((a) => a.wbsId && keep.has(a.wbsId)); }
    if (q.filter === 'critical') acts = acts.filter((a) => a.critical); if (q.filter === 'open') acts = acts.filter((a) => !a.actualFinish);
    const wbsById = new Map(d.wbs.map((w) => [w.id, w])); const chain = (id0) => { const out = []; let w = wbsById.get(id0); while (w) { out.unshift(w); w = w.parentId ? wbsById.get(w.parentId) : null; } return out; };
    const sorted = [...acts].sort((a, b) => (a.wbsId ? chain(a.wbsId).map((w) => w.code).join('|') : '~').localeCompare(b.wbsId ? chain(b.wbsId).map((w) => w.code).join('|') : '~') || 0);
    // WBS summary rows with the span of their activities
    const span = new Map(); for (const a of sorted) for (const w of a.wbsId ? chain(a.wbsId) : []) { const x = span.get(w.id) ?? { start: null, finish: null }; if (a.es && (!x.start || a.es < x.start)) x.start = a.es; if (a.ef && (!x.finish || a.ef > x.finish)) x.finish = a.ef; span.set(w.id, x); }
    const rows = []; let open = [];
    for (const a of sorted) {
      const c = a.wbsId ? chain(a.wbsId) : [];
      let i = 0; while (i < open.length && i < c.length && open[i] === c[i].id) i += 1;
      for (let j = i; j < c.length; j += 1) rows.push({ kind: 'wbs', label: `${c[j].code} ${c[j].name}`, level: j + 1, ...span.get(c[j].id) });
      if (!c.length && open.length) rows.push({ kind: 'wbs', label: 'Not on a WBS node', level: 1, start: null, finish: null });
      open = c.map((w) => w.id);
      rows.push({ kind: 'act', id: a.id, code: a.code, name: a.name, duration: a.duration, es: a.es, ef: a.ef, totalFloat: a.totalFloat, critical: a.critical, type: a.type, pct: a.pctComplete, done: Boolean(a.actualFinish) });
    }
    const ends = acts.filter((a) => a.ef).map((a) => a.ef).sort(); const starts = acts.filter((a) => a.es).map((a) => a.es).sort();
    const from = q.from ?? (starts[0] && starts[0] < s.start ? starts[0] : s.start); const to0 = q.to ?? ends.at(-1) ?? s.finish ?? s.start; const to = q.to ? to0 : isoOf(ordOf(to0) + 7);
    const ids = new Set(acts.map((a) => a.id)); const links = d.links.filter((l) => ids.has(l.predId) && ids.has(l.succId));
    const layout = layoutProgramme({
      title: `Programme ${s.docNo}: ${s.projectCode} ${s.projectName} (version ${s.versionNo})`,
      lines: [`${s.name} · status ${s.status.toLowerCase()} · start ${fmt(s.start)} · finish ${fmt(s.finish)}${s.dataDate ? ` · data date ${fmt(s.dataDate)}` : ''} · ${acts.length} activities${q.filter !== 'all' ? ` (${q.filter})` : ''}${s.needsCalc ? ' · NOT RECALCULATED SINCE THE LAST CHANGE' : ''}`, `Dates and floats from the server's CPM pass; calendar ${s.calendar ?? ''}.`],
      rows, links, from, to: to < from ? from : to, dataDate: s.dataDate, paper: q.format === 'pdf' ? q.paper : (q.format === 'json' ? q.paper : 'IMAGE'), scale: q.scale, showLinks: q.links, footer: `Printed by ${actor.user} on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    });
    return { d, s, layout, count: acts.length };
  }
  async function render(actor, id, q) {
    const { s, layout, count } = build(actor, id, q);
    const safe = s.docNo.replace(/[^A-Za-z0-9_-]+/g, '-');
    writeAudit(db, { entity: 'plan_schedules', entityId: s.id, action: q.format === 'pdf' ? 'print' : 'export', actor: actor.user, companyId: actor.companyId, newValues: { report: 'programme', format: q.format, paper: q.paper, scale: q.scale, filter: q.filter, activities: count, pages: layout.pages.length } });
    if (q.format === 'json') return { kind: 'json', body: { pages: layout.pages.length, meta: layout.meta, activities: count, rowIds: layout.pages.map((p) => p.rowIds), texts: layout.pages.map((p) => p.shapes.filter((x) => x.t === 'text').map((x) => ({ s: x.s, size: x.size }))) } };
    if (q.format === 'svg') return { kind: 'svg', name: `programme-${safe}.svg`, body: programmeSvg(layout) };
    return { kind: 'pdf', name: `programme-${safe}-${q.paper}.pdf`, body: await programmePdf(layout, { title: `Programme ${s.docNo}`, author: actor.user }), pages: layout.pages.length };
  }
  return { build, render };
}
