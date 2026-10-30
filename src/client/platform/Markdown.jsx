import { headingText, parseMarkdown, slug } from './markdown.js';

function Inline({ nodes }) {
  return nodes.map((n, i) => {
    if (n.t === 'code') return <code key={i}>{n.v}</code>;
    if (n.t === 'bold') return <strong key={i}>{n.v}</strong>;
    return n.v;
  });
}

/** Renders the parsed tree as React elements. Headings get ids so the page can link to sections. */
export default function Markdown({ source }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="prose">
      {blocks.map((b, i) => {
        if (b.t === 'heading') {
          const Tag = `h${Math.min(b.level + 1, 6)}`; // the page title is the h1
          return <Tag key={i} id={slug(headingText(b))}><Inline nodes={b.children} /></Tag>;
        }
        if (b.t === 'paragraph') return <p key={i}><Inline nodes={b.children} /></p>;
        if (b.t === 'code') return <pre key={i}><code>{b.v}</code></pre>;
        if (b.t === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return <Tag key={i}>{b.items.map((it, j) => <li key={j}><Inline nodes={it} /></li>)}</Tag>;
        }
        return (
          <div className="table-wrap" key={i}>
            <table>
              <thead><tr>{b.header.map((h, j) => <th key={j}><Inline nodes={h} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inline nodes={c} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
