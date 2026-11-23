// Part 30.09: one document model, two renditions. A manual is { title, subtitle, lang, meta: [[label, value]], sections: [{ h, blocks }] }, each
// block one of { sub } (a sub-heading) { p } { steps: [] } { list: [] } { table: { head: [], rows: [[]] } } { img: { data, type, width, height, caption } } { note }.
// The PDF is drawn by the HTML renderer of 04.11 (eng/tpl-pdf.js: IBM Plex Sans with Devanagari, images, a header and page numbers); the DOCX is
// WordprocessingML written here (headings as Word heading styles so the navigation pane and a table of contents work, numbered steps, tables
// with borders, images embedded), so an editor can change it in Word or LibreOffice.
import { inflateRawSync } from 'node:zlib';
import { zip } from '../../platform/export/index.js';
import { renderPdf } from '../eng/tpl-pdf.js';

const esc = (s) => String(s ?? '').replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const xml = (s) => esc(s).split('').filter((ch) => { const n = ch.charCodeAt(0); return n >= 32 || n === 9 || n === 10 || n === 13; }).join('');

const CSS = `
h1 { font-size: 18pt; color: #1f3a5f; margin-bottom: 6pt; }
h3 { font-size: 10.5pt; color: #111827; margin-top: 6pt; margin-bottom: 2pt; }
h2 { font-size: 13pt; color: #1f3a5f; margin-top: 10pt; border-bottom: 0.75pt solid #c0c4cc; }
p { font-size: 9.5pt; line-height: 1.35; }
li { font-size: 9.5pt; margin-bottom: 2pt; }
td { font-size: 8.5pt; border: 0.5pt solid #c0c4cc; }
th { font-size: 8.5pt; border: 0.5pt solid #c0c4cc; background: #eef2f7; }
.meta td { border: 0; padding: 1pt 4pt; font-size: 9pt; }
.note { background: #fff7e0; padding: 4pt; font-size: 9pt; border-left: 2pt solid #e0a100; }
.cap { font-size: 8pt; color: #6b7280; margin-bottom: 8pt; }
.sub { font-size: 11pt; color: #4b5563; }
header { font-size: 7.5pt; color: #6b7280; }
footer { font-size: 7.5pt; color: #6b7280; }
`;

