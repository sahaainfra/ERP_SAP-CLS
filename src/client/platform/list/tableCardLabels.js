import { useEffect } from 'react';

// PACK-10: phone cards for every table. Below 640 px the stylesheet turns each table row into a card and writes a cell's `data-label`
// above its value (styles.css, `td::before`). Tables built by the List Report or written with `data-label` already read well; the many
// pages with a plain <table> showed bare values with no captions. This fills in the missing labels from the column headers, for every
// table on the page and for rows added later, without changing any page. It never overwrites a label a page set itself.

export const PHONE = '(max-width: 640px)';

/** The text of each column of a table, by position, from the last header row (a header cell spanning n columns names all n). */
export function headerLabels(table) {
  const head = table.tHead?.rows?.[table.tHead.rows.length - 1];
  if (!head) return [];
  const out = [];
  for (const th of head.cells) {
    const text = (th.getAttribute('aria-label') || th.textContent || '').replace(/\s+/g, ' ').trim();
    for (let i = 0; i < (th.colSpan || 1); i += 1) out.push(text);
  }
  return out;
}

/** Give every body cell without a `data-label` the text of its column. Returns how many cells were labelled. */
export function labelTable(table) {
  const labels = headerLabels(table);
  if (!labels.length || labels.every((l) => !l)) return 0;
  let n = 0;
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      let col = 0;
      for (const cell of row.cells) {
        const span = cell.colSpan || 1;
        if (span === 1 && !cell.hasAttribute('data-label') && labels[col]) { cell.setAttribute('data-label', labels[col]); n += 1; }
        col += span;
      }
    }
  }
  return n;
}

/** Label every table in a part of the page. */
export function labelTables(root) {
  let n = 0;
  for (const t of root.querySelectorAll('table')) n += labelTable(t);
  return n;
}

/** While `enabled` and the screen is phone-sized, keep the tables of the page labelled as they are drawn and redrawn. */
export function useTableCardLabels(enabled) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.matchMedia || typeof MutationObserver === 'undefined') return undefined;
    const mq = window.matchMedia(PHONE);
    let observer = null;
    let frame = 0;
    const run = () => { frame = 0; labelTables(document.body); };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(run); };
    const start = () => {
      if (observer || !mq.matches) return;
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
      schedule();
    };
    const stop = () => { observer?.disconnect(); observer = null; if (frame) window.cancelAnimationFrame(frame); frame = 0; };
    const onChange = () => (mq.matches ? start() : stop());
    start();
    mq.addEventListener?.('change', onChange);
    return () => { stop(); mq.removeEventListener?.('change', onChange); };
  }, [enabled]);
}
