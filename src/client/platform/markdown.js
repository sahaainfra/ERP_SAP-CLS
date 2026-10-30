// A small, safe Markdown parser for the architecture guide: it produces a plain data tree, and the renderer
// turns that into React elements (text nodes are escaped by React; no HTML is ever injected).
// Supported: # headings, paragraphs, - and 1. lists, ``` code blocks, | tables, `code` and **bold** inline.

function parseInline(text) {
  const out = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[1]) out.push({ t: 'code', v: m[1].slice(1, -1) });
    else out.push({ t: 'bold', v: m[2].slice(2, -2) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isSeparator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

/** Parse Markdown text into blocks: heading, paragraph, list, code, table. */
export function parseMarkdown(source) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', lang: fence[1], v: code.join('\n') });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ t: 'heading', level: h[1].length, children: parseInline(h[2]) });
      i++;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      const header = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      blocks.push({ t: 'table', header: header.map(parseInline), rows: rows.map((r) => r.map(parseInline)) });
      continue;
    }
    const list = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (!m || /\d/.test(m[2]) !== ordered) break;
        let text = m[3];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s/.test(lines[i])) text += ` ${lines[i++].trim()}`;
        items.push(parseInline(text));
      }
      blocks.push({ t: 'list', ordered, items });
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !(lines[i].includes('|') && isSeparator(lines[i + 1] ?? ''))) {
      para.push(lines[i++].trim());
    }
    blocks.push({ t: 'paragraph', children: parseInline(para.join(' ')) });
  }
  return blocks;
}

/** Plain text of a heading block, for anchors and a table of contents. */
export const headingText = (block) => block.children.map((c) => c.v).join('');
export const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