/** The model as the HTML subset of the 04.11 renderer. */
export function toHtml(doc) {
  const images = {};
  let n = 0;
  const block = (b) => {
    if (b.sub !== undefined) return `<h3>${esc(b.sub)}</h3>`;
    if (b.p !== undefined) return `<p>${esc(b.p)}</p>`;
    if (b.note !== undefined) return `<p class="note">${esc(b.note)}</p>`;
    if (b.steps) return `<ol>${b.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
    if (b.list) return `<ul>${b.list.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
    if (b.table) return `<table><thead><tr>${b.table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    if (b.img) {
      n += 1; const src = `data:image/${b.img.type === 'png' ? 'png' : 'jpeg'};base64,${b.img.data.toString('base64')}`; images[`img${n}`] = b.img.data;
      const w = Math.min(b.img.width ?? 1280, b.img.maxWidthPt ?? 480); const h = Math.round((w * (b.img.height ?? 800)) / (b.img.width ?? 1280));
      return `<p><img src="${src}" width="${w}pt" height="${h}pt" /></p>${b.img.caption ? `<p class="cap">${esc(b.img.caption)}</p>` : ''}`;
    }
    return '';
  };
  const html = `<header>${esc(doc.title)} · ${esc(doc.footer ?? '')}</header><footer>${esc(doc.footer ?? '')}</footer>
<h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
<table class="meta"><tbody>${(doc.meta ?? []).map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
${doc.sections.map((s) => `<h2>${esc(s.h)}</h2>${s.blocks.map(block).join('\n')}`).join('\n')}`;
  return { html, images };
}

export async function toPdf(doc) {
  const { html } = toHtml(doc);
  return renderPdf(html, { css: CSS, title: doc.title, author: 'ERP documentation', subject: doc.subtitle ?? doc.title, created: doc.created ? new Date(doc.created) : undefined });
}

// ---- DOCX ----
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const run = (text, { bold = false, size = null, color = null } = {}) => `<w:r><w:rPr>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}${size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const para = (content, style = null, extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${content}</w:p>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Nirmala UI"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-IN" w:bidi="hi-IN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:color w:val="1F3A5F"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="4B5563"/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3A5F"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="6B7280"/><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="FFF7E0"/><w:ind w:left="200"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="Grid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="C0C4CC"/><w:left w:val="single" w:sz="4" w:color="C0C4CC"/><w:bottom w:val="single" w:sz="4" w:color="C0C4CC"/><w:right w:val="single" w:sz="4" w:color="C0C4CC"/><w:insideH w:val="single" w:sz="4" w:color="C0C4CC"/><w:insideV w:val="single" w:sz="4" w:color="C0C4CC"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="400" w:hanging="300"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="400" w:hanging="300"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/** The model as a .docx (a zip of WordprocessingML parts). Each numbered list restarts at 1. */
export function toDocx(doc) {
  const media = []; const rels = []; const nums = [];
  const body = [];
  body.push(para(run(doc.title), 'Title'));
  if (doc.subtitle) body.push(para(run(doc.subtitle), 'Subtitle'));
  for (const [k, v] of doc.meta ?? []) body.push(para(`${run(`${k}: `, { bold: true })}${run(v)}`));
  let pic = 0;
  for (const s of doc.sections) {
    body.push(para(run(s.h), 'Heading1'));
    for (const b of s.blocks) {
      if (b.sub !== undefined) body.push(para(run(b.sub), 'Heading2'));
      else if (b.p !== undefined) body.push(para(run(b.p)));
      else if (b.note !== undefined) body.push(para(run(b.note), 'Note'));
      else if (b.steps) { const id = 2 + nums.length; nums.push(id); for (const x of b.steps) body.push(para(run(x), null, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${id}"/></w:numPr>`)); }
      else if (b.list) for (const x of b.list) body.push(para(run(x), null, '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'));
      else if (b.table) {
        const cell = (t, head) => `<w:tc><w:tcPr>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F7"/>' : ''}</w:tcPr>${para(run(t, { bold: head, size: 18 }))}</w:tc>`;
        body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="Grid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr><w:tr><w:trPr><w:tblHeader/></w:trPr>${b.table.head.map((h) => cell(h, true)).join('')}</w:tr>${b.table.rows.map((r) => `<w:tr>${r.map((c) => cell(String(c ?? ''), false)).join('')}</w:tr>`).join('')}</w:tbl>`);
        body.push(para(''));
      } else if (b.img) {
        pic += 1; const ext = b.img.type === 'png' ? 'png' : 'jpeg'; const name = `image${pic}.${ext}`; const rid = `rIdImg${pic}`;
        media.push({ name: `word/media/${name}`, data: b.img.data }); rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
        const wPt = Math.min(b.img.width ?? 1280, b.img.maxWidthPt ?? 480); const hPt = Math.round((wPt * (b.img.height ?? 800)) / (b.img.width ?? 1280));
        const cx = wPt * 12700; const cy = hPt * 12700;
        body.push(`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${pic}" name="Screen ${pic}" descr="${xml(b.img.caption ?? '')}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${pic}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
        if (b.img.caption) body.push(para(run(b.img.caption), 'Caption'));
      }
    }
  }
  const footer = `<w:ftr ${W}>${para(`${run(`${doc.footer ?? ''} · `, { size: 16, color: '6B7280' })}<w:r><w:rPr><w:sz w:val="16"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`)}</w:ftr>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const numbering = NUMBERING.replace('</w:numbering>', `${nums.map((id) => `<w:num w:numId="${id}"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`);
  const created = (doc.created ? new Date(doc.created) : new Date()).toISOString().replace(/\.\d+Z$/, 'Z');
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(doc.title)}</dc:title><dc:creator>ERP documentation</dc:creator><dc:language>${doc.lang === 'hi' ? 'hi-IN' : 'en-IN'}</dc:language><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>` },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/numbering.xml', data: numbering },
    { name: 'word/footer1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${footer}` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${rels.join('')}</Relationships>` },
  ];
  return zip([...files.map((f) => ({ name: f.name, data: Buffer.from(f.data, 'utf8') })), ...media]);
}

/** The text a reader of the DOCX sees (the drift and content tests read it back). */
export function docxText(buffer) {
  const doc = unzipEntry(buffer, 'word/document.xml');
  return doc ? doc.toString('utf8').replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => `${p.replace(/<[^>]+>/g, '')}\n`).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'") : '';
}

/** One entry of a zip written by `zip` (stored or deflated), by name. */
export function unzipEntry(buffer, name) {
  const entries = zipEntries(buffer);
  return entries.find((e) => e.name === name)?.data ?? null;
}
export function zipEntries(buffer) {
  const out = [];
  // the end of central directory record
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i -= 1) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buffer.readUInt16LE(eocd + 10); let at = buffer.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k += 1) {
    const method = buffer.readUInt16LE(at + 10); const comp = buffer.readUInt32LE(at + 20); const nameLen = buffer.readUInt16LE(at + 28); const extra = buffer.readUInt16LE(at + 30); const comment = buffer.readUInt16LE(at + 32); const local = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLen).toString('utf8');
    const lName = buffer.readUInt16LE(local + 26); const lExtra = buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(local + 30 + lName + lExtra, local + 30 + lName + lExtra + comp);
    out.push({ name, method, get data() { return method === 8 ? inflateRawSync(raw) : raw; } });
    at += 46 + nameLen + extra + comment;
  }
  return out;
}
