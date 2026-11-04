// Rich text of a policy (part 05.05, FR-02): what the editor may produce is cleaned on the server before it is stored (an allow-list of tags and of the attributes of a link), turned into plain paragraphs for the
// comparison of two versions, and compared by paragraphs and by words. Nothing of this trusts the browser.
const ALLOWED = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template']);
const BLOCK = /<\/?(p|h[1-4]|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|hr|br)\b[^>]*>/gi;
const esc = (s) => s.replace(/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const safeHref = (v) => (/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(v) ? v : null);

/** The editor's HTML, reduced to the allowed tags; a link keeps only a safe address; scripts and styles disappear with their content. */
export function sanitizeHtml(input) {
  let html = String(input ?? '').slice(0, 400_000).replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROP_WITH_CONTENT) html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
  const out = [];
  let last = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    out.push(esc(html.slice(last, m.index)));
    last = re.lastIndex;
    const [, close, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (!ALLOWED.has(name)) continue;
    if (close) { out.push(`</${name}>`); continue; }
    if (name === 'a') {
      const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i.exec(attrs);
      const safe = href ? safeHref((href[2] ?? href[3]).trim()) : null;
      out.push(safe ? `<a href="${safe}" rel="noopener noreferrer" target="_blank">` : '<a>');
    } else out.push(name === 'br' || name === 'hr' ? `<${name}>` : `<${name}>`);
  }
  out.push(esc(html.slice(last)));
  return out.join('').replace(/<(br|hr)><\/\1>/g, '<$1>');
}

const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => entities[m] ?? m);
/** The paragraphs of a text, one per block element. */
export function blocksOf(html) {
  const marked = String(html ?? '').replace(BLOCK, '\n');
  return decode(marked.replace(/<[^>]+>/g, '')).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
export const textOf = (html) => blocksOf(html).join('\n');

const lcs = (a, b, same = (x, y) => x === y) => {
  const n = a.length; const m = b.length;
  const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) t[i][j] = same(a[i], b[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (same(a[i], b[j])) { ops.push({ type: 'same', a: a[i], b: b[j] }); i += 1; j += 1; } else if (t[i + 1][j] >= t[i][j + 1]) { ops.push({ type: 'del', a: a[i] }); i += 1; } else { ops.push({ type: 'add', b: b[j] }); j += 1; }
  }
  while (i < n) { ops.push({ type: 'del', a: a[i] }); i += 1; }
  while (j < m) { ops.push({ type: 'add', b: b[j] }); j += 1; }
  return ops;
};
const wordDiff = (a, b) => lcs(a.split(' '), b.split(' ')).map((o) => ({ t: o.type, text: o.type === 'add' ? o.b : o.a }));

/** The difference of two versions: paragraphs that are the same, added or removed; a removed paragraph followed by an added one is shown as a change with the words that differ. */
export function compareHtml(fromHtml, toHtml) {
  const ops = lcs(blocksOf(fromHtml).slice(0, 3000), blocksOf(toHtml).slice(0, 3000));
  const rows = [];
  for (let k = 0; k < ops.length; k += 1) {
    const o = ops[k];
    const next = ops[k + 1];
    if (o.type === 'del' && next?.type === 'add') { rows.push({ type: 'change', from: o.a, to: next.b, words: wordDiff(o.a, next.b) }); k += 1; } else rows.push(o.type === 'same' ? { type: 'same', text: o.a } : o.type === 'add' ? { type: 'add', text: o.b } : { type: 'del', text: o.a });
  }
  return { rows, summary: { added: rows.filter((r) => r.type === 'add').length, removed: rows.filter((r) => r.type === 'del').length, changed: rows.filter((r) => r.type === 'change').length, same: rows.filter((r) => r.type === 'same').length } };
}
