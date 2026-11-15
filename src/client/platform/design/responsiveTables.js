// Responsive tables (UI v3, mobile-first). On a phone a wide table is hard to read sideways, so every simple list
// table becomes a stack of cards: each cell shows its column name beside the value. This runs once for the whole
// application: it watches the page and labels the cells of every table it can safely change, so the 800+ tables
// built before UI v3 need no edit. A table opts out with data-no-cards (matrices, registers, spreadsheets, Gantt).
//
// A table is changed only when it has one header row without merged headers and more than three columns
// (three or fewer already fit a phone). ui-v3.css shows the cards only below 640px, so desktop is unchanged.
const SKIP = '[data-no-cards], .att-register, .ff-gridwrap, .trn-matrix, .heat, .gantt, .lr-table, .safety-grid, .tsk-cal';

function labelTable(table) {
  if (table.dataset.cards) return;
  if (table.closest(SKIP)) { table.dataset.cards = 'off'; return; }
  const head = table.tHead;
  if (!head || head.rows.length !== 1) { table.dataset.cards = 'off'; return; }
  const cells = Array.from(head.rows[0].cells);
  if (cells.length <= 3 || cells.some((c) => c.colSpan > 1)) { table.dataset.cards = 'off'; return; }
  const labels = cells.map((c) => c.textContent.trim());
  table.dataset.cards = 'on';
  table.dataset.cardLabels = JSON.stringify(labels);
  labelRows(table, labels);
}

function labelRows(table, labels) {
  for (const body of table.tBodies) {
    for (const row of body.rows) {
      let i = 0;
      for (const cell of row.cells) {
        const label = labels[i] ?? '';
        if (cell.dataset.label !== label) cell.dataset.label = label;
        // the first cell is the card title; empty label cells (actions) span the card
        i += cell.colSpan || 1;
      }
      if (row.cells.length === 1 && row.cells[0].colSpan > 1) row.dataset.full = 'true';
    }
  }
}

function scan(root) {
  if (!(root instanceof Element)) return;
  const tables = root.tagName === 'TABLE' ? [root] : root.querySelectorAll('table');
  for (const t of tables) {
    if (t.dataset.cards === 'on') labelRows(t, JSON.parse(t.dataset.cardLabels || '[]'));
    else labelTable(t);
  }
  const owner = root.closest?.('table[data-cards="on"]');
  if (owner) labelRows(owner, JSON.parse(owner.dataset.cardLabels || '[]'));
}

export function installResponsiveTables(doc = document) {
  if (typeof MutationObserver === 'undefined') return () => {};
  let queued = new Set();
  let frame = 0;
  const flush = () => {
    frame = 0;
    const items = queued;
    queued = new Set();
    for (const el of items) if (el.isConnected) scan(el);
  };
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      const el = r.target.nodeType === 1 ? r.target : r.target.parentElement;
      if (el) queued.add(el.closest('table') ?? el);
    }
    if (!frame) frame = requestAnimationFrame(flush);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  scan(doc.body);
  return () => observer.disconnect();
}
