// Part 166.1: the cell splitter of the defect register (used by scripts/defects_by_part.mjs and its test).
/** Splits a table row on "|" that are not inside a code span. */
export function cellsOf(line) {
  const out = []; let cur = ''; let tick = false;
  for (const ch of line.replace(/^\s*\|/, '').replace(/\|\s*$/, '')) { if (ch === '`') tick = !tick; if (ch === '|' && !tick) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  out.push(cur.trim()); return out;
}
