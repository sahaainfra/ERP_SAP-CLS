import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFString, PDFHexString, degrees, rgb } from 'pdf-lib';
import 'regenerator-runtime/runtime.js'; // the Indic shaper of fontkit needs it
import fontkit from '@pdf-lib/fontkit';

// HTML to PDF on the server (part 04.11, FR-04). The templates are written in a controlled subset of HTML and CSS (no scripts, no outside resources), so the renderer needs no browser: it reads the subset,
// lays it out on A4 pages (text wrapping in IBM Plex Sans with the Devanagari and rupee fallbacks, tables with repeated header rows and column spans, boxes, rules, images, a header and a footer on every page
// with the page number) and draws it with pdf-lib. The same input always gives the same pages.
const require = createRequire(import.meta.url);
const FONT_FILES = {
  'latin-n': '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff',
  'latin-b': '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff',
  'latin-i': '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-italic.woff',
  'ext-n': '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-400-normal.woff',
  'ext-b': '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-ext-700-normal.woff',
  'deva-n': '@fontsource/ibm-plex-sans-devanagari/files/ibm-plex-sans-devanagari-devanagari-400-normal.woff',
  'deva-b': '@fontsource/ibm-plex-sans-devanagari/files/ibm-plex-sans-devanagari-devanagari-700-normal.woff',
};
const fontBytes = new Map();
const fontkitFonts = new Map();
/** A WOFF file as the plain font file (sfnt) it wraps, unpacked once with the native zlib: reading a WOFF with fontkit's own inflater costs about 400 ms a document. */
export function woffToSfnt(woff) {
  if (woff.readUInt32BE(0) !== 0x774f4646) return woff; // not a WOFF: already an sfnt
  const flavor = woff.readUInt32BE(4);
  const n = woff.readUInt16BE(12);
  const tables = [];
  for (let i = 0; i < n; i += 1) {
    const at = 44 + i * 20;
    const tag = woff.subarray(at, at + 4);
    const off = woff.readUInt32BE(at + 4); const comp = woff.readUInt32BE(at + 8); const orig = woff.readUInt32BE(at + 12); const checksum = woff.readUInt32BE(at + 16);
    const data = comp < orig ? inflateSync(woff.subarray(off, off + comp)) : woff.subarray(off, off + orig);
    tables.push({ tag, data, checksum });
  }
  tables.sort((a, b) => Buffer.compare(a.tag, b.tag));
  const head = Buffer.alloc(12 + n * 16);
  head.writeUInt32BE(flavor, 0); head.writeUInt16BE(n, 4);
  const entrySelector = Math.floor(Math.log2(n));
  head.writeUInt16BE((2 ** entrySelector) * 16, 6); head.writeUInt16BE(entrySelector, 8); head.writeUInt16BE(n * 16 - (2 ** entrySelector) * 16, 10);
  let offset = head.length;
  const parts = [head];
  tables.forEach((t, i) => {
    t.tag.copy(head, 12 + i * 16);
    head.writeUInt32BE(t.checksum, 12 + i * 16 + 4); head.writeUInt32BE(offset, 12 + i * 16 + 8); head.writeUInt32BE(t.data.length, 12 + i * 16 + 12);
    const pad = (4 - (t.data.length % 4)) % 4;
    parts.push(t.data, Buffer.alloc(pad));
    offset += t.data.length + pad;
  });
  return Buffer.concat(parts);
}
const loadBytes = (key) => {
  if (!fontBytes.has(key)) fontBytes.set(key, woffToSfnt(readFileSync(require.resolve(FONT_FILES[key]))));
  return fontBytes.get(key);
};
const parsedByBytes = new WeakMap();
const advances = new Map(); // the width of a word in a font, in font units, kept between documents
const kit = (key) => {
  if (!fontkitFonts.has(key)) { const bytes = loadBytes(key); const f = fontkit.create(bytes); fontkitFonts.set(key, f); parsedByBytes.set(bytes, f); }
  return fontkitFonts.get(key);
};
/** pdf-lib reads a font file again for every document; this hands it the font parsed once. */
const sharedFontkit = { create: (bytes, ...rest) => parsedByBytes.get(bytes) ?? fontkit.create(bytes, ...rest) };
const isDeva = (cp) => (cp >= 0x0900 && cp <= 0x097f) || cp === 0x200c || cp === 0x200d || (cp >= 0xa8e0 && cp <= 0xa8ff);
/** Which family draws a character. */
function familyOf(ch) {
  const cp = ch.codePointAt(0);
  if (cp === 0x20 || cp === 0xa0 || cp === 0x09) return 'latin';
  if (isDeva(cp)) return 'deva';
  if (kit('latin-n').hasGlyphForCodePoint(cp)) return 'latin';
  if (kit('ext-n').hasGlyphForCodePoint(cp)) return 'ext';
  return null;
}

