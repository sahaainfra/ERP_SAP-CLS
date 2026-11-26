// Paste from a spreadsheet into a line grid (part 03.02, FR-06, T-01). Excel and Google Sheets put tab-separated text on the
// clipboard, one row per line, with a cell that holds a tab, a quote or a line break wrapped in double quotes ("" for a quote).

/** Split clipboard text into rows of cells. A trailing empty line (Excel always adds one) is dropped. */
export function parseClipboardTable(text) {
  const s = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows.map((r) => r.map((c) => c.trim()));
}

/**
 * Turn pasted rows into grid rows. `columns` are the editable columns in screen order, starting at the one the paste began in;
 * each has a `key` and optionally `parse(text) -> { ok, value, error }`. A first row that repeats the column labels is skipped.
 * Returns { rows: [{ values, errors }], skippedHeader }.
 */
export function rowsFromPaste(table, columns) {
  let body = table;
  let skippedHeader = false;
  const labels = columns.map((c) => String(c.label ?? '').toLowerCase());
  const labelled = body.length ? body[0].map((cell, i) => [cell, labels[i]]).filter(([cell, label]) => label && cell !== '') : [];
  if (labelled.length && labelled.every(([cell, label]) => cell.toLowerCase() === label)) {
    body = body.slice(1);
    skippedHeader = true;
  }
  const rows = body.map((cells) => {
    const values = {};
    const errors = {};
    columns.forEach((c, i) => {
      if (i >= cells.length) return;
      const parsed = c.parse ? c.parse(cells[i]) : { ok: true, value: cells[i] };
      values[c.key] = parsed.ok ? parsed.value : cells[i];
      if (!parsed.ok) errors[c.key] = parsed.error;
    });
    return { values, errors };
  });
  return { rows, skippedHeader };
}