// ---- units, colours, a small CSS ----
const PT = { pt: 1, px: 0.75, mm: 2.8346, cm: 28.346, in: 72 };
const NAMED = { black: '#000000', white: '#ffffff', red: '#c62828', green: '#2e7d32', blue: '#1565c0', gray: '#6b7280', grey: '#6b7280', silver: '#c0c4cc', orange: '#ef6c00', transparent: null };
function colour(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (s in NAMED) return NAMED[s] ? colour(NAMED[s]) : null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}
/** A length in points; a percentage is returned as { pct }. */
function lengthP(v, base = 9.5) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'auto' || s === '') return null;
  const m = /^(-?\d*\.?\d+)\s*(pt|px|mm|cm|in|%|em)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === '%') return { pct: n };
  if (m[2] === 'em') return n * base;
  return n * (PT[m[2] ?? 'px'] ?? 0.75);
}
/** A length in points (a percentage is not a length here). */
const length = (v, base = 9.5) => { const r = lengthP(v, base); return typeof r === 'object' ? null : r; };
const sides = (v) => {
  const p = String(v ?? '').trim().split(/\s+/).filter(Boolean).map((x) => length(x) ?? 0);
  if (p.length === 1) return [p[0], p[0], p[0], p[0]];
  if (p.length === 2) return [p[0], p[1], p[0], p[1]];
  if (p.length === 3) return [p[0], p[1], p[2], p[1]];
  if (p.length >= 4) return p.slice(0, 4);
  return [0, 0, 0, 0];
};
const ALLOWED_PROPS = new Set(['color', 'background', 'background-color', 'font-size', 'font-weight', 'font-style', 'text-align', 'text-transform', 'letter-spacing', 'line-height', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-bottom', 'border', 'border-top', 'border-bottom', 'border-left', 'border-right', 'width', 'height', 'vertical-align', 'page-break-before', 'page-break-inside', 'text-decoration', 'display', 'white-space']);
export const CSS_PROPERTIES = [...ALLOWED_PROPS];
function parseDecl(text) {
  const out = {};
  for (const d of String(text ?? '').split(';')) {
    const i = d.indexOf(':');
    if (i < 1) continue;
    const k = d.slice(0, i).trim().toLowerCase();
    if (ALLOWED_PROPS.has(k)) out[k] = d.slice(i + 1).trim();
  }
  return out;
}
/** Rules of the form `selector, selector { property: value; }` where a selector is a tag, .class, #id, tag.class or a descendant chain of these. */
export function parseCss(css) {
  const rules = [];
  const clean = String(css ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decl = parseDecl(m[2]);
    for (const sel of m[1].split(',')) {
      const chain = sel.trim().split(/\s+/).filter(Boolean).map((p) => {
        const t = /^([a-z][a-z0-9]*)?(?:#([\w-]+))?(?:\.([\w-]+))?$/i.exec(p);
        return t ? { tag: t[1]?.toLowerCase() ?? null, id: t[2] ?? null, cls: t[3] ?? null } : null;
      });
      if (chain.length && !chain.includes(null)) {
        const spec = chain.reduce((s, c) => s + (c.id ? 100 : 0) + (c.cls ? 10 : 0) + (c.tag ? 1 : 0), 0);
        rules.push({ chain, spec, order: rules.length, decl });
      }
    }
  }
  return rules;
}
const matchOne = (c, n) => n.tag && (!c.tag || c.tag === n.tag) && (!c.id || c.id === n.attrs.id) && (!c.cls || (n.attrs.class ?? '').split(/\s+/).includes(c.cls));
function matches(rule, node) {
  let i = rule.chain.length - 1;
  if (!matchOne(rule.chain[i], node)) return false;
  let p = node.parent;
  for (i -= 1; i >= 0; i -= 1) {
    while (p && !matchOne(rule.chain[i], p)) p = p.parent;
    if (!p) return false;
    p = p.parent;
  }
  return true;
}

// ---- reading the HTML ----
const VOID = new Set(['br', 'hr', 'img', 'col', 'meta']);
const BLOCKS = new Set(['div', 'p', 'h1', 'h2', 'h3', 'h4', 'section', 'header', 'footer', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'blockquote', 'article', 'hr']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rupee: '₹', copy: '©', middot: '·', ndash: '–', mdash: '—', bull: '•' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : ''; }
  return ENTITIES[e.toLowerCase()] ?? m;
});
export function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<\/([a-z][a-z0-9]*)\s*>|<([a-z][a-z0-9]*)((?:\s+[a-z_:][\w:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)|</gi;
  for (const m of String(html).matchAll(re)) {
    if (m[5] !== undefined || m[0] === '<') { const t = m[5] ?? '<'; cur.children.push({ text: decode(t), parent: cur }); continue; }
    if (m[1]) { // closing
      const tag = m[1].toLowerCase();
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    if (!m[2]) continue; // a comment
    const tag = m[2].toLowerCase();
    const attrs = {};
    for (const a of (m[3] ?? '').matchAll(/([a-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gi)) attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    // a cell or row closes the one before it
    if (['td', 'th'].includes(tag)) while (cur.tag !== 'tr' && cur.parent && ['td', 'th'].includes(cur.tag)) cur = cur.parent;
    if (tag === 'tr') while (cur.parent && ['td', 'th', 'tr'].includes(cur.tag)) cur = cur.parent;
    const node = { tag, attrs, children: [], parent: cur };
    cur.children.push(node);
    if (!VOID.has(tag) && !m[4]) cur = node;
  }
  return root;
}

// ---- styles of a node ----
const UA = {
  h1: { 'font-size': '15pt', 'font-weight': 'bold', 'margin-top': '4pt', 'margin-bottom': '4pt' },
  h2: { 'font-size': '12pt', 'font-weight': 'bold', 'margin-top': '6pt', 'margin-bottom': '3pt' },
  h3: { 'font-size': '10.5pt', 'font-weight': 'bold', 'margin-top': '5pt', 'margin-bottom': '2pt' },
  h4: { 'font-size': '9.5pt', 'font-weight': 'bold', 'margin-top': '4pt', 'margin-bottom': '2pt' },
  p: { 'margin-bottom': '4pt' },
  th: { 'font-weight': 'bold', 'text-align': 'left', padding: '3pt 4pt' },
  td: { padding: '3pt 4pt' },
  b: { 'font-weight': 'bold' }, strong: { 'font-weight': 'bold' }, i: { 'font-style': 'italic' }, em: { 'font-style': 'italic' },
  hr: { 'margin-top': '4pt', 'margin-bottom': '4pt', 'border-top': '0.75pt solid #9ca3af' },
};
const INHERIT = ['color', 'font-size', 'font-weight', 'font-style', 'text-align', 'text-transform', 'line-height', 'letter-spacing', 'white-space'];
function styleOf(node, rules) {
  const own = { ...(UA[node.tag] ?? {}) };
  const hits = rules.filter((r) => matches(r, node)).sort((a, b) => a.spec - b.spec || a.order - b.order);
  for (const r of hits) Object.assign(own, r.decl);
  Object.assign(own, parseDecl(node.attrs.style));
  if (node.attrs.align && !own['text-align']) own['text-align'] = node.attrs.align;
  if (node.attrs.width && !own.width) own.width = /^\d+$/.test(node.attrs.width) ? `${node.attrs.width}px` : node.attrs.width;
  if (node.attrs.bgcolor && !own.background) own.background = node.attrs.bgcolor;
  node.style = own;
  const inh = node.parent?.computed ?? { 'font-size': '9.5pt', color: '#111827', 'text-align': 'left', 'line-height': '1.35' };
  node.computed = { ...Object.fromEntries(INHERIT.filter((k) => inh[k] !== undefined).map((k) => [k, inh[k]])), ...own };
  const size = length(node.computed['font-size'], length(inh['font-size']) ?? 9.5);
  node.fontSize = typeof size === 'number' && size > 0 ? Math.min(size, 60) : 9.5;
  node.computed['font-size'] = `${node.fontSize}pt`;
  for (const c of node.children) if (c.tag) styleOf(c, rules);
}
function border(v) {
  if (!v) return null;
  const m = /^(\d*\.?\d+\s*(?:pt|px|mm)?)\s+(solid|dashed|dotted)\s+(\S+)$/i.exec(String(v).trim());
  if (!m) return null;
  const col = colour(m[3]);
  return col ? { w: length(m[1]) || 0.75, color: col } : null;
}

// ---- layout ----
const LINE = (n) => { const lh = n.computed['line-height']; const f = /^\d*\.?\d+$/.test(lh ?? '') ? Number(lh) : 1.35; return n.fontSize * f; };
const textOf = (node) => (node.tag ? node.children.map(textOf).join('') : node.text);

export const PAGE = { A4: [595.28, 841.89] };

/**
 * @param {string} html the HTML of the document, with an optional top-level <header> and <footer> that repeat on every page
 * @param {{css?: string, orientation?: 'portrait'|'landscape', title?: string, author?: string, subject?: string, pdfa?: boolean, watermark?: string|null, images?: Record<string, Buffer>, producer?: string, created?: Date}} opts
 * @returns {Promise<{ buffer: Buffer, pages: number }>}
 */
export async function renderPdf(html, opts = {}) {
  const rules = parseCss(opts.css ?? '');
  const root = parseHtml(html);
  root.computed = null;
  for (const c of root.children) if (c.tag) styleOf(c, rules);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(sharedFontkit);
  const embedded = {};
  const used = new Set(['latin-n']);
  // the width of text is measured on the font file itself (the same advances pdf-lib uses); only the fonts a page draws with are embedded in the file
  const measure = (key, text, size) => {
    const k = `${key}|${text}`;
    let units = advances.get(k);
    if (units === undefined) { units = kit(key).layout(text).glyphs.reduce((w, g) => w + g.advanceWidth, 0); if (advances.size > 50_000) advances.clear(); advances.set(k, units); }
    return (units * size) / kit(key).unitsPerEm;
  };
  const images = new Map();
  const [PW, PH] = opts.orientation === 'landscape' ? [PAGE.A4[1], PAGE.A4[0]] : PAGE.A4;
  const M = { l: 34, r: 34, t: 30, b: 28 };

  // the width of a run of text in one font size, by the family that draws each character
  const fontKey = (family, bold, italic) => (family === 'latin' ? `latin-${bold ? 'b' : italic ? 'i' : 'n'}` : `${family}-${bold ? 'b' : 'n'}`);
  const segments = (text, bold, italic) => {
    const out = [];
    for (const ch of text) {
      const fam = familyOf(ch);
      const f = fam === null ? 'latin' : fam;
      const t = fam === null ? '?' : ch;
      const key = fontKey(f, bold, italic);
      used.add(key);
      if (out.length && out[out.length - 1].key === key) out[out.length - 1].text += t; else out.push({ key, text: t });
    }
    return out;
  };
  const widthOf = (segs, size, spacing = 0) => segs.reduce((w, s) => w + measure(s.key, s.text, size) + spacing * [...s.text].length, 0);

  // inline content -> words
  function inlineWords(node, out = [], acc = { pendingSpace: false }) {
    for (const c of node.children) {
      if (!c.tag) {
        let t = c.text.replace(/[\s]+/g, (s) => (s.includes(' ') ? s : ' '));
        const pre = (node.computed['white-space'] ?? '') === 'pre-wrap';
        if (pre) t = c.text;
        t = t.replace(/\[\[PAGES\]\]/g, String(tokens_.pages)).replace(/\[\[PAGE\]\]/g, String(tokens_.page));
        if (node.computed['text-transform'] === 'uppercase') t = t.toUpperCase();
        const parts = pre ? t.split(/(\n)/) : t.split(/( )/);
        for (const p of parts) {
          if (p === '') continue;
          if (p === ' ') { acc.pendingSpace = true; continue; }
          if (p === '\n') { out.push({ br: true }); continue; }
          out.push({ text: p, node: node.tag ? node : c.parent, space: acc.pendingSpace && out.length > 0 && !out[out.length - 1].br });
          acc.pendingSpace = false;
        }
        if (/\s$/.test(c.text) && !pre) acc.pendingSpace = true;
      } else if (c.tag === 'br') out.push({ br: true });
      else if (c.tag === 'img') { out.push({ img: c, node: c, space: acc.pendingSpace }); acc.pendingSpace = false; } else inlineWords(c, out, acc);
    }
    return out;
  }
  const isInline = (n) => !n.tag || !BLOCKS.has(n.tag);
  const bold = (n) => /^(bold|[6-9]00)$/.test(n.computed['font-weight'] ?? '');
  const ital = (n) => n.computed['font-style'] === 'italic';

  function imageFor(node) {
    const src = node.attrs.src ?? '';
    const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=]+)$/.exec(src);
    if (!m) return null;
    if (!images.has(src)) images.set(src, { type: m[1] === 'png' ? 'png' : 'jpg', bytes: Buffer.from(m[2], 'base64') });
    return images.get(src);
  }
  async function embedImages(node) {
    if (node.tag === 'img') {
      const info = imageFor(node);
      if (info && !info.ref) info.ref = info.type === 'png' ? await pdf.embedPng(info.bytes) : await pdf.embedJpg(info.bytes);
    }
    for (const c of node.children ?? []) await embedImages(c);
  }
  await embedImages(root);

  /** Lines of a block with inline content: [{ h, items: [{x, seg|img, size, color}] }] */
  function lineBreak(node, width) {
    const words = inlineWords(node);
    const lines = [];
    let cur = { items: [], w: 0, h: LINE(node), base: node.fontSize };
    const push = () => { lines.push(cur); cur = { items: [], w: 0, h: LINE(node), base: node.fontSize }; };
    const align = node.computed['text-align'] ?? 'left';
    for (const w of words) {
      if (w.br) { push(); continue; }
      if (w.img) {
        const info = imageFor(w.img);
        if (!info?.ref) continue;
        const iw = lengthP(w.img.attrs.width ?? w.img.style?.width) ?? info.ref.width * 0.75;
        const ih = lengthP(w.img.attrs.height ?? w.img.style?.height) ?? ((typeof iw === 'number' ? iw : 0) * info.ref.height) / info.ref.width;
        const wi = typeof iw === 'object' ? width * (iw.pct / 100) : iw;
        const hi = typeof ih === 'object' ? wi * info.ref.height / info.ref.width : ih;
        if (cur.w + wi > width && cur.items.length) push();
        cur.items.push({ x: cur.w, img: info.ref, w: wi, h: hi });
        cur.w += wi + 2;
        cur.h = Math.max(cur.h, hi + 2);
        continue;
      }
      const n = w.node;
      const size = n.fontSize;
      const sp = length(n.computed['letter-spacing']) || 0;
      const segs = segments(w.text, bold(n), ital(n));
      const ww = widthOf(segs, size, sp);
      const spaceW = w.space && cur.items.length ? measure('latin-n', ' ', size) : 0;
      if (cur.w + spaceW + ww > width && cur.items.length) push();
      const lead = cur.items.length ? spaceW : 0;
      if (ww > width) { // a word longer than the line is cut
        let piece = '';
        for (const ch of w.text) {
          const t = piece + ch;
          if (widthOf(segments(t, bold(n), ital(n)), size, sp) > width - cur.w && piece) {
            cur.items.push({ x: cur.w, segs: segments(piece, bold(n), ital(n)), size, color: colour(n.computed.color) ?? rgb(0.07, 0.09, 0.15), sp, under: /underline/.test(n.computed['text-decoration'] ?? '') });
            push(); piece = ch;
          } else piece = t;
        }
        if (piece) { const s2 = segments(piece, bold(n), ital(n)); cur.items.push({ x: cur.w, segs: s2, size, color: colour(n.computed.color) ?? rgb(0.07, 0.09, 0.15), sp }); cur.w += widthOf(s2, size, sp); }
        continue;
      }
      cur.items.push({ x: cur.w + lead, segs, size, color: colour(n.computed.color) ?? rgb(0.07, 0.09, 0.15), sp, under: /underline/.test(n.computed['text-decoration'] ?? '') });
      cur.w += lead + ww;
      cur.h = Math.max(cur.h, LINE(n));
      cur.base = Math.max(cur.base, size);
    }
    if (cur.items.length || lines.length === 0) lines.push(cur);
    for (const l of lines) {
      const free = Math.max(0, width - l.w);
      const dx = align === 'right' ? free : align === 'center' ? free / 2 : 0;
      for (const it of l.items) it.x += dx;
    }
    return lines;
  }

  const widthPx = (n, avail) => { const v = lengthP(n.style?.width, n.fontSize); return v == null ? null : typeof v === 'object' ? (avail * v.pct) / 100 : v; };

  /** The atoms of the children of a block: [{ h, draw(page, x, top, tokens), keep, table, header }] */
  function atomsOf(node, width, tokens) {
    const atoms = [];
    const kids = node.children.filter((c) => c.tag || c.text.trim() !== '' || c.text.includes(' '));
    let i = 0;
    while (i < kids.length) {
      const c = kids[i];
      if (isInline(c) && c.tag !== 'hr') {
        const run = [];
        while (i < kids.length && isInline(kids[i])) { run.push(kids[i]); i += 1; }
        const anon = { tag: '#anon', attrs: {}, children: run, parent: node, computed: node.computed, fontSize: node.fontSize, style: {} };
        atoms.push(...lineAtoms(anon, width, null));
      } else {
        atoms.push(...blockAtoms(c, width, tokens));
        i += 1;
      }
    }
    return atoms;
  }
  /** @typedef {{ h: number, draw: Function, spacer?: boolean, keep?: boolean, table?: number, header?: boolean, headers?: any[] }} Atom */
  /** @returns {Atom[]} */
  const spacer = (h) => (h > 0 ? [{ h, draw() {}, spacer: true }] : []);
  function lineAtoms(node, width, deco) {
    const lines = lineBreak(node, width);
    return lines.map((l, idx) => ({
      h: l.h + (deco ? (idx === 0 ? deco.pt : 0) + (idx === lines.length - 1 ? deco.pb : 0) : 0),
      draw(page, x, top) {
        if (deco) decorate(page, x - deco.pl, top, width + deco.pl + deco.pr, this.h, deco, idx === 0, idx === lines.length - 1);
        const textTop = top - (deco && idx === 0 ? deco.pt : 0);
        const y = textTop - l.base - (l.h - l.base) * 0.15;
        for (const it of l.items) {
          if (it.img) { page.drawImage(it.img, { x: x + it.x, y: top - it.h, width: it.w, height: it.h }); continue; }
          let px = x + it.x;
          for (const s of it.segs) {
            const text = s.text;
            page.drawText(text, { x: px, y, size: it.size, font: embedded[s.key], color: it.color, characterSpacing: it.sp || 0 });
            const tw = measure(s.key, text, it.size) + (it.sp || 0) * [...text].length;
            if (it.under) page.drawLine({ start: { x: px, y: y - 1.2 }, end: { x: px + tw, y: y - 1.2 }, thickness: 0.5, color: it.color });
            px += tw;
          }
        }
      },
    }));
  }
  const tokens_ = { page: 1, pages: 1 };
  function decorate(page, x, top, w, h, deco, first, last) {
    if (deco.bg) page.drawRectangle({ x, y: top - h, width: w, height: h, color: deco.bg });
    const line = (b, x1, y1, x2, y2) => b && page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: b.w, color: b.color });
    if (first) line(deco.bt, x, top, x + w, top);
    if (last) line(deco.bb, x, top - h, x + w, top - h);
    line(deco.bl, x, top, x, top - h);
    line(deco.br, x + w, top, x + w, top - h);
  }
  const decoOf = (n) => {
    const s = n.computed;
    const [pt, pr, pb, pl] = sides(s.padding);
    const bd = border(s.border);
    const d = {
      pt: length(s['padding-top']) ?? pt, pr: length(s['padding-right']) ?? pr, pb: length(s['padding-bottom']) ?? pb, pl: length(s['padding-left']) ?? pl,
      bg: colour(s.background ?? s['background-color']) || null,
      bt: border(s['border-top']) ?? bd, bb: border(s['border-bottom']) ?? bd, bl: border(s['border-left']) ?? bd, br: border(s['border-right']) ?? bd,
    };
    // `computed` also holds inherited properties; only an element's own style draws its box
    const own = n.style ?? {};
    if (!('background' in own) && !('background-color' in own)) d.bg = null;
    for (const k of ['border', 'border-top', 'border-bottom', 'border-left', 'border-right']) void k;
    if (!('border' in own) && !('border-top' in own)) d.bt = null;
    if (!('border' in own) && !('border-bottom' in own)) d.bb = null;
    if (!('border' in own) && !('border-left' in own)) d.bl = null;
    if (!('border' in own) && !('border-right' in own)) d.br = null;
    if (!('padding' in own) && !('padding-top' in own)) d.pt = 0;
    if (!('padding' in own) && !('padding-bottom' in own)) d.pb = 0;
    if (!('padding' in own) && !('padding-left' in own)) d.pl = 0;
    if (!('padding' in own) && !('padding-right' in own)) d.pr = 0;
    d.any = Boolean(d.bg || d.bt || d.bb || d.bl || d.br);
    return d;
  };
  const margins = (n) => {
    const s = n.style ?? {};
    const [mt, , mb] = sides(s.margin);
    return { mt: length(s['margin-top']) ?? mt, mb: length(s['margin-bottom']) ?? mb };
  };

  function blockAtoms(node, outerWidth, tokens) {
    if (node.tag === 'table') return tableAtoms(node, outerWidth, tokens);
    if (node.tag === 'img') return lineAtoms({ tag: '#anon', attrs: {}, children: [node], parent: node.parent, computed: node.parent.computed, fontSize: node.parent.fontSize, style: {} }, outerWidth, null);
    const m = margins(node);
    const d = decoOf(node);
    if (node.style?.display === 'none') return [];
    const w = widthPx(node, outerWidth);
    const width = Math.min(w ?? outerWidth, outerWidth);
    const inner = Math.max(20, width - d.pl - d.pr);
    const out = [...spacer(m.mt)];
    if (node.tag === 'hr') {
      const b = border(node.style['border-top']) ?? { w: 0.75, color: rgb(0.6, 0.64, 0.7) };
      out.push({ h: b.w + 1, draw(page, x, top) { page.drawLine({ start: { x, y: top - 0.5 }, end: { x: x + width, y: top - 0.5 }, thickness: b.w, color: b.color }); } });
      return [...out, ...spacer(m.mb)];
    }
    const leafInline = node.children.every((c) => isInline(c));
    if (node.children.length === 0) { const hh = length(node.style?.height); if (typeof hh === 'number') out.push(...spacer(hh)); }
    if (node.tag === 'li') {
      const lines = lineAtoms({ ...node, children: [{ text: '• ', parent: node }, ...node.children] }, inner - 10, null);
      return [...out, ...lines.map((a) => ({ ...a, draw: (page, x, top) => a.draw(page, x + 10, top) })), ...spacer(m.mb)];
    }
    if (leafInline) {
      const atoms = lineAtoms(node, inner, d.any || d.pt || d.pb ? d : null);
      return [...out, ...atoms.map((a) => ({ ...a, draw: (page, x, top) => a.draw(page, x + d.pl, top) })), ...spacer(m.mb)];
    }
    const kids = atomsOf(node, inner, tokens);
    const total = kids.reduce((s, a) => s + a.h, 0) + d.pt + d.pb;
    if (d.any && total < PH - M.t - M.b - 60) { // a decorated box stays whole
      out.push({
        h: total,
        keep: true,
        draw(page, x, top) {
          decorate(page, x, top, width, total, d, true, true);
          let y = top - d.pt;
          for (const a of kids) { a.draw(page, x + d.pl, y); y -= a.h; }
        },
      });
    } else {
      out.push(...spacer(d.pt), ...kids.map((a) => ({ ...a, draw: (page, x, top) => a.draw(page, x + d.pl, top) })), ...spacer(d.pb));
    }
    return [...out, ...spacer(m.mb)];
  }

  let tableSeq = 0;
  function tableAtoms(table, outerWidth, tokens) {
    const id = (tableSeq += 1);
    const m = margins(table);
    const rows = [];
    const collect = (n, head) => { for (const c of n.children) if (c.tag === 'tr') rows.push({ tr: c, head: head || c.children.some((x) => x.tag === 'th') && false }); else if (c.tag === 'thead') collect(c, true); else if (c.tag === 'tbody' || c.tag === 'tfoot') collect(c, false); };
    collect(table, false);
    const grid = rows.map((r) => {
      const cells = [];
      let col = 0;
      for (const c of r.tr.children.filter((x) => x.tag === 'td' || x.tag === 'th')) {
        const span = Math.max(1, Math.min(12, Number(c.attrs.colspan) || 1));
        cells.push({ node: c, col, span });
        col += span;
      }
      return { ...r, cells, cols: col };
    });
    const n = Math.max(1, ...grid.map((r) => r.cols));
    const width = Math.min(widthPx(table, outerWidth) ?? outerWidth, outerWidth);
    const sizing = (cell) => {
      const words = inlineWords({ ...cell.node, children: cell.node.children.filter(isInline) });
      const textWidth = (txt) => widthOf(segments(txt, bold(cell.node), ital(cell.node)), cell.node.fontSize);
      const max = words.filter((w) => w.text).reduce((s, w) => s + textWidth(w.text) + 3, 0);
      const min = words.filter((w) => w.text).reduce((s, w) => Math.max(s, textWidth(w.text)), 0);
      const nested = cell.node.children.some((c) => c.tag === 'table');
      const [, pr, , pl] = sides(cell.node.computed.padding);
      const pad = (length(cell.node.computed['padding-left']) ?? pl) + (length(cell.node.computed['padding-right']) ?? pr);
      return { min: min + pad + 1, max: Math.max(max, nested ? width / n : 0) + pad + 1 };
    };
    const colMin = new Array(n).fill(12);
    const colMax = new Array(n).fill(12);
    const fixed = new Array(n).fill(null);
    for (const r of grid) {
      for (const c of r.cells) {
        const sz = sizing(c);
        const w = widthPx(c.node, width);
        if (c.span === 1) { colMin[c.col] = Math.max(colMin[c.col], sz.min); colMax[c.col] = Math.max(colMax[c.col], sz.max); if (w != null) fixed[c.col] = Math.max(fixed[c.col] ?? 0, w); }
      }
    }
    for (const r of grid) for (const c of r.cells) if (c.span > 1) { // a spanning cell widens the columns it covers if they are too narrow
      const sz = sizing(c);
      const have = colMax.slice(c.col, c.col + c.span).reduce((s, x) => s + x, 0);
      if (sz.max > have) for (let k = c.col; k < c.col + c.span; k += 1) colMax[k] += (sz.max - have) / c.span;
    }
    for (let k = 0; k < n; k += 1) if (fixed[k] != null) fixed[k] = Math.max(fixed[k], colMin[k]); // a column is never narrower than its longest word
    const widths = new Array(n).fill(0);
    let used = 0;
    const flexible = [];
    for (let k = 0; k < n; k += 1) { if (fixed[k] != null) { widths[k] = fixed[k]; used += fixed[k]; } else flexible.push(k); }
    const remaining = Math.max(0, width - used);
    if (flexible.length) {
      const sumMax = flexible.reduce((s, k) => s + colMax[k], 0);
      const sumMin = flexible.reduce((s, k) => s + colMin[k], 0);
      if (sumMax <= remaining) { for (const k of flexible) widths[k] = colMax[k] + (remaining - sumMax) * (colMax[k] / sumMax); } else if (sumMin >= remaining) { for (const k of flexible) widths[k] = (colMin[k] / sumMin) * remaining; } else {
        const extra = remaining - sumMin;
        const span = sumMax - sumMin;
        for (const k of flexible) widths[k] = colMin[k] + extra * ((colMax[k] - colMin[k]) / span);
      }
    } else if (used > 0) { const f = width / used; for (let k = 0; k < n; k += 1) widths[k] *= f; }
    const total = widths.reduce((s, x) => s + x, 0);
    if (total > 0 && Math.abs(total - width) > 0.5 && !fixed.every((x) => x != null)) { const f = width / total; for (let k = 0; k < n; k += 1) widths[k] *= f; }
    const tableBorder = border(table.style.border) ?? (table.attrs.border && table.attrs.border !== '0' ? { w: 0.5, color: rgb(0.6, 0.64, 0.7) } : null);
    const out = [...spacer(m.mt)];
    const headRows = [];
    grid.forEach((r, ri) => {
      const cellAtoms = r.cells.map((c) => {
        const x0 = widths.slice(0, c.col).reduce((s, x) => s + x, 0);
        const w = widths.slice(c.col, c.col + c.span).reduce((s, x) => s + x, 0);
        const d = decoOf(c.node);
        const rowStyle = r.tr.style ?? {};
        const bg = d.bg ?? colour(rowStyle.background ?? rowStyle['background-color']) ?? null;
        const cellCss = c.node.computed;
        const [pt, pr, pb, pl] = sides(cellCss.padding);
        const pads = { t: length(cellCss['padding-top']) ?? pt, r: length(cellCss['padding-right']) ?? pr, b: length(cellCss['padding-bottom']) ?? pb, l: length(cellCss['padding-left']) ?? pl };
        const inner = Math.max(8, w - pads.l - pads.r);
        const kids = atomsOf(c.node, inner, tokens);
        const h = kids.reduce((s, a) => s + a.h, 0) + pads.t + pads.b;
        return { c, x0, w, bg, d, pads, kids, h, bd: tableBorder, valign: c.node.computed['vertical-align'] };
      });
      const rowH = Math.max(14, ...cellAtoms.map((a) => a.h), length(r.tr.style.height) ?? 0);
      const isHead = r.head || (r.tr.parent?.tag === 'thead');
      const atom = {
        h: rowH,
        table: id,
        header: isHead,
        draw(page, x, top) {
          for (const a of cellAtoms) {
            if (a.bg) page.drawRectangle({ x: x + a.x0, y: top - rowH, width: a.w, height: rowH, color: a.bg });
            const b = a.bd;
            if (b) page.drawRectangle({ x: x + a.x0, y: top - rowH, width: a.w, height: rowH, borderColor: b.color, borderWidth: b.w });
            const rb = (side, x1, y1, x2, y2) => side && page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: side.w, color: side.color });
            rb(a.d.bt, x + a.x0, top, x + a.x0 + a.w, top); rb(a.d.bb, x + a.x0, top - rowH, x + a.x0 + a.w, top - rowH);
            let y = top - a.pads.t - (a.valign === 'middle' ? Math.max(0, (rowH - a.h) / 2) : 0);
            for (const k of a.kids) { k.draw(page, x + a.x0 + a.pads.l, y); y -= k.h; }
          }
        },
      };
      if (isHead) headRows.push(atom);
      out.push(atom);
      void ri;
    });
    for (const a of out) if (a.table === id) a.headers = headRows;
    return [...out, ...spacer(m.mb)];
  }

  // ---- pages ----
  const doc = root.children.find((c) => c.tag === 'html') ?? root;
  const body = doc.children.find((c) => c.tag === 'body') ?? doc;
  const topHeader = body.children.find((c) => c.tag === 'header');
  const topFooter = body.children.find((c) => c.tag === 'footer');
  const main = { ...body, children: body.children.filter((c) => c !== topHeader && c !== topFooter) };
  const contentW = PW - M.l - M.r;
  const band = (node, page, pageNo, total) => {
    if (!node) return [];
    tokens_.page = pageNo; tokens_.pages = total;
    return atomsOf({ ...node, tag: 'div', children: node.children }, contentW, tokens_);
  };
  const headH = topHeader ? band(topHeader, 1, 1, 1).reduce((s, a) => s + a.h, 0) : 0;
  const footH = topFooter ? band(topFooter, 1, 1, 1).reduce((s, a) => s + a.h, 0) : 0;
  const bodyTop = PH - M.t - (headH ? headH + 6 : 0);
  const bodyBottom = M.b + (footH ? footH + 6 : 0);
  const atoms = atomsOf(main, contentW, tokens_);

  const pagesAtoms = [[]];
  let y = bodyTop;
  let lastTable = null;
  for (let i = 0; i < atoms.length; i += 1) {
    const a = atoms[i];
    const cur = pagesAtoms[pagesAtoms.length - 1];
    if (a.spacer && cur.length === 0) continue;
    if (y - a.h < bodyBottom && cur.length > 0 && !(a.h > bodyTop - bodyBottom)) {
      pagesAtoms.push([]);
      y = bodyTop;
      if (a.table && a.headers?.length && !a.header) for (const h of a.headers) { pagesAtoms[pagesAtoms.length - 1].push({ ...h, repeated: true }); y -= h.h; }
      if (a.spacer) continue;
    }
    pagesAtoms[pagesAtoms.length - 1].push(a);
    y -= a.h;
    lastTable = a.table ?? null;
  }
  void lastTable;
  const total = pagesAtoms.length;
  if (opts.watermark) used.add('latin-b');
  for (const k of used) { kit(k); embedded[k] = await pdf.embedFont(loadBytes(k), { subset: true }); }
  for (let p = 0; p < total; p += 1) {
    const page = pdf.addPage([PW, PH]);
    tokens_.page = p + 1; tokens_.pages = total;
    let top = bodyTop;
    for (const a of pagesAtoms[p]) { a.draw(page, M.l, top); top -= a.h; }
    let hy = PH - M.t;
    for (const a of band(topHeader, page, p + 1, total)) { a.draw(page, M.l, hy); hy -= a.h; }
    let fy = M.b + footH;
    for (const a of band(topFooter, page, p + 1, total)) { a.draw(page, M.l, fy); fy -= a.h; }
    if (opts.watermark) {
      const f = embedded['latin-b'];
      const size = 70;
      const wdt = measure('latin-b', opts.watermark, size);
      page.drawText(opts.watermark, { x: PW / 2 - (wdt * Math.SQRT1_2) / 2, y: PH / 2 - (wdt * Math.SQRT1_2) / 2, size, font: f, color: rgb(0.8, 0.1, 0.1), opacity: 0.16, rotate: degrees(45) });
    }
  }
  const created = opts.created ?? new Date();
  pdf.setTitle(opts.title ?? 'Document');
  pdf.setAuthor(opts.author ?? 'Construction ERP');
  pdf.setSubject(opts.subject ?? '');
  pdf.setProducer(opts.producer ?? 'Construction ERP document service');
  pdf.setCreator('Construction ERP');
  pdf.setCreationDate(created);
  pdf.setModificationDate(created);
  if (opts.pdfa) addArchivalProfile(pdf, { title: opts.title ?? 'Document', author: opts.author ?? 'Construction ERP', created });
  return { buffer: Buffer.from(await pdf.save({ useObjectStreams: !opts.pdfa })), pages: total };
}

/** The archival profile (FR-04): fonts embedded, no encryption, no scripts, and the XMP identification of PDF/A-2b with the document properties. */
function addArchivalProfile(pdf, { title, author, created }) {
  const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const d = created.toISOString();
  const xmp = `<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance></rdf:Description>
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>${esc(author)}</rdf:li></rdf:Seq></dc:creator></rdf:Description>
<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/"><xmp:CreateDate>${d}</xmp:CreateDate><xmp:ModifyDate>${d}</xmp:ModifyDate><xmp:CreatorTool>Construction ERP document service</xmp:CreatorTool></rdf:Description>
</rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const stream = pdf.context.stream(Buffer.from(xmp, 'utf8'), { Type: 'Metadata', Subtype: 'XML' });
  pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(stream));
  pdf.catalog.set(PDFName.of('Lang'), PDFString.of('en-IN'));
  void PDFHexString;
}

export const textContent = textOf;
